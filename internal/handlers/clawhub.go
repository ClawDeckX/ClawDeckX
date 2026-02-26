package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// listCache holds a cached response for a specific list query.
type listCache struct {
	data      json.RawMessage
	fetchedAt time.Time
}

// ClawHubHandler proxies ClawHub skill marketplace + local skill install/uninstall.
type ClawHubHandler struct {
	registryURL string
	httpClient  *http.Client
	gwClient    *openclaw.GWClient
	cacheMu     sync.RWMutex
	cacheMap    map[string]*listCache
	cacheTTL    time.Duration
}

func NewClawHubHandler(gwClient *openclaw.GWClient) *ClawHubHandler {
	return &ClawHubHandler{
		registryURL: "https://clawhub.ai",
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		gwClient: gwClient,
		cacheMap: make(map[string]*listCache),
		cacheTTL: 5 * time.Minute,
	}
}

// isRemoteGateway checks if the connected gateway is remote.
func (h *ClawHubHandler) isRemoteGateway() bool {
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

// remoteSkillsInstall installs a skill on remote gateway via JSON-RPC skills.install.
func (h *ClawHubHandler) remoteSkillsInstall(slug string, timeoutMs int) (map[string]interface{}, error) {
	installID := fmt.Sprintf("clawdeckx-%d", time.Now().UnixNano())
	params := map[string]interface{}{
		"name":      slug,
		"installId": installID,
		"timeoutMs": timeoutMs,
	}
	data, err := h.gwClient.RequestWithTimeout("skills.install", params, 130*time.Second)
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	if json.Unmarshal(data, &result) != nil {
		return nil, fmt.Errorf("failed to parse remote response")
	}
	return result, nil
}

// remoteSkillsStatus fetches remote skills.status for fallback listing.
func (h *ClawHubHandler) remoteSkillsStatus() (map[string]interface{}, error) {
	data, err := h.gwClient.RequestWithTimeout("skills.status", map[string]interface{}{}, 30*time.Second)
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	if json.Unmarshal(data, &result) != nil {
		return nil, fmt.Errorf("failed to parse remote response")
	}
	return result, nil
}

// List lists ClawHub skills (proxied to avoid CORS, supports sort/pagination).
// Results are cached in memory for 5 minutes to reduce upstream load.
func (h *ClawHubHandler) List(w http.ResponseWriter, r *http.Request) {
	limit := r.URL.Query().Get("limit")
	if limit == "" {
		limit = "20"
	}
	sort := r.URL.Query().Get("sort")
	cursor := r.URL.Query().Get("cursor")

	cacheKey := fmt.Sprintf("list:%s:%s:%s", sort, limit, cursor)

	// Check cache first
	h.cacheMu.RLock()
	if entry, ok := h.cacheMap[cacheKey]; ok && time.Since(entry.fetchedAt) < h.cacheTTL {
		h.cacheMu.RUnlock()
		web.OKRaw(w, r, entry.data)
		return
	}
	h.cacheMu.RUnlock()

	apiURL := fmt.Sprintf("%s/api/v1/skills?limit=%s", h.registryURL, url.QueryEscape(limit))
	if sort != "" {
		apiURL += "&sort=" + url.QueryEscape(sort)
	}
	if cursor != "" {
		apiURL += "&cursor=" + url.QueryEscape(cursor)
	}

	resp, err := h.httpClient.Get(apiURL)
	if err != nil {
		logger.Log.Error().Err(err).Str("url", apiURL).Msg("ClawHub list request failed")
		web.Fail(w, r, "CLAWHUB_LIST_FAILED", "ClawHub list failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		web.Fail(w, r, "CLAWHUB_READ_FAILED", "failed to read response", http.StatusBadGateway)
		return
	}

	if resp.StatusCode != http.StatusOK {
		logger.Log.Warn().Int("status", resp.StatusCode).Str("url", apiURL).Msg("ClawHub upstream non-200")
		web.Fail(w, r, "CLAWHUB_UPSTREAM_ERROR", fmt.Sprintf("ClawHub returned %d", resp.StatusCode), http.StatusBadGateway)
		return
	}

	// Validate JSON before caching
	if !json.Valid(body) {
		logger.Log.Warn().Str("url", apiURL).Msg("ClawHub returned invalid JSON")
		web.Fail(w, r, "CLAWHUB_INVALID_RESPONSE", "ClawHub returned invalid response", http.StatusBadGateway)
		return
	}

	// Store in cache
	h.cacheMu.Lock()
	h.cacheMap[cacheKey] = &listCache{data: body, fetchedAt: time.Now()}
	h.cacheMu.Unlock()

	web.OKRaw(w, r, body)
}

// Search searches ClawHub skills (proxied to avoid CORS).
// Results are cached in memory for 5 minutes.
func (h *ClawHubHandler) Search(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		web.Fail(w, r, "INVALID_PARAMS", "q is required", http.StatusBadRequest)
		return
	}

	limit := r.URL.Query().Get("limit")
	if limit == "" {
		limit = "20"
	}

	cacheKey := fmt.Sprintf("search:%s:%s", query, limit)

	// Check cache first
	h.cacheMu.RLock()
	if entry, ok := h.cacheMap[cacheKey]; ok && time.Since(entry.fetchedAt) < h.cacheTTL {
		h.cacheMu.RUnlock()
		web.OKRaw(w, r, entry.data)
		return
	}
	h.cacheMu.RUnlock()

	apiURL := fmt.Sprintf("%s/api/v1/search?q=%s&limit=%s", h.registryURL, url.QueryEscape(query), limit)
	resp, err := h.httpClient.Get(apiURL)
	if err != nil {
		logger.Log.Error().Err(err).Str("url", apiURL).Msg("ClawHub search request failed")
		web.Fail(w, r, "CLAWHUB_SEARCH_FAILED", "ClawHub search failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		web.Fail(w, r, "CLAWHUB_READ_FAILED", "failed to read response", http.StatusBadGateway)
		return
	}

	if resp.StatusCode != http.StatusOK {
		logger.Log.Warn().Int("status", resp.StatusCode).Str("url", apiURL).Msg("ClawHub search upstream non-200")
		web.Fail(w, r, "CLAWHUB_UPSTREAM_ERROR", fmt.Sprintf("ClawHub returned %d", resp.StatusCode), http.StatusBadGateway)
		return
	}

	if json.Valid(body) {
		h.cacheMu.Lock()
		h.cacheMap[cacheKey] = &listCache{data: body, fetchedAt: time.Now()}
		h.cacheMu.Unlock()
	}

	web.OKRaw(w, r, body)
}

// SkillDetail returns skill details.
func (h *ClawHubHandler) SkillDetail(w http.ResponseWriter, r *http.Request) {
	slug := r.URL.Query().Get("slug")
	if slug == "" {
		web.Fail(w, r, "INVALID_PARAMS", "slug is required", http.StatusBadRequest)
		return
	}

	apiURL := fmt.Sprintf("%s/api/v1/skills/%s", h.registryURL, url.PathEscape(slug))
	resp, err := h.httpClient.Get(apiURL)
	if err != nil {
		web.Fail(w, r, "CLAWHUB_DETAIL_FAILED", "skill detail failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		web.Fail(w, r, "CLAWHUB_READ_FAILED", "failed to read response", http.StatusBadGateway)
		return
	}

	web.OKRaw(w, r, body)
}

// Install installs a ClawHub skill via clawhub CLI.
func (h *ClawHubHandler) Install(w http.ResponseWriter, r *http.Request) {
	var params struct {
		Slug    string `json:"slug"`
		Version string `json:"version,omitempty"`
		Force   bool   `json:"force,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&params); err != nil || params.Slug == "" {
		web.Fail(w, r, "INVALID_PARAMS", "slug is required", http.StatusBadRequest)
		return
	}

	// remote gateway: use skills.install (clawhub.exec removed upstream)
	if h.isRemoteGateway() {
		result, err := h.remoteSkillsInstall(params.Slug, 120000)
		if err != nil {
			logger.Log.Error().Err(err).Str("slug", params.Slug).Msg("remote skill install failed")
			web.Fail(w, r, "SKILL_INSTALL_FAILED", "remote install failed: "+err.Error(), http.StatusBadGateway)
			return
		}
		logger.Log.Info().Str("slug", params.Slug).Msg("remote skill installed")
		web.OK(w, r, map[string]interface{}{
			"slug":    params.Slug,
			"output":  result,
			"success": true,
			"remote":  true,
			"note":    "remote install uses skills.install; version/force are ignored by upstream API",
		})
		return
	}

	// local gateway: run clawhub CLI directly
	args := []string{"install", params.Slug}
	if params.Version != "" {
		args = append(args, "--version", params.Version)
	}
	if params.Force {
		args = append(args, "--force")
	}
	args = append(args, "--no-input")

	output, err := h.runClawHub(args)
	if err != nil {
		logger.Log.Error().Err(err).Str("slug", params.Slug).Str("output", output).Msg("skill install failed")
		web.Fail(w, r, "SKILL_INSTALL_FAILED", fmt.Sprintf("install failed: %s\n%s", err.Error(), output), http.StatusInternalServerError)
		return
	}

	logger.Log.Info().Str("slug", params.Slug).Msg("skill installed")
	web.OK(w, r, map[string]interface{}{
		"slug":    params.Slug,
		"output":  output,
		"success": true,
	})
}

// Uninstall removes a skill (deletes skill directory).
func (h *ClawHubHandler) Uninstall(w http.ResponseWriter, r *http.Request) {
	var params struct {
		Slug string `json:"slug"`
	}
	if err := json.NewDecoder(r.Body).Decode(&params); err != nil || params.Slug == "" {
		web.Fail(w, r, "INVALID_PARAMS", "slug is required", http.StatusBadRequest)
		return
	}

	// safety check: slug must not contain path separators
	if strings.ContainsAny(params.Slug, "/\\..") {
		web.Fail(w, r, "INVALID_PARAMS", "invalid skill name", http.StatusBadRequest)
		return
	}

	// remote gateway: clawhub.exec removed upstream; no RPC uninstall available.
	if h.isRemoteGateway() {
		web.Fail(w, r, "SKILL_UNINSTALL_FAILED", "remote gateway does not expose skill uninstall RPC; please run uninstall on remote host", http.StatusNotImplemented)
		return
	}

	// local gateway: delete skill directory
	home, err := os.UserHomeDir()
	if err != nil {
		web.FailErr(w, r, web.ErrPathError)
		return
	}

	skillPath := filepath.Join(home, ".openclaw", "skills", params.Slug)
	if _, err := os.Stat(skillPath); os.IsNotExist(err) {
		web.FailErr(w, r, web.ErrSkillNotFound)
		return
	}

	if err := os.RemoveAll(skillPath); err != nil {
		logger.Log.Error().Err(err).Str("slug", params.Slug).Msg("skill uninstall failed")
		web.FailErr(w, r, web.ErrSkillUninstallFail, err.Error())
		return
	}

	h.removeLockEntry(home, params.Slug)

	logger.Log.Info().Str("slug", params.Slug).Msg("skill uninstalled")
	web.OK(w, r, map[string]interface{}{
		"slug":    params.Slug,
		"success": true,
	})
}

// Update updates a skill.
func (h *ClawHubHandler) Update(w http.ResponseWriter, r *http.Request) {
	var params struct {
		Slug  string `json:"slug,omitempty"`
		All   bool   `json:"all,omitempty"`
		Force bool   `json:"force,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&params); err != nil {
		web.Fail(w, r, "INVALID_PARAMS", "invalid request body", http.StatusBadRequest)
		return
	}

	if !params.All && params.Slug == "" {
		web.Fail(w, r, "INVALID_PARAMS", "slug or all is required", http.StatusBadRequest)
		return
	}

	// remote gateway: clawhub.exec removed upstream; no equivalent update RPC.
	if h.isRemoteGateway() {
		web.Fail(w, r, "SKILL_UPDATE_FAILED", "remote gateway does not expose skill update RPC; please run update on remote host", http.StatusNotImplemented)
		return
	}

	// local gateway: run clawhub CLI directly
	args := []string{"update"}
	if params.All {
		args = append(args, "--all")
	} else {
		args = append(args, params.Slug)
	}
	if params.Force {
		args = append(args, "--force")
	}
	args = append(args, "--no-input")

	output, err := h.runClawHub(args)
	if err != nil {
		web.Fail(w, r, "SKILL_UPDATE_FAILED", fmt.Sprintf("update failed: %s\n%s", err.Error(), output), http.StatusInternalServerError)
		return
	}

	web.OK(w, r, map[string]interface{}{
		"output":  output,
		"success": true,
	})
}

// InstalledList lists installed ClawHub skills (from lockfile).
func (h *ClawHubHandler) InstalledList(w http.ResponseWriter, r *http.Request) {
	// remote gateway: clawhub.exec removed upstream; fallback to skills.status snapshot.
	if h.isRemoteGateway() {
		result, err := h.remoteSkillsStatus()
		if err != nil {
			web.Fail(w, r, "CLAWHUB_LIST_FAILED", "failed to list remote installed skills: "+err.Error(), http.StatusBadGateway)
			return
		}
		list := []map[string]interface{}{}
		if rawSkills, ok := result["skills"].([]interface{}); ok {
			for _, raw := range rawSkills {
				s, ok := raw.(map[string]interface{})
				if !ok {
					continue
				}
				item := map[string]interface{}{
					"slug": s["skillKey"],
				}
				if v, ok := s["name"]; ok {
					item["name"] = v
				}
				if v, ok := s["source"]; ok {
					item["source"] = v
				}
				if v, ok := s["filePath"]; ok {
					item["path"] = v
				}
				list = append(list, item)
			}
		}
		web.OK(w, r, map[string]interface{}{
			"skills":    list,
			"remote":    true,
			"skillsDir": "(remote)",
			"note":      "remote list uses skills.status fallback",
		})
		return
	}

	// local gateway: scan local filesystem
	home, err := os.UserHomeDir()
	if err != nil {
		web.FailErr(w, r, web.ErrPathError)
		return
	}

	skillsDir := filepath.Join(home, ".openclaw", "skills")

	// read lockfile
	lockPath := filepath.Join(skillsDir, ".clawhub", "lock.json")
	var lockData struct {
		Version string `json:"version"`
		Skills  map[string]struct {
			Version     interface{} `json:"version"`
			InstalledAt int64       `json:"installedAt"`
		} `json:"skills"`
	}

	if data, err := os.ReadFile(lockPath); err == nil {
		json.Unmarshal(data, &lockData)
	}

	// scan skill directories
	type installedSkill struct {
		Slug        string      `json:"slug"`
		Path        string      `json:"path"`
		Version     interface{} `json:"version"`
		InstalledAt int64       `json:"installedAt,omitempty"`
		HasSkillMD  bool        `json:"hasSkillMd"`
		Description string      `json:"description,omitempty"`
	}

	var skills []installedSkill
	// only list skills recorded in lockfile (installed via ClawHub)
	for slug, lockInfo := range lockData.Skills {
		skillPath := filepath.Join(skillsDir, slug)
		// confirm directory exists
		if info, err := os.Stat(skillPath); err != nil || !info.IsDir() {
			continue
		}
		s := installedSkill{
			Slug:        slug,
			Path:        skillPath,
			Version:     lockInfo.Version,
			InstalledAt: lockInfo.InstalledAt,
		}

		// check SKILL.md
		skillMDPath := filepath.Join(skillPath, "SKILL.md")
		if _, err := os.Stat(skillMDPath); err == nil {
			s.HasSkillMD = true
			// read first lines as description
			if data, err := os.ReadFile(skillMDPath); err == nil {
				content := string(data)
				// skip frontmatter
				if strings.HasPrefix(content, "---") {
					if idx := strings.Index(content[3:], "---"); idx >= 0 {
						content = strings.TrimSpace(content[idx+6:])
					}
				}
				// take first 200 chars
				content = strings.TrimSpace(content)
				if len(content) > 200 {
					content = content[:200] + "..."
				}
				s.Description = content
			}
		}

		skills = append(skills, s)
	}

	if skills == nil {
		skills = []installedSkill{}
	}

	web.OK(w, r, map[string]interface{}{
		"skills":    skills,
		"skillsDir": skillsDir,
	})
}

// runClawHub executes a clawhub CLI command.
func (h *ClawHubHandler) runClawHub(args []string) (string, error) {
	cmdName := "clawhub"
	if runtime.GOOS == "windows" {
		cmdName = "clawhub.cmd"
	}

	// try running directly
	cmd := exec.Command(cmdName, args...)
	cmd.Env = append(os.Environ(), "CLAWHUB_DISABLE_TELEMETRY=1")

	// set working directory to ~/.openclaw/skills
	home, _ := os.UserHomeDir()
	skillsDir := filepath.Join(home, ".openclaw", "skills")
	os.MkdirAll(skillsDir, 0755)
	cmd.Dir = skillsDir

	output, err := cmd.CombinedOutput()
	if err != nil {
		// if clawhub not in PATH, try npx
		if strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "not recognized") ||
			strings.Contains(err.Error(), "executable file not found") {
			npxArgs := append([]string{"clawhub"}, args...)
			cmd2 := exec.Command("npx", npxArgs...)
			cmd2.Env = append(os.Environ(), "CLAWHUB_DISABLE_TELEMETRY=1")
			cmd2.Dir = skillsDir
			output2, err2 := cmd2.CombinedOutput()
			if err2 != nil {
				return string(output2), err2
			}
			return string(output2), nil
		}
		return string(output), err
	}
	return string(output), nil
}

// removeLockEntry removes a skill entry from the lockfile.
func (h *ClawHubHandler) removeLockEntry(home, slug string) {
	lockPath := filepath.Join(home, ".openclaw", "skills", ".clawhub", "lock.json")
	data, err := os.ReadFile(lockPath)
	if err != nil {
		return
	}

	var lock map[string]interface{}
	if json.Unmarshal(data, &lock) != nil {
		return
	}

	if skills, ok := lock["skills"].(map[string]interface{}); ok {
		delete(skills, slug)
		if updated, err := json.MarshalIndent(lock, "", "  "); err == nil {
			os.WriteFile(lockPath, updated, 0644)
		}
	}
}
