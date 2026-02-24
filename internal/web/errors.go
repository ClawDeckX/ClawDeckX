package web

import (
	"fmt"
	"net/http"
)

// AppError represents a structured API error with a machine-readable code.
// The Message field is an English fallback for API consumers; the frontend
// translates error_code into the user's language via locales/errors.ts.
type AppError struct {
	Code       string
	Message    string // English fallback only — frontend translates via error_code
	HTTPStatus int
	Err        error
}

func (e *AppError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Err)
	}
	return e.Message
}

func (e *AppError) Unwrap() error { return e.Err }

func NewAppError(code, message string, httpStatus int, err error) *AppError {
	return &AppError{Code: code, Message: message, HTTPStatus: httpStatus, Err: err}
}

// FailErr writes a structured error response from an AppError.
// Optional detail is appended to the message (e.g. err.Error()).
func FailErr(w http.ResponseWriter, r *http.Request, e *AppError, detail ...string) {
	msg := e.Message
	if len(detail) > 0 && detail[0] != "" {
		msg = msg + ": " + detail[0]
	}
	Fail(w, r, e.Code, msg, e.HTTPStatus)
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

var (
	ErrUnauthorized     = &AppError{"AUTH_UNAUTHORIZED", "not logged in or session expired", 401, nil}
	ErrForbidden        = &AppError{"AUTH_FORBIDDEN", "permission denied", 403, nil}
	ErrInvalidPassword  = &AppError{"AUTH_INVALID_PASSWORD", "invalid username or password", 401, nil}
	ErrAccountLocked    = &AppError{"AUTH_ACCOUNT_LOCKED", "account locked, try again later", 423, nil}
	ErrTokenExpired     = &AppError{"AUTH_TOKEN_EXPIRED", "session expired, please login again", 401, nil}
	ErrTokenInvalid     = &AppError{"AUTH_TOKEN_INVALID", "invalid token", 400, nil}
	ErrEmptyCredentials = &AppError{"AUTH_EMPTY_CREDENTIALS", "username and password required", 400, nil}
	ErrPasswordTooShort = &AppError{"AUTH_PASSWORD_TOO_SHORT", "password must be at least 6 characters", 400, nil}
	ErrSetupDone        = &AppError{"AUTH_SETUP_DONE", "admin account already exists", 409, nil}
	ErrOldPasswordWrong = &AppError{"AUTH_OLD_PASSWORD_WRONG", "old password incorrect", 401, nil}
	ErrLoginFailed      = &AppError{"AUTH_LOGIN_FAILED", "login failed", 500, nil}
)

// ---------------------------------------------------------------------------
// System / generic
// ---------------------------------------------------------------------------

var (
	ErrNotFound      = &AppError{"NOT_FOUND", "resource not found", 404, nil}
	ErrInvalidParam  = &AppError{"INVALID_PARAM", "invalid request parameter", 400, nil}
	ErrInvalidBody   = &AppError{"INVALID_BODY", "invalid request body", 400, nil}
	ErrInternalError = &AppError{"INTERNAL_ERROR", "internal server error", 500, nil}
	ErrRateLimited   = &AppError{"RATE_LIMITED", "too many requests, please try later", 429, nil}
	ErrInvalidInput  = &AppError{"INVALID_INPUT", "input contains illegal characters", 400, nil}
	ErrDBQuery       = &AppError{"DB_QUERY_FAILED", "database query failed", 500, nil}
	ErrEncrypt       = &AppError{"ENCRYPT_FAILED", "encryption failed", 500, nil}
	ErrPathError     = &AppError{"PATH_ERROR", "cannot determine user directory", 500, nil}
)

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

var (
	ErrUserNotFound   = &AppError{"USER_NOT_FOUND", "user not found", 404, nil}
	ErrUserExists     = &AppError{"USER_EXISTS", "username already exists", 409, nil}
	ErrUserCreateFail = &AppError{"USER_CREATE_FAILED", "user creation failed", 500, nil}
	ErrUserDeleteFail = &AppError{"USER_DELETE_FAILED", "user deletion failed", 500, nil}
	ErrUserQueryFail  = &AppError{"USER_QUERY_FAILED", "user query failed", 500, nil}
	ErrUserSelfDelete = &AppError{"USER_SELF_DELETE", "cannot delete current user", 403, nil}
)

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------

var (
	ErrGWNotConnected      = &AppError{"GW_NOT_CONNECTED", "gateway not connected", 502, nil}
	ErrGWNotRunning        = &AppError{"GW_NOT_RUNNING", "gateway not running", 409, nil}
	ErrGWStartFailed       = &AppError{"GW_START_FAILED", "gateway start failed", 500, nil}
	ErrGWStartTimeout      = &AppError{"GW_START_TIMEOUT", "gateway start timeout", 408, nil}
	ErrGWStopFailed        = &AppError{"GW_STOP_FAILED", "gateway stop failed", 500, nil}
	ErrGWStatusFailed      = &AppError{"GW_STATUS_FAILED", "gateway status query failed", 502, nil}
	ErrGWProfileNotFound   = &AppError{"GW_PROFILE_NOT_FOUND", "gateway profile not found", 404, nil}
	ErrGWProfileSaveFail   = &AppError{"GW_PROFILE_SAVE_FAILED", "gateway profile save failed", 500, nil}
	ErrGWProfileDeleteFail = &AppError{"GW_PROFILE_DELETE_FAILED", "gateway profile delete failed", 500, nil}
	ErrGWDiagnoseFailed    = &AppError{"GW_DIAGNOSE_FAILED", "gateway diagnosis failed", 502, nil}
)

// ---------------------------------------------------------------------------
// Gateway proxy (forwarded requests)
// ---------------------------------------------------------------------------

var (
	ErrGWProxyFailed       = &AppError{"GW_PROXY_FAILED", "gateway proxy request failed", 502, nil}
	ErrGWConfigReadFailed  = &AppError{"GW_CONFIG_READ_FAILED", "config read failed", 502, nil}
	ErrGWConfigWriteFailed = &AppError{"GW_CONFIG_WRITE_FAILED", "config write failed", 502, nil}
	ErrGWAgentsFailed      = &AppError{"GW_AGENTS_FAILED", "agents query failed", 502, nil}
	ErrGWChannelsFailed    = &AppError{"GW_CHANNELS_FAILED", "channels query failed", 502, nil}
	ErrGWModelsFailed      = &AppError{"GW_MODELS_FAILED", "models query failed", 502, nil}
	ErrGWSessionsFailed    = &AppError{"GW_SESSIONS_FAILED", "sessions query failed", 502, nil}
	ErrGWSkillsFailed      = &AppError{"GW_SKILLS_FAILED", "skills query failed", 502, nil}
	ErrGWUsageFailed       = &AppError{"GW_USAGE_FAILED", "usage query failed", 502, nil}
	ErrGWCronFailed        = &AppError{"GW_CRON_FAILED", "cron query failed", 502, nil}
	ErrGWHealthFailed      = &AppError{"GW_HEALTH_FAILED", "health check failed", 502, nil}
	ErrGWChatFailed        = &AppError{"GW_CHAT_FAILED", "chat request failed", 502, nil}
	ErrGWModelTestFailed   = &AppError{"GW_MODEL_TEST_FAILED", "model test failed", 502, nil}
)

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

var (
	ErrConfigPathError   = &AppError{"CONFIG_PATH_ERROR", "cannot determine config file path", 500, nil}
	ErrConfigNotFound    = &AppError{"CONFIG_NOT_FOUND", "config file not found", 404, nil}
	ErrConfigReadFailed  = &AppError{"CONFIG_READ_FAILED", "config read failed", 500, nil}
	ErrConfigWriteFailed = &AppError{"CONFIG_WRITE_FAILED", "config write failed", 500, nil}
	ErrConfigGenFailed   = &AppError{"CONFIG_GEN_FAILED", "config generation failed", 500, nil}
	ErrConfigEmpty       = &AppError{"CONFIG_EMPTY", "no valid config entries", 400, nil}
)

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

var (
	ErrSecurityQueryFail  = &AppError{"SECURITY_QUERY_FAILED", "rule query failed", 500, nil}
	ErrSecurityCreateFail = &AppError{"SECURITY_CREATE_FAILED", "rule creation failed", 500, nil}
	ErrSecurityUpdateFail = &AppError{"SECURITY_UPDATE_FAILED", "rule update failed", 500, nil}
	ErrSecurityDeleteFail = &AppError{"SECURITY_DELETE_FAILED", "rule deletion failed", 500, nil}
	ErrSecurityRuleExists = &AppError{"SECURITY_RULE_EXISTS", "rule ID already exists", 409, nil}
	ErrSecurityBuiltinRO  = &AppError{"SECURITY_BUILTIN_READONLY", "builtin rules are read-only, can only be disabled", 403, nil}
)

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

var (
	ErrBackupNotFound    = &AppError{"BACKUP_NOT_FOUND", "backup record not found", 404, nil}
	ErrBackupFailed      = &AppError{"BACKUP_FAILED", "backup failed", 500, nil}
	ErrBackupRestoreFail = &AppError{"BACKUP_RESTORE_FAILED", "backup restore failed", 500, nil}
	ErrBackupDeleteFail  = &AppError{"BACKUP_DELETE_FAILED", "backup deletion failed", 500, nil}
)

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

var (
	ErrSettingsQueryFail  = &AppError{"SETTINGS_QUERY_FAILED", "settings query failed", 500, nil}
	ErrSettingsUpdateFail = &AppError{"SETTINGS_UPDATE_FAILED", "settings update failed", 500, nil}
)

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

var (
	ErrSkillNotFound      = &AppError{"SKILL_NOT_FOUND", "skill not found", 404, nil}
	ErrSkillInstallFail   = &AppError{"SKILL_INSTALL_FAILED", "skill install failed", 500, nil}
	ErrSkillUninstallFail = &AppError{"SKILL_UNINSTALL_FAILED", "skill uninstall failed", 500, nil}
	ErrSkillUpdateFail    = &AppError{"SKILL_UPDATE_FAILED", "skill update failed", 500, nil}
	ErrSkillsReadFail     = &AppError{"SKILLS_READ_ERROR", "skills directory read failed", 500, nil}
	ErrSkillsPathError    = &AppError{"SKILLS_PATH_ERROR", "cannot determine user directory", 500, nil}
)

// ---------------------------------------------------------------------------
// OpenClaw
// ---------------------------------------------------------------------------

var (
	ErrOpenClawNotInstalled = &AppError{"OPENCLAW_NOT_INSTALLED", "openclaw is not installed", 412, nil}
	ErrUninstallFailed      = &AppError{"UNINSTALL_FAILED", "uninstall failed", 500, nil}
	ErrInstallFailed        = &AppError{"INSTALL_FAILED", "install failed", 500, nil}
	ErrScanError            = &AppError{"SCAN_ERROR", "scan failed", 500, nil}
)

// ---------------------------------------------------------------------------
// Monitor
// ---------------------------------------------------------------------------

var (
	ErrMonitorNotRunning = &AppError{"MONITOR_NOT_RUNNING", "monitor service not running", 409, nil}
	ErrLogReadFailed     = &AppError{"LOG_READ_ERROR", "log read failed", 500, nil}
	ErrLogParseFailed    = &AppError{"LOG_PARSE_ERROR", "log parse failed", 500, nil}
	ErrSSEError          = &AppError{"SSE_ERROR", "SSE stream error", 500, nil}
)

// ---------------------------------------------------------------------------
// Alert / Activity / Audit / Export
// ---------------------------------------------------------------------------

var (
	ErrAlertNotFound    = &AppError{"ALERT_NOT_FOUND", "alert not found", 404, nil}
	ErrAlertQueryFail   = &AppError{"ALERT_QUERY_FAILED", "alert query failed", 500, nil}
	ErrActivityNotFound = &AppError{"ACTIVITY_NOT_FOUND", "activity not found", 404, nil}
	ErrExportFailed     = &AppError{"EXPORT_FAILED", "export failed", 500, nil}
)

// ---------------------------------------------------------------------------
// ClawHub
// ---------------------------------------------------------------------------

var (
	ErrClawHubFailed = &AppError{"CLAWHUB_FAILED", "ClawHub request failed", 502, nil}
)

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

var (
	ErrTemplateNotFound   = &AppError{"TEMPLATE_NOT_FOUND", "template not found", 404, nil}
	ErrTemplateExists     = &AppError{"TEMPLATE_EXISTS", "template ID already exists", 409, nil}
	ErrTemplateCreateFail = &AppError{"TEMPLATE_CREATE_FAILED", "template creation failed", 500, nil}
	ErrTemplateUpdateFail = &AppError{"TEMPLATE_UPDATE_FAILED", "template update failed", 500, nil}
	ErrTemplateDeleteFail = &AppError{"TEMPLATE_DELETE_FAILED", "template deletion failed", 500, nil}
	ErrTemplateBuiltinRO  = &AppError{"TEMPLATE_BUILTIN_READONLY", "built-in templates are read-only", 403, nil}
)
