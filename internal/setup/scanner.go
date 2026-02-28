package setup

import (
	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/openclaw"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type ToolInfo struct {
	Installed bool   `json:"installed"`
	Version   string `json:"version,omitempty"`
	Path      string `json:"path,omitempty"`
}

type Step struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Command     string `json:"command,omitempty"`
	Required    bool   `json:"required"`
}

type EnvironmentReport struct {
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

	PackageManager string `json:"packageManager"` // "brew" | "apt" | "dnf" | "yum" | "apk" | "winget" | "choco"
	HasSudo        bool   `json:"hasSudo"`

	Tools map[string]ToolInfo `json:"tools"`

	InternetAccess  bool   `json:"internetAccess"`
	NpmRegistry     string `json:"npmRegistry,omitempty"`
	RegistryLatency int    `json:"registryLatency,omitempty"` // ms

	HomeDirWritable bool    `json:"homeDirWritable"`
	DiskFreeGB      float64 `json:"diskFreeGb,omitempty"`

	OpenClawInstalled   bool   `json:"openClawInstalled"`
	OpenClawConfigured  bool   `json:"openClawConfigured"`
	OpenClawVersion     string `json:"openClawVersion,omitempty"`
	OpenClawCnInstalled bool   `json:"openClawCnInstalled"`
	OpenClawCnVersion   string `json:"openClawCnVersion,omitempty"`
	OpenClawConfigPath  string `json:"openClawConfigPath,omitempty"`
	GatewayRunning      bool   `json:"gatewayRunning"`
	GatewayPort         int    `json:"gatewayPort,omitempty"`

	RecommendedMethod string   `json:"recommendedMethod"` // "installer-script" | "npm" | "docker"
	RecommendedSteps  []Step   `json:"recommendedSteps"`
	Warnings          []string `json:"warnings,omitempty"`

	LatestOpenClawVersion string `json:"latestOpenClawVersion,omitempty"`
	UpdateAvailable       bool   `json:"updateAvailable"`

	ScanTime string `json:"scanTime"`
}

func Scan() (*EnvironmentReport, error) {
	report := &EnvironmentReport{
		OS:       runtime.GOOS,
		Arch:     runtime.GOARCH,
		Tools:    make(map[string]ToolInfo),
		ScanTime: time.Now().Format(time.RFC3339),
	}

	report.Hostname, _ = os.Hostname()
	report.CurrentUser = getCurrentUser()
	report.IsRoot = isRoot()
	report.IsWSL = detectWSL()
	report.IsDocker = detectDocker()
	report.IsSSH = detectSSH()

	if runtime.GOOS == "linux" {
		report.Distro, report.DistroVersion = detectDistro()
	}

	report.Kernel = detectKernel()

	report.PackageManager = detectPackageManager()
	report.HasSudo = detectSudo()

	report.Tools = detectTools()

	report.InternetAccess = checkInternetAccess()
	if report.Tools["npm"].Installed {
		report.NpmRegistry, report.RegistryLatency = detectNpmRegistry()
	}

	report.HomeDirWritable = checkHomeDirWritable()
	report.DiskFreeGB = getDiskFreeGB()

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

	if report.OpenClawInstalled {
		latest := fetchLatestVersion()
		if latest != "" {
			report.LatestOpenClawVersion = latest
			if report.OpenClawVersion != "" && report.OpenClawVersion != latest {
				report.UpdateAvailable = true
			}
		}
	}

	report.RecommendedMethod = recommendInstallMethod(report)
	report.RecommendedSteps = generateRecommendedSteps(report)
	report.Warnings = generateWarnings(report)

	return report, nil
}

func getCurrentUser() string {
	if u, err := user.Current(); err == nil {
		return u.Username
	}
	return os.Getenv("USER")
}

func isRoot() bool {
	if runtime.GOOS == "windows" {
		return false // Windows 不使用 root 概念
	}
	return os.Getuid() == 0
}

func detectWSL() bool {
	if runtime.GOOS != "linux" {
		return false
	}
	data, err := os.ReadFile("/proc/version")
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToLower(string(data)), "microsoft")
}

func detectDocker() bool {
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}
	data, err := os.ReadFile("/proc/1/cgroup")
	if err == nil && strings.Contains(string(data), "docker") {
		return true
	}
	return false
}

func detectSSH() bool {
	return os.Getenv("SSH_CONNECTION") != "" || os.Getenv("SSH_CLIENT") != ""
}

func detectDistro() (name, version string) {
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

func detectPackageManager() string {
	switch runtime.GOOS {
	case "darwin":
		if commandExists("brew") {
			return "brew"
		}
		return ""
	case "linux":
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

func detectSudo() bool {
	if runtime.GOOS == "windows" {
		return false
	}
	if isRoot() {
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sudo", "-n", "true")
	return cmd.Run() == nil
}

func detectTools() map[string]ToolInfo {
	tools := make(map[string]ToolInfo)

	tools["node"] = detectNodeWithFallback()

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

func detectTool(name string, versionArg string) ToolInfo {
	path, err := exec.LookPath(name)
	if err != nil {
		return ToolInfo{Installed: false}
	}

	info := ToolInfo{
		Installed: true,
		Path:      path,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, versionArg)
	out, err := cmd.Output()
	if err == nil {
		version := strings.TrimSpace(string(out))
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

func detectPython() ToolInfo {
	if info := detectTool("python3", "--version"); info.Installed {
		return info
	}
	return detectTool("python", "--version")
}

func detectNodeWithFallback() ToolInfo {
	if info := detectTool("node", "--version"); info.Installed {
		return info
	}

	paths := getNodePaths()
	for _, path := range paths {
		if fileExists(path) {
			if info := detectToolByPath(path, "--version"); info.Installed {
				return info
			}
		}
	}

	if runtime.GOOS != "windows" {
		if info := detectNodeViaShell(); info.Installed {
			return info
		}
	}

	return ToolInfo{Installed: false}
}

func detectNpmWithFallback() ToolInfo {
	if info := detectTool("npm", "--version"); info.Installed {
		return info
	}

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

func getNodePaths() []string {
	var paths []string
	home, _ := os.UserHomeDir()

	switch runtime.GOOS {
	case "darwin":
		// Homebrew
		paths = append(paths, "/opt/homebrew/bin/node") // Apple Silicon
		paths = append(paths, "/usr/local/bin/node")    // Intel Mac
		paths = append(paths, "/usr/bin/node")
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
			// mise
			paths = append(paths, filepath.Join(home, ".local", "share", "mise", "shims", "node"))
		}

	case "linux":
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
		paths = append(paths, "C:\\Program Files\\nodejs\\node.exe")
		paths = append(paths, "C:\\Program Files (x86)\\nodejs\\node.exe")

		if home != "" {
			// nvm-windows
			if nvmSymlink := os.Getenv("NVM_SYMLINK"); nvmSymlink != "" {
				paths = append(paths, filepath.Join(nvmSymlink, "node.exe"))
			}
			if nvmHome := os.Getenv("NVM_HOME"); nvmHome != "" {
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

func detectToolByPath(path string, versionArg string) ToolInfo {
	info := ToolInfo{
		Installed: true,
		Path:      path,
	}

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

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func extractVersion(output string) string {
	output = strings.TrimPrefix(output, "v")
	parts := strings.Fields(output)
	for _, part := range parts {
		part = strings.TrimPrefix(part, "v")
		if len(part) > 0 && (part[0] >= '0' && part[0] <= '9') {
			lines := strings.Split(part, "\n")
			return lines[0]
		}
	}
	lines := strings.Split(output, "\n")
	if len(lines) > 0 {
		return lines[0]
	}
	return output
}

func commandExists(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func checkInternetAccess() bool {
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

	start := time.Now()
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(registry)
	if err == nil {
		resp.Body.Close()
		latency = int(time.Since(start).Milliseconds())
	}

	return registry, latency
}

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

func getDiskFreeGB() float64 {
	home, err := os.UserHomeDir()
	if err != nil {
		return 0
	}

	switch runtime.GOOS {
	case "windows":
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

func ResolveStateDir() string {
	return openclaw.ResolveStateDir()
}

func GetOpenClawConfigPath() string {
	return openclaw.ResolveConfigPath()
}

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
	if models, ok := config["models"].(map[string]interface{}); ok {
		if providers, ok := models["providers"].(map[string]interface{}); ok && len(providers) > 0 {
			return true
		}
	}
	if model, ok := config["model"].(map[string]interface{}); ok {
		if _, hasProvider := model["provider"]; hasProvider {
			return true
		}
	}
	return false
}

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
	if _, ok := raw["gateway"]; !ok {
		return true, false, "missing gateway section"
	}
	return true, true, ""
}

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

func checkGatewayRunning() (running bool, port int) {
	ports := []int{}
	if cfgPath := GetOpenClawConfigPath(); cfgPath != "" {
		if p := strings.TrimSpace(configGatewayPortFromFile(cfgPath)); p != "" {
			if n, err := strconv.Atoi(p); err == nil && n > 0 && n <= 65535 {
				ports = append(ports, n)
			}
		}
	}
	ports = append(ports, 18789, 18790, 19001)
	seen := map[int]struct{}{}

	client := &http.Client{Timeout: 2 * time.Second}
	for _, p := range ports {
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}

		url := fmt.Sprintf("http://127.0.0.1:%d/health", p)
		resp, err := client.Get(url)
		if err != nil {
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			continue
		}
		lower := strings.ToLower(string(body))
		if strings.Contains(lower, "openclaw") || strings.Contains(lower, "gateway") || strings.Contains(lower, "\"ok\":true") || strings.Contains(lower, "\"status\":\"ok\"") {
			return true, p
		}
	}
	return false, 0
}

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

func recommendInstallMethod(report *EnvironmentReport) string {
	if report.OpenClawInstalled {
		return ""
	}

	if report.Tools["node"].Installed && report.Tools["npm"].Installed {
		return "npm"
	}

	return "install-deps-first"
}

func generateRecommendedSteps(report *EnvironmentReport) []Step {
	var steps []Step

	if report.OpenClawInstalled {
		if !report.OpenClawConfigured {
			steps = append(steps, Step{
				Name:        "configure",
				Description: i18n.T(i18n.MsgScannerStepConfigure),
				Required:    true,
			})
		}
		if !report.GatewayRunning {
			steps = append(steps, Step{
				Name:        "start-gateway",
				Description: i18n.T(i18n.MsgScannerStepStartGateway),
				Required:    true,
			})
		}
		return steps
	}

	if !report.Tools["node"].Installed {
		steps = append(steps, Step{
			Name:        "install-node",
			Description: i18n.T(i18n.MsgScannerStepInstallNode),
			Command:     getNodeInstallCommand(report),
			Required:    true,
		})
	}

	if !report.Tools["git"].Installed {
		steps = append(steps, Step{
			Name:        "install-git",
			Description: i18n.T(i18n.MsgScannerStepInstallGit),
			Command:     getGitInstallCommand(report),
			Required:    false,
		})
	}

	steps = append(steps, Step{
		Name:        "install-openclaw",
		Description: i18n.T(i18n.MsgScannerStepInstallOpenclaw),
		Command:     getOpenClawInstallCommand(report),
		Required:    true,
	})

	steps = append(steps, Step{
		Name:        "configure",
		Description: i18n.T(i18n.MsgScannerStepConfigureProvider),
		Required:    true,
	})

	steps = append(steps, Step{
		Name:        "start-gateway",
		Description: i18n.T(i18n.MsgScannerStepStartGateway),
		Required:    true,
	})

	steps = append(steps, Step{
		Name:        "verify",
		Description: i18n.T(i18n.MsgScannerStepVerify),
		Command:     "openclaw doctor",
		Required:    true,
	})

	return steps
}

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
		return i18n.T(i18n.MsgScannerNodeManualInstall)
	}
}

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
		return i18n.T(i18n.MsgScannerGitManualInstall)
	}
}

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

func generateWarnings(report *EnvironmentReport) []string {
	var warnings []string

	if report.Tools["node"].Installed {
		version := report.Tools["node"].Version
		if version != "" {
			major := extractMajorVersion(version)
			if major > 0 && major < 22 {
				warnings = append(warnings, i18n.T(i18n.MsgScannerWarnNodeVersionLow, map[string]interface{}{"Version": version}))
			}
		}
	}

	if report.IsRoot {
		warnings = append(warnings, i18n.T(i18n.MsgScannerWarnRootUser))
	}

	if !report.InternetAccess {
		warnings = append(warnings, i18n.T(i18n.MsgScannerWarnNoInternet))
	}

	if report.DiskFreeGB > 0 && report.DiskFreeGB < 1 {
		warnings = append(warnings, i18n.T(i18n.MsgScannerWarnDiskSpaceLow, map[string]interface{}{"FreeGB": fmt.Sprintf("%.1f", report.DiskFreeGB)}))
	}

	if report.IsWSL {
		warnings = append(warnings, i18n.T(i18n.MsgScannerWarnWslEnvironment))
	}

	return warnings
}

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
