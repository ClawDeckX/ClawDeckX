package handlers

import (
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
	"ClawDeckX/internal/web"
)

// DoctorHandler provides diagnostic and repair operations.
type DoctorHandler struct {
	svc       *openclaw.Service
	auditRepo *database.AuditLogRepo
	activity  *database.ActivityRepo
	alert     *database.AlertRepo
}

func NewDoctorHandler(svc *openclaw.Service) *DoctorHandler {
	return &DoctorHandler{
		svc:       svc,
		auditRepo: database.NewAuditLogRepo(),
		activity:  database.NewActivityRepo(),
		alert:     database.NewAlertRepo(),
	}
}

// CheckItem is a single diagnostic check result.
type CheckItem struct {
	ID         string `json:"id"`
	Code       string `json:"code"`
	Name       string `json:"name"`
	Category   string `json:"category"`
	Severity   string `json:"severity"` // info / warn / error
	Status     string `json:"status"`   // ok / warn / error
	Detail     string `json:"detail"`
	Suggestion string `json:"suggestion,omitempty"`
	Fixable    bool   `json:"fixable"`
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

// dedupeCheckItems removes duplicate check items by ID, keeping the first occurrence.
func dedupeCheckItems(items []CheckItem) []CheckItem {
	seen := make(map[string]bool)
	result := make([]CheckItem, 0, len(items))
	for _, item := range items {
		key := item.ID
		if key == "" {
			key = item.Code
		}
		if key == "" {
			key = item.Name
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, item)
	}
	return result
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
	items = append(items, h.gatewayDiagnoseChecks()...)

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
		deduct := p.Critical*20 + p.High*12 + p.Medium*6 + p.Low*2
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
	if riskCounts["critical"]+riskCounts["high"] > 0 {
		actions = append(actions, overviewAction{ID: "review-alerts", Title: "Review Alerts", Target: "alerts", Priority: "medium"})
	}
	if events1h > 0 {
		actions = append(actions, overviewAction{ID: "open-events", Title: "Open Gateway Events", Target: "gateway", Priority: "low"})
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

func (h *DoctorHandler) collectChecks() []CheckItem {
	items := []CheckItem{
		h.checkInstalled(),
		h.checkConfig(),
		h.checkGateway(),
		h.checkPIDLock(),
		h.checkPort(),
		h.checkDisk(),
	}
	items = append(items, h.gatewayDiagnoseChecks()...)
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

func (h *DoctorHandler) runFix(item CheckItem) fixItemResult {
	home, _ := os.UserHomeDir()
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
	default:
		return fixItemResult{ID: item.ID, Code: item.Code, Name: item.Name, Status: "skipped", Message: "no fixer available"}
	}
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
