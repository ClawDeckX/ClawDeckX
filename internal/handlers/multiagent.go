package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/llmdirect"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// genTaskStatus represents the lifecycle state of an async generation task.
type genTaskStatus string

const (
	genTaskPending  genTaskStatus = "pending"
	genTaskRunning  genTaskStatus = "running"
	genTaskDone     genTaskStatus = "done"
	genTaskFailed   genTaskStatus = "failed"
	genTaskCanceled genTaskStatus = "canceled"
)

// genTask holds the state of a single async generation job.
type genTask struct {
	ID        string          `json:"id"`
	Status    genTaskStatus   `json:"status"`
	Phase     string          `json:"phase,omitempty"`   // connecting, sending, thinking, parsing, done
	Elapsed   int             `json:"elapsed,omitempty"` // seconds since task started
	Result    *GenerateResult `json:"result,omitempty"`  // set on done
	ErrorCode string          `json:"errorCode,omitempty"`
	ErrorMsg  string          `json:"errorMsg,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
	// internal
	cancelCh chan struct{}
}

// genTaskStore is a simple in-memory store with TTL eviction.
type genTaskStore struct {
	mu    sync.RWMutex
	tasks map[string]*genTask
}

func newGenTaskStore() *genTaskStore {
	s := &genTaskStore{tasks: make(map[string]*genTask)}
	go s.evictLoop()
	return s
}

func (s *genTaskStore) set(t *genTask) {
	s.mu.Lock()
	s.tasks[t.ID] = t
	s.mu.Unlock()
}

func (s *genTaskStore) get(id string) (*genTask, bool) {
	s.mu.RLock()
	t, ok := s.tasks[id]
	s.mu.RUnlock()
	return t, ok
}

// evictLoop removes tasks older than 30 minutes every 5 minutes.
func (s *genTaskStore) evictLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		s.mu.Lock()
		for id, t := range s.tasks {
			if time.Since(t.CreatedAt) > 30*time.Minute {
				delete(s.tasks, id)
			}
		}
		s.mu.Unlock()
	}
}

// MultiAgentHandler handles multi-agent deployment operations.
type MultiAgentHandler struct {
	client     *openclaw.GWClient
	configPath string // full openclaw.json file path for direct LLM calls
	taskStore  *genTaskStore
	wsHub      interface {
		Broadcast(channel, msgType string, data interface{})
	}
}

func NewMultiAgentHandler(client *openclaw.GWClient) *MultiAgentHandler {
	return &MultiAgentHandler{
		client:    client,
		taskStore: newGenTaskStore(),
	}
}

// SetOpenClawConfigPath sets the full openclaw.json file path used for direct LLM calls.
func (h *MultiAgentHandler) SetOpenClawConfigPath(p string) {
	h.configPath = p
}

// SetWSHub injects the WSHub for broadcasting generation progress events.
func (h *MultiAgentHandler) SetWSHub(hub interface {
	Broadcast(channel, msgType string, data interface{})
}) {
	h.wsHub = hub
}

// AgentConfig represents a single agent configuration in a multi-agent template.
type AgentConfig struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Role        string            `json:"role"`
	Description string            `json:"description,omitempty"`
	Icon        string            `json:"icon,omitempty"`
	Color       string            `json:"color,omitempty"`
	Soul        string            `json:"soul,omitempty"`
	AgentsMd    string            `json:"agentsMd,omitempty"`   // AGENTS.md workspace startup instructions
	UserMd      string            `json:"userMd,omitempty"`     // USER.md profile of the user this agent serves
	IdentityMd  string            `json:"identityMd,omitempty"` // IDENTITY.md agent name/creature/vibe/emoji
	Heartbeat   string            `json:"heartbeat,omitempty"`
	Tools       string            `json:"tools,omitempty"`
	Skills      []string          `json:"skills,omitempty"`
	Env         map[string]string `json:"env,omitempty"`
}

// WorkflowStep represents a step in the multi-agent workflow.
type WorkflowStep struct {
	Agent     string   `json:"agent,omitempty"`
	Agents    []string `json:"agents,omitempty"`
	Action    string   `json:"action"`
	Parallel  bool     `json:"parallel,omitempty"`
	Condition string   `json:"condition,omitempty"`
	Timeout   int      `json:"timeout,omitempty"` // seconds
}

// WorkflowConfig represents the workflow configuration.
type WorkflowConfig struct {
	Type        string         `json:"type"` // sequential, parallel, collaborative, event-driven, routing
	Description string         `json:"description,omitempty"`
	Steps       []WorkflowStep `json:"steps"`
}

// BindingConfig represents routing bindings between agents and channels.
type BindingConfig struct {
	AgentID string                 `json:"agentId"`
	Match   map[string]interface{} `json:"match"`
}

// MultiAgentTemplate represents a complete multi-agent deployment template.
type MultiAgentTemplate struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Agents      []AgentConfig   `json:"agents"`
	Workflow    WorkflowConfig  `json:"workflow"`
	Bindings    []BindingConfig `json:"bindings,omitempty"`
}

// DeployRequest represents a multi-agent deployment request.
type DeployRequest struct {
	Template     MultiAgentTemplate `json:"template"`
	Prefix       string             `json:"prefix,omitempty"`       // Prefix for agent IDs
	SkipExisting bool               `json:"skipExisting,omitempty"` // Skip if agent already exists
	DryRun       bool               `json:"dryRun,omitempty"`       // Preview only, don't create
}

// DeployResult represents the result of a multi-agent deployment.
type DeployResult struct {
	Success            bool                `json:"success"`
	DeployedCount      int                 `json:"deployedCount"`
	SkippedCount       int                 `json:"skippedCount"`
	Agents             []AgentDeployStatus `json:"agents"`
	Bindings           []BindingStatus     `json:"bindings,omitempty"`
	Errors             []string            `json:"errors,omitempty"`
	CoordinatorUpdated bool                `json:"coordinatorUpdated"`
	CoordinatorError   string              `json:"coordinatorError,omitempty"`
}

// AgentDeployStatus represents the deployment status of a single agent.
type AgentDeployStatus struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Status    string `json:"status"` // created, skipped, failed
	Workspace string `json:"workspace,omitempty"`
	Error     string `json:"error,omitempty"`
}

// BindingStatus represents the status of a binding configuration.
type BindingStatus struct {
	AgentID string `json:"agentId"`
	Status  string `json:"status"` // configured, failed
	Error   string `json:"error,omitempty"`
}

// GenerateRequest represents a request to generate a multi-agent team from a scenario description.
type GenerateRequest struct {
	ScenarioName string `json:"scenarioName"`
	Description  string `json:"description"`
	TeamSize     string `json:"teamSize"`     // small (3-4), medium (5-7), large (8+)
	WorkflowType string `json:"workflowType"` // sequential, parallel, collaborative, event-driven, routing
	Language     string `json:"language"`
	ModelID      string `json:"modelId"`   // optional: provider/model path override
	DirectLLM    bool   `json:"directLlm"` // when true, bypass agent session and call LLM directly
}

// GenerateResult represents the AI-generated multi-agent team definition.
type GenerateResult struct {
	Template  MultiAgentTemplate `json:"template"`
	Reasoning string             `json:"reasoning"`
}

func multiAgentCountHint(teamSize string) string {
	switch teamSize {
	case "single":
		return "exactly 1"
	case "small":
		return "2 to 3"
	case "large":
		return "7 to 10"
	default:
		return "4 to 6"
	}
}

func normalizeGeneratedTemplateForRequest(result *GenerateResult, req GenerateRequest) {
	if req.TeamSize != "single" {
		return
	}
	if len(result.Template.Agents) > 1 {
		result.Template.Agents = result.Template.Agents[:1]
	}
	agentID := ""
	if len(result.Template.Agents) == 1 {
		agentID = result.Template.Agents[0].ID
	}
	result.Template.Workflow.Type = "standalone"
	result.Template.Workflow.Description = "Standalone single-agent execution"
	result.Template.Workflow.Steps = []WorkflowStep{{
		Agent:  agentID,
		Action: "Handle the user task independently and produce the result",
	}}
}

// Generate uses the connected LLM to analyze a scenario and generate a multi-agent team definition.
func (h *MultiAgentHandler) Generate(w http.ResponseWriter, r *http.Request) {
	var req GenerateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.Fail(w, r, "INVALID_REQUEST", fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	if req.ScenarioName == "" || req.Description == "" {
		web.Fail(w, r, "INVALID_REQUEST", "scenarioName and description are required", http.StatusBadRequest)
		return
	}

	if req.TeamSize == "" {
		req.TeamSize = "medium"
	}
	if req.WorkflowType == "" {
		req.WorkflowType = "collaborative"
	}
	if req.Language == "" {
		req.Language = "en"
	}

	agentCountHint := multiAgentCountHint(req.TeamSize)

	langHint := "English"
	if req.Language == "zh" || req.Language == "zh-TW" {
		langHint = "Chinese"
	} else if req.Language == "ja" {
		langHint = "Japanese"
	} else if req.Language == "ko" {
		langHint = "Korean"
	}

	prompt := fmt.Sprintf(`You are an AI system architect. Analyze the following scenario and generate a multi-agent team configuration in strict JSON format.

Scenario Name: %s
Scenario Description: %s
Team Size: %s agents
Workflow Type: %s
Output Language for agent names/roles/descriptions: %s

Requirements:
1. Generate %s specialized AI agents appropriate for this scenario
2. Each agent should have a distinct role with clear responsibilities
3. Design a workflow that shows how agents collaborate
4. Generate detailed SOUL.md content for each agent (their persona, responsibilities, working style)
5. Generate AGENTS.md content for each agent (workspace startup instructions: which files to read, memory rules, red lines, group chat rules, heartbeat behavior — tailored to this agent's role)
6. Generate USER.md content for each agent (profile of the human/team member this agent primarily serves — name placeholder, context about what this role needs from the user, preferences)
7. Generate IDENTITY.md content for each agent (Name, Creature, Vibe, Emoji fields — fit the agent's personality)
8. Generate HEARTBEAT.md checklist items for each agent
9. Use lowercase kebab-case for agent IDs (e.g., "project-manager", "backend-dev")
10. Choose appropriate Material Symbols icon names for each agent
11. Choose appropriate Tailwind color classes (e.g., "from-blue-500 to-cyan-500")

Respond ONLY with a JSON object in this exact structure (no markdown, no explanation outside JSON):
{
  "reasoning": "Brief explanation of why you chose these agents and this workflow",
  "template": {
    "id": "kebab-case-id-based-on-scenario-name",
    "name": "Human-readable team name",
    "description": "Team purpose description",
    "agents": [
      {
        "id": "agent-id",
        "name": "Agent Display Name",
        "role": "One-line role description",
        "description": "Detailed description of agent responsibilities",
        "icon": "material_symbol_name",
        "color": "from-blue-500 to-cyan-500",
        "soul": "Full SOUL.md content in markdown — persona, responsibilities, working style",
        "agentsMd": "Full AGENTS.md content — workspace startup instructions tailored to this agent",
        "userMd": "Full USER.md content — profile template for the human this agent serves",
        "identityMd": "Full IDENTITY.md content — Name/Creature/Vibe/Emoji for this agent",
        "heartbeat": "- [ ] Task 1\n- [ ] Task 2"
      }
    ],
    "workflow": {
      "type": "%s",
      "description": "How agents collaborate",
      "steps": [
        {
          "agent": "agent-id",
          "action": "What this agent does in this step"
        }
      ]
    }
  }
}`, req.ScenarioName, req.Description, agentCountHint, req.WorkflowType, langHint, agentCountHint, req.WorkflowType)

	// Pre-flight: fail fast if gateway is not connected rather than waiting for a 600s timeout.
	if !h.client.IsConnected() {
		web.Fail(w, r, "GATEWAY_DISCONNECTED", "gateway is not connected", http.StatusServiceUnavailable)
		return
	}

	// Call the main agent via sessions.send to generate the team definition
	// First create a temporary session for generation
	sessionParams := map[string]interface{}{
		"agentId": "main",
		"label":   fmt.Sprintf("__gen_team_%d", time.Now().UnixNano()),
	}
	if req.ModelID != "" {
		sessionParams["model"] = req.ModelID
	}

	sessionData, err := h.client.RequestWithTimeout("sessions.create", sessionParams, 10*time.Second)
	if err != nil {
		web.Fail(w, r, "SESSION_CREATE_FAILED", fmt.Sprintf("failed to create generation session: %v", err), http.StatusBadGateway)
		return
	}

	var sessionResp struct {
		SessionKey string `json:"sessionKey"`
		Key        string `json:"key"`
	}
	if err := json.Unmarshal(sessionData, &sessionResp); err != nil {
		web.Fail(w, r, "SESSION_PARSE_FAILED", "failed to parse session response", http.StatusBadGateway)
		return
	}
	sessionKey := sessionResp.SessionKey
	if sessionKey == "" {
		sessionKey = sessionResp.Key
	}
	if sessionKey == "" {
		web.Fail(w, r, "SESSION_KEY_MISSING", "no session key returned", http.StatusBadGateway)
		return
	}

	// Send the generation prompt, broadcasting keepalive progress while waiting.
	sendParams := h.client.SessionSendParams(sessionKey, prompt)

	// Keepalive: broadcast gen_progress so the frontend can subscribe to chat delta events
	// using the sessionKey, and track elapsed time server-side.
	type genProgressPayload struct {
		RequestID  string `json:"requestId"`
		SessionKey string `json:"sessionKey"`
		Elapsed    int    `json:"elapsed"`
		Phase      string `json:"phase"`
		ErrorCode  string `json:"errorCode,omitempty"`
		ErrorMsg   string `json:"errorMsg,omitempty"`
	}
	requestID := fmt.Sprintf("%d", time.Now().UnixNano())
	progDone := make(chan struct{})
	progStart := time.Now()
	if h.wsHub != nil {
		// Broadcast immediately so frontend gets the sessionKey before the first 5s tick
		h.wsHub.Broadcast("gw_event", "gen_progress", genProgressPayload{
			RequestID:  requestID,
			SessionKey: sessionKey,
			Elapsed:    0,
			Phase:      "thinking",
		})
		go func() {
			ticker := time.NewTicker(5 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-progDone:
					return
				case <-ticker.C:
					elapsed := int(time.Since(progStart).Seconds())
					h.wsHub.Broadcast("gw_event", "gen_progress", genProgressPayload{
						RequestID:  requestID,
						SessionKey: sessionKey,
						Elapsed:    elapsed,
						Phase:      "thinking",
					})
				}
			}
		}()
	}

	msgData, err := h.client.RequestWithTimeout("sessions.send", sendParams, 600*time.Second)
	close(progDone)
	if h.wsHub != nil {
		// Signal completion/failure so frontend can stop waiting
		prog := genProgressPayload{
			RequestID:  requestID,
			SessionKey: sessionKey,
			Elapsed:    int(time.Since(progStart).Seconds()),
			Phase:      "done",
		}
		if err != nil {
			prog.Phase = "error"
			errStr := err.Error()
			switch {
			case strings.Contains(errStr, "not connected") ||
				strings.Contains(errStr, "connection closed") ||
				strings.Contains(errStr, "use of closed") ||
				strings.Contains(errStr, "broken pipe") ||
				strings.Contains(errStr, "EOF"):
				prog.ErrorCode = "GATEWAY_DISCONNECTED"
				prog.ErrorMsg = "Gateway connection lost during generation"
			case strings.Contains(errStr, "timeout") ||
				strings.Contains(errStr, "deadline") ||
				strings.Contains(errStr, "timed out"):
				prog.ErrorCode = "TIMEOUT"
				prog.ErrorMsg = "Generation timed out"
			default:
				prog.ErrorCode = "LLM_SEND_FAILED"
				prog.ErrorMsg = errStr
			}
		}
		h.wsHub.Broadcast("gw_event", "gen_progress", prog)
	}
	if err != nil {
		web.Fail(w, r, "LLM_SEND_FAILED", fmt.Sprintf("failed to send generation request: %v", err), http.StatusBadGateway)
		return
	}

	// Clean up the generation session asynchronously
	go func() {
		h.client.Request("sessions.delete", map[string]interface{}{"key": sessionKey, "deleteTranscript": true}) //nolint:errcheck
	}()

	// Parse the LLM response
	var msgResp struct {
		Content string `json:"content"`
		Text    string `json:"text"`
		Message struct {
			Content string `json:"content"`
			Text    string `json:"text"`
		} `json:"message"`
	}
	if err := json.Unmarshal(msgData, &msgResp); err != nil {
		web.Fail(w, r, "LLM_PARSE_FAILED", "failed to parse LLM response", http.StatusBadGateway)
		return
	}

	rawContent := msgResp.Content
	if rawContent == "" {
		rawContent = msgResp.Text
	}
	if rawContent == "" {
		rawContent = msgResp.Message.Content
	}
	if rawContent == "" {
		rawContent = msgResp.Message.Text
	}

	if rawContent == "" {
		web.Fail(w, r, "LLM_EMPTY_RESPONSE", "LLM returned empty response", http.StatusBadGateway)
		return
	}

	// Extract JSON from response (handle cases where LLM wraps it in markdown)
	jsonStr := extractJSON(rawContent)
	if jsonStr == "" {
		web.Fail(w, r, "LLM_NO_JSON", "could not extract JSON from LLM response", http.StatusBadGateway)
		return
	}

	var result GenerateResult
	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil {
		web.Fail(w, r, "LLM_JSON_INVALID", fmt.Sprintf("LLM returned invalid JSON: %v", err), http.StatusBadGateway)
		return
	}

	// Validate and sanitize the generated template
	if len(result.Template.Agents) == 0 {
		web.Fail(w, r, "LLM_NO_AGENTS", "LLM generated no agents", http.StatusBadGateway)
		return
	}

	// Ensure template has required fields
	if result.Template.ID == "" {
		result.Template.ID = sanitizeID(req.ScenarioName)
	}
	if result.Template.Name == "" {
		result.Template.Name = req.ScenarioName
	}
	if result.Template.Description == "" {
		result.Template.Description = req.Description
	}
	normalizeGeneratedTemplateForRequest(&result, req)

	web.OK(w, r, result)
}

// GenerateAsync submits a generation job and returns a taskId immediately.
// The actual generation runs in a background goroutine and pushes WS events
// of type "gen_task" on the "gw_event" channel with fields:
//
//	{ taskId, status, phase, elapsed, result?, errorCode?, errorMsg? }
func (h *MultiAgentHandler) GenerateAsync(w http.ResponseWriter, r *http.Request) {
	var req GenerateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.Fail(w, r, "INVALID_REQUEST", fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
		return
	}
	if req.ScenarioName == "" || req.Description == "" {
		web.Fail(w, r, "INVALID_REQUEST", "scenarioName and description are required", http.StatusBadRequest)
		return
	}
	if !h.client.IsConnected() {
		web.Fail(w, r, "GATEWAY_DISCONNECTED", "gateway is not connected", http.StatusServiceUnavailable)
		return
	}

	taskID := fmt.Sprintf("gen-%d", time.Now().UnixNano())
	task := &genTask{
		ID:        taskID,
		Status:    genTaskPending,
		Phase:     "connecting",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		cancelCh:  make(chan struct{}),
	}
	h.taskStore.set(task)

	// Respond immediately with the taskId so the frontend can minimize.
	web.OK(w, r, map[string]string{"taskId": taskID})

	// Run generation in background.
	go h.runGenerateTask(task, req)
}

// runGenerateTask executes the AI generation for a task and broadcasts WS events.
func (h *MultiAgentHandler) runGenerateTask(task *genTask, req GenerateRequest) {
	broadcast := func(status genTaskStatus, phase string, elapsed int, result *GenerateResult, errCode, errMsg string) {
		task.Status = status
		task.Phase = phase
		task.Elapsed = elapsed
		task.UpdatedAt = time.Now()
		if result != nil {
			task.Result = result
		}
		if errCode != "" {
			task.ErrorCode = errCode
			task.ErrorMsg = errMsg
		}
		if h.wsHub != nil {
			h.wsHub.Broadcast("gw_event", "gen_task", map[string]interface{}{
				"taskId":    task.ID,
				"status":    string(status),
				"phase":     phase,
				"elapsed":   elapsed,
				"result":    result,
				"errorCode": errCode,
				"errorMsg":  errMsg,
			})
		}
	}

	// Defaults
	if req.TeamSize == "" {
		req.TeamSize = "medium"
	}
	if req.WorkflowType == "" {
		req.WorkflowType = "collaborative"
	}
	if req.Language == "" {
		req.Language = "en"
	}

	broadcast(genTaskRunning, "connecting", 0, nil, "", "")
	start := time.Now()

	elapsed := func() int { return int(time.Since(start).Seconds()) }

	agentCountHint := multiAgentCountHint(req.TeamSize)
	langHint := "English"
	if req.Language == "zh" || req.Language == "zh-TW" {
		langHint = "Chinese"
	} else if req.Language == "ja" {
		langHint = "Japanese"
	} else if req.Language == "ko" {
		langHint = "Korean"
	}

	// Keep prompt compact to stay within max_tokens limits.
	// soul/agentsMd/userMd are capped at 3-4 sentences; identityMd is one line.
	prompt := fmt.Sprintf(`You are an AI system architect. Generate a multi-agent team for the scenario below. Output ONLY valid JSON — no markdown fences, no text outside the JSON.

Scenario: %s
Description: %s
Team size: %s agents
Workflow: %s
Language for names/roles/descriptions: %s

Rules:
- id: lowercase kebab-case
- icon: Material Symbols name
- color: Tailwind gradient e.g. "from-blue-500 to-cyan-500"
- soul: 3-4 sentences — persona, key responsibilities, working style
- agentsMd: 3-4 sentences — workspace startup instructions for this agent
- userMd: 2-3 sentences — profile of the human this agent primarily serves
- identityMd: one line "Name: X | Creature: X | Vibe: X | Emoji: X"
- heartbeat: exactly 3 items "- [ ] ..."
- reasoning: 2 sentences max
- workflow: one step per agent

Output %s agents. JSON schema:
{"reasoning":"...","template":{"id":"...","name":"...","description":"...","agents":[{"id":"...","name":"...","role":"...","description":"...","icon":"...","color":"...","soul":"...","agentsMd":"...","userMd":"...","identityMd":"...","heartbeat":"- [ ] ...\n- [ ] ...\n- [ ] ..."}],"workflow":{"type":"%s","description":"...","steps":[{"agent":"...","action":"..."}]}}}`,
		req.ScenarioName, req.Description, agentCountHint, req.WorkflowType, langHint, agentCountHint, req.WorkflowType)

	broadcast(genTaskRunning, "sending", elapsed(), nil, "", "")

	var rawContent string

	if req.DirectLLM {
		// ── Direct LLM path (two-step) ─────────────────────────────────────────
		// Step 1: core structure only (small output, always completes within token limit).
		// Step 2: per-agent markdown enrichment via individual non-streaming calls.
		providerCfg, err := llmdirect.ResolveProvider(h.configPath, req.ModelID)
		if err != nil {
			broadcast(genTaskFailed, "error", elapsed(), nil, "LLM_PROVIDER_FAILED", err.Error())
			return
		}

		ctx, cancelCtx := context.WithTimeout(context.Background(), 600*time.Second)
		defer cancelCtx()
		go func() {
			select {
			case <-task.cancelCh:
				cancelCtx()
			case <-ctx.Done():
			}
		}()

		// ── Step 1: core structure ──────────────────────────────────────────────
		broadcast(genTaskRunning, "thinking", elapsed(), nil, "", "")

		step1Prompt := fmt.Sprintf(
			"Output ONLY valid JSON, no markdown.\n\nScenario: %s\nDescription: %s\nAgents: %s\nWorkflow: %s\nLanguage: %s\n\nFor each agent: id (kebab-case), name, role (≤8 words), description (≤20 words), icon (Material Symbol), color (Tailwind gradient e.g. from-blue-500 to-cyan-500). reasoning: ≤15 words. workflow: one step per agent.\n\n{\"reasoning\":\"\",\"template\":{\"id\":\"\",\"name\":\"\",\"description\":\"\",\"agents\":[{\"id\":\"\",\"name\":\"\",\"role\":\"\",\"description\":\"\",\"icon\":\"\",\"color\":\"\"}],\"workflow\":{\"type\":\"%s\",\"description\":\"\",\"steps\":[{\"agent\":\"\",\"action\":\"\"}]}}}",
			req.ScenarioName, req.Description, agentCountHint, req.WorkflowType, langHint, req.WorkflowType,
		)

		var step1Buf strings.Builder
		tokenCount := 0
		lastProgress := time.Now()

		for chunk := range llmdirect.StreamCompletion(ctx, providerCfg, []llmdirect.Message{{Role: "user", Content: step1Prompt}}, 2048) {
			if chunk.Error != nil {
				errMsg := chunk.Error.Error()
				errCode := "LLM_STREAM_FAILED"
				if strings.Contains(errMsg, "context canceled") || strings.Contains(errMsg, "context deadline") {
					errCode = "TIMEOUT"
					errMsg = "Generation timed out or was canceled"
				}
				broadcast(genTaskFailed, "error", elapsed(), nil, errCode, errMsg)
				return
			}
			if chunk.Done {
				break
			}
			step1Buf.WriteString(chunk.Token)
			tokenCount++
			if tokenCount%50 == 0 || time.Since(lastProgress) > 2*time.Second {
				lastProgress = time.Now()
				if h.wsHub != nil {
					h.wsHub.Broadcast("gw_event", "gen_task", map[string]interface{}{
						"taskId":      task.ID,
						"status":      string(genTaskRunning),
						"phase":       "thinking",
						"elapsed":     elapsed(),
						"streamToken": chunk.Token,
					})
				}
			}
		}

		step1Raw := strings.TrimSpace(step1Buf.String())
		// Strip markdown fences if model wraps in ```json ... ```
		if strings.HasPrefix(step1Raw, "```") {
			if nl := strings.Index(step1Raw, "\n"); nl > 0 {
				step1Raw = step1Raw[nl+1:]
			}
			if end := strings.LastIndex(step1Raw, "```"); end > 0 {
				step1Raw = step1Raw[:end]
			}
			step1Raw = strings.TrimSpace(step1Raw)
		}

		// Parse Step 1 result into the shared GenerateResult structure
		var step1Result struct {
			Reasoning string `json:"reasoning"`
			Template  struct {
				ID          string `json:"id"`
				Name        string `json:"name"`
				Description string `json:"description"`
				Agents      []struct {
					ID          string `json:"id"`
					Name        string `json:"name"`
					Role        string `json:"role"`
					Description string `json:"description"`
					Icon        string `json:"icon"`
					Color       string `json:"color"`
				} `json:"agents"`
				Workflow struct {
					Type        string `json:"type"`
					Description string `json:"description"`
					Steps       []struct {
						Agent  string `json:"agent"`
						Action string `json:"action"`
					} `json:"steps"`
				} `json:"workflow"`
			} `json:"template"`
		}
		if err := json.Unmarshal([]byte(step1Raw), &step1Result); err != nil {
			broadcast(genTaskFailed, "error", elapsed(), nil, "LLM_PARSE_FAILED",
				fmt.Sprintf("step1 JSON parse failed: %v", err))
			return
		}

		// ── Step 2: per-agent markdown enrichment (non-streaming) ──────────────
		broadcast(genTaskRunning, "parsing", elapsed(), nil, "", "")

		type agentMarkdown struct {
			Soul       string `json:"soul"`
			AgentsMd   string `json:"agentsMd"`
			UserMd     string `json:"userMd"`
			IdentityMd string `json:"identityMd"`
			Heartbeat  string `json:"heartbeat"`
		}
		agentExtras := make(map[string]agentMarkdown, len(step1Result.Template.Agents))

		for i, ag := range step1Result.Template.Agents {
			select {
			case <-ctx.Done():
				broadcast(genTaskFailed, "error", elapsed(), nil, "CANCELED", "generation canceled")
				return
			default:
			}

			enrichPrompt := fmt.Sprintf(
				"Output ONLY valid JSON, no markdown.\n\nGenerate workspace files for AI agent:\nName: %s\nRole: %s\nDescription: %s\nScenario: %s\nLanguage: %s\n\nFields:\n- soul: 3 sentences (persona, responsibilities, working style)\n- agentsMd: 2 sentences (workspace startup instructions)\n- userMd: 1 sentence (profile of the human this agent serves)\n- identityMd: \"Name: X | Creature: X | Vibe: X | Emoji: X\"\n- heartbeat: \"- [ ] item1\\n- [ ] item2\\n- [ ] item3\"\n\n{\"soul\":\"\",\"agentsMd\":\"\",\"userMd\":\"\",\"identityMd\":\"\",\"heartbeat\":\"\"}",
				ag.Name, ag.Role, ag.Description, req.ScenarioName, langHint,
			)

			enrichText, err := llmdirect.CompleteNonStream(ctx, providerCfg,
				[]llmdirect.Message{{Role: "user", Content: enrichPrompt}}, 1024)
			if err != nil {
				// Non-fatal: use empty values if enrichment fails
				logger.Log.Warn().Str("agentId", ag.ID).Err(err).Msg("llmdirect enrichment failed")
				agentExtras[ag.ID] = agentMarkdown{}
				continue
			}

			enrichText = strings.TrimSpace(enrichText)
			if strings.HasPrefix(enrichText, "```") {
				if nl := strings.Index(enrichText, "\n"); nl > 0 {
					enrichText = enrichText[nl+1:]
				}
				if end := strings.LastIndex(enrichText, "```"); end > 0 {
					enrichText = enrichText[:end]
				}
				enrichText = strings.TrimSpace(enrichText)
			}

			var extra agentMarkdown
			if err := json.Unmarshal([]byte(enrichText), &extra); err != nil {
				logger.Log.Warn().Str("agentId", ag.ID).Err(err).Msg("llmdirect enrichment parse failed")
			} else {
				agentExtras[ag.ID] = extra
			}

			// Push progress after each agent enrichment
			if h.wsHub != nil {
				h.wsHub.Broadcast("gw_event", "gen_task", map[string]interface{}{
					"taskId":   task.ID,
					"status":   string(genTaskRunning),
					"phase":    "parsing",
					"elapsed":  elapsed(),
					"progress": fmt.Sprintf("%d/%d", i+1, len(step1Result.Template.Agents)),
				})
			}
		}

		// ── Merge Step 1 + Step 2 into final JSON ──────────────────────────────
		type mergedAgent struct {
			ID          string `json:"id"`
			Name        string `json:"name"`
			Role        string `json:"role"`
			Description string `json:"description"`
			Icon        string `json:"icon"`
			Color       string `json:"color"`
			Soul        string `json:"soul"`
			AgentsMd    string `json:"agentsMd"`
			UserMd      string `json:"userMd"`
			IdentityMd  string `json:"identityMd"`
			Heartbeat   string `json:"heartbeat"`
		}
		mergedAgents := make([]mergedAgent, 0, len(step1Result.Template.Agents))
		for _, ag := range step1Result.Template.Agents {
			ex := agentExtras[ag.ID]
			mergedAgents = append(mergedAgents, mergedAgent{
				ID: ag.ID, Name: ag.Name, Role: ag.Role,
				Description: ag.Description, Icon: ag.Icon, Color: ag.Color,
				Soul: ex.Soul, AgentsMd: ex.AgentsMd, UserMd: ex.UserMd,
				IdentityMd: ex.IdentityMd, Heartbeat: ex.Heartbeat,
			})
		}
		merged := map[string]interface{}{
			"reasoning": step1Result.Reasoning,
			"template": map[string]interface{}{
				"id":          step1Result.Template.ID,
				"name":        step1Result.Template.Name,
				"description": step1Result.Template.Description,
				"agents":      mergedAgents,
				"workflow":    step1Result.Template.Workflow,
			},
		}
		mergedBytes, err := json.Marshal(merged)
		if err != nil {
			broadcast(genTaskFailed, "error", elapsed(), nil, "MERGE_FAILED", err.Error())
			return
		}
		rawContent = string(mergedBytes)

	} else {
		// ── Agent session path (default): route through OpenClaw gateway ─────────
		// Uses sessions.create + sessions.send; the agent may use tools but
		// should respect the "Respond ONLY with JSON" instruction in the prompt.
		sessionParams := map[string]interface{}{
			"agentId": "main",
			"label":   fmt.Sprintf("__gen_team_%s", task.ID),
		}
		if req.ModelID != "" {
			sessionParams["model"] = req.ModelID
		}
		sessionData, err := h.client.RequestWithTimeout("sessions.create", sessionParams, 10*time.Second)
		if err != nil {
			broadcast(genTaskFailed, "error", elapsed(), nil, "SESSION_CREATE_FAILED", err.Error())
			return
		}
		var sessionResp struct {
			SessionKey string `json:"sessionKey"`
			Key        string `json:"key"`
		}
		if err := json.Unmarshal(sessionData, &sessionResp); err != nil {
			broadcast(genTaskFailed, "error", elapsed(), nil, "SESSION_PARSE_FAILED", "failed to parse session response")
			return
		}
		sessionKey := sessionResp.SessionKey
		if sessionKey == "" {
			sessionKey = sessionResp.Key
		}
		if sessionKey == "" {
			broadcast(genTaskFailed, "error", elapsed(), nil, "SESSION_KEY_MISSING", "no session key returned")
			return
		}

		broadcast(genTaskRunning, "thinking", elapsed(), nil, "", "")
		if h.wsHub != nil {
			h.wsHub.Broadcast("gw_event", "gen_task", map[string]interface{}{
				"taskId":     task.ID,
				"status":     string(genTaskRunning),
				"phase":      "thinking",
				"elapsed":    elapsed(),
				"sessionKey": sessionKey,
			})
		}

		// Keepalive ticker: push progress every 5s.
		progDone := make(chan struct{})
		go func() {
			ticker := time.NewTicker(5 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-progDone:
					return
				case <-task.cancelCh:
					return
				case <-ticker.C:
					if h.wsHub != nil {
						h.wsHub.Broadcast("gw_event", "gen_task", map[string]interface{}{
							"taskId":  task.ID,
							"status":  string(genTaskRunning),
							"phase":   "thinking",
							"elapsed": elapsed(),
						})
					}
				}
			}
		}()

		msgData, err := h.client.RequestWithTimeout("sessions.send", h.client.SessionSendParams(sessionKey, prompt), 600*time.Second)
		close(progDone)
		go func() {
			h.client.Request("sessions.delete", map[string]interface{}{"key": sessionKey, "deleteTranscript": true}) //nolint:errcheck
		}()

		if err != nil {
			errCode := "LLM_SEND_FAILED"
			errMsg := err.Error()
			switch {
			case strings.Contains(errMsg, "not connected") ||
				strings.Contains(errMsg, "connection closed") ||
				strings.Contains(errMsg, "use of closed") ||
				strings.Contains(errMsg, "broken pipe") ||
				strings.Contains(errMsg, "EOF"):
				errCode = "GATEWAY_DISCONNECTED"
				errMsg = "Gateway connection lost during generation"
			case strings.Contains(errMsg, "timeout") ||
				strings.Contains(errMsg, "deadline") ||
				strings.Contains(errMsg, "timed out"):
				errCode = "TIMEOUT"
				errMsg = "Generation timed out"
			}
			broadcast(genTaskFailed, "error", elapsed(), nil, errCode, errMsg)
			return
		}

		// Extract text from agent session response envelope.
		var msgResp struct {
			Content string `json:"content"`
			Text    string `json:"text"`
			Message struct {
				Content string `json:"content"`
				Text    string `json:"text"`
			} `json:"message"`
		}
		if err := json.Unmarshal(msgData, &msgResp); err != nil {
			broadcast(genTaskFailed, "error", elapsed(), nil, "LLM_PARSE_FAILED", "failed to parse LLM response")
			return
		}
		rawContent = msgResp.Content
		if rawContent == "" {
			rawContent = msgResp.Text
		}
		if rawContent == "" {
			rawContent = msgResp.Message.Content
		}
		if rawContent == "" {
			rawContent = msgResp.Message.Text
		}
	}

	broadcast(genTaskRunning, "parsing", elapsed(), nil, "", "")

	if rawContent == "" {
		broadcast(genTaskFailed, "error", elapsed(), nil, "LLM_EMPTY_RESPONSE", "LLM returned empty response")
		return
	}

	jsonStr := extractJSON(rawContent)
	if jsonStr == "" {
		broadcast(genTaskFailed, "error", elapsed(), nil, "LLM_NO_JSON", "could not extract JSON from LLM response")
		return
	}

	var result GenerateResult
	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil {
		broadcast(genTaskFailed, "error", elapsed(), nil, "LLM_JSON_INVALID", fmt.Sprintf("LLM returned invalid JSON: %v", err))
		return
	}
	if len(result.Template.Agents) == 0 {
		broadcast(genTaskFailed, "error", elapsed(), nil, "LLM_NO_AGENTS", "LLM generated no agents")
		return
	}
	if result.Template.ID == "" {
		result.Template.ID = sanitizeID(req.ScenarioName)
	}
	if result.Template.Name == "" {
		result.Template.Name = req.ScenarioName
	}
	if result.Template.Description == "" {
		result.Template.Description = req.Description
	}
	normalizeGeneratedTemplateForRequest(&result, req)

	broadcast(genTaskDone, "done", elapsed(), &result, "", "")
	logger.Log.Info().Str("taskId", task.ID).Int("agents", len(result.Template.Agents)).Msg("async team generation completed")
}

// GetGenerateTask returns the current status and (if done) result of an async generation task.
func (h *MultiAgentHandler) GetGenerateTask(w http.ResponseWriter, r *http.Request) {
	taskID := r.URL.Query().Get("taskId")
	if taskID == "" {
		web.Fail(w, r, "MISSING_TASK_ID", "taskId query param required", http.StatusBadRequest)
		return
	}
	task, ok := h.taskStore.get(taskID)
	if !ok {
		web.Fail(w, r, "TASK_NOT_FOUND", "task not found or expired", http.StatusNotFound)
		return
	}
	web.OK(w, r, task)
}

// CancelGenerateTask cancels a running generation task.
func (h *MultiAgentHandler) CancelGenerateTask(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TaskID string `json:"taskId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TaskID == "" {
		web.Fail(w, r, "MISSING_TASK_ID", "taskId required", http.StatusBadRequest)
		return
	}
	task, ok := h.taskStore.get(req.TaskID)
	if !ok {
		web.Fail(w, r, "TASK_NOT_FOUND", "task not found or expired", http.StatusNotFound)
		return
	}
	if task.Status == genTaskRunning || task.Status == genTaskPending {
		select {
		case <-task.cancelCh: // already closed
		default:
			close(task.cancelCh)
		}
		task.Status = genTaskCanceled
		task.UpdatedAt = time.Now()
	}
	web.OK(w, r, map[string]string{"taskId": task.ID, "status": string(task.Status)})
}

// extractJSON extracts a JSON object from a string that may contain markdown code fences or extra text.
func extractJSON(s string) string {
	// Try direct parse first
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "{") {
		return s
	}

	// Strip markdown code fences
	for _, fence := range []string{"```json", "```JSON", "```"} {
		if idx := strings.Index(s, fence); idx >= 0 {
			s = s[idx+len(fence):]
			if end := strings.LastIndex(s, "```"); end >= 0 {
				s = s[:end]
			}
			s = strings.TrimSpace(s)
			if strings.HasPrefix(s, "{") {
				return s
			}
		}
	}

	// Find first { to last }
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start >= 0 && end > start {
		return s[start : end+1]
	}

	return ""
}

// sanitizeID converts a string to a valid kebab-case ID.
func sanitizeID(s string) string {
	s = strings.ToLower(s)
	var result strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			result.WriteRune(r)
		} else if r == ' ' || r == '-' || r == '_' {
			result.WriteRune('-')
		}
	}
	id := strings.Trim(result.String(), "-")
	if id == "" {
		return "custom-team"
	}
	return id
}

// Deploy handles the multi-agent deployment request.
func (h *MultiAgentHandler) Deploy(w http.ResponseWriter, r *http.Request) {
	var req DeployRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.Fail(w, r, "INVALID_REQUEST", fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	// Execute deployment logic
	h.executeDeploy(w, r, &req)
}

// Preview returns a preview of what would be deployed.
func (h *MultiAgentHandler) Preview(w http.ResponseWriter, r *http.Request) {
	var req DeployRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.Fail(w, r, "INVALID_REQUEST", fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	// Force dry run for preview
	req.DryRun = true

	// Execute deployment logic
	h.executeDeploy(w, r, &req)
}

// executeDeploy contains the main deployment logic
func (h *MultiAgentHandler) executeDeploy(w http.ResponseWriter, r *http.Request, req *DeployRequest) {
	if len(req.Template.Agents) == 0 {
		web.Fail(w, r, "INVALID_TEMPLATE", "template must have at least one agent", http.StatusBadRequest)
		return
	}

	result := DeployResult{
		Success: true,
		Agents:  make([]AgentDeployStatus, 0, len(req.Template.Agents)),
	}

	// Get OpenClaw home directory
	homeDir, err := h.getOpenClawHome()
	if err != nil {
		web.Fail(w, r, "OPENCLAW_HOME_ERROR", err.Error(), http.StatusInternalServerError)
		return
	}

	// Get current config to check existing agents
	existingAgents, err := h.getExistingAgents()
	if err != nil {
		web.Fail(w, r, "GET_AGENTS_FAILED", err.Error(), http.StatusBadGateway)
		return
	}

	existingMap := make(map[string]bool)
	for _, a := range existingAgents {
		existingMap[a] = true
	}

	// Deploy each agent
	for _, agentCfg := range req.Template.Agents {
		agentID := agentCfg.ID
		if req.Prefix != "" {
			agentID = req.Prefix + "-" + agentID
		}

		status := AgentDeployStatus{
			ID:        agentID,
			Name:      agentCfg.Name,
			Workspace: filepath.Join(homeDir, "agents", agentID),
		}
		workspace := status.Workspace

		// Check if agent already exists
		if existingMap[agentID] {
			if req.SkipExisting {
				status.Status = "skipped"
				result.SkippedCount++
				result.Agents = append(result.Agents, status)
				continue
			}
		}

		if req.DryRun {
			status.Status = "preview"
			status.Workspace = filepath.Join(homeDir, "agents", agentID)
			result.Agents = append(result.Agents, status)
			continue
		}

		// Create agent using agents.create API
		// Note: OpenClaw uses 'name' to generate agentId, so we pass the agentID as name
		// The display name will be set via IDENTITY.md file
		createParams := map[string]interface{}{
			"name":      agentID, // Use agentID as name (OpenClaw generates agentId from name)
			"workspace": workspace,
		}
		if agentCfg.Icon != "" {
			createParams["emoji"] = agentCfg.Icon
		}

		_, err := h.client.Request("agents.create", createParams)
		if err != nil {
			errStr := err.Error()
			if strings.Contains(errStr, "already exists") {
				// Agent exists; overwrite its workspace files since skipExisting=false
				status.Status = "updated"
				result.DeployedCount++
				if err := h.updateAgentWorkspace(agentID, workspace); err != nil {
					logger.Log.Warn().Err(err).Str("agentId", agentID).Str("workspace", workspace).Msg("Failed to update agent workspace")
					result.Errors = append(result.Errors, fmt.Sprintf("agent %s workspace update: %s", agentID, err.Error()))
				}
				if _, writeErr := h.createAgentWorkspace(homeDir, agentID, agentCfg); writeErr != nil {
					logger.Log.Warn().Err(writeErr).Str("agentId", agentID).Msg("Failed to overwrite agent config files")
				}
			} else {
				status.Status = "failed"
				status.Error = errStr
				result.Errors = append(result.Errors, fmt.Sprintf("agent %s: %s", agentID, errStr))
				result.Success = false
			}
		} else {
			status.Status = "created"
			result.DeployedCount++
			if err := h.updateAgentWorkspace(agentID, workspace); err != nil {
				logger.Log.Warn().Err(err).Str("agentId", agentID).Str("workspace", workspace).Msg("Failed to confirm agent workspace")
				result.Errors = append(result.Errors, fmt.Sprintf("agent %s workspace update: %s", agentID, err.Error()))
			}

			// Write agent configuration files
			if _, writeErr := h.createAgentWorkspace(homeDir, agentID, agentCfg); writeErr != nil {
				logger.Log.Warn().Err(writeErr).Str("agentId", agentID).Msg("Failed to write agent config files")
			}
		}

		result.Agents = append(result.Agents, status)
	}

	// Note: agents.reload is not a valid gateway RPC method.
	// Gateway auto-reloads agents after config changes.

	// Configure main agent to know about deployed subagents
	// Do this even if all agents were skipped (already exist)
	if !req.DryRun {
		deployedAgents := make([]AgentDeployStatus, 0)
		for _, status := range result.Agents {
			if status.Status == "created" || status.Status == "skipped" {
				deployedAgents = append(deployedAgents, status)
			}
		}
		if len(deployedAgents) > 0 {
			// Update main agent's SOUL.md with subagent information
			logger.Log.Info().
				Int("deployedCount", result.DeployedCount).
				Int("skippedCount", result.SkippedCount).
				Int("totalAgents", len(deployedAgents)).
				Msg("Configuring coordinator agent")

			if err := h.configureCoordinatorAgent("main", req.Template.Name, deployedAgents); err != nil {
				logger.Log.Warn().Err(err).Msg("Failed to configure coordinator agent")
				result.CoordinatorError = err.Error()
			} else {
				result.CoordinatorUpdated = true
			}
		}
	}

	// Configure bindings if provided
	if !req.DryRun && len(req.Template.Bindings) > 0 {
		result.Bindings = h.configureBindings(req.Template.Bindings, req.Prefix)
	}

	web.OK(w, r, result)
}

// Status returns the status of deployed multi-agent systems.
func (h *MultiAgentHandler) Status(w http.ResponseWriter, r *http.Request) {
	// Get current agents
	data, err := h.client.Request("agents.list", map[string]interface{}{})
	if err != nil {
		web.Fail(w, r, "GET_AGENTS_FAILED", err.Error(), http.StatusBadGateway)
		return
	}

	var agentsResp struct {
		Agents []struct {
			ID        string `json:"id"`
			Workspace string `json:"workspace"`
			Default   bool   `json:"default"`
		} `json:"agents"`
	}

	if err := json.Unmarshal(data, &agentsResp); err != nil {
		// Try alternative format
		var altResp []struct {
			ID        string `json:"id"`
			Workspace string `json:"workspace"`
			Default   bool   `json:"default"`
		}
		if err2 := json.Unmarshal(data, &altResp); err2 != nil {
			web.Fail(w, r, "PARSE_AGENTS_FAILED", err.Error(), http.StatusBadGateway)
			return
		}
		agentsResp.Agents = altResp
	}

	// Group agents by prefix to identify multi-agent deployments
	deployments := make(map[string][]string)
	standalone := make([]string, 0)

	for _, agent := range agentsResp.Agents {
		parts := strings.SplitN(agent.ID, "-", 2)
		if len(parts) == 2 {
			deployments[parts[0]] = append(deployments[parts[0]], agent.ID)
		} else {
			standalone = append(standalone, agent.ID)
		}
	}

	web.OK(w, r, map[string]interface{}{
		"totalAgents": len(agentsResp.Agents),
		"deployments": deployments,
		"standalone":  standalone,
	})
}

// Delete removes a multi-agent deployment.
func (h *MultiAgentHandler) Delete(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Prefix string   `json:"prefix"`
		Agents []string `json:"agents,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.Fail(w, r, "INVALID_REQUEST", "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Prefix == "" && len(req.Agents) == 0 {
		web.Fail(w, r, "INVALID_REQUEST", "prefix or agents list required", http.StatusBadRequest)
		return
	}

	// Get current config
	raw, err := h.client.Request("config.get", map[string]interface{}{})
	if err != nil {
		web.Fail(w, r, "GET_CONFIG_FAILED", err.Error(), http.StatusBadGateway)
		return
	}

	var wrapper map[string]interface{}
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		web.Fail(w, r, "PARSE_CONFIG_FAILED", err.Error(), http.StatusBadGateway)
		return
	}

	baseHash, _ := wrapper["hash"].(string)

	var currentCfg map[string]interface{}
	if parsed, ok := wrapper["parsed"]; ok {
		if m, ok := parsed.(map[string]interface{}); ok {
			currentCfg = m
		}
	}
	if currentCfg == nil {
		web.Fail(w, r, "PARSE_CONFIG_FAILED", "failed to parse current config", http.StatusBadGateway)
		return
	}

	// Remove agents from config
	agentsCfg, _ := currentCfg["agents"].(map[string]interface{})
	if agentsCfg == nil {
		web.OK(w, r, map[string]interface{}{"removed": 0})
		return
	}

	agentsList, _ := agentsCfg["list"].([]interface{})
	if agentsList == nil {
		web.OK(w, r, map[string]interface{}{"removed": 0})
		return
	}

	// Filter out agents to remove
	toRemove := make(map[string]bool)
	if req.Prefix != "" {
		for _, a := range agentsList {
			if agent, ok := a.(map[string]interface{}); ok {
				if id, ok := agent["id"].(string); ok {
					if strings.HasPrefix(id, req.Prefix+"-") {
						toRemove[id] = true
					}
				}
			}
		}
	}
	for _, id := range req.Agents {
		toRemove[id] = true
	}

	newList := make([]interface{}, 0)
	removed := 0
	for _, a := range agentsList {
		if agent, ok := a.(map[string]interface{}); ok {
			if id, ok := agent["id"].(string); ok {
				if toRemove[id] {
					removed++
					continue
				}
			}
		}
		newList = append(newList, a)
	}

	agentsCfg["list"] = newList

	// Update config
	cfgJSON, jsonErr := json.Marshal(currentCfg)
	if jsonErr != nil {
		web.Fail(w, r, "CONFIG_SERIALIZE_FAILED", jsonErr.Error(), http.StatusInternalServerError)
		return
	}
	setParams := map[string]interface{}{
		"raw": string(cfgJSON),
	}
	if baseHash != "" {
		setParams["baseHash"] = baseHash
	}
	cfgBudget.waitForSlot()
	_, err = h.client.Request("config.set", setParams)
	if err != nil {
		web.Fail(w, r, "UPDATE_CONFIG_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	cfgBudget.recordWrite()

	web.OK(w, r, map[string]interface{}{
		"removed": removed,
		"agents":  toRemove,
	})
}

// Helper functions

func (h *MultiAgentHandler) getOpenClawHome() (string, error) {
	// Try to get from config
	data, err := h.client.Request("config.get", map[string]interface{}{})
	if err == nil {
		var wrapper map[string]interface{}
		if json.Unmarshal(data, &wrapper) == nil {
			if parsed, ok := wrapper["parsed"].(map[string]interface{}); ok {
				if home, ok := parsed["home"].(string); ok && home != "" {
					return home, nil
				}
			}
		}
	}

	// Fallback to default
	stateDir := openclaw.ResolveStateDir()
	if stateDir == "" {
		return "", fmt.Errorf("cannot resolve OpenClaw state directory")
	}
	return stateDir, nil
}

func (h *MultiAgentHandler) getExistingAgents() ([]string, error) {
	data, err := h.client.Request("agents.list", map[string]interface{}{})
	if err != nil {
		return nil, err
	}

	var result []string

	// Try parsing as object with agents array
	var agentsResp struct {
		Agents []struct {
			ID string `json:"id"`
		} `json:"agents"`
	}
	if json.Unmarshal(data, &agentsResp) == nil && len(agentsResp.Agents) > 0 {
		for _, a := range agentsResp.Agents {
			result = append(result, a.ID)
		}
		return result, nil
	}

	// Try parsing as direct array
	var directList []struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(data, &directList) == nil {
		for _, a := range directList {
			result = append(result, a.ID)
		}
	}

	return result, nil
}

func (h *MultiAgentHandler) createAgentWorkspace(homeDir, agentID string, cfg AgentConfig) (string, error) {
	workspace := filepath.Join(homeDir, "agents", agentID)

	// Create workspace directory
	if err := os.MkdirAll(workspace, 0755); err != nil {
		return "", fmt.Errorf("%s", i18n.T(i18n.MsgFileDirCreateFailed, map[string]interface{}{"Error": err.Error()}))
	}

	// Create SOUL.md
	soulContent := fmt.Sprintf("# %s\n\n**Role:** %s\n\n%s\n", cfg.Name, cfg.Role, cfg.Description)
	if cfg.Soul != "" {
		soulContent = cfg.Soul
	}
	if err := os.WriteFile(filepath.Join(workspace, "SOUL.md"), []byte(soulContent), 0644); err != nil {
		return "", fmt.Errorf("%s", i18n.T(i18n.MsgFileCreateFailed, map[string]interface{}{"File": "SOUL.md", "Error": err.Error()}))
	}

	// Create AGENTS.md
	agentsMdContent := fmt.Sprintf("# AGENTS.md - %s Workspace\n\nThis is the workspace for **%s** (%s).\n\n## Session Startup\n\n1. Read `SOUL.md` — this is who you are\n2. Read `USER.md` — this is who you're helping\n3. Read `memory/YYYY-MM-DD.md` for recent context\n\n## Red Lines\n\n- Don't exfiltrate private data. Ever.\n- Don't run destructive commands without asking.\n- When in doubt, ask.\n", cfg.Name, cfg.Name, cfg.Role)
	if cfg.AgentsMd != "" {
		agentsMdContent = cfg.AgentsMd
	}
	if err := os.WriteFile(filepath.Join(workspace, "AGENTS.md"), []byte(agentsMdContent), 0644); err != nil {
		return "", fmt.Errorf("%s", i18n.T(i18n.MsgFileCreateFailed, map[string]interface{}{"File": "AGENTS.md", "Error": err.Error()}))
	}

	// Create USER.md if provided, else write a blank template
	userMdContent := fmt.Sprintf("# USER.md - About Your Human\n\n_Learn about the person you're helping. Update this as you go._\n\n- **Name:**\n- **What to call them:**\n- **Pronouns:** _(optional)_\n- **Timezone:**\n- **Notes:**\n\n## Context\n\n_(What are their goals for the %s role? What do they care about? Build this over time.)_\n", cfg.Role)
	if cfg.UserMd != "" {
		userMdContent = cfg.UserMd
	}
	if err := os.WriteFile(filepath.Join(workspace, "USER.md"), []byte(userMdContent), 0644); err != nil {
		return "", fmt.Errorf("%s", i18n.T(i18n.MsgFileCreateFailed, map[string]interface{}{"File": "USER.md", "Error": err.Error()}))
	}

	// Create IDENTITY.md if provided, else write defaults
	identityMdContent := fmt.Sprintf("# IDENTITY.md - Who Am I?\n\n- **Name:** %s\n- **Creature:** AI agent\n- **Vibe:** professional, focused\n- **Emoji:** 🤖\n", cfg.Name)
	if cfg.IdentityMd != "" {
		identityMdContent = cfg.IdentityMd
	}
	if err := os.WriteFile(filepath.Join(workspace, "IDENTITY.md"), []byte(identityMdContent), 0644); err != nil {
		return "", fmt.Errorf("%s", i18n.T(i18n.MsgFileCreateFailed, map[string]interface{}{"File": "IDENTITY.md", "Error": err.Error()}))
	}

	// Create HEARTBEAT.md if provided
	if cfg.Heartbeat != "" {
		if err := os.WriteFile(filepath.Join(workspace, "HEARTBEAT.md"), []byte(cfg.Heartbeat), 0644); err != nil {
			return "", fmt.Errorf("%s", i18n.T(i18n.MsgFileCreateFailed, map[string]interface{}{"File": "HEARTBEAT.md", "Error": err.Error()}))
		}
	}

	// Create TOOLS.md if provided
	if cfg.Tools != "" {
		if err := os.WriteFile(filepath.Join(workspace, "TOOLS.md"), []byte(cfg.Tools), 0644); err != nil {
			return "", fmt.Errorf("%s", i18n.T(i18n.MsgFileCreateFailed, map[string]interface{}{"File": "TOOLS.md", "Error": err.Error()}))
		}
	}

	// Create skills directory if skills are specified
	if len(cfg.Skills) > 0 {
		skillsDir := filepath.Join(workspace, "skills")
		if err := os.MkdirAll(skillsDir, 0755); err != nil {
			return "", fmt.Errorf("%s", i18n.T(i18n.MsgFileDirCreateFailed, map[string]interface{}{"Error": err.Error()}))
		}
		// Note: Actual skill installation would require additional logic
	}

	return workspace, nil
}

func (h *MultiAgentHandler) updateAgentWorkspace(agentID, workspace string) error {
	_, err := h.client.RequestWithTimeout("agents.update", map[string]interface{}{
		"agentId":   agentID,
		"workspace": workspace,
	}, 15*time.Second)
	return err
}

func (h *MultiAgentHandler) updateOpenClawConfig(template MultiAgentTemplate, prefix string) error {
	// Get current config
	raw, err := h.client.Request("config.get", map[string]interface{}{})
	if err != nil {
		return err
	}

	var wrapper map[string]interface{}
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		return err
	}

	baseHash, _ := wrapper["hash"].(string)

	var currentCfg map[string]interface{}
	if parsed, ok := wrapper["parsed"]; ok {
		if m, ok := parsed.(map[string]interface{}); ok {
			currentCfg = m
		}
	}
	if currentCfg == nil {
		currentCfg = make(map[string]interface{})
	}

	// Get OpenClaw home
	homeDir, _ := h.getOpenClawHome()

	// Update agents.list
	agentsCfg, _ := currentCfg["agents"].(map[string]interface{})
	if agentsCfg == nil {
		agentsCfg = make(map[string]interface{})
		currentCfg["agents"] = agentsCfg
	}

	agentsList, _ := agentsCfg["list"].([]interface{})
	if agentsList == nil {
		agentsList = make([]interface{}, 0)
	}

	// Add new agents
	for _, agentCfg := range template.Agents {
		agentID := agentCfg.ID
		if prefix != "" {
			agentID = prefix + "-" + agentID
		}

		newAgent := map[string]interface{}{
			"id":        agentID,
			"workspace": filepath.Join(homeDir, "agents", agentID),
		}

		// Check if already exists
		exists := false
		for _, a := range agentsList {
			if agent, ok := a.(map[string]interface{}); ok {
				if agent["id"] == agentID {
					exists = true
					break
				}
			}
		}

		if !exists {
			agentsList = append(agentsList, newAgent)
		}
	}

	agentsCfg["list"] = agentsList

	// Update bindings if provided
	if len(template.Bindings) > 0 {
		bindings, _ := currentCfg["bindings"].([]interface{})
		if bindings == nil {
			bindings = make([]interface{}, 0)
		}

		for _, binding := range template.Bindings {
			agentID := binding.AgentID
			if prefix != "" {
				agentID = prefix + "-" + agentID
			}

			newBinding := map[string]interface{}{
				"agentId": agentID,
				"match":   binding.Match,
			}
			bindings = append(bindings, newBinding)
		}

		currentCfg["bindings"] = bindings
	}

	// Save config
	cfgJSONBytes, jsonErr := json.Marshal(currentCfg)
	if jsonErr != nil {
		return fmt.Errorf("config serialize: %w", jsonErr)
	}
	setParams := map[string]interface{}{
		"raw": string(cfgJSONBytes),
	}
	if baseHash != "" {
		setParams["baseHash"] = baseHash
	}
	cfgBudget.waitForSlot()
	_, err = h.client.RequestWithTimeout("config.set", setParams, 15*time.Second)
	if err != nil {
		return err
	}
	cfgBudget.recordWrite()

	// Note: agents.reload is not a valid gateway RPC method.
	// config.set already triggers automatic reload in the gateway.

	return nil
}

func (h *MultiAgentHandler) configureBindings(bindings []BindingConfig, prefix string) []BindingStatus {
	results := make([]BindingStatus, 0, len(bindings))

	for _, binding := range bindings {
		agentID := binding.AgentID
		if prefix != "" {
			agentID = prefix + "-" + agentID
		}

		status := BindingStatus{
			AgentID: agentID,
			Status:  "configured",
		}

		// Bindings are configured via config.set in updateOpenClawConfig
		// This is just for status reporting
		results = append(results, status)
	}

	return results
}

// configureCoordinatorAgent updates the coordinator agent's SOUL.md with subagent information
// This enables the coordinator to know about and use sessions_spawn to call subagents
// Uses intelligent block management to replace existing blocks instead of duplicating
func (h *MultiAgentHandler) configureCoordinatorAgent(coordinatorId string, workflowName string, subagents []AgentDeployStatus) error {
	logger.Log.Info().
		Str("coordinator", coordinatorId).
		Str("workflow", workflowName).
		Int("subagentCount", len(subagents)).
		Msg("Starting coordinator agent configuration")

	// Build subagent list content
	var agentList strings.Builder
	var agentIds []string
	for _, agent := range subagents {
		agentList.WriteString(fmt.Sprintf("- **%s**: %s\n", agent.ID, agent.Name))
		agentIds = append(agentIds, agent.ID)
	}

	// Build the content block
	blockId := strings.ToLower(strings.ReplaceAll(workflowName, " ", "-"))
	blockStart := fmt.Sprintf("<!-- workflow:%s -->", blockId)
	blockEnd := fmt.Sprintf("<!-- /workflow:%s -->", blockId)
	newBlock := fmt.Sprintf(`

%s
## %s - Subagent Orchestration

### Available Subagents

%s
### How to Use

When you receive a task related to this workflow, use the sessions_spawn tool to delegate to the appropriate subagent:

~~~
sessions_spawn(task="your task description", agentId="subagent-id")
~~~

### Tips

- Analyze the task first, then decide which subagent is most suitable
- You can spawn multiple subagents for complex tasks
- Subagents will automatically report back when they complete their work
- Available agent IDs: %s
%s
`, blockStart, workflowName, agentList.String(), strings.Join(agentIds, ", "), blockEnd)

	// First, try to read existing SOUL.md content
	existingContent := ""
	data, err := h.client.RequestWithTimeout("agents.files.get", map[string]interface{}{
		"agentId": coordinatorId,
		"name":    "SOUL.md",
	}, 5*time.Second)
	if err != nil {
		logger.Log.Warn().Err(err).Msg("Failed to read existing SOUL.md, will create new")
	} else if data != nil {
		var fileResp struct {
			File struct {
				Content string `json:"content"`
				Missing bool   `json:"missing"`
			} `json:"file"`
		}
		if json.Unmarshal(data, &fileResp) == nil {
			if fileResp.File.Missing {
				logger.Log.Info().Msg("SOUL.md does not exist, will create new")
			} else {
				existingContent = fileResp.File.Content
				logger.Log.Info().Int("contentLength", len(existingContent)).Msg("Read existing SOUL.md")
			}
		} else {
			logger.Log.Warn().Msg("Failed to parse agents.files.get response")
		}
	}

	// Intelligent block management: replace existing block or append
	var finalContent string
	if strings.Contains(existingContent, blockStart) {
		// Block exists, replace it using regex
		pattern := regexp.MustCompile(`(?s)\n?` + regexp.QuoteMeta(blockStart) + `.*?` + regexp.QuoteMeta(blockEnd) + `\n?`)
		finalContent = pattern.ReplaceAllString(existingContent, newBlock)
		logger.Log.Debug().Str("blockId", blockId).Msg("Replacing existing workflow block")
	} else {
		// Block doesn't exist, append
		finalContent = existingContent + newBlock
		logger.Log.Debug().Str("blockId", blockId).Msg("Appending new workflow block")
	}

	// Write the final content
	logger.Log.Info().
		Int("finalContentLength", len(finalContent)).
		Bool("isReplacement", strings.Contains(existingContent, blockStart)).
		Msg("Writing SOUL.md to coordinator agent")

	_, err = h.client.RequestWithTimeout("agents.files.set", map[string]interface{}{
		"agentId": coordinatorId,
		"name":    "SOUL.md",
		"content": finalContent,
	}, 10*time.Second)

	if err != nil {
		logger.Log.Error().
			Err(err).
			Str("coordinator", coordinatorId).
			Str("rpcMethod", "agents.files.set").
			Msg("Failed to write SOUL.md to coordinator agent")
		return fmt.Errorf("%s", i18n.T(i18n.MsgFileWriteFailed, map[string]interface{}{"File": "SOUL.md", "Error": err.Error()}))
	}

	logger.Log.Info().
		Str("coordinator", coordinatorId).
		Str("workflow", workflowName).
		Int("subagentCount", len(subagents)).
		Msg("Configured coordinator agent with subagent information")

	return nil
}

// ────────────────────────────────────────────────────────────────────────────
// Wizard SSE helpers
// ────────────────────────────────────────────────────────────────────────────

// writeSSE writes a single SSE event to w and flushes.
func writeSSE(w http.ResponseWriter, event, data string) {
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

func writeSSEJSON(w http.ResponseWriter, event string, v interface{}) {
	b, _ := json.Marshal(v)
	writeSSE(w, event, string(b))
}

// activityContext returns a context that is cancelled if no activity is reported
// within inactivity for longer than the idle timeout, or when the parent is done.
// Call the returned ping() function each time a token arrives to reset the timer.
// The absolute hard-cap is hardCap regardless of activity.
func activityContext(parent context.Context, idleTimeout, hardCap time.Duration) (ctx context.Context, ping func()) {
	ctx, cancel := context.WithCancel(parent)
	lastActive := time.Now()
	mu := sync.Mutex{}
	ping = func() {
		mu.Lock()
		lastActive = time.Now()
		mu.Unlock()
	}
	go func() {
		deadline := time.Now().Add(hardCap)
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		defer cancel()
		for {
			select {
			case <-parent.Done():
				return
			case now := <-ticker.C:
				if now.After(deadline) {
					return
				}
				mu.Lock()
				idle := now.Sub(lastActive)
				mu.Unlock()
				if idle >= idleTimeout {
					return
				}
			}
		}
	}()
	return ctx, ping
}

// stripFences removes ```json / ``` markdown fences from LLM output.
func stripFences(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		if nl := strings.Index(s, "\n"); nl > 0 {
			s = s[nl+1:]
		}
		if end := strings.LastIndex(s, "```"); end > 0 {
			s = s[:end]
		}
		s = strings.TrimSpace(s)
	}
	return s
}

// ────────────────────────────────────────────────────────────────────────────
// GenerateWizardStep1 — SSE stream: core team structure (no markdown files)
// ────────────────────────────────────────────────────────────────────────────

// WizardStep1Request is the body for the wizard step-1 SSE endpoint.
type WizardStep1Request struct {
	ScenarioName string `json:"scenarioName"`
	Description  string `json:"description"`
	TeamSize     string `json:"teamSize"`
	WorkflowType string `json:"workflowType"`
	Language     string `json:"language"`
	ModelID      string `json:"modelId,omitempty"`
	// CustomPrompt overrides the default prompt when non-empty.
	CustomPrompt string `json:"customPrompt,omitempty"`
}

// GenerateWizardStep1 streams the core team structure (id/name/role/description/icon/color/workflow)
// via SSE. Events: token (each streamed token), done (parsed JSON), error.
func (h *MultiAgentHandler) GenerateWizardStep1(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	var req WizardStep1Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeSSEJSON(w, "error", map[string]string{"code": "BAD_REQUEST", "msg": err.Error()})
		return
	}
	if req.ScenarioName == "" || req.Description == "" {
		writeSSEJSON(w, "error", map[string]string{"code": "BAD_REQUEST", "msg": "scenarioName and description are required"})
		return
	}

	providerCfg, err := llmdirect.ResolveProvider(h.configPath, req.ModelID)
	if err != nil {
		writeSSEJSON(w, "error", map[string]string{"code": "LLM_PROVIDER_FAILED", "msg": err.Error()})
		return
	}

	langHint := "English"
	switch req.Language {
	case "zh", "zh-TW":
		langHint = "Chinese"
	case "ja":
		langHint = "Japanese"
	case "ko":
		langHint = "Korean"
	}

	agentCountHint := multiAgentCountHint(req.TeamSize)

	prompt := req.CustomPrompt
	if prompt == "" {
		prompt = fmt.Sprintf(
			"Output ONLY valid JSON, no markdown.\n\nScenario: %s\nDescription: %s\nAgents: %s\nWorkflow: %s\nLanguage: %s\n\nFor each agent: id (kebab-case), name, role (≤8 words), description (≤20 words), icon (Material Symbol), color (Tailwind gradient e.g. from-blue-500 to-cyan-500). reasoning: ≤15 words. workflow: one step per agent.\n\n{\"reasoning\":\"\",\"template\":{\"id\":\"\",\"name\":\"\",\"description\":\"\",\"agents\":[{\"id\":\"\",\"name\":\"\",\"role\":\"\",\"description\":\"\",\"icon\":\"\",\"color\":\"\"}],\"workflow\":{\"type\":\"%s\",\"description\":\"\",\"steps\":[{\"agent\":\"\",\"action\":\"\"}]}}}",
			req.ScenarioName, req.Description, agentCountHint, req.WorkflowType, langHint, req.WorkflowType,
		)
	}

	ctx, pingStep1 := activityContext(r.Context(), 120*time.Second, 10*time.Minute)

	var buf strings.Builder
	for chunk := range llmdirect.StreamCompletion(ctx, providerCfg, []llmdirect.Message{{Role: "user", Content: prompt}}, 2048) {
		if chunk.Error != nil {
			code := "LLM_STREAM_FAILED"
			msg := chunk.Error.Error()
			if strings.Contains(msg, "context") {
				code = "TIMEOUT"
				msg = "Generation timed out or was canceled"
			}
			writeSSEJSON(w, "error", map[string]string{"code": code, "msg": msg})
			return
		}
		if chunk.Done {
			break
		}
		pingStep1()
		buf.WriteString(chunk.Token)
		writeSSEJSON(w, "token", map[string]string{"token": chunk.Token})
	}

	raw := stripFences(buf.String())

	// Validate JSON
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		writeSSEJSON(w, "error", map[string]string{
			"code": "JSON_PARSE_FAILED",
			"msg":  fmt.Sprintf("JSON parse failed: %v", err),
			"raw":  raw,
		})
		return
	}

	writeSSEJSON(w, "done", map[string]interface{}{"json": raw, "parsed": parsed})
}

// ────────────────────────────────────────────────────────────────────────────
// GenerateWizardStep2 — SSE stream: markdown files for a single agent
// ────────────────────────────────────────────────────────────────────────────

// WizardStep2Request is the body for the wizard step-2 SSE endpoint.
type WizardStep2Request struct {
	AgentID      string `json:"agentId"`
	AgentName    string `json:"agentName"`
	AgentRole    string `json:"agentRole"`
	AgentDesc    string `json:"agentDesc"`
	ScenarioName string `json:"scenarioName"`
	Language     string `json:"language"`
	ModelID      string `json:"modelId,omitempty"`
	// CustomPrompt overrides the default prompt when non-empty.
	CustomPrompt string `json:"customPrompt,omitempty"`
}

// GenerateWizardStep2 streams the markdown file content for a single agent via SSE.
// Events: token, done (with soul/agentsMd/userMd/identityMd/heartbeat fields), error.
func (h *MultiAgentHandler) GenerateWizardStep2(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	var req WizardStep2Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeSSEJSON(w, "error", map[string]string{"code": "BAD_REQUEST", "msg": err.Error()})
		return
	}
	if req.AgentID == "" || req.AgentName == "" {
		writeSSEJSON(w, "error", map[string]string{"code": "BAD_REQUEST", "msg": "agentId and agentName are required"})
		return
	}

	providerCfg, err := llmdirect.ResolveProvider(h.configPath, req.ModelID)
	if err != nil {
		writeSSEJSON(w, "error", map[string]string{"code": "LLM_PROVIDER_FAILED", "msg": err.Error()})
		return
	}

	langHint := "English"
	switch req.Language {
	case "zh", "zh-TW":
		langHint = "Chinese"
	case "ja":
		langHint = "Japanese"
	case "ko":
		langHint = "Korean"
	}

	prompt := req.CustomPrompt
	if prompt == "" {
		prompt = fmt.Sprintf(`Output ONLY valid JSON. No markdown fences, no explanation.

You are writing OpenClaw agent workspace files for a multi-agent system.
Agent name: %s
Agent role: %s
Agent description: %s
Scenario / team name: %s
Write all content in: %s

FILE SPECIFICATIONS — follow these exactly:

SOUL.md — Persona, tone, and boundaries. Loaded every session.
  - Write in first person as the agent.
  - Cover: who this agent is, what they care about, their working principles, their communication style.
  - 3–5 short paragraphs. Use markdown headers (## Core Truths, ## Boundaries, ## Vibe).
  - Be specific to this agent's role, NOT generic AI platitudes.

AGENTS.md — Operating instructions and memory rules. Loaded every session.
  - Starts with "## Session Startup" listing files to read on wake-up (SOUL.md, USER.md, memory/YYYY-MM-DD.md).
  - Includes "## Red Lines" (things this agent must never do).
  - Includes role-specific rules and priorities for this agent's domain.
  - Use markdown headers and bullet lists.

USER.md — Profile of the human this agent serves. Loaded every session.
  - Use the standard template format:
    - **Name:**
    - **What to call them:**
    - **Pronouns:** (optional)
    - **Timezone:**
    - **Notes:**
  - Add a "## Context" section describing what this agent should learn about the user over time (relevant to the agent's role).
  - Leave field values blank — the agent will fill them in from real interactions.

IDENTITY.md — The agent's name, creature, vibe, and emoji. Created during bootstrap.
  - Use the standard format exactly:
    - **Name:** (a fitting name for this role)
    - **Creature:** (AI? specialist? advisor? something fitting)
    - **Vibe:** (how this agent comes across — sharp? warm? precise? creative?)
    - **Emoji:** (one emoji that fits this agent's personality)
  - Do NOT add extra fields.

HEARTBEAT.md — Optional periodic checklist for background proactive work. Keep minimal to avoid token burn.
  - First, judge whether this agent genuinely has recurring background tasks worth checking periodically.
  - If YES: write 2–4 specific, actionable "- [ ] task" checklist items for this agent's role.
  - If NO (agent is purely reactive or session-driven with no background state to check): output exactly: # No periodic tasks for this agent
  - Never pad with vague items just to fill space.

Return JSON with these exact keys. Values are full markdown file contents (escape newlines as \n):
{"soul":"","agentsMd":"","userMd":"","identityMd":"","heartbeat":""}`,
			req.AgentName, req.AgentRole, req.AgentDesc, req.ScenarioName, langHint,
		)
	}

	ctx, pingStep2 := activityContext(r.Context(), 120*time.Second, 10*time.Minute)

	var buf strings.Builder
	for chunk := range llmdirect.StreamCompletion(ctx, providerCfg, []llmdirect.Message{{Role: "user", Content: prompt}}, 4096) {
		if chunk.Error != nil {
			code := "LLM_STREAM_FAILED"
			msg := chunk.Error.Error()
			if strings.Contains(msg, "context") {
				code = "TIMEOUT"
				msg = "Generation timed out or was canceled"
			}
			writeSSEJSON(w, "error", map[string]string{"code": code, "msg": msg})
			return
		}
		if chunk.Done {
			break
		}
		pingStep2()
		buf.WriteString(chunk.Token)
		writeSSEJSON(w, "token", map[string]string{"token": chunk.Token, "agentId": req.AgentID})
	}

	raw := stripFences(buf.String())

	var result struct {
		Soul       string `json:"soul"`
		AgentsMd   string `json:"agentsMd"`
		UserMd     string `json:"userMd"`
		IdentityMd string `json:"identityMd"`
		Heartbeat  string `json:"heartbeat"`
	}
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		// Non-fatal: send what we have as raw text in soul field
		writeSSEJSON(w, "done", map[string]interface{}{
			"agentId":    req.AgentID,
			"soul":       raw,
			"parseError": err.Error(),
		})
		return
	}

	writeSSEJSON(w, "done", map[string]interface{}{
		"agentId":    req.AgentID,
		"soul":       result.Soul,
		"agentsMd":   result.AgentsMd,
		"userMd":     result.UserMd,
		"identityMd": result.IdentityMd,
		"heartbeat":  result.Heartbeat,
	})
}
