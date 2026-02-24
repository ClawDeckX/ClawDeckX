package setup

import (
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

// SetupEvent SSE 事件
type SetupEvent struct {
	Type     string      `json:"type"`               // "phase" | "step" | "progress" | "log" | "success" | "error" | "complete"
	Phase    string      `json:"phase,omitempty"`    // 当前阶段
	Step     string      `json:"step,omitempty"`     // 当前步骤
	Message  string      `json:"message"`            // 消息内容
	Progress int         `json:"progress,omitempty"` // 进度百分比 0-100
	Data     interface{} `json:"data,omitempty"`     // 附加数据
}

// EventEmitter SSE 事件发送器
type EventEmitter struct {
	w       http.ResponseWriter
	flusher http.Flusher
	mu      sync.Mutex
}

// NewEventEmitter 创建事件发送器
func NewEventEmitter(w http.ResponseWriter) (*EventEmitter, error) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return nil, fmt.Errorf("streaming not supported")
	}

	// 设置 SSE 响应头
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // 禁用 nginx 缓冲

	return &EventEmitter{
		w:       w,
		flusher: flusher,
	}, nil
}

// Emit 发送事件
func (e *EventEmitter) Emit(event SetupEvent) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	data, err := json.Marshal(event)
	if err != nil {
		return err
	}

	// SSE 格式: data: {...}\n\n
	_, err = fmt.Fprintf(e.w, "data: %s\n\n", data)
	if err != nil {
		return err
	}
	e.flusher.Flush()
	return nil
}

// EmitPhase 发送阶段开始事件
func (e *EventEmitter) EmitPhase(phase, message string, progress int) error {
	return e.Emit(SetupEvent{
		Type:     "phase",
		Phase:    phase,
		Message:  message,
		Progress: progress,
	})
}

// EmitStep 发送步骤事件
func (e *EventEmitter) EmitStep(phase, step, message string, progress int) error {
	return e.Emit(SetupEvent{
		Type:     "step",
		Phase:    phase,
		Step:     step,
		Message:  message,
		Progress: progress,
	})
}

// EmitLog 发送日志事件
func (e *EventEmitter) EmitLog(message string) error {
	return e.Emit(SetupEvent{
		Type:    "log",
		Message: message,
	})
}

// EmitProgress 发送进度更新
func (e *EventEmitter) EmitProgress(progress int, message string) error {
	return e.Emit(SetupEvent{
		Type:     "progress",
		Progress: progress,
		Message:  message,
	})
}

// EmitSuccess 发送成功事件
func (e *EventEmitter) EmitSuccess(message string, data interface{}) error {
	return e.Emit(SetupEvent{
		Type:    "success",
		Message: message,
		Data:    data,
	})
}

// EmitError 发送错误事件
func (e *EventEmitter) EmitError(message string, data interface{}) error {
	return e.Emit(SetupEvent{
		Type:    "error",
		Message: message,
		Data:    data,
	})
}

// EmitComplete 发送完成事件
func (e *EventEmitter) EmitComplete(message string, data interface{}) error {
	return e.Emit(SetupEvent{
		Type:    "complete",
		Message: message,
		Data:    data,
	})
}

// StreamCommand 流式执行命令
type StreamCommand struct {
	emitter      *EventEmitter
	phase        string
	step         string
	sudoPassword string // sudo 密码（可选）
}

// NewStreamCommand 创建流式命令执行器
func NewStreamCommand(emitter *EventEmitter, phase, step string) *StreamCommand {
	return &StreamCommand{
		emitter: emitter,
		phase:   phase,
		step:    step,
	}
}

// NewStreamCommandWithSudo 创建带 sudo 密码的流式命令执行器
func NewStreamCommandWithSudo(emitter *EventEmitter, phase, step, sudoPassword string) *StreamCommand {
	return &StreamCommand{
		emitter:      emitter,
		phase:        phase,
		step:         step,
		sudoPassword: sudoPassword,
	}
}

// Run 执行命令并流式输出
func (sc *StreamCommand) Run(ctx context.Context, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)

	// Windows 下强制子进程使用 UTF-8 输出
	if isWindows() {
		cmd.Env = append(os.Environ(), "LANG=en_US.UTF-8", "PYTHONIOENCODING=utf-8")
	}

	// 获取 stdout 和 stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("创建 stdout 管道失败: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("创建 stderr 管道失败: %w", err)
	}

	// 启动命令
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动命令失败: %w", err)
	}

	// 并发读取输出
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

	// 等待输出读取完成
	wg.Wait()

	// 等待命令完成
	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("命令执行失败: %w", err)
	}

	return nil
}

// streamOutput 流式读取输出
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

// RunShell 执行 shell 命令
// 如果命令包含 sudo 且设置了 sudoPassword，自动注入密码
func (sc *StreamCommand) RunShell(ctx context.Context, command string) error {
	// 非 Windows、非 root、有密码、命令含 sudo → 通过 SUDO_ASKPASS 注入密码
	if !isWindows() && sc.sudoPassword != "" && os.Getuid() != 0 && strings.Contains(command, "sudo") {
		escaped := strings.ReplaceAll(sc.sudoPassword, "'", "'\\''")
		// 创建内联 askpass 脚本，sudo -A 会调用它获取密码
		askpass := fmt.Sprintf(
			"_ASKPASS=$(mktemp); echo '#!/bin/sh\necho '\"'\"'%s'\"'\"'' > $_ASKPASS; chmod +x $_ASKPASS; export SUDO_ASKPASS=$_ASKPASS; ",
			escaped,
		)
		// 将 sudo 替换为 sudo -A（使用 askpass 程序）
		command = strings.ReplaceAll(command, "sudo ", "sudo -A ")
		command = askpass + command + "; rm -f $_ASKPASS"
	}

	var cmd *exec.Cmd
	if isWindows() {
		// 强制 PowerShell 输出 UTF-8，避免中文 Windows 上 GBK 乱码
		utf8Prefix := "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; "
		cmd = exec.CommandContext(ctx, "powershell", "-NoProfile", "-Command", utf8Prefix+command)
	} else {
		cmd = exec.CommandContext(ctx, "sh", "-c", command)
	}

	// 获取 stdout 和 stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("创建 stdout 管道失败: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("创建 stderr 管道失败: %w", err)
	}

	// 启动命令
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动命令失败: %w", err)
	}

	// 并发读取输出
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

	// 等待输出读取完成
	wg.Wait()

	// 等待命令完成
	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("命令执行失败: %w", err)
	}

	return nil
}

// isWindows 判断是否为 Windows
func isWindows() bool {
	return runtime.GOOS == "windows"
}

// KeepAlive 发送心跳保持连接
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
