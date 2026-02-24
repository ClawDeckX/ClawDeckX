package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/web"
)

// AlertHandler manages alert operations.
type AlertHandler struct {
	alertRepo *database.AlertRepo
}

func NewAlertHandler() *AlertHandler {
	return &AlertHandler{
		alertRepo: database.NewAlertRepo(),
	}
}

// List returns alerts with pagination and filters.
func (h *AlertHandler) List(w http.ResponseWriter, r *http.Request) {
	pq := web.ParsePageQuery(r)

	filter := database.AlertFilter{
		Page:      pq.Page,
		PageSize:  pq.PageSize,
		SortBy:    pq.SortBy,
		SortOrder: pq.SortOrder,
		Risk:      r.URL.Query().Get("risk"),
		StartTime: pq.StartTime,
		EndTime:   pq.EndTime,
	}

	alerts, total, err := h.alertRepo.List(filter)
	if err != nil {
		web.FailErr(w, r, web.ErrAlertQueryFail)
		return
	}

	web.OKPage(w, r, alerts, total, pq.Page, pq.PageSize)
}

// MarkNotified marks an alert as read.
func (h *AlertHandler) MarkNotified(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/v1/alerts/")
	idStr = strings.TrimSuffix(idStr, "/read")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	if err := h.alertRepo.MarkNotified(uint(id)); err != nil {
		web.FailErr(w, r, web.ErrAlertQueryFail)
		return
	}

	web.OK(w, r, map[string]string{"message": "ok"})
}

// MarkAllNotified marks all alerts as read.
func (h *AlertHandler) MarkAllNotified(w http.ResponseWriter, r *http.Request) {
	if err := h.alertRepo.MarkAllNotified(); err != nil {
		web.FailErr(w, r, web.ErrAlertQueryFail)
		return
	}

	web.OK(w, r, map[string]string{"message": "ok"})
}
