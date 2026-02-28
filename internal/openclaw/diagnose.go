package openclaw

import (
	"ClawDeckX/internal/i18n"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
)

type DiagnoseItemStatus string

const (
	DiagnosePass DiagnoseItemStatus = "pass"
	DiagnoseFail DiagnoseItemStatus = "fail"
	DiagnoseWarn DiagnoseItemStatus = "warn"
)

type DiagnoseItem struct {
	Name       string             `json:"name"`
	Label      string             `json:"label"`
	LabelEn    string             `json:"labelEn"`
	Status     DiagnoseItemStatus `json:"status"`
	Detail     string             `json:"detail"`
	Suggestion string             `json:"suggestion,omitempty"`
}

type DiagnoseResult struct {
	Items   []DiagnoseItem `json:"items"`
	Summary string         `json:"summary"` // pass | fail | warn
	Message string         `json:"message"`
}

func DiagnoseGateway(host string, port int) *DiagnoseResult {
	if host == "" {
		host = "127.0.0.1"
	}
	if port == 0 {
		port = 18789
	}

	result := &DiagnoseResult{}
	overallStatus := DiagnosePass

	item := checkOpenClawInstalled()
	result.Items = append(result.Items, item)
	if item.Status == DiagnoseFail {
		overallStatus = DiagnoseFail
	}

	configPath := openclawConfigPath()
	item = checkConfigExists(configPath)
	result.Items = append(result.Items, item)
	if item.Status == DiagnoseFail && overallStatus != DiagnoseFail {
		overallStatus = DiagnoseFail
	}

	item = checkConfigValid(configPath)
	result.Items = append(result.Items, item)
	if item.Status == DiagnoseFail && overallStatus != DiagnoseFail {
		overallStatus = DiagnoseFail
	}

	item = checkGatewayProcess()
	result.Items = append(result.Items, item)
	if item.Status == DiagnoseFail && overallStatus != DiagnoseFail {
		overallStatus = DiagnoseFail
	}

	item = checkPortReachable(host, port)
	result.Items = append(result.Items, item)
	if item.Status == DiagnoseFail && overallStatus != DiagnoseFail {
		overallStatus = DiagnoseFail
	}

	item = checkGatewayAPI(host, port)
	result.Items = append(result.Items, item)
	if item.Status == DiagnoseFail && overallStatus != DiagnoseFail {
		overallStatus = DiagnoseFail
	}

	item = checkPortConflict(host, port)
	result.Items = append(result.Items, item)
	if item.Status == DiagnoseWarn && overallStatus == DiagnosePass {
		overallStatus = DiagnoseWarn
	}

	item = checkAuthToken(host, port, configPath)
	result.Items = append(result.Items, item)
	if item.Status == DiagnoseWarn && overallStatus == DiagnosePass {
		overallStatus = DiagnoseWarn
	}

	result.Summary = string(overallStatus)
	switch overallStatus {
	case DiagnosePass:
		result.Message = i18n.T(i18n.MsgDiagnoseGatewayRunningOk)
	case DiagnoseWarn:
		result.Message = i18n.T(i18n.MsgDiagnoseGatewayHasWarnings)
	case DiagnoseFail:
		result.Message = i18n.T(i18n.MsgDiagnoseGatewayHasErrors)
	}

	return result
}

func openclawConfigPath() string {
	return ResolveConfigPath()
}

func checkOpenClawInstalled() DiagnoseItem {
	item := DiagnoseItem{
		Name:    "openclaw_installed",
		Label:   i18n.T(i18n.MsgDiagnoseOpenclawInstalled),
		LabelEn: "OpenClaw Installed",
	}

	out, err := exec.Command("openclaw", "--version").CombinedOutput()
	if err == nil {
		version := strings.TrimSpace(string(out))
		item.Status = DiagnosePass
		item.Detail = "openclaw " + version
		return item
	}

	out, err = exec.Command("openclaw-cn", "--version").CombinedOutput()
	if err == nil {
		version := strings.TrimSpace(string(out))
		item.Status = DiagnosePass
		item.Detail = "openclaw-cn " + version
		return item
	}

	item.Status = DiagnoseFail
	item.Detail = i18n.T(i18n.MsgDiagnoseOpenclawNotDetected)
	item.Suggestion = i18n.T(i18n.MsgDiagnoseOpenclawInstallSuggestion)
	return item
}

func checkConfigExists(configPath string) DiagnoseItem {
	item := DiagnoseItem{
		Name:    "config_exists",
		Label:   i18n.T(i18n.MsgDiagnoseConfigExists),
		LabelEn: "Config File Exists",
	}

	if configPath == "" {
		item.Status = DiagnoseFail
		item.Detail = i18n.T(i18n.MsgDiagnoseConfigPathUnknown)
		item.Suggestion = i18n.T(i18n.MsgDiagnoseConfigPathSuggestion)
		return item
	}

	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		item.Status = DiagnoseFail
		item.Detail = i18n.T(i18n.MsgDiagnoseConfigNotExists, map[string]interface{}{"Path": configPath})
		item.Suggestion = i18n.T(i18n.MsgDiagnoseConfigCreateSuggestion)
		return item
	}

	item.Status = DiagnosePass
	item.Detail = configPath
	return item
}

func checkConfigValid(configPath string) DiagnoseItem {
	item := DiagnoseItem{
		Name:    "config_valid",
		Label:   i18n.T(i18n.MsgDiagnoseConfigValid),
		LabelEn: "Config File Valid",
	}

	if configPath == "" {
		item.Status = DiagnoseWarn
		item.Detail = i18n.T(i18n.MsgDiagnoseSkipPathUnknown)
		return item
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			item.Status = DiagnoseWarn
			item.Detail = i18n.T(i18n.MsgDiagnoseSkipConfigNotExists)
			return item
		}
		item.Status = DiagnoseFail
		item.Detail = i18n.T(i18n.MsgDiagnoseReadConfigFailed, map[string]interface{}{"Error": err.Error()})
		item.Suggestion = i18n.T(i18n.MsgDiagnoseCheckFilePermission)
		return item
	}

	var cfg map[string]interface{}
	if err := json.Unmarshal(data, &cfg); err != nil {
		item.Status = DiagnoseFail
		item.Detail = i18n.T(i18n.MsgDiagnoseJsonParseFailed, map[string]interface{}{"Error": err.Error()})
		item.Suggestion = i18n.T(i18n.MsgDiagnoseCheckJsonSyntax)
		return item
	}

	item.Status = DiagnosePass
	item.Detail = i18n.T(i18n.MsgDiagnoseValidJsonKeys, map[string]interface{}{"Count": len(cfg)})
	return item
}

func checkGatewayProcess() DiagnoseItem {
	item := DiagnoseItem{
		Name:    "gateway_process",
		Label:   i18n.T(i18n.MsgDiagnoseGatewayProcess),
		LabelEn: "Gateway Process",
	}

	if processExists() {
		item.Status = DiagnosePass
		item.Detail = i18n.T(i18n.MsgDiagnoseGatewayProcessDetected)
		return item
	}

	item.Status = DiagnoseFail
	item.Detail = i18n.T(i18n.MsgDiagnoseGatewayProcessNotFound)
	item.Suggestion = i18n.T(i18n.MsgDiagnoseGatewayStartSuggestion)
	return item
}

func checkPortReachable(host string, port int) DiagnoseItem {
	item := DiagnoseItem{
		Name:    "port_reachable",
		Label:   i18n.T(i18n.MsgDiagnosePortReachable, map[string]interface{}{"Port": port}),
		LabelEn: fmt.Sprintf("Port %d Reachable", port),
	}

	addr := fmt.Sprintf("%s:%d", host, port)
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		item.Status = DiagnoseFail
		item.Detail = i18n.T(i18n.MsgDiagnoseConnectionRefused, map[string]interface{}{"Addr": addr})
		item.Suggestion = i18n.T(i18n.MsgDiagnosePortNotListening)
		return item
	}
	conn.Close()

	item.Status = DiagnosePass
	item.Detail = i18n.T(i18n.MsgDiagnoseTcpConnectionSuccess, map[string]interface{}{"Addr": addr})
	return item
}

func checkGatewayAPI(host string, port int) DiagnoseItem {
	item := DiagnoseItem{
		Name:    "gateway_api",
		Label:   i18n.T(i18n.MsgDiagnoseGatewayApiResponse),
		LabelEn: "Gateway API Response",
	}

	addr := fmt.Sprintf("%s:%d", host, port)

	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		item.Status = DiagnoseFail
		item.Detail = i18n.T(i18n.MsgDiagnoseSkipPortUnreachable)
		return item
	}
	conn.Close()

	client := &http.Client{Timeout: 3 * time.Second}
	url := fmt.Sprintf("http://%s/health", addr)
	resp, err := client.Get(url)
	if err != nil {
		item.Status = DiagnoseWarn
		item.Detail = i18n.T(i18n.MsgDiagnoseHttpRequestFailed, map[string]interface{}{"Error": err.Error()})
		item.Suggestion = i18n.T(i18n.MsgDiagnosePortReachableNoHttp)
		return item
	}
	resp.Body.Close()

	if resp.StatusCode >= 500 {
		item.Status = DiagnoseWarn
		item.Detail = i18n.T(i18n.MsgDiagnoseHttpStatusCode, map[string]interface{}{"Code": resp.StatusCode})
		item.Suggestion = i18n.T(i18n.MsgDiagnoseGatewayServerError)
		return item
	}

	item.Status = DiagnosePass
	item.Detail = i18n.T(i18n.MsgDiagnoseHttpStatusCode, map[string]interface{}{"Code": resp.StatusCode})
	return item
}

func checkPortConflict(host string, port int) DiagnoseItem {
	item := DiagnoseItem{
		Name:    "port_conflict",
		Label:   i18n.T(i18n.MsgDiagnosePortConflictCheck),
		LabelEn: "Port Conflict Check",
	}

	addr := fmt.Sprintf("%s:%d", host, port)
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		item.Status = DiagnosePass
		item.Detail = i18n.T(i18n.MsgDiagnosePortNotInUse, map[string]interface{}{"Port": port})
		return item
	}
	conn.Close()

	if processExists() {
		item.Status = DiagnosePass
		item.Detail = i18n.T(i18n.MsgDiagnosePortUsedByGateway, map[string]interface{}{"Port": port})
		return item
	}

	item.Status = DiagnoseWarn
	item.Detail = i18n.T(i18n.MsgDiagnosePortUsedByOther, map[string]interface{}{"Port": port})
	item.Suggestion = i18n.T(i18n.MsgDiagnosePortConflictSuggestion, map[string]interface{}{"Port": port})
	return item
}

func checkAuthToken(host string, port int, configPath string) DiagnoseItem {
	item := DiagnoseItem{
		Name:    "auth_token",
		Label:   i18n.T(i18n.MsgDiagnoseAuthTokenMatch),
		LabelEn: "Auth Token Match",
	}

	addr := fmt.Sprintf("%s:%d", host, port)
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		item.Status = DiagnoseWarn
		item.Detail = i18n.T(i18n.MsgDiagnoseSkipGatewayNotRunning)
		return item
	}
	conn.Close()

	if configPath == "" {
		item.Status = DiagnoseWarn
		item.Detail = i18n.T(i18n.MsgDiagnoseSkipPathUnknown)
		return item
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		item.Status = DiagnoseWarn
		item.Detail = i18n.T(i18n.MsgDiagnoseSkipCannotReadConfig)
		return item
	}

	var cfg map[string]interface{}
	if err := json.Unmarshal(data, &cfg); err != nil {
		item.Status = DiagnoseWarn
		item.Detail = i18n.T(i18n.MsgDiagnoseSkipConfigFormatError)
		return item
	}

	token := ""
	if gw, ok := cfg["gateway"].(map[string]interface{}); ok {
		if auth, ok := gw["auth"].(map[string]interface{}); ok {
			if t, ok := auth["token"].(string); ok {
				token = t
			}
		}
	}

	if token == "" {
		item.Status = DiagnosePass
		item.Detail = i18n.T(i18n.MsgDiagnoseNoAuthToken)
		return item
	}

	client := &http.Client{Timeout: 3 * time.Second}
	url := fmt.Sprintf("http://%s/api/v1/status", addr)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		item.Status = DiagnoseWarn
		item.Detail = i18n.T(i18n.MsgDiagnoseHttpRequestFailedToken)
		return item
	}
	resp.Body.Close()

	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		item.Status = DiagnoseFail
		item.Detail = i18n.T(i18n.MsgDiagnoseTokenVerifyFailed, map[string]interface{}{"Code": resp.StatusCode})
		item.Suggestion = i18n.T(i18n.MsgDiagnoseTokenMismatchSuggestion)
		return item
	}

	item.Status = DiagnosePass
	item.Detail = i18n.T(i18n.MsgDiagnoseTokenVerifyPassed)
	return item
}
