package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"time"

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
//   - "@m1heng-clawd/feishu" -> "feishu"
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
	// 1. Plugin ID (key) - e.g., "feishu" matches spec "@m1heng-clawd/feishu"
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

	logger.Log.Info().
		Str("spec", spec).
		Str("specPluginId", specPluginId).
		Strs("installedPluginIds", installedPluginIds).
		Bool("installed", installed).
		Str("matchedPluginId", matchedPluginId).
		Msg("plugin install check")

	web.OK(w, r, map[string]interface{}{
		"installed": installed,
		"spec":      spec,
	})
}

type pluginInstallRequest struct {
	Spec string `json:"spec"` // npm spec like "@m1heng-clawd/feishu"
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

	logger.Log.Info().Str("spec", spec).Msg("installing plugin")

	// Run openclaw plugins install <spec>
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		// On Windows, use cmd.exe /c to run the openclaw command
		// This handles .cmd/.bat files and PATH resolution correctly
		cmd = exec.Command("cmd.exe", "/c", "openclaw", "plugins", "install", spec)
	} else {
		cmd = exec.Command("openclaw", "plugins", "install", spec)
	}
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
	logger.Log.Info().Str("spec", spec).Str("output", output).Msg("plugin installed successfully")

	web.OK(w, r, map[string]interface{}{
		"success": true,
		"spec":    spec,
		"output":  output,
	})
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
