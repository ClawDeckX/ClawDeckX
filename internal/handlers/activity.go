package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/web"
)

// ActivityHandler manages activity events.
type ActivityHandler struct {
	activityRepo *database.ActivityRepo
}

func NewActivityHandler() *ActivityHandler {
	return &ActivityHandler{
		activityRepo: database.NewActivityRepo(),
	}
}

// List returns activity events with pagination, filters, and search.
func (h *ActivityHandler) List(w http.ResponseWriter, r *http.Request) {
	pq := web.ParsePageQuery(r)

	filter := database.ActivityFilter{
		Page:      pq.Page,
		PageSize:  pq.PageSize,
		SortBy:    pq.SortBy,
		SortOrder: pq.SortOrder,
		Keyword:   pq.Keyword,
		StartTime: pq.StartTime,
		EndTime:   pq.EndTime,
		Category:  r.URL.Query().Get("category"),
		Risk:      r.URL.Query().Get("risk"),
	}

	activities, total, err := h.activityRepo.List(filter)
	if err != nil {
		web.FailErr(w, r, web.ErrAlertQueryFail)
		return
	}

	web.OKPage(w, r, activities, total, pq.Page, pq.PageSize)
}

// GetByID returns a single activity event.
func (h *ActivityHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/v1/activities/")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	activity, err := h.activityRepo.GetByID(uint(id))
	if err != nil {
		web.FailErr(w, r, web.ErrActivityNotFound)
		return
	}

	web.OK(w, r, activity)
}
