package notify

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/logger"

	nfy "github.com/nikoksr/notify"
	nfydd "github.com/nikoksr/notify/service/dingding"
	nfydc "github.com/nikoksr/notify/service/discord"
	nfyhttp "github.com/nikoksr/notify/service/http"
	nfylark "github.com/nikoksr/notify/service/lark"
	nfyslack "github.com/nikoksr/notify/service/slack"
	nfytg "github.com/nikoksr/notify/service/telegram"
)

// Manager wraps nikoksr/notify.Notify and manages channel lifecycle.
type Manager struct {
	mu           sync.RWMutex
	notifier     *nfy.Notify
	channelNames []string
}

// NewManager creates an empty notification manager.
func NewManager() *Manager {
	return &Manager{
		notifier: nfy.New(),
	}
}

// Reload reads notification settings from the database and rebuilds channels.
// It reuses openclaw channel config (e.g. Telegram bot token) when available.
func (m *Manager) Reload(settingRepo *database.SettingRepo, gwChannels map[string]interface{}) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Create a fresh notifier instance (drops old services)
	n := nfy.New()
	var names []string

	// ── Telegram (via nikoksr/notify/service/telegram) ──
	tgToken, _ := settingRepo.Get("notify_telegram_token")
	if tgToken == "" {
		if ch, ok := gwChannels["telegram"]; ok {
			if cfg, ok := ch.(map[string]interface{}); ok {
				if t, ok := cfg["botToken"].(string); ok && t != "" {
					tgToken = t
				}
			}
		}
	}
	tgChatID, _ := settingRepo.Get("notify_telegram_chat_id")
	if tgToken != "" && tgChatID != "" {
		tgSvc, err := nfytg.New(tgToken)
		if err == nil {
			// AddReceivers accepts int64 chat IDs
			if id, err := strconv.ParseInt(strings.TrimSpace(tgChatID), 10, 64); err == nil {
				tgSvc.AddReceivers(id)
				n.UseServices(tgSvc)
				names = append(names, "telegram")
			} else {
				logger.Log.Warn().Str("chat_id", tgChatID).Msg("Telegram chat ID 格式无效")
			}
		} else {
			logger.Log.Warn().Err(err).Msg("Telegram 服务初始化失败")
		}
	}

	// ── DingTalk (via nikoksr/notify/service/dingding) ──
	ddToken, _ := settingRepo.Get("notify_dingtalk_token")
	ddSecret, _ := settingRepo.Get("notify_dingtalk_secret")
	if ddToken != "" {
		ddSvc := nfydd.New(&nfydd.Config{Token: ddToken, Secret: ddSecret})
		n.UseServices(ddSvc)
		names = append(names, "dingtalk")
	}

	// ── Lark/飞书 (via nikoksr/notify/service/lark webhook) ──
	larkURL, _ := settingRepo.Get("notify_lark_webhook_url")
	if larkURL != "" {
		larkSvc := nfylark.NewWebhookService(larkURL)
		n.UseServices(larkSvc)
		names = append(names, "lark")
	}

	// ── Discord (via nikoksr/notify/service/discord) ──
	dcToken, _ := settingRepo.Get("notify_discord_token")
	if dcToken == "" {
		if ch, ok := gwChannels["discord"]; ok {
			if cfg, ok := ch.(map[string]interface{}); ok {
				if t, ok := cfg["token"].(string); ok && t != "" {
					dcToken = t
				}
			}
		}
	}
	dcChannelID, _ := settingRepo.Get("notify_discord_channel_id")
	if dcToken != "" && dcChannelID != "" {
		dcSvc := nfydc.New()
		if err := dcSvc.AuthenticateWithBotToken(dcToken); err == nil {
			dcSvc.AddReceivers(strings.TrimSpace(dcChannelID))
			n.UseServices(dcSvc)
			names = append(names, "discord")
		} else {
			logger.Log.Warn().Err(err).Msg("Discord 服务初始化失败")
		}
	}

	// ── Slack (via nikoksr/notify/service/slack) ──
	slackToken, _ := settingRepo.Get("notify_slack_token")
	if slackToken == "" {
		if ch, ok := gwChannels["slack"]; ok {
			if cfg, ok := ch.(map[string]interface{}); ok {
				if t, ok := cfg["botToken"].(string); ok && t != "" {
					slackToken = t
				}
			}
		}
	}
	slackChannelID, _ := settingRepo.Get("notify_slack_channel_id")
	if slackToken != "" && slackChannelID != "" {
		slackSvc := nfyslack.New(slackToken)
		slackSvc.AddReceivers(strings.TrimSpace(slackChannelID))
		n.UseServices(slackSvc)
		names = append(names, "slack")
	}

	// ── WeCom/企微 (via webhook, using nikoksr/notify/service/http) ──
	wecomURL, _ := settingRepo.Get("notify_wecom_webhook_url")
	if wecomURL != "" {
		wecomSvc := nfyhttp.New()
		wecomSvc.AddReceivers(&nfyhttp.Webhook{
			URL:         wecomURL,
			Header:      http.Header{"Content-Type": []string{"application/json; charset=utf-8"}},
			ContentType: "application/json; charset=utf-8",
			Method:      "POST",
			BuildPayload: func(subject, message string) (payload any) {
				// WeCom webhook expects {"msgtype":"text","text":{"content":"..."}}
				return fmt.Sprintf(`{"msgtype":"text","text":{"content":"%s\n%s"}}`,
					escapeJSON(subject), escapeJSON(message))
			},
		})
		n.UseServices(wecomSvc)
		names = append(names, "wecom")
	}

	// ── Webhook (via nikoksr/notify/service/http) ──
	whURL, _ := settingRepo.Get("notify_webhook_url")
	if whURL != "" {
		whMethod, _ := settingRepo.Get("notify_webhook_method")
		whHeaders, _ := settingRepo.Get("notify_webhook_headers")
		whTemplate, _ := settingRepo.Get("notify_webhook_template")

		if whMethod == "" {
			whMethod = "POST"
		}

		// Build the HTTP service with a custom payload builder
		httpSvc := nfyhttp.New()

		// Build http.Header
		hdrs := make(http.Header)
		if whHeaders != "" {
			for _, h := range strings.Split(whHeaders, ",") {
				parts := strings.SplitN(strings.TrimSpace(h), ":", 2)
				if len(parts) == 2 {
					hdrs.Set(strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]))
				}
			}
		}

		// Detect content type from template
		contentType := "text/plain; charset=utf-8"
		if whTemplate != "" {
			trimmed := strings.TrimSpace(whTemplate)
			if (strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}")) ||
				(strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]")) {
				contentType = "application/json; charset=utf-8"
			}
		}

		tmpl := whTemplate // capture for closure
		httpSvc.AddReceivers(&nfyhttp.Webhook{
			URL:         whURL,
			Header:      hdrs,
			ContentType: contentType,
			Method:      whMethod,
			BuildPayload: func(subject, message string) (payload any) {
				text := subject + "\n" + message
				if tmpl != "" {
					text = strings.ReplaceAll(tmpl, "{message}", subject+"\n"+message)
				}
				return text
			},
		})

		n.UseServices(httpSvc)
		names = append(names, "webhook")
	}

	m.notifier = n
	m.channelNames = names

	logger.Log.Info().Int("channels", len(names)).Strs("names", names).Msg("通知渠道已重载 (nikoksr/notify)")
}

// Send dispatches a message to all configured channels.
func (m *Manager) Send(text string) {
	m.mu.RLock()
	n := m.notifier
	m.mu.RUnlock()

	if n == nil {
		return
	}
	if err := n.Send(context.Background(), "ClawDeckX", text); err != nil {
		logger.Log.Warn().Err(err).Msg("通知发送失败")
	}
}

// SendAlert formats and sends an alert notification.
func (m *Manager) SendAlert(risk, message, detail string) {
	emoji := "\u26a0\ufe0f"
	switch risk {
	case "critical":
		emoji = "\U0001f6a8"
	case "high":
		emoji = "\U0001f534"
	case "medium":
		emoji = "\U0001f7e1"
	case "low":
		emoji = "\U0001f7e2"
	}
	text := fmt.Sprintf("%s [%s] %s", emoji, risk, message)
	if detail != "" && len(detail) < 200 {
		text += "\n" + detail
	}
	m.Send(text)
}

// HasChannels returns true if at least one channel is configured.
func (m *Manager) HasChannels() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.channelNames) > 0
}

// ChannelNames returns the names of all configured channels.
func (m *Manager) ChannelNames() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]string, len(m.channelNames))
	copy(result, m.channelNames)
	return result
}

// escapeJSON escapes special characters for embedding in a JSON string value.
func escapeJSON(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`, "\r", `\r`, "\t", `\t`)
	return r.Replace(s)
}
