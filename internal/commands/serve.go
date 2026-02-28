package commands

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
	"ClawDeckX/internal/handlers"
	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/monitor"
	"ClawDeckX/internal/notify"
	"ClawDeckX/internal/openclaw"
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
		fmt.Fprintf(os.Stderr, "配置加载失败: %v\n", err)
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

	// 如果用户通过 --port 指定了端口，保存到配置文件
	if portOverride {
		if err := webconfig.Save(cfg); err != nil {
			fmt.Fprintf(os.Stderr, "⚠️  保存配置文件失败: %v\n", err)
		} else {
			fmt.Printf("✓ 端口 %d 已保存到配置文件，下次启动将自动使用\n", cfg.Server.Port)
		}
	}

	// Init logger
	logger.Init(cfg.Log)
	logger.Log.Info().Str("version", "0.1.0").Msg(i18n.T(i18n.MsgLogServeStarting))

	// Init database
	if err := database.Init(cfg.Database, cfg.IsDebug()); err != nil {
		logger.Log.Fatal().Err(err).Msg(i18n.T(i18n.MsgLogDbInitFailed))
		return 1
	}
	defer database.Close()

	// 如果指定了 --user 和 --password，创建初始管理员用户
	if initUser != "" && initPass != "" {
		userRepo := database.NewUserRepo()
		count, _ := userRepo.Count()
		if count == 0 {
			if len(initPass) < 6 {
				fmt.Fprintf(os.Stderr, "⚠️  密码至少 6 位\n")
				return 1
			}
			hash, err := bcrypt.GenerateFromPassword([]byte(initPass), bcrypt.DefaultCost)
			if err != nil {
				fmt.Fprintf(os.Stderr, "⚠️  密码加密失败: %v\n", err)
				return 1
			}
			if err := userRepo.Create(&database.User{
				Username:     initUser,
				PasswordHash: string(hash),
				Role:         constants.RoleAdmin,
			}); err != nil {
				fmt.Fprintf(os.Stderr, "⚠️  创建初始用户失败: %v\n", err)
				return 1
			}
			fmt.Printf("✓ 初始管理员用户 '%s' 已创建\n", initUser)
		} else {
			fmt.Printf("ℹ️  已存在 %d 个用户，跳过初始用户创建\n", count)
		}
	}

	// Init WebSocket Hub (pass CORS origins for Origin validation)
	wsHub := web.NewWSHub(cfg.Server.CORSOrigins)
	go wsHub.Run()

	// 优先从数据库读取已激活的网关配置档案，覆盖默认配置
	gwHost := cfg.OpenClaw.GatewayHost
	gwPort := cfg.OpenClaw.GatewayPort
	gwToken := cfg.OpenClaw.GatewayToken
	{
		profileRepo := database.NewGatewayProfileRepo()
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

	// 如果 token 仍为空，尝试从 openclaw.json 读取 gateway.auth.token
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

	// 初始化 OpenClaw 服务
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

	// 初始化 Gateway WebSocket 客户端（连接远程 Gateway 的 WS JSON-RPC）
	gwClient := openclaw.NewGWClient(openclaw.GWClientConfig{
		Host:  gwHost,
		Port:  gwPort,
		Token: gwToken,
	})
	// 注入 GWClient 到 Service（远程模式下通过 JSON-RPC 控制网关）
	svc.SetGWClient(gwClient)
	gwClient.SetRestartCallback(func() error {
		return svc.Restart()
	})
	// 从数据库读取心跳自动重启设置（默认启用）
	{
		settingRepo := database.NewSettingRepo()
		v, _ := settingRepo.Get("gateway_health_check_enabled")
		// 默认启用：只有明确设为 "false" 时才禁用
		if v != "false" {
			gwClient.SetHealthCheckEnabled(true)
		}
	}
	gwClient.Start()
	defer gwClient.Stop()

	// 初始化通知管理器
	notifyMgr := notify.NewManager()
	{
		settingRepo := database.NewSettingRepo()
		// 尝试从 Gateway 获取频道配置以复用 token
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
	// 注入通知回调到 GWClient
	gwClient.SetNotifyCallback(func(msg string) {
		notifyMgr.Send(msg)
	})

	// GW 事件采集器（转发 Gateway 实时事件到前端 WebSocket）
	gwCollector := monitor.NewGWCollector(gwClient, wsHub, cfg.Monitor.IntervalSeconds)
	go gwCollector.Start()
	defer gwCollector.Stop()

	// 本地文件扫描监控（不自动启动）
	monSvc := monitor.NewService(cfg.OpenClaw.ConfigPath, wsHub, cfg.Monitor.IntervalSeconds)

	// 初始化处理器
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
	backupHandler := handlers.NewBackupHandler()
	doctorHandler := handlers.NewDoctorHandler(svc)
	exportHandler := handlers.NewExportHandler()
	userHandler := handlers.NewUserHandler()
	skillsHandler := handlers.NewSkillsHandler()
	skillTransHandler := handlers.NewSkillTranslationHandler()
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
	serverConfigHandler := handlers.NewServerConfigHandler()
	badgeHandler := handlers.NewBadgeHandler()

	// 构建路由
	router := web.NewRouter()

	// 鉴权路由（无需登录）
	router.GET("/api/v1/auth/needs-setup", authHandler.NeedsSetup)
	router.POST("/api/v1/auth/setup", authHandler.Setup)
	router.POST("/api/v1/auth/login", authHandler.Login)
	router.POST("/api/v1/auth/logout", authHandler.Logout)

	// 鉴权路由（需登录）
	router.GET("/api/v1/auth/me", authHandler.Me)
	router.PUT("/api/v1/auth/password", authHandler.ChangePassword)
	router.PUT("/api/v1/auth/username", authHandler.ChangeUsername)

	// 总览
	router.GET("/api/v1/dashboard", dashboardHandler.Get)
	router.GET("/api/v1/host-info", hostInfoHandler.Get)
	router.GET("/api/v1/host-info/check-update", hostInfoHandler.CheckUpdate)

	// 自更新
	router.GET("/api/v1/self-update/info", selfUpdateHandler.Info)
	router.GET("/api/v1/self-update/check", selfUpdateHandler.Check)
	router.POST("/api/v1/self-update/apply", web.RequireAdmin(selfUpdateHandler.Apply))

	// 服务器访问配置
	router.GET("/api/v1/server-config", serverConfigHandler.Get)
	router.PUT("/api/v1/server-config", web.RequireAdmin(serverConfigHandler.Update))

	// 网关管理
	router.GET("/api/v1/gateway/status", gatewayHandler.Status)
	router.POST("/api/v1/gateway/start", web.RequireAdmin(gatewayHandler.Start))
	router.POST("/api/v1/gateway/stop", web.RequireAdmin(gatewayHandler.Stop))
	router.POST("/api/v1/gateway/restart", web.RequireAdmin(gatewayHandler.Restart))
	router.POST("/api/v1/gateway/kill", web.RequireAdmin(gatewayHandler.Kill))

	// 活动流
	router.GET("/api/v1/activities", activityHandler.List)
	router.GET("/api/v1/activities/", activityHandler.GetByID)
	router.GET("/api/v1/events", eventsHandler.List)

	// 监控统计
	router.GET("/api/v1/monitor/stats", monitorHandler.Stats)

	// 安全策略（已禁用：仅审计，无实际拦截能力）

	// 系统设置
	router.GET("/api/v1/settings", settingsHandler.GetAll)
	router.PUT("/api/v1/settings", web.RequireAdmin(settingsHandler.Update))
	router.GET("/api/v1/settings/language", settingsHandler.GetLanguage)
	router.PUT("/api/v1/settings/language", settingsHandler.SetLanguage)
	router.GET("/api/v1/settings/gateway", settingsHandler.GetGatewayConfig)
	router.PUT("/api/v1/settings/gateway", web.RequireAdmin(settingsHandler.UpdateGatewayConfig))

	// 告警
	router.GET("/api/v1/alerts", alertHandler.List)
	router.POST("/api/v1/alerts/read-all", alertHandler.MarkAllNotified)
	router.POST("/api/v1/alerts/", alertHandler.MarkNotified)

	// 通知配置
	router.GET("/api/v1/notify/config", notifyHandler.GetConfig)
	router.PUT("/api/v1/notify/config", web.RequireAdmin(notifyHandler.UpdateConfig))
	router.POST("/api/v1/notify/test", web.RequireAdmin(notifyHandler.TestSend))

	// 审计日志
	router.GET("/api/v1/audit-logs", auditHandler.List)

	// OpenClaw 配置
	router.GET("/api/v1/config", configHandler.Get)
	router.PUT("/api/v1/config", web.RequireAdmin(configHandler.Update))
	router.POST("/api/v1/config/generate-default", web.RequireAdmin(configHandler.GenerateDefault))
	router.POST("/api/v1/config/set-key", web.RequireAdmin(configHandler.SetKey))
	router.POST("/api/v1/config/unset-key", web.RequireAdmin(configHandler.UnsetKey))
	router.GET("/api/v1/config/get-key", configHandler.GetKey)

	// 备份管理
	router.GET("/api/v1/backups", backupHandler.List)
	router.POST("/api/v1/backups", backupHandler.Create)
	router.POST("/api/v1/backups/", web.RequireAdmin(backupHandler.Restore))
	router.DELETE("/api/v1/backups/", web.RequireAdmin(backupHandler.Delete))
	router.GET("/api/v1/backups/", backupHandler.Download)

	// 诊断修复
	router.GET("/api/v1/doctor", doctorHandler.Run)
	router.GET("/api/v1/doctor/overview", doctorHandler.Overview)
	router.POST("/api/v1/doctor/fix", doctorHandler.Fix)

	// 用户管理
	router.GET("/api/v1/users", userHandler.List)
	router.POST("/api/v1/users", web.RequireAdmin(userHandler.Create))
	router.DELETE("/api/v1/users/", web.RequireAdmin(userHandler.Delete))

	// 技能审计
	router.GET("/api/v1/skills", skillsHandler.List)
	router.GET("/api/v1/skills/translations", skillTransHandler.Get)
	router.POST("/api/v1/skills/translations", skillTransHandler.Translate)

	// OpenClaw 安装向导
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

	// 模型/频道配置向导
	wizardHandler := handlers.NewWizardHandler()
	router.POST("/api/v1/setup/test-model", wizardHandler.TestModel)
	router.POST("/api/v1/setup/discover-models", wizardHandler.DiscoverModels)
	router.POST("/api/v1/setup/test-channel", wizardHandler.TestChannel)
	router.POST("/api/v1/config/model-wizard", wizardHandler.SaveModel)
	router.POST("/api/v1/config/channel-wizard", wizardHandler.SaveChannel)

	// 配对管理
	router.GET("/api/v1/pairing/list", wizardHandler.ListPairingRequests)
	router.POST("/api/v1/pairing/approve", wizardHandler.ApprovePairingRequest)

	// 监控配置
	router.GET("/api/v1/monitor/config", monConfigHandler.GetConfig)
	router.PUT("/api/v1/monitor/config", monConfigHandler.UpdateConfig)
	router.POST("/api/v1/monitor/start", monConfigHandler.StartMonitor)
	router.POST("/api/v1/monitor/stop", monConfigHandler.StopMonitor)

	// Gateway 日志
	router.GET("/api/v1/gateway/log", gwLogHandler.GetLog)

	// 网关心跳健康检查
	router.GET("/api/v1/gateway/health-check", gatewayHandler.GetHealthCheck)
	router.PUT("/api/v1/gateway/health-check", gatewayHandler.SetHealthCheck)

	// 网关诊断
	router.POST("/api/v1/gateway/diagnose", gwDiagnoseHandler.Diagnose)

	// 网关配置档案（多网关管理）
	router.GET("/api/v1/gateway/profiles", gwProfileHandler.List)
	router.POST("/api/v1/gateway/profiles", gwProfileHandler.Create)
	router.PUT("/api/v1/gateway/profiles", gwProfileHandler.Update)
	router.DELETE("/api/v1/gateway/profiles", gwProfileHandler.Delete)
	router.POST("/api/v1/gateway/profiles/activate", gwProfileHandler.Activate)

	// Gateway 代理 API（通过 WS JSON-RPC 连接远程 Gateway）
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

	// 模板管理
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

	// ClawHub 技能市场
	clawHubHandler := handlers.NewClawHubHandler(gwClient)
	router.GET("/api/v1/clawhub/list", clawHubHandler.List)
	router.GET("/api/v1/clawhub/search", clawHubHandler.Search)
	router.GET("/api/v1/clawhub/skill", clawHubHandler.SkillDetail)
	router.POST("/api/v1/clawhub/install", clawHubHandler.Install)
	router.POST("/api/v1/clawhub/install-stream", clawHubHandler.InstallStreamSSE)
	router.POST("/api/v1/clawhub/uninstall", clawHubHandler.Uninstall)
	router.POST("/api/v1/clawhub/update", clawHubHandler.Update)
	router.GET("/api/v1/clawhub/installed", clawHubHandler.InstalledList)

	// 插件安装（本地网关）
	pluginInstallHandler := handlers.NewPluginInstallHandler(gwClient)
	router.GET("/api/v1/plugins/can-install", pluginInstallHandler.CanInstall)
	router.GET("/api/v1/plugins/check", pluginInstallHandler.CheckInstalled)
	router.POST("/api/v1/plugins/install", pluginInstallHandler.Install)

	// 数据导出
	router.GET("/api/v1/export/activities", exportHandler.ExportActivities)
	router.GET("/api/v1/export/alerts", exportHandler.ExportAlerts)
	router.GET("/api/v1/export/audit-logs", exportHandler.ExportAuditLogs)

	// 角标计数
	router.GET("/api/v1/badges", badgeHandler.Counts)

	// WebSocket
	router.GET("/api/v1/ws", wsHub.HandleWS(cfg.Auth.JWTSecret))

	// 健康检查
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

	// 登录接口限流：每 IP 每分钟最多 10 次
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

	// 检测端口是否被占用
	testAddr := fmt.Sprintf("%s:%d", cfg.Server.Bind, cfg.Server.Port)
	ln, err := net.Listen("tcp", testAddr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n❌ 端口 %d 已被占用，无法启动服务\n\n", cfg.Server.Port)
		fmt.Fprintf(os.Stderr, "解决方案：\n")
		fmt.Fprintf(os.Stderr, "  1. 关闭占用该端口的程序\n")
		fmt.Fprintf(os.Stderr, "  2. 使用 --port 参数指定其他端口：./ClawDeckX serve --port 18792\n")
		fmt.Fprintf(os.Stderr, "     (端口号会自动保存到配置文件，下次启动无需再次指定)\n\n")
		logger.Log.Error().Int("port", cfg.Server.Port).Err(err).Msg(i18n.T(i18n.MsgLogPortInUse))
		return 1
	}
	ln.Close()

	addr := cfg.ListenAddr()
	logger.Log.Info().Str("addr", addr).Msg(i18n.T(i18n.MsgLogWebServiceStarted))

	// 启动后快速自检：检测 127.0.0.1 是否被其他进程占用并劫持到非 ClawDeckX 服务
	if conflict, detail := detectLoopbackRouteConflict(cfg.Server.Port); conflict {
		logger.Log.Warn().Str("detail", detail).Msg(i18n.T(i18n.MsgLogLoopbackConflict))
		fmt.Printf("\n⚠️  检测到回环地址冲突: %s\n", detail)
		fmt.Printf("   建议使用: http://localhost:%d/\n", cfg.Server.Port)
	}

	// 显示所有可访问的 URL
	const boxWidth = 60 // 内容区域宽度（不含边框字符）

	// 辅助函数：生成右对齐的行
	padLine := func(content string) string {
		// 计算实际显示宽度（考虑中文字符占2个宽度）
		displayWidth := 0
		for _, r := range content {
			if r > 127 {
				displayWidth += 2
			} else {
				displayWidth++
			}
		}
		padding := boxWidth - displayWidth
		if padding < 0 {
			padding = 0
		}
		return content + strings.Repeat(" ", padding)
	}

	fmt.Printf("\n  ╔════════════════════════════════════════════════════════════╗\n")
	fmt.Printf("  ║  %s║\n", padLine(fmt.Sprintf("ClawDeckX Web %s", version.Version)))

	// 检查是否需要显示安全警告
	userRepo := database.NewUserRepo()
	userCount, _ := userRepo.Count()
	hasWarning := false
	var generatedUsername, generatedPassword string

	// 首次启动：自动创建默认管理员用户
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

	// 警告1：绑定 0.0.0.0 有访问风险
	if cfg.Server.Bind == "0.0.0.0" || cfg.Server.Bind == "" {
		fmt.Printf("  ╠════════════════════════════════════════════════════════════╣\n")
		fmt.Printf("  ║  %s║\n", padLine(i18n.T(i18n.MsgServeAccessWarning)))
		fmt.Printf("  ║  %s║\n", padLine(i18n.T(i18n.MsgServeBindAllWarning)))
		fmt.Printf("  ║  %s║\n", padLine(""))
		fmt.Printf("  ║  %s║\n", padLine(i18n.T(i18n.MsgServeChangeBindingHint)))
		hasWarning = true
	}

	// 首次启动：显示自动生成的凭据
	if generatedUsername != "" && generatedPassword != "" {
		if !hasWarning {
			fmt.Printf("  ╠════════════════════════════════════════════════════════════╣\n")
		} else {
			fmt.Printf("  ╟────────────────────────────────────────────────────────────╢\n")
		}
		fmt.Printf("  ║  %s║\n", padLine(i18n.T(i18n.MsgServeFirstTimeSetup)))
		fmt.Printf("  ║  %s║\n", padLine(""))
		fmt.Printf("  ║  %s║\n", padLine(i18n.T(i18n.MsgServeUsernameLabel, map[string]interface{}{"Username": generatedUsername})))
		fmt.Printf("  ║  %s║\n", padLine(i18n.T(i18n.MsgServePasswordLabel, map[string]interface{}{"Password": generatedPassword})))
		fmt.Printf("  ║  %s║\n", padLine(""))
		fmt.Printf("  ║  %s║\n", padLine(i18n.T(i18n.MsgServeChangePasswordWarning)))
		fmt.Printf("  ║  %s║\n", padLine(i18n.T(i18n.MsgServeChangePasswordHint)))
		hasWarning = true
	}

	// 访问地址放在最后，方便用户复制
	if hasWarning {
		fmt.Printf("  ╠════════════════════════════════════════════════════════════╣\n")
	} else {
		fmt.Printf("  ╠════════════════════════════════════════════════════════════╣\n")
	}

	if cfg.Server.Bind == "0.0.0.0" || cfg.Server.Bind == "" {
		// 绑定所有接口，显示所有本机 IP
		fmt.Printf("  ║  %s║\n", padLine(i18n.T(i18n.MsgServeAccessUrls)))
		fmt.Printf("  ╟────────────────────────────────────────────────────────────╢\n")
		fmt.Printf("  ║  %s║\n", padLine(fmt.Sprintf("➜ http://localhost:%d", cfg.Server.Port)))
		fmt.Printf("  ║  %s║\n", padLine(fmt.Sprintf("➜ http://127.0.0.1:%d", cfg.Server.Port)))

		// 获取所有本机 IP
		if addrs, err := net.InterfaceAddrs(); err == nil {
			for _, a := range addrs {
				if ipnet, ok := a.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
					ip := ipnet.IP.String()
					fmt.Printf("  ║  %s║\n", padLine(fmt.Sprintf("➜ http://%s:%d", ip, cfg.Server.Port)))
				}
			}
		}

		// 启动阶段不再同步查询公网 IP，避免外网超时导致首次界面显示变慢
	} else {
		// 绑定特定地址
		fmt.Printf("  ║  %s║\n", padLine(fmt.Sprintf("➜ http://%s:%d", cfg.Server.Bind, cfg.Server.Port)))
	}

	fmt.Printf("  ╚════════════════════════════════════════════════════════════╝\n\n")

	// Graceful shutdown
	srv := &http.Server{Addr: addr, Handler: handler}

	// 信号处理（Ctrl+C / kill）
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		logger.Log.Info().Msg(i18n.T(i18n.MsgLogShuttingDown))
		srv.Close()
	}()

	// 启动 HTTP 服务
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Log.Fatal().Err(err).Msg(i18n.T(i18n.MsgLogServiceStartFailed))
		}
	}()

	// GUI 模式：显示系统托盘图标 + 自动打开浏览器
	if tray.HasGUI() {
		tray.Run(addr, func() {
			logger.Log.Info().Msg(i18n.T(i18n.MsgLogUserExitTray))
			srv.Close()
		})
	} else {
		// 终端模式：阻塞等待服务关闭
		done := make(chan struct{})
		go func() {
			sigCh := make(chan os.Signal, 1)
			signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
			<-sigCh
			close(done)
		}()
		<-done
	}

	logger.Log.Info().Msg(i18n.T(i18n.MsgLogServiceStopped))
	return 0
}

func serveIndex(w http.ResponseWriter, fsys fs.FS) {
	data, err := fs.ReadFile(fsys, "index.html")
	if err != nil {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, `<!DOCTYPE html><html><body><h1>ClawDeckX</h1><p>index.html 未找到</p></body></html>`)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(data)
}

func spaHandler() http.HandlerFunc {
	// 使用 embed.FS 提供静态文件，SPA 路由回退到 index.html
	fsys, err := fs.Sub(web.StaticFS, "dist")
	if err != nil {
		logger.Log.Error().Err(err).Msg(i18n.T(i18n.MsgLogStaticLoadFailed))
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, `<!DOCTYPE html><html><body><h1>ClawDeckX</h1><p>前端资源加载失败</p></body></html>`)
		}
	}
	fileServer := http.FileServer(http.FS(fsys))

	return func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")

		// 空路径或根路径直接返回 index.html
		if path == "" || path == "/" {
			serveIndex(w, fsys)
			return
		}

		// 尝试打开文件
		f, err := fsys.Open(path)
		if err == nil {
			stat, _ := f.Stat()
			f.Close()
			// 如果是文件（非目录），使用文件服务器
			if stat != nil && !stat.IsDir() {
				// 强制设置 charset=utf-8，防止 Windows 下浏览器误识别为 GBK
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

		// SPA 回退：返回 index.html
		serveIndex(w, fsys)
	}
}

// readOpenClawGatewayToken 从 openclaw.json 读取 gateway.auth.token
// configPath 应指向 OpenClaw 网关配置目录（~/.openclaw）或文件（~/.openclaw/openclaw.json）
// 注意：不要与 ClawDeckX 数据目录（<exe>/data）混淆
func readOpenClawGatewayToken(configPath string) string {
	token := tryReadTokenFromPath(configPath)
	if token != "" {
		return token
	}
	// 回退：无论传入什么路径，都尝试标准路径 ~/.openclaw/openclaw.json
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

// tryReadTokenFromPath 尝试从指定路径读取 gateway.auth.token
func tryReadTokenFromPath(configPath string) string {
	if configPath == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		configPath = filepath.Join(home, ".openclaw")
	}
	// configPath 可能是目录（~/.openclaw）或文件（~/.openclaw/openclaw.json）
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

// generateRandomUsername 生成随机用户名
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

// generateRandomPassword 生成指定长度的随机密码
func generateRandomPassword(length int) string {
	const charset = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, length)
	randomBytes := make([]byte, length)
	if _, err := rand.Read(randomBytes); err != nil {
		// 降级使用时间戳
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

// getPublicIP 尝试获取公网 IP 地址
func getPublicIP() string {
	// 使用多个公共 API 尝试获取公网 IP
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
		defer resp.Body.Close()

		if resp.StatusCode == http.StatusOK {
			body := make([]byte, 64)
			n, _ := resp.Body.Read(body)
			ip := strings.TrimSpace(string(body[:n]))
			// 验证是否为有效 IP
			if net.ParseIP(ip) != nil {
				return ip
			}
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
		// 若 localhost 本身就不可用，不判定为“127 冲突”，避免误报
		return false, ""
	}

	ipOK, ipCode, ipBody := check("127.0.0.1")
	if ipOK {
		return false, ""
	}
	if ipCode == http.StatusUnauthorized {
		return true, fmt.Sprintf("127.0.0.1:%d 返回 401 Unauthorized（可能命中 Gateway 而非 ClawDeckX）", port)
	}
	if ipCode != 0 {
		return true, fmt.Sprintf("127.0.0.1:%d 返回 HTTP %d（响应片段: %.120s）", port, ipCode, ipBody)
	}
	return true, fmt.Sprintf("127.0.0.1:%d 请求失败（%s）", port, ipBody)
}
