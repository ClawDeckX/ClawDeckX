package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/service"
	"ClawDeckX/internal/web"
)

// DoctorHandler provides diagnostic and repair operations.
type DoctorHandler struct {
	svc       *openclaw.Service
	gwClient  *openclaw.GWClient
	auditRepo *database.AuditLogRepo
	activity  *database.ActivityRepo
	alert     *database.AlertRepo

	// Cache for collectSessionErrors to avoid hitting sessions.usage RPC on every Summary call.
	sessErrCache    summarySessionErrors
	sessErrCacheAt  time.Time
	sessErrCacheTTL time.Duration // default 60s
}

func NewDoctorHandler(svc *openclaw.Service) *DoctorHandler {
	return &DoctorHandler{
		svc:             svc,
		auditRepo:       database.NewAuditLogRepo(),
		activity:        database.NewActivityRepo(),
		alert:           database.NewAlertRepo(),
		sessErrCacheTTL: 60 * time.Second,
	}
}

// SetGWClient injects the Gateway client reference.
func (h *DoctorHandler) SetGWClient(client *openclaw.GWClient) {
	h.gwClient = client
}

// CheckItem is a single diagnostic check result.
type CheckItem struct {
	ID          string `json:"id"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	Category    string `json:"category"`
	Severity    string `json:"severity"` // info / warn / error
	Status      string `json:"status"`   // ok / warn / error
	Detail      string `json:"detail"`
	Suggestion  string `json:"suggestion,omitempty"`
	Remediation string `json:"remediation,omitempty"`
	Fixable     bool   `json:"fixable"`
}

// DiagResult is the overall diagnostic result.
type DiagResult struct {
	Items   []CheckItem       `json:"items"`
	Summary string            `json:"summary"`
	Score   int               `json:"score"`
	Counts  map[string]int    `json:"counts"`
	Meta    map[string]string `json:"meta,omitempty"`
}

type fixRequest struct {
	Checks []string `json:"checks"`
}

type fixItemResult struct {
	ID      string `json:"id"`
	Code    string `json:"code"`
	Name    string `json:"name"`
	Status  string `json:"status"` // success / skipped / failed
	Message string `json:"message"`
}

func securityPermissionFixMode(checkID string) (os.FileMode, bool) {
	switch checkID {
	case "fs.state_dir.perms_world_writable", "fs.state_dir.perms_group_writable", "fs.state_dir.perms_readable":
		return 0o700, true
	case "fs.config.perms_writable", "fs.config.perms_world_readable", "fs.config.perms_group_readable":
		return 0o600, true
	case "fs.credentials_dir.perms_writable", "fs.credentials_dir.perms_readable":
		return 0o700, true
	default:
		return 0, false
	}
}

func securityPermissionFixPath(checkID string) string {
	stateDir := openclaw.ResolveStateDir()
	configPath := openclaw.ResolveConfigPath()
	switch checkID {
	case "fs.state_dir.perms_world_writable", "fs.state_dir.perms_group_writable", "fs.state_dir.perms_readable":
		return stateDir
	case "fs.config.perms_writable", "fs.config.perms_world_readable", "fs.config.perms_group_readable":
		return configPath
	case "fs.credentials_dir.perms_writable", "fs.credentials_dir.perms_readable":
		if stateDir == "" {
			return ""
		}
		return filepath.Join(stateDir, "credentials")
	default:
		return ""
	}
}

type overviewCard struct {
	ID     string  `json:"id"`
	Label  string  `json:"label"`
	Value  float64 `json:"value"`
	Unit   string  `json:"unit,omitempty"`
	Trend  float64 `json:"trend,omitempty"`
	Status string  `json:"status"` // ok / warn / error
}

type overviewTrendPoint struct {
	Timestamp   string `json:"timestamp"`
	Label       string `json:"label"`
	HealthScore int    `json:"healthScore"`
	Low         int    `json:"low"`
	Medium      int    `json:"medium"`
	High        int    `json:"high"`
	Critical    int    `json:"critical"`
	Errors      int    `json:"errors"`
}

type overviewIssue struct {
	ID        string `json:"id"`
	Source    string `json:"source"`
	Category  string `json:"category"`
	Risk      string `json:"risk"`
	Title     string `json:"title"`
	Detail    string `json:"detail,omitempty"`
	Timestamp string `json:"timestamp"`
}

type overviewAction struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Target   string `json:"target"` // gateway / alerts / activity / editor / setup_wizard
	Priority string `json:"priority"`
}

type overviewResponse struct {
	Score      int                  `json:"score"`
	Status     string               `json:"status"` // ok / warn / error
	Summary    string               `json:"summary"`
	UpdatedAt  string               `json:"updatedAt"`
	Cards      []overviewCard       `json:"cards"`
	RiskCounts map[string]int       `json:"riskCounts"`
	Trend24h   []overviewTrendPoint `json:"trend24h"`
	TopIssues  []overviewIssue      `json:"topIssues"`
	Actions    []overviewAction     `json:"actions"`
}

type summaryHealthCheck struct {
	Enabled   bool   `json:"enabled"`
	FailCount int    `json:"failCount"`
	MaxFails  int    `json:"maxFails"`
	LastOK    string `json:"lastOk"`
}

type summaryExceptionCounts struct {
	Medium5m   int `json:"medium5m"`
	High5m     int `json:"high5m"`
	Critical5m int `json:"critical5m"`
	Total1h    int `json:"total1h"`
	Total24h   int `json:"total24h"`
}

type summaryGateway struct {
	Running bool   `json:"running"`
	Detail  string `json:"detail"`
}

type summarySessionErrors struct {
	TotalErrors   int `json:"totalErrors"`
	SessionCount  int `json:"sessionCount"`
	ErrorSessions int `json:"errorSessions"`
}

type securityAuditSummaryDTO struct {
	Critical int         `json:"critical"`
	Warn     int         `json:"warn"`
	Total    int         `json:"total"`
	Items    []CheckItem `json:"items"`
}

type doctorSummaryResponse struct {
	Score          int                     `json:"score"`
	Status         string                  `json:"status"` // ok / warn / error
	Summary        string                  `json:"summary"`
	UpdatedAt      string                  `json:"updatedAt"`
	Gateway        summaryGateway          `json:"gateway"`
	HealthCheck    summaryHealthCheck      `json:"healthCheck"`
	ExceptionStats summaryExceptionCounts  `json:"exceptionStats"`
	SessionErrors  summarySessionErrors    `json:"sessionErrors"`
	RecentIssues   []overviewIssue         `json:"recentIssues"`
	SecurityAudit  securityAuditSummaryDTO `json:"securityAudit"`
}

// dedupeCheckItems removes duplicate check items by normalized key, keeping the first occurrence.
// It also handles semantic duplicates between basic checks and gateway diagnose checks.
func dedupeCheckItems(items []CheckItem) []CheckItem {
	seen := make(map[string]bool)
	result := make([]CheckItem, 0, len(items))
	for _, item := range items {
		key := normalizeCheckKey(item)
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, item)
	}
	return result
}

// normalizeCheckKey returns a normalized key for deduplication.
// Maps semantically equivalent checks to the same key.
func normalizeCheckKey(item CheckItem) string {
	id := strings.ToLower(item.ID)
	name := strings.ToLower(item.Name)

	// Map gateway diagnose checks to their base equivalents
	switch {
	case strings.Contains(id, "openclaw_installed") || strings.Contains(id, "openclaw.install"):
		return "check:openclaw_install"
	case strings.Contains(id, "config_exists") || strings.Contains(id, "config.file") || strings.Contains(id, "config_valid"):
		return "check:config_file"
	case strings.Contains(id, "gateway_process") || strings.Contains(id, "gateway.status"):
		return "check:gateway_status"
	case strings.Contains(id, "port_reachable") || strings.Contains(id, "port.default"):
		return "check:port"
	case strings.Contains(id, "port_conflict"):
		return "check:port_conflict"
	case strings.Contains(id, "auth_token"):
		return "check:auth_token"
	case strings.Contains(id, "gateway_api"):
		return "check:gateway_api"
	case strings.Contains(id, "pid") || strings.Contains(id, "lock"):
		return "check:pid_lock"
	case strings.Contains(id, "disk"):
		return "check:disk"
	}

	// Fallback: use ID or Name
	if item.ID != "" {
		return "id:" + id
	}
	if item.Code != "" {
		return "code:" + strings.ToLower(item.Code)
	}
	return "name:" + name
}

// Run executes diagnostics.
func (h *DoctorHandler) Run(w http.ResponseWriter, r *http.Request) {
	var items []CheckItem

	items = append(items, h.checkInstalled())
	items = append(items, h.checkConfig())
	items = append(items, h.checkGateway())
	items = append(items, h.checkPIDLock())
	items = append(items, h.checkPort())
	items = append(items, h.checkDisk())
	items = append(items, h.checkOpenClawService())
	items = append(items, h.checkClawDeckXService())
	items = append(items, h.gatewayDiagnoseChecks()...)
	items = append(items, h.securityAuditChecks()...)

	// Deduplicate items by ID, keeping the first occurrence
	items = dedupeCheckItems(items)

	// compute score
	score := 100
	errorCount := 0
	warnCount := 0
	for _, item := range items {
		switch item.Status {
		case "error":
			score -= 20
			errorCount++
		case "warn":
			score -= 10
			warnCount++
		}
	}
	if score < 0 {
		score = 0
	}

	summary := "all checks passed"
	if errorCount > 0 {
		summary = "issues found, fix recommended"
	} else if warnCount > 0 {
		summary = "warnings found, review recommended"
	}

	web.OK(w, r, DiagResult{
		Items:   items,
		Summary: summary,
		Score:   score,
		Counts: map[string]int{
			"ok":    len(items) - warnCount - errorCount,
			"warn":  warnCount,
			"error": errorCount,
			"total": len(items),
		},
	})
}

// Overview returns health overview data for visualization.
func (h *DoctorHandler) Overview(w http.ResponseWriter, r *http.Request) {
	now := time.Now().UTC()
	checks := h.collectChecks()

	score := 100
	errCount := 0
	warnCount := 0
	for _, item := range checks {
		switch item.Status {
		case "error":
			errCount++
			score -= 20
		case "warn":
			warnCount++
			score -= 10
		}
	}
	if score < 0 {
		score = 0
	}

	status := "ok"
	if errCount > 0 || score < 60 {
		status = "error"
	} else if warnCount > 0 || score < 85 {
		status = "warn"
	}

	// Gateway diagnose summary for availability signal.
	diag := openclaw.DiagnoseGateway(h.svc.GatewayHost, h.svc.GatewayPort)
	availability := 100.0
	if diag != nil {
		pass := 0
		total := len(diag.Items)
		for _, it := range diag.Items {
			if it.Status == openclaw.DiagnosePass {
				pass++
			}
		}
		if total > 0 {
			availability = float64(pass) / float64(total) * 100
		}
	}

	// Monitor stats from Activity table.
	events24h, _ := h.activity.CountSince(now.Add(-24 * time.Hour))
	events1h, _ := h.activity.CountSince(now.Add(-1 * time.Hour))
	riskMap24h, _ := h.activity.CountByRisk(now.Add(-24 * time.Hour))
	riskMap1h, _ := h.activity.CountByRisk(now.Add(-1 * time.Hour))

	// Build risk counts with stable keys.
	riskCounts := map[string]int{
		"low":      int(riskMap24h["low"]),
		"medium":   int(riskMap24h["medium"]),
		"high":     int(riskMap24h["high"]),
		"critical": int(riskMap24h["critical"]),
	}
	errors1h := int(riskMap1h["high"] + riskMap1h["critical"])
	errors24h := int(riskMap24h["high"] + riskMap24h["critical"])

	// Resource pressure from host memory percentage.
	memUsedPct := collectSysMemory().UsedPct
	resourceStatus := "ok"
	if memUsedPct >= 90 {
		resourceStatus = "error"
	} else if memUsedPct >= 75 {
		resourceStatus = "warn"
	}

	// Build cards.
	cards := []overviewCard{
		{
			ID:     "availability",
			Label:  "Gateway Availability",
			Value:  availability,
			Unit:   "%",
			Status: ternaryStatus(availability >= 90, availability >= 75),
		},
		{
			ID:     "events24h",
			Label:  "Events 24h",
			Value:  float64(events24h),
			Status: ternaryStatus(errors24h == 0, errors24h <= 5), // Status based on error count, not total events
		},
		{
			ID:     "errors1h",
			Label:  "Errors 1h",
			Value:  float64(errors1h),
			Status: ternaryStatus(errors1h == 0, errors1h <= 3),
		},
		{
			ID:     "resource",
			Label:  "Memory Pressure",
			Value:  memUsedPct,
			Unit:   "%",
			Status: resourceStatus,
		},
	}

	// Build 24h trend (hourly).
	trend := make([]overviewTrendPoint, 24)
	indexByHour := map[string]int{}
	for i := 23; i >= 0; i-- {
		t := now.Add(-time.Duration(i) * time.Hour)
		key := t.Format("2006-01-02T15")
		idx := 23 - i
		indexByHour[key] = idx
		trend[idx] = overviewTrendPoint{
			Timestamp:   t.Format(time.RFC3339),
			Label:       t.Format("15:04"),
			HealthScore: 100,
		}
	}

	// Activity points.
	activityFilter := database.ActivityFilter{
		Page:      1,
		PageSize:  500,
		SortBy:    "created_at",
		SortOrder: "desc",
		StartTime: now.Add(-24 * time.Hour).Format(time.RFC3339),
	}
	activities, _, _ := h.activity.List(activityFilter)
	for _, a := range activities {
		key := a.CreatedAt.UTC().Format("2006-01-02T15")
		idx, ok := indexByHour[key]
		if !ok {
			continue
		}
		risk := normalizeRisk(a.Risk)
		switch risk {
		case "critical":
			trend[idx].Critical++
			trend[idx].Errors++
		case "high":
			trend[idx].High++
			trend[idx].Errors++
		case "medium":
			trend[idx].Medium++
		default:
			trend[idx].Low++
		}
	}

	// Alert points (count into hourly risk).
	alertFilter := database.AlertFilter{
		Page:      1,
		PageSize:  300,
		SortBy:    "created_at",
		SortOrder: "desc",
		StartTime: now.Add(-24 * time.Hour).Format(time.RFC3339),
	}
	alerts, _, _ := h.alert.List(alertFilter)
	for _, a := range alerts {
		key := a.CreatedAt.UTC().Format("2006-01-02T15")
		idx, ok := indexByHour[key]
		if !ok {
			continue
		}
		risk := normalizeRisk(a.Risk)
		switch risk {
		case "critical":
			trend[idx].Critical++
			trend[idx].Errors++
		case "high":
			trend[idx].High++
			trend[idx].Errors++
		case "medium":
			trend[idx].Medium++
		default:
			trend[idx].Low++
		}
	}

	for i := range trend {
		p := &trend[i]
		deduct := p.Critical*20 + p.High*10 + p.Medium*3 + p.Low*1
		p.HealthScore = 100 - deduct
		if p.HealthScore < 0 {
			p.HealthScore = 0
		}
	}

	// Top issues from recent high risk events + failing checks.
	topIssues := make([]overviewIssue, 0, 8)
	for _, a := range alerts {
		risk := normalizeRisk(a.Risk)
		if risk != "high" && risk != "critical" {
			continue
		}
		topIssues = append(topIssues, overviewIssue{
			ID:        "alert:" + a.AlertID,
			Source:    "alert",
			Category:  "security",
			Risk:      risk,
			Title:     a.Message,
			Detail:    a.Detail,
			Timestamp: a.CreatedAt.UTC().Format(time.RFC3339),
		})
		if len(topIssues) >= 5 {
			break
		}
	}
	if len(topIssues) < 5 {
		for _, a := range activities {
			risk := normalizeRisk(a.Risk)
			if risk != "high" && risk != "critical" {
				continue
			}
			topIssues = append(topIssues, overviewIssue{
				ID:        "activity:" + a.EventID,
				Source:    a.Source,
				Category:  a.Category,
				Risk:      risk,
				Title:     a.Summary,
				Detail:    a.Detail,
				Timestamp: a.CreatedAt.UTC().Format(time.RFC3339),
			})
			if len(topIssues) >= 5 {
				break
			}
		}
	}
	for _, c := range checks {
		if c.Status == "ok" {
			continue
		}
		topIssues = append(topIssues, overviewIssue{
			ID:        c.ID,
			Source:    "doctor",
			Category:  c.Category,
			Risk:      normalizeRisk(c.Status),
			Title:     c.Name,
			Detail:    c.Detail,
			Timestamp: now.Format(time.RFC3339),
		})
		if len(topIssues) >= 8 {
			break
		}
	}

	sort.Slice(topIssues, func(i, j int) bool {
		return topIssues[i].Timestamp > topIssues[j].Timestamp
	})
	if len(topIssues) > 6 {
		topIssues = topIssues[:6]
	}

	actions := make([]overviewAction, 0, 4)
	if !h.svc.Status().Running {
		actions = append(actions, overviewAction{ID: "start-gateway", Title: "Start Gateway", Target: "gateway", Priority: "high"})
	}
	if errCount > 0 {
		actions = append(actions, overviewAction{ID: "run-fix", Title: "Run Auto Fix", Target: "maintenance", Priority: "high"})
	}
	if riskCounts["critical"]+riskCounts["high"] > 0 || events1h > 5 {
		actions = append(actions, overviewAction{ID: "review-alerts", Title: "Review Alerts", Target: "alerts", Priority: "medium"})
	}
	if events1h > 0 {
		actions = append(actions, overviewAction{ID: "open-events", Title: "Open Gateway Events", Target: "activity", Priority: "low"})
	}

	summary := "Healthy and stable"
	if status == "error" {
		summary = "Critical issues detected, action recommended"
	} else if status == "warn" {
		summary = "Warnings detected, review recommended"
	}

	web.OK(w, r, overviewResponse{
		Score:      score,
		Status:     status,
		Summary:    summary,
		UpdatedAt:  now.Format(time.RFC3339),
		Cards:      cards,
		RiskCounts: riskCounts,
		Trend24h:   trend,
		TopIssues:  topIssues,
		Actions:    actions,
	})
}

// Summary returns a lightweight health snapshot for fast UI loading.
func (h *DoctorHandler) Summary(w http.ResponseWriter, r *http.Request) {
	now := time.Now().UTC()
	st := h.svc.Status()
	health := h.currentHealthCheck()

	risk5m, _ := h.activity.CountByRisk(now.Add(-5 * time.Minute))
	risk1h, _ := h.activity.CountByRisk(now.Add(-1 * time.Hour))
	risk24h, _ := h.activity.CountByRisk(now.Add(-24 * time.Hour))
	alertStats := h.collectAlertSummary(now)

	stats := summaryExceptionCounts{
		Medium5m:   int(risk5m["medium"]) + alertStats.Medium5m,
		High5m:     int(risk5m["high"]) + alertStats.High5m,
		Critical5m: int(risk5m["critical"]) + alertStats.Critical5m,
		Total1h:    int(risk1h["medium"]+risk1h["high"]+risk1h["critical"]) + alertStats.Total1h,
		Total24h:   int(risk24h["medium"]+risk24h["high"]+risk24h["critical"]) + alertStats.Total24h,
	}

	sessErrors := h.collectSessionErrors()

	// Security audit integration
	securityChecks := h.securityAuditChecks()
	secCritical := 0
	secWarn := 0
	for _, c := range securityChecks {
		switch c.Status {
		case "error":
			secCritical++
		case "warn":
			secWarn++
		}
	}

	score := 100
	if !st.Running {
		score -= 35
	}
	score -= minInt(10, stats.Medium5m*2)
	score -= minInt(30, stats.High5m*10)
	score -= minInt(50, stats.Critical5m*25)
	if health.Enabled && health.FailCount > 0 {
		score -= minInt(25, health.FailCount*10)
	}
	if sessErrors.TotalErrors > 0 {
		score -= minInt(10, sessErrors.ErrorSessions*3)
	}
	// Security audit: only critical findings impact score; warn-level are advisory only
	score -= minInt(40, secCritical*15)
	if score < 0 {
		score = 0
	}

	status := "ok"
	switch {
	case !st.Running:
		status = "error"
	case stats.Critical5m > 0:
		status = "error"
	case secCritical > 0:
		status = "error"
	case health.Enabled && health.FailCount > 0 && health.MaxFails > 0 && health.FailCount >= health.MaxFails:
		status = "error"
	case stats.High5m > 0 || stats.Medium5m > 0:
		status = "warn"
	case secWarn > 0:
		status = "warn"
	case health.Enabled && health.FailCount > 0:
		status = "warn"
	case sessErrors.ErrorSessions > 0:
		status = "warn"
	}

	summary := "Stable, no recent exceptions"
	switch status {
	case "error":
		if !st.Running {
			summary = "Gateway offline, immediate action recommended"
		} else if secCritical > 0 {
			summary = fmt.Sprintf("Security: %d critical finding(s) detected", secCritical)
		} else if stats.Critical5m > 0 {
			summary = fmt.Sprintf("Critical exceptions in the last 5 minutes: %d", stats.Critical5m)
		} else {
			summary = "Health checks are failing repeatedly"
		}
	case "warn":
		if secWarn > 0 && stats.High5m == 0 && stats.Medium5m == 0 {
			summary = fmt.Sprintf("Security: %d warning(s) found, review recommended", secWarn)
		} else if stats.High5m > 0 || stats.Medium5m > 0 {
			summary = fmt.Sprintf("Recent exceptions detected (%d in 1h)", stats.Total1h)
		} else if sessErrors.TotalErrors > 0 {
			summary = fmt.Sprintf("Session errors detected (%d errors in %d sessions)", sessErrors.TotalErrors, sessErrors.ErrorSessions)
		} else {
			summary = "Gateway health check reported intermittent failures"
		}
	}

	// Merge security audit findings into recent issues
	recentIssues := h.collectRecentExceptionIssues(now, 16)
	for _, c := range securityChecks {
		risk := "medium"
		if c.Status == "error" {
			risk = "critical"
		}
		recentIssues = append(recentIssues, overviewIssue{
			ID:        c.ID,
			Source:    "security/audit",
			Category:  "security",
			Risk:      risk,
			Title:     c.Name,
			Detail:    c.Detail,
			Timestamp: now.Format(time.RFC3339),
		})
	}
	sort.Slice(recentIssues, func(i, j int) bool {
		ri := riskOrder(recentIssues[i].Risk)
		rj := riskOrder(recentIssues[j].Risk)
		if ri != rj {
			return ri < rj
		}
		return recentIssues[i].Timestamp > recentIssues[j].Timestamp
	})
	if len(recentIssues) > 16 {
		recentIssues = recentIssues[:16]
	}

	web.OK(w, r, doctorSummaryResponse{
		Score:     score,
		Status:    status,
		Summary:   summary,
		UpdatedAt: now.Format(time.RFC3339),
		Gateway: summaryGateway{
			Running: st.Running,
			Detail:  st.Detail,
		},
		HealthCheck:    health,
		ExceptionStats: stats,
		SessionErrors:  sessErrors,
		RecentIssues:   recentIssues,
		SecurityAudit: securityAuditSummaryDTO{
			Critical: secCritical,
			Warn:     secWarn,
			Total:    secCritical + secWarn,
			Items:    securityChecks,
		},
	})
}

func riskOrder(risk string) int {
	switch strings.ToLower(risk) {
	case "critical":
		return 0
	case "high":
		return 1
	case "medium":
		return 2
	default:
		return 3
	}
}

func normalizeRisk(v string) string {
	x := strings.ToLower(strings.TrimSpace(v))
	switch x {
	case "critical", "error":
		return "critical"
	case "high":
		return "high"
	case "medium", "warn":
		return "medium"
	case "low", "ok", "info":
		return "low"
	default:
		return "low"
	}
}

func ternaryStatus(ok bool, warn bool) string {
	if ok {
		return "ok"
	}
	if warn {
		return "warn"
	}
	return "error"
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// Fix runs automatic repairs.
func (h *DoctorHandler) Fix(w http.ResponseWriter, r *http.Request) {
	var req fixRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	all := h.collectChecks()
	index := make(map[string]CheckItem, len(all))
	for _, item := range all {
		index[item.ID] = item
		index[item.Code] = item
	}

	selected := make([]CheckItem, 0, len(all))
	if len(req.Checks) == 0 {
		for _, item := range all {
			if item.Fixable {
				selected = append(selected, item)
			}
		}
	} else {
		seen := map[string]struct{}{}
		for _, key := range req.Checks {
			if item, ok := index[key]; ok && item.Fixable {
				if _, dup := seen[item.ID]; dup {
					continue
				}
				seen[item.ID] = struct{}{}
				selected = append(selected, item)
			}
		}
	}

	var fixed []string
	results := make([]fixItemResult, 0, len(selected))
	for _, item := range selected {
		res := h.runFix(item)
		results = append(results, res)
		if res.Status == "success" {
			fixed = append(fixed, res.Message)
		}
	}

	// Invalidate security audit cache if any security item was successfully fixed,
	// so the next summary/doctor query re-runs the audit and reflects the fix.
	for _, res := range results {
		if res.Status == "success" && strings.HasPrefix(res.ID, "security.") {
			openclaw.InvalidateSecurityAuditCache()
			break
		}
	}

	if len(fixed) > 0 {
		h.auditRepo.Create(&database.AuditLog{
			UserID:   web.GetUserID(r),
			Username: web.GetUsername(r),
			Action:   constants.ActionDoctorFix,
			Result:   "success",
			Detail:   strings.Join(fixed, "; "),
			IP:       r.RemoteAddr,
		})
	}

	logger.Doctor.Info().Strs("fixed", fixed).Int("results", len(results)).Msg("auto-fix completed")
	web.OK(w, r, map[string]interface{}{
		"fixed":    fixed,
		"results":  results,
		"selected": len(selected),
		"message":  "ok",
	})
}

func (h *DoctorHandler) checkInstalled() CheckItem {
	if openclaw.CommandExists("openclaw") {
		path, _ := exec.LookPath("openclaw")
		return CheckItem{
			ID:       "openclaw.install",
			Code:     "openclaw.install",
			Name:     "OpenClaw Install",
			Category: "runtime",
			Severity: "info",
			Status:   "ok",
			Detail:   "installed: " + path,
		}
	}
	return CheckItem{
		ID:         "openclaw.install",
		Code:       "openclaw.install",
		Name:       "OpenClaw Install",
		Category:   "runtime",
		Severity:   "error",
		Status:     "error",
		Detail:     "openclaw command not found",
		Suggestion: "install OpenClaw first",
	}
}

func (h *DoctorHandler) checkConfig() CheckItem {
	if openclaw.ConfigFileExists() {
		home, _ := os.UserHomeDir()
		path := filepath.Join(home, ".openclaw", "openclaw.json")
		info, _ := os.Stat(path)
		if info != nil {
			if runtime.GOOS != "windows" {
				perm := info.Mode().Perm()
				if perm != 0o600 {
					return CheckItem{
						ID:         "config.file",
						Code:       "config.file",
						Name:       "Config File",
						Category:   "config",
						Severity:   "warn",
						Status:     "warn",
						Detail:     fmt.Sprintf("exists, insecure permission: %o", perm),
						Suggestion: "set config permission to 600",
						Fixable:    true,
					}
				}
			}
			return CheckItem{
				ID:       "config.file",
				Code:     "config.file",
				Name:     "Config File",
				Category: "config",
				Severity: "info",
				Status:   "ok",
				Detail:   "exists, size: " + formatSize(info.Size()),
			}
		}
		return CheckItem{
			ID:       "config.file",
			Code:     "config.file",
			Name:     "Config File",
			Category: "config",
			Severity: "info",
			Status:   "ok",
			Detail:   "exists",
		}
	}
	return CheckItem{
		ID:         "config.file",
		Code:       "config.file",
		Name:       "Config File",
		Category:   "config",
		Severity:   "error",
		Status:     "error",
		Detail:     "config file not found",
		Suggestion: "generate default config from setup wizard",
	}
}

func (h *DoctorHandler) checkGateway() CheckItem {
	st := h.svc.Status()
	if st.Running {
		return CheckItem{
			ID:       "gateway.status",
			Code:     "gateway.status",
			Name:     "Gateway Status",
			Category: "gateway",
			Severity: "info",
			Status:   "ok",
			Detail:   st.Detail,
		}
	}
	return CheckItem{
		ID:         "gateway.status",
		Code:       "gateway.status",
		Name:       "Gateway Status",
		Category:   "gateway",
		Severity:   "warn",
		Status:     "warn",
		Detail:     "gateway not running",
		Suggestion: "start gateway from Gateway monitor",
		Fixable:    true,
	}
}

func (h *DoctorHandler) checkPIDLock() CheckItem {
	home, _ := os.UserHomeDir()
	pidFile := filepath.Join(home, ".openclaw", "gateway.pid")
	if _, err := os.Stat(pidFile); err == nil {
		st := h.svc.Status()
		if !st.Running {
			return CheckItem{
				ID:         "pid.lock",
				Code:       "pid.lock",
				Name:       "PID Lock",
				Category:   "gateway",
				Severity:   "warn",
				Status:     "warn",
				Detail:     "stale PID file found but gateway not running",
				Suggestion: "remove stale gateway.pid",
				Fixable:    true,
			}
		}
		return CheckItem{
			ID:       "pid.lock",
			Code:     "pid.lock",
			Name:     "PID Lock",
			Category: "gateway",
			Severity: "info",
			Status:   "ok",
			Detail:   "normal",
		}
	}
	return CheckItem{
		ID:       "pid.lock",
		Code:     "pid.lock",
		Name:     "PID Lock",
		Category: "gateway",
		Severity: "info",
		Status:   "ok",
		Detail:   "no stale files",
	}
}

func (h *DoctorHandler) checkPort() CheckItem {
	return CheckItem{
		ID:       "port.default",
		Code:     "port.default",
		Name:     "Port Check",
		Category: "network",
		Severity: "info",
		Status:   "ok",
		Detail:   "default port 18789",
	}
}

func (h *DoctorHandler) checkDisk() CheckItem {
	return CheckItem{
		ID:       "disk.space",
		Code:     "disk.space",
		Name:     "Disk Space",
		Category: "system",
		Severity: "info",
		Status:   "ok",
		Detail:   "ok",
	}
}

func (h *DoctorHandler) checkOpenClawService() CheckItem {
	svc := openclaw.NewService()
	status := svc.DaemonStatus()
	if status.Installed {
		detail := status.Platform + " service installed"
		if status.Enabled {
			detail += ", auto-start enabled"
		}
		if status.Active {
			detail += ", running"
		}
		return CheckItem{
			ID:       "service.openclaw",
			Code:     "service.openclaw",
			Name:     "OpenClaw Service",
			Category: "service",
			Severity: "info",
			Status:   "ok",
			Detail:   detail,
		}
	}
	return CheckItem{
		ID:         "service.openclaw",
		Code:       "service.openclaw",
		Name:       "OpenClaw Service",
		Category:   "service",
		Severity:   "info",
		Status:     "warn",
		Detail:     "system service not installed, gateway requires manual start",
		Suggestion: "install the system service in Settings → Update → System Service for auto-start on boot",
	}
}

func (h *DoctorHandler) checkClawDeckXService() CheckItem {
	if service.IsInstalled() {
		return CheckItem{
			ID:       "service.clawdeckx",
			Code:     "service.clawdeckx",
			Name:     "ClawDeckX Service",
			Category: "service",
			Severity: "info",
			Status:   "ok",
			Detail:   "system service installed, auto-start enabled",
		}
	}
	return CheckItem{
		ID:         "service.clawdeckx",
		Code:       "service.clawdeckx",
		Name:       "ClawDeckX Service",
		Category:   "service",
		Severity:   "info",
		Status:     "warn",
		Detail:     "system service not installed, ClawDeckX requires manual start",
		Suggestion: "install the system service in Settings → Update → System Service for auto-start on boot",
	}
}

func (h *DoctorHandler) collectChecks() []CheckItem {
	items := []CheckItem{
		h.checkInstalled(),
		h.checkConfig(),
		h.checkGateway(),
		h.checkPIDLock(),
		h.checkPort(),
		h.checkDisk(),
		h.checkOpenClawService(),
		h.checkClawDeckXService(),
	}
	items = append(items, h.checkConfigValues()...)
	items = append(items, h.gatewayDiagnoseChecks()...)
	items = append(items, h.securityAuditChecks()...)
	return items
}

// checkConfigValues inspects the config JSON for common misconfigurations
// and returns fixable CheckItems for each issue found.
func (h *DoctorHandler) checkConfigValues() []CheckItem {
	home, _ := os.UserHomeDir()
	configPath := filepath.Join(home, ".openclaw", "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil
	}

	gw, _ := raw["gateway"].(map[string]any)
	if gw == nil {
		gw = map[string]any{}
	}
	auth, _ := gw["auth"].(map[string]any)
	if auth == nil {
		auth = map[string]any{}
	}

	var items []CheckItem

	mode := strings.TrimSpace(fmt.Sprint(gw["mode"]))
	if mode == "" || mode == "<nil>" {
		items = append(items, CheckItem{
			ID:         "config.mode",
			Code:       "config.mode",
			Name:       "Gateway Mode",
			Category:   "config",
			Severity:   "error",
			Status:     "error",
			Detail:     "gateway.mode is not set, gateway cannot start",
			Suggestion: "set gateway.mode to local or remote",
			Fixable:    true,
		})
	} else {
		items = append(items, CheckItem{
			ID:       "config.mode",
			Code:     "config.mode",
			Name:     "Gateway Mode",
			Category: "config",
			Severity: "info",
			Status:   "ok",
			Detail:   "mode: " + mode,
		})
	}

	bind := strings.TrimSpace(fmt.Sprint(gw["bind"]))
	if bind == "" || bind == "<nil>" {
		items = append(items, CheckItem{
			ID:         "config.bind",
			Code:       "config.bind",
			Name:       "Gateway Bind",
			Category:   "config",
			Severity:   "error",
			Status:     "error",
			Detail:     "gateway.bind is not set",
			Suggestion: "set gateway.bind to loopback (recommended) or a specific address",
			Fixable:    true,
		})
	} else {
		items = append(items, CheckItem{
			ID:       "config.bind",
			Code:     "config.bind",
			Name:     "Gateway Bind",
			Category: "config",
			Severity: "info",
			Status:   "ok",
			Detail:   "bind: " + bind,
		})
	}

	authMode := strings.TrimSpace(fmt.Sprint(auth["mode"]))
	authToken := strings.TrimSpace(fmt.Sprint(auth["token"]))
	if authMode == "token" && (authToken == "" || authToken == "<nil>") {
		items = append(items, CheckItem{
			ID:         "config.auth_token",
			Code:       "config.auth_token",
			Name:       "Gateway Auth Token",
			Category:   "config",
			Severity:   "error",
			Status:     "error",
			Detail:     "gateway.auth.mode is token but token is empty",
			Suggestion: "generate a gateway auth token",
			Fixable:    true,
		})
	}

	if _, exists := auth["enabled"]; exists {
		items = append(items, CheckItem{
			ID:         "config.deprecated_auth",
			Code:       "config.deprecated_auth",
			Name:       "Deprecated Auth Config",
			Category:   "config",
			Severity:   "warn",
			Status:     "warn",
			Detail:     "gateway.auth.enabled is deprecated, use gateway.auth.mode instead",
			Suggestion: "remove deprecated auth.enabled key",
			Fixable:    true,
		})
	}

	// Check for missing backup directory
	backupDir := filepath.Join(home, ".openclaw", "backups")
	if _, err := os.Stat(backupDir); err != nil {
		items = append(items, CheckItem{
			ID:         "config.backup_dir",
			Code:       "config.backup_dir",
			Name:       "Backup Directory",
			Category:   "config",
			Severity:   "info",
			Status:     "warn",
			Detail:     "backup directory does not exist",
			Suggestion: "create backup directory for config snapshots",
			Fixable:    true,
		})
	}

	return items
}

func (h *DoctorHandler) gatewayDiagnoseChecks() []CheckItem {
	diag := openclaw.DiagnoseGateway(h.svc.GatewayHost, h.svc.GatewayPort)
	if diag == nil || len(diag.Items) == 0 {
		return nil
	}

	items := make([]CheckItem, 0, len(diag.Items))
	for _, it := range diag.Items {
		status := "ok"
		severity := "info"
		switch it.Status {
		case openclaw.DiagnoseFail:
			status = "error"
			severity = "error"
		case openclaw.DiagnoseWarn:
			status = "warn"
			severity = "warn"
		}

		name := strings.TrimSpace(it.LabelEn)
		if name == "" {
			name = strings.TrimSpace(it.Label)
		}
		if name == "" {
			name = strings.TrimSpace(it.Name)
		}

		id := strings.TrimSpace(it.Name)
		if id == "" {
			id = strings.ToLower(strings.ReplaceAll(name, " ", "_"))
		}

		items = append(items, CheckItem{
			ID:         "gateway.diag." + id,
			Code:       "gateway.diag." + id,
			Name:       name,
			Category:   "gateway",
			Severity:   severity,
			Status:     status,
			Detail:     it.Detail,
			Suggestion: it.Suggestion,
			Fixable:    false,
		})
	}
	return items
}

func (h *DoctorHandler) currentHealthCheck() summaryHealthCheck {
	if h.gwClient == nil {
		return summaryHealthCheck{}
	}

	raw := h.gwClient.HealthStatus()
	resp := summaryHealthCheck{}
	if v, ok := raw["enabled"].(bool); ok {
		resp.Enabled = v
	}
	if v, ok := raw["fail_count"].(int); ok {
		resp.FailCount = v
	}
	if v, ok := raw["max_fails"].(int); ok {
		resp.MaxFails = v
	}
	if v, ok := raw["last_ok"].(string); ok {
		resp.LastOK = v
	}
	return resp
}

func (h *DoctorHandler) collectAlertSummary(now time.Time) summaryExceptionCounts {
	filter := database.AlertFilter{
		Page:      1,
		PageSize:  300,
		SortBy:    "created_at",
		SortOrder: "desc",
		StartTime: now.Add(-24 * time.Hour).Format(time.RFC3339),
	}
	alerts, _, _ := h.alert.List(filter)

	var stats summaryExceptionCounts
	for _, a := range alerts {
		risk := normalizeRisk(a.Risk)
		if risk == "low" {
			continue
		}
		age := now.Sub(a.CreatedAt.UTC())
		if age <= time.Hour {
			stats.Total1h++
		}
		stats.Total24h++
		if age > 5*time.Minute {
			continue
		}
		switch risk {
		case "critical":
			stats.Critical5m++
		case "high":
			stats.High5m++
		default:
			stats.Medium5m++
		}
	}

	return stats
}

func (h *DoctorHandler) collectRecentExceptionIssues(now time.Time, limit int) []overviewIssue {
	if limit <= 0 {
		return nil
	}

	activityFilter := database.ActivityFilter{
		Page:      1,
		PageSize:  limit * 3,
		SortBy:    "created_at",
		SortOrder: "desc",
		StartTime: now.Add(-24 * time.Hour).Format(time.RFC3339),
	}
	activities, _, _ := h.activity.List(activityFilter)

	alertFilter := database.AlertFilter{
		Page:      1,
		PageSize:  limit * 3,
		SortBy:    "created_at",
		SortOrder: "desc",
		StartTime: now.Add(-24 * time.Hour).Format(time.RFC3339),
	}
	alerts, _, _ := h.alert.List(alertFilter)

	issues := make([]overviewIssue, 0, limit*2)
	for _, a := range activities {
		risk := normalizeRisk(a.Risk)
		if risk == "low" {
			continue
		}
		issues = append(issues, overviewIssue{
			ID:        "activity:" + a.EventID,
			Source:    a.Source,
			Category:  a.Category,
			Risk:      risk,
			Title:     a.Summary,
			Detail:    a.Detail,
			Timestamp: pickActivityTime(a).UTC().Format(time.RFC3339),
		})
	}
	for _, a := range alerts {
		risk := normalizeRisk(a.Risk)
		if risk == "low" {
			continue
		}
		issues = append(issues, overviewIssue{
			ID:        "alert:" + a.AlertID,
			Source:    "alert",
			Category:  "security",
			Risk:      risk,
			Title:     a.Message,
			Detail:    a.Detail,
			Timestamp: a.CreatedAt.UTC().Format(time.RFC3339),
		})
	}

	sort.Slice(issues, func(i, j int) bool {
		return issues[i].Timestamp > issues[j].Timestamp
	})
	if len(issues) > limit {
		issues = issues[:limit]
	}
	return issues
}

func (h *DoctorHandler) runFix(item CheckItem) fixItemResult {
	home, _ := os.UserHomeDir()
	if strings.HasPrefix(item.ID, "security.") {
		checkID := strings.TrimPrefix(item.ID, "security.")
		mode, ok := securityPermissionFixMode(checkID)
		if !ok {
			if item.Remediation != "" {
				return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "skipped", Message: item.Remediation}
			}
			return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "skipped", Message: "manual remediation required"}
		}
		targetPath := securityPermissionFixPath(checkID)
		if targetPath == "" {
			return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "skipped", Message: "target path unavailable"}
		}
		if h.svc != nil && h.svc.IsRemote() {
			manual := item.Remediation
			if manual == "" {
				manual = fmt.Sprintf("Run chmod %o on %s", mode, targetPath)
			}
			if h.gwClient == nil || !h.gwClient.IsConnected() {
				return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "skipped", Message: "remote gateway disconnected; " + manual}
			}
			return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "skipped", Message: "remote auto-fix not supported; " + manual}
		}
		if _, err := os.Stat(targetPath); err != nil {
			return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "skipped", Message: "target path not found"}
		}
		if runtime.GOOS == "windows" {
			// Windows: os.Chmod is a no-op for ACLs; use icacls to restrict permissions
			// Step 1: remove inheritance and wipe existing ACEs
			if out, err := exec.Command("icacls", targetPath, "/inheritance:r").CombinedOutput(); err != nil {
				return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "failed", Message: "icacls inheritance:r: " + string(out)}
			}
			// Step 2: grant current user full control only
			currentUser := os.Getenv("USERNAME")
			if domain := os.Getenv("USERDOMAIN"); domain != "" && currentUser != "" {
				currentUser = domain + "\\" + currentUser
			}
			if currentUser == "" {
				if who, err := exec.Command("whoami").Output(); err == nil {
					currentUser = strings.TrimSpace(string(who))
				}
			}
			if currentUser == "" {
				return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "failed", Message: "cannot determine current user for ACL fix"}
			}
			grant := "(OI)(CI)(F)" // full control, inheritable to children if directory
			if out, err := exec.Command("icacls", targetPath, "/grant:r", currentUser+":"+grant).CombinedOutput(); err != nil {
				return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "failed", Message: "icacls grant: " + string(out)}
			}
			return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "success", Message: fmt.Sprintf("fixed ACL permissions for %s (owner-only)", targetPath)}
		}
		if err := os.Chmod(targetPath, mode); err != nil {
			return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "failed", Message: err.Error()}
		}
		return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "success", Message: fmt.Sprintf("fixed permissions for %s to %o", targetPath, mode)}
	}
	switch item.ID {
	case "pid.lock":
		pidFile := filepath.Join(home, ".openclaw", "gateway.pid")
		if _, err := os.Stat(pidFile); err != nil {
			return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "skipped", Message: "pid file not found"}
		}
		st := h.svc.Status()
		if st.Running {
			return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "skipped", Message: "gateway running, skip removing pid file"}
		}
		if err := os.Remove(pidFile); err != nil {
			return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "failed", Message: err.Error()}
		}
		return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "success", Message: "removed stale PID lock file"}
	case "config.file":
		if runtime.GOOS == "windows" {
			return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "skipped", Message: "permission fix skipped on windows"}
		}
		configPath := filepath.Join(home, ".openclaw", "openclaw.json")
		if _, err := os.Stat(configPath); err != nil {
			return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "skipped", Message: "config file not found"}
		}
		if err := os.Chmod(configPath, 0o600); err != nil {
			return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "failed", Message: err.Error()}
		}
		return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "success", Message: "fixed config file permissions to 600"}
	case "gateway.status":
		st := h.svc.Status()
		if st.Running {
			return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "skipped", Message: "gateway already running"}
		}
		if err := h.svc.Start(); err != nil {
			return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "failed", Message: "failed to start gateway: " + err.Error()}
		}
		return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "success", Message: "gateway started"}
	case "config.mode":
		return h.fixConfigKey(home, "gateway", "mode", "local", "set gateway.mode to local")
	case "config.bind":
		return h.fixConfigKey(home, "gateway", "bind", "loopback", "set gateway.bind to loopback")
	case "config.auth_token":
		token := generateFixToken(32)
		if token == "" {
			return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "failed", Message: "failed to generate random token"}
		}
		return h.fixConfigAuthToken(home, token)
	case "config.deprecated_auth":
		return h.fixConfigRemoveKey(home, []string{"gateway", "auth"}, "enabled", "removed deprecated auth.enabled key")
	case "config.backup_dir":
		backupDir := filepath.Join(home, ".openclaw", "backups")
		if err := os.MkdirAll(backupDir, 0o755); err != nil {
			return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "failed", Message: err.Error()}
		}
		return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "success", Message: "created backup directory"}
	default:
		return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "skipped", Message: "no fixer available"}
	}
}

// generateFixToken generates a random hex token of n bytes.
func generateFixToken(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return ""
	}
	return hex.EncodeToString(buf)
}

// fixConfigKey reads openclaw.json, sets a top-level gateway key, backs up, and writes.
func (h *DoctorHandler) fixConfigKey(home, section, key, value, msg string) fixItemResult {
	id := section + "." + key
	res := fixItemResult{ID: "config." + key, Code: "config." + key, Name: "Config " + key}
	configPath := filepath.Join(home, ".openclaw", "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		res.Status = "failed"
		res.Message = "cannot read config: " + err.Error()
		return res
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		res.Status = "failed"
		res.Message = "cannot parse config: " + err.Error()
		return res
	}

	sec, _ := raw[section].(map[string]any)
	if sec == nil {
		sec = map[string]any{}
		raw[section] = sec
	}
	existing := strings.TrimSpace(fmt.Sprint(sec[key]))
	if existing != "" && existing != "<nil>" {
		res.Status = "skipped"
		res.Message = id + " already set to " + existing
		return res
	}
	sec[key] = value

	if err := backupAndWriteConfig(configPath, raw); err != nil {
		res.Status = "failed"
		res.Message = err.Error()
		return res
	}
	res.Status = "success"
	res.Message = msg
	return res
}

// fixConfigAuthToken sets gateway.auth.token in openclaw.json.
func (h *DoctorHandler) fixConfigAuthToken(home, token string) fixItemResult {
	res := fixItemResult{ID: "config.auth_token", Code: "config.auth_token", Name: "Gateway Auth Token"}
	configPath := filepath.Join(home, ".openclaw", "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		res.Status = "failed"
		res.Message = "cannot read config: " + err.Error()
		return res
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		res.Status = "failed"
		res.Message = "cannot parse config: " + err.Error()
		return res
	}

	gw, _ := raw["gateway"].(map[string]any)
	if gw == nil {
		gw = map[string]any{}
		raw["gateway"] = gw
	}
	auth, _ := gw["auth"].(map[string]any)
	if auth == nil {
		auth = map[string]any{}
		gw["auth"] = auth
	}
	auth["token"] = token
	if strings.TrimSpace(fmt.Sprint(auth["mode"])) == "" || fmt.Sprint(auth["mode"]) == "<nil>" {
		auth["mode"] = "token"
	}

	if err := backupAndWriteConfig(configPath, raw); err != nil {
		res.Status = "failed"
		res.Message = err.Error()
		return res
	}
	res.Status = "success"
	res.Message = "generated and configured gateway auth token"
	return res
}

// fixConfigRemoveKey removes a key from a nested config section.
func (h *DoctorHandler) fixConfigRemoveKey(home string, path []string, key, msg string) fixItemResult {
	res := fixItemResult{ID: "config.deprecated_auth", Code: "config.deprecated_auth", Name: "Deprecated Auth Config"}
	configPath := filepath.Join(home, ".openclaw", "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		res.Status = "failed"
		res.Message = "cannot read config: " + err.Error()
		return res
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		res.Status = "failed"
		res.Message = "cannot parse config: " + err.Error()
		return res
	}

	// Navigate to the target section
	current := raw
	for _, p := range path {
		next, _ := current[p].(map[string]any)
		if next == nil {
			res.Status = "skipped"
			res.Message = "config path not found"
			return res
		}
		current = next
	}
	if _, exists := current[key]; !exists {
		res.Status = "skipped"
		res.Message = "key not present"
		return res
	}
	delete(current, key)

	if err := backupAndWriteConfig(configPath, raw); err != nil {
		res.Status = "failed"
		res.Message = err.Error()
		return res
	}
	res.Status = "success"
	res.Message = msg
	return res
}

// backupAndWriteConfig creates a timestamped backup of the config and writes the updated config.
func backupAndWriteConfig(configPath string, raw map[string]any) error {
	// Backup existing config
	existingData, err := os.ReadFile(configPath)
	if err == nil && len(existingData) > 0 {
		backupDir := filepath.Join(filepath.Dir(configPath), "backups")
		_ = os.MkdirAll(backupDir, 0o755)
		backupPath := filepath.Join(backupDir, fmt.Sprintf("openclaw.json.%s.bak", time.Now().Format("20060102-150405")))
		_ = os.WriteFile(backupPath, existingData, 0o600)
	}

	out, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return fmt.Errorf("cannot marshal config: %w", err)
	}
	if err := os.WriteFile(configPath, append(out, '\n'), 0o600); err != nil {
		return fmt.Errorf("cannot write config: %w", err)
	}
	return nil
}

func (h *DoctorHandler) collectSessionErrors() summarySessionErrors {
	// Return cached result if still fresh (avoids heavy sessions.usage RPC on every Summary call)
	if !h.sessErrCacheAt.IsZero() && time.Since(h.sessErrCacheAt) < h.sessErrCacheTTL {
		return h.sessErrCache
	}

	if h.gwClient == nil {
		logger.Doctor.Debug().Msg("collectSessionErrors: gwClient is nil")
		return summarySessionErrors{}
	}
	now := time.Now().UTC()
	startDate := now.AddDate(0, 0, -1).Format("2006-01-02")
	endDate := now.Format("2006-01-02")
	data, err := h.gwClient.RequestWithTimeout("sessions.usage", map[string]interface{}{
		"startDate": startDate,
		"endDate":   endDate,
		"limit":     50,
	}, 15*time.Second)
	if err != nil {
		logger.Doctor.Debug().Err(err).Msg("collectSessionErrors: RPC failed")
		return summarySessionErrors{}
	}
	var resp struct {
		Sessions []struct {
			Usage *struct {
				MessageCounts *struct {
					Total  int `json:"total"`
					Errors int `json:"errors"`
				} `json:"messageCounts"`
			} `json:"usage"`
		} `json:"sessions"`
		Aggregates *struct {
			Messages *struct {
				Total     int `json:"total"`
				Errors    int `json:"errors"`
				ToolCalls int `json:"toolCalls"`
			} `json:"messages"`
		} `json:"aggregates"`
	}
	if err := json.Unmarshal(data, &resp); err != nil {
		logger.Doctor.Debug().Err(err).Msg("collectSessionErrors: JSON unmarshal failed")
		return summarySessionErrors{}
	}

	// Primary: use per-session usage.messageCounts
	var total, errorSessions int
	for _, s := range resp.Sessions {
		errs := 0
		if s.Usage != nil && s.Usage.MessageCounts != nil {
			errs = s.Usage.MessageCounts.Errors
		}
		if errs > 0 {
			total += errs
			errorSessions++
		}
	}

	// Fallback: if per-session scan found nothing, try aggregate level
	if total == 0 && resp.Aggregates != nil && resp.Aggregates.Messages != nil && resp.Aggregates.Messages.Errors > 0 {
		total = resp.Aggregates.Messages.Errors
		// We cannot determine errorSessions from aggregates alone, estimate as 1
		errorSessions = 1
	}

	logger.Doctor.Debug().
		Int("sessionCount", len(resp.Sessions)).
		Int("totalErrors", total).
		Int("errorSessions", errorSessions).
		Msg("collectSessionErrors: done")

	result := summarySessionErrors{
		TotalErrors:   total,
		SessionCount:  len(resp.Sessions),
		ErrorSessions: errorSessions,
	}
	h.sessErrCache = result
	h.sessErrCacheAt = time.Now()
	return result
}

func formatSize(size int64) string {
	if size < 1024 {
		return fmt.Sprintf("%d B", size)
	}
	kb := float64(size) / 1024
	if kb < 1024 {
		return fmt.Sprintf("%.1f KB", kb)
	}
	return fmt.Sprintf("%.1f MB", kb/1024)
}

// securityAuditChecks returns security audit findings as CheckItems.
// Uses cached results when available (24h TTL); only calls the CLI if cache has expired.
func (h *DoctorHandler) securityAuditChecks() []CheckItem {
	report, err := openclaw.RunSecurityAuditCached(h.gwClient)
	if err != nil || report == nil {
		return nil
	}

	items := make([]CheckItem, 0, len(report.Findings))
	for _, f := range report.Findings {
		status := "ok"
		severity := "info"
		switch f.Severity {
		case "critical":
			status = "error"
			severity = "error"
		case "warn":
			status = "warn"
			severity = "warn"
		}

		// Skip info-level findings to avoid cluttering the UI
		if f.Severity == "info" {
			continue
		}

		suggestion := f.Remediation
		if suggestion == "" && f.Severity == "critical" {
			suggestion = "Run: openclaw security audit --deep"
		}

		items = append(items, CheckItem{
			ID:          "security." + f.CheckID,
			Code:        "security." + f.CheckID,
			Name:        f.Title,
			Category:    "security",
			Severity:    severity,
			Status:      status,
			Detail:      f.Detail,
			Suggestion:  suggestion,
			Remediation: f.Remediation,
			Fixable:     securityPermissionFixPath(f.CheckID) != "",
		})
	}

	logger.Doctor.Info().
		Int("critical", report.Summary.Critical).
		Int("warn", report.Summary.Warn).
		Int("info", report.Summary.Info).
		Int("findings", len(items)).
		Msg("securityAuditChecks: completed")

	return items
}

// SecurityScanAndAlert runs a security audit and writes new critical/warn
// findings as alerts into the database. It compares against previously stored
// alert IDs to avoid duplicates. Call this periodically (e.g. every 30 min).
func (h *DoctorHandler) SecurityScanAndAlert() {
	report, err := openclaw.RunSecurityAuditWithGW(h.gwClient)
	if err != nil || report == nil {
		return
	}
	for _, f := range report.Findings {
		if f.Severity == "info" {
			continue
		}
		alertID := "sec:" + f.CheckID
		existing, _ := h.alert.GetByAlertID(alertID)
		if existing != nil {
			continue
		}
		risk := "medium"
		if f.Severity == "critical" {
			risk = "critical"
		}
		_ = h.alert.Create(&database.Alert{
			AlertID:   alertID,
			Risk:      risk,
			Message:   f.Title,
			Detail:    f.Detail,
			CreatedAt: time.Now(),
		})
	}
}
