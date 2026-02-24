package handlers

import (
	"net/http"
	"strconv"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/web"
)

// AuditHandler manages audit log queries.
type AuditHandler struct {
	auditRepo *database.AuditLogRepo
}

func NewAuditHandler() *AuditHandler {
	return &AuditHandler{
		auditRepo: database.NewAuditLogRepo(),
	}
}

// List returns audit logs with pagination and filters.
func (h *AuditHandler) List(w http.ResponseWriter, r *http.Request) {
	pq := web.ParsePageQuery(r)

	var userID uint
	if v := r.URL.Query().Get("user_id"); v != "" {
		if id, err := strconv.ParseUint(v, 10, 64); err == nil {
			userID = uint(id)
		}
	}

	filter := database.AuditFilter{
		Page:      pq.Page,
		PageSize:  pq.PageSize,
		SortBy:    pq.SortBy,
		SortOrder: pq.SortOrder,
		Action:    r.URL.Query().Get("action"),
		UserID:    userID,
		StartTime: pq.StartTime,
		EndTime:   pq.EndTime,
	}

	logs, total, err := h.auditRepo.List(filter)
	if err != nil {
		web.FailErr(w, r, web.ErrDBQuery)
		return
	}

	web.OKPage(w, r, logs, total, pq.Page, pq.PageSize)
}
