package openclaw

import (
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
		result.Message = "Gateway 运行正常"
	case DiagnoseWarn:
		result.Message = "Gateway 存在警告项，建议检查"
	case DiagnoseFail:
		result.Message = "Gateway 存在异常，请根据建议修复"
	}

	return result
}

func openclawConfigPath() string {
	return ResolveConfigPath()
}

func checkOpenClawInstalled() DiagnoseItem {
	item := DiagnoseItem{
		Name:    "openclaw_installed",
		Label:   "OpenClaw 已安装",
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
	item.Detail = "未检测到 openclaw 或 openclaw-cn"
	item.Suggestion = "请先安装 OpenClaw，可通过安装向导或 npm install -g openclaw 安装"
	return item
}

func checkConfigExists(configPath string) DiagnoseItem {
	item := DiagnoseItem{
		Name:    "config_exists",
		Label:   "配置文件存在",
		LabelEn: "Config File Exists",
	}

	if configPath == "" {
		item.Status = DiagnoseFail
		item.Detail = "无法确定配置文件路径"
		item.Suggestion = "请确认用户主目录可访问"
		return item
	}

	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		item.Status = DiagnoseFail
		item.Detail = configPath + " 不存在"
		item.Suggestion = "请在编辑器中点击「生成默认配置」，或运行 openclaw init"
		return item
	}

	item.Status = DiagnosePass
	item.Detail = configPath
	return item
}

func checkConfigValid(configPath string) DiagnoseItem {
	item := DiagnoseItem{
		Name:    "config_valid",
		Label:   "配置文件格式正确",
		LabelEn: "Config File Valid",
	}

	if configPath == "" {
		item.Status = DiagnoseWarn
		item.Detail = "跳过：配置路径未知"
		return item
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			item.Status = DiagnoseWarn
			item.Detail = "跳过：配置文件不存在"
			return item
		}
		item.Status = DiagnoseFail
		item.Detail = "读取配置文件失败: " + err.Error()
		item.Suggestion = "请检查文件权限"
		return item
	}

	var cfg map[string]interface{}
	if err := json.Unmarshal(data, &cfg); err != nil {
		item.Status = DiagnoseFail
		item.Detail = "JSON 解析失败: " + err.Error()
		item.Suggestion = "请检查配置文件 JSON 语法是否正确"
		return item
	}

	item.Status = DiagnosePass
	item.Detail = fmt.Sprintf("有效 JSON，%d 个顶级键", len(cfg))
	return item
}

func checkGatewayProcess() DiagnoseItem {
	item := DiagnoseItem{
		Name:    "gateway_process",
		Label:   "Gateway 进程",
		LabelEn: "Gateway Process",
	}

	if processExists() {
		item.Status = DiagnosePass
		item.Detail = "检测到 openclaw gateway 进程"
		return item
	}

	item.Status = DiagnoseFail
	item.Detail = "未找到 openclaw gateway 进程"
	item.Suggestion = "请启动 Gateway：点击上方「启动」按钮，或运行 openclaw gateway run"
	return item
}

func checkPortReachable(host string, port int) DiagnoseItem {
	item := DiagnoseItem{
		Name:    "port_reachable",
		Label:   fmt.Sprintf("端口 %d 可达", port),
		LabelEn: fmt.Sprintf("Port %d Reachable", port),
	}

	addr := fmt.Sprintf("%s:%d", host, port)
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		item.Status = DiagnoseFail
		item.Detail = fmt.Sprintf("%s 连接被拒绝", addr)
		item.Suggestion = "Gateway 未在该端口监听，请确认 Gateway 已启动且端口配置正确"
		return item
	}
	conn.Close()

	item.Status = DiagnosePass
	item.Detail = fmt.Sprintf("%s TCP 连接成功", addr)
	return item
}

func checkGatewayAPI(host string, port int) DiagnoseItem {
	item := DiagnoseItem{
		Name:    "gateway_api",
		Label:   "Gateway API 响应",
		LabelEn: "Gateway API Response",
	}

	addr := fmt.Sprintf("%s:%d", host, port)

	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		item.Status = DiagnoseFail
		item.Detail = "跳过：端口不可达"
		return item
	}
	conn.Close()

	client := &http.Client{Timeout: 3 * time.Second}
	url := fmt.Sprintf("http://%s/health", addr)
	resp, err := client.Get(url)
	if err != nil {
		item.Status = DiagnoseWarn
		item.Detail = fmt.Sprintf("HTTP 请求失败: %v", err)
		item.Suggestion = "端口可达但 HTTP 无响应，可能不是 OpenClaw Gateway 在监听"
		return item
	}
	resp.Body.Close()

	if resp.StatusCode >= 500 {
		item.Status = DiagnoseWarn
		item.Detail = fmt.Sprintf("HTTP 状态码 %d", resp.StatusCode)
		item.Suggestion = "Gateway 返回服务器错误，请检查 Gateway 日志"
		return item
	}

	item.Status = DiagnosePass
	item.Detail = fmt.Sprintf("HTTP 状态码 %d", resp.StatusCode)
	return item
}

func checkPortConflict(host string, port int) DiagnoseItem {
	item := DiagnoseItem{
		Name:    "port_conflict",
		Label:   "端口冲突检测",
		LabelEn: "Port Conflict Check",
	}

	addr := fmt.Sprintf("%s:%d", host, port)
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		item.Status = DiagnosePass
		item.Detail = fmt.Sprintf("端口 %d 未被占用（Gateway 未运行）", port)
		return item
	}
	conn.Close()

	if processExists() {
		item.Status = DiagnosePass
		item.Detail = fmt.Sprintf("端口 %d 由 Gateway 进程占用", port)
		return item
	}

	item.Status = DiagnoseWarn
	item.Detail = fmt.Sprintf("端口 %d 被其他程序占用", port)
	item.Suggestion = fmt.Sprintf("请检查哪个程序占用了端口 %d，或更换 Gateway 端口", port)
	return item
}

func checkAuthToken(host string, port int, configPath string) DiagnoseItem {
	item := DiagnoseItem{
		Name:    "auth_token",
		Label:   "鉴权 Token 匹配",
		LabelEn: "Auth Token Match",
	}

	addr := fmt.Sprintf("%s:%d", host, port)
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		item.Status = DiagnoseWarn
		item.Detail = "跳过：Gateway 未运行"
		return item
	}
	conn.Close()

	if configPath == "" {
		item.Status = DiagnoseWarn
		item.Detail = "跳过：配置路径未知"
		return item
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		item.Status = DiagnoseWarn
		item.Detail = "跳过：无法读取配置文件"
		return item
	}

	var cfg map[string]interface{}
	if err := json.Unmarshal(data, &cfg); err != nil {
		item.Status = DiagnoseWarn
		item.Detail = "跳过：配置文件格式错误"
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
		item.Detail = "未配置鉴权 Token（无需验证）"
		return item
	}

	client := &http.Client{Timeout: 3 * time.Second}
	url := fmt.Sprintf("http://%s/api/v1/status", addr)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		item.Status = DiagnoseWarn
		item.Detail = "HTTP 请求失败，无法验证 Token"
		return item
	}
	resp.Body.Close()

	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		item.Status = DiagnoseFail
		item.Detail = fmt.Sprintf("Token 验证失败（HTTP %d）", resp.StatusCode)
		item.Suggestion = "配置文件中的 Token 与 Gateway 不匹配，请检查 gateway.auth.token 配置"
		return item
	}

	item.Status = DiagnosePass
	item.Detail = "Token 验证通过"
	return item
}
