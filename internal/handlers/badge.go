package handlers

import (
	"encoding/json"
	"net/http"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// BadgeHandler provides desktop icon badge counts.
type BadgeHandler struct {
	alertRepo *database.AlertRepo
	gwClient  *openclaw.GWClient
}

func NewBadgeHandler() *BadgeHandler {
	return &BadgeHandler{
		alertRepo: database.NewAlertRepo(),
	}
}

// SetGWClient injects the Gateway client reference.
func (h *BadgeHandler) SetGWClient(client *openclaw.GWClient) {
	h.gwClient = client
}

// Counts returns badge counts for each icon.
func (h *BadgeHandler) Counts(w http.ResponseWriter, r *http.Request) {
	unreadAlerts, _ := h.alertRepo.CountUnread()

	result := map[string]int64{
		"alerts": unreadAlerts,
	}

	// Query pending device pairing requests via gateway RPC
	if h.gwClient != nil && h.gwClient.IsConnected() {
		if raw, err := h.gwClient.Request("device.pair.list", nil); err == nil {
			var resp struct {
				Pending []json.RawMessage `json:"pending"`
			}
			if json.Unmarshal(raw, &resp) == nil && len(resp.Pending) > 0 {
				result["nodes"] = int64(len(resp.Pending))
			}
		}
	} else if h.gwClient != nil {
		result["gateway"] = 1
	}

	// Scheduler: show badge when last scheduled backup failed
	settingRepo := database.NewSettingRepo()
	if v, err := settingRepo.Get("snapshot_schedule_last_status"); err == nil && v == "failed" {
		result["scheduler"] = 1
	}

	web.OK(w, r, result)
}
