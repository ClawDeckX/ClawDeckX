package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"ClawDeckX/internal/executil"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// LLMHealthHandler provides LLM provider health monitoring and CLI execution APIs.
type LLMHealthHandler struct {
	svc      *openclaw.Service
	gwClient *openclaw.GWClient
}

func NewLLMHealthHandler(svc *openclaw.Service) *LLMHealthHandler {
	return &LLMHealthHandler{svc: svc}
}

func (h *LLMHealthHandler) SetGWClient(client *openclaw.GWClient) {
	h.gwClient = client
}

// ---------- response types ----------

type llmProviderStatus struct {
	Provider    string  `json:"provider"`
	Model       string  `json:"model"`
	ProfileID   string  `json:"profileId,omitempty"`
	Label       string  `json:"label,omitempty"`
	Source      string  `json:"source,omitempty"`
	Mode        string  `json:"mode,omitempty"`
	AuthStatus  string  `json:"authStatus"`
	AuthType    string  `json:"authType,omitempty"`
	ExpiresAt   float64 `json:"expiresAt,omitempty"`
	RemainingMs float64 `json:"remainingMs,omitempty"`
}

type llmProviderSummary struct {
	Provider     string `json:"provider"`
	Status       string `json:"status"`
	ProfileCount int    `json:"profileCount"`
}

type llmAuthHealthResponse struct {
	Profiles  []llmProviderStatus  `json:"profiles"`
	Providers []llmProviderSummary `json:"providers"`
}

type llmModelEntry struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Role     string `json:"role,omitempty"`
	Source   string `json:"source,omitempty"`
}

type llmFallbackChain struct {
	Role  string          `json:"role"`
	Chain []llmModelEntry `json:"chain"`
}

type llmModelsStatusResponse struct {
	Providers llmAuthHealthResponse `json:"providers"`
	Models    []llmModelEntry       `json:"models"`
	Fallbacks []llmFallbackChain    `json:"fallbacks"`
}

type llmProbeResult struct {
	Provider  string `json:"provider"`
	Model     string `json:"model"`
	ProfileID string `json:"profileId,omitempty"`
	Label     string `json:"label,omitempty"`
	Source    string `json:"source,omitempty"`
	Mode      string `json:"mode,omitempty"`
	Status    string `json:"status"`
	Error     string `json:"error,omitempty"`
	LatencyMs int64  `json:"latencyMs,omitempty"`
}

type llmProbeResponse struct {
	Results   []llmProbeResult `json:"results"`
	TotalMs   int64            `json:"totalMs"`
	OkCount   int              `json:"okCount"`
	FailCount int              `json:"failCount"`
}

type cliExecRequest struct {
	Command   string            `json:"command"`
	Args      []string          `json:"args"`
	TimeoutMs int               `json:"timeoutMs"`
	Env       map[string]string `json:"env,omitempty"`
}

type cliExecResponse struct {
	ExitCode   int    `json:"exitCode"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	DurationMs int64  `json:"durationMs"`
}

// ---------- handlers ----------

// ModelsStatus returns the combined model + auth + fallback status.
// Remote-first: tries gwclient RPC "models.list" first, falls back to local CLI.
func (h *LLMHealthHandler) ModelsStatus(w http.ResponseWriter, r *http.Request) {
	// Path 1: gwclient RPC (remote-first)
	if h.gwClient != nil && h.gwClient.IsConnected() {
		data, err := h.gwClient.RequestWithTimeout("models.list", map[string]interface{}{}, 25*time.Second)
		if err == nil {
			resp := h.parseModelsStatusOutput(string(data))
			if resp != nil {
				web.OK(w, r, resp)
				return
			}
		}
		logger.Doctor.Warn().Err(err).Msg("gwclient models.list RPC failed, falling back to local CLI")
	}

	// Path 2: local CLI fallback
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	out, err := openclaw.RunCLI(ctx, "models", "status", "--json")
	if err != nil {
		// Try to parse partial output even on error
		resp := h.parseModelsStatusOutput(out)
		if resp != nil {
			web.OK(w, r, resp)
			return
		}
		web.Fail(w, r, "CLI_ERROR", fmt.Sprintf("openclaw models status failed: %v", err), http.StatusBadGateway)
		return
	}

	resp := h.parseModelsStatusOutput(out)
	if resp == nil {
		// Return raw as fallback
		web.OK(w, r, llmModelsStatusResponse{
			Providers: llmAuthHealthResponse{
				Profiles:  []llmProviderStatus{},
				Providers: []llmProviderSummary{},
			},
			Models:    []llmModelEntry{},
			Fallbacks: []llmFallbackChain{},
		})
		return
	}
	web.OK(w, r, resp)
}

// AuthHealth returns authentication profile health.
// Remote-first: tries gwclient RPC "models.list" first, falls back to local CLI.
func (h *LLMHealthHandler) AuthHealth(w http.ResponseWriter, r *http.Request) {
	// Path 1: gwclient RPC (remote-first)
	if h.gwClient != nil && h.gwClient.IsConnected() {
		data, err := h.gwClient.RequestWithTimeout("models.list", map[string]interface{}{}, 12*time.Second)
		if err == nil {
			resp := h.parseAuthHealth(string(data))
			if resp != nil {
				web.OK(w, r, resp)
				return
			}
		}
		logger.Doctor.Warn().Err(err).Msg("gwclient models.list RPC failed for auth health, falling back to local CLI")
	}

	// Path 2: local CLI fallback
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	out, err := openclaw.RunCLI(ctx, "models", "status", "--json")
	if err != nil {
		resp := h.parseAuthHealth(out)
		if resp != nil {
			web.OK(w, r, resp)
			return
		}
		web.Fail(w, r, "CLI_ERROR", fmt.Sprintf("openclaw models status failed: %v", err), http.StatusBadGateway)
		return
	}

	resp := h.parseAuthHealth(out)
	if resp == nil {
		web.OK(w, r, llmAuthHealthResponse{
			Profiles:  []llmProviderStatus{},
			Providers: []llmProviderSummary{},
		})
		return
	}
	web.OK(w, r, resp)
}

// Probe runs LLM provider probes.
func (h *LLMHealthHandler) Probe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Provider    string `json:"provider"`
		ProfileID   string `json:"profileId"`
		TimeoutMs   int    `json:"timeoutMs"`
		Concurrency int    `json:"concurrency"`
		MaxTokens   int    `json:"maxTokens"`
	}
	if r.Body != nil {
		json.NewDecoder(r.Body).Decode(&req)
	}

	timeoutSec := 60
	if req.TimeoutMs > 0 {
		timeoutSec = req.TimeoutMs / 1000
		if timeoutSec < 10 {
			timeoutSec = 10
		}
		if timeoutSec > 120 {
			timeoutSec = 120
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(timeoutSec+10)*time.Second)
	defer cancel()

	args := []string{"models", "status", "--probe", "--json"}
	if req.Provider != "" {
		args = append(args, "--provider", req.Provider)
	}
	if req.TimeoutMs > 0 {
		args = append(args, "--timeout", fmt.Sprintf("%d", req.TimeoutMs))
	}
	if req.Concurrency > 0 {
		args = append(args, "--concurrency", fmt.Sprintf("%d", req.Concurrency))
	}
	if req.MaxTokens > 0 {
		args = append(args, "--max-tokens", fmt.Sprintf("%d", req.MaxTokens))
	}

	start := time.Now()
	out, err := openclaw.RunCLI(ctx, args...)
	totalMs := time.Since(start).Milliseconds()

	if err != nil {
		// Try to parse probe results from partial output
		resp := h.parseProbeOutput(out, totalMs)
		if resp != nil && len(resp.Results) > 0 {
			web.OK(w, r, resp)
			return
		}
		web.Fail(w, r, "PROBE_ERROR", fmt.Sprintf("probe failed: %v", err), http.StatusBadGateway)
		return
	}

	resp := h.parseProbeOutput(out, totalMs)
	if resp == nil {
		web.OK(w, r, llmProbeResponse{
			Results:   []llmProbeResult{},
			TotalMs:   totalMs,
			OkCount:   0,
			FailCount: 0,
		})
		return
	}
	web.OK(w, r, resp)
}

// maxExecArgs caps the number of CLI arguments to prevent abuse.
const maxExecArgs = 20

// maxExecOutputLen caps the output length returned to the client.
const maxExecOutputLen = 256 * 1024 // 256 KB

// remoteRPCMapping maps CLI arg patterns to Gateway RPC methods.
// Each entry: { args pattern → RPC method, RPC params }.
type rpcMapping struct {
	method string
	params map[string]interface{}
}

var remoteArgsMappings = []struct {
	args    []string
	mapping rpcMapping
}{
	{[]string{"--version"}, rpcMapping{"status", nil}},
	{[]string{"doctor", "--non-interactive"}, rpcMapping{"health", map[string]interface{}{"probe": false}}},
	{[]string{"models", "list", "--all", "--json"}, rpcMapping{"models.list", map[string]interface{}{}}},
	{[]string{"models", "aliases", "list", "--json"}, rpcMapping{"models.list", map[string]interface{}{}}},
	{[]string{"models", "fallbacks", "list", "--json"}, rpcMapping{"models.list", map[string]interface{}{}}},
	{[]string{"channels", "capabilities", "--json"}, rpcMapping{"channels.status", map[string]interface{}{}}},
	{[]string{"channels", "list", "--json"}, rpcMapping{"channels.status", map[string]interface{}{}}},
	{[]string{"channels", "status", "--json"}, rpcMapping{"channels.status", map[string]interface{}{}}},
	{[]string{"config", "get", ".", "--json"}, rpcMapping{"config.get", map[string]interface{}{}}},
	{[]string{"skills", "list", "--json"}, rpcMapping{"skills.status", map[string]interface{}{}}},
	{[]string{"skills", "check", "--json"}, rpcMapping{"skills.status", map[string]interface{}{}}},
	{[]string{"plugins", "list", "--json"}, rpcMapping{"skills.status", map[string]interface{}{}}},
	{[]string{"hooks", "list", "--json"}, rpcMapping{"config.get", map[string]interface{}{}}},
	{[]string{"memory", "status", "--json"}, rpcMapping{"config.get", map[string]interface{}{}}},
	{[]string{"security", "audit", "--json"}, rpcMapping{"health", map[string]interface{}{"probe": false}}},
	{[]string{"secrets", "audit", "--json"}, rpcMapping{"health", map[string]interface{}{"probe": false}}},
	{[]string{"update", "status", "--json"}, rpcMapping{"status", nil}},
	{[]string{"system", "presence", "--json"}, rpcMapping{"status", nil}},
	{[]string{"status", "--json"}, rpcMapping{"status", nil}},
	{[]string{"health", "--json"}, rpcMapping{"health", map[string]interface{}{"probe": false}}},
	{[]string{"sessions", "--json"}, rpcMapping{"sessions.list", map[string]interface{}{}}},
	{[]string{"cron", "list", "--json"}, rpcMapping{"cron.list", map[string]interface{}{}}},
	{[]string{"nodes", "list", "--json"}, rpcMapping{"node.list", map[string]interface{}{}}},
	{[]string{"agents", "list", "--json"}, rpcMapping{"agents.list", map[string]interface{}{}}},
	{[]string{"sandbox", "status", "--json"}, rpcMapping{"status", nil}},
	{[]string{"sessions", "cleanup", "--dry-run", "--json"}, rpcMapping{"sessions.list", map[string]interface{}{}}},
}

func findRemoteRPCMapping(args []string) *rpcMapping {
	for _, entry := range remoteArgsMappings {
		if equalStringSlices(args, entry.args) {
			return &entry.mapping
		}
	}
	// Also match dynamic patterns: models status [--probe] [--json] ...
	if len(args) >= 2 && args[0] == "models" && args[1] == "status" {
		return &rpcMapping{"models.list", map[string]interface{}{}}
	}
	if len(args) >= 2 && args[0] == "channels" && args[1] == "status" {
		return &rpcMapping{"channels.status", map[string]interface{}{}}
	}
	if len(args) >= 1 && args[0] == "logs" {
		p := map[string]interface{}{}
		for i := 1; i < len(args)-1; i++ {
			if args[i] == "--limit" {
				p["lines"] = args[i+1]
			}
		}
		return &rpcMapping{"logs.tail", p}
	}
	return nil
}

// ExecCapability returns the execution mode of the test center.
// GET /api/v1/llm/exec-capability
func (h *LLMHealthHandler) ExecCapability(w http.ResponseWriter, r *http.Request) {
	isRemote := h.svc.IsRemote()
	hasLocal := openclaw.IsOpenClawInstalled()
	gwConnected := h.gwClient != nil && h.gwClient.IsConnected()

	mode := "local"
	if isRemote {
		if gwConnected {
			mode = "remote"
		} else {
			mode = "unavailable"
		}
	} else if !hasLocal {
		mode = "unavailable"
	}

	web.OK(w, r, map[string]interface{}{
		"mode":         mode,
		"is_remote":    isRemote,
		"local_cli":    hasLocal,
		"gw_connected": gwConnected,
	})
}

// Exec runs an openclaw CLI command and returns its output.
// In local mode, executes via os/exec. In remote mode, proxies via GWClient RPC.
func (h *LLMHealthHandler) Exec(w http.ResponseWriter, r *http.Request) {
	var req cliExecRequest
	if r.Body != nil {
		json.NewDecoder(r.Body).Decode(&req)
	}

	if req.Command == "" {
		web.Fail(w, r, "BAD_REQUEST", "command is required", http.StatusBadRequest)
		return
	}

	// Security: only allow openclaw commands
	allowedCommands := map[string]bool{
		"openclaw": true,
	}
	baseCmd := strings.TrimSpace(req.Command)
	if !allowedCommands[baseCmd] {
		web.Fail(w, r, "FORBIDDEN", "only openclaw commands are allowed", http.StatusForbidden)
		return
	}

	// Security: limit argument count
	if len(req.Args) > maxExecArgs {
		web.Fail(w, r, "FORBIDDEN", fmt.Sprintf("too many arguments (max %d)", maxExecArgs), http.StatusForbidden)
		return
	}

	if err := validateCLIExecArgs(req.Args); err != nil {
		web.Fail(w, r, "FORBIDDEN", err.Error(), http.StatusForbidden)
		return
	}

	// Remote mode: proxy via GWClient RPC
	if h.svc.IsRemote() {
		h.execRemote(w, r, req)
		return
	}

	// Local mode: execute via os/exec
	h.execLocal(w, r, req)
}

func isNodeServiceLifecycleCommand(args []string) bool {
	if len(args) < 2 || args[0] != "node" {
		return false
	}
	switch args[1] {
	case "install", "start", "restart", "stop", "uninstall":
		return true
	default:
		return false
	}
}

// execRemote proxies CLI commands to the remote gateway via GWClient RPC mapping.
func (h *LLMHealthHandler) execRemote(w http.ResponseWriter, r *http.Request, req cliExecRequest) {
	if h.gwClient == nil || !h.gwClient.IsConnected() {
		web.Fail(w, r, "GW_NOT_CONNECTED", "remote gateway not connected", http.StatusBadGateway)
		return
	}

	mapping := findRemoteRPCMapping(req.Args)
	if mapping == nil {
		web.Fail(w, r, "REMOTE_UNSUPPORTED", "this command is not supported in remote mode", http.StatusBadRequest)
		return
	}

	timeoutMs := req.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = 30000
	}
	if timeoutMs > 120000 {
		timeoutMs = 120000
	}

	start := time.Now()
	data, err := h.gwClient.RequestWithTimeout(mapping.method, mapping.params, time.Duration(timeoutMs)*time.Millisecond)
	durationMs := time.Since(start).Milliseconds()

	if err != nil {
		logger.Doctor.Warn().
			Str("method", mapping.method).
			Strs("args", req.Args).
			Err(err).
			Msg("remote exec RPC failed")
		web.OK(w, r, cliExecResponse{
			ExitCode:   1,
			Stdout:     "",
			Stderr:     fmt.Sprintf("remote RPC %s failed: %v", mapping.method, err),
			DurationMs: durationMs,
		})
		return
	}

	stdout := string(data)
	logger.Doctor.Debug().
		Str("method", mapping.method).
		Strs("args", req.Args).
		Int64("durationMs", durationMs).
		Msg("remote exec RPC completed")

	web.OK(w, r, cliExecResponse{
		ExitCode:   0,
		Stdout:     stdout,
		Stderr:     "",
		DurationMs: durationMs,
	})
}

// execLocal runs CLI command locally via os/exec.
func (h *LLMHealthHandler) execLocal(w http.ResponseWriter, r *http.Request, req cliExecRequest) {
	timeoutMs := req.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = 30000
	}
	if timeoutMs > 120000 {
		timeoutMs = 120000
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	// Resolve actual command path
	cmdPath := openclaw.ResolveOpenClawCmd()
	if cmdPath == "" {
		web.Fail(w, r, "NOT_INSTALLED", "openclaw command not found", http.StatusBadGateway)
		return
	}
	if h.gwClient != nil && isNodeServiceLifecycleCommand(req.Args) {
		h.gwClient.SuppressHealthRestartFor(90 * time.Second)
	}

	start := time.Now()
	c := exec.CommandContext(ctx, cmdPath, req.Args...)
	executil.HideWindow(c)
	// Inject caller-supplied env vars (e.g. OPENCLAW_GATEWAY_TOKEN) and
	// the insecure-WS flag for node install to non-localhost without --tls.
	var extraEnv []string
	for k, v := range req.Env {
		if isAllowedExecEnvKey(k) {
			extraEnv = append(extraEnv, k+"="+v)
		}
	}
	if needsInsecurePrivateWS(req.Args) {
		extraEnv = append(extraEnv, "OPENCLAW_ALLOW_INSECURE_PRIVATE_WS=1")
	}
	if len(extraEnv) > 0 {
		c.Env = append(os.Environ(), extraEnv...)
	}
	stdout, err := c.Output()
	durationMs := time.Since(start).Milliseconds()

	exitCode := 0
	stderrStr := ""
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
			stderrStr = strings.TrimSpace(string(exitErr.Stderr))
		} else {
			exitCode = -1
			stderrStr = err.Error()
		}
	}

	logger.Doctor.Debug().
		Str("command", cmdPath).
		Strs("args", req.Args).
		Int("exitCode", exitCode).
		Int64("durationMs", durationMs).
		Msg("CLI exec completed")

	web.OK(w, r, cliExecResponse{
		ExitCode:   exitCode,
		Stdout:     string(stdout),
		Stderr:     stderrStr,
		DurationMs: durationMs,
	})
}

var exactReadonlyCLIArgs = [][]string{
	{"--version"},
	{"doctor", "--non-interactive"},
	{"models", "list", "--all", "--json"},
	{"models", "aliases", "list", "--json"},
	{"models", "fallbacks", "list", "--json"},
	{"channels", "capabilities", "--json"},
	{"channels", "list", "--json"},
	{"config", "get", ".", "--json"},
	{"skills", "list", "--json"},
	{"skills", "check", "--json"},
	{"plugins", "list", "--json"},
	{"hooks", "list", "--json"},
	{"memory", "status", "--json"},
	{"security", "audit", "--json"},
	{"secrets", "audit", "--json"},
	{"update", "status", "--json"},
	{"system", "presence", "--json"},
	{"status", "--json"},
	{"health", "--json"},
	{"sessions", "--json"},
	{"cron", "list", "--json"},
	{"nodes", "list", "--json"},
	{"agents", "list", "--json"},
	{"sandbox", "status", "--json"},
	{"sessions", "cleanup", "--dry-run", "--json"},
}

func validateCLIExecArgs(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("arguments are required")
	}

	for _, allowed := range exactReadonlyCLIArgs {
		if equalStringSlices(args, allowed) {
			return nil
		}
	}

	switch {
	case validateModelsStatusArgs(args):
		return nil
	case validateChannelsStatusArgs(args):
		return nil
	case validateLogsArgs(args):
		return nil
	case validateNodeServiceArgs(args):
		return nil
	default:
		return fmt.Errorf("command shape not allowed")
	}
}

func validateModelsStatusArgs(args []string) bool {
	if len(args) < 2 || args[0] != "models" || args[1] != "status" {
		return false
	}
	return validateFlags(args[2:], map[string]func(string) bool{
		"--probe":       nil,
		"--json":        nil,
		"--timeout":     func(v string) bool { return parseBoundedInt(v, 1, 120000) },
		"--concurrency": func(v string) bool { return parseBoundedInt(v, 1, 32) },
		"--max-tokens":  func(v string) bool { return parseBoundedInt(v, 1, 4096) },
	})
}

func validateChannelsStatusArgs(args []string) bool {
	if len(args) < 2 || args[0] != "channels" || args[1] != "status" {
		return false
	}
	return validateFlags(args[2:], map[string]func(string) bool{
		"--probe": nil,
		"--json":  nil,
	})
}

func validateLogsArgs(args []string) bool {
	if len(args) != 4 || args[0] != "logs" || args[1] != "--limit" || args[3] != "--json" {
		return false
	}
	return parseBoundedInt(args[2], 1, 200)
}

func validateNodeServiceArgs(args []string) bool {
	if len(args) < 2 || args[0] != "node" {
		return false
	}
	switch args[1] {
	case "status", "start", "restart", "stop", "uninstall":
		return len(args) == 3 && args[2] == "--json"
	case "install":
		return validateFlags(args[2:], map[string]func(string) bool{
			"--host":         validateSafeHost,
			"--port":         func(v string) bool { return parseBoundedInt(v, 1, 65535) },
			"--tls":          nil,
			"--node-id":      validateSafeNodeArg,
			"--display-name": validateSafeDisplayName,
			"--runtime":      func(v string) bool { return v == "node" || v == "bun" },
			"--force":        nil,
			"--json":         nil,
		})
	default:
		return false
	}
}

func validateFlags(args []string, allowed map[string]func(string) bool) bool {
	seen := make(map[string]struct{}, len(args))
	for i := 0; i < len(args); i++ {
		flag := args[i]
		validator, ok := allowed[flag]
		if !ok {
			return false
		}
		if _, exists := seen[flag]; exists {
			return false
		}
		seen[flag] = struct{}{}
		if validator == nil {
			continue
		}
		i++
		if i >= len(args) || !validator(args[i]) {
			return false
		}
	}
	return true
}

func parseBoundedInt(raw string, min, max int) bool {
	n, err := strconv.Atoi(raw)
	return err == nil && n >= min && n <= max
}

func validateSafeHost(v string) bool {
	if v == "" || len(v) > 255 || strings.ContainsAny(v, " \t\r\n\"'`;$|&<>") {
		return false
	}
	return true
}

func validateSafeNodeArg(v string) bool {
	if v == "" || len(v) > 128 {
		return false
	}
	for _, r := range v {
		if !(r == '-' || r == '_' || r == '.' || (r >= '0' && r <= '9') || (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z')) {
			return false
		}
	}
	return true
}

func validateSafeDisplayName(v string) bool {
	return v != "" && len(v) <= 80 && !strings.ContainsAny(v, "\r\n")
}

func equalStringSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// isAllowedExecEnvKey returns true for env var keys that callers may inject
// into CLI exec commands. Only allow specific OPENCLAW_ keys to prevent
// arbitrary environment manipulation.
var allowedExecEnvKeys = map[string]struct{}{
	"OPENCLAW_GATEWAY_TOKEN":             {},
	"OPENCLAW_ALLOW_INSECURE_PRIVATE_WS": {},
}

func isAllowedExecEnvKey(key string) bool {
	_, ok := allowedExecEnvKeys[key]
	return ok
}

// needsInsecurePrivateWS returns true when the CLI args represent a node
// install (or start) targeting a non-localhost host without --tls.  OpenClaw
// refuses plaintext ws:// connections to remote IPs unless the env var
// OPENCLAW_ALLOW_INSECURE_PRIVATE_WS=1 is present.
func needsInsecurePrivateWS(args []string) bool {
	if len(args) < 2 || args[0] != "node" {
		return false
	}
	if args[1] != "install" && args[1] != "start" {
		return false
	}
	hasTLS := false
	host := ""
	for i := 2; i < len(args); i++ {
		if args[i] == "--tls" {
			hasTLS = true
		}
		if args[i] == "--host" && i+1 < len(args) {
			host = args[i+1]
		}
	}
	if hasTLS || host == "" {
		return false
	}
	// localhost targets don't need the insecure flag
	h := strings.ToLower(host)
	return h != "127.0.0.1" && h != "localhost" && h != "::1"
}

// ---------- parsers ----------

func (h *LLMHealthHandler) parseModelsStatusOutput(raw string) *llmModelsStatusResponse {
	if raw == "" {
		return nil
	}

	// Try to parse the JSON output from `openclaw models status --json`
	var parsed map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		// Try to find JSON in the output (may have non-JSON prefix)
		idx := strings.Index(raw, "{")
		if idx < 0 {
			return nil
		}
		if err := json.Unmarshal([]byte(raw[idx:]), &parsed); err != nil {
			return nil
		}
	}

	resp := &llmModelsStatusResponse{
		Providers: llmAuthHealthResponse{
			Profiles:  []llmProviderStatus{},
			Providers: []llmProviderSummary{},
		},
		Models:    []llmModelEntry{},
		Fallbacks: []llmFallbackChain{},
	}

	// Parse auth/profiles
	if authRaw, ok := parsed["auth"]; ok {
		var authData []map[string]interface{}
		if json.Unmarshal(authRaw, &authData) == nil {
			for _, a := range authData {
				profile := llmProviderStatus{
					Provider:   getString(a, "provider"),
					ProfileID:  getString(a, "profileId"),
					Label:      getString(a, "label"),
					Source:     getString(a, "source"),
					AuthStatus: getString(a, "status"),
					AuthType:   getString(a, "type"),
				}
				if v, ok := a["expiresAt"].(float64); ok {
					profile.ExpiresAt = v
				}
				if v, ok := a["remainingMs"].(float64); ok {
					profile.RemainingMs = v
				}
				resp.Providers.Profiles = append(resp.Providers.Profiles, profile)
			}
		}
	}

	// Build provider summaries from profiles
	providerMap := map[string]*llmProviderSummary{}
	for _, p := range resp.Providers.Profiles {
		if _, ok := providerMap[p.Provider]; !ok {
			providerMap[p.Provider] = &llmProviderSummary{
				Provider:     p.Provider,
				Status:       p.AuthStatus,
				ProfileCount: 0,
			}
		}
		providerMap[p.Provider].ProfileCount++
		// Escalate status: expired > expiring > missing > static > ok
		existing := providerMap[p.Provider]
		if authStatusPriority(p.AuthStatus) > authStatusPriority(existing.Status) {
			existing.Status = p.AuthStatus
		}
	}
	for _, ps := range providerMap {
		resp.Providers.Providers = append(resp.Providers.Providers, *ps)
	}

	// Parse models
	if modelsRaw, ok := parsed["models"]; ok {
		var modelsData []map[string]interface{}
		if json.Unmarshal(modelsRaw, &modelsData) == nil {
			for _, m := range modelsData {
				entry := llmModelEntry{
					Provider: getString(m, "provider"),
					Model:    getString(m, "model"),
					Role:     getString(m, "role"),
					Source:   getString(m, "source"),
				}
				resp.Models = append(resp.Models, entry)
			}
		}
	}

	// Parse fallbacks
	if fbRaw, ok := parsed["fallbacks"]; ok {
		var fbData []map[string]interface{}
		if json.Unmarshal(fbRaw, &fbData) == nil {
			for _, fb := range fbData {
				chain := llmFallbackChain{
					Role: getString(fb, "role"),
				}
				if chainRaw, ok := fb["chain"]; ok {
					chainBytes, _ := json.Marshal(chainRaw)
					var chainModels []map[string]interface{}
					if json.Unmarshal(chainBytes, &chainModels) == nil {
						for _, cm := range chainModels {
							chain.Chain = append(chain.Chain, llmModelEntry{
								Provider: getString(cm, "provider"),
								Model:    getString(cm, "model"),
							})
						}
					}
				}
				resp.Fallbacks = append(resp.Fallbacks, chain)
			}
		}
	}

	return resp
}

func (h *LLMHealthHandler) parseAuthHealth(raw string) *llmAuthHealthResponse {
	full := h.parseModelsStatusOutput(raw)
	if full == nil {
		return nil
	}
	return &full.Providers
}

func (h *LLMHealthHandler) parseProbeOutput(raw string, totalMs int64) *llmProbeResponse {
	if raw == "" {
		return nil
	}

	// Try to parse the JSON output from `openclaw models status --probe --json`
	var parsed map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		idx := strings.Index(raw, "{")
		if idx < 0 {
			return nil
		}
		if err := json.Unmarshal([]byte(raw[idx:]), &parsed); err != nil {
			return nil
		}
	}

	resp := &llmProbeResponse{
		Results: []llmProbeResult{},
		TotalMs: totalMs,
	}

	// Parse probe results
	if probeRaw, ok := parsed["probe"]; ok {
		var probeData []map[string]interface{}
		if json.Unmarshal(probeRaw, &probeData) == nil {
			for _, p := range probeData {
				result := llmProbeResult{
					Provider:  getString(p, "provider"),
					Model:     getString(p, "model"),
					ProfileID: getString(p, "profileId"),
					Label:     getString(p, "label"),
					Source:    getString(p, "source"),
					Mode:      getString(p, "mode"),
					Status:    getString(p, "status"),
					Error:     getString(p, "error"),
				}
				if v, ok := p["latencyMs"].(float64); ok {
					result.LatencyMs = int64(v)
				}
				resp.Results = append(resp.Results, result)
				if result.Status == "ok" {
					resp.OkCount++
				} else {
					resp.FailCount++
				}
			}
		}
	}

	// If no "probe" key, try "results" or the top-level array
	if len(resp.Results) == 0 {
		if resultsRaw, ok := parsed["results"]; ok {
			var resultsData []map[string]interface{}
			if json.Unmarshal(resultsRaw, &resultsData) == nil {
				for _, p := range resultsData {
					result := llmProbeResult{
						Provider:  getString(p, "provider"),
						Model:     getString(p, "model"),
						ProfileID: getString(p, "profileId"),
						Label:     getString(p, "label"),
						Source:    getString(p, "source"),
						Mode:      getString(p, "mode"),
						Status:    getString(p, "status"),
						Error:     getString(p, "error"),
					}
					if v, ok := p["latencyMs"].(float64); ok {
						result.LatencyMs = int64(v)
					}
					resp.Results = append(resp.Results, result)
					if result.Status == "ok" {
						resp.OkCount++
					} else {
						resp.FailCount++
					}
				}
			}
		}
	}

	return resp
}

// ---------- helpers ----------

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func authStatusPriority(status string) int {
	switch status {
	case "expired":
		return 4
	case "missing":
		return 3
	case "expiring":
		return 2
	case "static":
		return 1
	case "ok":
		return 0
	default:
		return 0
	}
}
