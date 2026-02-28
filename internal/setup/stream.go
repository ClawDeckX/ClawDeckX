package setup

import (
	"ClawDeckX/internal/i18n"
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

type SetupEvent struct {
	Type     string      `json:"type"`               // "phase" | "step" | "progress" | "log" | "success" | "error" | "complete"
	Phase    string      `json:"phase,omitempty"`    // 当前阶段
	Step     string      `json:"step,omitempty"`     // 当前步骤
	Message  string      `json:"message"`            // 消息内容
	Progress int         `json:"progress,omitempty"` // 进度百分比 0-100
	Data     interface{} `json:"data,omitempty"`     // 附加数据
}

type EventEmitter struct {
	w       http.ResponseWriter
	flusher http.Flusher
	mu      sync.Mutex
}

func NewEventEmitter(w http.ResponseWriter) (*EventEmitter, error) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return nil, fmt.Errorf("streaming not supported")
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // 禁用 nginx 缓冲

	return &EventEmitter{
		w:       w,
		flusher: flusher,
	}, nil
}

func (e *EventEmitter) Emit(event SetupEvent) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	data, err := json.Marshal(event)
	if err != nil {
		return err
	}

	_, err = fmt.Fprintf(e.w, "data: %s\n\n", data)
	if err != nil {
		return err
	}
	e.flusher.Flush()
	return nil
}

func (e *EventEmitter) EmitPhase(phase, message string, progress int) error {
	return e.Emit(SetupEvent{
		Type:     "phase",
		Phase:    phase,
		Message:  message,
		Progress: progress,
	})
}

func (e *EventEmitter) EmitStep(phase, step, message string, progress int) error {
	return e.Emit(SetupEvent{
		Type:     "step",
		Phase:    phase,
		Step:     step,
		Message:  message,
		Progress: progress,
	})
}

func (e *EventEmitter) EmitLog(message string) error {
	return e.Emit(SetupEvent{
		Type:    "log",
		Message: message,
	})
}

func (e *EventEmitter) EmitProgress(progress int, message string) error {
	return e.Emit(SetupEvent{
		Type:     "progress",
		Progress: progress,
		Message:  message,
	})
}

func (e *EventEmitter) EmitSuccess(message string, data interface{}) error {
	return e.Emit(SetupEvent{
		Type:    "success",
		Message: message,
		Data:    data,
	})
}

func (e *EventEmitter) EmitError(message string, data interface{}) error {
	return e.Emit(SetupEvent{
		Type:    "error",
		Message: message,
		Data:    data,
	})
}

func (e *EventEmitter) EmitComplete(message string, data interface{}) error {
	return e.Emit(SetupEvent{
		Type:    "complete",
		Message: message,
		Data:    data,
	})
}

type StreamCommand struct {
	emitter      *EventEmitter
	phase        string
	step         string
	sudoPassword string // sudo 密码（可选）
}

func NewStreamCommand(emitter *EventEmitter, phase, step string) *StreamCommand {
	return &StreamCommand{
		emitter: emitter,
		phase:   phase,
		step:    step,
	}
}

func NewStreamCommandWithSudo(emitter *EventEmitter, phase, step, sudoPassword string) *StreamCommand {
	return &StreamCommand{
		emitter:      emitter,
		phase:        phase,
		step:         step,
		sudoPassword: sudoPassword,
	}
}

func (sc *StreamCommand) Run(ctx context.Context, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)

	if isWindows() {
		cmd.Env = append(os.Environ(), "LANG=en_US.UTF-8", "PYTHONIOENCODING=utf-8")
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf(i18n.T(i18n.MsgErrCreateStdoutPipeFailed), err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf(i18n.T(i18n.MsgErrCreateStderrPipeFailed), err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf(i18n.T(i18n.MsgErrStartCommandFailed), err)
	}

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		sc.streamOutput(stdout, "stdout")
	}()

	go func() {
		defer wg.Done()
		sc.streamOutput(stderr, "stderr")
	}()

	wg.Wait()

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf(i18n.T(i18n.MsgErrCommandExecFailed), err)
	}

	return nil
}

func (sc *StreamCommand) streamOutput(r io.Reader, source string) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := scanner.Text()
		sc.emitter.Emit(SetupEvent{
			Type:    "log",
			Phase:   sc.phase,
			Step:    sc.step,
			Message: line,
			Data:    map[string]string{"source": source},
		})
	}
}

func (sc *StreamCommand) RunShell(ctx context.Context, command string) error {
	if !isWindows() && sc.sudoPassword != "" && os.Getuid() != 0 && strings.Contains(command, "sudo") {
		escaped := strings.ReplaceAll(sc.sudoPassword, "'", "'\\''")
		askpass := fmt.Sprintf(
			"_ASKPASS=$(mktemp); echo '#!/bin/sh\necho '\"'\"'%s'\"'\"'' > $_ASKPASS; chmod +x $_ASKPASS; export SUDO_ASKPASS=$_ASKPASS; ",
			escaped,
		)
		command = strings.ReplaceAll(command, "sudo ", "sudo -A ")
		command = askpass + command + "; rm -f $_ASKPASS"
	}

	var cmd *exec.Cmd
	if isWindows() {
		utf8Prefix := "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; "
		cmd = exec.CommandContext(ctx, "powershell", "-NoProfile", "-Command", utf8Prefix+command)
	} else {
		cmd = exec.CommandContext(ctx, "sh", "-c", command)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf(i18n.T(i18n.MsgErrCreateStdoutPipeFailed), err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf(i18n.T(i18n.MsgErrCreateStderrPipeFailed), err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf(i18n.T(i18n.MsgErrStartCommandFailed), err)
	}

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		sc.streamOutput(stdout, "stdout")
	}()

	go func() {
		defer wg.Done()
		sc.streamOutput(stderr, "stderr")
	}()

	wg.Wait()

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf(i18n.T(i18n.MsgErrCommandExecFailed), err)
	}

	return nil
}

func isWindows() bool {
	return runtime.GOOS == "windows"
}

func (e *EventEmitter) KeepAlive(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			e.mu.Lock()
			fmt.Fprintf(e.w, ": heartbeat\n\n")
			e.flusher.Flush()
			e.mu.Unlock()
		}
	}
}
