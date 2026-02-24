package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"time"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/setup"
	"ClawDeckX/internal/web"
)

// SetupWizardHandler handles the setup wizard API.
type SetupWizardHandler struct {
	auditRepo *database.AuditLogRepo
	svc       *openclaw.Service
	gwClient  *openclaw.GWClient
}

// NewSetupWizardHandler creates a new SetupWizardHandler.
func NewSetupWizardHandler(svc *openclaw.Service) *SetupWizardHandler {
	return &SetupWizardHandler{
		svc: svc,
	}
}

// SetGWClient injects the Gateway WebSocket client.
func (h *SetupWizardHandler) SetGWClient(client *openclaw.GWClient) {
	h.gwClient = client
}

// SetAuditRepo sets the audit log repository.
func (h *SetupWizardHandler) SetAuditRepo(repo *database.AuditLogRepo) {
	h.auditRepo = repo
}

// Scan runs an environment scan.
// GET /api/v1/setup/scan
func (h *SetupWizardHandler) Scan(w http.ResponseWriter, r *http.Request) {
	report, err := setup.Scan()
	if err != nil {
		web.Fail(w, r, "SCAN_ERROR", err.Error(), http.StatusInternalServerError)
		return
	}
	web.OK(w, r, report)
}

// InstallDepsRequest is the install dependencies request.
type InstallDepsRequest struct {
	InstallNode bool `json:"installNode"`
	InstallGit  bool `json:"installGit"`
}

// InstallDeps installs dependencies (SSE streaming).
// POST /api/v1/setup/install-deps
func (h *SetupWizardHandler) InstallDeps(w http.ResponseWriter, r *http.Request) {
	var req InstallDepsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		// install all missing deps by default
		req.InstallNode = true
		req.InstallGit = true
	}

	// create SSE event emitter
	emitter, err := setup.NewEventEmitter(w)
	if err != nil {
		web.Fail(w, r, "SSE_ERROR", err.Error(), http.StatusInternalServerError)
		return
	}

	env, err := setup.Scan()
	if err != nil {
		emitter.EmitError("environment scan failed", map[string]string{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()

	installer := setup.NewInstaller(emitter, env)

	if req.InstallNode && !env.Tools["node"].Installed {
		if err := installer.InstallNode(ctx); err != nil {
			emitter.EmitError("Node.js install failed", map[string]string{"error": err.Error()})
			return
		}
	}

	if req.InstallGit && !env.Tools["git"].Installed {
		if err := installer.InstallGit(ctx); err != nil {
			emitter.EmitError("Git install failed", map[string]string{"error": err.Error()})
			return
		}
	}

	emitter.EmitComplete("dependency install complete", nil)
}

// InstallOpenClawRequest is the install OpenClaw request.
type InstallOpenClawRequest struct {
	Method  string `json:"method,omitempty"` // "installer-script" | "npm"
	Version string `json:"version,omitempty"`
}

// InstallOpenClaw installs OpenClaw (SSE streaming).
// POST /api/v1/setup/install-openclaw
func (h *SetupWizardHandler) InstallOpenClaw(w http.ResponseWriter, r *http.Request) {
	var req InstallOpenClawRequest
	json.NewDecoder(r.Body).Decode(&req)

	emitter, err := setup.NewEventEmitter(w)
	if err != nil {
		web.Fail(w, r, "SSE_ERROR", err.Error(), http.StatusInternalServerError)
		return
	}

	env, err := setup.Scan()
	if err != nil {
		emitter.EmitError("environment scan failed", map[string]string{"error": err.Error()})
		return
	}

	// override recommended method if specified
	if req.Method != "" {
		env.RecommendedMethod = req.Method
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Minute)
	defer cancel()

	installer := setup.NewInstaller(emitter, env)

	if err := installer.InstallOpenClaw(ctx); err != nil {
		emitter.EmitError("OpenClaw install failed", map[string]string{"error": err.Error()})
		return
	}

	emitter.EmitComplete("OpenClaw install complete", nil)
}

// ConfigureRequest is the configure request.
type ConfigureRequest struct {
	Provider string `json:"provider"`
	APIKey   string `json:"apiKey"`
	Model    string `json:"model,omitempty"`
	BaseURL  string `json:"baseUrl,omitempty"`
}

// Configure configures OpenClaw.
// POST /api/v1/setup/configure
func (h *SetupWizardHandler) Configure(w http.ResponseWriter, r *http.Request) {
	var req ConfigureRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	if req.Provider == "" || req.APIKey == "" {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	env, err := setup.Scan()
	if err != nil {
		web.FailErr(w, r, web.ErrScanError, err.Error())
		return
	}

	ctx := r.Context()
	installer := setup.NewInstaller(nil, env)

	config := setup.InstallConfig{
		Provider: req.Provider,
		APIKey:   req.APIKey,
		Model:    req.Model,
		BaseURL:  req.BaseURL,
	}

	if err := installer.ConfigureOpenClaw(ctx, config); err != nil {
		web.Fail(w, r, "CONFIG_ERROR", err.Error(), http.StatusInternalServerError)
		return
	}

	web.OK(w, r, map[string]string{"message": "ok"})
}

// StartGateway starts the Gateway.
// POST /api/v1/setup/start-gateway
func (h *SetupWizardHandler) StartGateway(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.Start(); err != nil {
		web.Fail(w, r, "START_ERROR", err.Error(), http.StatusInternalServerError)
		return
	}

	// wait for ready
	for i := 0; i < 10; i++ {
		time.Sleep(500 * time.Millisecond)
		status := h.svc.Status()
		if status.Running {
			web.OK(w, r, map[string]interface{}{
				"running": true,
				"detail":  status.Detail,
			})
			return
		}
	}

	web.FailErr(w, r, web.ErrGWStartTimeout)
}

// Verify verifies the installation.
// POST /api/v1/setup/verify
func (h *SetupWizardHandler) Verify(w http.ResponseWriter, r *http.Request) {
	result := setup.QuickCheck()
	web.OK(w, r, result)
}

// AutoInstallRequest is the auto-install request.
type AutoInstallRequest struct {
	Provider          string `json:"provider"`
	APIKey            string `json:"apiKey"`
	Model             string `json:"model,omitempty"`
	BaseURL           string `json:"baseUrl,omitempty"`
	Registry          string `json:"registry,omitempty"`
	InstallZeroTier   bool   `json:"installZeroTier,omitempty"`
	ZerotierNetworkId string `json:"zerotierNetworkId,omitempty"`
	InstallTailscale  bool   `json:"installTailscale,omitempty"`
	SkipConfig        bool   `json:"skipConfig,omitempty"`
	SkipGateway       bool   `json:"skipGateway,omitempty"`
	SudoPassword      string `json:"sudoPassword,omitempty"`
}

// AutoInstall runs full automatic installation (SSE streaming).
// POST /api/v1/setup/auto-install
func (h *SetupWizardHandler) AutoInstall(w http.ResponseWriter, r *http.Request) {
	var req AutoInstallRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		// allow no-param call (install only, no config)
		req.Provider = ""
		req.APIKey = ""
	}

	emitter, err := setup.NewEventEmitter(w)
	if err != nil {
		web.Fail(w, r, "SSE_ERROR", err.Error(), http.StatusInternalServerError)
		return
	}

	emitter.EmitPhase("scan", "scanning environment...", 0)
	env, err := setup.Scan()
	if err != nil {
		emitter.EmitError("environment scan failed", map[string]string{"error": err.Error()})
		return
	}
	emitter.EmitSuccess("environment scan complete", env)

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Minute)
	defer cancel()

	installer := setup.NewInstaller(emitter, env)

	config := setup.InstallConfig{
		Provider:          req.Provider,
		APIKey:            req.APIKey,
		Model:             req.Model,
		BaseURL:           req.BaseURL,
		Version:           "openclaw",
		Registry:          req.Registry,
		InstallZeroTier:   req.InstallZeroTier,
		ZerotierNetworkId: req.ZerotierNetworkId,
		InstallTailscale:  req.InstallTailscale,
		SkipConfig:        req.SkipConfig,
		SkipGateway:       req.SkipGateway,
		SudoPassword:      req.SudoPassword,
	}

	_, err = installer.AutoInstall(ctx, config)
	if err != nil {
		// error already sent in AutoInstall
		return
	}

	// after install, read gateway token from openclaw.json and reconnect GWClient
	h.syncGatewayToken()
}

// syncGatewayToken reads gateway.auth.token from openclaw.json and reconnects GWClient.
func (h *SetupWizardHandler) syncGatewayToken() {
	if h.gwClient == nil {
		return
	}
	configPath := setup.GetOpenClawConfigPath()
	if configPath == "" {
		return
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		return
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return
	}
	gw, ok := raw["gateway"].(map[string]interface{})
	if !ok {
		return
	}
	auth, ok := gw["auth"].(map[string]interface{})
	if !ok {
		return
	}
	token, ok := auth["token"].(string)
	if !ok || token == "" {
		return
	}

	// reconnect GWClient with new token
	oldCfg := h.gwClient.GetConfig()
	if oldCfg.Token != token {
		h.gwClient.Reconnect(openclaw.GWClientConfig{
			Host:  oldCfg.Host,
			Port:  oldCfg.Port,
			Token: token,
		})
	}
}

// UpdateOpenClaw updates OpenClaw to the latest version (SSE streaming).
// POST /api/v1/setup/update-openclaw
func (h *SetupWizardHandler) UpdateOpenClaw(w http.ResponseWriter, r *http.Request) {
	emitter, err := setup.NewEventEmitter(w)
	if err != nil {
		web.Fail(w, r, "SSE_ERROR", err.Error(), http.StatusInternalServerError)
		return
	}

	emitter.EmitPhase("update", "Checking current version...", 0)

	env, err := setup.Scan()
	if err != nil {
		emitter.EmitError("environment scan failed", map[string]string{"error": err.Error()})
		return
	}

	if !env.OpenClawInstalled {
		emitter.EmitError("OpenClaw is not installed", nil)
		return
	}

	oldVersion := ""
	if info, ok := env.Tools["openclaw"]; ok {
		oldVersion = info.Version
	}
	emitter.EmitLog("Current version: " + oldVersion)

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()

	installer := setup.NewInstaller(emitter, env)

	// Stop gateway before update to release file locks (avoids EBUSY on Windows)
	gwWasRunning := false
	if h.svc != nil {
		emitter.EmitPhase("stop-gateway", "Stopping gateway...", 10)
		if err := h.svc.Stop(); err == nil {
			gwWasRunning = true
			time.Sleep(2 * time.Second)
		}
	}

	emitter.EmitPhase("update", "Updating OpenClaw...", 20)
	if err := installer.UpdateOpenClaw(ctx); err != nil {
		// Try to restart gateway even if update failed
		if gwWasRunning && h.svc != nil {
			_ = h.svc.Start()
		}
		emitter.EmitError("Update failed: "+err.Error(), nil)
		return
	}

	// Re-scan to get new version
	emitter.EmitPhase("verify", "Verifying update...", 80)
	newEnv, _ := setup.Scan()
	newVersion := ""
	if newEnv != nil {
		if info, ok := newEnv.Tools["openclaw"]; ok {
			newVersion = info.Version
		}
	}

	// Restart gateway after update
	if gwWasRunning && h.svc != nil {
		emitter.EmitPhase("restart", "Restarting gateway...", 90)
		time.Sleep(1 * time.Second)
		_ = h.svc.Start()
	}

	emitter.EmitComplete("Update complete", map[string]interface{}{
		"oldVersion": oldVersion,
		"newVersion": newVersion,
	})
}

// Status returns installation status (quick check).
// GET /api/v1/setup/status
func (h *SetupWizardHandler) Status(w http.ResponseWriter, r *http.Request) {
	result := setup.QuickCheck()
	web.OK(w, r, result)
}

// Uninstall uninstalls OpenClaw.
// POST /api/v1/setup/uninstall
func (h *SetupWizardHandler) Uninstall(w http.ResponseWriter, r *http.Request) {
	clawCmd := openclaw.ResolveOpenClawCmd()
	if clawCmd == "" {
		web.FailErr(w, r, web.ErrOpenClawNotInstalled)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()

	output, err := openclaw.RunCLI(ctx, "uninstall", "--all", "--yes", "--non-interactive")
	if err != nil {
		web.FailErr(w, r, web.ErrUninstallFailed, err.Error())
		return
	}

	npmPkg := clawCmd
	npmOutput, npmErr := openclaw.NpmUninstallGlobal(ctx, npmPkg)
	if npmErr != nil {
		web.OK(w, r, map[string]string{
			"message": "config cleaned, but CLI uninstall failed. Run manually: npm uninstall -g " + npmPkg,
			"output":  output + "\n" + npmOutput,
			"command": clawCmd,
			"warning": npmErr.Error(),
		})
		return
	}

	web.OK(w, r, map[string]string{
		"message": "ok",
		"output":  output + "\n" + npmOutput,
		"command": clawCmd,
	})
}
