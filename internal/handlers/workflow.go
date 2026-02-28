package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// WorkflowHandler handles multi-agent workflow orchestration.
type WorkflowHandler struct {
	client    *openclaw.GWClient
	workflows map[string]*WorkflowInstance
	mu        sync.RWMutex
}

// NewWorkflowHandler creates a new workflow handler.
func NewWorkflowHandler(client *openclaw.GWClient) *WorkflowHandler {
	return &WorkflowHandler{
		client:    client,
		workflows: make(map[string]*WorkflowInstance),
	}
}

// WorkflowType defines the type of workflow orchestration.
type WorkflowType string

const (
	WorkflowSequential    WorkflowType = "sequential"
	WorkflowParallel      WorkflowType = "parallel"
	WorkflowCollaborative WorkflowType = "collaborative"
	WorkflowEventDriven   WorkflowType = "event-driven"
	WorkflowRouting       WorkflowType = "routing"
)

// WorkflowDefinition defines a complete workflow.
type WorkflowDefinition struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Type        WorkflowType   `json:"type"`
	Steps       []WorkflowStep `json:"steps"`
	Agents      []string       `json:"agents"`
}

// WorkflowInstance represents a running workflow instance.
type WorkflowInstance struct {
	ID           string             `json:"id"`
	DefinitionID string             `json:"definitionId"`
	Status       string             `json:"status"` // pending, running, completed, failed
	CurrentStep  int                `json:"currentStep"`
	StartedAt    time.Time          `json:"startedAt"`
	CompletedAt  *time.Time         `json:"completedAt,omitempty"`
	StepResults  []StepResult       `json:"stepResults"`
	Error        string             `json:"error,omitempty"`
	Definition   WorkflowDefinition `json:"definition"`
}

// StepResult represents the result of a workflow step.
type StepResult struct {
	StepIndex   int        `json:"stepIndex"`
	AgentID     string     `json:"agentId"`
	Status      string     `json:"status"` // pending, running, completed, failed, skipped
	StartedAt   *time.Time `json:"startedAt,omitempty"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
	RunID       string     `json:"runId,omitempty"`
	SessionKey  string     `json:"sessionKey,omitempty"`
	Output      string     `json:"output,omitempty"`
	Error       string     `json:"error,omitempty"`
}

// StartWorkflowRequest represents a request to start a workflow.
type StartWorkflowRequest struct {
	Definition  WorkflowDefinition `json:"definition"`
	InitialTask string             `json:"initialTask"`
	Prefix      string             `json:"prefix,omitempty"`
}

// StartWorkflowResponse represents the response after starting a workflow.
type StartWorkflowResponse struct {
	InstanceID string `json:"instanceId"`
	Status     string `json:"status"`
}

// Start initiates a new workflow instance.
func (h *WorkflowHandler) Start(w http.ResponseWriter, r *http.Request) {
	var req StartWorkflowRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.Fail(w, r, "INVALID_REQUEST", fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	if len(req.Definition.Steps) == 0 {
		web.Fail(w, r, "INVALID_WORKFLOW", "workflow must have at least one step", http.StatusBadRequest)
		return
	}

	// Create workflow instance
	instanceID := fmt.Sprintf("wf-%d", time.Now().UnixNano())
	instance := &WorkflowInstance{
		ID:           instanceID,
		DefinitionID: req.Definition.ID,
		Status:       "pending",
		CurrentStep:  0,
		StartedAt:    time.Now(),
		StepResults:  make([]StepResult, len(req.Definition.Steps)),
		Definition:   req.Definition,
	}

	// Initialize step results
	for i, step := range req.Definition.Steps {
		instance.StepResults[i] = StepResult{
			StepIndex: i,
			AgentID:   step.Agent,
			Status:    "pending",
		}
	}

	h.mu.Lock()
	h.workflows[instanceID] = instance
	h.mu.Unlock()

	// Start workflow execution in background
	go h.executeWorkflow(instance, req.InitialTask, req.Prefix)

	web.OK(w, r, StartWorkflowResponse{
		InstanceID: instanceID,
		Status:     "started",
	})
}

// Status returns the status of a workflow instance.
func (h *WorkflowHandler) Status(w http.ResponseWriter, r *http.Request) {
	instanceID := r.URL.Query().Get("id")
	if instanceID == "" {
		// Return all workflows
		h.mu.RLock()
		workflows := make([]*WorkflowInstance, 0, len(h.workflows))
		for _, wf := range h.workflows {
			workflows = append(workflows, wf)
		}
		h.mu.RUnlock()
		web.OK(w, r, map[string]interface{}{
			"workflows": workflows,
			"count":     len(workflows),
		})
		return
	}

	h.mu.RLock()
	instance, exists := h.workflows[instanceID]
	h.mu.RUnlock()

	if !exists {
		web.Fail(w, r, "NOT_FOUND", "workflow instance not found", http.StatusNotFound)
		return
	}

	web.OK(w, r, instance)
}

// Stop terminates a running workflow.
func (h *WorkflowHandler) Stop(w http.ResponseWriter, r *http.Request) {
	var req struct {
		InstanceID string `json:"instanceId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.Fail(w, r, "INVALID_REQUEST", "invalid request body", http.StatusBadRequest)
		return
	}

	h.mu.Lock()
	instance, exists := h.workflows[req.InstanceID]
	if exists && instance.Status == "running" {
		instance.Status = "stopped"
		now := time.Now()
		instance.CompletedAt = &now
	}
	h.mu.Unlock()

	if !exists {
		web.Fail(w, r, "NOT_FOUND", "workflow instance not found", http.StatusNotFound)
		return
	}

	web.OK(w, r, map[string]interface{}{
		"instanceId": req.InstanceID,
		"status":     "stopped",
	})
}

// executeWorkflow runs the workflow based on its type.
func (h *WorkflowHandler) executeWorkflow(instance *WorkflowInstance, initialTask, prefix string) {
	h.mu.Lock()
	instance.Status = "running"
	h.mu.Unlock()

	var err error
	switch instance.Definition.Type {
	case WorkflowSequential:
		err = h.executeSequential(instance, initialTask, prefix)
	case WorkflowParallel:
		err = h.executeParallel(instance, initialTask, prefix)
	case WorkflowCollaborative:
		err = h.executeCollaborative(instance, initialTask, prefix)
	case WorkflowEventDriven:
		err = h.executeEventDriven(instance, initialTask, prefix)
	case WorkflowRouting:
		err = h.executeRouting(instance, initialTask, prefix)
	default:
		err = fmt.Errorf(i18n.T(i18n.MsgWorkflowUnsupportedType, map[string]interface{}{"Type": string(instance.Definition.Type)}))
	}

	h.mu.Lock()
	now := time.Now()
	instance.CompletedAt = &now
	if err != nil {
		instance.Status = "failed"
		instance.Error = err.Error()
	} else {
		instance.Status = "completed"
	}
	h.mu.Unlock()
}

// executeSequential runs steps one after another.
func (h *WorkflowHandler) executeSequential(instance *WorkflowInstance, initialTask, prefix string) error {
	currentTask := initialTask

	for i, step := range instance.Definition.Steps {
		h.mu.Lock()
		instance.CurrentStep = i
		instance.StepResults[i].Status = "running"
		now := time.Now()
		instance.StepResults[i].StartedAt = &now
		h.mu.Unlock()

		// Build agent ID with prefix
		agentID := step.Agent
		if prefix != "" {
			agentID = prefix + "-" + agentID
		}

		// Spawn subagent using OpenClaw's sessions_spawn mechanism
		result, err := h.spawnSubagent(agentID, step.Action, currentTask, step.Timeout)

		h.mu.Lock()
		completedAt := time.Now()
		instance.StepResults[i].CompletedAt = &completedAt
		if err != nil {
			instance.StepResults[i].Status = "failed"
			instance.StepResults[i].Error = err.Error()
			h.mu.Unlock()
			return fmt.Errorf(i18n.T(i18n.MsgWorkflowStepFailed, map[string]interface{}{"Step": fmt.Sprintf("%d", i), "Agent": agentID, "Error": err.Error()}))
		}
		instance.StepResults[i].Status = "completed"
		instance.StepResults[i].RunID = result.RunID
		instance.StepResults[i].SessionKey = result.SessionKey
		instance.StepResults[i].Output = result.Output
		h.mu.Unlock()

		// Pass output to next step
		if result.Output != "" {
			currentTask = fmt.Sprintf("Previous step output:\n%s\n\nYour task: %s", result.Output, step.Action)
		}
	}

	return nil
}

// executeParallel runs all steps simultaneously.
func (h *WorkflowHandler) executeParallel(instance *WorkflowInstance, initialTask, prefix string) error {
	var wg sync.WaitGroup
	errors := make(chan error, len(instance.Definition.Steps))

	for i, step := range instance.Definition.Steps {
		wg.Add(1)
		go func(idx int, s WorkflowStep) {
			defer wg.Done()

			h.mu.Lock()
			instance.StepResults[idx].Status = "running"
			now := time.Now()
			instance.StepResults[idx].StartedAt = &now
			h.mu.Unlock()

			agentID := s.Agent
			if prefix != "" {
				agentID = prefix + "-" + agentID
			}

			result, err := h.spawnSubagent(agentID, s.Action, initialTask, s.Timeout)

			h.mu.Lock()
			completedAt := time.Now()
			instance.StepResults[idx].CompletedAt = &completedAt
			if err != nil {
				instance.StepResults[idx].Status = "failed"
				instance.StepResults[idx].Error = err.Error()
				errors <- fmt.Errorf(i18n.T(i18n.MsgWorkflowStepFailed, map[string]interface{}{"Step": fmt.Sprintf("%d", idx), "Agent": agentID, "Error": err.Error()}))
			} else {
				instance.StepResults[idx].Status = "completed"
				instance.StepResults[idx].RunID = result.RunID
				instance.StepResults[idx].SessionKey = result.SessionKey
				instance.StepResults[idx].Output = result.Output
			}
			h.mu.Unlock()
		}(i, step)
	}

	wg.Wait()
	close(errors)

	// Collect any errors
	var firstErr error
	for err := range errors {
		if firstErr == nil {
			firstErr = err
		}
	}

	return firstErr
}

// executeCollaborative allows agents to communicate with each other.
func (h *WorkflowHandler) executeCollaborative(instance *WorkflowInstance, initialTask, prefix string) error {
	// For collaborative workflows, we spawn all agents and let them communicate
	// via the subagents tool (steer action)

	// First, spawn all agents with the collaborative context
	for i, step := range instance.Definition.Steps {
		h.mu.Lock()
		instance.StepResults[i].Status = "running"
		now := time.Now()
		instance.StepResults[i].StartedAt = &now
		h.mu.Unlock()

		agentID := step.Agent
		if prefix != "" {
			agentID = prefix + "-" + agentID
		}

		// Build collaborative context
		collaborators := make([]string, 0)
		for _, s := range instance.Definition.Steps {
			if s.Agent != step.Agent {
				collabID := s.Agent
				if prefix != "" {
					collabID = prefix + "-" + collabID
				}
				collaborators = append(collaborators, collabID)
			}
		}

		task := fmt.Sprintf(`%s

You are part of a collaborative team. Your collaborators are: %v
Use the subagents tool to communicate with them when needed.
Your specific task: %s`, initialTask, collaborators, step.Action)

		result, err := h.spawnSubagent(agentID, step.Action, task, step.Timeout)

		h.mu.Lock()
		completedAt := time.Now()
		instance.StepResults[i].CompletedAt = &completedAt
		if err != nil {
			instance.StepResults[i].Status = "failed"
			instance.StepResults[i].Error = err.Error()
		} else {
			instance.StepResults[i].Status = "completed"
			instance.StepResults[i].RunID = result.RunID
			instance.StepResults[i].SessionKey = result.SessionKey
			instance.StepResults[i].Output = result.Output
		}
		h.mu.Unlock()
	}

	return nil
}

// executeEventDriven waits for events to trigger steps.
func (h *WorkflowHandler) executeEventDriven(instance *WorkflowInstance, initialTask, prefix string) error {
	// Event-driven workflows are triggered by external events
	// For now, we implement a simple version that executes based on conditions

	for i, step := range instance.Definition.Steps {
		// Check condition if specified
		if step.Condition != "" {
			// TODO: Implement condition evaluation
			// For now, skip steps with conditions
			h.mu.Lock()
			instance.StepResults[i].Status = "skipped"
			instance.StepResults[i].Error = "condition evaluation not implemented"
			h.mu.Unlock()
			continue
		}

		h.mu.Lock()
		instance.CurrentStep = i
		instance.StepResults[i].Status = "running"
		now := time.Now()
		instance.StepResults[i].StartedAt = &now
		h.mu.Unlock()

		agentID := step.Agent
		if prefix != "" {
			agentID = prefix + "-" + agentID
		}

		result, err := h.spawnSubagent(agentID, step.Action, initialTask, step.Timeout)

		h.mu.Lock()
		completedAt := time.Now()
		instance.StepResults[i].CompletedAt = &completedAt
		if err != nil {
			instance.StepResults[i].Status = "failed"
			instance.StepResults[i].Error = err.Error()
		} else {
			instance.StepResults[i].Status = "completed"
			instance.StepResults[i].RunID = result.RunID
			instance.StepResults[i].SessionKey = result.SessionKey
			instance.StepResults[i].Output = result.Output
		}
		h.mu.Unlock()
	}

	return nil
}

// executeRouting routes tasks to appropriate agents based on content.
func (h *WorkflowHandler) executeRouting(instance *WorkflowInstance, initialTask, prefix string) error {
	// Routing workflows direct tasks to the most appropriate agent
	// For now, we use the first agent as a router

	if len(instance.Definition.Steps) == 0 {
		return fmt.Errorf(i18n.T(i18n.MsgWorkflowNoSteps))
	}

	// Use first step as router
	routerStep := instance.Definition.Steps[0]
	routerID := routerStep.Agent
	if prefix != "" {
		routerID = prefix + "-" + routerID
	}

	// Build routing prompt
	availableAgents := make([]string, 0)
	for _, s := range instance.Definition.Steps[1:] {
		agentID := s.Agent
		if prefix != "" {
			agentID = prefix + "-" + agentID
		}
		availableAgents = append(availableAgents, fmt.Sprintf("- %s: %s", agentID, s.Action))
	}

	routingTask := fmt.Sprintf(`You are a routing agent. Analyze the following task and delegate it to the most appropriate agent.

Available agents:
%s

Task to route: %s

Use the sessions_spawn tool to delegate to the appropriate agent.`,
		joinStrings(availableAgents, "\n"), initialTask)

	h.mu.Lock()
	instance.StepResults[0].Status = "running"
	now := time.Now()
	instance.StepResults[0].StartedAt = &now
	h.mu.Unlock()

	result, err := h.spawnSubagent(routerID, "Route task to appropriate agent", routingTask, routerStep.Timeout)

	h.mu.Lock()
	completedAt := time.Now()
	instance.StepResults[0].CompletedAt = &completedAt
	if err != nil {
		instance.StepResults[0].Status = "failed"
		instance.StepResults[0].Error = err.Error()
		h.mu.Unlock()
		return err
	}
	instance.StepResults[0].Status = "completed"
	instance.StepResults[0].RunID = result.RunID
	instance.StepResults[0].SessionKey = result.SessionKey
	instance.StepResults[0].Output = result.Output
	h.mu.Unlock()

	return nil
}

// SubagentResult represents the result of spawning a subagent.
type SubagentResult struct {
	RunID      string
	SessionKey string
	Output     string
}

// spawnSubagent spawns a subagent using OpenClaw's sessions_spawn mechanism.
func (h *WorkflowHandler) spawnSubagent(agentID, action, task string, timeoutSeconds int) (*SubagentResult, error) {
	// Build the task message
	fullTask := task
	if action != "" && action != task {
		fullTask = fmt.Sprintf("%s\n\nAction: %s", task, action)
	}

	// Generate unique idempotency key for this request
	idempotencyKey := fmt.Sprintf("workflow-%s-%d", agentID, time.Now().UnixNano())

	// Build session key for this agent's workflow session
	sessionKey := fmt.Sprintf("agent:%s:workflow", agentID)

	// Use OpenClaw's agent method to spawn a subagent
	params := map[string]interface{}{
		"message":        fullTask,
		"sessionKey":     sessionKey,
		"deliver":        false,
		"idempotencyKey": idempotencyKey,
	}

	if timeoutSeconds > 0 {
		params["timeout"] = timeoutSeconds
	}

	// Call the agent method
	data, err := h.client.RequestWithTimeout("agent", params, time.Duration(timeoutSeconds+30)*time.Second)
	if err != nil {
		return nil, err
	}

	var response struct {
		RunID  string `json:"runId"`
		Status string `json:"status"`
		Reply  string `json:"reply"`
	}
	if err := json.Unmarshal(data, &response); err != nil {
		// Try to extract just the reply
		var simpleResp struct {
			Reply string `json:"reply"`
		}
		if json.Unmarshal(data, &simpleResp) == nil {
			return &SubagentResult{
				SessionKey: sessionKey,
				Output:     simpleResp.Reply,
			}, nil
		}
		return nil, fmt.Errorf(i18n.T(i18n.MsgWorkflowParseFailed, map[string]interface{}{"Error": err.Error()}))
	}

	return &SubagentResult{
		RunID:      response.RunID,
		SessionKey: sessionKey, // Use the session key we passed in the request
		Output:     response.Reply,
	}, nil
}

func joinStrings(strs []string, sep string) string {
	if len(strs) == 0 {
		return ""
	}
	result := strs[0]
	for _, s := range strs[1:] {
		result += sep + s
	}
	return result
}
