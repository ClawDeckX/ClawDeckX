package handlers

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"ClawDeckX/internal/logger"
)

// InstallStreamSSE installs a ClawHub skill via SSE, streaming install logs in real time.
func (h *ClawHubHandler) InstallStreamSSE(w http.ResponseWriter, r *http.Request) {
	var params struct {
		Slug    string `json:"slug"`
		Version string `json:"version,omitempty"`
		Force   bool   `json:"force,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&params); err != nil || params.Slug == "" {
		http.Error(w, `data: {"type":"error","message":"slug is required"}`+"\n\n", http.StatusBadRequest)
		return
	}

	// set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	sendSSE := func(eventType string, data map[string]interface{}) {
		payload, _ := json.Marshal(data)
		fmt.Fprintf(w, "data: %s\n\n", payload)
		flusher.Flush()
	}

	sendSSE("log", map[string]interface{}{
		"type":    "log",
		"message": fmt.Sprintf("installing %s ...", params.Slug),
		"ts":      time.Now().UnixMilli(),
	})

	// remote gateway: via skills.install (non-streaming, push start/end events)
	if h.isRemoteGateway() {
		sendSSE("log", map[string]interface{}{
			"type":    "log",
			"message": "remote gateway mode, waiting for install to complete...",
			"ts":      time.Now().UnixMilli(),
		})
		result, err := h.remoteSkillsInstall(params.Slug, 120000)
		if err != nil {
			sendSSE("error", map[string]interface{}{
				"type":    "error",
				"message": "remote install failed: " + err.Error(),
				"ts":      time.Now().UnixMilli(),
			})
			return
		}
		if msg, ok := result["message"].(string); ok && msg != "" {
			for _, line := range strings.Split(msg, "\n") {
				if line = strings.TrimSpace(line); line != "" {
					sendSSE("log", map[string]interface{}{
						"type":    "log",
						"message": line,
						"ts":      time.Now().UnixMilli(),
					})
				}
			}
		}
		if params.Version != "" || params.Force {
			sendSSE("log", map[string]interface{}{
				"type":    "log",
				"message": "remote install ignores version/force flags with current gateway API",
				"ts":      time.Now().UnixMilli(),
			})
		}
		sendSSE("done", map[string]interface{}{
			"type":    "done",
			"message": "install complete",
			"slug":    params.Slug,
			"success": true,
			"ts":      time.Now().UnixMilli(),
		})
		return
	}

	// local gateway: stream clawhub CLI output
	cmdName := "clawhub"
	if runtime.GOOS == "windows" {
		cmdName = "clawhub.cmd"
	}

	args := []string{"install", params.Slug}
	if params.Version != "" {
		args = append(args, "--version", params.Version)
	}
	if params.Force {
		args = append(args, "--force")
	}
	args = append(args, "--no-input")

	home, _ := os.UserHomeDir()
	skillsDir := filepath.Join(home, ".openclaw", "skills")
	os.MkdirAll(skillsDir, 0755)

	cmd := exec.Command(cmdName, args...)
	cmd.Env = append(os.Environ(), "CLAWHUB_DISABLE_TELEMETRY=1")
	cmd.Dir = skillsDir

	// merge stdout + stderr
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		sendSSE("error", map[string]interface{}{
			"type":    "error",
			"message": "failed to create stdout pipe: " + err.Error(),
			"ts":      time.Now().UnixMilli(),
		})
		return
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		// clawhub not in PATH, try npx
		if strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "not recognized") ||
			strings.Contains(err.Error(), "executable file not found") {
			sendSSE("log", map[string]interface{}{
				"type":    "log",
				"message": "clawhub not found, trying npx ...",
				"ts":      time.Now().UnixMilli(),
			})
			h.installStreamViaNpx(w, flusher, sendSSE, args, skillsDir, params.Slug)
			return
		}
		sendSSE("error", map[string]interface{}{
			"type":    "error",
			"message": "failed to start install process: " + err.Error(),
			"ts":      time.Now().UnixMilli(),
		})
		return
	}

	h.streamOutput(stdoutPipe, sendSSE)

	exitErr := cmd.Wait()
	success := exitErr == nil

	if success {
		sendSSE("done", map[string]interface{}{
			"type":    "done",
			"message": "install complete",
			"slug":    params.Slug,
			"success": true,
			"ts":      time.Now().UnixMilli(),
		})
	} else {
		sendSSE("error", map[string]interface{}{
			"type":    "error",
			"message": "install failed: " + exitErr.Error(),
			"slug":    params.Slug,
			"ts":      time.Now().UnixMilli(),
		})
	}

	logger.Log.Info().Str("slug", params.Slug).Bool("success", success).Msg("ClawHub SSE install finished")
}

// installStreamViaNpx runs clawhub install via npx (streaming).
func (h *ClawHubHandler) installStreamViaNpx(w http.ResponseWriter, flusher http.Flusher, sendSSE func(string, map[string]interface{}), args []string, skillsDir string, slug string) {
	npxArgs := append([]string{"clawhub"}, args...)
	cmd := exec.Command("npx", npxArgs...)
	cmd.Env = append(os.Environ(), "CLAWHUB_DISABLE_TELEMETRY=1")
	cmd.Dir = skillsDir

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		sendSSE("error", map[string]interface{}{
			"type":    "error",
			"message": "failed to create pipe: " + err.Error(),
			"ts":      time.Now().UnixMilli(),
		})
		return
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		sendSSE("error", map[string]interface{}{
			"type":    "error",
			"message": "npx start failed: " + err.Error(),
			"ts":      time.Now().UnixMilli(),
		})
		return
	}

	h.streamOutput(stdoutPipe, sendSSE)

	exitErr := cmd.Wait()
	success := exitErr == nil

	if success {
		sendSSE("done", map[string]interface{}{
			"type":    "done",
			"message": "install complete",
			"slug":    slug,
			"success": true,
			"ts":      time.Now().UnixMilli(),
		})
	} else {
		sendSSE("error", map[string]interface{}{
			"type":    "error",
			"message": "install failed: " + exitErr.Error(),
			"slug":    slug,
			"ts":      time.Now().UnixMilli(),
		})
	}
}

// streamOutput reads pipe line by line and pushes SSE events.
func (h *ClawHubHandler) streamOutput(pipe io.Reader, sendSSE func(string, map[string]interface{})) {
	scanner := bufio.NewScanner(pipe)
	scanner.Buffer(make([]byte, 64*1024), 64*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if line = strings.TrimSpace(line); line != "" {
			sendSSE("log", map[string]interface{}{
				"type":    "log",
				"message": line,
				"ts":      time.Now().UnixMilli(),
			})
		}
	}
}

// DepInstallStreamSSE installs skill deps via SSE (skills.install via Gateway RPC).
// Runs RPC in background, pushes heartbeat logs every 5s, then pushes result.
func (h *GWProxyHandler) DepInstallStreamSSE(w http.ResponseWriter, r *http.Request) {
	var params struct {
		Name      string `json:"name"`
		InstallId string `json:"installId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&params); err != nil || params.Name == "" || params.InstallId == "" {
		http.Error(w, `data: {"type":"error","message":"name and installId required"}`+"\n\n", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	sendSSE := func(eventType string, data map[string]interface{}) {
		payload, _ := json.Marshal(data)
		fmt.Fprintf(w, "data: %s\n\n", payload)
		flusher.Flush()
	}

	sendSSE("log", map[string]interface{}{
		"type":    "log",
		"message": fmt.Sprintf("installing %s deps (%s) ...", params.Name, params.InstallId),
		"ts":      time.Now().UnixMilli(),
	})

	sendSSE("log", map[string]interface{}{
		"type":    "log",
		"message": "installing via Gateway, please wait...",
		"ts":      time.Now().UnixMilli(),
	})

	rpcParams := map[string]interface{}{
		"name":      params.Name,
		"installId": params.InstallId,
		"timeoutMs": 300000,
	}

	// run RPC in goroutine, main thread pushes heartbeats
	type rpcResult struct {
		data json.RawMessage
		err  error
	}
	resultCh := make(chan rpcResult, 1)
	go func() {
		data, err := h.client.RequestWithTimeout("skills.install", rpcParams, 5*time.Minute)
		resultCh <- rpcResult{data, err}
	}()

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	elapsed := 0

waitLoop:
	for {
		select {
		case res := <-resultCh:
			if res.err != nil {
				sendSSE("error", map[string]interface{}{
					"type":    "error",
					"message": "install failed: " + res.err.Error(),
					"ts":      time.Now().UnixMilli(),
				})
				return
			}
			// parse Gateway response
			var result map[string]interface{}
			if json.Unmarshal(res.data, &result) == nil {
				if msg, ok := result["message"].(string); ok && msg != "" {
					for _, line := range strings.Split(msg, "\n") {
						if line = strings.TrimSpace(line); line != "" {
							sendSSE("log", map[string]interface{}{
								"type":    "log",
								"message": line,
								"ts":      time.Now().UnixMilli(),
							})
						}
					}
				}
				if output, ok := result["output"].(string); ok && output != "" {
					for _, line := range strings.Split(output, "\n") {
						if line = strings.TrimSpace(line); line != "" {
							sendSSE("log", map[string]interface{}{
								"type":    "log",
								"message": line,
								"ts":      time.Now().UnixMilli(),
							})
						}
					}
				}
			}

			isOk := true
			if result != nil {
				if ok, exists := result["ok"].(bool); exists {
					isOk = ok
				}
			}

			if isOk {
				sendSSE("done", map[string]interface{}{
					"type":    "done",
					"message": "dependency install complete",
					"name":    params.Name,
					"success": true,
					"ts":      time.Now().UnixMilli(),
				})
			} else {
				errMsg := "install failed"
				if result != nil {
					if m, ok := result["message"].(string); ok {
						errMsg = m
					}
				}
				sendSSE("error", map[string]interface{}{
					"type":    "error",
					"message": errMsg,
					"name":    params.Name,
					"ts":      time.Now().UnixMilli(),
				})
			}
			break waitLoop

		case <-ticker.C:
			elapsed += 5
			sendSSE("log", map[string]interface{}{
				"type":    "log",
				"message": fmt.Sprintf("installing... (%ds)", elapsed),
				"ts":      time.Now().UnixMilli(),
			})

		case <-r.Context().Done():
			// client disconnected, but RPC still running in background
			logger.Log.Warn().Str("name", params.Name).Msg("client disconnected SSE, install still running in background")
			return
		}
	}
}

// DepInstallAsync installs skill deps asynchronously (returns 202, runs in background).
// Frontend polls skills.status to check completion.
func (h *GWProxyHandler) DepInstallAsync(w http.ResponseWriter, r *http.Request) {
	var params struct {
		Name      string `json:"name"`
		InstallId string `json:"installId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&params); err != nil || params.Name == "" || params.InstallId == "" {
		http.Error(w, `{"ok":false,"error":"name and installId required"}`, http.StatusBadRequest)
		return
	}

	rpcParams := map[string]interface{}{
		"name":      params.Name,
		"installId": params.InstallId,
		"timeoutMs": 300000,
	}

	// run install in background
	go func() {
		data, err := h.client.RequestWithTimeout("skills.install", rpcParams, 5*time.Minute)
		if err != nil {
			logger.Log.Error().Err(err).Str("name", params.Name).Msg("background skill dep install failed")
			return
		}
		var result map[string]interface{}
		if json.Unmarshal(data, &result) == nil {
			if ok, exists := result["ok"].(bool); exists && ok {
				logger.Log.Info().Str("name", params.Name).Msg("background skill dep install succeeded")
			} else {
				logger.Log.Warn().Str("name", params.Name).Interface("result", result).Msg("background skill dep install returned non-ok")
			}
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":      true,
		"message": "install submitted, poll skills.status for result",
		"name":    params.Name,
	})
}
