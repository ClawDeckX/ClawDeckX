package handlers

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/netutil"
	"ClawDeckX/internal/web"
	"ClawDeckX/internal/webconfig"
)

// MirrorConfig holds the user's preferred mirror settings.
type MirrorConfig struct {
	Preset          string `json:"preset"`          // "cn", "global", "custom"
	NpmRegistry     string `json:"npmRegistry"`     // full URL
	GithubProxy     string `json:"githubProxy"`     // prefix URL, "" = disabled
	DockerMirror    string `json:"dockerMirror"`    // mirror URL, "" = disabled
	PipIndex        string `json:"pipIndex"`        // full URL
	GoProxy         string `json:"goProxy"`         // GOPROXY value
	ClawHubRegistry string `json:"clawHubRegistry"` // ClawHub mirror URL, "" = use default
}

// SystemMirrorStatus holds the detected current system-level config for each tool.
type SystemMirrorStatus struct {
	NpmRegistry  string `json:"npmRegistry"`
	GoProxy      string `json:"goProxy"`
	PipIndex     string `json:"pipIndex"`
	GitHubProxy  string `json:"githubProxy"`
	DockerMirror string `json:"dockerMirror"`
}

const (
	settingKeyMirrorPreset  = "mirror_preset"
	settingKeyMirrorNpm     = "mirror_npm_registry"
	settingKeyMirrorGithub  = "mirror_github_proxy"
	settingKeyMirrorDocker  = "mirror_docker_mirror"
	settingKeyMirrorPip     = "mirror_pip_index"
	settingKeyMirrorGo      = "mirror_go_proxy"
	settingKeyMirrorClawHub = "mirror_clawhub_registry"
)

// MirrorConfigHandler manages mirror/acceleration settings.
type MirrorConfigHandler struct {
	settingRepo *database.SettingRepo
}

func NewMirrorConfigHandler() *MirrorConfigHandler {
	return &MirrorConfigHandler{settingRepo: database.NewSettingRepo()}
}

// Get returns the stored mirror config.
// GET /api/v1/mirror-config
func (h *MirrorConfigHandler) Get(w http.ResponseWriter, r *http.Request) {
	all, _ := h.settingRepo.GetAll()
	cfg := MirrorConfig{
		Preset:          strVal(all, settingKeyMirrorPreset, "custom"),
		NpmRegistry:     strVal(all, settingKeyMirrorNpm, ""),
		GithubProxy:     strVal(all, settingKeyMirrorGithub, ""),
		DockerMirror:    strVal(all, settingKeyMirrorDocker, ""),
		PipIndex:        strVal(all, settingKeyMirrorPip, ""),
		GoProxy:         strVal(all, settingKeyMirrorGo, ""),
		ClawHubRegistry: strVal(all, settingKeyMirrorClawHub, ""),
	}
	web.OK(w, r, cfg)
}

// Set saves the mirror config.
// PUT /api/v1/mirror-config
func (h *MirrorConfigHandler) Set(w http.ResponseWriter, r *http.Request) {
	var cfg MirrorConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	err := h.settingRepo.SetBatch(map[string]string{
		settingKeyMirrorPreset:  cfg.Preset,
		settingKeyMirrorNpm:     cfg.NpmRegistry,
		settingKeyMirrorGithub:  cfg.GithubProxy,
		settingKeyMirrorDocker:  cfg.DockerMirror,
		settingKeyMirrorPip:     cfg.PipIndex,
		settingKeyMirrorGo:      cfg.GoProxy,
		settingKeyMirrorClawHub: cfg.ClawHubRegistry,
	})
	if err != nil {
		web.FailErr(w, r, web.ErrSettingsUpdateFail)
		return
	}
	// Invalidate mirror caches so new settings take effect immediately
	netutil.InvalidateAllCaches()
	web.OK(w, r, map[string]string{"message": "ok"})
}

// DetectSystem reads the current system-level tool config (read-only, no side effects).
// GET /api/v1/mirror-config/detect
func (h *MirrorConfigHandler) DetectSystem(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	status := SystemMirrorStatus{
		NpmRegistry:  detectNpmRegistry(ctx),
		GoProxy:      detectGoProxy(ctx),
		PipIndex:     detectPipIndex(ctx),
		GitHubProxy:  detectGitHubProxy(),
		DockerMirror: detectDockerMirror(),
	}
	web.OK(w, r, status)
}

// ApplyToSystem applies settings to the user's system tools.
// POST /api/v1/mirror-config/apply
func (h *MirrorConfigHandler) ApplyToSystem(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Tools []string     `json:"tools"` // which tools to apply: "npm","go","pip","git","docker","clawhub"
		Cfg   MirrorConfig `json:"config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	type applyResult struct {
		Tool    string `json:"tool"`
		OK      bool   `json:"ok"`
		Message string `json:"message"`
	}
	results := make([]applyResult, 0, len(req.Tools))

	for _, tool := range req.Tools {
		var ok bool
		var msg string
		switch tool {
		case "npm":
			ok, msg = applyNpmRegistry(ctx, req.Cfg.NpmRegistry)
		case "go":
			ok, msg = applyGoProxy(ctx, req.Cfg.GoProxy)
		case "pip":
			ok, msg = applyPipIndex(req.Cfg.PipIndex)
		case "git":
			ok, msg = applyGitHubProxy(req.Cfg.GithubProxy)
		case "docker":
			ok, msg = applyDockerMirror(req.Cfg.DockerMirror)
		case "clawhub":
			ok, msg = applyClawHubRegistry(req.Cfg.ClawHubRegistry)
		default:
			ok, msg = false, "unknown tool: "+tool
		}
		results = append(results, applyResult{Tool: tool, OK: ok, Message: msg})
	}

	web.OK(w, r, map[string]interface{}{"results": results})
}

// ── helpers ───────────────────────────────────────────────────────────────────

func strVal(m map[string]string, key, def string) string {
	if v, ok := m[key]; ok && v != "" {
		return v
	}
	return def
}

func runCmd(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.Output()
	return strings.TrimSpace(string(out)), err
}

// ── detect ───────────────────────────────────────────────────────────────────

func detectNpmRegistry(ctx context.Context) string {
	v, _ := runCmd(ctx, "npm", "config", "get", "registry")
	return v
}

func detectGoProxy(ctx context.Context) string {
	v, _ := runCmd(ctx, "go", "env", "GOPROXY")
	return v
}

func detectPipIndex(ctx context.Context) string {
	// Try pip3 first, then pip
	for _, pip := range []string{"pip3", "pip"} {
		v, err := runCmd(ctx, pip, "config", "get", "global.index-url")
		if err == nil && v != "" && !strings.Contains(v, "No value") {
			return v
		}
	}
	// Fallback: read pip.conf directly
	return readPipConf()
}

func readPipConf() string {
	candidates := pipConfPaths()
	for _, p := range candidates {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(bytes.NewReader(data))
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if strings.HasPrefix(line, "index-url") {
				parts := strings.SplitN(line, "=", 2)
				if len(parts) == 2 {
					return strings.TrimSpace(parts[1])
				}
			}
		}
	}
	return ""
}

func pipConfPaths() []string {
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "windows" {
		appdata := os.Getenv("APPDATA")
		return []string{
			filepath.Join(appdata, "pip", "pip.ini"),
			filepath.Join(home, "pip", "pip.ini"),
		}
	}
	return []string{
		filepath.Join(home, ".config", "pip", "pip.conf"),
		filepath.Join(home, ".pip", "pip.conf"),
		"/etc/pip.conf",
	}
}

func detectGitHubProxy() string {
	// Read ~/.gitconfig for url insteadOf
	home, _ := os.UserHomeDir()
	data, err := os.ReadFile(filepath.Join(home, ".gitconfig"))
	if err != nil {
		return ""
	}
	lines := strings.Split(string(data), "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "[url ") && strings.Contains(trimmed, "insteadOf") {
			// [url "https://ghproxy.com/https://github.com/"]
			urlPart := strings.Trim(strings.TrimPrefix(trimmed, "[url "), `"']`)
			urlPart = strings.TrimSuffix(urlPart, `"]`)
			urlPart = strings.TrimSuffix(urlPart, `"`)
			_ = i
			if strings.Contains(urlPart, "github") || i+1 < len(lines) {
				proxy := strings.TrimSuffix(urlPart, "https://github.com/")
				proxy = strings.TrimSuffix(proxy, "/https://github.com/")
				if proxy != urlPart {
					return strings.TrimRight(proxy, "/")
				}
			}
		}
	}
	return ""
}

func detectDockerMirror() string {
	paths := dockerDaemonPaths()
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var cfg map[string]interface{}
		if err := json.Unmarshal(data, &cfg); err != nil {
			continue
		}
		if mirrors, ok := cfg["registry-mirrors"].([]interface{}); ok && len(mirrors) > 0 {
			if s, ok := mirrors[0].(string); ok {
				return s
			}
		}
	}
	return ""
}

func dockerDaemonPaths() []string {
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "windows" {
		return []string{
			filepath.Join(os.Getenv("USERPROFILE"), ".docker", "daemon.json"),
			`C:\ProgramData\docker\config\daemon.json`,
		}
	}
	return []string{
		filepath.Join(home, ".docker", "daemon.json"),
		"/etc/docker/daemon.json",
	}
}

// ── apply ─────────────────────────────────────────────────────────────────────

func applyNpmRegistry(ctx context.Context, registry string) (bool, string) {
	if registry == "" {
		return false, "registry URL is empty"
	}
	_, err := runCmd(ctx, "npm", "config", "set", "registry", registry)
	if err != nil {
		return false, fmt.Sprintf("npm config set registry failed: %v", err)
	}
	return true, fmt.Sprintf("npm registry set to %s", registry)
}

func applyGoProxy(ctx context.Context, proxy string) (bool, string) {
	if proxy == "" {
		return false, "GOPROXY value is empty"
	}
	_, err := runCmd(ctx, "go", "env", "-w", "GOPROXY="+proxy)
	if err != nil {
		return false, fmt.Sprintf("go env -w GOPROXY failed: %v", err)
	}
	return true, fmt.Sprintf("GOPROXY set to %s", proxy)
}

func applyPipIndex(indexURL string) (bool, string) {
	if indexURL == "" {
		return false, "pip index URL is empty"
	}
	paths := pipConfPaths()
	if len(paths) == 0 {
		return false, "no pip config path found"
	}
	confPath := paths[0]
	if err := os.MkdirAll(filepath.Dir(confPath), 0o755); err != nil {
		return false, fmt.Sprintf("cannot create pip config dir: %v", err)
	}

	// Read existing, update or insert index-url under [global]
	content := updateIniValue(confPath, "global", "index-url", indexURL)
	if err := os.WriteFile(confPath, []byte(content), 0o644); err != nil {
		return false, fmt.Sprintf("write pip config failed: %v", err)
	}
	return true, fmt.Sprintf("pip index-url set to %s in %s", indexURL, confPath)
}

func applyGitHubProxy(proxy string) (bool, string) {
	home, _ := os.UserHomeDir()
	confPath := filepath.Join(home, ".gitconfig")

	// Read existing content
	data, _ := os.ReadFile(confPath)
	existing := string(data)

	// Remove old github insteadOf blocks
	existing = removeGitConfigSection(existing, "https://github.com/")

	if proxy != "" {
		proxyURL := strings.TrimRight(proxy, "/") + "/https://github.com/"
		block := fmt.Sprintf("\n[url \"%s\"]\n\tinsteadOf = https://github.com/\n", proxyURL)
		existing += block
	}

	if err := os.WriteFile(confPath, []byte(existing), 0o644); err != nil {
		return false, fmt.Sprintf("write .gitconfig failed: %v", err)
	}
	if proxy == "" {
		return true, "GitHub proxy removed from .gitconfig"
	}
	return true, fmt.Sprintf("GitHub proxy set to %s in .gitconfig", proxy)
}

func applyDockerMirror(mirror string) (bool, string) {
	paths := dockerDaemonPaths()
	if len(paths) == 0 {
		return false, "no docker daemon.json path found"
	}
	confPath := paths[0]

	var cfg map[string]interface{}
	if data, err := os.ReadFile(confPath); err == nil {
		_ = json.Unmarshal(data, &cfg)
	}
	if cfg == nil {
		cfg = map[string]interface{}{}
	}

	if mirror == "" {
		delete(cfg, "registry-mirrors")
	} else {
		cfg["registry-mirrors"] = []string{mirror}
	}

	if err := os.MkdirAll(filepath.Dir(confPath), 0o755); err != nil {
		return false, fmt.Sprintf("cannot create docker config dir: %v", err)
	}
	out, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return false, fmt.Sprintf("marshal docker config failed: %v", err)
	}
	if err := os.WriteFile(confPath, append(out, '\n'), 0o644); err != nil {
		return false, fmt.Sprintf("write docker daemon.json failed: %v", err)
	}

	msg := fmt.Sprintf("Docker mirror set to %s in %s (restart Docker daemon to take effect)", mirror, confPath)
	if mirror == "" {
		msg = fmt.Sprintf("Docker registry-mirrors removed from %s (restart Docker daemon to take effect)", confPath)
	}
	return true, msg
}

func applyClawHubRegistry(registry string) (bool, string) {
	cfg, err := webconfig.Load()
	if err != nil {
		return false, fmt.Sprintf("load webconfig failed: %v", err)
	}
	url := strings.TrimRight(strings.TrimSpace(registry), "/")
	if url == "" {
		// Reset to default
		url = webconfig.Default().Server.ClawHubQueryURL
	}
	cfg.Server.ClawHubQueryURL = url
	if err := webconfig.Save(cfg); err != nil {
		return false, fmt.Sprintf("save webconfig failed: %v", err)
	}
	return true, fmt.Sprintf("ClawHub registry set to %s", url)
}

// ── ini helpers ───────────────────────────────────────────────────────────────

func updateIniValue(path, section, key, value string) string {
	data, _ := os.ReadFile(path)
	lines := strings.Split(string(data), "\n")

	inSection := false
	keyFound := false
	result := make([]string, 0, len(lines)+3)

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "[") {
			if inSection && !keyFound {
				result = append(result, key+" = "+value)
				keyFound = true
			}
			inSection = strings.EqualFold(trimmed, "["+section+"]")
		}
		if inSection && strings.HasPrefix(trimmed, key) {
			parts := strings.SplitN(trimmed, "=", 2)
			if len(parts) == 2 && strings.TrimSpace(parts[0]) == key {
				result = append(result, key+" = "+value)
				keyFound = true
				continue
			}
		}
		result = append(result, line)
	}

	if !keyFound {
		// Section didn't exist or key not found in it; append
		sectionExists := false
		for _, l := range result {
			if strings.TrimSpace(l) == "["+section+"]" {
				sectionExists = true
				break
			}
		}
		if !sectionExists {
			result = append(result, "", "["+section+"]")
		}
		result = append(result, key+" = "+value)
	}

	return strings.Join(result, "\n")
}

func removeGitConfigSection(content, insteadOf string) string {
	lines := strings.Split(content, "\n")
	result := make([]string, 0, len(lines))
	skip := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "[url ") {
			// Check next few lines for insteadOf with github
			skip = strings.Contains(trimmed, "insteadOf") && strings.Contains(trimmed, insteadOf)
			if !skip {
				// multi-line block; only skip if matches
				skip = strings.Contains(trimmed, insteadOf)
			}
		} else if strings.HasPrefix(trimmed, "[") {
			skip = false
		}
		if !skip {
			result = append(result, line)
		}
	}
	return strings.Join(result, "\n")
}
