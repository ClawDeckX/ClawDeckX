package i18n

// Message key constants to avoid hardcoded strings.
// Use these constants with T() or TLang() functions.

// Gateway messages
const (
	MsgGatewayStarting     = "gateway.starting"
	MsgGatewayStarted      = "gateway.started"
	MsgGatewayStartFailed  = "gateway.start_failed"
	MsgGatewayStopping     = "gateway.stopping"
	MsgGatewayStopped      = "gateway.stopped"
	MsgGatewayStopFailed   = "gateway.stop_failed"
	MsgGatewayRestarting   = "gateway.restarting"
	MsgGatewayRestarted    = "gateway.restarted"
	MsgGatewayNotRunning   = "gateway.not_running"
	MsgGatewayNotConnected = "gateway.not_connected"
	MsgGatewayKillSwitch   = "gateway.kill_switch"
)

// Channel messages
const (
	MsgChannelConnected     = "channel.connected"
	MsgChannelDisconnected  = "channel.disconnected"
	MsgChannelTokenRequired = "channel.token_required"
	MsgChannelTokenInvalid  = "channel.token_invalid"
	MsgChannelTokenTooShort = "channel.token_too_short"
	MsgChannelConfigFailed  = "channel.config_failed"
)

// Validation messages
const (
	MsgFieldRequired = "validation.field_required"
	MsgFieldInvalid  = "validation.field_invalid"
	MsgFieldTooShort = "validation.field_too_short"
	MsgFieldTooLong  = "validation.field_too_long"
)

// Session messages
const (
	MsgSessionCreated  = "session.created"
	MsgSessionEnded    = "session.ended"
	MsgSessionNotFound = "session.not_found"
)

// Agent messages
const (
	MsgAgentCreated         = "agent.created"
	MsgAgentDeleted         = "agent.deleted"
	MsgAgentNotFound        = "agent.not_found"
	MsgAgentFileNotFound    = "agent.file_not_found"
	MsgAgentFileUnsupported = "agent.file_unsupported"
)

// Model messages
const (
	MsgModelTestSuccess = "model.test_success"
	MsgModelTestFailed  = "model.test_failed"
	MsgModelNotFound    = "model.not_found"
	MsgModelAuthFailed  = "model.auth_failed"
	MsgModelRateLimited = "model.rate_limited"
)

// Config messages
const (
	MsgConfigReadFailed  = "config.read_failed"
	MsgConfigWriteFailed = "config.write_failed"
	MsgConfigInvalid     = "config.invalid"
)

// Cron messages
const (
	MsgCronCreated  = "cron.created"
	MsgCronDeleted  = "cron.deleted"
	MsgCronNotFound = "cron.not_found"
)

// Skill messages
const (
	MsgSkillInstalled   = "skill.installed"
	MsgSkillUninstalled = "skill.uninstalled"
	MsgSkillNotFound    = "skill.not_found"
)

// Auth messages
const (
	MsgAuthLoginSuccess   = "auth.login_success"
	MsgAuthLoginFailed    = "auth.login_failed"
	MsgAuthLogoutSuccess  = "auth.logout_success"
	MsgAuthSessionExpired = "auth.session_expired"
	MsgAuthUnauthorized   = "auth.unauthorized"
)

// Error messages
const (
	MsgErrorInternal          = "error.internal"
	MsgErrorInvalidRequest    = "error.invalid_request"
	MsgErrorInvalidBody       = "error.invalid_body"
	MsgErrorNotFound          = "error.not_found"
	MsgErrorRateLimited       = "error.rate_limited"
	MsgErrorTimeout           = "error.timeout"
	MsgErrorConnectionTimeout = "error.connection_timeout"
	MsgErrorConnectionFailed  = "error.connection_failed"
	MsgErrorCreateRequest     = "error.create_request_failed"
	MsgErrorAPIError          = "error.api_error"
	MsgErrorConfigError       = "error.config_error"
)

// Workflow messages
const (
	MsgWorkflowUnsupportedType = "workflow.unsupported_type"
	MsgWorkflowStepFailed      = "workflow.step_failed"
	MsgWorkflowNoSteps         = "workflow.no_steps"
	MsgWorkflowParseFailed     = "workflow.parse_failed"
)

// File operation messages
const (
	MsgFileCreateFailed    = "file.create_failed"
	MsgFileWriteFailed     = "file.write_failed"
	MsgFileReadFailed      = "file.read_failed"
	MsgFileDirCreateFailed = "file.dir_create_failed"
)

// CLI messages
const (
	MsgCliAppName          = "cli.app_name"
	MsgCliUsage            = "cli.usage"
	MsgCliStartWeb         = "cli.start_web"
	MsgCliCommandUsage     = "cli.command_usage"
	MsgCliOptions          = "cli.options"
	MsgCliOptPort          = "cli.opt_port"
	MsgCliOptBind          = "cli.opt_bind"
	MsgCliOptUser          = "cli.opt_user"
	MsgCliOptPassword      = "cli.opt_password"
	MsgCliOptDebug         = "cli.opt_debug"
	MsgCliOptHelp          = "cli.opt_help"
	MsgCliOptVersion       = "cli.opt_version"
	MsgCliCommands         = "cli.commands"
	MsgCliCmdDoctor        = "cli.cmd_doctor"
	MsgCliCmdSettings      = "cli.cmd_settings"
	MsgCliCmdResetPassword = "cli.cmd_reset_password"
	MsgCliExamples         = "cli.examples"
	MsgCliExampleStart     = "cli.example_start"
	MsgCliExamplePort      = "cli.example_port"
	MsgCliExampleUser      = "cli.example_user"
	MsgCliExampleDoctor    = "cli.example_doctor"
	MsgCliUnknownCommand   = "cli.unknown_command"
	MsgCliInvalidArgs      = "cli.invalid_args"
	MsgCliError            = "cli.error"
	MsgCliConfigLoaded     = "cli.config_loaded"
)

// Serve messages
const (
	MsgServeConfigLoadFailed      = "serve.config_load_failed"
	MsgServeConfigSaveFailed      = "serve.config_save_failed"
	MsgServePortSaved             = "serve.port_saved"
	MsgServePasswordTooShort      = "serve.password_too_short"
	MsgServePasswordEncryptFailed = "serve.password_encrypt_failed"
	MsgServeUserCreateFailed      = "serve.user_create_failed"
	MsgServeUserCreated           = "serve.user_created"
	MsgServeUserExists            = "serve.user_exists"
	MsgServePortInUse             = "serve.port_in_use"
	MsgServePortInUseSolutions    = "serve.port_in_use_solutions"
	MsgServeLoopbackConflict      = "serve.loopback_conflict"
	MsgServeAccessWarning         = "serve.access_warning"
	MsgServeBindAllWarning        = "serve.bind_all_warning"
	MsgServeChangeBindingHint     = "serve.change_binding_hint"
	MsgServeFirstTimeSetup        = "serve.first_time_setup"
	MsgServeUsernameLabel         = "serve.username_label"
	MsgServePasswordLabel         = "serve.password_label"
	MsgServeChangePasswordWarning = "serve.change_password_warning"
	MsgServeChangePasswordHint    = "serve.change_password_hint"
	MsgServeAccessUrls            = "serve.access_urls"
)

// Doctor messages
const (
	MsgDoctorFixFlag                  = "doctor.fix_flag"
	MsgDoctorFixRuntimeFlag           = "doctor.fix_runtime_flag"
	MsgDoctorRollbackRuntimeFlag      = "doctor.rollback_runtime_flag"
	MsgDoctorPathFlag                 = "doctor.path_flag"
	MsgDoctorRuntimeFixFailed         = "doctor.runtime_fix_failed"
	MsgDoctorRuntimeFixDone           = "doctor.runtime_fix_done"
	MsgDoctorRuntimeFixUptodate       = "doctor.runtime_fix_uptodate"
	MsgDoctorRuntimeRollbackFailed    = "doctor.runtime_rollback_failed"
	MsgDoctorRuntimeRollbackDone      = "doctor.runtime_rollback_done"
	MsgDoctorRuntimeRollbackNotfound  = "doctor.runtime_rollback_notfound"
	MsgDoctorAutofixFailed            = "doctor.autofix_failed"
	MsgDoctorAutofixDone              = "doctor.autofix_done"
	MsgDoctorEnvFixDone               = "doctor.env_fix_done"
	MsgDoctorTitle                    = "doctor.title"
	MsgDoctorNoIssues                 = "doctor.no_issues"
	MsgDoctorSuggestion               = "doctor.suggestion"
	MsgDoctorLevelError               = "doctor.level_error"
	MsgDoctorLevelWarning             = "doctor.level_warning"
	MsgDoctorLevelInfo                = "doctor.level_info"
	MsgDoctorConfigNotExist           = "doctor.config_not_exist"
	MsgDoctorConfigNotExistSuggestion = "doctor.config_not_exist_suggestion"
	MsgDoctorConfigReadFailed         = "doctor.config_read_failed"
	MsgDoctorConfigReadSuggestion     = "doctor.config_read_suggestion"
	MsgDoctorConfigParseFailed        = "doctor.config_parse_failed"
	MsgDoctorConfigParseSuggestion    = "doctor.config_parse_suggestion"
	MsgDoctorDeprecatedAuthEnabled    = "doctor.deprecated_auth_enabled"
	MsgDoctorDeprecatedAuthSuggestion = "doctor.deprecated_auth_suggestion"
	MsgDoctorModeNotSet               = "doctor.mode_not_set"
	MsgDoctorModeSuggestion           = "doctor.mode_suggestion"
	MsgDoctorBindNotSet               = "doctor.bind_not_set"
	MsgDoctorBindSuggestion           = "doctor.bind_suggestion"
	MsgDoctorBindNoAuth               = "doctor.bind_no_auth"
	MsgDoctorBindNoAuthSuggestion     = "doctor.bind_no_auth_suggestion"
	MsgDoctorTokenNotSet              = "doctor.token_not_set"
	MsgDoctorTokenSuggestion          = "doctor.token_suggestion"
	MsgDoctorRemoteUrlNotSet          = "doctor.remote_url_not_set"
	MsgDoctorRemoteUrlSuggestion      = "doctor.remote_url_suggestion"
	MsgDoctorRemoteUrlInvalid         = "doctor.remote_url_invalid"
	MsgDoctorRemoteUrlCheck           = "doctor.remote_url_check"
	MsgDoctorRemoteNoAuth             = "doctor.remote_no_auth"
	MsgDoctorRemoteAuthCheck          = "doctor.remote_auth_check"
	MsgDoctorBackupNotExist           = "doctor.backup_not_exist"
	MsgDoctorBackupSuggestion         = "doctor.backup_suggestion"
	MsgDoctorGatewayNotRunning        = "doctor.gateway_not_running"
	MsgDoctorGatewayStartSuggestion   = "doctor.gateway_start_suggestion"
	MsgDoctorGatewayRunning           = "doctor.gateway_running"
	MsgDoctorEnvReadFailed            = "doctor.env_read_failed"
	MsgDoctorEnvReadSuggestion        = "doctor.env_read_suggestion"
	MsgDoctorEnvNotConfigured         = "doctor.env_not_configured"
	MsgDoctorEnvSuggestion            = "doctor.env_suggestion"
	MsgDoctorAiModelNotConfigured     = "doctor.ai_model_not_configured"
	MsgDoctorAiModelSuggestion        = "doctor.ai_model_suggestion"
	MsgDoctorCustomBaseUrlMissing     = "doctor.custom_base_url_missing"
	MsgDoctorCustomBaseUrlSuggestion  = "doctor.custom_base_url_suggestion"
	MsgDoctorBaseUrlInvalid           = "doctor.base_url_invalid"
	MsgDoctorBaseUrlCheck             = "doctor.base_url_check"
	MsgDoctorApiKeyMissing            = "doctor.api_key_missing"
	MsgDoctorApiKeySuggestion         = "doctor.api_key_suggestion"
	MsgDoctorBotNameMissing           = "doctor.bot_name_missing"
	MsgDoctorPersonaSuggestion        = "doctor.persona_suggestion"
	MsgDoctorUserNameMissing          = "doctor.user_name_missing"
	MsgDoctorTimezoneMissing          = "doctor.timezone_missing"
	MsgDoctorTimezoneSuggestion       = "doctor.timezone_suggestion"
	MsgDoctorNotifyNotConfigured      = "doctor.notify_not_configured"
	MsgDoctorNotifySuggestion         = "doctor.notify_suggestion"
	MsgDoctorTelegramIncomplete       = "doctor.telegram_incomplete"
	MsgDoctorTelegramSuggestion       = "doctor.telegram_suggestion"
	MsgDoctorSlackMissing             = "doctor.slack_missing"
	MsgDoctorFeishuMissing            = "doctor.feishu_missing"
	MsgDoctorCustomWebhookMissing     = "doctor.custom_webhook_missing"
	MsgDoctorNotifyUnknown            = "doctor.notify_unknown"
	MsgDoctorNotifyReconfigure        = "doctor.notify_reconfigure"
)

// Reset password messages
const (
	MsgResetPasswordUsage            = "reset_password.usage"
	MsgResetPasswordTooShort         = "reset_password.password_too_short"
	MsgResetPasswordConfigLoadFailed = "reset_password.config_load_failed"
	MsgResetPasswordDbInitFailed     = "reset_password.db_init_failed"
	MsgResetPasswordUserNotFound     = "reset_password.user_not_found"
	MsgResetPasswordEncryptFailed    = "reset_password.encrypt_failed"
	MsgResetPasswordUpdateFailed     = "reset_password.update_failed"
	MsgResetPasswordSuccess          = "reset_password.success"
)

// Settings messages
const (
	MsgSettingsConfigTitle      = "settings.config_title"
	MsgSettingsPath             = "settings.path"
	MsgSettingsMode             = "settings.mode"
	MsgSettingsDebug            = "settings.debug"
	MsgSettingsModeFlag         = "settings.mode_flag"
	MsgSettingsInvalidMode      = "settings.invalid_mode"
	MsgSettingsConfigReadFailed = "settings.config_read_failed"
	MsgSettingsConfigSaveFailed = "settings.config_save_failed"
	MsgSettingsModeSet          = "settings.mode_set"
)

// Gateway messages
const (
	MsgGatewayHeartbeatRestartFailed  = "gateway.heartbeat_restart_failed"
	MsgGatewayHeartbeatRestartSuccess = "gateway.heartbeat_restart_success"
)

// Installer messages
const (
	MsgInstallerNodeAlreadyInstalled     = "installer.node_already_installed"
	MsgInstallerNodeTryingPkgManager     = "installer.node_trying_pkg_manager"
	MsgInstallerNodePkgManagerSuccess    = "installer.node_pkg_manager_success"
	MsgInstallerNodePkgManagerRestart    = "installer.node_pkg_manager_restart"
	MsgInstallerNodePkgManagerFailed     = "installer.node_pkg_manager_failed"
	MsgInstallerNodeTryingFnm            = "installer.node_trying_fnm"
	MsgInstallerNodeFnmSuccess           = "installer.node_fnm_success"
	MsgInstallerNodeFnmRestart           = "installer.node_fnm_restart"
	MsgInstallerNodeFnmFailed            = "installer.node_fnm_failed"
	MsgInstallerNodeManualRequired       = "installer.node_manual_required"
	MsgInstallerGitAlreadyInstalled      = "installer.git_already_installed"
	MsgInstallerGitSuccess               = "installer.git_success"
	MsgInstallerOpenclawAlreadyInstalled = "installer.openclaw_already_installed"
	MsgInstallerOpenclawTryingNpm        = "installer.openclaw_trying_npm"
	MsgInstallerOpenclawNpmSuccess       = "installer.openclaw_npm_success"
	MsgInstallerOpenclawNpmRestart       = "installer.openclaw_npm_restart"
	MsgInstallerOpenclawNpmFailed        = "installer.openclaw_npm_failed"
	MsgInstallerOpenclawTryingScript     = "installer.openclaw_trying_script"
	MsgInstallerOpenclawScriptSuccess    = "installer.openclaw_script_success"
	MsgInstallerOpenclawScriptRestart    = "installer.openclaw_script_restart"
	MsgInstallerOpenclawScriptFailed     = "installer.openclaw_script_failed"
	MsgInstallerOpenclawManualRequired   = "installer.openclaw_manual_required"
	MsgInstallerClawhubAlreadyInstalled  = "installer.clawhub_already_installed"
	MsgInstallerClawhubNpmUnavailable    = "installer.clawhub_npm_unavailable"
	MsgInstallerClawhubInstalling        = "installer.clawhub_installing"
	MsgInstallerClawhubFailed            = "installer.clawhub_failed"
	MsgInstallerClawhubSuccess           = "installer.clawhub_success"
	MsgInstallerClawhubRestart           = "installer.clawhub_restart"
	MsgInstallerNpmGlobalInstalling      = "installer.npm_global_installing"
	MsgInstallerInstallingPackage        = "installer.installing_package"
	MsgInstallerUsingRegistry            = "installer.using_registry"
	MsgInstallerUsingCommand             = "installer.using_command"
	MsgInstallerCustomProviderConfig     = "installer.custom_provider_config"
	MsgInstallerExecuting                = "installer.executing"
	MsgInstallerOnboardFailedFallback    = "installer.onboard_failed_fallback"
	MsgInstallerOnboardComplete          = "installer.onboard_complete"
	MsgInstallerConfigExists             = "installer.config_exists"
	MsgInstallerGeneratingDefaultConfig  = "installer.generating_default_config"
	MsgInstallerDefaultConfigGenerated   = "installer.default_config_generated"
	MsgInstallerAddProviderReminder      = "installer.add_provider_reminder"
	MsgInstallerConfigWritten            = "installer.config_written"
	MsgInstallerCheckingConfig           = "installer.checking_config"
	MsgInstallerConfigNotExist           = "installer.config_not_exist"
	MsgInstallerAddProviderFirst         = "installer.add_provider_first"
	MsgInstallerConfigInvalid            = "installer.config_invalid"
	MsgInstallerFixConfigFirst           = "installer.fix_config_first"
	MsgInstallerConfigOk                 = "installer.config_ok"
	MsgInstallerProviderConfigured       = "installer.provider_configured"
	MsgInstallerProviderNotConfigured    = "installer.provider_not_configured"
	MsgInstallerCountdown                = "installer.countdown"
	MsgInstallerStartingGateway          = "installer.starting_gateway"
	MsgInstallerGatewayAlreadyRunning    = "installer.gateway_already_running"
	MsgInstallerGatewayStartFailed       = "installer.gateway_start_failed"
	MsgInstallerGatewayManualStart       = "installer.gateway_manual_start"
	MsgInstallerWaitingGateway           = "installer.waiting_gateway"
	MsgInstallerGatewayStarted           = "installer.gateway_started"
	MsgInstallerCheckingGateway          = "installer.checking_gateway"
	MsgInstallerGatewayNotReady          = "installer.gateway_not_ready"
	MsgInstallerOpenaiCompatConfig       = "installer.openai_compat_config"
	MsgInstallerPowershellRequired       = "installer.powershell_required"
	MsgInstallerCurlRequired             = "installer.curl_required"
	MsgInstallerUnsupportedOs            = "installer.unsupported_os"
	MsgInstallerNoPkgManager             = "installer.no_pkg_manager"
	MsgInstallerCannotGetConfigPath      = "installer.cannot_get_config_path"
	MsgInstallerGetStateDirFailed        = "installer.get_state_dir_failed"
	MsgInstallerCreateConfigDirFailed    = "installer.create_config_dir_failed"
	MsgInstallerSerializeConfigFailed    = "installer.serialize_config_failed"
	MsgInstallerWriteConfigFailed        = "installer.write_config_failed"
	MsgInstallerOnboardDefaultFailed     = "installer.onboard_default_failed"
	MsgInstallerPowershellNotFound       = "installer.powershell_not_found"
	MsgInstallerCurlNotFound             = "installer.curl_not_found"
	MsgInstallerManualNodeRequired       = "installer.manual_node_required"
	MsgInstallerManualOpenclawRequired   = "installer.manual_openclaw_required"
)

// Service messages
const (
	MsgServiceGetGatewayConfigFailed    = "service.get_gateway_config_failed"
	MsgServiceGatewayRestartFailed      = "service.gateway_restart_failed"
	MsgServiceStartGatewayProcessFailed = "service.start_gateway_process_failed"
	MsgServiceCommandFailed             = "service.command_failed"
)

// Stream messages
const (
	MsgStreamCreateStdoutPipeFailed = "stream.create_stdout_pipe_failed"
	MsgStreamCreateStderrPipeFailed = "stream.create_stderr_pipe_failed"
	MsgStreamStartCommandFailed     = "stream.start_command_failed"
	MsgStreamCommandExecFailed      = "stream.command_exec_failed"
)

// CLI messages (openclaw cli wrapper)
const (
	MsgCliOpenclawNotInstalled         = "cli.openclaw_not_installed"
	MsgCliConfigSetFailed              = "cli.config_set_failed"
	MsgCliSerializeFailed              = "cli.serialize_failed"
	MsgCliOpenclawNotInstalledNoConfig = "cli.openclaw_not_installed_no_config"
	MsgCliConfigSetFallbackFailed      = "cli.config_set_fallback_failed"
	MsgCliParsePairingListFailed       = "cli.parse_pairing_list_failed"
)

// Installer additional messages
const (
	MsgInstallerWindowsManualZerotier  = "installer.windows_manual_zerotier"
	MsgInstallerMacosManualZerotier    = "installer.macos_manual_zerotier"
	MsgInstallerWindowsManualTailscale = "installer.windows_manual_tailscale"
	MsgInstallerMacosManualTailscale   = "installer.macos_manual_tailscale"
	MsgInstallerUnsupportedOsWithName  = "installer.unsupported_os_with_name"
	MsgInstallerUnknownTool            = "installer.unknown_tool"
)

// Gateway client messages
const (
	MsgGwclientSerializeRequestFailed = "gwclient.serialize_request_failed"
	MsgGwclientSendRequestFailed      = "gwclient.send_request_failed"
	MsgGwclientGatewayError           = "gwclient.gateway_error"
	MsgGwclientRequestTimeout         = "gwclient.request_timeout"
	MsgGwclientWebsocketDialFailed    = "gwclient.websocket_dial_failed"
	MsgGwclientReadMessageFailed      = "gwclient.read_message_failed"
)

// Language selection messages
const (
	MsgLangSelectPrompt = "lang.select_prompt"
	MsgLangCountdown    = "lang.countdown"
	MsgLangSelected     = "lang.selected"
	MsgLangAutoSelected = "lang.auto_selected"
)

// Installation guide messages
const (
	MsgGuideNodeWindows     = "guide.node_windows"
	MsgGuideNodeMacos       = "guide.node_macos"
	MsgGuideNodeLinux       = "guide.node_linux"
	MsgGuideNodeDefault     = "guide.node_default"
	MsgGuideOpenclaw        = "guide.openclaw"
	MsgGuideOpenclawWindows = "guide.openclaw_windows"
	MsgGuideOpenclawUnix    = "guide.openclaw_unix"
	MsgGuideOpenclawFooter  = "guide.openclaw_footer"
)

// Log messages
const (
	MsgLogServeStarting              = "log.serve_starting"
	MsgLogDbInitFailed               = "log.db_init_failed"
	MsgLogGatewayTokenRead           = "log.gateway_token_read"
	MsgLogTemplateSeedFailed         = "log.template_seed_failed"
	MsgLogWebServiceStarted          = "log.web_service_started"
	MsgLogAdminAutoCreated           = "log.admin_auto_created"
	MsgLogShuttingDown               = "log.shutting_down"
	MsgLogServiceStartFailed         = "log.service_start_failed"
	MsgLogUserExitTray               = "log.user_exit_tray"
	MsgLogServiceStopped             = "log.service_stopped"
	MsgLogStaticLoadFailed           = "log.static_load_failed"
	MsgLogCannotGetHomeDir           = "log.cannot_get_home_dir"
	MsgLogFallbackOpenclawPath       = "log.fallback_openclaw_path"
	MsgLogPathNotExist               = "log.path_not_exist"
	MsgLogCannotReadFile             = "log.cannot_read_file"
	MsgLogJsonParseFailed            = "log.json_parse_failed"
	MsgLogMissingGatewayField        = "log.missing_gateway_field"
	MsgLogMissingAuthField           = "log.missing_auth_field"
	MsgLogTokenEmpty                 = "log.token_empty"
	MsgLogTokenReadSuccess           = "log.token_read_success"
	MsgLogHealthCheckEnabled         = "log.health_check_enabled"
	MsgLogHealthCheckDisabled        = "log.health_check_disabled"
	MsgLogHeartbeatWsPingOk          = "log.heartbeat_ws_ping_ok"
	MsgLogHeartbeatWsPingFail        = "log.heartbeat_ws_ping_fail"
	MsgLogHeartbeatTcpOk             = "log.heartbeat_tcp_ok"
	MsgLogHeartbeatTcpFail           = "log.heartbeat_tcp_fail"
	MsgLogGwclientTokenEmpty         = "log.gwclient_token_empty"
	MsgLogGwclientTokenRead          = "log.gwclient_token_read"
	MsgLogGwclientTokenReadFail      = "log.gwclient_token_read_fail"
	MsgLogGwclientNoAuth             = "log.gwclient_no_auth"
	MsgLogDeviceIdentityLoadFail     = "log.device_identity_load_fail"
	MsgLogDevicePayloadSignFail      = "log.device_payload_sign_fail"
	MsgLogPublicKeyEncodeFail        = "log.public_key_encode_fail"
	MsgLogConnectSerializeFail       = "log.connect_serialize_fail"
	MsgLogConnectSendFail            = "log.connect_send_fail"
	MsgLogGatewayWsAuthFail          = "log.gateway_ws_auth_fail"
	MsgLogGatewayWsConnectTimeout    = "log.gateway_ws_connect_timeout"
	MsgLogGwCollectorStopped         = "log.gw_collector_stopped"
	MsgLogGwPollSkipNotConnected     = "log.gw_poll_skip_not_connected"
	MsgLogGwPollSessionsFailed       = "log.gw_poll_sessions_failed"
	MsgLogGwParseSessionsFailed      = "log.gw_parse_sessions_failed"
	MsgLogGwPollSessions             = "log.gw_poll_sessions"
	MsgLogGwPollNewEvents            = "log.gw_poll_new_events"
	MsgLogGwActivityWriteFailed      = "log.gw_activity_write_failed"
	MsgLogTelegramChatIdInvalid      = "log.telegram_chat_id_invalid"
	MsgLogTelegramInitFailed         = "log.telegram_init_failed"
	MsgLogDiscordInitFailed          = "log.discord_init_failed"
	MsgLogNotifyChannelsReloaded     = "log.notify_channels_reloaded"
	MsgLogNotifySendFailed           = "log.notify_send_failed"
	MsgLogMonitorStopped             = "log.monitor_stopped"
	MsgLogMonitorScanFailed          = "log.monitor_scan_failed"
	MsgLogMonitorNewEvents           = "log.monitor_new_events"
	MsgLogMonitorActivityWriteFailed = "log.monitor_activity_write_failed"
	MsgLogAuditWriteFailed           = "log.audit_write_failed"
	MsgLogDbInit                     = "log.db_init"
	MsgLogDbInitComplete             = "log.db_init_complete"
	MsgLogPortInUse                  = "log.port_in_use"
	MsgLogLoopbackConflict           = "log.loopback_conflict"
	MsgLogHeartbeatRestartFailed     = "log.heartbeat_restart_failed"
	MsgLogHeartbeatRestartSuccess    = "log.heartbeat_restart_success"
	MsgLogDetectRuntimeFailed        = "log.detect_runtime_failed"
	MsgLogRestartDetectedRuntime     = "log.restart_detected_runtime"
	MsgLogParseSessionFileFailed     = "log.parse_session_file_failed"
	MsgLogSkipUnparseableLine        = "log.skip_unparseable_line"
	MsgLogDetectRuntimeUsingCache    = "log.detect_runtime_using_cache"
	MsgLogDetectRuntimeSystemd       = "log.detect_runtime_systemd"
	MsgLogDetectRuntimeDocker        = "log.detect_runtime_docker"
	MsgLogDetectRuntimeProcess       = "log.detect_runtime_process"
	MsgLogRestartUnknownRuntime      = "log.restart_unknown_runtime"
	MsgLogHeartbeatRecovered         = "log.heartbeat_recovered"
	MsgLogHeartbeatFailed            = "log.heartbeat_failed"
	MsgLogHeartbeatThresholdRestart  = "log.heartbeat_threshold_restart"
	MsgLogGatewayConfigUpdated       = "log.gateway_config_updated"
	MsgLogGatewayWsConnectFailed     = "log.gateway_ws_connect_failed"
	MsgLogDeviceIdentityAdded        = "log.device_identity_added"
	MsgLogSendConnectParams          = "log.send_connect_params"
	MsgLogGatewayWsConnected         = "log.gateway_ws_connected"
	MsgLogDeviceIdentityGenerated    = "log.device_identity_generated"
	MsgLogMonitorStarted             = "log.monitor_started"
	MsgLogGwCollectorStarted         = "log.gw_collector_started"
	MsgLogServerConfigUpdated        = "log.server_config_updated"
	MsgLogUsingGatewayProfile        = "log.using_gateway_profile"
	MsgLogTryingReadGwToken          = "log.trying_read_gw_token"
	MsgLogGwTokenReadFailed          = "log.gw_token_read_failed"
	MsgLogRemoteGatewayMode          = "log.remote_gateway_mode"
	MsgLogBindNonLoopbackWarning     = "log.bind_non_loopback_warning"
)

// Success messages
const (
	MsgSuccessApplied = "success.applied"
	MsgSuccessSaved   = "success.saved"
	MsgSuccessDeleted = "success.deleted"
	MsgSuccessUpdated = "success.updated"
)

// Error messages
const (
	MsgErrRemoteGatewayNoStart         = "error.remote_gateway_no_start"
	MsgErrRemoteGatewayNoStop          = "error.remote_gateway_no_stop"
	MsgErrRemoteGatewayNotConnected    = "error.remote_gateway_not_connected"
	MsgErrContainerNotFound            = "error.container_not_found"
	MsgErrCommandNotFound              = "error.command_not_found"
	MsgErrUnknownRuntimeStart          = "error.unknown_runtime_start"
	MsgErrUnknownRuntimeStop           = "error.unknown_runtime_stop"
	MsgErrUnknownRuntimeRestart        = "error.unknown_runtime_restart"
	MsgErrStopGatewayTimeout           = "error.stop_gateway_timeout"
	MsgErrGatewayNotConnected          = "error.gateway_not_connected"
	MsgErrConnectionClosed             = "error.connection_closed"
	MsgErrClientStopped                = "error.client_stopped"
	MsgErrInvalidArgs                  = "error.invalid_args"
	MsgErrRequestTimeout               = "error.request_timeout"
	MsgErrSerializeRequestFailed       = "error.serialize_request_failed"
	MsgErrCreateStdoutPipeFailed       = "error.create_stdout_pipe_failed"
	MsgErrCreateStderrPipeFailed       = "error.create_stderr_pipe_failed"
	MsgErrStartCommandFailed           = "error.start_command_failed"
	MsgErrCommandExecFailed            = "error.command_exec_failed"
	MsgErrNoPackageManager             = "error.no_package_manager"
	MsgErrNeedPowershell               = "error.need_powershell"
	MsgErrNeedCurl                     = "error.need_curl"
	MsgErrUnsupportedOS                = "error.unsupported_os"
	MsgErrNeedManualInstallNode        = "error.need_manual_install_node"
	MsgErrCannotDetermineGitCmd        = "error.cannot_determine_git_cmd"
	MsgErrGitInstallFailed             = "error.git_install_failed"
	MsgErrNeedManualInstallOpenclaw    = "error.need_manual_install_openclaw"
	MsgErrPowershellNotDetected        = "error.powershell_not_detected"
	MsgErrCurlNotDetected              = "error.curl_not_detected"
	MsgErrCannotGetConfigPath          = "error.cannot_get_config_path"
	MsgErrOnboardDefaultConfigFailed   = "error.onboard_default_config_failed"
	MsgErrGetStateDirFailed            = "error.get_state_dir_failed"
	MsgErrCreateConfigDirFailed        = "error.create_config_dir_failed"
	MsgErrSerializeConfigFailed        = "error.serialize_config_failed"
	MsgErrWriteConfigFailed            = "error.write_config_failed"
	MsgErrWindowsNeedManualZerotier    = "error.windows_need_manual_zerotier"
	MsgErrMacosNeedBrewZerotier        = "error.macos_need_brew_zerotier"
	MsgErrUnsupportedOSWithName        = "error.unsupported_os_with_name"
	MsgErrWindowsNeedManualTailscale   = "error.windows_need_manual_tailscale"
	MsgErrMacosNeedBrewTailscale       = "error.macos_need_brew_tailscale"
	MsgErrUnknownTool                  = "error.unknown_tool"
	MsgErrGetGatewayConfigFailed       = "error.get_gateway_config_failed"
	MsgErrGatewayRestartFailed         = "error.gateway_restart_failed"
	MsgErrStartGatewayProcessFailed    = "error.start_gateway_process_failed"
	MsgErrCommandFailed                = "error.command_failed"
	MsgErrSendRequestFailed            = "error.send_request_failed"
	MsgErrGatewayError                 = "error.gateway_error"
	MsgErrWebsocketDialFailed          = "error.websocket_dial_failed"
	MsgErrReadMessageFailed            = "error.read_message_failed"
	MsgErrOpenclawNotInstalled         = "error.openclaw_not_installed"
	MsgErrConfigSetFailed              = "error.config_set_failed"
	MsgErrSerializeKeyFailed           = "error.serialize_key_failed"
	MsgErrOpenclawNotInstalledNoConfig = "error.openclaw_not_installed_no_config"
	MsgErrConfigSetFallbackFailed      = "error.config_set_fallback_failed"
	MsgErrParsePairingListFailed       = "error.parse_pairing_list_failed"
	MsgErrGatewayCliNotFound           = "error.gateway_cli_not_found"
	MsgErrTargetFragmentNotFound       = "error.target_fragment_not_found"
)

// Notification messages
const (
	MsgNotifyHeartbeatRestartFailed  = "notify.heartbeat_restart_failed"
	MsgNotifyHeartbeatRestartSuccess = "notify.heartbeat_restart_success"
)
