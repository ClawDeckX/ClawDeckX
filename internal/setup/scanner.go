package setup

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"ClawDeckX/internal/openclaw"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// ToolInfo 工具信息
type ToolInfo struct {
	Installed bool   `json:"installed"`
	Version   string `json:"version,omitempty"`
	Path      string `json:"path,omitempty"`
}

// Step 安装步骤
type Step struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Command     string `json:"command,omitempty"`
	Required    bool   `json:"required"`
}

// EnvironmentReport 环境扫描报告
type EnvironmentReport struct {
	// 系统信息
	OS            string `json:"os"`
	Arch          string `json:"arch"`
	Distro        string `json:"distro,omitempty"`
	DistroVersion string `json:"distroVersion,omitempty"`
	Kernel        string `json:"kernel,omitempty"`
	Hostname      string `json:"hostname"`
	IsWSL         bool   `json:"isWsl"`
	IsDocker      bool   `json:"isDocker"`
	IsSSH         bool   `json:"isSsh"`
	IsRoot        bool   `json:"isRoot"`
	CurrentUser   string `json:"currentUser"`

	// 包管理器
	PackageManager string `json:"packageManager"` // "brew" | "apt" | "dnf" | "yum" | "apk" | "winget" | "choco"
	HasSudo        bool   `json:"hasSudo"`

	// 已安装工具
	Tools map[string]ToolInfo `json:"tools"`

	// 网络
	InternetAccess  bool   `json:"internetAccess"`
	NpmRegistry     string `json:"npmRegistry,omitempty"`
	RegistryLatency int    `json:"registryLatency,omitempty"` // ms

	// 磁盘
	HomeDirWritable bool    `json:"homeDirWritable"`
	DiskFreeGB      float64 `json:"diskFreeGb,omitempty"`

	// OpenClaw 状态
	OpenClawInstalled   bool   `json:"openClawInstalled"`
	OpenClawConfigured  bool   `json:"openClawConfigured"`
	OpenClawVersion     string `json:"openClawVersion,omitempty"`
	OpenClawCnInstalled bool   `json:"openClawCnInstalled"`
	OpenClawCnVersion   string `json:"openClawCnVersion,omitempty"`
	OpenClawConfigPath  string `json:"openClawConfigPath,omitempty"`
	GatewayRunning      bool   `json:"gatewayRunning"`
	GatewayPort         int    `json:"gatewayPort,omitempty"`

	// 推荐安装方案
	RecommendedMethod string   `json:"recommendedMethod"` // "installer-script" | "npm" | "docker"
	RecommendedSteps  []Step   `json:"recommendedSteps"`
	Warnings          []string `json:"warnings,omitempty"`

	// 版本检查
	LatestOpenClawVersion string `json:"latestOpenClawVersion,omitempty"`
	UpdateAvailable       bool   `json:"updateAvailable"`

	// 扫描时间
	ScanTime string `json:"scanTime"`
}

// Scan 执行完整环境扫描
func Scan() (*EnvironmentReport, error) {
	report := &EnvironmentReport{
		OS:       runtime.GOOS,
		Arch:     runtime.GOARCH,
		Tools:    make(map[string]ToolInfo),
		ScanTime: time.Now().Format(time.RFC3339),
	}

	// 系统信息
	report.Hostname, _ = os.Hostname()
	report.CurrentUser = getCurrentUser()
	report.IsRoot = isRoot()
	report.IsWSL = detectWSL()
	report.IsDocker = detectDocker()
	report.IsSSH = detectSSH()

	// Linux 发行版检测
	if runtime.GOOS == "linux" {
		report.Distro, report.DistroVersion = detectDistro()
	}

	// 内核版本
	report.Kernel = detectKernel()

	// 包管理器检测
	report.PackageManager = detectPackageManager()
	report.HasSudo = detectSudo()

	// 工具检测
	report.Tools = detectTools()

	// 网络检测
	report.InternetAccess = checkInternetAccess()
	if report.Tools["npm"].Installed {
		report.NpmRegistry, report.RegistryLatency = detectNpmRegistry()
	}

	// 磁盘检测
	report.HomeDirWritable = checkHomeDirWritable()
	report.DiskFreeGB = getDiskFreeGB()

	// OpenClaw 状态
	report.OpenClawInstalled = report.Tools["openclaw"].Installed
	report.OpenClawVersion = report.Tools["openclaw"].Version
	report.OpenClawCnInstalled = report.Tools["openclaw-cn"].Installed
	report.OpenClawCnVersion = report.Tools["openclaw-cn"].Version
	if !report.OpenClawInstalled && report.OpenClawCnInstalled {
		report.OpenClawInstalled = true
		report.OpenClawVersion = report.OpenClawCnVersion
	}
	report.OpenClawConfigPath = GetOpenClawConfigPath()
	report.OpenClawConfigured = checkOpenClawConfigured(report.OpenClawConfigPath)
	report.OpenClawConfigPath = GetOpenClawConfigPath()
	report.OpenClawConfigured = checkOpenClawConfigured(report.OpenClawConfigPath)
	report.GatewayRunning, report.GatewayPort = checkGatewayRunning()

	// 检查更新 (仅当已安装 OpenClaw 时)
	if report.OpenClawInstalled {
		latest := fetchLatestVersion()
		if latest != "" {
			report.LatestOpenClawVersion = latest
			// 简单的版本比较: latest != current
			// 实际场景可能需要 semver 比较，这里简化处理
			// 只有当 version != latest 且 latest 不为空时认为有更新
			if report.OpenClawVersion != "" && report.OpenClawVersion != latest {
				report.UpdateAvailable = true
			}
		}
	}

	// 推荐安装方案
	report.RecommendedMethod = recommendInstallMethod(report)
	report.RecommendedSteps = generateRecommendedSteps(report)
	report.Warnings = generateWarnings(report)

	return report, nil
}

// getCurrentUser 获取当前用户名
func getCurrentUser() string {
	if u, err := user.Current(); err == nil {
		return u.Username
	}
	return os.Getenv("USER")
}

// isRoot 检测是否为 root 用户
func isRoot() bool {
	if runtime.GOOS == "windows" {
		return false // Windows 不使用 root 概念
	}
	return os.Getuid() == 0
}

// detectWSL 检测是否在 WSL 环境
func detectWSL() bool {
	if runtime.GOOS != "linux" {
		return false
	}
	// 检查 /proc/version 是否包含 Microsoft
	data, err := os.ReadFile("/proc/version")
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToLower(string(data)), "microsoft")
}

// detectDocker 检测是否在 Docker 容器中
func detectDocker() bool {
	// 检查 /.dockerenv 文件
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}
	// 检查 /proc/1/cgroup 是否包含 docker
	data, err := os.ReadFile("/proc/1/cgroup")
	if err == nil && strings.Contains(string(data), "docker") {
		return true
	}
	return false
}

// detectSSH 检测是否通过 SSH 连接
func detectSSH() bool {
	return os.Getenv("SSH_CONNECTION") != "" || os.Getenv("SSH_CLIENT") != ""
}

// detectDistro 检测 Linux 发行版
func detectDistro() (name, version string) {
	// 尝试读取 /etc/os-release
	data, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return "", ""
	}
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		if strings.HasPrefix(line, "ID=") {
			name = strings.Trim(strings.TrimPrefix(line, "ID="), "\"")
		}
		if strings.HasPrefix(line, "VERSION_ID=") {
			version = strings.Trim(strings.TrimPrefix(line, "VERSION_ID="), "\"")
		}
	}
	return name, version
}

// detectKernel 检测内核版本
func detectKernel() string {
	if runtime.GOOS == "windows" {
		out, err := exec.Command("cmd", "/c", "ver").Output()
		if err == nil {
			return strings.TrimSpace(string(out))
		}
		return ""
	}
	out, err := exec.Command("uname", "-r").Output()
	if err == nil {
		return strings.TrimSpace(string(out))
	}
	return ""
}

// detectPackageManager 检测系统包管理器
func detectPackageManager() string {
	switch runtime.GOOS {
	case "darwin":
		if commandExists("brew") {
			return "brew"
		}
		return ""
	case "linux":
		// 按优先级检测
		managers := []string{"apt", "dnf", "yum", "apk", "pacman", "zypper"}
		for _, m := range managers {
			if commandExists(m) {
				return m
			}
		}
		return ""
	case "windows":
		if commandExists("winget") {
			return "winget"
		}
		if commandExists("choco") {
			return "choco"
		}
		return ""
	}
	return ""
}

// detectSudo 检测是否有 sudo 权限
func detectSudo() bool {
	if runtime.GOOS == "windows" {
		return false
	}
	if isRoot() {
		return true
	}
	// 尝试 sudo -n true 检测无密码 sudo
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sudo", "-n", "true")
	return cmd.Run() == nil
}

// detectTools 检测已安装工具
func detectTools() map[string]ToolInfo {
	tools := make(map[string]ToolInfo)

	// Node.js - 使用增强检测
	tools["node"] = detectNodeWithFallback()

	// npm - 使用增强检测
	tools["npm"] = detectNpmWithFallback()

	// Git
	tools["git"] = detectTool("git", "--version")

	// curl
	tools["curl"] = detectTool("curl", "--version")

	// wget
	tools["wget"] = detectTool("wget", "--version")

	// PowerShell
	if runtime.GOOS == "windows" {
		// powershell -Version starts interactive shell, use -Command instead
		tools["powershell"] = detectTool("powershell", "-Command \"$PSVersionTable.PSVersion.ToString()\"")
	}

	// OpenClaw
	tools["openclaw"] = detectTool("openclaw", "--version")

	// ClawHub CLI
	tools["clawhub"] = detectTool("clawhub", "--version")

	// OpenClaw CN
	tools["openclaw-cn"] = detectTool("openclaw-cn", "--version")

	// Docker
	tools["docker"] = detectTool("docker", "--version")

	// Python
	tools["python"] = detectPython()

	// Homebrew (macOS only — not recommended on Linux)
	if runtime.GOOS == "darwin" {
		tools["brew"] = detectTool("brew", "--version")
		tools["xcode-cli"] = detectXcodeCLI()
	}

	// Skill runtime dependencies
	tools["go"] = detectTool("go", "version")
	tools["uv"] = detectTool("uv", "--version")
	tools["ffmpeg"] = detectTool("ffmpeg", "-version")
	tools["jq"] = detectTool("jq", "--version")
	tools["rg"] = detectTool("rg", "--version")

	return tools
}

// detectTool 检测单个工具
func detectTool(name string, versionArg string) ToolInfo {
	path, err := exec.LookPath(name)
	if err != nil {
		return ToolInfo{Installed: false}
	}

	info := ToolInfo{
		Installed: true,
		Path:      path,
	}

	// 获取版本
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, versionArg)
	out, err := cmd.Output()
	if err == nil {
		version := strings.TrimSpace(string(out))
		// 提取版本号
		version = extractVersion(version)
		info.Version = version
	}

	return info
}

// detectXcodeCLI checks if Xcode Command Line Tools are installed (macOS only).
// Required for native module compilation (e.g. sharp).
func detectXcodeCLI() ToolInfo {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "xcode-select", "-p")
	out, err := cmd.Output()
	if err != nil {
		return ToolInfo{Installed: false}
	}
	path := strings.TrimSpace(string(out))
	if path == "" {
		return ToolInfo{Installed: false}
	}
	// get version via pkgutil
	ctx2, cancel2 := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel2()
	cmd2 := exec.CommandContext(ctx2, "pkgutil", "--pkg-info=com.apple.pkg.CLTools_Executables")
	out2, _ := cmd2.Output()
	version := ""
	for _, line := range strings.Split(string(out2), "\n") {
		if strings.HasPrefix(line, "version:") {
			version = strings.TrimSpace(strings.TrimPrefix(line, "version:"))
			break
		}
	}
	return ToolInfo{Installed: true, Path: path, Version: version}
}

// detectPython 检测 Python
func detectPython() ToolInfo {
	// 优先检测 python3
	if info := detectTool("python3", "--version"); info.Installed {
		return info
	}
	return detectTool("python", "--version")
}

// detectNodeWithFallback 增强的 Node.js 检测（支持多路径）
func detectNodeWithFallback() ToolInfo {
	// 1. 先尝试 PATH
	if info := detectTool("node", "--version"); info.Installed {
		return info
	}

	// 2. 检测常见路径
	paths := getNodePaths()
	for _, path := range paths {
		if fileExists(path) {
			if info := detectToolByPath(path, "--version"); info.Installed {
				return info
			}
		}
	}

	// 3. Unix 系统尝试通过 shell 加载用户环境
	if runtime.GOOS != "windows" {
		if info := detectNodeViaShell(); info.Installed {
			return info
		}
	}

	return ToolInfo{Installed: false}
}

// detectNpmWithFallback 增强的 npm 检测（支持多路径）
func detectNpmWithFallback() ToolInfo {
	// 1. 先尝试 PATH
	if info := detectTool("npm", "--version"); info.Installed {
		return info
	}

	// 2. 检测常见路径
	paths := getNpmPaths()
	for _, path := range paths {
		if fileExists(path) {
			if info := detectToolByPath(path, "--version"); info.Installed {
				return info
			}
		}
	}

	return ToolInfo{Installed: false}
}

// getNodePaths 获取 Node.js 可能的安装路径
func getNodePaths() []string {
	var paths []string
	home, _ := os.UserHomeDir()

	switch runtime.GOOS {
	case "darwin":
		// Homebrew
		paths = append(paths, "/opt/homebrew/bin/node") // Apple Silicon
		paths = append(paths, "/usr/local/bin/node")    // Intel Mac
		// 系统安装
		paths = append(paths, "/usr/bin/node")
		// nvm
		if home != "" {
			// 尝试读取 nvm default alias
			nvmDefault := filepath.Join(home, ".nvm", "alias", "default")
			if data, err := os.ReadFile(nvmDefault); err == nil {
				version := strings.TrimSpace(string(data))
				if version != "" {
					paths = append(paths, filepath.Join(home, ".nvm", "versions", "node", "v"+version, "bin", "node"))
				}
			}
			// 常见版本
			for _, v := range []string{"22.12.0", "22.11.0", "22.0.0", "23.0.0"} {
				paths = append(paths, filepath.Join(home, ".nvm", "versions", "node", "v"+v, "bin", "node"))
			}
			// fnm
			paths = append(paths, filepath.Join(home, ".fnm", "aliases", "default", "bin", "node"))
			// volta
			paths = append(paths, filepath.Join(home, ".volta", "bin", "node"))
			// asdf
			paths = append(paths, filepath.Join(home, ".asdf", "shims", "node"))
			// mise
			paths = append(paths, filepath.Join(home, ".local", "share", "mise", "shims", "node"))
		}

	case "linux":
		// 系统安装
		paths = append(paths, "/usr/bin/node")
		paths = append(paths, "/usr/local/bin/node")
		// nvm
		if home != "" {
			nvmDefault := filepath.Join(home, ".nvm", "alias", "default")
			if data, err := os.ReadFile(nvmDefault); err == nil {
				version := strings.TrimSpace(string(data))
				if version != "" {
					paths = append(paths, filepath.Join(home, ".nvm", "versions", "node", "v"+version, "bin", "node"))
				}
			}
			for _, v := range []string{"22.12.0", "22.11.0", "22.0.0", "23.0.0"} {
				paths = append(paths, filepath.Join(home, ".nvm", "versions", "node", "v"+v, "bin", "node"))
			}
			// fnm
			paths = append(paths, filepath.Join(home, ".fnm", "aliases", "default", "bin", "node"))
			// volta
			paths = append(paths, filepath.Join(home, ".volta", "bin", "node"))
			// asdf
			paths = append(paths, filepath.Join(home, ".asdf", "shims", "node"))
		}

	case "windows":
		// 标准安装路径
		paths = append(paths, "C:\\Program Files\\nodejs\\node.exe")
		paths = append(paths, "C:\\Program Files (x86)\\nodejs\\node.exe")

		if home != "" {
			// nvm-windows
			// 尝试读取 NVM_SYMLINK 环境变量
			if nvmSymlink := os.Getenv("NVM_SYMLINK"); nvmSymlink != "" {
				paths = append(paths, filepath.Join(nvmSymlink, "node.exe"))
			}
			// 尝试读取 NVM_HOME
			if nvmHome := os.Getenv("NVM_HOME"); nvmHome != "" {
				// 读取 settings.txt 获取当前版本
				settingsPath := filepath.Join(nvmHome, "settings.txt")
				if data, err := os.ReadFile(settingsPath); err == nil {
					for _, line := range strings.Split(string(data), "\n") {
						if strings.HasPrefix(line, "current:") {
							version := strings.TrimSpace(strings.TrimPrefix(line, "current:"))
							if version != "" {
								paths = append(paths, filepath.Join(nvmHome, "v"+version, "node.exe"))
							}
						}
					}
				}
			}
			// 常见 nvm-windows 路径
			paths = append(paths, filepath.Join(home, "AppData\\Roaming\\nvm\\current\\node.exe"))
			// fnm
			paths = append(paths, filepath.Join(home, "AppData\\Roaming\\fnm\\aliases\\default\\node.exe"))
			paths = append(paths, filepath.Join(home, "AppData\\Local\\fnm\\aliases\\default\\node.exe"))
			paths = append(paths, filepath.Join(home, ".fnm\\aliases\\default\\node.exe"))
			// volta
			paths = append(paths, filepath.Join(home, "AppData\\Local\\Volta\\bin\\node.exe"))
			// scoop
			paths = append(paths, filepath.Join(home, "scoop\\apps\\nodejs\\current\\node.exe"))
			paths = append(paths, filepath.Join(home, "scoop\\apps\\nodejs-lts\\current\\node.exe"))
		}
		// chocolatey
		paths = append(paths, "C:\\ProgramData\\chocolatey\\lib\\nodejs\\tools\\node.exe")
	}

	return paths
}

// getNpmPaths 获取 npm 可能的安装路径
func getNpmPaths() []string {
	var paths []string
	home, _ := os.UserHomeDir()

	switch runtime.GOOS {
	case "darwin", "linux":
		paths = append(paths, "/opt/homebrew/bin/npm")
		paths = append(paths, "/usr/local/bin/npm")
		paths = append(paths, "/usr/bin/npm")
		if home != "" {
			// nvm
			nvmDefault := filepath.Join(home, ".nvm", "alias", "default")
			if data, err := os.ReadFile(nvmDefault); err == nil {
				version := strings.TrimSpace(string(data))
				if version != "" {
					paths = append(paths, filepath.Join(home, ".nvm", "versions", "node", "v"+version, "bin", "npm"))
				}
			}
			for _, v := range []string{"22.12.0", "22.11.0", "22.0.0"} {
				paths = append(paths, filepath.Join(home, ".nvm", "versions", "node", "v"+v, "bin", "npm"))
			}
			paths = append(paths, filepath.Join(home, ".fnm", "aliases", "default", "bin", "npm"))
			paths = append(paths, filepath.Join(home, ".volta", "bin", "npm"))
		}
	case "windows":
		paths = append(paths, "C:\\Program Files\\nodejs\\npm.cmd")
		if home != "" {
			paths = append(paths, filepath.Join(home, "AppData\\Roaming\\nvm\\current\\npm.cmd"))
			paths = append(paths, filepath.Join(home, "AppData\\Roaming\\fnm\\aliases\\default\\npm.cmd"))
		}
	}

	return paths
}

// detectToolByPath 通过完整路径检测工具
func detectToolByPath(path string, versionArg string) ToolInfo {
	info := ToolInfo{
		Installed: true,
		Path:      path,
	}

	// 获取版本
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, versionArg)
	out, err := cmd.Output()
	if err == nil {
		version := strings.TrimSpace(string(out))
		version = extractVersion(version)
		info.Version = version
	}

	return info
}

// detectNodeViaShell 通过 shell 加载用户环境检测 Node.js (Unix only)
func detectNodeViaShell() ToolInfo {
	shells := []string{
		"source ~/.zshrc 2>/dev/null || source ~/.bashrc 2>/dev/null; node --version 2>/dev/null",
		"source ~/.bash_profile 2>/dev/null; node --version 2>/dev/null",
	}

	for _, shellCmd := range shells {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		cmd := exec.CommandContext(ctx, "sh", "-c", shellCmd)
		out, err := cmd.Output()
		cancel()
		if err == nil {
			version := strings.TrimSpace(string(out))
			if version != "" && strings.HasPrefix(version, "v") {
				return ToolInfo{
					Installed: true,
					Version:   extractVersion(version),
					Path:      "(via shell)",
				}
			}
		}
	}

	return ToolInfo{Installed: false}
}

// fileExists 检查文件是否存在
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// extractVersion 从输出中提取版本号
func extractVersion(output string) string {
	// 常见格式: "v22.0.0", "node v22.0.0", "git version 2.40.0", "22.0.0"
	output = strings.TrimPrefix(output, "v")
	parts := strings.Fields(output)
	for _, part := range parts {
		part = strings.TrimPrefix(part, "v")
		// 检查是否像版本号
		if len(part) > 0 && (part[0] >= '0' && part[0] <= '9') {
			// 只取第一行
			lines := strings.Split(part, "\n")
			return lines[0]
		}
	}
	// 返回第一行
	lines := strings.Split(output, "\n")
	if len(lines) > 0 {
		return lines[0]
	}
	return output
}

// commandExists 检测命令是否存在
func commandExists(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

// checkInternetAccess 检测网络连通性
func checkInternetAccess() bool {
	// 尝试连接常用地址
	targets := []string{
		"registry.npmjs.org:443",
		"github.com:443",
		"google.com:443",
	}
	for _, target := range targets {
		conn, err := net.DialTimeout("tcp", target, 3*time.Second)
		if err == nil {
			conn.Close()
			return true
		}
	}
	return false
}

// detectNpmRegistry 检测 npm 镜像源
func detectNpmRegistry() (registry string, latency int) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "npm", "config", "get", "registry")
	out, err := cmd.Output()
	if err == nil {
		registry = strings.TrimSpace(string(out))
	} else {
		registry = "https://registry.npmjs.org/"
	}

	// 测试延迟
	start := time.Now()
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(registry)
	if err == nil {
		resp.Body.Close()
		latency = int(time.Since(start).Milliseconds())
	}

	return registry, latency
}

// checkHomeDirWritable 检测 home 目录是否可写
func checkHomeDirWritable() bool {
	home, err := os.UserHomeDir()
	if err != nil {
		return false
	}
	testFile := filepath.Join(home, ".ClawDeckX_write_test")
	f, err := os.Create(testFile)
	if err != nil {
		return false
	}
	f.Close()
	os.Remove(testFile)
	return true
}

// getDiskFreeGB 获取磁盘剩余空间 (GB)
func getDiskFreeGB() float64 {
	home, err := os.UserHomeDir()
	if err != nil {
		return 0
	}

	switch runtime.GOOS {
	case "windows":
		// Windows: 使用 wmic
		drive := filepath.VolumeName(home)
		if drive == "" {
			drive = "C:"
		}
		cmd := exec.Command("wmic", "logicaldisk", "where", fmt.Sprintf("DeviceID='%s'", drive), "get", "FreeSpace", "/format:value")
		out, err := cmd.Output()
		if err != nil {
			return 0
		}
		for _, line := range strings.Split(string(out), "\n") {
			if strings.HasPrefix(line, "FreeSpace=") {
				val := strings.TrimPrefix(line, "FreeSpace=")
				val = strings.TrimSpace(val)
				if bytes, err := strconv.ParseInt(val, 10, 64); err == nil {
					return float64(bytes) / (1024 * 1024 * 1024)
				}
			}
		}
	default:
		// Unix: 使用 df
		cmd := exec.Command("df", "-k", home)
		out, err := cmd.Output()
		if err != nil {
			return 0
		}
		lines := strings.Split(string(out), "\n")
		if len(lines) >= 2 {
			fields := strings.Fields(lines[1])
			if len(fields) >= 4 {
				if avail, err := strconv.ParseInt(fields[3], 10, 64); err == nil {
					return float64(avail) / (1024 * 1024) // KB to GB
				}
			}
		}
	}
	return 0
}

// ResolveStateDir 解析 OpenClaw 状态目录（委托给 openclaw 包）
func ResolveStateDir() string {
	return openclaw.ResolveStateDir()
}

// GetOpenClawConfigPath 获取 OpenClaw 配置文件路径（委托给 openclaw 包）
func GetOpenClawConfigPath() string {
	return openclaw.ResolveConfigPath()
}

// checkOpenClawConfigured 检测 OpenClaw 是否已配置（有模型服务商）
func checkOpenClawConfigured(configPath string) bool {
	if configPath == "" {
		return false
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		return false
	}
	var config map[string]interface{}
	if err := json.Unmarshal(data, &config); err != nil {
		return false
	}
	// 新 schema: models.providers 是一个非空对象
	if models, ok := config["models"].(map[string]interface{}); ok {
		if providers, ok := models["providers"].(map[string]interface{}); ok && len(providers) > 0 {
			return true
		}
	}
	// 旧 schema: model.provider
	if model, ok := config["model"].(map[string]interface{}); ok {
		if _, hasProvider := model["provider"]; hasProvider {
			return true
		}
	}
	return false
}

// readOpenClawConfigRaw 读取 openclaw.json 并返回原始 map
func readOpenClawConfigRaw(configPath string) map[string]interface{} {
	if configPath == "" {
		return nil
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil
	}
	return raw
}

// checkConfigFileValid 检查配置文件是否存在且为合法 JSON，返回 (exists, valid, error描述)
func checkConfigFileValid(configPath string) (exists bool, valid bool, detail string) {
	if configPath == "" {
		return false, false, "config path is empty"
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return false, false, "config file does not exist"
		}
		return false, false, fmt.Sprintf("cannot read config: %v", err)
	}
	if len(data) == 0 {
		return true, false, "config file is empty"
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return true, false, fmt.Sprintf("invalid JSON: %v", err)
	}
	// 至少需要 gateway 段
	if _, ok := raw["gateway"]; !ok {
		return true, false, "missing gateway section"
	}
	return true, true, ""
}

// configGatewayPortFromFile 从配置文件读取 gateway.port
func configGatewayPortFromFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return ""
	}
	gw, ok := raw["gateway"].(map[string]interface{})
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

// configGatewayBindFromFile 从配置文件读取 gateway.bind
func configGatewayBindFromFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return ""
	}
	gw, ok := raw["gateway"].(map[string]interface{})
	if !ok {
		return ""
	}
	if v, ok := gw["bind"].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}

// checkGatewayRunning 检测 Gateway 是否运行（通过 HTTP 健康检查确认是真正的 OpenClaw Gateway）
func checkGatewayRunning() (running bool, port int) {
	ports := []int{18789, 18790, 18791}
	client := &http.Client{Timeout: 2 * time.Second}
	for _, p := range ports {
		// 优先通过 /health 端点确认是 OpenClaw Gateway
		url := fmt.Sprintf("http://127.0.0.1:%d/health", p)
		resp, err := client.Get(url)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode < 500 {
				return true, p
			}
		}
	}
	return false, 0
}

// detectBrowser 检测系统已安装的 Chromium 内核浏览器
// 按 openclaw 相同优先级: Chrome → Brave → Edge → Chromium
func detectBrowser() ToolInfo {
	switch runtime.GOOS {
	case "windows":
		return detectBrowserWindows()
	case "darwin":
		return detectBrowserMac()
	case "linux":
		return detectBrowserLinux()
	}
	return ToolInfo{Installed: false}
}

func detectBrowserWindows() ToolInfo {
	localAppData := os.Getenv("LOCALAPPDATA")
	programFiles := os.Getenv("ProgramFiles")
	if programFiles == "" {
		programFiles = "C:\\Program Files"
	}
	programFilesX86 := os.Getenv("ProgramFiles(x86)")
	if programFilesX86 == "" {
		programFilesX86 = "C:\\Program Files (x86)"
	}

	type candidate struct {
		kind string
		path string
	}
	var candidates []candidate

	if localAppData != "" {
		candidates = append(candidates,
			candidate{"chrome", filepath.Join(localAppData, "Google", "Chrome", "Application", "chrome.exe")},
			candidate{"brave", filepath.Join(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")},
			candidate{"edge", filepath.Join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe")},
			candidate{"chromium", filepath.Join(localAppData, "Chromium", "Application", "chrome.exe")},
		)
	}
	candidates = append(candidates,
		candidate{"chrome", filepath.Join(programFiles, "Google", "Chrome", "Application", "chrome.exe")},
		candidate{"chrome", filepath.Join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe")},
		candidate{"brave", filepath.Join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")},
		candidate{"brave", filepath.Join(programFilesX86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")},
		candidate{"edge", filepath.Join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe")},
		candidate{"edge", filepath.Join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe")},
	)

	for _, c := range candidates {
		if fileExists(c.path) {
			return ToolInfo{Installed: true, Path: c.path, Version: c.kind}
		}
	}
	return ToolInfo{Installed: false}
}

func detectBrowserMac() ToolInfo {
	home, _ := os.UserHomeDir()
	type candidate struct {
		kind string
		path string
	}
	candidates := []candidate{
		{"chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"},
		{"brave", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"},
		{"edge", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"},
		{"chromium", "/Applications/Chromium.app/Contents/MacOS/Chromium"},
	}
	if home != "" {
		candidates = append(candidates,
			candidate{"chrome", filepath.Join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")},
			candidate{"brave", filepath.Join(home, "Applications/Brave Browser.app/Contents/MacOS/Brave Browser")},
			candidate{"edge", filepath.Join(home, "Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")},
			candidate{"chromium", filepath.Join(home, "Applications/Chromium.app/Contents/MacOS/Chromium")},
		)
	}
	for _, c := range candidates {
		if fileExists(c.path) {
			return ToolInfo{Installed: true, Path: c.path, Version: c.kind}
		}
	}
	return ToolInfo{Installed: false}
}

func detectBrowserLinux() ToolInfo {
	type candidate struct {
		kind string
		path string
	}
	candidates := []candidate{
		{"chrome", "/usr/bin/google-chrome"},
		{"chrome", "/usr/bin/google-chrome-stable"},
		{"brave", "/usr/bin/brave-browser"},
		{"brave", "/usr/bin/brave-browser-stable"},
		{"edge", "/usr/bin/microsoft-edge"},
		{"edge", "/usr/bin/microsoft-edge-stable"},
		{"chromium", "/usr/bin/chromium"},
		{"chromium", "/usr/bin/chromium-browser"},
		{"chromium", "/snap/bin/chromium"},
	}
	for _, c := range candidates {
		if fileExists(c.path) {
			return ToolInfo{Installed: true, Path: c.path, Version: c.kind}
		}
	}
	return ToolInfo{Installed: false}
}

// detectBrowserVersion 获取浏览器版本号
// Windows: 读取 exe 文件版本信息（避免 chrome.exe --version 会启动浏览器窗口）
// Unix: 直接执行 --version
func detectBrowserVersion(browserPath string) string {
	if browserPath == "" {
		return ""
	}

	if runtime.GOOS == "windows" {
		// Use PowerShell to read file version without launching the browser
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		ps := fmt.Sprintf(`(Get-Item '%s').VersionInfo.ProductVersion`, browserPath)
		cmd := exec.CommandContext(ctx, "powershell", "-NoProfile", "-Command", ps)
		out, err := cmd.Output()
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(out))
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, browserPath, "--version")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return extractVersion(strings.TrimSpace(string(out)))
}

// getBrowserInstallCommand 获取浏览器安装命令
func getBrowserInstallCommand(report *EnvironmentReport) string {
	switch report.PackageManager {
	case "brew":
		return "brew install --cask google-chrome"
	case "apt":
		return "wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg && echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main' | sudo tee /etc/apt/sources.list.d/google-chrome.list && sudo apt-get update && sudo apt-get install -y google-chrome-stable"
	case "dnf", "yum":
		return "sudo dnf install -y google-chrome-stable"
	case "winget":
		return "winget install Google.Chrome --accept-package-agreements --accept-source-agreements"
	case "choco":
		return "choco install googlechrome -y"
	default:
		if runtime.GOOS == "windows" {
			return "winget install Google.Chrome --accept-package-agreements --accept-source-agreements"
		}
		return "# Please install Chrome/Brave/Edge from https://www.google.com/chrome/"
	}
}

// recommendInstallMethod 推荐安装方式
func recommendInstallMethod(report *EnvironmentReport) string {
	// 如果已安装，返回空
	if report.OpenClawInstalled {
		return ""
	}

	// 优先使用 npm，因为脚本安装包含交互式向导
	if report.Tools["node"].Installed && report.Tools["npm"].Installed {
		return "npm"
	}

	// 如果没有 npm，推荐先安装依赖（Node.js），然后再用 npm 安装
	// 即使有 curl，也不推荐 installer-script，因为它不可控
	return "install-deps-first"
}

// generateRecommendedSteps 生成推荐安装步骤
func generateRecommendedSteps(report *EnvironmentReport) []Step {
	var steps []Step

	// 如果已安装
	if report.OpenClawInstalled {
		if !report.OpenClawConfigured {
			steps = append(steps, Step{
				Name:        "configure",
				Description: "配置 OpenClaw",
				Required:    true,
			})
		}
		if !report.GatewayRunning {
			steps = append(steps, Step{
				Name:        "start-gateway",
				Description: "启动 Gateway",
				Required:    true,
			})
		}
		return steps
	}

	// 检测缺失依赖
	if !report.Tools["node"].Installed {
		steps = append(steps, Step{
			Name:        "install-node",
			Description: "安装 Node.js 22+",
			Command:     getNodeInstallCommand(report),
			Required:    true,
		})
	}

	if !report.Tools["git"].Installed {
		steps = append(steps, Step{
			Name:        "install-git",
			Description: "安装 Git",
			Command:     getGitInstallCommand(report),
			Required:    false,
		})
	}

	// 安装 OpenClaw
	steps = append(steps, Step{
		Name:        "install-openclaw",
		Description: "安装 OpenClaw",
		Command:     getOpenClawInstallCommand(report),
		Required:    true,
	})

	// 配置
	steps = append(steps, Step{
		Name:        "configure",
		Description: "配置 AI 服务商和 API Key",
		Required:    true,
	})

	// 启动
	steps = append(steps, Step{
		Name:        "start-gateway",
		Description: "启动 Gateway",
		Required:    true,
	})

	// 验证
	steps = append(steps, Step{
		Name:        "verify",
		Description: "验证安装",
		Command:     "openclaw doctor",
		Required:    true,
	})

	return steps
}

// getNodeInstallCommand 获取 Node.js 安装命令
func getNodeInstallCommand(report *EnvironmentReport) string {
	switch report.PackageManager {
	case "brew":
		return "brew install node@22"
	case "apt":
		return "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
	case "dnf", "yum":
		return "curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - && sudo dnf install -y nodejs"
	case "apk":
		return "apk add nodejs npm"
	case "winget":
		return "winget install OpenJS.NodeJS.LTS"
	case "choco":
		return "choco install nodejs-lts"
	default:
		return "# 请访问 https://nodejs.org/en/download/ 下载安装 Node.js"
	}
}

// getGitInstallCommand 获取 Git 安装命令
func getGitInstallCommand(report *EnvironmentReport) string {
	switch report.PackageManager {
	case "brew":
		return "brew install git"
	case "apt":
		return "sudo apt-get install -y git"
	case "dnf", "yum":
		return "sudo dnf install -y git"
	case "apk":
		return "apk add git"
	case "winget":
		return "winget install Git.Git"
	case "choco":
		return "choco install git"
	default:
		return "# 请访问 https://git-scm.com/downloads 下载安装 Git"
	}
}

// getOpenClawInstallCommand 获取 OpenClaw 安装命令
func getOpenClawInstallCommand(report *EnvironmentReport) string {
	switch report.RecommendedMethod {
	case "installer-script":
		if runtime.GOOS == "windows" {
			return "& ([scriptblock]::Create((iwr -useb https://openclaw.ai/install.ps1))) -NoOnboard"
		}
		return "curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard"
	case "npm":
		return "npm install -g openclaw@latest"
	case "docker":
		return "docker pull anthropic/openclaw:latest"
	default:
		return "npm install -g openclaw@latest"
	}
}

// generateWarnings 生成警告信息
func generateWarnings(report *EnvironmentReport) []string {
	var warnings []string

	// Node.js 版本检查
	if report.Tools["node"].Installed {
		version := report.Tools["node"].Version
		if version != "" {
			major := extractMajorVersion(version)
			if major > 0 && major < 22 {
				warnings = append(warnings, fmt.Sprintf("Node.js 版本 %s 过低，OpenClaw 需要 Node.js 22+", version))
			}
		}
	}

	// 权限警告
	if report.IsRoot {
		warnings = append(warnings, "不建议以 root 用户运行 OpenClaw")
	}

	// 网络警告
	if !report.InternetAccess {
		warnings = append(warnings, "无法访问互联网，安装可能失败")
	}

	// 磁盘空间警告
	if report.DiskFreeGB > 0 && report.DiskFreeGB < 1 {
		warnings = append(warnings, fmt.Sprintf("磁盘剩余空间不足 (%.1f GB)，建议至少 1 GB", report.DiskFreeGB))
	}

	// WSL 警告
	if report.IsWSL {
		warnings = append(warnings, "检测到 WSL 环境，部分功能可能受限")
	}

	return warnings
}

// extractMajorVersion 提取主版本号
func extractMajorVersion(version string) int {
	version = strings.TrimPrefix(version, "v")
	parts := strings.Split(version, ".")
	if len(parts) > 0 {
		major, _ := strconv.Atoi(parts[0])
		return major
	}
	return 0
}

// fetchLatestVersion fetches the latest version of openclaw from npm.
func fetchLatestVersion() string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Using npm view to get the latest version
	cmd := exec.CommandContext(ctx, "npm", "view", "openclaw", "version")
	out, err := cmd.Output()
	if err == nil {
		return strings.TrimSpace(string(out))
	}
	return ""
}
