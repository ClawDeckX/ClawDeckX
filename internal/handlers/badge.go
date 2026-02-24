package handlers

import (
	"net/http"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/web"
)

// BadgeHandler provides desktop icon badge counts.
type BadgeHandler struct {
	alertRepo *database.AlertRepo
}

func NewBadgeHandler() *BadgeHandler {
	return &BadgeHandler{
		alertRepo: database.NewAlertRepo(),
	}
}

// Counts returns badge counts for each icon.
func (h *BadgeHandler) Counts(w http.ResponseWriter, r *http.Request) {
	unreadAlerts, _ := h.alertRepo.CountUnread()

	web.OK(w, r, map[string]int64{
		"alerts": unreadAlerts,
	})
}
