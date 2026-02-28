package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// MaintenanceHandler provides context budget optimization APIs.
// Uses Gateway RPC to get accurate data instead of file scanning.
type MaintenanceHandler struct {
	svc    *openclaw.Service
	client *openclaw.GWClient
}

func NewMaintenanceHandler(svc *openclaw.Service) *MaintenanceHandler {
	return &MaintenanceHandler{
		svc: svc,
	}
}

// SetGWClient injects the Gateway WebSocket client.
func (h *MaintenanceHandler) SetGWClient(client *openclaw.GWClient) {
	h.client = client
}

// ==================== Context Budget ====================

// ContextAnalyze analyzes context budget from agent workspace files.
func (h *MaintenanceHandler) ContextAnalyze(w http.ResponseWriter, r *http.Request) {
	agentID := r.URL.Query().Get("agent")
	if agentID == "" {
		agentID = "main"
	}

	if h.client == nil || !h.client.IsConnected() {
		web.Fail(w, r, "GATEWAY_NOT_CONNECTED", "Gateway not connected", http.StatusServiceUnavailable)
		return
	}

	// Get workspace files via agents.files.get
	contextFiles := []string{"SOUL.md", "TOOLS.md", "MEMORY.md", "AGENTS.md", "IDENTITY.md", "USER.md", "HEARTBEAT.md"}
	files := []map[string]interface{}{}
	totalSize := int64(0)
	totalTokens := 0

	for _, fname := range contextFiles {
		data, err := h.client.RequestWithTimeout("agents.files.get", map[string]interface{}{
			"agentId": agentID,
			"name":    fname,
		}, 5*time.Second)

		if err != nil {
			continue
		}

		var fileResp struct {
			Content string `json:"content"`
			Exists  bool   `json:"exists"`
		}
		if json.Unmarshal(data, &fileResp) != nil || !fileResp.Exists {
			continue
		}

		size := int64(len(fileResp.Content))
		tokens := int(size / 4) // Rough estimate: 4 chars per token

		status := "ok"
		if size > 20*1024 {
			status = "critical"
		} else if size > 10*1024 {
			status = "warn"
		}

		files = append(files, map[string]interface{}{
			"fileName":      fname,
			"size":          size,
			"tokenEstimate": tokens,
			"percentage":    0, // Will calculate after
			"status":        status,
			"lastModified":  time.Now().UTC().Format(time.RFC3339),
		})

		totalSize += size
		totalTokens += tokens
	}

	// Calculate percentages
	for i := range files {
		if totalTokens > 0 {
			files[i]["percentage"] = float64(files[i]["tokenEstimate"].(int)) / float64(totalTokens) * 100
		}
	}

	budgetLimit := 128000 // 128K tokens
	usagePercentage := float64(totalTokens) / float64(budgetLimit) * 100

	status := "ok"
	if usagePercentage > 50 {
		status = "critical"
	} else if usagePercentage > 25 {
		status = "warn"
	}

	// Generate suggestions
	suggestions := []map[string]interface{}{}
	for _, f := range files {
		if f["status"] == "critical" {
			suggestions = append(suggestions, map[string]interface{}{
				"file":            f["fileName"],
				"issue":           "File is too large",
				"action":          "Consider splitting or archiving old content",
				"estimatedSaving": f["tokenEstimate"].(int) / 2,
			})
		} else if f["status"] == "warn" {
			suggestions = append(suggestions, map[string]interface{}{
				"file":            f["fileName"],
				"issue":           "File is getting large",
				"action":          "Review and remove outdated entries",
				"estimatedSaving": f["tokenEstimate"].(int) / 4,
			})
		}
	}

	web.OK(w, r, map[string]interface{}{
		"totalSize":       totalSize,
		"totalTokens":     totalTokens,
		"budgetLimit":     budgetLimit,
		"usagePercentage": usagePercentage,
		"status":          status,
		"files":           files,
		"suggestions":     suggestions,
	})
}

// ContextOptimize optimizes a context file.
func (h *MaintenanceHandler) ContextOptimize(w http.ResponseWriter, r *http.Request) {
	var req struct {
		FileName string `json:"fileName"`
		AgentID  string `json:"agentId"`
	}
	if r.Body != nil {
		json.NewDecoder(r.Body).Decode(&req)
	}

	if req.FileName == "" {
		web.Fail(w, r, "BAD_REQUEST", "fileName is required", http.StatusBadRequest)
		return
	}

	agentID := req.AgentID
	if agentID == "" {
		agentID = "main"
	}

	if h.client == nil || !h.client.IsConnected() {
		web.Fail(w, r, "GATEWAY_NOT_CONNECTED", "Gateway not connected", http.StatusServiceUnavailable)
		return
	}

	// Get file content
	data, err := h.client.RequestWithTimeout("agents.files.get", map[string]interface{}{
		"agentId": agentID,
		"name":    req.FileName,
	}, 5*time.Second)
	if err != nil {
		web.Fail(w, r, "GET_FILE_FAILED", err.Error(), http.StatusBadGateway)
		return
	}

	var fileResp struct {
		Content string `json:"content"`
		Exists  bool   `json:"exists"`
	}
	if json.Unmarshal(data, &fileResp) != nil || !fileResp.Exists {
		web.Fail(w, r, "NOT_FOUND", "file not found", http.StatusNotFound)
		return
	}

	originalSize := int64(len(fileResp.Content))
	newContent := fileResp.Content
	changes := []string{}

	// Simple optimizations
	// 1. Remove excessive blank lines
	for strings.Contains(newContent, "\n\n\n") {
		newContent = strings.ReplaceAll(newContent, "\n\n\n", "\n\n")
		if len(changes) == 0 || changes[len(changes)-1] != "Removed excessive blank lines" {
			changes = append(changes, "Removed excessive blank lines")
		}
	}

	// 2. Trim trailing whitespace per line
	lines := strings.Split(newContent, "\n")
	trimmed := false
	for i, line := range lines {
		t := strings.TrimRight(line, " \t")
		if t != line {
			lines[i] = t
			trimmed = true
		}
	}
	if trimmed {
		newContent = strings.Join(lines, "\n")
		changes = append(changes, "Trimmed trailing whitespace")
	}

	newSize := int64(len(newContent))

	// Write back if changed
	if newSize < originalSize {
		_, err = h.client.RequestWithTimeout("agents.files.set", map[string]interface{}{
			"agentId": agentID,
			"name":    req.FileName,
			"content": newContent,
		}, 10*time.Second)
		if err != nil {
			web.Fail(w, r, "WRITE_FAILED", err.Error(), http.StatusBadGateway)
			return
		}
	}

	savedTokens := int((originalSize - newSize) / 4)

	web.OK(w, r, map[string]interface{}{
		"file":         req.FileName,
		"originalSize": originalSize,
		"newSize":      newSize,
		"savedTokens":  savedTokens,
		"changes":      changes,
	})
}
