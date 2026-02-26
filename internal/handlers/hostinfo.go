package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// HostInfoHandler collects host machine info.
type HostInfoHandler struct {
	startTime time.Time
	cacheMu   sync.RWMutex
	cachedAt  time.Time
	cached    HostInfoResponse
	cacheOK   bool
	staticAt  time.Time
	static    HostInfoResponse
	staticOK  bool
}

func NewHostInfoHandler() *HostInfoHandler {
	return &HostInfoHandler{startTime: time.Now()}
}

const (
	hostInfoCacheTTL       = 2 * time.Second
	hostInfoStaticCacheTTL = 10 * time.Minute
)

// HostInfoResponse is the host hardware info response.
type HostInfoResponse struct {
	Hostname        string     `json:"hostname"`
	OS              string     `json:"os"`
	Arch            string     `json:"arch"`
	Platform        string     `json:"platform"`
	NumCPU          int        `json:"numCpu"`
	GoVersion       string     `json:"goVersion"`
	Uptime          int64      `json:"uptimeMs"`
	ServerUptimeMs  int64      `json:"serverUptimeMs"`
	MemStats        MemInfo    `json:"memStats"`
	SysMem          SysMemInfo `json:"sysMem"`
	CpuUsage        float64    `json:"cpuUsage"`
	DiskUsage       []DiskInfo `json:"diskUsage,omitempty"`
	EnvInfo         EnvInfo    `json:"env"`
	NumGoroutine    int        `json:"numGoroutine"`
	NodeVersion     string     `json:"nodeVersion,omitempty"`
	OpenClawVersion string     `json:"openclawVersion,omitempty"`
	DbPath          string     `json:"dbPath,omitempty"`
	ConfigPath      string     `json:"configPath,omitempty"`
}

// SysMemInfo is system-level memory info.
type SysMemInfo struct {
	Total   uint64  `json:"total"`
	Used    uint64  `json:"used"`
	Free    uint64  `json:"free"`
	UsedPct float64 `json:"usedPct"`
}

// MemInfo is Go runtime memory info.
type MemInfo struct {
	Alloc      uint64 `json:"alloc"`
	TotalAlloc uint64 `json:"totalAlloc"`
	Sys        uint64 `json:"sys"`
	HeapAlloc  uint64 `json:"heapAlloc"`
	HeapSys    uint64 `json:"heapSys"`
	HeapInuse  uint64 `json:"heapInuse"`
	StackInuse uint64 `json:"stackInuse"`
	NumGC      uint32 `json:"numGC"`
}

// DiskInfo is disk usage info (cross-platform).
type DiskInfo struct {
	Path    string  `json:"path"`
	Total   uint64  `json:"total"`
	Free    uint64  `json:"free"`
	Used    uint64  `json:"used"`
	UsedPct float64 `json:"usedPct"`
}

// EnvInfo is environment info.
type EnvInfo struct {
	Home    string `json:"home"`
	Shell   string `json:"shell,omitempty"`
	User    string `json:"user,omitempty"`
	Path    string `json:"path,omitempty"`
	TempDir string `json:"tempDir"`
	WorkDir string `json:"workDir,omitempty"`
}

// CheckUpdate checks if a new OpenClaw version is available.
func (h *HostInfoHandler) CheckUpdate(w http.ResponseWriter, r *http.Request) {
	// get current installed version
	currentVersion := ""
	if _, ver, ok := openclaw.DetectOpenClawBinary(); ok {
		currentVersion = strings.TrimPrefix(ver, "v")
	}

	// query npm registry for latest version
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", "https://registry.npmjs.org/openclaw/latest", nil)
	if err != nil {
		web.OK(w, r, map[string]interface{}{
			"available":      false,
			"currentVersion": currentVersion,
			"error":          err.Error(),
		})
		return
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		web.OK(w, r, map[string]interface{}{
			"available":      false,
			"currentVersion": currentVersion,
			"error":          err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	var npmResp struct {
		Version string `json:"version"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&npmResp); err != nil {
		web.OK(w, r, map[string]interface{}{
			"available":      false,
			"currentVersion": currentVersion,
			"error":          err.Error(),
		})
		return
	}

	latestVersion := strings.TrimPrefix(npmResp.Version, "v")
	available := false
	if currentVersion != "" && latestVersion != "" && currentVersion != latestVersion {
		available = compareSemver(latestVersion, currentVersion) > 0
	}

	web.OK(w, r, map[string]interface{}{
		"available":      available,
		"currentVersion": currentVersion,
		"latestVersion":  latestVersion,
	})
}

// compareSemver compares two semver strings; returns positive if a > b.
func compareSemver(a, b string) int {
	pa := parseSemverParts(a)
	pb := parseSemverParts(b)
	for i := 0; i < 3; i++ {
		if pa[i] != pb[i] {
			return pa[i] - pb[i]
		}
	}
	return 0
}

func parseSemverParts(v string) [3]int {
	v = strings.TrimPrefix(v, "v")
	// strip prerelease tag
	if idx := strings.IndexByte(v, '-'); idx >= 0 {
		v = v[:idx]
	}
	parts := strings.SplitN(v, ".", 3)
	var result [3]int
	for i := 0; i < 3 && i < len(parts); i++ {
		result[i], _ = strconv.Atoi(parts[i])
	}
	return result
}

// Get returns host machine info.
func (h *HostInfoHandler) Get(w http.ResponseWriter, r *http.Request) {
	h.cacheMu.RLock()
	if h.cacheOK && time.Since(h.cachedAt) < hostInfoCacheTTL {
		cached := h.cached
		h.cacheMu.RUnlock()
		web.OK(w, r, cached)
		return
	}
	h.cacheMu.RUnlock()

	staticInfo := h.getStaticInfo()

	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	resp := staticInfo
	resp.Uptime = time.Since(h.startTime).Milliseconds()
	resp.ServerUptimeMs = collectOsUptime()
	resp.NumGoroutine = runtime.NumGoroutine()
	resp.MemStats = MemInfo{
		Alloc:      memStats.Alloc,
		TotalAlloc: memStats.TotalAlloc,
		Sys:        memStats.Sys,
		HeapAlloc:  memStats.HeapAlloc,
		HeapSys:    memStats.HeapSys,
		HeapInuse:  memStats.HeapInuse,
		StackInuse: memStats.StackInuse,
		NumGC:      memStats.NumGC,
	}
	resp.SysMem = collectSysMemory()
	resp.CpuUsage = collectCpuUsage()

	h.cacheMu.Lock()
	h.cached = resp
	h.cachedAt = time.Now()
	h.cacheOK = true
	h.cacheMu.Unlock()

	web.OK(w, r, resp)
}

func (h *HostInfoHandler) getStaticInfo() HostInfoResponse {
	h.cacheMu.RLock()
	if h.staticOK && time.Since(h.staticAt) < hostInfoStaticCacheTTL {
		static := h.static
		h.cacheMu.RUnlock()
		return static
	}
	h.cacheMu.RUnlock()

	hostname, _ := os.Hostname()

	home, _ := os.UserHomeDir()
	wd, _ := os.Getwd()

	envInfo := EnvInfo{
		Home:    home,
		TempDir: os.TempDir(),
		WorkDir: wd,
	}

	// get username
	if u := os.Getenv("USER"); u != "" {
		envInfo.User = u
	} else if u := os.Getenv("USERNAME"); u != "" {
		envInfo.User = u
	}

	// Shell
	if sh := os.Getenv("SHELL"); sh != "" {
		envInfo.Shell = sh
	} else if sh := os.Getenv("COMSPEC"); sh != "" {
		envInfo.Shell = sh
	}

	// PATH (truncate to first few entries)
	if p := os.Getenv("PATH"); p != "" {
		sep := ":"
		if runtime.GOOS == "windows" {
			sep = ";"
		}
		parts := strings.Split(p, sep)
		if len(parts) > 5 {
			envInfo.Path = fmt.Sprintf("%s (+%d more)", strings.Join(parts[:5], sep), len(parts)-5)
		} else {
			envInfo.Path = p
		}
	}

	// platform description
	platform := runtime.GOOS
	switch runtime.GOOS {
	case "darwin":
		platform = "macOS"
	case "linux":
		platform = "Linux"
	case "windows":
		platform = "Windows"
	}

	resp := HostInfoResponse{
		Hostname:     hostname,
		OS:           runtime.GOOS,
		Arch:         runtime.GOARCH,
		Platform:     platform,
		NumCPU:       runtime.NumCPU(),
		GoVersion:    runtime.Version(),
		EnvInfo:      envInfo,
	}

	// Disk usage is relatively expensive and low-frequency; compute in static cache.
	resp.DiskUsage = collectDiskUsage(home)

	// Node version is static and costly to spawn repeatedly.
	if out, err := exec.Command("node", "--version").Output(); err == nil {
		resp.NodeVersion = strings.TrimSpace(string(out))
	}

	// OpenClaw version rarely changes during runtime.
	if _, ver, ok := openclaw.DetectOpenClawBinary(); ok {
		resp.OpenClawVersion = ver
	}

	// Paths are static enough for dashboard display.
	resp.DbPath = filepath.Join(wd, "data", "ClawDeckX.db")
	if home != "" {
		resp.ConfigPath = filepath.Join(home, ".openclaw", "openclaw.json")
	}

	h.cacheMu.Lock()
	h.static = resp
	h.staticAt = time.Now()
	h.staticOK = true
	h.cacheMu.Unlock()

	return resp
}
