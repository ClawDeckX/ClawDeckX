package monitor

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/i18n" // 添加 i18n 包导入
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
	}
}

func (c *GWCollector) Start() {
	c.running = true
	logger.Monitor.Info().
		Dur("interval", c.interval).
		Msg(i18n.T(i18n.MsgLogGwCollectorStarted))

	c.client.SetEventHandler(c.handleEvent)

	c.poll()

	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			c.poll()
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
	}
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
		c.writeActivity("Message", "low", fmt.Sprintf("会话回复完成: %s", data.SessionKey), string(payload), "chat", "allow", "")
	case "error":
		summary := "会话回复失败"
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

	summary := fmt.Sprintf("会话 %s: %s", strings.TrimPrefix(event, "session."), data.Key)
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

	summary := fmt.Sprintf("工具调用: %s", toolName)
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

	summary := fmt.Sprintf("Gateway 错误: %s (code=%d)", data.Message, data.Code)
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
	summary := fmt.Sprintf("定时任务 %s: %s", strings.TrimPrefix(event, "cron."), name)
	c.writeActivity("System", "low", summary, string(payload), "cron", "allow", "")
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
				summary := fmt.Sprintf("会话: %s | %d tokens | 模型: %s",
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
				summary := fmt.Sprintf("新会话: %s (%s)", displayName, sess.Model)
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

			summary := fmt.Sprintf("会话活动: %s | +%d tokens (输入 +%d, 输出 +%d) | 模型: %s",
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
