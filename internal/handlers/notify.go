package handlers

import (
	"encoding/json"
	"net/http"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/notify"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// NotifyHandler manages notification channel configuration.
type NotifyHandler struct {
	settingRepo *database.SettingRepo
	auditRepo   *database.AuditLogRepo
	manager     *notify.Manager
	gwClient    *openclaw.GWClient
}

func NewNotifyHandler(manager *notify.Manager) *NotifyHandler {
	return &NotifyHandler{
		settingRepo: database.NewSettingRepo(),
		auditRepo:   database.NewAuditLogRepo(),
		manager:     manager,
	}
}

func (h *NotifyHandler) SetGWClient(client *openclaw.GWClient) {
	h.gwClient = client
}

// settingKeys used for notification config
var notifySettingKeys = []string{
	"notify_telegram_token",
	"notify_telegram_chat_id",
	"notify_dingtalk_token",
	"notify_dingtalk_secret",
	"notify_lark_webhook_url",
	"notify_discord_token",
	"notify_discord_channel_id",
	"notify_slack_token",
	"notify_slack_channel_id",
	"notify_wecom_webhook_url",
	"notify_webhook_url",
	"notify_webhook_method",
	"notify_webhook_headers",
	"notify_webhook_template",
	"notify_enabled",
	"notify_min_risk",
}

// GetConfig returns current notification configuration.
func (h *NotifyHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	result := make(map[string]string)
	for _, key := range notifySettingKeys {
		v, _ := h.settingRepo.Get(key)
		result[key] = v
	}

	// Also return available openclaw channels that can be reused
	availableChannels := h.getAvailableChannels()

	web.OK(w, r, map[string]interface{}{
		"config":             result,
		"active_channels":    h.manager.ChannelNames(),
		"available_channels": availableChannels,
	})
}

// UpdateConfig saves notification settings and reloads the manager.
func (h *NotifyHandler) UpdateConfig(w http.ResponseWriter, r *http.Request) {
	var items map[string]string
	if err := json.NewDecoder(r.Body).Decode(&items); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	// Only allow known keys
	filtered := make(map[string]string)
	allowed := make(map[string]bool)
	for _, k := range notifySettingKeys {
		allowed[k] = true
	}
	for k, v := range items {
		if allowed[k] {
			filtered[k] = v
		}
	}

	if len(filtered) == 0 {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	if err := h.settingRepo.SetBatch(filtered); err != nil {
		web.FailErr(w, r, web.ErrSettingsUpdateFail)
		return
	}

	// Reload notification channels
	gwChannels := h.fetchGWChannels()
	h.manager.Reload(h.settingRepo, gwChannels)

	h.auditRepo.Create(&database.AuditLog{
		UserID:   web.GetUserID(r),
		Username: web.GetUsername(r),
		Action:   constants.ActionSettingsUpdate,
		Detail:   "notification config updated",
		Result:   "success",
		IP:       r.RemoteAddr,
	})

	logger.Log.Info().Str("user", web.GetUsername(r)).Msg("notification config updated")
	web.OK(w, r, map[string]interface{}{
		"message":         "ok",
		"active_channels": h.manager.ChannelNames(),
	})
}

// TestSend sends a test notification. If "channel" is specified, only that channel is tested.
func (h *NotifyHandler) TestSend(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Message string `json:"message"`
		Channel string `json:"channel"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	if req.Message == "" {
		req.Message = i18n.T(i18n.MsgNotifyTestMessage)
	}

	if !h.manager.HasChannels() {
		web.Fail(w, r, "NO_CHANNELS", "no notification channels configured", http.StatusBadRequest)
		return
	}

	if req.Channel != "" {
		if err := h.manager.SendToChannel(req.Channel, req.Message); err != nil {
			web.Fail(w, r, "CHANNEL_SEND_FAIL", err.Error(), http.StatusBadRequest)
			return
		}
	} else {
		h.manager.Send(req.Message)
	}
	web.OK(w, r, map[string]string{"message": "ok"})
}

// getAvailableChannels returns openclaw channel types that have tokens configured.
func (h *NotifyHandler) getAvailableChannels() []map[string]interface{} {
	var result []map[string]interface{}
	gwChannels := h.fetchGWChannels()

	checkToken := func(chName, tokenKey string) {
		if ch, ok := gwChannels[chName]; ok {
			if cfg, ok := ch.(map[string]interface{}); ok {
				if t, ok := cfg[tokenKey].(string); ok && t != "" {
					result = append(result, map[string]interface{}{
						"type":      chName,
						"has_token": true,
					})
				}
			}
		}
	}

	checkToken("telegram", "botToken")
	checkToken("discord", "token")
	checkToken("slack", "botToken")

	return result
}

// fetchGWChannels gets channel config from the gateway via JSON-RPC.
func (h *NotifyHandler) fetchGWChannels() map[string]interface{} {
	if h.gwClient == nil || !h.gwClient.IsConnected() {
		return nil
	}
	data, err := h.gwClient.Request("config.get", map[string]interface{}{})
	if err != nil {
		return nil
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil
	}
	channels, _ := raw["channels"].(map[string]interface{})
	return channels
}
