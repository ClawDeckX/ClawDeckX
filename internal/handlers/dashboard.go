package handlers

import (
	"net/http"
	"time"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// DashboardHandler serves the dashboard overview.
type DashboardHandler struct {
	svc       *openclaw.Service
	alertRepo *database.AlertRepo
	ruleRepo  *database.RiskRuleRepo
}

func NewDashboardHandler(svc *openclaw.Service) *DashboardHandler {
	return &DashboardHandler{
		svc:       svc,
		alertRepo: database.NewAlertRepo(),
		ruleRepo:  database.NewRiskRuleRepo(),
	}
}

// DashboardResponse is the aggregated dashboard data.
type DashboardResponse struct {
	Gateway        GatewayStatusResponse `json:"gateway"`
	Onboarding     OnboardingStatus      `json:"onboarding"`
	MonitorSummary MonitorSummary        `json:"monitor_summary"`
	RecentAlerts   []database.Alert      `json:"recent_alerts"`
	SecurityScore  int                   `json:"security_score"`
	WSClients      int                   `json:"ws_clients"`
}

// OnboardingStatus tracks onboarding progress.
type OnboardingStatus struct {
	Installed        bool `json:"installed"`
	Initialized      bool `json:"initialized"`
	ModelConfigured  bool `json:"model_configured"`
	NotifyConfigured bool `json:"notify_configured"`
	GatewayStarted   bool `json:"gateway_started"`
	MonitorEnabled   bool `json:"monitor_enabled"`
}

// MonitorSummary is a brief monitoring summary.
type MonitorSummary struct {
	TotalEvents int64            `json:"total_events"`
	Events24h   int64            `json:"events_24h"`
	RiskCounts  map[string]int64 `json:"risk_counts"`
}

// Get returns aggregated dashboard data.
func (h *DashboardHandler) Get(w http.ResponseWriter, r *http.Request) {
	// gateway status
	st := h.svc.Status()
	gwStatus := GatewayStatusResponse{
		Running: st.Running,
		Runtime: string(st.Runtime),
		Detail:  st.Detail,
	}

	// onboarding progress
	onboarding := h.detectOnboarding(st)

	// monitor summary
	summary := h.getMonitorSummary()

	// recent alerts (latest 5)
	recentAlerts, err := h.alertRepo.Recent(5)
	if err != nil {
		logger.Log.Warn().Err(err).Msg("failed to get recent alerts")
		recentAlerts = []database.Alert{}
	}

	// security score
	securityScore := h.calcSecurityScore(st, summary)

	web.OK(w, r, DashboardResponse{
		Gateway:        gwStatus,
		Onboarding:     onboarding,
		MonitorSummary: summary,
		RecentAlerts:   recentAlerts,
		SecurityScore:  securityScore,
	})
}

// detectOnboarding detects onboarding progress.
func (h *DashboardHandler) detectOnboarding(st openclaw.Status) OnboardingStatus {
	ob := OnboardingStatus{}

	// check if OpenClaw is installed
	ob.Installed = openclaw.CommandExists("openclaw")

	// check if initialized (config file exists)
	ob.Initialized = openclaw.ConfigFileExists()

	// check if model is configured
	ob.ModelConfigured = openclaw.ModelConfigured()

	// check if notification is configured
	ob.NotifyConfigured = openclaw.NotifyConfigured()

	// check if gateway is started
	ob.GatewayStarted = st.Running

	return ob
}

// getMonitorSummary returns a brief monitoring summary.
func (h *DashboardHandler) getMonitorSummary() MonitorSummary {
	activityRepo := database.NewActivityRepo()

	total, err := activityRepo.Count()
	if err != nil {
		total = 0
	}

	since24h := time.Now().UTC().Add(-24 * time.Hour)
	events24h, err := activityRepo.CountSince(since24h)
	if err != nil {
		events24h = 0
	}

	riskCounts, err := activityRepo.CountByRisk(since24h)
	if err != nil {
		riskCounts = map[string]int64{}
	}

	return MonitorSummary{
		TotalEvents: total,
		Events24h:   events24h,
		RiskCounts:  riskCounts,
	}
}

// calcSecurityScore computes a security score (0-100).
// Components: base env (20), rule enablement (40), risk coverage (20), recent alerts (20).
func (h *DashboardHandler) calcSecurityScore(st openclaw.Status, summary MonitorSummary) int {
	// 1. base environment (20 pts)
	baseScore := 20
	if !openclaw.CommandExists("openclaw") {
		baseScore -= 10
	}
	if !openclaw.ConfigFileExists() {
		baseScore -= 6
	}
	if !st.Running {
		baseScore -= 4
	}
	if baseScore < 0 {
		baseScore = 0
	}

	// 2. rule enablement (40 pts), weighted by risk level
	ruleScore := 0
	totalByRisk, enabledByRisk, err := h.ruleRepo.CountByRiskLevel()
	if err == nil {
		// weights: critical=4, high=3, medium=2, low=1
		weights := map[string]int{"critical": 4, "high": 3, "medium": 2, "low": 1}
		var totalWeight, enabledWeight int
		for risk, total := range totalByRisk {
			w := weights[risk]
			if w == 0 {
				w = 1
			}
			totalWeight += int(total) * w
			enabledWeight += int(enabledByRisk[risk]) * w
		}
		if totalWeight > 0 {
			ruleScore = enabledWeight * 40 / totalWeight
		} else {
			ruleScore = 0 // no rules = no score
		}
	}

	// 3. risk coverage (20 pts): 5 pts per level
	coverageScore := 0
	for _, risk := range []string{"critical", "high", "medium", "low"} {
		if enabledByRisk[risk] > 0 {
			coverageScore += 5
		}
	}

	// 4. recent alerts (20 pts): fewer critical/high alerts = better
	alertScore := 20
	highAlerts := summary.RiskCounts["critical"] + summary.RiskCounts["high"]
	if highAlerts >= 10 {
		alertScore = 0
	} else if highAlerts >= 5 {
		alertScore = 5
	} else if highAlerts >= 2 {
		alertScore = 10
	} else if highAlerts >= 1 {
		alertScore = 15
	}

	score := baseScore + ruleScore + coverageScore + alertScore
	if score > 100 {
		score = 100
	}
	if score < 0 {
		score = 0
	}
	return score
}
