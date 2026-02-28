package openclaw

import (
	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/output"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const defaultGatewayPort = "18789"

type Runtime string

const (
	RuntimeSystemd Runtime = "systemd"
	RuntimeDocker  Runtime = "docker"
	RuntimeProcess Runtime = "process"
	RuntimeUnknown Runtime = "unknown"
)

type Status struct {
	Runtime Runtime
	Running bool
	Detail  string
}

type Service struct {
	dockerContainer string
	GatewayHost     string
	GatewayPort     int
	GatewayToken    string
	gwClient        *GWClient // 远程模式下通过 JSON-RPC 控制网关
	// 运行时检测缓存
	runtimeCache     Runtime
	runtimeCacheTime time.Time
	runtimeCacheTTL  time.Duration
}

func NewService() *Service {
	return &Service{
		GatewayHost:     "127.0.0.1",
		GatewayPort:     18789,
		runtimeCacheTTL: 1 * time.Hour, // 运行时类型缓存 1 小时（几乎不会变化）
	}
}

// SetGWClient 注入 Gateway WebSocket 客户端（远程控制用）
func (s *Service) SetGWClient(client *GWClient) {
	s.gwClient = client
}

// IsRemote 判断是否连接远程 Gateway
func (s *Service) IsRemote() bool {
	h := strings.TrimSpace(s.GatewayHost)
	return h != "" && h != "127.0.0.1" && h != "localhost" && h != "::1"
}

func (s *Service) DetectRuntime() Runtime {
	// 如果缓存未过期且有效，直接返回
	if time.Since(s.runtimeCacheTime) < s.runtimeCacheTTL && s.runtimeCache != RuntimeUnknown {
		logger.Gateway.Debug().
			Str("cached_runtime", string(s.runtimeCache)).
			Dur("cache_age", time.Since(s.runtimeCacheTime)).
			Msg(i18n.T(i18n.MsgLogDetectRuntimeUsingCache))
		return s.runtimeCache
	}

	// 执行实际检测
	rt := s.detectRuntimeImpl()

	// 更新缓存
	s.runtimeCache = rt
	s.runtimeCacheTime = time.Now()

	return rt
}

func (s *Service) detectRuntimeImpl() Runtime {
	hasSystemctl := commandExists("systemctl")
	systemdRunning := systemdActive("openclaw")
	logger.Gateway.Debug().
		Bool("hasSystemctl", hasSystemctl).
		Bool("systemdActive", systemdRunning).
		Msg(i18n.T(i18n.MsgLogDetectRuntimeSystemd))
	if hasSystemctl && systemdRunning {
		return RuntimeSystemd
	}

	hasDocker := commandExists("docker")
	dockerName := ""
	if hasDocker {
		dockerName = findDockerContainer()
	}
	logger.Gateway.Debug().
		Bool("hasDocker", hasDocker).
		Str("containerName", dockerName).
		Msg(i18n.T(i18n.MsgLogDetectRuntimeDocker))
	if dockerName != "" {
		s.dockerContainer = dockerName
		return RuntimeDocker
	}

	procExists := processExists()
	portListening := gatewayPortListening()
	hasOpenclawCmd := commandExists("openclaw")
	logger.Gateway.Debug().
		Bool("processExists", procExists).
		Bool("portListening", portListening).
		Bool("hasOpenclawCmd", hasOpenclawCmd).
		Msg(i18n.T(i18n.MsgLogDetectRuntimeProcess))
	if procExists || portListening || hasOpenclawCmd {
		return RuntimeProcess
	}

	logger.Gateway.Warn().Msg(i18n.T(i18n.MsgLogDetectRuntimeFailed))
	return RuntimeUnknown
}

func (s *Service) Status() Status {
	// 远程模式：通过 TCP/HTTP 探测
	if s.IsRemote() {
		return s.remoteStatus()
	}

	// 本地模式：获取运行时类型（使用长期缓存）
	rt := s.DetectRuntime()

	// 轻量级运行状态检查（不依赖运行时类型，避免重复调用 systemctl/docker）
	running := s.isRunning()

	// 构建详细信息
	var detail string
	switch rt {
	case RuntimeSystemd:
		detail = "服务名: openclaw"
	case RuntimeDocker:
		name := s.ensureContainerName()
		if name == "" {
			return Status{Runtime: RuntimeUnknown, Running: false, Detail: "未找到 openclaw 容器"}
		}
		detail = "容器: " + name
	case RuntimeProcess:
		detail = "进程模式"
	default:
		detail = "未检测到 OpenClaw 安装或运行时"
	}

	if running {
		detail += "（运行中）"
	}

	return Status{Runtime: rt, Running: running, Detail: detail}
}

// isRunning 轻量级运行状态检查（只检查进程/端口，不检测 systemd/docker）
func (s *Service) isRunning() bool {
	return processExists() || gatewayPortListening()
}

// remoteStatus 远程 Gateway 状态探测
func (s *Service) remoteStatus() Status {
	port := s.GatewayPort
	if port == 0 {
		port = 18789
	}
	addr := fmt.Sprintf("%s:%d", s.GatewayHost, port)

	// TCP 连接探测
	conn, err := net.DialTimeout("tcp", addr, 3*time.Second)
	if err != nil {
		return Status{
			Runtime: RuntimeProcess,
			Running: false,
			Detail:  fmt.Sprintf("远程 Gateway %s 不可达: %v", addr, err),
		}
	}
	conn.Close()

	// HTTP 探测（尝试访问 Gateway 根路径）
	detail := fmt.Sprintf("远程 Gateway %s（TCP 可达）", addr)
	client := &http.Client{Timeout: 3 * time.Second}
	url := fmt.Sprintf("http://%s/health", addr)
	resp, err := client.Get(url)
	if err == nil {
		resp.Body.Close()
		if resp.StatusCode < 500 {
			detail = fmt.Sprintf("远程 Gateway %s（HTTP 正常，状态码 %d）", addr, resp.StatusCode)
		}
	}

	return Status{
		Runtime: RuntimeProcess,
		Running: true,
		Detail:  detail,
	}
}

func (s *Service) Start() error {
	// 远程模式：OpenClaw 网关不支持通过 JSON-RPC 启动，需要在远程服务器上操作
	if s.IsRemote() {
		return errors.New("远程网关不支持远程启动，请在远程服务器上手动启动 OpenClaw 网关")
	}
	switch s.DetectRuntime() {
	case RuntimeSystemd:
		return runCommand("systemctl", "start", "openclaw")
	case RuntimeDocker:
		name := s.ensureContainerName()
		if name == "" {
			return errors.New("未找到 openclaw 容器")
		}
		return runCommand("docker", "start", name)
	case RuntimeProcess:
		cmdName := ResolveOpenClawCmd()
		if cmdName == "" {
			return errors.New("未找到 openclaw 命令")
		}

		// 读取配置中的端口和 bind
		port := defaultGatewayPort
		bind := "loopback"
		cfgPath := ResolveConfigPath()
		if cfgPath != "" {
			if p := configGatewayPort(cfgPath); p != "" {
				port = p
			}
			if b := configGatewayBind(cfgPath); b != "" {
				bind = b
			}
		}

		if runtime.GOOS == "windows" {
			return s.startWindowsGateway(cmdName, bind, port)
		}
		// Unix: nohup 后台启动
		return runCommand("sh", "-c", fmt.Sprintf("nohup %s gateway run --bind %s --port %s > /tmp/openclaw-gateway.log 2>&1 &", cmdName, bind, port))
	default:
		return errors.New("无法识别本地运行环境，无法启动")
	}
}

func (s *Service) Stop() error {
	// 远程模式：OpenClaw 网关不支持通过 JSON-RPC 停止，需要在远程服务器上操作
	if s.IsRemote() {
		return errors.New("远程网关不支持远程停止，请在远程服务器上手动停止 OpenClaw 网关")
	}
	switch s.DetectRuntime() {
	case RuntimeSystemd:
		return runCommand("systemctl", "stop", "openclaw")
	case RuntimeDocker:
		name := s.ensureContainerName()
		if name == "" {
			return errors.New("未找到 openclaw 容器")
		}
		return runCommand("docker", "stop", name)
	case RuntimeProcess:
		cmdName := ResolveOpenClawCmd()
		if cmdName != "" {
			if err := runCommand(cmdName, "gateway", "stop"); err == nil {
				if waitGatewayDown(5, 700*time.Millisecond) {
					return nil
				}
			}
		}
		if runtime.GOOS == "windows" {
			// Windows: 精确终止 openclaw 相关进程
			// 注意：不能使用 WINDOWTITLE 过滤，因为浏览器标签页标题 "ClawDeckX" 也会匹配，导致浏览器被关闭
			_ = runCommand("taskkill", "/F", "/IM", "openclaw.exe")
			// 终止 node.exe 中运行的 openclaw gateway 进程
			_ = runCommand("powershell", "-NoProfile", "-Command",
				"Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'openclaw' -and $_.CommandLine -match 'gateway' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }")
		} else {
			_ = runCommand("pkill", "-f", "openclaw-gateway")
			_ = runCommand("pkill", "-f", "openclaw gateway")
		}
		if waitGatewayDown(5, 700*time.Millisecond) {
			return nil
		}
		return errors.New("停止 Gateway 超时")
	default:
		return errors.New("无法识别本地运行环境，无法停止")
	}
}

func waitGatewayDown(maxAttempts int, interval time.Duration) bool {
	if maxAttempts <= 0 {
		maxAttempts = 1
	}
	for i := 0; i < maxAttempts; i++ {
		if !processExists() && !gatewayPortListening() {
			return true
		}
		time.Sleep(interval)
	}
	return false
}

func (s *Service) Restart() error {
	// 优先通过 WebSocket JSON-RPC 触发 SIGUSR1 进程内重启
	if s.gwClient != nil && s.gwClient.IsConnected() {
		return s.gwClientRestart()
	}
	if s.IsRemote() {
		return errors.New("远程网关未连接，无法重启")
	}
	rt := s.DetectRuntime()
	logger.Gateway.Debug().Str("runtime", fmt.Sprintf("%v", rt)).Msg(i18n.T(i18n.MsgLogRestartDetectedRuntime))
	switch rt {
	case RuntimeSystemd:
		return runCommand("systemctl", "restart", "openclaw")
	case RuntimeDocker:
		name := s.ensureContainerName()
		if name == "" {
			return errors.New("未找到 openclaw 容器")
		}
		return runCommand("docker", "restart", name)
	case RuntimeProcess:
		if commandExists("openclaw") {
			if err := runCommand("openclaw", "gateway", "restart"); err == nil {
				return nil
			}
		}
		_ = s.Stop()
		return s.Start()
	default:
		logger.Gateway.Error().
			Str("runtime", fmt.Sprintf("%v", rt)).
			Msg(i18n.T(i18n.MsgLogRestartUnknownRuntime))
		return errors.New("无法识别本地运行环境，无法重启")
	}
}

// gwClientRestart 通过 config.patch + restartDelayMs 触发网关 SIGUSR1 进程内重启
func (s *Service) gwClientRestart() error {
	// 第一步：获取当前配置快照的 hash
	cfgData, err := s.gwClient.RequestWithTimeout("config.get", map[string]interface{}{}, 10*time.Second)
	if err != nil {
		return fmt.Errorf("获取网关配置失败: %w", err)
	}
	// 从返回结果中提取 hash
	var baseHash string
	if len(cfgData) > 0 {
		var result map[string]interface{}
		if err := json.Unmarshal(cfgData, &result); err == nil {
			if h, ok := result["hash"].(string); ok {
				baseHash = h
			}
		}
	}
	// 第二步：空 patch + restartDelayMs=0 触发 SIGUSR1 重启
	params := map[string]interface{}{
		"raw":            "{}",
		"restartDelayMs": 0,
		"note":           "ClawDeckX restart",
	}
	if baseHash != "" {
		params["baseHash"] = baseHash
	}
	_, err = s.gwClient.RequestWithTimeout("config.patch", params, 15*time.Second)
	if err != nil {
		return fmt.Errorf("网关重启失败: %w", err)
	}
	return nil
}

func (s *Service) ensureContainerName() string {
	if s.dockerContainer != "" {
		return s.dockerContainer
	}
	s.dockerContainer = findDockerContainer()
	return s.dockerContainer
}

func systemdActive(name string) bool {
	return runOk("systemctl", "is-active", "--quiet", name)
}

func findDockerContainer() string {
	out, err := runOutput("docker", "ps", "-a", "--format", "{{.Names}}")
	if err != nil {
		return ""
	}
	lines := strings.Split(out, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.Contains(strings.ToLower(line), "openclaw") {
			return line
		}
	}
	return ""
}

func processExists() bool {
	if runtime.GOOS == "windows" {
		return processExistsWindows()
	}
	return processExistsUnix()
}

func processExistsWindows() bool {
	// 方法1: PowerShell Get-CimInstance（Windows 10/11 推荐）
	out, err := runOutput("powershell", "-NoProfile", "-Command",
		"Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object -ExpandProperty CommandLine")
	if err == nil {
		for _, line := range strings.Split(out, "\n") {
			lower := strings.ToLower(strings.TrimSpace(line))
			if strings.Contains(lower, "openclaw") && strings.Contains(lower, "gateway") {
				return true
			}
		}
	}

	// 方法2: wmic 降级（旧版 Windows）
	out, err = runOutput("wmic", "process", "where", "name='node.exe'", "get", "commandline")
	if err == nil {
		for _, line := range strings.Split(out, "\n") {
			lower := strings.ToLower(strings.TrimSpace(line))
			if lower == "" || lower == "commandline" {
				continue
			}
			if strings.Contains(lower, "openclaw") && strings.Contains(lower, "gateway") {
				return true
			}
		}
	}

	return false
}

func processExistsUnix() bool {
	out, err := runOutput("ps", "-eo", "args=")
	if err != nil {
		return false
	}
	for _, line := range strings.Split(out, "\n") {
		lower := strings.ToLower(strings.TrimSpace(line))
		if lower == "" {
			continue
		}
		if strings.Contains(lower, "openclaw-gateway") {
			return true
		}
		if strings.Contains(lower, "openclaw gateway") {
			return true
		}
		if strings.Contains(lower, "/openclaw") && strings.Contains(lower, "gateway") {
			return true
		}
	}
	return false
}

func gatewayPortListening() bool {
	ports := gatewayPortsToCheck()
	for _, port := range ports {
		if portListedBySocketTools(port) {
			return true
		}
	}
	return false
}

func gatewayPortsToCheck() []string {
	ports := []string{defaultGatewayPort}
	if p := strings.TrimSpace(os.Getenv("OPENCLAW_GATEWAY_PORT")); p != "" {
		ports = append(ports, p)
	}

	if cfgPath := ResolveConfigPath(); cfgPath != "" {
		if p := configGatewayPort(cfgPath); p != "" {
			ports = append(ports, p)
		}
	}
	return dedupPorts(ports)
}

func configGatewayPort(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return ""
	}
	gw, ok := raw["gateway"].(map[string]any)
	if !ok {
		return ""
	}
	switch v := gw["port"].(type) {
	case float64:
		if v > 0 {
			return fmt.Sprintf("%d", int(v))
		}
	case string:
		return strings.TrimSpace(v)
	}
	return ""
}

func configGatewayBind(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return ""
	}
	gw, ok := raw["gateway"].(map[string]any)
	if !ok {
		return ""
	}
	if v, ok := gw["bind"].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}

// startWindowsGateway Windows 专用：启动网关子进程，stdout/stderr 重定向到日志文件，
// 使用 CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS 使子进程完全独立于父进程。
func (s *Service) startWindowsGateway(cmdName, bind, port string) error {
	// 准备日志文件
	stateDir := ResolveStateDir()
	if stateDir == "" {
		stateDir = filepath.Join(os.TempDir(), ".openclaw")
	}
	logDir := filepath.Join(stateDir, "logs")
	os.MkdirAll(logDir, 0o700)
	logPath := filepath.Join(logDir, "gateway.log")

	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		// 降级到 NUL
		logFile, _ = os.Open(os.DevNull)
	}

	c := exec.Command(cmdName, "gateway", "run", "--bind", bind, "--port", port)
	c.Stdout = logFile
	c.Stderr = logFile
	c.Stdin = nil

	// CREATE_NEW_PROCESS_GROUP (0x200) | DETACHED_PROCESS (0x8)
	// 使子进程不继承父进程的控制台，也不共享进程组信号
	c.SysProcAttr = &sysProcAttrDetached

	if err := c.Start(); err != nil {
		logFile.Close()
		return fmt.Errorf("启动网关进程失败: %w", err)
	}

	// 释放进程句柄，让子进程完全独立运行
	go func() {
		c.Wait()
		logFile.Close()
	}()

	// 等待网关端口就绪（最多 15 秒）
	for i := 0; i < 30; i++ {
		time.Sleep(500 * time.Millisecond)
		if gatewayPortListening() {
			output.Debugf("网关已在端口 %s 上启动\n", port)
			return nil
		}
	}

	// 端口未就绪但进程可能还在启动中，不算失败
	output.Debugf("网关启动命令已执行，日志: %s\n", logPath)
	return nil
}

func dedupPorts(in []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(in))
	for _, p := range in {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out
}

func commandExists(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func runOk(cmd string, args ...string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	c := exec.CommandContext(ctx, cmd, args...)
	err := c.Run()
	if err != nil {
		output.Debugf("命令失败: %s %s err=%s\n", cmd, strings.Join(args, " "), err)
		return false
	}
	return true
}

func runCommand(cmd string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	c := exec.CommandContext(ctx, cmd, args...)
	out, err := c.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s 失败: %s", cmd, strings.Join(args, " "), strings.TrimSpace(string(out)))
	}
	output.Debugf("命令成功: %s %s\n", cmd, strings.Join(args, " "))
	return nil
}

func runOutput(cmd string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	c := exec.CommandContext(ctx, cmd, args...)
	out, err := c.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func portListedBySocketTools(port string) bool {
	// 跨平台首选：直接 TCP 连接探测
	conn, err := net.DialTimeout("tcp", "127.0.0.1:"+port, time.Second)
	if err == nil {
		conn.Close()
		return true
	}

	if runtime.GOOS == "windows" {
		// Windows: netstat -an
		if out, err := runOutput("netstat", "-an"); err == nil {
			for _, line := range strings.Split(out, "\n") {
				if strings.Contains(line, ":"+port) && strings.Contains(strings.ToUpper(line), "LISTENING") {
					return true
				}
			}
		}
	} else {
		// Linux/macOS: ss or netstat
		if out, err := runOutput("ss", "-lnt"); err == nil {
			if strings.Contains(out, ":"+port) {
				return true
			}
		}
		if out, err := runOutput("netstat", "-lnt"); err == nil {
			if strings.Contains(out, ":"+port) {
				return true
			}
		}
	}
	return false
}
