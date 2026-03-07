package monitor

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

type GWCollector struct {
	client       *openclaw.GWClient
	activityRepo *database.ActivityRepo
	wsHub        *web.WSHub
	interval     time.Duration
	stopCh       chan struct{}
	running      bool

	lastSessions map[string]sessionSnapshot

	// Log analysis: cursor-based incremental log fetching.
	logCursor    int // file byte offset for incremental reads; -1 = not initialized
	logPollCount int
}

type sessionSnapshot struct {
	InputTokens  int64
	OutputTokens int64
	TotalTokens  int64
	UpdatedAt    int64
}

func NewGWCollector(client *openclaw.GWClient, wsHub *web.WSHub, intervalSec int) *GWCollector {
	if intervalSec < 10 {
		intervalSec = 30
	}
	return &GWCollector{
		client:       client,
		activityRepo: database.NewActivityRepo(),
		wsHub:        wsHub,
		interval:     time.Duration(intervalSec) * time.Second,
		stopCh:       make(chan struct{}),
		lastSessions: make(map[string]sessionSnapshot),
		logCursor:    -1,
	}
}

func (c *GWCollector) Start() {
	c.running = true
	logger.Monitor.Info().
		Dur("interval", c.interval).
		Msg(i18n.T(i18n.MsgLogGwCollectorStarted))

	c.client.SetEventHandler(c.handleEvent)

	c.poll()

	// Seed seen log lines on first run so we don't flood activity with old entries.
	c.pollLogs(true)

	ticker := time.NewTicker(c.interval)
	logTicker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	defer logTicker.Stop()

	for {
		select {
		case <-ticker.C:
			c.poll()
			c.broadcastBadges()
		case <-logTicker.C:
			c.pollLogs(false)
		case <-c.stopCh:
			c.running = false
			logger.Monitor.Info().Msg(i18n.T(i18n.MsgLogGwCollectorStopped))
			return
		}
	}
}

func (c *GWCollector) Stop() {
	if c.running {
		close(c.stopCh)
		c.stopCh = make(chan struct{})
	}
}

func (c *GWCollector) IsRunning() bool {
	return c.running
}

func (c *GWCollector) handleEvent(event string, payload json.RawMessage) {
	c.wsHub.Broadcast("gw_event", event, payload)
	// Compatibility alias: some UIs listen for "chat" only.
	if event == "session.message" {
		c.wsHub.Broadcast("gw_event", "chat", payload)
	}

	switch {
	case event == "session.updated" || event == "session.created":
		c.handleSessionEvent(event, payload)
	case event == "session.message":
		c.handleMessageEvent(payload)
	case event == "chat":
		c.handleChatStreamEvent(payload)
	case strings.HasPrefix(event, "tool."):
		c.handleToolEvent(event, payload)
	case event == "error":
		c.handleErrorEvent(payload)
	case strings.HasPrefix(event, "cron."):
		c.handleCronEvent(event, payload)
	case event == "log":
		c.handleLogEvent(payload)
	}

	// Unified log analysis: check payload for error/warn indicators
	c.analyzePayloadForErrors(event, payload)
}

func (c *GWCollector) handleChatStreamEvent(payload json.RawMessage) {
	var data struct {
		SessionKey   string `json:"sessionKey"`
		State        string `json:"state"`
		ErrorMessage string `json:"errorMessage"`
	}
	if err := json.Unmarshal(payload, &data); err != nil {
		return
	}
	state := strings.TrimSpace(data.State)
	switch state {
	case "final", "aborted":
		c.writeActivity("Message", "low", fmt.Sprintf("Session reply completed: %s", data.SessionKey), string(payload), "chat", "allow", "")
	case "error":
		summary := "Session reply failed"
		if data.ErrorMessage != "" {
			summary += ": " + data.ErrorMessage
		}
		c.writeActivity("System", "medium", summary, string(payload), "chat", "alert", "")
	}
}

func (c *GWCollector) handleSessionEvent(event string, payload json.RawMessage) {
	var data struct {
		Key       string `json:"key"`
		SessionID string `json:"sessionId"`
		Model     string `json:"model"`
		Kind      string `json:"kind"`
	}
	if err := json.Unmarshal(payload, &data); err != nil {
		return
	}

	summary := fmt.Sprintf("Session %s: %s", strings.TrimPrefix(event, "session."), data.Key)
	c.writeActivity("Session", "low", summary, string(payload), data.Key, "allow", data.SessionID)
}

func (c *GWCollector) handleMessageEvent(payload json.RawMessage) {
	var data struct {
		Role    string `json:"role"`
		Content string `json:"content"`
		Key     string `json:"key"`
		Model   string `json:"model"`
	}
	if err := json.Unmarshal(payload, &data); err != nil {
		return
	}

	content := data.Content
	if len(content) > 200 {
		content = content[:200] + "..."
	}
	summary := fmt.Sprintf("[%s] %s", data.Role, content)
	c.writeActivity("Message", "low", summary, string(payload), data.Model, "allow", "")
}

func (c *GWCollector) handleToolEvent(event string, payload json.RawMessage) {
	var data struct {
		Tool      string `json:"tool"`
		Name      string `json:"name"`
		Input     string `json:"input"`
		SessionID string `json:"sessionId"`
		Key       string `json:"key"`
	}
	if err := json.Unmarshal(payload, &data); err != nil {
		return
	}

	toolName := data.Tool
	if toolName == "" {
		toolName = data.Name
	}

	category := classifyTool(toolName)
	risk := "low"
	actionTaken := "allow"

	input := data.Input
	if len(input) > 300 {
		input = input[:300] + "..."
	}

	summary := fmt.Sprintf("Tool call: %s", toolName)
	if input != "" {
		summary += " → " + input
	}

	c.writeActivity(category, risk, summary, string(payload), toolName, actionTaken, data.SessionID)
}

func (c *GWCollector) handleErrorEvent(payload json.RawMessage) {
	var data struct {
		Message string `json:"message"`
		Code    int    `json:"code"`
	}
	if err := json.Unmarshal(payload, &data); err != nil {
		return
	}

	summary := fmt.Sprintf("Gateway error: %s (code=%d)", data.Message, data.Code)
	c.writeActivity("System", "medium", summary, string(payload), "gateway", "alert", "")
}

func (c *GWCollector) handleCronEvent(event string, payload json.RawMessage) {
	var data struct {
		Name string `json:"name"`
		Key  string `json:"key"`
	}
	if err := json.Unmarshal(payload, &data); err != nil {
		return
	}

	name := data.Name
	if name == "" {
		name = data.Key
	}
	summary := fmt.Sprintf("Cron task %s: %s", strings.TrimPrefix(event, "cron."), name)
	c.writeActivity("System", "low", summary, string(payload), "cron", "allow", "")
}

// broadcastBadges pushes badge counts to all WS clients.
func (c *GWCollector) broadcastBadges() {
	badges := map[string]int64{}
	alertRepo := database.NewAlertRepo()
	if n, err := alertRepo.CountUnread(); err == nil {
		badges["alerts"] = n
	}
	if c.client.IsConnected() {
		if raw, err := c.client.Request("device.pair.list", nil); err == nil {
			var resp struct {
				Pending []json.RawMessage `json:"pending"`
			}
			if json.Unmarshal(raw, &resp) == nil && len(resp.Pending) > 0 {
				badges["nodes"] = int64(len(resp.Pending))
			}
		}
	} else {
		badges["gateway"] = 1
	}
	settingRepo := database.NewSettingRepo()
	if v, err := settingRepo.Get("snapshot_schedule_last_status"); err == nil && v == "failed" {
		badges["scheduler"] = 1
	}
	c.wsHub.Broadcast("", "badge_update", badges)
}

func (c *GWCollector) poll() {
	if !c.client.IsConnected() {
		logger.Monitor.Debug().Msg(i18n.T(i18n.MsgLogGwPollSkipNotConnected))
		return
	}

	data, err := c.client.Request("sessions.list", map[string]interface{}{})
	if err != nil {
		logger.Monitor.Debug().Err(err).Msg(i18n.T(i18n.MsgLogGwPollSessionsFailed))
		return
	}

	var result struct {
		Sessions []struct {
			Key          string `json:"key"`
			SessionID    string `json:"sessionId"`
			DisplayName  string `json:"displayName"`
			Model        string `json:"model"`
			InputTokens  int64  `json:"inputTokens"`
			OutputTokens int64  `json:"outputTokens"`
			TotalTokens  int64  `json:"totalTokens"`
			UpdatedAt    int64  `json:"updatedAt"`
			LastChannel  string `json:"lastChannel"`
			Kind         string `json:"kind"`
		} `json:"sessions"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		logger.Monitor.Debug().Err(err).Msg(i18n.T(i18n.MsgLogGwParseSessionsFailed))
		return
	}

	logger.Monitor.Debug().Int("sessions", len(result.Sessions)).Int("known", len(c.lastSessions)).Msg(i18n.T(i18n.MsgLogGwPollSessions))

	firstRun := len(c.lastSessions) == 0
	newCount := 0
	for _, sess := range result.Sessions {
		prev, exists := c.lastSessions[sess.Key]

		if !exists {
			c.lastSessions[sess.Key] = sessionSnapshot{
				InputTokens:  sess.InputTokens,
				OutputTokens: sess.OutputTokens,
				TotalTokens:  sess.TotalTokens,
				UpdatedAt:    sess.UpdatedAt,
			}

			displayName := sess.DisplayName
			if displayName == "" {
				displayName = sess.Key
			}
			source := sess.Model
			if sess.LastChannel != "" {
				source = sess.LastChannel + "/" + sess.Model
			}

			if firstRun {
				summary := fmt.Sprintf("Session: %s | %d tokens | Model: %s",
					displayName, sess.TotalTokens, sess.Model)
				detail, _ := json.Marshal(map[string]interface{}{
					"key":           sess.Key,
					"session_id":    sess.SessionID,
					"model":         sess.Model,
					"channel":       sess.LastChannel,
					"kind":          sess.Kind,
					"total_tokens":  sess.TotalTokens,
					"input_tokens":  sess.InputTokens,
					"output_tokens": sess.OutputTokens,
				})
				c.writeActivity("Session", "low", summary, string(detail), source, "allow", sess.SessionID)
			} else {
				summary := fmt.Sprintf("New session: %s (%s)", displayName, sess.Model)
				c.writeActivity("Session", "low", summary, "", sess.Key, "allow", sess.SessionID)
			}
			newCount++
			continue
		}

		if sess.TotalTokens > prev.TotalTokens && sess.UpdatedAt > prev.UpdatedAt {
			deltaTokens := sess.TotalTokens - prev.TotalTokens
			deltaInput := sess.InputTokens - prev.InputTokens
			deltaOutput := sess.OutputTokens - prev.OutputTokens

			displayName := sess.DisplayName
			if displayName == "" {
				displayName = sess.Key
			}

			summary := fmt.Sprintf("Session activity: %s | +%d tokens (input +%d, output +%d) | Model: %s",
				displayName, deltaTokens, deltaInput, deltaOutput, sess.Model)

			detail, _ := json.Marshal(map[string]interface{}{
				"key":          sess.Key,
				"session_id":   sess.SessionID,
				"model":        sess.Model,
				"channel":      sess.LastChannel,
				"delta_tokens": deltaTokens,
				"delta_input":  deltaInput,
				"delta_output": deltaOutput,
				"total_tokens": sess.TotalTokens,
			})

			source := sess.Model
			if sess.LastChannel != "" {
				source = sess.LastChannel + "/" + sess.Model
			}

			c.writeActivity("Message", "low", summary, string(detail), source, "allow", sess.SessionID)
			newCount++

			c.lastSessions[sess.Key] = sessionSnapshot{
				InputTokens:  sess.InputTokens,
				OutputTokens: sess.OutputTokens,
				TotalTokens:  sess.TotalTokens,
				UpdatedAt:    sess.UpdatedAt,
			}
		}
	}

	if newCount > 0 {
		logger.Monitor.Debug().Int("new_events", newCount).Msg(i18n.T(i18n.MsgLogGwPollNewEvents))
	}
}

func (c *GWCollector) writeActivity(category, risk, summary, detail, source, actionTaken, sessionID string) {
	eventID := fmt.Sprintf("gw-%d", time.Now().UnixNano())

	activity := &database.Activity{
		EventID:     eventID,
		Timestamp:   time.Now().UTC(),
		Category:    category,
		Risk:        risk,
		Summary:     summary,
		Detail:      detail,
		Source:      source,
		ActionTaken: actionTaken,
		SessionID:   sessionID,
	}

	if err := c.activityRepo.Create(activity); err != nil {
		logger.Monitor.Warn().Str("event_id", eventID).Err(err).Msg(i18n.T(i18n.MsgLogGwActivityWriteFailed))
		return
	}

	c.wsHub.Broadcast("activity", "activity", map[string]interface{}{
		"event_id":     eventID,
		"timestamp":    activity.Timestamp.Format(time.RFC3339),
		"category":     category,
		"risk":         risk,
		"summary":      summary,
		"source":       source,
		"action_taken": actionTaken,
	})
}

func classifyTool(tool string) string {
	lower := strings.ToLower(tool)
	switch {
	case strings.Contains(lower, "bash") || strings.Contains(lower, "shell") || strings.Contains(lower, "exec") || strings.Contains(lower, "command"):
		return "Shell"
	case strings.Contains(lower, "file") || strings.Contains(lower, "read") || strings.Contains(lower, "write") || strings.Contains(lower, "edit"):
		return "File"
	case strings.Contains(lower, "http") || strings.Contains(lower, "fetch") || strings.Contains(lower, "curl") || strings.Contains(lower, "request") || strings.Contains(lower, "network"):
		return "Network"
	case strings.Contains(lower, "browser") || strings.Contains(lower, "web") || strings.Contains(lower, "screenshot"):
		return "Browser"
	case strings.Contains(lower, "memory") || strings.Contains(lower, "store") || strings.Contains(lower, "cache"):
		return "Memory"
	default:
		return "System"
	}
}

// handleLogEvent processes gateway log events (event type: "log")
func (c *GWCollector) handleLogEvent(payload json.RawMessage) {
	var data struct {
		Level   string `json:"level"`
		Message string `json:"message"`
		Msg     string `json:"msg"`
		Time    string `json:"time"`
		Error   string `json:"error"`
		Err     string `json:"err"`
	}
	if err := json.Unmarshal(payload, &data); err != nil {
		return
	}

	level := strings.ToLower(data.Level)
	message := data.Message
	if message == "" {
		message = data.Msg
	}
	errDetail := data.Error
	if errDetail == "" {
		errDetail = data.Err
	}

	// Only record ERROR and WARN level logs
	switch level {
	case "error", "fatal", "panic":
		summary := "Gateway error: " + message
		if errDetail != "" {
			summary += " (" + errDetail + ")"
		}
		c.writeActivity("Log", "high", summary, string(payload), "gateway", "alert", "")
	case "warn", "warning":
		summary := "Gateway warning: " + message
		c.writeActivity("Log", "medium", summary, string(payload), "gateway", "alert", "")
	}
}

// analyzePayloadForErrors performs unified error analysis on any event payload.
// It detects error/warn indicators in the payload and records them as activities.
func (c *GWCollector) analyzePayloadForErrors(event string, payload json.RawMessage) {
	// Skip events that are already handled specifically
	if event == "error" || event == "log" {
		return
	}

	// Try to extract common error fields from payload
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		return
	}

	// Check for error indicators in the payload
	var errorMsg string
	var level string

	// Check common error field names
	for _, key := range []string{"error", "err", "errorMessage", "error_message", "message"} {
		if v, ok := data[key]; ok {
			if s, ok := v.(string); ok && s != "" {
				errorMsg = s
				break
			}
		}
	}

	// Check level/status fields
	for _, key := range []string{"level", "status", "state", "severity"} {
		if v, ok := data[key]; ok {
			if s, ok := v.(string); ok {
				level = strings.ToLower(s)
				break
			}
		}
	}

	// Determine if this is an error/warning based on level or error message presence
	isError := level == "error" || level == "fatal" || level == "panic" || level == "critical"
	isWarn := level == "warn" || level == "warning"

	// If no explicit level but has error message, treat as error
	if errorMsg != "" && !isError && !isWarn {
		isError = true
	}

	if isError && errorMsg != "" {
		summary := fmt.Sprintf("Event error [%s]: %s", event, errorMsg)
		if len(summary) > 200 {
			summary = summary[:200] + "..."
		}
		c.writeActivity("System", "high", summary, string(payload), event, "alert", "")
	} else if isWarn && errorMsg != "" {
		summary := fmt.Sprintf("Event warning [%s]: %s", event, errorMsg)
		if len(summary) > 200 {
			summary = summary[:200] + "..."
		}
		c.writeActivity("System", "medium", summary, string(payload), event, "alert", "")
	}
}

// pollLogs fetches gateway logs via RPC using cursor-based incremental reads,
// analyzes new ERROR/WARN lines, and writes them as activity records so the
// Doctor/Health page can track them.
// On the first call (seedOnly=true), it only records the cursor position without
// writing activities, to avoid flooding the activity table with old entries.
func (c *GWCollector) pollLogs(seedOnly bool) {
	if !c.client.IsConnected() {
		return
	}

	params := map[string]interface{}{"limit": 500}
	if c.logCursor >= 0 {
		params["cursor"] = c.logCursor
	}

	data, err := c.client.RequestWithTimeout("logs.tail", params, 10*time.Second)
	if err != nil {
		return
	}

	var result struct {
		Cursor int      `json:"cursor"`
		Size   int      `json:"size"`
		Lines  []string `json:"lines"`
		Reset  bool     `json:"reset"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return
	}

	// Update cursor for next incremental read.
	if result.Cursor > 0 {
		c.logCursor = result.Cursor
	}

	// On seed run or log rotation, just record cursor and skip analysis.
	if seedOnly {
		return
	}

	// No new lines since last poll.
	if len(result.Lines) == 0 {
		return
	}

	c.logPollCount++
	newErrors := 0
	for _, line := range result.Lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Parse JSON log lines for level detection.
		level, message, component, errDetail := parseLogLevel(line)
		if level == "" {
			continue
		}

		switch level {
		case "error", "fatal", "panic":
			summary := formatGatewayLogSummary("error", component, message, errDetail)
			detail := formatGatewayLogDetail(component, message, errDetail)
			c.writeActivity("Log", "high", summary, detail, "gateway/log", "alert", "")
			newErrors++
		case "warn", "warning":
			summary := formatGatewayLogSummary("warning", component, message, errDetail)
			detail := formatGatewayLogDetail(component, message, errDetail)
			c.writeActivity("Log", "medium", summary, detail, "gateway/log", "alert", "")
			newErrors++
		}
	}

	if newErrors > 0 {
		logger.Monitor.Debug().Int("new_log_errors", newErrors).Msg("log analysis: new error/warn entries recorded")
	}
}

// parseLogLevel extracts level, message, component and error detail from a JSON log line.
// Returns empty level if the line is not a JSON log or is not error/warn.
func parseLogLevel(line string) (level, message, component, errDetail string) {
	if !strings.HasPrefix(line, "{") {
		return "", "", "", ""
	}

	var obj map[string]interface{}
	if err := json.Unmarshal([]byte(line), &obj); err != nil {
		return "", "", "", ""
	}

	// Extract level (tslog _meta format or standard)
	if meta, ok := obj["_meta"].(map[string]interface{}); ok {
		if v, ok := meta["logLevelName"].(string); ok {
			level = strings.ToLower(v)
		}
		if v, ok := meta["name"].(string); ok {
			component = v
		}
	}
	if level == "" {
		if v, ok := obj["level"].(string); ok {
			level = strings.ToLower(v)
		} else if v, ok := obj["level"].(float64); ok {
			if v <= 20 {
				return "", "", "", "" // debug/trace — skip
			} else if v <= 30 {
				return "", "", "", "" // info — skip
			} else if v <= 40 {
				level = "warn"
			} else {
				level = "error"
			}
		}
	}

	// Early exit if not error/warn
	switch level {
	case "error", "fatal", "panic", "warn", "warning":
		// continue
	default:
		return "", "", "", ""
	}

	// Extract message - try standard fields first, then tslog positional args
	if v, ok := obj["msg"].(string); ok && v != "" {
		message = v
	} else if v, ok := obj["message"].(string); ok && v != "" {
		message = v
	} else {
		// tslog format: positional args "0", "1", ... can be strings or objects.
		// Collect string args into message; extract subsystem from object args.
		var msgParts []string
		for i := 0; i < 10; i++ {
			key := fmt.Sprintf("%d", i)
			val, exists := obj[key]
			if !exists {
				break
			}
			switch v := val.(type) {
			case string:
				if v != "" {
					msgParts = append(msgParts, v)
				}
			case map[string]interface{}:
				// Extract subsystem/component from object args
				for _, k := range []string{"subsystem", "module", "component", "name"} {
					if sv, ok := v[k].(string); ok && sv != "" {
						if component == "" {
							component = sv
						}
						break
					}
				}
				// Also look for message/error inside object
				for _, k := range []string{"message", "msg", "error", "reason"} {
					if sv, ok := v[k].(string); ok && sv != "" {
						msgParts = append(msgParts, sv)
						break
					}
				}
			}
		}
		if len(msgParts) > 0 {
			message = strings.Join(msgParts, ": ")
		}
	}

	// Extract component from top-level fields if still empty
	if component == "" {
		for _, key := range []string{"module", "component", "name", "subsystem"} {
			if v, ok := obj[key].(string); ok && v != "" {
				component = v
				break
			}
		}
	}

	// Extract error detail
	for _, key := range []string{"error", "err", "errorMessage", "error_message"} {
		if v, ok := obj[key].(string); ok && v != "" {
			errDetail = v
			break
		}
	}

	if message == "" && errDetail != "" {
		message = errDetail
		errDetail = ""
	}

	return level, message, component, errDetail
}

// formatGatewayLogSummary builds a clean human-readable summary for gateway log events.
func formatGatewayLogSummary(levelLabel, component, message, errDetail string) string {
	var parts []string
	if component != "" {
		parts = append(parts, component)
	}
	if message != "" {
		parts = append(parts, message)
	}
	if errDetail != "" && errDetail != message {
		parts = append(parts, errDetail)
	}
	if len(parts) == 0 {
		parts = append(parts, "unknown "+levelLabel)
	}
	summary := strings.Join(parts, " — ")
	if len(summary) > 250 {
		summary = summary[:250] + "..."
	}
	return summary
}

// formatGatewayLogDetail builds a structured detail string for gateway log events.
func formatGatewayLogDetail(component, message, errDetail string) string {
	var parts []string
	if component != "" {
		parts = append(parts, "component: "+component)
	}
	if message != "" {
		parts = append(parts, "message: "+message)
	}
	if errDetail != "" && errDetail != message {
		parts = append(parts, "error: "+errDetail)
	}
	return strings.Join(parts, "\n")
}
