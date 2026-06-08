package netutil

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"
)

// GitHub API mirrors for China users
var GitHubAPIMirrors = []MirrorSource{
	{Name: "GitHub Official", URL: "https://api.github.com", Priority: 1},
}

// GitHub Release download mirrors
var GitHubReleaseMirrors = []MirrorSource{
	{Name: "GitHub Official", URL: "https://github.com", Priority: 1},
}

// npm Registry mirrors
var NPMRegistryMirrors = []MirrorSource{
	{Name: "npm Official", URL: "https://registry.npmjs.org", Priority: 1},
	{Name: "npmmirror (China)", URL: "https://registry.npmmirror.com", Priority: 2},
	{Name: "Tencent (China)", URL: "https://mirrors.cloud.tencent.com/npm", Priority: 3},
	{Name: "Huawei (China)", URL: "https://repo.huaweicloud.com/repository/npm", Priority: 4},
}

var (
	githubAPISelector     *MirrorSelector
	githubReleaseSelector *MirrorSelector
	npmRegistrySelector   *MirrorSelector

	// User-configured GitHub proxy provider (injected at startup from DB settings).
	ghProxyMu       sync.RWMutex
	ghProxyProvider func() string // returns mirror_github_proxy value, e.g. "https://ghproxy.clawdeckx.com"
	npmRegProvider  func() string // returns mirror_npm_registry value
)

func init() {
	// Initialize selectors with appropriate test paths and timeouts
	// Cache duration is 24 hours since host network environment rarely changes
	githubAPISelector = NewMirrorSelector(
		GitHubAPIMirrors,
		"/repos/ClawDeckX/ClawDeckX",
		3*time.Second,
		24*time.Hour,
	)

	githubReleaseSelector = NewMirrorSelector(
		GitHubReleaseMirrors,
		"/ClawDeckX/ClawDeckX/releases",
		3*time.Second,
		24*time.Hour,
	)

	npmRegistrySelector = NewMirrorSelector(
		NPMRegistryMirrors,
		"/-/ping",
		3*time.Second,
		24*time.Hour,
	)
}

// SetGitHubProxyProvider injects a function that returns the user-configured
// GitHub proxy URL from the acceleration settings (mirror_github_proxy).
// Called once at startup from serve.go after DB is ready.
func SetGitHubProxyProvider(fn func() string) {
	ghProxyMu.Lock()
	ghProxyProvider = fn
	ghProxyMu.Unlock()
}

// SetNPMRegistryProvider injects a function that returns the user-configured
// npm registry URL from the acceleration settings (mirror_npm_registry).
func SetNPMRegistryProvider(fn func() string) {
	ghProxyMu.Lock()
	npmRegProvider = fn
	ghProxyMu.Unlock()
}

// getUserGitHubProxy returns the user-configured GitHub proxy or "".
func getUserGitHubProxy() string {
	ghProxyMu.RLock()
	fn := ghProxyProvider
	ghProxyMu.RUnlock()
	if fn == nil {
		return ""
	}
	return strings.TrimRight(fn(), "/")
}

// getUserNPMRegistry returns the user-configured npm registry or "".
func getUserNPMRegistry() string {
	ghProxyMu.RLock()
	fn := npmRegProvider
	ghProxyMu.RUnlock()
	if fn == nil {
		return ""
	}
	return strings.TrimRight(fn(), "/")
}

// GetGitHubAPIURL returns the best GitHub API base URL.
// If the user configured a GitHub proxy (ghproxy-style), it proxies the API
// request through that proxy. Otherwise falls back to the mirror selector.
func GetGitHubAPIURL(ctx context.Context) string {
	if proxy := getUserGitHubProxy(); proxy != "" {
		// ghproxy-style proxies forward the full URL, so the "API base" becomes
		// proxy + "/https://api.github.com" — the caller appends /repos/... after.
		// However many ghproxy services only proxy github.com (web), not api.github.com.
		// Use the proxy for release URLs; for API, still try official first.
		// Some proxies (e.g. ghproxy.clawdeckx.com) support API proxying via:
		//   https://proxy/https://api.github.com/repos/...
		// We return the proxy-prefixed form so the constructed URL becomes valid.
		return proxy + "/https://api.github.com"
	}
	best := githubAPISelector.GetBest(ctx)
	return best.URL
}

// GetGitHubReleaseURL transforms a GitHub release URL to use the best mirror.
// Prefers user-configured proxy; falls back to mirror selector.
func GetGitHubReleaseURL(ctx context.Context, originalURL string) string {
	// User-configured proxy takes priority
	if proxy := getUserGitHubProxy(); proxy != "" && strings.HasPrefix(originalURL, "https://github.com") {
		return proxy + "/" + originalURL
	}

	best := githubReleaseSelector.GetBest(ctx)

	// If using official, return as-is
	if best.Priority == 1 {
		return originalURL
	}

	// Transform URL to use mirror
	// Original: https://github.com/owner/repo/releases/download/v1.0.0/file.zip
	// Mirror:   https://ghproxy.com/https://github.com/owner/repo/releases/download/v1.0.0/file.zip
	if strings.HasPrefix(originalURL, "https://github.com") {
		return strings.Replace(best.URL, "https://github.com", "", 1) + originalURL
	}

	return originalURL
}

// GetNPMRegistryURL returns the best npm registry URL.
// Prefers user-configured registry; falls back to mirror selector.
func GetNPMRegistryURL(ctx context.Context) string {
	if reg := getUserNPMRegistry(); reg != "" {
		return reg
	}
	best := npmRegistrySelector.GetBest(ctx)
	return best.URL
}

// GetBestMirrorInfo returns information about the best mirrors for all services
func GetBestMirrorInfo(ctx context.Context) map[string]MirrorInfo {
	return map[string]MirrorInfo{
		"github_api":     getMirrorInfo(ctx, githubAPISelector),
		"github_release": getMirrorInfo(ctx, githubReleaseSelector),
		"npm_registry":   getMirrorInfo(ctx, npmRegistrySelector),
	}
}

// MirrorInfo contains information about a selected mirror
type MirrorInfo struct {
	Name    string `json:"name"`
	URL     string `json:"url"`
	Latency int64  `json:"latency_ms"`
}

func getMirrorInfo(ctx context.Context, selector *MirrorSelector) MirrorInfo {
	best := selector.GetBest(ctx)
	return MirrorInfo{
		Name: best.Name,
		URL:  best.URL,
	}
}

// TestAllMirrors tests all mirrors and returns detailed results
func TestAllMirrors(ctx context.Context) map[string][]MirrorTestResult {
	return map[string][]MirrorTestResult{
		"github_api":     testMirrors(ctx, githubAPISelector),
		"github_release": testMirrors(ctx, githubReleaseSelector),
		"npm_registry":   testMirrors(ctx, npmRegistrySelector),
	}
}

// MirrorTestResult contains test results for a mirror
type MirrorTestResult struct {
	Name      string `json:"name"`
	URL       string `json:"url"`
	Success   bool   `json:"success"`
	LatencyMs int64  `json:"latency_ms"`
	Error     string `json:"error,omitempty"`
}

func testMirrors(ctx context.Context, selector *MirrorSelector) []MirrorTestResult {
	results := selector.testAll(ctx)
	var out []MirrorTestResult
	for _, r := range results {
		tr := MirrorTestResult{
			Name:      r.Source.Name,
			URL:       r.Source.URL,
			Success:   r.Success,
			LatencyMs: r.Latency.Milliseconds(),
		}
		if r.Error != nil {
			tr.Error = r.Error.Error()
		}
		out = append(out, tr)
	}
	return out
}

// InvalidateAllCaches clears all mirror caches
func InvalidateAllCaches() {
	githubAPISelector.InvalidateCache()
	githubReleaseSelector.InvalidateCache()
	npmRegistrySelector.InvalidateCache()
}

// BuildGitHubAPIURL builds a full GitHub API URL using the best mirror
func BuildGitHubAPIURL(ctx context.Context, path string) string {
	base := GetGitHubAPIURL(ctx)
	if strings.HasPrefix(path, "/") {
		return base + path
	}
	return fmt.Sprintf("%s/%s", base, path)
}
