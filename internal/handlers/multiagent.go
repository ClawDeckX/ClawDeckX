package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// MultiAgentHandler handles multi-agent deployment operations.
type MultiAgentHandler struct {
	client *openclaw.GWClient
}

func NewMultiAgentHandler(client *openclaw.GWClient) *MultiAgentHandler {
	return &MultiAgentHandler{client: client}
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
			ID:   agentID,
			Name: agentCfg.Name,
		}

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
		workspace := filepath.Join(homeDir, "agents", agentID)
		createParams := map[string]interface{}{
			"name":      agentID, // Use agentID as name (OpenClaw generates agentId from name)
			"workspace": workspace,
		}
		if agentCfg.Icon != "" {
			createParams["emoji"] = agentCfg.Icon
		}

		_, err := h.client.Request("agents.create", createParams)
		if err != nil {
			// If agent already exists, try to continue
			errStr := err.Error()
			if strings.Contains(errStr, "already exists") {
				status.Status = "skipped"
				status.Workspace = workspace
				result.SkippedCount++
			} else {
				status.Status = "failed"
				status.Error = errStr
				result.Errors = append(result.Errors, fmt.Sprintf("agent %s: %s", agentID, errStr))
				result.Success = false
			}
		} else {
			status.Status = "created"
			status.Workspace = workspace
			result.DeployedCount++

			// Write agent configuration files
			if _, writeErr := h.createAgentWorkspace(homeDir, agentID, agentCfg); writeErr != nil {
				logger.Log.Warn().Err(writeErr).Str("agentId", agentID).Msg("Failed to write agent config files")
			}
		}

		result.Agents = append(result.Agents, status)
	}

	// Reload agents after deployment
	if !req.DryRun && result.DeployedCount > 0 {
		h.client.Request("agents.reload", map[string]interface{}{})
	}

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
	_, err = h.client.Request("config.set", map[string]interface{}{
		"config": currentCfg,
	})
	if err != nil {
		web.Fail(w, r, "UPDATE_CONFIG_FAILED", err.Error(), http.StatusBadGateway)
		return
	}

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
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(homeDir, ".openclaw"), nil
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
		return "", fmt.Errorf(i18n.T(i18n.MsgFileDirCreateFailed, map[string]interface{}{"Error": err.Error()}))
	}

	// Create SOUL.md
	soulContent := fmt.Sprintf("# %s\n\n**Role:** %s\n\n%s\n", cfg.Name, cfg.Role, cfg.Description)
	if cfg.Soul != "" {
		soulContent = cfg.Soul
	}
	if err := os.WriteFile(filepath.Join(workspace, "SOUL.md"), []byte(soulContent), 0644); err != nil {
		return "", fmt.Errorf(i18n.T(i18n.MsgFileCreateFailed, map[string]interface{}{"File": "SOUL.md", "Error": err.Error()}))
	}

	// Create HEARTBEAT.md if provided
	if cfg.Heartbeat != "" {
		if err := os.WriteFile(filepath.Join(workspace, "HEARTBEAT.md"), []byte(cfg.Heartbeat), 0644); err != nil {
			return "", fmt.Errorf(i18n.T(i18n.MsgFileCreateFailed, map[string]interface{}{"File": "HEARTBEAT.md", "Error": err.Error()}))
		}
	}

	// Create TOOLS.md if provided
	if cfg.Tools != "" {
		if err := os.WriteFile(filepath.Join(workspace, "TOOLS.md"), []byte(cfg.Tools), 0644); err != nil {
			return "", fmt.Errorf(i18n.T(i18n.MsgFileCreateFailed, map[string]interface{}{"File": "TOOLS.md", "Error": err.Error()}))
		}
	}

	// Create skills directory if skills are specified
	if len(cfg.Skills) > 0 {
		skillsDir := filepath.Join(workspace, "skills")
		if err := os.MkdirAll(skillsDir, 0755); err != nil {
			return "", fmt.Errorf(i18n.T(i18n.MsgFileDirCreateFailed, map[string]interface{}{"Error": err.Error()}))
		}
		// Note: Actual skill installation would require additional logic
	}

	return workspace, nil
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
	_, err = h.client.RequestWithTimeout("config.set", map[string]interface{}{
		"config": currentCfg,
	}, 15*time.Second)

	if err != nil {
		return err
	}

	// Reload agents to pick up new configuration
	_, _ = h.client.Request("agents.reload", map[string]interface{}{})

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
		return fmt.Errorf(i18n.T(i18n.MsgFileWriteFailed, map[string]interface{}{"File": "SOUL.md", "Error": err.Error()}))
	}

	logger.Log.Info().
		Str("coordinator", coordinatorId).
		Str("workflow", workflowName).
		Int("subagentCount", len(subagents)).
		Msg("Configured coordinator agent with subagent information")

	return nil
}
