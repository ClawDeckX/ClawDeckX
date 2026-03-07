package commands

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unicode"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
	"ClawDeckX/internal/handlers"
	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/monitor"
	"ClawDeckX/internal/notify"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/proclock"
	"ClawDeckX/internal/sentinel"
	"ClawDeckX/internal/tray"
	"ClawDeckX/internal/version"
	"ClawDeckX/internal/web"
	"ClawDeckX/internal/webconfig"

	"golang.org/x/crypto/bcrypt"
)

func RunServe(args []string) int {
	// Load config
	cfg, err := webconfig.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, i18n.T(i18n.MsgServeConfigLoadFailed, map[string]interface{}{"Error": err.Error()}))
		return 1
	}

	// CLI arg overrides
	portOverride := false
	initUser := ""
	initPass := ""
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--port", "-p":
			if i+1 < len(args) {
				i++
				fmt.Sscanf(args[i], "%d", &cfg.Server.Port)
				portOverride = true
			}
		case "--bind", "-b":
			if i+1 < len(args) {
				i++
				cfg.Server.Bind = args[i]
			}
		case "--user", "-u":
			if i+1 < len(args) {
				i++
				initUser = args[i]
			}
		case "--password", "--pass":
			if i+1 < len(args) {
				i++
				initPass = args[i]
			}
		case "--debug":
			cfg.Log.Mode = "debug"
			cfg.Log.Level = "debug"
		}
	}

	if portOverride {
		if err := webconfig.Save(cfg); err != nil {
			fmt.Fprintln(os.Stderr, i18n.T(i18n.MsgServeConfigSaveFailed, map[string]interface{}{"Error": err.Error()}))
		} else {
			fmt.Println(i18n.T(i18n.MsgServePortSaved, map[string]interface{}{"Port": cfg.Server.Port}))
		}
	}

	// Init logger
	logger.Init(cfg.Log)
	logger.Log.Info().Str("version", version.Version).Msg(i18n.T(i18n.MsgLogServeStarting))

	// Init database
	if err := database.Init(cfg.Database, cfg.IsDebug()); err != nil {
		logger.Log.Fatal().Err(err).Msg(i18n.T(i18n.MsgLogDbInitFailed))
		return 1
	}
	defer database.Close()

	if initUser != "" && initPass != "" {
		userRepo := database.NewUserRepo()
		count, _ := userRepo.Count()
		if count == 0 {
			if len(initPass) < 6 {
				fmt.Fprintln(os.Stderr, i18n.T(i18n.MsgServePasswordTooShort))
				return 1
			}
			hash, err := bcrypt.GenerateFromPassword([]byte(initPass), bcrypt.DefaultCost)
			if err != nil {
				fmt.Fprintln(os.Stderr, i18n.T(i18n.MsgServePasswordEncryptFailed, map[string]interface{}{"Error": err.Error()}))
				return 1
			}
			if err := userRepo.Create(&database.User{
				Username:     initUser,
				PasswordHash: string(hash),
				Role:         constants.RoleAdmin,
			}); err != nil {
				fmt.Fprintln(os.Stderr, i18n.T(i18n.MsgServeUserCreateFailed, map[string]interface{}{"Error": err.Error()}))
				return 1
			}
			fmt.Println(i18n.T(i18n.MsgServeUserCreated, map[string]interface{}{"Username": initUser}))
		} else {
			fmt.Println(i18n.T(i18n.MsgServeUserExists, map[string]interface{}{"Count": count}))
		}
	}

	// Init WebSocket Hub (pass CORS origins for Origin validation)
	wsHub := web.NewWSHub(cfg.Server.CORSOrigins)
	go wsHub.Run()

	gwHost := cfg.OpenClaw.GatewayHost
	gwPort := cfg.OpenClaw.GatewayPort
	gwToken := cfg.OpenClaw.GatewayToken
	{
		profileRepo := database.NewGatewayProfileRepo()
		// Load user language preference before creating default profile
		if lang, err := database.NewSettingRepo().Get("language"); err == nil && lang != "" {
			i18n.SetLanguage(lang)
		}
		// Auto-create default local gateway profile on first launch
		if profiles, err := profileRepo.List(); err == nil && len(profiles) == 0 {
			defaultPort := gwPort
			if defaultPort == 0 {
				defaultPort = 18789
			}
			localProfile := &database.GatewayProfile{
				Name:     i18n.T(i18n.MsgDefaultLocalGatewayName),
				Host:     "127.0.0.1",
				Port:     defaultPort,
				Token:    gwToken,
				IsActive: true,
			}
			if err := profileRepo.Create(localProfile); err == nil {
				logger.Log.Info().
					Str("name", localProfile.Name).
					Int("port", localProfile.Port).
					Msg("auto-created default local gateway profile")
			}
		}
		if activeProfile, err := profileRepo.GetActive(); err == nil && activeProfile != nil {
			gwHost = activeProfile.Host
			gwPort = activeProfile.Port
			gwToken = activeProfile.Token
			logger.Log.Info().
				Str("name", activeProfile.Name).
				Str("host", activeProfile.Host).
				Int("port", activeProfile.Port).
				Msg(i18n.T(i18n.MsgLogUsingGatewayProfile))
		}
	}

	if gwToken == "" {
		logger.Log.Debug().
			Str("configPath", cfg.OpenClaw.ConfigPath).
			Bool("configPathEmpty", cfg.OpenClaw.ConfigPath == "").
			Msg(i18n.T(i18n.MsgLogTryingReadGwToken))
		if t := readOpenClawGatewayToken(cfg.OpenClaw.ConfigPath); t != "" {
			gwToken = t
			logger.Log.Info().Int("tokenLen", len(t)).Msg(i18n.T(i18n.MsgLogGatewayTokenRead))
		} else {
			logger.Log.Warn().
				Str("configPath", cfg.OpenClaw.ConfigPath).
				Msg(i18n.T(i18n.MsgLogGwTokenReadFailed))
		}
	}

	svc := openclaw.NewService()
	svc.GatewayHost = gwHost
	svc.GatewayPort = gwPort
	svc.GatewayToken = gwToken
	if svc.IsRemote() {
		logger.Log.Info().
			Str("host", svc.GatewayHost).
			Int("port", svc.GatewayPort).
			Msg(i18n.T(i18n.MsgLogRemoteGatewayMode))
	}

	gwClient := openclaw.NewGWClient(openclaw.GWClientConfig{
		Host:  gwHost,
		Port:  gwPort,
		Token: gwToken,
	})
	svc.SetGWClient(gwClient)
	gwClient.SetRestartCallback(func() error {
		return svc.Restart()
	})
	{
		settingRepo := database.NewSettingRepo()
		if v, _ := settingRepo.Get("gateway_health_check_interval_sec"); v != "" {
			if intervalSec, err := strconv.Atoi(v); err == nil {
				gwClient.SetHealthCheckIntervalSeconds(intervalSec)
			}
		}
		if v, _ := settingRepo.Get("gateway_health_check_max_fails"); v != "" {
			if maxFails, err := strconv.Atoi(v); err == nil {
				gwClient.SetHealthCheckMaxFails(maxFails)
			}
		}
		if v, _ := settingRepo.Get("gateway_reconnect_backoff_cap_ms"); v != "" {
			if backoffCapMs, err := strconv.Atoi(v); err == nil {
				gwClient.SetReconnectBackoffCapMs(backoffCapMs)
			}
		}
		v, _ := settingRepo.Get("gateway_health_check_enabled")
		healthCheckApplicable := svc.IsRemote() || openclaw.IsOpenClawInstalled()
		if v != "false" && healthCheckApplicable {
			gwClient.SetHealthCheckEnabled(true)
		}
	}
	gwClient.Start()
	defer gwClient.Stop()

	notifyMgr := notify.NewManager()
	{
		settingRepo := database.NewSettingRepo()
		var gwChannels map[string]interface{}
		if gwClient.IsConnected() {
			if data, err := gwClient.Request("config.get", map[string]interface{}{}); err == nil {
				var raw map[string]interface{}
				if json.Unmarshal(data, &raw) == nil {
					gwChannels, _ = raw["channels"].(map[string]interface{})
				}
			}
		}
		notifyMgr.Reload(settingRepo, gwChannels)
	}
	gwClient.SetNotifyCallback(func(msg string) {
		notifyMgr.Send(msg)
	})

	// Push badge updates to frontend via WS when gateway events arrive.
	// This eliminates the need for frontend polling of /api/v1/badges.
	gwClient.SetEventHandler(func(event string, payload json.RawMessage) {
		if event == "health" {
			go func() {
				badges := map[string]int64{}
				alertRepo := database.NewAlertRepo()
				if n, err := alertRepo.CountUnread(); err == nil {
					badges["alerts"] = n
				}
				if gwClient.IsConnected() {
					if raw, err := gwClient.Request("device.pair.list", nil); err == nil {
						var resp struct {
							Pending []json.RawMessage `json:"pending"`
						}
						if json.Unmarshal(raw, &resp) == nil && len(resp.Pending) > 0 {
							badges["nodes"] = int64(len(resp.Pending))
						}
					}
				} else {
					badges["gateway"] = 1
				}
				settingRepo := database.NewSettingRepo()
				if v, err := settingRepo.Get("snapshot_schedule_last_status"); err == nil && v == "failed" {
					badges["scheduler"] = 1
				}
				wsHub.Broadcast("", "badge_update", badges)
			}()
		}
	})

	gwCollector := monitor.NewGWCollector(gwClient, wsHub, cfg.Monitor.IntervalSeconds)
	go gwCollector.Start()
	defer gwCollector.Stop()

	monSvc := monitor.NewService(cfg.OpenClaw.ConfigPath, wsHub, cfg.Monitor.IntervalSeconds)

	authHandler := handlers.NewAuthHandler(&cfg)
	gatewayHandler := handlers.NewGatewayHandler(svc, wsHub)
	gatewayHandler.SetGWClient(gwClient)
	dashboardHandler := handlers.NewDashboardHandler(svc)
	activityHandler := handlers.NewActivityHandler()
	eventsHandler := handlers.NewEventsHandler()
	monitorHandler := handlers.NewMonitorHandler()
	settingsHandler := handlers.NewSettingsHandler()
	settingsHandler.SetGWClient(gwClient)
	settingsHandler.SetGWService(svc)
	alertHandler := handlers.NewAlertHandler()
	notifyHandler := handlers.NewNotifyHandler(notifyMgr)
	notifyHandler.SetGWClient(gwClient)
	auditHandler := handlers.NewAuditHandler()
	configHandler := handlers.NewConfigHandler()
	snapshotHandler := handlers.NewSnapshotHandler()
	snapshotHandler.SetGWClient(gwClient)
	snapshotHandler.SetGatewaySvc(svc)
	if identity, err := openclaw.LoadOrCreateDeviceIdentity(""); err == nil {
		snapshotHandler.Scheduler().SetDeviceID(identity.DeviceID)
	}
	schedulerCtx, schedulerCancel := context.WithCancel(context.Background())
	defer schedulerCancel()
	go snapshotHandler.Scheduler().Start(schedulerCtx)
	snapshotHandler.Service().StartTokenCleanup(schedulerCtx.Done())
	doctorHandler := handlers.NewDoctorHandler(svc)
	doctorHandler.SetGWClient(gwClient)
	llmHealthHandler := handlers.NewLLMHealthHandler(svc)
	llmHealthHandler.SetGWClient(gwClient)
	exportHandler := handlers.NewExportHandler()
	userHandler := handlers.NewUserHandler()
	skillsHandler := handlers.NewSkillsHandler()
	skillsHandler.SetGWClient(gwClient)
	skillTransHandler := handlers.NewSkillTranslationHandler()
	skillTransHandler.SetGWClient(gwClient)
	setupWizardHandler := handlers.NewSetupWizardHandler(svc)
	setupWizardHandler.SetGWClient(gwClient)
	gwDiagnoseHandler := handlers.NewGatewayDiagnoseHandler(svc)
	monConfigHandler := handlers.NewMonitorConfigHandler(monSvc, &cfg)
	gwLogHandler := handlers.NewGatewayLogHandler(svc, gwClient)
	gwProfileHandler := handlers.NewGatewayProfileHandler()
	gwProfileHandler.SetGWClient(gwClient)
	gwProfileHandler.SetGWService(svc)
	hostInfoHandler := handlers.NewHostInfoHandler()
	selfUpdateHandler := handlers.NewSelfUpdateHandler()
	selfUpdateHandler.SetGWClient(gwClient)
	serverConfigHandler := handlers.NewServerConfigHandler()
	recipeHandler := handlers.NewRecipeHandler()
	badgeHandler := handlers.NewBadgeHandler()
	badgeHandler.SetGWClient(gwClient)

	router := web.NewRouter()

	router.GET("/api/v1/auth/needs-setup", authHandler.NeedsSetup)
	router.POST("/api/v1/auth/setup", authHandler.Setup)
	router.POST("/api/v1/auth/login", authHandler.Login)
	router.POST("/api/v1/auth/logout", authHandler.Logout)

	router.GET("/api/v1/auth/me", authHandler.Me)
	router.PUT("/api/v1/auth/password", authHandler.ChangePassword)
	router.PUT("/api/v1/auth/username", authHandler.ChangeUsername)

	router.GET("/api/v1/dashboard", dashboardHandler.Get)
	router.GET("/api/v1/host-info", hostInfoHandler.Get)
	router.GET("/api/v1/host-info/check-update", hostInfoHandler.CheckUpdate)

	router.GET("/api/v1/self-update/info", selfUpdateHandler.Info)
	router.GET("/api/v1/self-update/check", selfUpdateHandler.Check)
	router.GET("/api/v1/self-update/check-channel", selfUpdateHandler.CheckChannel)
	router.GET("/api/v1/self-update/history", selfUpdateHandler.History)
	router.POST("/api/v1/self-update/translate-notes", selfUpdateHandler.TranslateNotes)
	router.POST("/api/v1/self-update/apply", web.RequireAdmin(selfUpdateHandler.Apply))

	serviceHandler := handlers.NewServiceHandler(database.NewAuditLogRepo())
	router.GET("/api/v1/service/status", serviceHandler.Status)
	router.POST("/api/v1/service/openclaw/install", web.RequireAdmin(serviceHandler.InstallOpenClaw))
	router.POST("/api/v1/service/openclaw/uninstall", web.RequireAdmin(serviceHandler.UninstallOpenClaw))
	router.POST("/api/v1/service/clawdeckx/install", web.RequireAdmin(serviceHandler.InstallClawDeckX))
	router.POST("/api/v1/service/clawdeckx/uninstall", web.RequireAdmin(serviceHandler.UninstallClawDeckX))

	router.GET("/api/v1/server-config", serverConfigHandler.Get)
	router.PUT("/api/v1/server-config", web.RequireAdmin(serverConfigHandler.Update))

	router.GET("/api/v1/gateway/status", gatewayHandler.Status)
	router.POST("/api/v1/gateway/start", web.RequireAdmin(gatewayHandler.Start))
	router.POST("/api/v1/gateway/stop", web.RequireAdmin(gatewayHandler.Stop))
	router.POST("/api/v1/gateway/restart", web.RequireAdmin(gatewayHandler.Restart))
	router.POST("/api/v1/gateway/kill", web.RequireAdmin(gatewayHandler.Kill))
	router.GET("/api/v1/gateway/daemon/status", gatewayHandler.DaemonStatus)
	router.POST("/api/v1/gateway/daemon/install", web.RequireAdmin(gatewayHandler.DaemonInstall))
	router.POST("/api/v1/gateway/daemon/uninstall", web.RequireAdmin(gatewayHandler.DaemonUninstall))
	router.GET("/api/v1/gateway/last-restart", gatewayHandler.LastRestart)

	router.GET("/api/v1/activities", activityHandler.List)
	router.GET("/api/v1/activities/", activityHandler.GetByID)
	router.GET("/api/v1/events", eventsHandler.List)

	router.GET("/api/v1/monitor/stats", monitorHandler.Stats)

	router.GET("/api/v1/settings", settingsHandler.GetAll)
	router.PUT("/api/v1/settings", web.RequireAdmin(settingsHandler.Update))
	router.GET("/api/v1/settings/language", settingsHandler.GetLanguage)
	router.PUT("/api/v1/settings/language", settingsHandler.SetLanguage)
	router.GET("/api/v1/settings/gateway", settingsHandler.GetGatewayConfig)
	router.PUT("/api/v1/settings/gateway", web.RequireAdmin(settingsHandler.UpdateGatewayConfig))

	router.GET("/api/v1/alerts", alertHandler.List)
	router.POST("/api/v1/alerts/read-all", alertHandler.MarkAllNotified)
	router.POST("/api/v1/alerts/", alertHandler.MarkNotified)

	router.GET("/api/v1/notify/config", notifyHandler.GetConfig)
	router.PUT("/api/v1/notify/config", web.RequireAdmin(notifyHandler.UpdateConfig))
	router.POST("/api/v1/notify/test", web.RequireAdmin(notifyHandler.TestSend))

	router.GET("/api/v1/audit-logs", auditHandler.List)

	router.GET("/api/v1/config", configHandler.Get)
	router.PUT("/api/v1/config", web.RequireAdmin(configHandler.Update))
	router.POST("/api/v1/config/validate", web.RequireAdmin(configHandler.Validate))
	router.POST("/api/v1/config/generate-default", web.RequireAdmin(configHandler.GenerateDefault))
	router.POST("/api/v1/config/set-key", web.RequireAdmin(configHandler.SetKey))
	router.POST("/api/v1/config/unset-key", web.RequireAdmin(configHandler.UnsetKey))
	router.GET("/api/v1/config/get-key", configHandler.GetKey)

	router.GET("/api/v1/snapshots", snapshotHandler.List)
	router.POST("/api/v1/snapshots", web.RequireAdmin(snapshotHandler.Create))
	router.POST("/api/v1/snapshots/import", web.RequireAdmin(snapshotHandler.Import))
	router.GET("/api/v1/snapshots/schedule", snapshotHandler.GetSchedule)
	router.PUT("/api/v1/snapshots/schedule", web.RequireAdmin(snapshotHandler.UpdateSchedule))
	router.GET("/api/v1/snapshots/schedule/status", snapshotHandler.GetScheduleStatus)
	router.POST("/api/v1/snapshots/schedule/run-now", web.RequireAdmin(snapshotHandler.ScheduleRunNow))
	router.POST("/api/v1/snapshots/", web.RequireAdmin(snapshotHandler.Action))
	router.DELETE("/api/v1/snapshots/", web.RequireAdmin(snapshotHandler.Delete))

	router.GET("/api/v1/doctor", doctorHandler.Run)
	router.GET("/api/v1/doctor/summary", doctorHandler.Summary)
	router.GET("/api/v1/doctor/overview", doctorHandler.Overview)
	router.POST("/api/v1/doctor/fix", doctorHandler.Fix)

	router.POST("/api/v1/recipe/apply-step", web.RequireAdmin(recipeHandler.ApplyStep))

	router.GET("/api/v1/llm/models-status", llmHealthHandler.ModelsStatus)
	router.GET("/api/v1/llm/auth-health", llmHealthHandler.AuthHealth)
	router.POST("/api/v1/llm/probe", llmHealthHandler.Probe)
	router.POST("/api/v1/llm/exec", web.RequireAdmin(llmHealthHandler.Exec))
	router.GET("/api/v1/llm/exec-capability", llmHealthHandler.ExecCapability)

	router.GET("/api/v1/users", userHandler.List)
	router.POST("/api/v1/users", web.RequireAdmin(userHandler.Create))
	router.DELETE("/api/v1/users/", web.RequireAdmin(userHandler.Delete))

	router.GET("/api/v1/skills", skillsHandler.List)
	router.GET("/api/v1/skills/translations", skillTransHandler.Get)
	router.POST("/api/v1/skills/translations", skillTransHandler.Translate)

	router.GET("/api/v1/setup/scan", setupWizardHandler.Scan)
	router.GET("/api/v1/setup/status", setupWizardHandler.Status)
	router.POST("/api/v1/setup/install-deps", setupWizardHandler.InstallDeps)
	router.POST("/api/v1/setup/install-openclaw", setupWizardHandler.InstallOpenClaw)
	router.POST("/api/v1/setup/configure", setupWizardHandler.Configure)
	router.POST("/api/v1/setup/start-gateway", setupWizardHandler.StartGateway)
	router.POST("/api/v1/setup/verify", setupWizardHandler.Verify)
	router.POST("/api/v1/setup/auto-install", setupWizardHandler.AutoInstall)
	router.POST("/api/v1/setup/uninstall", setupWizardHandler.Uninstall)
	router.POST("/api/v1/setup/update-openclaw", setupWizardHandler.UpdateOpenClaw)

	wizardHandler := handlers.NewWizardHandler()
	wizardHandler.SetGWClient(gwClient)
	router.POST("/api/v1/setup/test-model", wizardHandler.TestModel)
	router.POST("/api/v1/setup/discover-models", wizardHandler.DiscoverModels)
	router.POST("/api/v1/setup/test-channel", wizardHandler.TestChannel)
	router.POST("/api/v1/config/model-wizard", wizardHandler.SaveModel)
	router.POST("/api/v1/config/channel-wizard", wizardHandler.SaveChannel)

	router.GET("/api/v1/pairing/list", wizardHandler.ListPairingRequests)
	router.POST("/api/v1/pairing/approve", wizardHandler.ApprovePairingRequest)

	router.GET("/api/v1/monitor/config", monConfigHandler.GetConfig)
	router.PUT("/api/v1/monitor/config", monConfigHandler.UpdateConfig)
	router.POST("/api/v1/monitor/start", monConfigHandler.StartMonitor)
	router.POST("/api/v1/monitor/stop", monConfigHandler.StopMonitor)

	router.GET("/api/v1/gateway/log", gwLogHandler.GetLog)

	router.GET("/api/v1/gateway/health-check", gatewayHandler.GetHealthCheck)
	router.PUT("/api/v1/gateway/health-check", gatewayHandler.SetHealthCheck)

	router.POST("/api/v1/gateway/diagnose", gwDiagnoseHandler.Diagnose)

	router.GET("/api/v1/gateway/profiles", gwProfileHandler.List)
	router.POST("/api/v1/gateway/profiles", gwProfileHandler.Create)
	router.PUT("/api/v1/gateway/profiles", gwProfileHandler.Update)
	router.DELETE("/api/v1/gateway/profiles", gwProfileHandler.Delete)
	router.POST("/api/v1/gateway/profiles/activate", gwProfileHandler.Activate)
	router.POST("/api/v1/gateway/profiles/test", gwProfileHandler.TestConnection)

	gwProxy := handlers.NewGWProxyHandler(gwClient)
	router.GET("/api/v1/gw/status", gwProxy.Status)
	router.POST("/api/v1/gw/reconnect", gwProxy.Reconnect)
	router.GET("/api/v1/gw/health", gwProxy.Health)
	router.GET("/api/v1/gw/info", gwProxy.GWStatus)
	router.GET("/api/v1/gw/sessions", gwProxy.SessionsList)
	router.POST("/api/v1/gw/sessions/preview", gwProxy.SessionsPreview)
	router.POST("/api/v1/gw/sessions/reset", gwProxy.SessionsReset)
	router.POST("/api/v1/gw/sessions/delete", gwProxy.SessionsDelete)
	router.GET("/api/v1/gw/models", gwProxy.ModelsList)
	router.GET("/api/v1/gw/usage/status", gwProxy.UsageStatus)
	router.GET("/api/v1/gw/usage/cost", gwProxy.UsageCost)
	router.GET("/api/v1/gw/sessions/usage", gwProxy.SessionsUsage)
	router.GET("/api/v1/gw/skills", gwProxy.SkillsStatus)
	router.GET("/api/v1/gw/config", gwProxy.ConfigGet)
	router.GET("/api/v1/gw/agents", gwProxy.AgentsList)
	router.GET("/api/v1/gw/cron", gwProxy.CronList)
	router.GET("/api/v1/gw/cron/status", gwProxy.CronStatus)
	router.GET("/api/v1/gw/channels", gwProxy.ChannelsStatus)
	router.GET("/api/v1/gw/logs/tail", gwProxy.LogsTail)
	router.GET("/api/v1/gw/config/remote", gwProxy.ConfigGetRemote)
	router.PUT("/api/v1/gw/config/remote", gwProxy.ConfigSetRemote)
	router.POST("/api/v1/gw/config/reload", gwProxy.ConfigReload)
	router.GET("/api/v1/gw/sessions/messages", gwProxy.SessionsPreviewMessages)
	router.GET("/api/v1/gw/sessions/history", gwProxy.SessionsHistory)
	router.POST("/api/v1/gw/proxy", gwProxy.GenericProxy)
	router.POST("/api/v1/gw/skills/install-stream", gwProxy.DepInstallStreamSSE)
	router.POST("/api/v1/gw/skills/install-async", gwProxy.DepInstallAsync)
	router.GET("/api/v1/gw/skills/config", gwProxy.SkillsConfigGet)
	router.POST("/api/v1/gw/skills/configure", gwProxy.SkillsConfigure)

	templateHandler := handlers.NewTemplateHandler()
	// Seed built-in templates on startup
	if err := templateHandler.SeedBuiltIn(handlers.BuiltInTemplates()); err != nil {
		logger.Log.Error().Err(err).Msg(i18n.T(i18n.MsgLogTemplateSeedFailed))
	}
	router.GET("/api/v1/templates", templateHandler.List)
	router.GET("/api/v1/templates/", templateHandler.Get)
	router.POST("/api/v1/templates", web.RequireAdmin(templateHandler.Create))
	router.PUT("/api/v1/templates", web.RequireAdmin(templateHandler.Update))
	router.DELETE("/api/v1/templates/", web.RequireAdmin(templateHandler.Delete))

	clawHubHandler := handlers.NewClawHubHandler(gwClient)
	router.GET("/api/v1/clawhub/list", clawHubHandler.List)
	router.GET("/api/v1/clawhub/search", clawHubHandler.Search)
	router.GET("/api/v1/clawhub/skill", clawHubHandler.SkillDetail)
	router.POST("/api/v1/clawhub/install", clawHubHandler.Install)
	router.POST("/api/v1/clawhub/install-stream", clawHubHandler.InstallStreamSSE)
	router.POST("/api/v1/clawhub/uninstall", clawHubHandler.Uninstall)
	router.POST("/api/v1/clawhub/update", clawHubHandler.Update)
	router.GET("/api/v1/clawhub/installed", clawHubHandler.InstalledList)

	pluginInstallHandler := handlers.NewPluginInstallHandler(gwClient)
	router.GET("/api/v1/plugins/can-install", pluginInstallHandler.CanInstall)
	router.GET("/api/v1/plugins/check", pluginInstallHandler.CheckInstalled)
	router.POST("/api/v1/plugins/install", pluginInstallHandler.Install)

	router.GET("/api/v1/export/activities", exportHandler.ExportActivities)
	router.GET("/api/v1/export/alerts", exportHandler.ExportAlerts)
	router.GET("/api/v1/export/audit-logs", exportHandler.ExportAuditLogs)

	router.GET("/api/v1/badges", badgeHandler.Counts)

	// WebSocket
	router.GET("/api/v1/ws", wsHub.HandleWS(cfg.Auth.JWTSecret))

	router.GET("/api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		web.OK(w, r, map[string]interface{}{
			"status":  "ok",
			"version": version.Version,
		})
	})

	// Static files fallback (SPA)
	router.Handle("*", "/", spaHandler())

	// Middleware chain
	// Register audit callback for auth middleware (JWT failures, forbidden access)
	auditRepo := database.NewAuditLogRepo()
	web.SetAuthAuditFunc(func(action, result, detail, ip, username string, userID uint) {
		auditRepo.Create(&database.AuditLog{
			UserID:   userID,
			Username: username,
			Action:   action,
			Result:   result,
			Detail:   detail,
			IP:       ip,
		})
	})

	skipAuthPaths := []string{
		"/api/v1/auth/login",
		"/api/v1/auth/setup",
		"/api/v1/auth/needs-setup",
		"/api/v1/health",
		"/api/v1/ws",
	}

	rlCtx, rlCancel := context.WithCancel(context.Background())
	defer rlCancel()
	loginLimiter := web.NewRateLimiter(10, time.Minute, rlCtx)
	rateLimitPaths := []string{"/api/v1/auth/login", "/api/v1/auth/setup"}

	handler := web.Chain(
		router,
		web.RecoveryMiddleware,
		web.SecurityHeadersMiddleware,
		web.RequestIDMiddleware,
		web.RequestLogMiddleware,
		web.CORSMiddleware(cfg.Server.CORSOrigins),
		web.MaxBodySizeMiddleware(2<<20), // 2 MB
		web.RateLimitMiddleware(loginLimiter, rateLimitPaths),
		web.InputSanitizeMiddleware,
		web.AuthMiddleware(cfg.Auth.JWTSecret, skipAuthPaths),
	)

	// Warn if binding to non-loopback
	if cfg.Server.Bind != "127.0.0.1" && cfg.Server.Bind != "localhost" {
		logger.Log.Warn().
			Str("bind", cfg.Server.Bind).
			Msg(i18n.T(i18n.MsgLogBindNonLoopbackWarning))
	}

	// Acquire process lock to prevent duplicate instances
	plock, err := proclock.Acquire(webconfig.DataDir(), cfg.Server.Port)
	if err != nil {
		if errors.Is(err, proclock.ErrAlreadyRunning) {
			fmt.Fprintln(os.Stderr)
			fmt.Fprintln(os.Stderr, i18n.T(i18n.MsgServePortInUse, map[string]interface{}{"Port": cfg.Server.Port}))
			fmt.Fprintln(os.Stderr)
			fmt.Fprintln(os.Stderr, i18n.T(i18n.MsgServePortInUseSolutions))
			logger.Log.Error().Int("port", cfg.Server.Port).Msg(i18n.T(i18n.MsgLogPortInUse))
		} else {
			fmt.Fprintln(os.Stderr, i18n.T(i18n.MsgServePortInUse, map[string]interface{}{"Port": cfg.Server.Port}))
			logger.Log.Error().Err(err).Msg("failed to acquire process lock")
		}
		return 1
	}
	defer plock.Release()

	// Consume restart sentinel (if any) so the frontend can query the restart reason
	if info := sentinel.Consume(webconfig.DataDir()); info != nil {
		logger.Log.Info().
			Str("reason", info.Reason).
			Str("trigger", info.Trigger).
			Msg("restart sentinel consumed")
	}

	addr := cfg.ListenAddr()
	logger.Log.Info().Str("addr", addr).Msg(i18n.T(i18n.MsgLogWebServiceStarted))

	if conflict, detail := detectLoopbackRouteConflict(cfg.Server.Port); conflict {
		logger.Log.Warn().Str("detail", detail).Msg(i18n.T(i18n.MsgLogLoopbackConflict))
		fmt.Println("\n" + i18n.T(i18n.MsgServeLoopbackConflict, map[string]interface{}{"Detail": detail, "Port": cfg.Server.Port}))
	}

	const boxWidth = 60

	runeWidth := func(r rune) int {
		if r == '\u200d' || r == '\ufe0f' {
			return 0
		}
		if unicode.Is(unicode.Mn, r) || unicode.Is(unicode.Me, r) {
			return 0
		}
		if unicode.In(r, unicode.Han, unicode.Hangul, unicode.Hiragana, unicode.Katakana) {
			return 2
		}
		if r >= 0x1F000 {
			return 2
		}
		if r >= 0x2600 && r <= 0x27BF {
			return 2
		}
		if r >= 0xFF01 && r <= 0xFF60 {
			return 2
		}
		if r >= 0xFFE0 && r <= 0xFFE6 {
			return 2
		}
		return 1
	}

	displayWidth := func(content string) int {
		w := 0
		for _, r := range content {
			w += runeWidth(r)
		}
		return w
	}

	truncateToWidth := func(content string, maxWidth int) string {
		if displayWidth(content) <= maxWidth {
			return content
		}
		const ellipsis = "..."
		limit := maxWidth - len(ellipsis)
		if limit <= 0 {
			return ellipsis
		}
		w := 0
		var b strings.Builder
		for _, r := range content {
			rw := runeWidth(r)
			if w+rw > limit {
				break
			}
			b.WriteRune(r)
			w += rw
		}
		return b.String() + ellipsis
	}

	padLine := func(content string) string {
		content = truncateToWidth(content, boxWidth)
		padding := boxWidth - displayWidth(content)
		if padding < 0 {
			padding = 0
		}
		return content + strings.Repeat(" ", padding)
	}

	centerLine := func(content string) string {
		content = truncateToWidth(content, boxWidth)
		left := (boxWidth - displayWidth(content)) / 2
		if left < 0 {
			left = 0
		}
		return strings.Repeat(" ", left) + content
	}

	printLine := func(content string) {
		fmt.Printf("  |%s|\n", padLine(content))
	}

	// printLink prints a line containing a clickable URL using OSC 8 hyperlink escape sequences.
	// The display width calculation uses the visible text only (excluding escape sequences).
	printLink := func(prefix, url string) {
		visible := prefix + url
		visible = truncateToWidth(visible, boxWidth)
		padding := boxWidth - displayWidth(visible)
		if padding < 0 {
			padding = 0
		}
		fmt.Printf("  |%s\033]8;;%s\033\\%s\033]8;;\033\\%s|\n", prefix, url, url, strings.Repeat(" ", padding))
	}

	topBorder := "  +" + strings.Repeat("-", boxWidth) + "+"
	sectionBorder := "  +" + strings.Repeat("-", boxWidth) + "+"
	subSectionBorder := "  +" + strings.Repeat("-", boxWidth) + "+"
	bottomBorder := "  +" + strings.Repeat("-", boxWidth) + "+"

	printBi := func(key string, data ...map[string]interface{}) {
		printLine(i18n.TLang("en", key, data...))
		printLine(i18n.TLang("zh", key, data...))
	}

	fmt.Printf("\n%s\n", topBorder)
	logoPad := "  "
	printLine(logoPad + "CCCC  L      AAA   W   W DDDD  EEEE CCCC K  K  X   X")
	printLine(logoPad + "C     L     A   A  W   W D   D E    C    K K    X X")
	printLine(logoPad + "C     L     AAAAA  W W W D   D EEE  C    KK      X")
	printLine(logoPad + "C     L     A   A  WW WW D   D E    C    K K    X X")
	printLine(logoPad + "CCCC  LLLLL A   A  W   W DDDD  EEEE CCCC K  K  X   X")
	printLine("")
	printLine(centerLine(fmt.Sprintf("ClawDeckX Web %s", version.Version)))

	userRepo := database.NewUserRepo()
	userCount, _ := userRepo.Count()
	hasWarning := false
	var generatedUsername, generatedPassword string

	if userCount == 0 {
		generatedUsername = "admin"
		generatedPassword = generateRandomPassword(8)
		hash, err := bcrypt.GenerateFromPassword([]byte(generatedPassword), bcrypt.DefaultCost)
		if err == nil {
			if err := userRepo.Create(&database.User{
				Username:     generatedUsername,
				PasswordHash: string(hash),
				Role:         constants.RoleAdmin,
			}); err == nil {
				logger.Log.Info().Msg(i18n.T(i18n.MsgLogAdminAutoCreated))
			}
		}
	}

	if cfg.Server.Bind == "0.0.0.0" || cfg.Server.Bind == "" {
		fmt.Println(sectionBorder)
		printBi(i18n.MsgServeAccessWarning)
		printLine("")
		printBi(i18n.MsgServeBindAllWarning)
		printLine("")
		printBi(i18n.MsgServeChangeBindingHint)
		hasWarning = true
	}

	if generatedUsername != "" && generatedPassword != "" {
		if !hasWarning {
			fmt.Println(sectionBorder)
		} else {
			fmt.Println(subSectionBorder)
		}
		printBi(i18n.MsgServeFirstTimeSetup)
		printLine("")
		printBi(i18n.MsgServeUsernameLabel, map[string]interface{}{"Username": generatedUsername})
		printBi(i18n.MsgServePasswordLabel, map[string]interface{}{"Password": generatedPassword})
		printLine("")
		printBi(i18n.MsgServeChangePasswordWarning)
		printBi(i18n.MsgServeChangePasswordHint)
		hasWarning = true
	}

	if hasWarning {
		fmt.Println(sectionBorder)
	} else {
		fmt.Println(sectionBorder)
	}

	if cfg.Server.Bind == "0.0.0.0" || cfg.Server.Bind == "" {
		printBi(i18n.MsgServeAccessUrls)
		fmt.Println(subSectionBorder)
		printLink("-> ", fmt.Sprintf("http://localhost:%d", cfg.Server.Port))
		printLink("-> ", fmt.Sprintf("http://127.0.0.1:%d", cfg.Server.Port))

		if addrs, err := net.InterfaceAddrs(); err == nil {
			for _, a := range addrs {
				if ipnet, ok := a.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
					ip := ipnet.IP.String()
					printLink("-> ", fmt.Sprintf("http://%s:%d", ip, cfg.Server.Port))
				}
			}
		}

		if pubIP := getPublicIP(); pubIP != "" {
			printLink("-> ", fmt.Sprintf("http://%s:%d", pubIP, cfg.Server.Port))
		}

	} else {
		printLink("-> ", fmt.Sprintf("http://%s:%d", cfg.Server.Bind, cfg.Server.Port))
	}

	fmt.Printf("%s\n\n", bottomBorder)

	// Pre-flight: check if the port is actually available before starting.
	// This catches cases where proclock succeeded but another process holds the port.
	// biPrint prints both English and Chinese lines for a given i18n key.
	biPrint := func(key string, data ...map[string]interface{}) {
		fmt.Fprintln(os.Stderr, i18n.TLang("en", key, data...))
		fmt.Fprintln(os.Stderr, i18n.TLang("zh", key, data...))
	}

	if ln, err := net.Listen("tcp", addr); err != nil {
		fmt.Fprintln(os.Stderr)
		portData := map[string]interface{}{"Port": cfg.Server.Port}
		fmt.Fprintf(os.Stderr, "❌ %s\n", i18n.TLang("en", i18n.MsgServePortInUse, portData))
		fmt.Fprintf(os.Stderr, "   %s\n", i18n.TLang("zh", i18n.MsgServePortInUse, portData))
		fmt.Fprintf(os.Stderr, "   %s\n", err.Error())
		fmt.Fprintln(os.Stderr)

		// Try to find which process occupies the port
		if info := proclock.FindPortProcess(cfg.Server.Port); info != nil {
			procDesc := fmt.Sprintf("PID=%d", info.PID)
			if info.Name != "" {
				procDesc = fmt.Sprintf("%s (%s)", info.Name, procDesc)
			}
			procData := map[string]interface{}{"Process": procDesc}
			fmt.Fprintf(os.Stderr, "   %s\n", i18n.TLang("en", i18n.MsgServePortOccupiedBy, procData))
			fmt.Fprintf(os.Stderr, "   %s\n\n", i18n.TLang("zh", i18n.MsgServePortOccupiedBy, procData))

			// Only offer to kill if the blocking process is another ClawDeckX instance.
			// Never kill unrelated processes (e.g. openclaw gateway).
			isSelf := strings.Contains(strings.ToLower(info.Name), "clawdeckx")
			if isSelf {
				// Interactive: ask user whether to kill
				// Use ReadLineFromTTY to read from /dev/tty (Unix) or CON (Windows),
				// because stdin may be a pipe when launched via `curl ... | bash`.
				fmt.Fprintf(os.Stderr, "   %s\n", i18n.TLang("en", i18n.MsgServeKillProcessPrompt))
				fmt.Fprintf(os.Stderr, "   %s [y/N] ", i18n.TLang("zh", i18n.MsgServeKillProcessPrompt))
				answer, ttyErr := proclock.ReadLineFromTTY()
				if ttyErr != nil {
					biPrint(i18n.MsgServePortInUseSolutions)
					return 1
				}
				answer = strings.TrimSpace(strings.ToLower(answer))

				if answer == "y" || answer == "yes" {
					if err := proclock.KillProcess(info.PID); err != nil {
						fmt.Fprintf(os.Stderr, "   ❌ %s: %s\n", i18n.TLang("en", i18n.MsgServeKillProcessFailed), err.Error())
						fmt.Fprintf(os.Stderr, "      %s\n", i18n.TLang("zh", i18n.MsgServeKillProcessFailed))
						return 1
					}
					fmt.Fprintf(os.Stderr, "   ✅ %s (PID %d)\n", i18n.TLang("en", i18n.MsgServeKillProcessOk), info.PID)
					fmt.Fprintf(os.Stderr, "      %s\n", i18n.TLang("zh", i18n.MsgServeKillProcessOk))

					// Wait for port to become available
					portReady := false
					for j := 0; j < 20; j++ {
						time.Sleep(250 * time.Millisecond)
						if ln2, err2 := net.Listen("tcp", addr); err2 == nil {
							ln2.Close()
							portReady = true
							break
						}
					}
					if !portReady {
						fmt.Fprintf(os.Stderr, "   ❌ %s\n", i18n.TLang("en", i18n.MsgServePortStillInUse))
						fmt.Fprintf(os.Stderr, "      %s\n", i18n.TLang("zh", i18n.MsgServePortStillInUse))
						return 1
					}
					fmt.Fprintln(os.Stderr)
				} else {
					biPrint(i18n.MsgServePortInUseSolutions)
					return 1
				}
			} else {
				// Not a ClawDeckX process — do not offer to kill, just show solutions
				biPrint(i18n.MsgServePortInUseSolutions)
				return 1
			}
		} else {
			biPrint(i18n.MsgServePortInUseSolutions)
			logger.Log.Error().Err(err).Int("port", cfg.Server.Port).Msg(i18n.T(i18n.MsgLogServiceStartFailed))
			return 1
		}
	} else {
		ln.Close()
	}

	// Graceful shutdown
	srv := &http.Server{Addr: addr, Handler: handler}

	// gracefulShutdown drains in-flight requests with a 10s deadline,
	// then falls back to hard close.
	gracefulShutdown := func(reason string) {
		logger.Log.Info().Str("reason", reason).Msg(i18n.T(i18n.MsgLogShuttingDown))
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			logger.Log.Warn().Err(err).Msg("graceful shutdown timed out, forcing close")
			srv.Close()
		}
	}

	// Signal handler goroutine
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "\n❌ %s: %s\n", i18n.T(i18n.MsgLogServiceStartFailed), err.Error())
			logger.Log.Fatal().Err(err).Msg(i18n.T(i18n.MsgLogServiceStartFailed))
		}
	}()

	if tray.HasGUI() {
		tray.Run(addr, func() {
			gracefulShutdown("tray_exit")
		})
	} else {
		<-sigCh
		gracefulShutdown("signal")
	}

	logger.Log.Info().Msg(i18n.T(i18n.MsgLogServiceStopped))
	return 0
}

func serveIndex(w http.ResponseWriter, fsys fs.FS) {
	data, err := fs.ReadFile(fsys, "index.html")
	if err != nil {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, i18n.T(i18n.MsgServeHtmlIndexNotFound))
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(data)
}

func spaHandler() http.HandlerFunc {
	fsys, err := fs.Sub(web.StaticFS, "dist")
	if err != nil {
		logger.Log.Error().Err(err).Msg(i18n.T(i18n.MsgLogStaticLoadFailed))
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, i18n.T(i18n.MsgServeHtmlFrontendLoadFailed))
		}
	}
	fileServer := http.FileServer(http.FS(fsys))

	return func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")

		if path == "" || path == "/" {
			serveIndex(w, fsys)
			return
		}

		f, err := fsys.Open(path)
		if err == nil {
			stat, _ := f.Stat()
			f.Close()
			if stat != nil && !stat.IsDir() {
				ext := strings.ToLower(filepath.Ext(path))
				switch ext {
				case ".html":
					w.Header().Set("Content-Type", "text/html; charset=utf-8")
				case ".css":
					w.Header().Set("Content-Type", "text/css; charset=utf-8")
				case ".js":
					w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
				case ".json":
					w.Header().Set("Content-Type", "application/json; charset=utf-8")
				}
				fileServer.ServeHTTP(w, r)
				return
			}
		}

		serveIndex(w, fsys)
	}
}

func readOpenClawGatewayToken(configPath string) string {
	token := tryReadTokenFromPath(configPath)
	if token != "" {
		return token
	}
	home, err := os.UserHomeDir()
	if err != nil {
		logger.Log.Debug().Err(err).Msg(i18n.T(i18n.MsgLogCannotGetHomeDir))
		return ""
	}
	fallback := filepath.Join(home, ".openclaw")
	if fallback != configPath {
		logger.Log.Debug().Str("fallback", fallback).Msg(i18n.T(i18n.MsgLogFallbackOpenclawPath))
		return tryReadTokenFromPath(fallback)
	}
	return ""
}

func tryReadTokenFromPath(configPath string) string {
	if configPath == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		configPath = filepath.Join(home, ".openclaw")
	}
	info, err := os.Stat(configPath)
	if err != nil {
		logger.Log.Debug().Str("configPath", configPath).Err(err).Msg(i18n.T(i18n.MsgLogPathNotExist))
		return ""
	}
	if info.IsDir() {
		configPath = filepath.Join(configPath, "openclaw.json")
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		logger.Log.Debug().Str("configPath", configPath).Err(err).Msg(i18n.T(i18n.MsgLogCannotReadFile))
		return ""
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		logger.Log.Debug().Str("configPath", configPath).Err(err).Msg(i18n.T(i18n.MsgLogJsonParseFailed))
		return ""
	}
	gw, ok := raw["gateway"].(map[string]interface{})
	if !ok {
		logger.Log.Debug().Str("configPath", configPath).Msg(i18n.T(i18n.MsgLogMissingGatewayField))
		return ""
	}
	auth, ok := gw["auth"].(map[string]interface{})
	if !ok {
		logger.Log.Debug().Str("configPath", configPath).Msg(i18n.T(i18n.MsgLogMissingAuthField))
		return ""
	}
	token, ok := auth["token"].(string)
	if !ok || token == "" {
		logger.Log.Debug().Str("configPath", configPath).Msg(i18n.T(i18n.MsgLogTokenEmpty))
		return ""
	}
	logger.Log.Debug().Str("configPath", configPath).Int("tokenLen", len(token)).Msg(i18n.T(i18n.MsgLogTokenReadSuccess))
	return token
}

func generateRandomUsername() string {
	prefixes := []string{"user", "admin", "claw", "deck", "mgr"}
	randomBytes := make([]byte, 4)
	if _, err := rand.Read(randomBytes); err != nil {
		return fmt.Sprintf("user%d", time.Now().UnixNano()%10000)
	}
	prefix := prefixes[int(randomBytes[0])%len(prefixes)]
	suffix := fmt.Sprintf("%d%d%d", randomBytes[1]%10, randomBytes[2]%10, randomBytes[3]%10)
	return prefix + suffix
}

func generateRandomPassword(length int) string {
	const charset = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, length)
	randomBytes := make([]byte, length)
	if _, err := rand.Read(randomBytes); err != nil {
		for i := range b {
			b[i] = charset[time.Now().UnixNano()%int64(len(charset))]
			time.Sleep(time.Nanosecond)
		}
		return string(b)
	}
	for i := range b {
		b[i] = charset[int(randomBytes[i])%len(charset)]
	}
	return string(b)
}

func getPublicIP() string {
	apis := []string{
		"https://api.ipify.org",
		"https://ifconfig.me/ip",
		"https://icanhazip.com",
	}

	client := &http.Client{Timeout: 2 * time.Second}

	for _, api := range apis {
		resp, err := client.Get(api)
		if err != nil {
			continue
		}

		var ip string
		if resp.StatusCode == http.StatusOK {
			body := make([]byte, 64)
			n, _ := resp.Body.Read(body)
			ip = strings.TrimSpace(string(body[:n]))
		}
		resp.Body.Close()

		if ip != "" && net.ParseIP(ip) != nil {
			return ip
		}
	}
	return ""
}

// detectLoopbackRouteConflict checks if localhost and 127.0.0.1 route to different services.
// Returns true when localhost works as ClawDeckX but 127.0.0.1 is not ClawDeckX.
func detectLoopbackRouteConflict(port int) (bool, string) {
	client := &http.Client{Timeout: 1200 * time.Millisecond}

	check := func(host string) (bool, int, string) {
		url := fmt.Sprintf("http://%s:%d/api/v1/health", host, port)
		resp, err := client.Get(url)
		if err != nil {
			return false, 0, err.Error()
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		ok := resp.StatusCode == http.StatusOK &&
			strings.Contains(string(body), `"success":true`) &&
			strings.Contains(string(body), `"status":"ok"`)
		return ok, resp.StatusCode, string(body)
	}

	localOK, _, _ := check("localhost")
	if !localOK {
		return false, ""
	}

	ipOK, ipCode, ipBody := check("127.0.0.1")
	if ipOK {
		return false, ""
	}
	if ipCode == http.StatusUnauthorized {
		return true, i18n.T(i18n.MsgServePortConflict401, map[string]interface{}{"Port": port})
	}
	if ipCode != 0 {
		return true, i18n.T(i18n.MsgServePortConflictHttp, map[string]interface{}{"Port": port, "Code": ipCode, "Body": ipBody})
	}
	return true, i18n.T(i18n.MsgServePortConflictRequestFailed, map[string]interface{}{"Port": port, "Error": ipBody})
}
