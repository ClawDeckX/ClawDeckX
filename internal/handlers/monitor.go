package handlers

import (
	"net/http"
	"time"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/web"
)

// MonitorHandler provides monitoring statistics.
type MonitorHandler struct {
	activityRepo *database.ActivityRepo
}

func NewMonitorHandler() *MonitorHandler {
	return &MonitorHandler{
		activityRepo: database.NewActivityRepo(),
	}
}

// MonitorStatsResponse is the monitoring stats response.
type MonitorStatsResponse struct {
	TotalEvents    int64            `json:"total_events"`
	Events24h      int64            `json:"events_24h"`
	Events1h       int64            `json:"events_1h"`
	RiskCounts     map[string]int64 `json:"risk_counts"`
	CategoryCounts map[string]int64 `json:"category_counts"`
	ToolCounts     map[string]int64 `json:"tool_counts"`
	HourlyCounts   map[string]int64 `json:"hourly_counts"`
	DailyCounts    map[string]int64 `json:"daily_counts"`
}

// Stats returns monitoring statistics.
func (h *MonitorHandler) Stats(w http.ResponseWriter, r *http.Request) {
	now := time.Now().UTC()

	total, _ := h.activityRepo.Count()
	events24h, _ := h.activityRepo.CountSince(now.Add(-24 * time.Hour))
	events1h, _ := h.activityRepo.CountSince(now.Add(-1 * time.Hour))
	riskCounts, _ := h.activityRepo.CountByRisk(now.Add(-24 * time.Hour))
	categoryCounts, _ := h.activityRepo.CountByCategory(now.Add(-24 * time.Hour))
	toolCounts, _ := h.activityRepo.CountByTool(now.Add(-24 * time.Hour))
	hourlyCounts, _ := h.activityRepo.CountByHour(now.Add(-48 * time.Hour))
	dailyCounts, _ := h.activityRepo.CountByDay(now.Add(-182 * 24 * time.Hour))

	web.OK(w, r, MonitorStatsResponse{
		TotalEvents:    total,
		Events24h:      events24h,
		Events1h:       events1h,
		RiskCounts:     riskCounts,
		CategoryCounts: categoryCounts,
		ToolCounts:     toolCounts,
		HourlyCounts:   hourlyCounts,
		DailyCounts:    dailyCounts,
	})
}
