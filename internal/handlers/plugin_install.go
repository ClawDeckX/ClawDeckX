package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"time"

	"ClawDeckX/internal/executil"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// PluginInstallHandler handles OpenClaw plugin installation.
type PluginInstallHandler struct {
	gwClient *openclaw.GWClient
}

func NewPluginInstallHandler(gwClient *openclaw.GWClient) *PluginInstallHandler {
	return &PluginInstallHandler{
		gwClient: gwClient,
	}
}

// isRemoteGateway checks if the connected gateway is remote.
func (h *PluginInstallHandler) isRemoteGateway() bool {
	if h.gwClient == nil {
		return false
	}
	cfg := h.gwClient.GetConfig()
	host := strings.ToLower(strings.TrimSpace(cfg.Host))
	if host == "" || host == "localhost" || host == "127.0.0.1" || host == "::1" {
		return false
	}
	return true
}

// extractPluginIdFromSpec extracts the plugin ID from an npm spec.
// Examples:
//   - "@openclaw/feishu" -> "feishu"
//   - "@openclaw-china/dingtalk" -> "dingtalk"
//   - "@openclaw/msteams" -> "msteams"
//   - "some-plugin" -> "some-plugin"
func extractPluginIdFromSpec(spec string) string {
	// Remove version suffix if present (e.g., "@scope/pkg@1.0.0" -> "@scope/pkg")
	if idx := strings.LastIndex(spec, "@"); idx > 0 {
		spec = spec[:idx]
	}
	// Extract package name after last slash
	if idx := strings.LastIndex(spec, "/"); idx >= 0 {
		return spec[idx+1:]
	}
	// No slash, return as-is (might be a simple package name)
	return spec
}

func normalizeNpmPackageSpec(spec string) string {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return ""
	}
	if strings.HasPrefix(spec, "@") {
		if idx := strings.LastIndex(spec, "@"); idx > 0 {
			return spec[:idx]
		}
		return spec
	}
	if idx := strings.Index(spec, "@"); idx > 0 {
		return spec[:idx]
	}
	return spec
}

func fetchNpmLatestVersion(ctx context.Context, spec string) (string, error) {
	pkg := normalizeNpmPackageSpec(spec)
	if pkg == "" {
		return "", nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://registry.npmjs.org/"+url.PathEscape(pkg)+"/latest", nil)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", nil
	}
	var npmResp struct {
		Version string `json:"version"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&npmResp); err != nil {
		return "", err
	}
	return strings.TrimPrefix(strings.TrimSpace(npmResp.Version), "v"), nil
}

func enrichPluginUpdateInfo(ctx context.Context, plugins []interface{}) {
	latestCache := map[string]string{}
	for _, raw := range plugins {
		plugin, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		installSource, _ := plugin["installSource"].(string)
		// Only npm-installed plugins can be checked for updates via the registry.
		// Bundled/local/cli plugins are managed by the gateway itself.
		if installSource != "npm" {
			if installSource == "bundled" || installSource == "local" || installSource == "cli" {
				plugin["updateAvailable"] = false
			}
			continue
		}
		spec, _ := plugin["spec"].(string)
		pkg := normalizeNpmPackageSpec(spec)
		if pkg == "" {
			continue
		}
		latestVersion, ok := latestCache[pkg]
		if !ok {
			latestVersion, _ = fetchNpmLatestVersion(ctx, spec)
			latestCache[pkg] = latestVersion
		}
		if latestVersion == "" {
			plugin["updateAvailable"] = false
			continue
		}
		plugin["latestVersion"] = latestVersion
		currentVersion, _ := plugin["version"].(string)
		currentVersion = extractSemver(currentVersion)
		if currentVersion == "" {
			plugin["updateAvailable"] = false
			continue
		}
		plugin["updateAvailable"] = compareSemver(latestVersion, currentVersion) > 0
	}
}

// CanInstall returns whether plugin installation is available (local gateway only).
// GET /api/v1/plugins/can-install
func (h *PluginInstallHandler) CanInstall(w http.ResponseWriter, r *http.Request) {
	isRemote := h.isRemoteGateway()
	web.OK(w, r, map[string]interface{}{
		"can_install": !isRemote,
		"is_remote":   isRemote,
	})
}

// CheckInstalled checks if a plugin is already installed by querying Gateway config.
// GET /api/v1/plugins/check?spec=@scope/package
func (h *PluginInstallHandler) CheckInstalled(w http.ResponseWriter, r *http.Request) {
	spec := strings.TrimSpace(r.URL.Query().Get("spec"))
	if spec == "" {
		web.Fail(w, r, "INVALID_PARAMS", "spec is required", http.StatusBadRequest)
		return
	}

	// Query Gateway for config
	if h.gwClient == nil {
		web.OK(w, r, map[string]interface{}{
			"installed": false,
			"spec":      spec,
		})
		return
	}

	// Get config via Gateway RPC
	resp, err := h.gwClient.Request("config.get", map[string]interface{}{})
	if err != nil {
		logger.Log.Debug().Err(err).Msg("failed to get config from gateway")
		web.OK(w, r, map[string]interface{}{
			"installed": false,
			"spec":      spec,
		})
		return
	}

	// Parse response to check plugins.installs
	// Gateway config.get returns ConfigFileSnapshot: { config: OpenClawConfig, ... }
	// OpenClawConfig contains plugins.installs as Record<pluginId, PluginInstallRecord>
	// We need to match by:
	// 1. Plugin ID (key) - e.g., "feishu" matches spec "@openclaw/feishu"
	// 2. spec field in the record
	installed := false
	matchedPluginId := ""
	specPluginId := extractPluginIdFromSpec(spec)
	var installedPluginIds []string

	var respMap map[string]interface{}
	if err := json.Unmarshal(resp, &respMap); err == nil {
		// config.get returns ConfigFileSnapshot, the actual config is in the "config" field
		configObj := respMap
		if cfg, ok := respMap["config"].(map[string]interface{}); ok {
			configObj = cfg
		}

		if plugins, ok := configObj["plugins"].(map[string]interface{}); ok {
			if installs, ok := plugins["installs"].(map[string]interface{}); ok {
				for pluginId, install := range installs {
					installedPluginIds = append(installedPluginIds, pluginId)

					// Method 1: Match by plugin ID (key)
					if pluginId == specPluginId {
						installed = true
						matchedPluginId = pluginId
						break
					}

					// Method 2: Match by spec field in the record
					if installMap, ok := install.(map[string]interface{}); ok {
						if installedSpec, ok := installMap["spec"].(string); ok {
							// Match by spec (exact or without version)
							if installedSpec == spec || strings.HasPrefix(installedSpec, spec+"@") || strings.HasPrefix(spec, installedSpec+"@") {
								installed = true
								matchedPluginId = pluginId
								break
							}
						}
					}
				}
			} else {
				logger.Log.Debug().Msg("plugins.installs not found or not a map")
			}
		} else {
			logger.Log.Debug().Msg("plugins not found or not a map")
		}
	} else {
		logger.Log.Debug().Err(err).Msg("failed to unmarshal config response")
	}

	// Fallback 1 — plugins.entries: when plugins.installs has no matching
	// record, the plugin may still have a runtime entry in config (user-
	// configured or auto-registered).  OpenClaw core gateway does NOT expose a
	// `plugins.status` RPC (only config.get and channels.status), so we must
	// read from config.
	loadedWithoutRecord := false
	if !installed && specPluginId != "" {
		var respMap map[string]interface{}
		if json.Unmarshal(resp, &respMap) == nil {
			configObj := respMap
			if cfg, ok := respMap["config"].(map[string]interface{}); ok {
				configObj = cfg
			}
			if plugins, ok := configObj["plugins"].(map[string]interface{}); ok {
				if entries, ok := plugins["entries"].(map[string]interface{}); ok {
					if _, present := entries[specPluginId]; present {
						installed = true
						matchedPluginId = specPluginId
						loadedWithoutRecord = true
					}
				}
			}
		}
	}

	// Fallback 2 — channels.status: for channel plugins, a channel only appears
	// in the registered channels map when its plugin is actually loaded at
	// runtime.  This catches residue-directory plugins (loaded without install
	// record AND without an entries block).  In openclaw's channels.status
	// response, channels are keyed by plugin.id.
	if !installed && specPluginId != "" {
		if chResp, cerr := h.gwClient.RequestWithTimeout("channels.status", map[string]interface{}{}, 3*time.Second); cerr == nil {
			var chMap map[string]interface{}
			if jerr := json.Unmarshal(chResp, &chMap); jerr == nil {
				if channels, ok := chMap["channels"].(map[string]interface{}); ok {
					if _, present := channels[specPluginId]; present {
						installed = true
						matchedPluginId = specPluginId
						loadedWithoutRecord = true
					}
				}
			}
		} else {
			logger.Log.Debug().Err(cerr).Msg("channels.status fallback failed during CheckInstalled")
		}
	}

	logger.Log.Info().
		Str("spec", spec).
		Str("specPluginId", specPluginId).
		Strs("installedPluginIds", installedPluginIds).
		Bool("installed", installed).
		Bool("loadedWithoutRecord", loadedWithoutRecord).
		Str("matchedPluginId", matchedPluginId).
		Msg("plugin install check")

	web.OK(w, r, map[string]interface{}{
		"installed":           installed,
		"loadedWithoutRecord": loadedWithoutRecord,
		"spec":                spec,
	})
}

type pluginInstallRequest struct {
	Spec  string `json:"spec"`  // npm spec like "@openclaw/feishu"
	Force bool   `json:"force"` // if true, uninstall any pre-existing plugin first (cleans up residue from a prior failed install)
	// DangerouslyForce bypasses the upstream install-time security scanner
	// (critical code-pattern rules). Used only after the user explicitly
	// approves a retry when the first attempt is blocked by security_scan_blocked.
	DangerouslyForce bool `json:"dangerouslyForce"`
}

// isSecurityScanBlockedError returns true when the upstream openclaw CLI blocked
// the install via its install-time security scanner (see upstream
// src/plugins/install-security-scan.runtime.ts → buildCriticalBlockReason).
func isSecurityScanBlockedError(msg string) bool {
	lower := strings.ToLower(msg)
	return strings.Contains(lower, "security_scan_blocked") ||
		strings.Contains(lower, "dangerous code patterns detected")
}

// Install installs an OpenClaw plugin via CLI.
// POST /api/v1/plugins/install
func (h *PluginInstallHandler) Install(w http.ResponseWriter, r *http.Request) {
	// Only allow local gateway
	if h.isRemoteGateway() {
		web.Fail(w, r, "REMOTE_GATEWAY", "Plugin installation is only available for local gateway. Please install manually via CLI.", http.StatusBadRequest)
		return
	}

	var req pluginInstallRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.Fail(w, r, "INVALID_JSON", err.Error(), http.StatusBadRequest)
		return
	}

	spec := strings.TrimSpace(req.Spec)
	if spec == "" {
		web.Fail(w, r, "INVALID_PARAMS", "spec is required", http.StatusBadRequest)
		return
	}

	// Security: validate spec format (must be npm package spec)
	if !isValidNpmSpec(spec) {
		web.Fail(w, r, "INVALID_SPEC", "invalid npm package spec", http.StatusBadRequest)
		return
	}

	// If force=true, uninstall any pre-existing plugin first. This cleans up
	// residue directories left by a prior failed install (the CLI refuses to
	// install if /extensions/<id> already exists).  Errors are ignored — the
	// plugin may not be present, and that's fine.
	if req.Force {
		pluginId := extractPluginIdFromSpec(spec)
		if pluginId != "" {
			logger.Log.Info().Str("pluginId", pluginId).Msg("force=true: uninstalling any existing plugin before install")
			h.runUninstallForForce(pluginId)
		}
	}

	logger.Log.Info().Str("spec", spec).Bool("force", req.Force).Bool("dangerouslyForce", req.DangerouslyForce).Msg("installing plugin")

	// Run openclaw plugins install <spec> [--dangerously-force-unsafe-install]
	// The upstream install-time security scanner may raise false-positives on
	// plugin test files shipped in npm tarballs. The flag is only appended when
	// the caller explicitly opts in after a security_scan_blocked failure.
	cliArgs := []string{"plugins", "install", spec}
	if req.DangerouslyForce {
		cliArgs = append(cliArgs, "--dangerously-force-unsafe-install")
	}
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		// On Windows, use cmd.exe /c to run the openclaw command
		// This handles .cmd/.bat files and PATH resolution correctly
		cmd = exec.Command("cmd.exe", append([]string{"/c", "openclaw"}, cliArgs...)...)
	} else {
		cmd = exec.Command("openclaw", cliArgs...)
	}
	executil.HideWindow(cmd)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// Set timeout
	done := make(chan error, 1)
	go func() {
		done <- cmd.Run()
	}()

	select {
	case err := <-done:
		if err != nil {
			errMsg := stderr.String()
			if errMsg == "" {
				errMsg = stdout.String()
			}
			if errMsg == "" {
				errMsg = err.Error()
			}
			logger.Log.Error().Err(err).Str("spec", spec).Str("stderr", errMsg).Msg("plugin install failed")
			// Detect the "plugin already exists: <path> (delete it first)" error
			// so the frontend can offer a force-retry (which will uninstall first).
			if isPluginAlreadyExistsError(errMsg) {
				web.Fail(w, r, "PLUGIN_EXISTS", errMsg, http.StatusConflict)
				return
			}
			// Detect upstream install-time security scanner block so the UI can
			// offer an explicit force-unsafe retry with a warning.
			if !req.DangerouslyForce && isSecurityScanBlockedError(errMsg) {
				web.Fail(w, r, "SECURITY_BLOCKED", errMsg, http.StatusUnprocessableEntity)
				return
			}
			web.Fail(w, r, "INSTALL_FAILED", errMsg, http.StatusInternalServerError)
			return
		}
	case <-time.After(5 * time.Minute):
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
		logger.Log.Error().Str("spec", spec).Msg("plugin install timeout")
		web.Fail(w, r, "INSTALL_TIMEOUT", "installation timed out after 5 minutes", http.StatusGatewayTimeout)
		return
	}

	output := stdout.String()
	combined := output + "\n" + stderr.String()

	// CLI may exit 0 but still report failure in output.
	if strings.Contains(output, "Failed to install") || strings.Contains(output, "Failed to update") {
		logger.Log.Warn().Str("spec", spec).Str("output", output).Msg("plugin install command exited 0 but output indicates failure")
		if isPluginAlreadyExistsError(combined) {
			web.Fail(w, r, "PLUGIN_EXISTS", combined, http.StatusConflict)
			return
		}
		if !req.DangerouslyForce && isSecurityScanBlockedError(combined) {
			web.Fail(w, r, "SECURITY_BLOCKED", combined, http.StatusUnprocessableEntity)
			return
		}
		web.OK(w, r, map[string]interface{}{
			"success": false,
			"spec":    spec,
			"output":  output,
		})
		return
	}

	// Some CLI versions exit 0 and don't print "Failed to install" but still
	// emit "plugin already exists" on stderr.  Catch that case explicitly.
	if isPluginAlreadyExistsError(combined) {
		logger.Log.Warn().Str("spec", spec).Str("combined", combined).Msg("plugin install reported already-exists despite exit 0")
		web.Fail(w, r, "PLUGIN_EXISTS", combined, http.StatusConflict)
		return
	}

	logger.Log.Info().Str("spec", spec).Str("output", output).Msg("plugin installed successfully")

	// Auto-add to plugins.allow so the gateway loads it without manual config.
	// The install may trigger a gateway restart (config change → SIGUSR1), which
	// closes the WS connection before we can call ensurePluginAllowed. To handle
	// this, try once synchronously; on failure, retry in a background goroutine
	// that waits for the WS to reconnect.
	pluginId := extractPluginIdFromSpec(spec)
	if pluginId != "" {
		if err := h.ensurePluginAllowed(pluginId); err != nil {
			logger.Log.Warn().Err(err).Str("pluginId", pluginId).Msg("ensurePluginAllowed failed (gateway likely restarting), will retry after reconnect")
			go h.ensurePluginAllowedRetry(pluginId, 60*time.Second)
		}
	}

	web.OK(w, r, map[string]interface{}{
		"success": true,
		"spec":    spec,
		"output":  output,
	})
}

// PluginInfo represents a single plugin's combined status from Gateway config.
type PluginInfo struct {
	ID        string `json:"id"`
	Spec      string `json:"spec,omitempty"`
	Installed bool   `json:"installed"`
	Enabled   bool   `json:"enabled"`
}

// List returns all known plugins from Gateway config (plugins.installs + plugins.entries).
// GET /api/v1/plugins/list
func (h *PluginInstallHandler) List(w http.ResponseWriter, r *http.Request) {
	if h.gwClient == nil {
		web.OK(w, r, map[string]interface{}{
			"plugins":     []PluginInfo{},
			"can_install": true,
			"is_remote":   false,
		})
		return
	}

	isRemote := h.isRemoteGateway()

	resp, err := h.gwClient.Request("config.get", map[string]interface{}{})
	if err != nil {
		logger.Log.Debug().Err(err).Msg("plugins list: failed to get config from gateway")
		web.OK(w, r, map[string]interface{}{
			"plugins":     []PluginInfo{},
			"can_install": !isRemote,
			"is_remote":   isRemote,
		})
		return
	}

	var respMap map[string]interface{}
	if err := json.Unmarshal(resp, &respMap); err != nil {
		logger.Log.Debug().Err(err).Msg("plugins list: failed to unmarshal config")
		web.OK(w, r, map[string]interface{}{
			"plugins":     []PluginInfo{},
			"can_install": !isRemote,
			"is_remote":   isRemote,
		})
		return
	}

	configObj := respMap
	if cfg, ok := respMap["config"].(map[string]interface{}); ok {
		configObj = cfg
	}

	// Collect plugins from installs and entries
	seen := map[string]bool{}
	var plugins []PluginInfo

	if pluginsObj, ok := configObj["plugins"].(map[string]interface{}); ok {
		// plugins.installs: Record<pluginId, { spec?, ... }>
		if installs, ok := pluginsObj["installs"].(map[string]interface{}); ok {
			for pluginId, install := range installs {
				seen[pluginId] = true
				info := PluginInfo{
					ID:        pluginId,
					Installed: true,
					Enabled:   true, // default enabled unless entries says otherwise
				}
				if installMap, ok := install.(map[string]interface{}); ok {
					if spec, ok := installMap["spec"].(string); ok {
						info.Spec = spec
					}
				}
				plugins = append(plugins, info)
			}
		}

		// plugins.entries: Record<pluginId, { enabled? }>
		if entries, ok := pluginsObj["entries"].(map[string]interface{}); ok {
			for pluginId, entry := range entries {
				if entryMap, ok := entry.(map[string]interface{}); ok {
					if enabled, ok := entryMap["enabled"].(bool); ok {
						// Update existing or add new
						found := false
						for i := range plugins {
							if plugins[i].ID == pluginId {
								plugins[i].Enabled = enabled
								found = true
								break
							}
						}
						if !found && !seen[pluginId] {
							seen[pluginId] = true
							plugins = append(plugins, PluginInfo{
								ID:        pluginId,
								Installed: false,
								Enabled:   enabled,
							})
						}
					}
				}
			}
		}
	}

	web.OK(w, r, map[string]interface{}{
		"plugins":     plugins,
		"can_install": !isRemote,
		"is_remote":   isRemote,
	})
}

// Status returns runtime plugin status from Gateway (works on both local and remote).
// GET /api/v1/plugins/status
//
// OpenClaw core gateway does NOT expose a "plugins.status" RPC. The only
// plugin-related methods on the gateway are "plugins.uiDescriptors" (UI
// descriptors only) and "plugin.approval.*" (approval flows). Plugin
// loaded/disabled/error state must be derived from "config.get" — see
// statusFromConfig below.
func (h *PluginInstallHandler) Status(w http.ResponseWriter, r *http.Request) {
	isRemote := h.isRemoteGateway()

	if h.gwClient == nil {
		web.OK(w, r, map[string]interface{}{
			"plugins":     []interface{}{},
			"diagnostics": []interface{}{},
			"slots":       map[string]interface{}{},
			"allow":       []string{},
			"deny":        []string{},
			"can_install": true,
			"is_remote":   false,
		})
		return
	}

	h.statusFromConfig(w, r, isRemote)
}

// statusFromConfig builds plugin status from config.get. This is the only
// path supported by upstream OpenClaw — there is no dedicated plugins.status RPC.
func (h *PluginInstallHandler) statusFromConfig(w http.ResponseWriter, r *http.Request, isRemote bool) {
	resp, err := h.gwClient.Request("config.get", map[string]interface{}{})
	if err != nil {
		web.OK(w, r, map[string]interface{}{
			"plugins":     []interface{}{},
			"diagnostics": []interface{}{},
			"slots":       map[string]interface{}{},
			"allow":       []string{},
			"deny":        []string{},
			"can_install": !isRemote,
			"is_remote":   isRemote,
		})
		return
	}

	var respMap map[string]interface{}
	if err := json.Unmarshal(resp, &respMap); err != nil {
		web.OK(w, r, map[string]interface{}{
			"plugins":     []interface{}{},
			"diagnostics": []interface{}{},
			"slots":       map[string]interface{}{},
			"allow":       []string{},
			"deny":        []string{},
			"can_install": !isRemote,
			"is_remote":   isRemote,
		})
		return
	}

	configObj := respMap
	if cfg, ok := respMap["config"].(map[string]interface{}); ok {
		configObj = cfg
	}

	var plugins []map[string]interface{}
	var allow []string
	var deny []string
	slots := map[string]interface{}{}

	if pluginsObj, ok := configObj["plugins"].(map[string]interface{}); ok {
		// Build plugin list from installs + entries
		seen := map[string]bool{}
		if installs, ok := pluginsObj["installs"].(map[string]interface{}); ok {
			for pluginId, install := range installs {
				seen[pluginId] = true
				info := map[string]interface{}{
					"id":        pluginId,
					"status":    "loaded",
					"installed": true,
					"enabled":   true,
					"source":    "config",
				}
				if installMap, ok := install.(map[string]interface{}); ok {
					if spec, ok := installMap["spec"].(string); ok {
						info["spec"] = spec
					}
					if version, ok := installMap["version"].(string); ok {
						info["version"] = version
					}
					if src, ok := installMap["source"].(string); ok {
						info["installSource"] = src
					}
					if installPath, ok := installMap["installPath"].(string); ok {
						info["installPath"] = installPath
					}
					if installedAt, ok := installMap["installedAt"].(string); ok {
						info["installedAt"] = installedAt
					}
				}
				plugins = append(plugins, info)
			}
		}
		if entries, ok := pluginsObj["entries"].(map[string]interface{}); ok {
			for pluginId, entry := range entries {
				if entryMap, ok := entry.(map[string]interface{}); ok {
					if enabled, ok := entryMap["enabled"].(bool); ok {
						found := false
						for i := range plugins {
							if plugins[i]["id"] == pluginId {
								plugins[i]["enabled"] = enabled
								if !enabled {
									plugins[i]["status"] = "disabled"
								}
								found = true
								break
							}
						}
						if !found && !seen[pluginId] {
							seen[pluginId] = true
							status := "loaded"
							if !enabled {
								status = "disabled"
							}
							plugins = append(plugins, map[string]interface{}{
								"id":        pluginId,
								"status":    status,
								"installed": false,
								"enabled":   enabled,
								"source":    "config",
							})
						}
					}
				}
			}
		}
		if allowList, ok := pluginsObj["allow"].([]interface{}); ok {
			for _, a := range allowList {
				if s, ok := a.(string); ok {
					allow = append(allow, s)
				}
			}
		}
		if denyList, ok := pluginsObj["deny"].([]interface{}); ok {
			for _, d := range denyList {
				if s, ok := d.(string); ok {
					deny = append(deny, s)
				}
			}
		}
		if slotsObj, ok := pluginsObj["slots"].(map[string]interface{}); ok {
			slots = slotsObj
		}
	}

	pluginInterfaces := make([]interface{}, 0, len(plugins))
	for _, plugin := range plugins {
		pluginInterfaces = append(pluginInterfaces, plugin)
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	enrichPluginUpdateInfo(ctx, pluginInterfaces)

	web.OK(w, r, map[string]interface{}{
		"plugins":     plugins,
		"diagnostics": []interface{}{},
		"slots":       slots,
		"allow":       allow,
		"deny":        deny,
		"can_install": !isRemote,
		"is_remote":   isRemote,
	})
}

// Uninstall removes a plugin. Local gateway only.
// POST /api/v1/plugins/uninstall  { "id": "plugin-id" }
func (h *PluginInstallHandler) Uninstall(w http.ResponseWriter, r *http.Request) {
	if h.isRemoteGateway() {
		web.Fail(w, r, "REMOTE_GATEWAY", "plugin uninstall is only supported on local gateway", http.StatusBadRequest)
		return
	}

	var body struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.ID) == "" {
		web.Fail(w, r, "INVALID_PARAMS", "id is required", http.StatusBadRequest)
		return
	}

	pluginId := strings.TrimSpace(body.ID)
	// Validate: no dangerous characters
	for _, ch := range []string{";", "&", "|", "`", "$", "(", ")", "{", "}", "<", ">", "\\", "\n", "\r"} {
		if strings.Contains(pluginId, ch) {
			web.Fail(w, r, "INVALID_PARAMS", "invalid plugin id", http.StatusBadRequest)
			return
		}
	}

	logger.Log.Info().Str("id", pluginId).Msg("uninstalling plugin")

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("cmd.exe", "/c", "openclaw", "plugins", "uninstall", pluginId, "--force")
	} else {
		cmd = exec.Command("openclaw", "plugins", "uninstall", pluginId, "--force")
	}
	executil.HideWindow(cmd)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	done := make(chan error, 1)
	go func() {
		done <- cmd.Run()
	}()

	select {
	case err := <-done:
		if err != nil {
			errMsg := stderr.String()
			if errMsg == "" {
				errMsg = stdout.String()
			}
			if errMsg == "" {
				errMsg = err.Error()
			}
			logger.Log.Error().Err(err).Str("id", pluginId).Str("stderr", errMsg).Msg("plugin uninstall failed")
			web.Fail(w, r, "UNINSTALL_FAILED", errMsg, http.StatusInternalServerError)
			return
		}
	case <-time.After(2 * time.Minute):
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
		web.Fail(w, r, "UNINSTALL_TIMEOUT", "uninstall timed out", http.StatusGatewayTimeout)
		return
	}

	output := stdout.String()
	logger.Log.Info().Str("id", pluginId).Str("output", output).Msg("plugin uninstalled successfully")

	// Auto-remove from plugins.allow
	if err := h.removePluginAllowed(pluginId); err != nil {
		logger.Log.Warn().Err(err).Str("pluginId", pluginId).Msg("failed to auto-remove plugin from allow list")
	}

	web.OK(w, r, map[string]interface{}{
		"success": true,
		"id":      pluginId,
		"output":  output,
	})
}

// Update updates one or all npm-installed plugins. Local gateway only.
// POST /api/v1/plugins/update  { "id": "plugin-id" } or { "all": true }
func (h *PluginInstallHandler) Update(w http.ResponseWriter, r *http.Request) {
	if h.isRemoteGateway() {
		web.Fail(w, r, "REMOTE_GATEWAY", "plugin update is only supported on local gateway", http.StatusBadRequest)
		return
	}

	var body struct {
		ID  string `json:"id"`
		All bool   `json:"all"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		web.Fail(w, r, "INVALID_PARAMS", "invalid request body", http.StatusBadRequest)
		return
	}

	pluginId := strings.TrimSpace(body.ID)
	if !body.All && pluginId == "" {
		web.Fail(w, r, "INVALID_PARAMS", "id or all=true is required", http.StatusBadRequest)
		return
	}

	// Validate id if present
	if pluginId != "" {
		for _, ch := range []string{";", "&", "|", "`", "$", "(", ")", "{", "}", "<", ">", "\\", "\n", "\r"} {
			if strings.Contains(pluginId, ch) {
				web.Fail(w, r, "INVALID_PARAMS", "invalid plugin id", http.StatusBadRequest)
				return
			}
		}
	}

	var args []string
	if body.All {
		args = []string{"plugins", "update", "--all"}
		logger.Log.Info().Msg("updating all plugins")
	} else {
		args = []string{"plugins", "update", pluginId}
		logger.Log.Info().Str("id", pluginId).Msg("updating plugin")
	}

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("cmd.exe", append([]string{"/c", "openclaw"}, args...)...)
	} else {
		cmd = exec.Command("openclaw", args...)
	}
	executil.HideWindow(cmd)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	done := make(chan error, 1)
	go func() {
		done <- cmd.Run()
	}()

	select {
	case err := <-done:
		if err != nil {
			errMsg := stderr.String()
			if errMsg == "" {
				errMsg = stdout.String()
			}
			if errMsg == "" {
				errMsg = err.Error()
			}
			logger.Log.Error().Err(err).Str("id", pluginId).Bool("all", body.All).Str("stderr", errMsg).Msg("plugin update failed")
			web.Fail(w, r, "UPDATE_FAILED", errMsg, http.StatusInternalServerError)
			return
		}
	case <-time.After(5 * time.Minute):
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
		web.Fail(w, r, "UPDATE_TIMEOUT", "update timed out", http.StatusGatewayTimeout)
		return
	}

	output := stdout.String()

	// CLI may exit 0 but still report failure in output (e.g. prerelease version resolution).
	// When the failure is due to prerelease-only packages, automatically retry with @beta tag.
	if strings.Contains(output, "Failed to update") || strings.Contains(output, "Failed to install") {
		// Try smart prerelease retry: extract spec from "Resolved <spec> to prerelease version"
		if !body.All && strings.Contains(output, "prereleases are only installed when explicitly requested") {
			retrySpec := extractPrereleaseSpec(output)
			if retrySpec != "" {
				betaSpec := retrySpec + "@beta"
				logger.Log.Info().Str("id", pluginId).Str("betaSpec", betaSpec).Msg("retrying plugin update with @beta tag")

				retryArgs := []string{"plugins", "install", betaSpec}
				var retryCmd *exec.Cmd
				if runtime.GOOS == "windows" {
					retryCmd = exec.Command("cmd.exe", append([]string{"/c", "openclaw"}, retryArgs...)...)
				} else {
					retryCmd = exec.Command("openclaw", retryArgs...)
				}
				executil.HideWindow(retryCmd)
				var retryStdout, retryStderr bytes.Buffer
				retryCmd.Stdout = &retryStdout
				retryCmd.Stderr = &retryStderr

				retryDone := make(chan error, 1)
				go func() { retryDone <- retryCmd.Run() }()

				select {
				case retryErr := <-retryDone:
					retryOutput := retryStdout.String()
					if retryErr == nil && !strings.Contains(retryOutput, "Failed to install") && !strings.Contains(retryOutput, "Failed to update") {
						logger.Log.Info().Str("id", pluginId).Str("betaSpec", betaSpec).Str("output", retryOutput).Msg("plugin updated successfully via @beta retry")
						web.OK(w, r, map[string]interface{}{
							"success": true,
							"id":      pluginId,
							"all":     false,
							"output":  retryOutput,
						})
						return
					}
					logger.Log.Warn().Str("id", pluginId).Str("betaSpec", betaSpec).Str("output", retryOutput).Msg("@beta retry also failed")
				case <-time.After(5 * time.Minute):
					if retryCmd.Process != nil {
						retryCmd.Process.Kill()
					}
					logger.Log.Warn().Str("id", pluginId).Msg("@beta retry timed out")
				}
			}
		}

		logger.Log.Warn().Str("id", pluginId).Bool("all", body.All).Str("output", output).Msg("plugin update command exited 0 but output indicates failure")
		web.OK(w, r, map[string]interface{}{
			"success": false,
			"id":      pluginId,
			"all":     body.All,
			"output":  output,
		})
		return
	}

	logger.Log.Info().Str("id", pluginId).Bool("all", body.All).Str("output", output).Msg("plugin update completed")

	web.OK(w, r, map[string]interface{}{
		"success": true,
		"id":      pluginId,
		"all":     body.All,
		"output":  output,
	})
}

// extractPrereleaseSpec extracts the npm package spec from prerelease error output.
// Looks for pattern: "Resolved <spec> to prerelease version"
var prereleaseSpecRe = regexp.MustCompile(`Resolved\s+(\S+)\s+to prerelease version`)

func extractPrereleaseSpec(output string) string {
	matches := prereleaseSpecRe.FindStringSubmatch(output)
	if len(matches) >= 2 {
		return matches[1]
	}
	return ""
}

// isValidNpmSpec validates npm package spec format.
// Allows: @scope/package, @scope/package@version, package, package@version
func isValidNpmSpec(spec string) bool {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return false
	}

	// Reject dangerous characters
	dangerous := []string{";", "&", "|", "`", "$", "(", ")", "{", "}", "<", ">", "\\", "\n", "\r"}
	for _, d := range dangerous {
		if strings.Contains(spec, d) {
			return false
		}
	}

	// Must start with @ (scoped) or letter
	if !strings.HasPrefix(spec, "@") && !isLetter(spec[0]) {
		return false
	}

	// Scoped package: @scope/name or @scope/name@version
	if strings.HasPrefix(spec, "@") {
		parts := strings.SplitN(spec, "/", 2)
		if len(parts) != 2 || parts[0] == "@" || parts[1] == "" {
			return false
		}
	}

	return true
}

func isLetter(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

// ensurePluginAllowed adds pluginId to plugins.allow in the gateway config
// so the plugin is trusted and loaded without the WARN about empty allow list.
func (h *PluginInstallHandler) ensurePluginAllowed(pluginId string) error {
	if h.gwClient == nil {
		return nil
	}

	data, err := h.gwClient.RequestWithTimeout("config.get", map[string]interface{}{}, 5*time.Second)
	if err != nil {
		return err
	}

	var respMap map[string]interface{}
	if err := json.Unmarshal(data, &respMap); err != nil {
		return err
	}

	baseHash, _ := respMap["hash"].(string)

	configObj := respMap
	if cfg, ok := respMap["config"].(map[string]interface{}); ok {
		configObj = cfg
	}

	// Ensure plugins map exists
	pluginsObj, _ := configObj["plugins"].(map[string]interface{})
	if pluginsObj == nil {
		pluginsObj = map[string]interface{}{}
		configObj["plugins"] = pluginsObj
	}

	// Read current allow list
	var allowList []string
	rawAllow, hasAllow := pluginsObj["allow"].([]interface{})
	if hasAllow {
		for _, item := range rawAllow {
			if s, ok := item.(string); ok {
				allowList = append(allowList, s)
			}
		}
	}

	// If no restrictive allowlist exists (missing or empty), do nothing.
	// An absent/empty allow list means "all plugins allowed" — creating one
	// with only the new plugin would disable all other plugins.
	// This matches OpenClaw CLI's addInstalledPluginToAllowlist behavior.
	if !hasAllow || len(allowList) == 0 {
		return nil
	}

	// Check if already allowed (exact match or wildcard)
	for _, a := range allowList {
		if a == pluginId || a == "*" {
			return nil // already allowed
		}
	}

	// Append and write back
	allowList = append(allowList, pluginId)
	pluginsObj["allow"] = allowList

	cfgJSON, err := json.Marshal(configObj)
	if err != nil {
		return err
	}
	setParams := map[string]interface{}{
		"raw": string(cfgJSON),
	}
	if baseHash != "" {
		setParams["baseHash"] = baseHash
	}
	cfgBudget.waitForSlot()
	_, err = h.gwClient.RequestWithTimeout("config.set", setParams, 10*time.Second)
	if err != nil {
		return err
	}
	cfgBudget.recordWrite()

	logger.Log.Info().Str("pluginId", pluginId).Msg("auto-added plugin to plugins.allow")
	return nil
}

// isPluginAlreadyExistsError checks whether an install error message indicates
// the residual-directory condition: the CLI prints
//
//	"plugin already exists: /<path> (delete it first)"
//
// when /extensions/<id> already exists from a prior failed install.
func isPluginAlreadyExistsError(msg string) bool {
	lower := strings.ToLower(msg)
	return strings.Contains(lower, "plugin already exists") ||
		(strings.Contains(lower, "already exists") && strings.Contains(lower, "delete it first"))
}

// runUninstallForForce runs `openclaw plugins uninstall <id> --force` and
// silently ignores all errors.  Used by Install(force=true) to clear residue
// before retrying the install.
func (h *PluginInstallHandler) runUninstallForForce(pluginId string) {
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("cmd.exe", "/c", "openclaw", "plugins", "uninstall", pluginId, "--force")
	} else {
		cmd = exec.Command("openclaw", "plugins", "uninstall", pluginId, "--force")
	}
	executil.HideWindow(cmd)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	done := make(chan error, 1)
	go func() { done <- cmd.Run() }()
	select {
	case err := <-done:
		if err != nil {
			logger.Log.Debug().Err(err).Str("pluginId", pluginId).Str("stderr", stderr.String()).Msg("force-uninstall before install returned error (ignored)")
		} else {
			logger.Log.Info().Str("pluginId", pluginId).Str("output", stdout.String()).Msg("force-uninstall before install completed")
		}
	case <-time.After(2 * time.Minute):
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
		logger.Log.Warn().Str("pluginId", pluginId).Msg("force-uninstall before install timed out")
	}
}

// ensurePluginAllowedRetry polls for WS reconnection and retries ensurePluginAllowed.
// Called as a goroutine when the initial attempt fails (typically because the
// gateway restarted and killed the WS connection right after plugin install).
func (h *PluginInstallHandler) ensurePluginAllowedRetry(pluginId string, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		<-ticker.C
		if time.Now().After(deadline) {
			logger.Log.Warn().Str("pluginId", pluginId).Msg("ensurePluginAllowed retry timed out waiting for gateway reconnect")
			return
		}
		if h.gwClient == nil || !h.gwClient.IsConnected() {
			continue
		}
		// Gateway reconnected, retry
		if err := h.ensurePluginAllowed(pluginId); err != nil {
			logger.Log.Warn().Err(err).Str("pluginId", pluginId).Msg("ensurePluginAllowed retry failed")
			continue
		}
		logger.Log.Info().Str("pluginId", pluginId).Msg("ensurePluginAllowed retry succeeded after gateway reconnect")
		return
	}
}

// removePluginAllowed removes pluginId from plugins.allow in the gateway config.
func (h *PluginInstallHandler) removePluginAllowed(pluginId string) error {
	if h.gwClient == nil {
		return nil
	}

	data, err := h.gwClient.RequestWithTimeout("config.get", map[string]interface{}{}, 5*time.Second)
	if err != nil {
		return err
	}

	var respMap map[string]interface{}
	if err := json.Unmarshal(data, &respMap); err != nil {
		return err
	}

	baseHash, _ := respMap["hash"].(string)

	configObj := respMap
	if cfg, ok := respMap["config"].(map[string]interface{}); ok {
		configObj = cfg
	}

	pluginsObj, _ := configObj["plugins"].(map[string]interface{})
	if pluginsObj == nil {
		return nil
	}

	rawAllow, ok := pluginsObj["allow"].([]interface{})
	if !ok || len(rawAllow) == 0 {
		return nil
	}

	// Filter out the plugin
	var newAllow []string
	removed := false
	for _, item := range rawAllow {
		if s, ok := item.(string); ok {
			if s == pluginId {
				removed = true
				continue
			}
			newAllow = append(newAllow, s)
		}
	}

	if !removed {
		return nil
	}

	pluginsObj["allow"] = newAllow

	cfgJSON, err := json.Marshal(configObj)
	if err != nil {
		return err
	}
	setParams := map[string]interface{}{
		"raw": string(cfgJSON),
	}
	if baseHash != "" {
		setParams["baseHash"] = baseHash
	}
	cfgBudget.waitForSlot()
	_, err = h.gwClient.RequestWithTimeout("config.set", setParams, 10*time.Second)
	if err != nil {
		return err
	}
	cfgBudget.recordWrite()

	logger.Log.Info().Str("pluginId", pluginId).Msg("auto-removed plugin from plugins.allow")
	return nil
}
