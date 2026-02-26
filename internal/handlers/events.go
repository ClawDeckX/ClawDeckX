package handlers

import (
	"net/http"
	"sort"
	"strings"
	"time"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/web"
)

type EventsHandler struct {
	activityRepo *database.ActivityRepo
	alertRepo    *database.AlertRepo
}

type UnifiedEvent struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"` // activity / alert
	Source    string    `json:"source"`
	Category  string    `json:"category"`
	Risk      string    `json:"risk"`
	Title     string    `json:"title"`
	Detail    string    `json:"detail,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

func NewEventsHandler() *EventsHandler {
	return &EventsHandler{
		activityRepo: database.NewActivityRepo(),
		alertRepo:    database.NewAlertRepo(),
	}
}

func (h *EventsHandler) List(w http.ResponseWriter, r *http.Request) {
	pq := web.ParsePageQuery(r)
	risk := strings.TrimSpace(r.URL.Query().Get("risk"))
	typ := strings.TrimSpace(r.URL.Query().Get("type"))
	source := strings.TrimSpace(r.URL.Query().Get("source"))

	keyword := strings.ToLower(strings.TrimSpace(pq.Keyword))
	fetchSize := pq.PageSize * 3
	if fetchSize < 100 {
		fetchSize = 100
	}
	if fetchSize > 500 {
		fetchSize = 500
	}

	activityFilter := database.ActivityFilter{
		Page:      1,
		PageSize:  fetchSize,
		SortBy:    "created_at",
		SortOrder: "desc",
		StartTime: pq.StartTime,
		EndTime:   pq.EndTime,
	}
	if risk != "" && risk != "all" {
		activityFilter.Risk = risk
	}
	activities, _, err := h.activityRepo.List(activityFilter)
	if err != nil {
		web.FailErr(w, r, web.ErrAlertQueryFail)
		return
	}

	alertFilter := database.AlertFilter{
		Page:      1,
		PageSize:  fetchSize,
		SortBy:    "created_at",
		SortOrder: "desc",
		StartTime: pq.StartTime,
		EndTime:   pq.EndTime,
	}
	if risk != "" && risk != "all" {
		alertFilter.Risk = risk
	}
	alerts, _, err := h.alertRepo.List(alertFilter)
	if err != nil {
		web.FailErr(w, r, web.ErrAlertQueryFail)
		return
	}

	events := make([]UnifiedEvent, 0, len(activities)+len(alerts))
	if typ == "" || typ == "all" || typ == "activity" {
		for _, a := range activities {
			e := UnifiedEvent{
				ID:        "activity:" + a.EventID,
				Type:      "activity",
				Source:    strings.TrimSpace(a.Source),
				Category:  strings.TrimSpace(a.Category),
				Risk:      strings.TrimSpace(a.Risk),
				Title:     strings.TrimSpace(a.Summary),
				Detail:    strings.TrimSpace(a.Detail),
				Timestamp: pickActivityTime(a),
			}
			if e.Source == "" {
				e.Source = "activity"
			}
			if e.Category == "" {
				e.Category = "activity"
			}
			if e.Risk == "" {
				e.Risk = "low"
			}
			events = append(events, e)
		}
	}
	if typ == "" || typ == "all" || typ == "alert" {
		for _, a := range alerts {
			e := UnifiedEvent{
				ID:        "alert:" + a.AlertID,
				Type:      "alert",
				Source:    "alert",
				Category:  "security",
				Risk:      strings.TrimSpace(a.Risk),
				Title:     strings.TrimSpace(a.Message),
				Detail:    strings.TrimSpace(a.Detail),
				Timestamp: a.CreatedAt,
			}
			if e.Risk == "" {
				e.Risk = "medium"
			}
			events = append(events, e)
		}
	}

	// query-level source / keyword filter
	filtered := make([]UnifiedEvent, 0, len(events))
	for _, e := range events {
		if source != "" && source != "all" && !strings.EqualFold(e.Source, source) {
			continue
		}
		if keyword != "" {
			s := strings.ToLower(e.Title + " " + e.Detail + " " + e.Source + " " + e.Category + " " + e.Risk + " " + e.Type)
			if !strings.Contains(s, keyword) {
				continue
			}
		}
		filtered = append(filtered, e)
	}

	sort.Slice(filtered, func(i, j int) bool {
		return filtered[i].Timestamp.After(filtered[j].Timestamp)
	})

	total := int64(len(filtered))
	start := pq.Offset()
	if start > len(filtered) {
		start = len(filtered)
	}
	end := start + pq.PageSize
	if end > len(filtered) {
		end = len(filtered)
	}
	web.OKPage(w, r, filtered[start:end], total, pq.Page, pq.PageSize)
}

func pickActivityTime(a database.Activity) time.Time {
	if !a.Timestamp.IsZero() {
		return a.Timestamp
	}
	return a.CreatedAt
}
