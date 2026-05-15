package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"ClawDeckX/internal/executil"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/version"
	"ClawDeckX/internal/web"
)

// minObservabilityVersion is the minimum OpenClaw version that ships the
// diagnostics-prometheus plugin.
const minObservabilityVersion = "2026.4.25"

// ObservabilityHandler proxies the OpenClaw gateway diagnostics-prometheus
// scrape endpoint and provides helper APIs for external Prometheus setups.
type ObservabilityHandler struct {
	gwClient *openclaw.GWClient
	gwSvc    *openclaw.Service
}

func NewObservabilityHandler(client *openclaw.GWClient, svc ...*openclaw.Service) *ObservabilityHandler {
	h := &ObservabilityHandler{gwClient: client}
	if len(svc) > 0 {
		h.gwSvc = svc[0]
	}
	return h
}

func (h *ObservabilityHandler) GatewayState(w http.ResponseWriter, r *http.Request) {
	if h.gwClient == nil {
		web.OK(w, r, map[string]interface{}{
			"phase":      "stopped",
			"ready":      false,
			"checked_at": time.Now().Format(time.RFC3339),
		})
		return
	}

	cfg := h.gwClient.GetConfig()
	host := cfg.Host
	if host == "" {
		host = "127.0.0.1"
	}
	port := cfg.Port
	if port == 0 {
		port = 18789
	}

	var svcStatus interface{}
	var running bool
	var remote bool
	if h.gwSvc != nil {
		st := h.gwSvc.Status()
		running = st.Running
		remote = h.gwSvc.IsRemote()
		svcStatus = map[string]interface{}{
			"running": running,
			"runtime": string(st.Runtime),
			"detail":  st.Detail,
			"remote":  remote,
		}
	}

	wsStatus := h.gwClient.ConnectionStatus()
	healthStatus := h.gwClient.HealthStatus()
	probe, _ := healthStatus["probe"].(openclaw.GatewayProbeSnapshot)
	wsConnected, _ := wsStatus["connected"].(bool)
	wsPhase, _ := wsStatus["phase"].(string)
	watchdogPhase, _ := healthStatus["phase"].(string)
	graceRemaining, _ := healthStatus["grace_remaining_sec"].(int)
	lastRPCOKAt, _ := wsStatus["last_rpc_ok_at"].(string)
	recentRPCOK := false
	if lastRPCOKAt != "" {
		if t, err := time.Parse(time.RFC3339, lastRPCOKAt); err == nil && time.Since(t) < 30*time.Second {
			recentRPCOK = true
		}
	}

	rpcReady := false
	rpcError := ""
	if wsConnected {
		if _, err := h.gwClient.RequestWithTimeout("health", map[string]interface{}{"probe": false}, 2*time.Second); err == nil {
			rpcReady = true
		} else {
			rpcError = err.Error()
		}
	}
	if !rpcReady && recentRPCOK {
		rpcReady = true
		rpcError = ""
	}

	phase := "stopped"
	recovering := false
	if watchdogPhase == "restarting" {
		phase = "restarting"
		recovering = true
	} else if watchdogPhase == "grace" {
		phase = "grace"
		recovering = true
	} else if watchdogPhase == "starting" {
		phase = "starting"
		recovering = true
	} else if wsPhase == "pairing" || wsPhase == "auth_refresh" {
		phase = wsPhase
		recovering = true
	} else if rpcReady {
		phase = "rpc_ready"
	} else if wsConnected {
		phase = "ws_connected"
	} else if probe.Ready.OK {
		phase = "http_ready"
		recovering = true
	} else if probe.Live.OK {
		phase = "http_live"
		recovering = true
	} else if probe.TCPReachable {
		phase = "tcp_open"
		recovering = true
	} else if running {
		phase = "starting"
		recovering = true
	}

	web.OK(w, r, map[string]interface{}{
		"phase":      phase,
		"ready":      rpcReady,
		"recovering": recovering,
		"checked_at": time.Now().Format(time.RFC3339),
		"host":       host,
		"port":       port,
		"remote":     remote,
		"service":    svcStatus,
		"watchdog":   healthStatus,
		"ws":         wsStatus,
		"probe":      probe,
		"rpc": map[string]interface{}{
			"ready": rpcReady,
			"error": rpcError,
		},
		"grace_remaining_sec": graceRemaining,
	})
}

// ────────────────────────────────────────────────────────────────────────────
// GET /api/v1/observability/metrics?format=text|json
//
// format=text (default): proxies raw Prometheus exposition text.
// format=json:           parses the text into structured JSON for the UI.
// ────────────────────────────────────────────────────────────────────────────

func (h *ObservabilityHandler) Metrics(w http.ResponseWriter, r *http.Request) {
	cfg := h.gwClient.GetConfig()
	if strings.TrimSpace(cfg.Host) == "" || cfg.Port <= 0 {
		web.Fail(w, r, "GW_NOT_CONFIGURED", "gateway not configured", http.StatusServiceUnavailable)
		return
	}

	url := fmt.Sprintf("http://%s/api/diagnostics/prometheus",
		net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", cfg.Port)))

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, url, nil)
	if err != nil {
		web.Fail(w, r, "PROXY_ERR", err.Error(), http.StatusBadGateway)
		return
	}
	if cfg.Token != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.Token)
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		web.Fail(w, r, "SCRAPE_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	if err != nil {
		web.Fail(w, r, "READ_FAILED", err.Error(), http.StatusBadGateway)
		return
	}

	if resp.StatusCode != http.StatusOK {
		web.Fail(w, r, "SCRAPE_STATUS", fmt.Sprintf("gateway returned %d", resp.StatusCode), resp.StatusCode)
		return
	}

	format := r.URL.Query().Get("format")
	if format == "json" {
		parsed := parsePrometheusText(string(body))
		web.OK(w, r, parsed)
		return
	}

	// Default: raw text passthrough
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	w.Write(body)
}

// ────────────────────────────────────────────────────────────────────────────
// GET /api/v1/observability/scrape-config
//
// Returns a YAML snippet + raw values for Prometheus config.
// ────────────────────────────────────────────────────────────────────────────

func (h *ObservabilityHandler) ScrapeConfig(w http.ResponseWriter, r *http.Request) {
	cfg := h.gwClient.GetConfig()
	host := cfg.Host
	if host == "" || host == "0.0.0.0" {
		host = "localhost"
	}
	target := net.JoinHostPort(host, fmt.Sprintf("%d", cfg.Port))
	scrapeURL := fmt.Sprintf("http://%s/api/diagnostics/prometheus", target)

	yaml := fmt.Sprintf(`scrape_configs:
  - job_name: openclaw
    scheme: http
    metrics_path: /api/diagnostics/prometheus
    static_configs:
      - targets: ["%s"]
    authorization:
      type: Bearer
      credentials: "%s"
    scrape_interval: 15s
`, target, cfg.Token)

	web.OK(w, r, map[string]interface{}{
		"scrapeUrl":   scrapeURL,
		"target":      target,
		"metricsPath": "/api/diagnostics/prometheus",
		"token":       cfg.Token,
		"yamlSnippet": yaml,
	})
}

// ────────────────────────────────────────────────────────────────────────────
// POST /api/v1/observability/enable-plugin
//
// Enables the diagnostics-prometheus plugin in the OpenClaw config via RPC.
// ────────────────────────────────────────────────────────────────────────────

func (h *ObservabilityHandler) EnablePlugin(w http.ResponseWriter, r *http.Request) {
	if h.gwClient == nil {
		web.Fail(w, r, "GW_NOT_CONFIGURED", "gateway client not available", http.StatusServiceUnavailable)
		return
	}

	// 0. Version check — diagnostics-prometheus requires >= 2026.4.25
	gwVer := h.gwClient.GetVersion()
	if gwVer != "" {
		ok, _ := version.CompareVersion(gwVer, minObservabilityVersion)
		if !ok {
			web.OK(w, r, map[string]interface{}{
				"version_too_low": true,
				"current_version": gwVer,
				"min_version":     minObservabilityVersion,
			})
			return
		}
	}

	// 1. Ensure the diagnostics-prometheus plugin is installed.
	// Since 2026.5.x it is an external plugin — config.set alone won't help
	// if the package isn't downloaded to the extensions/ directory.
	if !h.isPluginInstalled() {
		logger.Log.Info().Msg("diagnostics-prometheus not installed — auto-installing via CLI")
		if err := h.installPrometheusPlugin(); err != nil {
			logger.Log.Warn().Err(err).Msg("auto-install diagnostics-prometheus failed")
			web.Fail(w, r, "PLUGIN_INSTALL_FAILED",
				"diagnostics-prometheus plugin is not installed. Auto-install failed: "+err.Error()+
					". Install manually: openclaw plugins install @openclaw/diagnostics-prometheus",
				http.StatusInternalServerError)
			return
		}
		logger.Log.Info().Msg("diagnostics-prometheus installed successfully")
	}

	// 2. Read current config
	data, err := h.gwClient.RequestWithTimeout("config.get", map[string]interface{}{}, 5*time.Second)
	if err != nil {
		web.Fail(w, r, "CONFIG_GET_FAILED", err.Error(), http.StatusBadGateway)
		return
	}

	var wrapper map[string]interface{}
	if err := json.Unmarshal(data, &wrapper); err != nil {
		web.Fail(w, r, "CONFIG_PARSE_FAILED", err.Error(), http.StatusInternalServerError)
		return
	}

	// Extract baseHash for optimistic concurrency control
	baseHash, _ := wrapper["hash"].(string)

	configObj := wrapper
	if cfg, ok := wrapper["config"].(map[string]interface{}); ok {
		configObj = cfg
	}

	// 2. Ensure plugins.entries.diagnostics-prometheus.enabled = true
	pluginsObj, _ := configObj["plugins"].(map[string]interface{})
	if pluginsObj == nil {
		pluginsObj = map[string]interface{}{}
		configObj["plugins"] = pluginsObj
	}

	diagnosticsObj, _ := configObj["diagnostics"].(map[string]interface{})
	if diagnosticsObj == nil {
		diagnosticsObj = map[string]interface{}{}
		configObj["diagnostics"] = diagnosticsObj
	}

	entries, _ := pluginsObj["entries"].(map[string]interface{})
	if entries == nil {
		entries = map[string]interface{}{}
		pluginsObj["entries"] = entries
	}

	entry, _ := entries["diagnostics-prometheus"].(map[string]interface{})
	if entry == nil {
		entry = map[string]interface{}{}
	}

	diagnosticsEnabled, _ := diagnosticsObj["enabled"].(bool)
	alreadyEnabled := diagnosticsEnabled
	if enabled, ok := entry["enabled"].(bool); !ok || !enabled {
		alreadyEnabled = false
	}

	if alreadyEnabled {
		// Config says enabled, but the plugin HTTP route may not be active.
		// Probe the actual metrics endpoint to verify.
		gwCfg := h.gwClient.GetConfig()
		if h.probeMetricsEndpoint(gwCfg) {
			web.OK(w, r, map[string]interface{}{"already_enabled": true, "metrics_available": true})
			return
		}
		// Metrics endpoint not available — force a config toggle (disable→enable)
		// to trigger the gateway to reload the plugin.
		logger.Log.Info().Msg("diagnostics-prometheus enabled in config but metrics endpoint not responding — forcing config toggle")
		entry["enabled"] = false
		entries["diagnostics-prometheus"] = entry
		if toggleJSON, err := json.Marshal(configObj); err == nil {
			toggleParams := map[string]interface{}{"raw": string(toggleJSON)}
			if baseHash != "" {
				toggleParams["baseHash"] = baseHash
			}
			cfgBudget.waitForSlot()
			if toggleResp, err := h.gwClient.RequestWithTimeout("config.set", toggleParams, 15*time.Second); err == nil {
				cfgBudget.recordWrite()
				// Read updated baseHash from toggle response
				var toggleWrapper map[string]interface{}
				if json.Unmarshal(toggleResp, &toggleWrapper) == nil {
					if newHash, ok := toggleWrapper["hash"].(string); ok && newHash != "" {
						baseHash = newHash
					}
				}
			}
			time.Sleep(500 * time.Millisecond)
		}
	}

	// Set enabled = true (either first time or after toggle-off)
	entry["enabled"] = true
	entries["diagnostics-prometheus"] = entry
	diagnosticsObj["enabled"] = true

	// 3. Write back with baseHash
	cfgJSON, err := json.Marshal(configObj)
	if err != nil {
		web.Fail(w, r, "CONFIG_MARSHAL_FAILED", err.Error(), http.StatusInternalServerError)
		return
	}

	setParams := map[string]interface{}{
		"raw": string(cfgJSON),
	}
	if baseHash != "" {
		setParams["baseHash"] = baseHash
	}

	cfgBudget.waitForSlot()
	_, err = h.gwClient.RequestWithTimeout("config.set", setParams, 15*time.Second)
	if err != nil {
		web.Fail(w, r, "CONFIG_SET_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	cfgBudget.recordWrite()

	restartTriggered := false
	restartRequired := true
	if h.gwSvc != nil && !h.gwSvc.IsRemote() {
		if err := h.gwSvc.Restart(); err != nil {
			web.Fail(w, r, "GATEWAY_RESTART_FAILED", err.Error(), http.StatusBadGateway)
			return
		}
		restartTriggered = true
		restartRequired = false
	}

	if alreadyEnabled {
		logger.Log.Info().Msg("toggled diagnostics-prometheus plugin (off→on) to force gateway reload")
	} else {
		logger.Log.Info().Msg("auto-enabled diagnostics-prometheus plugin via observability handler")
	}
	web.OK(w, r, map[string]interface{}{
		"enabled":           true,
		"was_toggle":        alreadyEnabled,
		"restart_triggered": restartTriggered,
		"restart_required":  restartRequired,
	})
}

// probeMetricsEndpoint sends a HEAD/GET to the gateway diagnostics-prometheus
// endpoint and returns true if it responds with 200.
func (h *ObservabilityHandler) probeMetricsEndpoint(gwCfg openclaw.GWClientConfig) bool {
	host := gwCfg.Host
	if host == "" {
		host = "127.0.0.1"
	}
	if gwCfg.Port <= 0 {
		return false
	}
	url := fmt.Sprintf("http://%s/api/diagnostics/prometheus",
		net.JoinHostPort(host, fmt.Sprintf("%d", gwCfg.Port)))
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return false
	}
	if gwCfg.Token != "" {
		req.Header.Set("Authorization", "Bearer "+gwCfg.Token)
	}
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// ────────────────────────────────────────────────────────────────────────────
// Prometheus text format parser → structured JSON for frontend.
// ────────────────────────────────────────────────────────────────────────────

type PromMetric struct {
	Name   string            `json:"name"`
	Type   string            `json:"type"`
	Help   string            `json:"help"`
	Values []PromMetricValue `json:"values"`
}

type PromMetricValue struct {
	Labels map[string]string `json:"labels"`
	Value  float64           `json:"value"`
	Suffix string            `json:"suffix,omitempty"`
}

type PromParseResult struct {
	Metrics []PromMetric `json:"metrics"`
	Raw     string       `json:"raw"`
}

func parsePrometheusText(text string) PromParseResult {
	lines := strings.Split(text, "\n")

	metaType := map[string]string{}
	metaHelp := map[string]string{}
	// indexed metric values keyed by metric base name
	valuesMap := map[string][]PromMetricValue{}
	orderedNames := []string{}
	seenName := map[string]bool{}

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "# TYPE ") {
			parts := strings.SplitN(line[7:], " ", 2)
			if len(parts) == 2 {
				metaType[parts[0]] = parts[1]
			}
			continue
		}
		if strings.HasPrefix(line, "# HELP ") {
			parts := strings.SplitN(line[7:], " ", 2)
			if len(parts) == 2 {
				metaHelp[parts[0]] = parts[1]
			}
			continue
		}
		if strings.HasPrefix(line, "#") {
			continue
		}

		// Parse sample line: metric_name{label="val",...} value
		name, labels, val, suffix := parseSampleLine(line)
		if name == "" {
			continue
		}

		// Determine base name (strip _bucket, _sum, _count, _total suffixes for grouping)
		baseName := metricBaseName(name)

		if !seenName[baseName] {
			seenName[baseName] = true
			orderedNames = append(orderedNames, baseName)
		}

		valuesMap[baseName] = append(valuesMap[baseName], PromMetricValue{
			Labels: labels,
			Value:  val,
			Suffix: suffix,
		})
	}

	metrics := make([]PromMetric, 0, len(orderedNames))
	for _, name := range orderedNames {
		metrics = append(metrics, PromMetric{
			Name:   name,
			Type:   metaType[name],
			Help:   metaHelp[name],
			Values: valuesMap[name],
		})
	}
	return PromParseResult{Metrics: metrics, Raw: text}
}

func metricBaseName(name string) string {
	for _, suffix := range []string{"_bucket", "_sum", "_count", "_total"} {
		if strings.HasSuffix(name, suffix) {
			base := strings.TrimSuffix(name, suffix)
			if base != "" {
				return base
			}
		}
	}
	return name
}

func parseSampleLine(line string) (name string, labels map[string]string, value float64, suffix string) {
	labels = map[string]string{}

	// Find the value (last space-separated token)
	idx := strings.LastIndex(line, " ")
	if idx < 0 {
		return
	}
	valStr := line[idx+1:]
	metricPart := line[:idx]

	_, err := fmt.Sscanf(valStr, "%f", &value)
	if err != nil {
		return
	}

	// Parse name{labels}
	braceOpen := strings.IndexByte(metricPart, '{')
	if braceOpen < 0 {
		name = metricPart
	} else {
		name = metricPart[:braceOpen]
		braceClose := strings.LastIndexByte(metricPart, '}')
		if braceClose > braceOpen {
			labelsStr := metricPart[braceOpen+1 : braceClose]
			parseLabels(labelsStr, labels)
		}
	}

	// Determine suffix from full metric name
	for _, s := range []string{"_bucket", "_sum", "_count"} {
		if strings.HasSuffix(name, s) {
			suffix = s[1:] // strip leading underscore
			break
		}
	}

	return
}

func parseLabels(s string, out map[string]string) {
	// Simple state machine for key="value",key="value"
	for len(s) > 0 {
		eq := strings.IndexByte(s, '=')
		if eq < 0 {
			break
		}
		key := s[:eq]
		s = s[eq+1:]
		if len(s) == 0 || s[0] != '"' {
			break
		}
		s = s[1:]
		var val strings.Builder
		for len(s) > 0 {
			if s[0] == '\\' && len(s) > 1 {
				switch s[1] {
				case 'n':
					val.WriteByte('\n')
				case '"':
					val.WriteByte('"')
				case '\\':
					val.WriteByte('\\')
				default:
					val.WriteByte(s[1])
				}
				s = s[2:]
				continue
			}
			if s[0] == '"' {
				s = s[1:]
				break
			}
			val.WriteByte(s[0])
			s = s[1:]
		}
		out[key] = val.String()
		if len(s) > 0 && s[0] == ',' {
			s = s[1:]
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers: diagnostics-prometheus plugin installation
// ────────────────────────────────────────────────────────────────────────────

// isPluginInstalled checks if the diagnostics-prometheus plugin is installed
// by querying config.get and looking at plugins.installs.
func (h *ObservabilityHandler) isPluginInstalled() bool {
	if h.gwClient == nil {
		return false
	}
	data, err := h.gwClient.RequestWithTimeout("config.get", map[string]interface{}{}, 5*time.Second)
	if err != nil {
		return false
	}
	var wrapper map[string]interface{}
	if json.Unmarshal(data, &wrapper) != nil {
		return false
	}
	configObj := wrapper
	if cfg, ok := wrapper["config"].(map[string]interface{}); ok {
		configObj = cfg
	}
	plugins, _ := configObj["plugins"].(map[string]interface{})
	if plugins == nil {
		return false
	}
	// Check plugins.installs for diagnostics-prometheus
	if installs, ok := plugins["installs"].(map[string]interface{}); ok {
		if _, found := installs["diagnostics-prometheus"]; found {
			return true
		}
	}
	// Fallback: check plugins.entries (plugin might be registered without install record)
	if entries, ok := plugins["entries"].(map[string]interface{}); ok {
		if _, found := entries["diagnostics-prometheus"]; found {
			return true
		}
	}
	return false
}

// installPrometheusPlugin runs `openclaw plugins install @openclaw/diagnostics-prometheus`.
func (h *ObservabilityHandler) installPrometheusPlugin() error {
	spec := "@openclaw/diagnostics-prometheus"
	cliArgs := []string{"plugins", "install", spec}
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("cmd.exe", append([]string{"/c", "openclaw"}, cliArgs...)...)
	} else {
		cmd = exec.Command("openclaw", cliArgs...)
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
			errMsg := stderr.String()
			if errMsg == "" {
				errMsg = stdout.String()
			}
			if errMsg == "" {
				errMsg = err.Error()
			}
			return fmt.Errorf("%s", errMsg)
		}
		return nil
	case <-time.After(3 * time.Minute):
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
		return fmt.Errorf("plugin install timed out after 3 minutes")
	}
}
