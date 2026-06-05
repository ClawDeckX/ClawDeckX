package handlers

import (
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/translate"
	"ClawDeckX/internal/updatecheck"
	"ClawDeckX/internal/updater"
	"ClawDeckX/internal/version"
	"ClawDeckX/internal/web"
)

// SelfUpdateHandler handles self-update API endpoints.
type SelfUpdateHandler struct {
	auditRepo      *database.AuditLogRepo
	translator     *translate.Translator
	notesTransRepo *database.ReleaseNotesTranslationRepo
}

func NewSelfUpdateHandler() *SelfUpdateHandler {
	settingRepo := database.NewSettingRepo()
	t := translate.New()
	t.SetModelPreference(func() string {
		v, err := settingRepo.Get("translate_model")
		if err != nil {
			return ""
		}
		return v
	})
	return &SelfUpdateHandler{
		auditRepo:      database.NewAuditLogRepo(),
		translator:     t,
		notesTransRepo: database.NewReleaseNotesTranslationRepo(),
	}
}

// SetGWClient injects a gateway client so the translator can resolve
// model provider config from a remote gateway (not just local files).
func (h *SelfUpdateHandler) SetGWClient(client *openclaw.GWClient) {
	if client == nil {
		return
	}
	h.translator.SetConfigResolver(func() map[string]interface{} {
		return resolveProvidersFromGWClient(client)
	})
}

// Check queries GitHub for a newer release.
// 可选 ?tag=v2026.3.2 指定具体 tag；缺省则取最新 stable。
func (h *SelfUpdateHandler) Check(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	var (
		result *updater.CheckResult
		err    error
	)
	if tag := strings.TrimSpace(r.URL.Query().Get("tag")); tag != "" {
		result, err = updater.CheckTag(ctx, tag)
	} else {
		result, err = updater.CheckForUpdate(ctx)
	}
	if err != nil {
		web.Fail(w, r, "UPDATE_CHECK_FAILED", err.Error(), http.StatusInternalServerError)
		return
	}

	web.OK(w, r, result)
}

// ListReleases returns the most recent GitHub releases for the version picker.
func (h *SelfUpdateHandler) ListReleases(w http.ResponseWriter, r *http.Request) {
	limit := 20
	if v := strings.TrimSpace(r.URL.Query().Get("limit")); v != "" {
		fmt.Sscanf(v, "%d", &limit)
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	items, err := updater.ListReleases(ctx, limit)
	if err != nil {
		web.Fail(w, r, "UPDATE_RELEASES_FAILED", err.Error(), http.StatusInternalServerError)
		return
	}
	web.OK(w, r, items)
}

// Apply downloads and applies the update, streaming progress via SSE.
func (h *SelfUpdateHandler) Apply(w http.ResponseWriter, r *http.Request) {
	// Parse request body for download URL
	var body struct {
		DownloadURL string `json:"downloadUrl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.DownloadURL == "" {
		web.Fail(w, r, "UPDATE_BAD_REQUEST", "downloadUrl is required", http.StatusBadRequest)
		return
	}

	// Set up SSE
	flusher, ok := w.(http.Flusher)
	if !ok {
		web.Fail(w, r, "UPDATE_SSE_UNSUPPORTED", "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	sendSSE := func(p updater.ApplyProgress) {
		data, _ := json.Marshal(p)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()

	err := updater.ApplyUpdate(ctx, body.DownloadURL, func(p updater.ApplyProgress) {
		sendSSE(p)
	})

	if err != nil {
		h.auditRepo.Create(&database.AuditLog{
			UserID: web.GetUserID(r), Username: web.GetUsername(r),
			Action: constants.ActionSelfUpdate, Result: "failed", Detail: err.Error(), IP: r.RemoteAddr,
		})
		sendSSE(updater.ApplyProgress{Stage: "error", Error: err.Error()})
		return
	}

	h.auditRepo.Create(&database.AuditLog{
		UserID: web.GetUserID(r), Username: web.GetUsername(r),
		Action: constants.ActionSelfUpdate, Result: "success", Detail: "update applied", IP: r.RemoteAddr,
	})

	// Clear the 12-hour update overview cache so badge counts refresh after restart
	updatecheck.InvalidateCache()

	// Send final success
	sendSSE(updater.ApplyProgress{Stage: "done", Percent: 100, Done: true})

	// Schedule restart after a short delay
	go func() {
		time.Sleep(2 * time.Second)
		restartSelf()
	}()
}

// Info returns current version and build info.
func (h *SelfUpdateHandler) Info(w http.ResponseWriter, r *http.Request) {
	web.OK(w, r, map[string]interface{}{
		"version":        version.Version,
		"build":          version.Build,
		"os":             runtime.GOOS,
		"arch":           runtime.GOARCH,
		"platform":       platformName(),
		"openclawCompat": version.OpenClawCompat,
		"goVersion":      runtime.Version(),
	})
}

// Overview returns a cached 12-hour overview of ClawDeckX/OpenClaw updates and compatibility.
func (h *SelfUpdateHandler) Overview(w http.ResponseWriter, r *http.Request) {
	force := r.URL.Query().Get("force") == "1" || strings.EqualFold(r.URL.Query().Get("force"), "true")
	overview, err := updatecheck.GetOverview(r.Context(), force)
	if err != nil {
		web.Fail(w, r, "UPDATE_OVERVIEW_FAILED", err.Error(), http.StatusInternalServerError)
		return
	}
	web.OK(w, r, overview)
}

// History returns recent self-update audit log entries.
func (h *SelfUpdateHandler) History(w http.ResponseWriter, r *http.Request) {
	logs, err := h.auditRepo.ListByAction(constants.ActionSelfUpdate, 20)
	if err != nil {
		web.FailErr(w, r, web.ErrDBQuery, err.Error())
		return
	}
	web.OK(w, r, logs)
}

// CheckChannel queries GitHub for updates on a specific channel (stable or beta).
func (h *SelfUpdateHandler) CheckChannel(w http.ResponseWriter, r *http.Request) {
	channel := r.URL.Query().Get("channel")
	if channel == "" {
		channel = "stable"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	var result *updater.CheckResult
	var err error
	if channel == "beta" {
		result, err = updater.CheckForPreRelease(ctx)
	} else {
		result, err = updater.CheckForUpdate(ctx)
	}
	if err != nil {
		web.Fail(w, r, "UPDATE_CHECK_FAILED", err.Error(), http.StatusInternalServerError)
		return
	}
	result.Channel = channel
	web.OK(w, r, result)
}

// TranslateNotes translates release notes text to the requested language.
// Uses SQLite cache keyed by (product, version, lang, sourceHash).
// Long text is split into chunks by paragraph to avoid translation API limits.
// POST /api/v1/self-update/translate-notes
func (h *SelfUpdateHandler) TranslateNotes(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Text    string `json:"text"`
		Lang    string `json:"lang"`
		Product string `json:"product"` // "clawdeckx" or "openclaw"
		Version string `json:"version"` // e.g. "0.8.1" or "2026.3.2"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.Fail(w, r, "INVALID_JSON", err.Error(), http.StatusBadRequest)
		return
	}
	if req.Text == "" || req.Lang == "" {
		web.Fail(w, r, "INVALID_PARAMS", "text and lang are required", http.StatusBadRequest)
		return
	}
	// Skip translation for English source
	if req.Lang == "en" {
		web.OK(w, r, map[string]string{"translated": req.Text, "status": "original"})
		return
	}

	// Defaults
	if req.Product == "" {
		req.Product = "unknown"
	}
	if req.Version == "" {
		req.Version = "0"
	}

	hash := fmt.Sprintf("%x", md5.Sum([]byte(req.Text)))

	// Check SQLite cache — version + hash must both match
	if cached, err := h.notesTransRepo.Get(req.Product, req.Version, req.Lang, hash); err == nil && cached != nil {
		// Validate cached result isn't garbage (e.g. from a previously broken translation API)
		if !isGarbageNotesTranslation(req.Text, cached.Translated) {
			web.OK(w, r, map[string]string{"translated": cached.Translated, "status": "cached"})
			return
		}
		// Cached translation is garbage — delete it and re-translate below
		logger.Log.Warn().Str("product", req.Product).Str("version", req.Version).Msg("cached release notes translation contains garbage, re-translating")
		_ = h.notesTransRepo.Delete(req.Product, req.Version, req.Lang)
	}

	// Split long text into chunks by double-newline (paragraph boundaries)
	chunks := splitNoteChunks(req.Text, 1500)

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
	defer cancel()

	var sb strings.Builder
	for i, chunk := range chunks {
		if chunk == "" {
			continue
		}
		translated, err := h.translator.Translate(ctx, chunk, "en", req.Lang)
		if err != nil {
			logger.Log.Warn().Err(err).Int("chunk", i).Msg("translate release notes chunk failed")
			translated = chunk // fallback to original
		}
		// Guard against garbage translations (e.g. free APIs returning spam URLs)
		if isGarbageNotesTranslation(chunk, translated) {
			logger.Log.Warn().Int("chunk", i).Str("got", truncateStr(translated, 120)).Msg("translate notes returned garbage, using original")
			translated = chunk
		}
		if i > 0 {
			sb.WriteString("\n\n")
		}
		sb.WriteString(translated)
	}

	result := sb.String()

	// Store in SQLite cache
	_ = h.notesTransRepo.Upsert(&database.ReleaseNotesTranslation{
		Product:    req.Product,
		Version:    req.Version,
		Lang:       req.Lang,
		SourceHash: hash,
		Translated: result,
	})

	web.OK(w, r, map[string]string{"translated": result, "status": "translated"})
}

// splitNoteChunks splits release notes into chunks at paragraph boundaries,
// keeping each chunk under maxLen characters. Markdown structure is preserved.
func splitNoteChunks(text string, maxLen int) []string {
	// Split by double newline (paragraph boundaries)
	paragraphs := strings.Split(text, "\n\n")
	var chunks []string
	var current strings.Builder

	for _, p := range paragraphs {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		// If adding this paragraph would exceed maxLen, flush current
		if current.Len() > 0 && current.Len()+len(p)+2 > maxLen {
			chunks = append(chunks, current.String())
			current.Reset()
		}
		// If a single paragraph exceeds maxLen, split by single newline
		if len(p) > maxLen {
			if current.Len() > 0 {
				chunks = append(chunks, current.String())
				current.Reset()
			}
			lines := strings.Split(p, "\n")
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if line == "" {
					continue
				}
				if current.Len() > 0 && current.Len()+len(line)+1 > maxLen {
					chunks = append(chunks, current.String())
					current.Reset()
				}
				if current.Len() > 0 {
					current.WriteString("\n")
				}
				current.WriteString(line)
			}
			continue
		}
		if current.Len() > 0 {
			current.WriteString("\n\n")
		}
		current.WriteString(p)
	}
	if current.Len() > 0 {
		chunks = append(chunks, current.String())
	}
	return chunks
}

func platformName() string {
	switch runtime.GOOS {
	case "darwin":
		return "macOS"
	case "linux":
		return "Linux"
	case "windows":
		return "Windows"
	default:
		return runtime.GOOS
	}
}

// restartSelf restarts the current process.
func restartSelf() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	restartWithBinary(exe)
}

// restartWithBinary restarts the process using the specified binary path.
// Used by runtime overlay updates where the new binary differs from os.Executable().
func restartWithBinary(exe string) {
	logger.Log.Info().Str("binary", exe).Msg("restarting process")

	if runtime.GOOS == "windows" {
		// On Windows, start a new process with DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
		// so it survives the parent exit. Without these flags the child is killed
		// when os.Exit terminates the current process tree.
		cmd := exec.Command(exe, os.Args[1:]...)
		cmd.SysProcAttr = selfUpdateSysProcAttr()
		cmd.Start()
		os.Exit(0)
	} else {
		// On Unix, exec replaces the current process
		execErr := execSyscall(exe, append([]string{exe}, os.Args[1:]...), os.Environ())
		if execErr != nil {
			// Fallback: start new process
			cmd := exec.Command(exe, os.Args[1:]...)
			cmd.Stdout = os.Stdout
			cmd.Stderr = os.Stderr
			cmd.Start()
			os.Exit(0)
		}
	}
}

// isGarbageNotesTranslation detects when a free translation API returns garbage
// (e.g. spam URLs like linux.do links) instead of a real translation.
func isGarbageNotesTranslation(source, translated string) bool {
	t := strings.TrimSpace(translated)
	if t == "" {
		return true
	}
	// If the translation is just a URL (or mostly URLs) but the source isn't, it's garbage.
	sourceHasURL := strings.Contains(source, "http://") || strings.Contains(source, "https://")
	if !sourceHasURL && (strings.HasPrefix(t, "http://") || strings.HasPrefix(t, "https://")) {
		return true
	}
	// Detect repeated URL spam patterns: if translated contains URLs that aren't in source
	if !sourceHasURL && strings.Count(t, "https://") > 2 {
		return true
	}
	// Known garbage domains injected by misbehaving free translation services
	garbageDomains := []string{"linux.do", "linuxdo.co", "discourse.org/t/"}
	for _, domain := range garbageDomains {
		if !strings.Contains(source, domain) && strings.Contains(t, domain) {
			return true
		}
	}
	return false
}

func truncateStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
