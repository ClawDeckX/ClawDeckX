package constants

// Risk levels
const (
	RiskLow      = "low"
	RiskMedium   = "medium"
	RiskHigh     = "high"
	RiskCritical = "critical"
)

var AllRiskLevels = []string{RiskLow, RiskMedium, RiskHigh, RiskCritical}

// User roles
const (
	RoleAdmin    = "admin"
	RoleReadonly = "readonly"
)

// Audit actions
const (
	ActionLogin          = "login"
	ActionLoginFailed    = "login.failed"
	ActionAccountLocked  = "account.locked"
	ActionLogout         = "logout"
	ActionAuthFailed     = "auth.failed"
	ActionForbidden      = "forbidden"
	ActionGatewayStart   = "gateway.start"
	ActionGatewayStop    = "gateway.stop"
	ActionGatewayRestart = "gateway.restart"
	ActionKillSwitch     = "kill_switch"
	ActionConfigUpdate   = "config.update"
	ActionDoctorFix      = "doctor.fix"
	ActionBackupCreate   = "backup.create"
	ActionBackupRestore  = "backup.restore"
	ActionBackupDelete   = "backup.delete"
	ActionPolicyUpdate   = "policy.update"
	ActionPasswordChange = "password.change"
	ActionSetup          = "setup"
	ActionSettingsUpdate = "settings.update"
	ActionAlertRead      = "alert.read"
	ActionSelfUpdate     = "self.update"
	ActionUserCreate     = "user.create"
	ActionUserDelete     = "user.delete"
)

// Activity categories
const (
	CategoryShell   = "Shell"
	CategoryFile    = "File"
	CategoryNetwork = "Network"
	CategoryBrowser = "Browser"
	CategoryMessage = "Message"
	CategorySystem  = "System"
	CategoryMemory  = "Memory"
)

var AllCategories = []string{
	CategoryShell, CategoryFile, CategoryNetwork, CategoryBrowser,
	CategoryMessage, CategorySystem, CategoryMemory,
}

// Credential key types
const (
	KeyTypeAnthropic = "anthropic"
	KeyTypeOpenAI    = "openai"
	KeyTypeTelegram  = "telegram"
	KeyTypeSlack     = "slack"
	KeyTypeGitHub    = "github"
	KeyTypeSSH       = "ssh"
	KeyTypeGeneric   = "generic"
)

// Action taken on activity
const (
	ActionTakenAllow  = "allow"
	ActionTakenWarn   = "warn"
	ActionTakenAbort  = "abort"
	ActionTakenNotify = "notify"
)
