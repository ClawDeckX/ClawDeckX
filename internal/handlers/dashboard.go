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
}

func NewDashboardHandler(svc *openclaw.Service) *DashboardHandler {
	return &DashboardHandler{
		svc:       svc,
		alertRepo: database.NewAlertRepo(),
	}
}

// DashboardResponse is the aggregated dashboard data.
type DashboardResponse struct {
	Gateway        GatewayStatusResponse `json:"gateway"`
	Onboarding     OnboardingStatus      `json:"onboarding"`
	MonitorSummary MonitorSummary        `json:"monitor_summary"`
	RecentAlerts   []database.Alert      `json:"recent_alerts"`
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

	web.OK(w, r, DashboardResponse{
		Gateway:        gwStatus,
		Onboarding:     onboarding,
		MonitorSummary: summary,
		RecentAlerts:   recentAlerts,
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
