package commands

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/output"
)

func Doctor(args []string) int {
	fs := flag.NewFlagSet("doctor", flag.ContinueOnError)
	fix := fs.Bool("fix", false, i18n.T(i18n.MsgDoctorFixFlag))
	fixRuntime := fs.Bool("fix-runtime", false, i18n.T(i18n.MsgDoctorFixRuntimeFlag))
	rollbackRuntimeFix := fs.Bool("rollback-runtime-fix", false, i18n.T(i18n.MsgDoctorRollbackRuntimeFlag))
	path := fs.String("path", "~/.openclaw/openclaw.json", i18n.T(i18n.MsgDoctorPathFlag))
	if err := fs.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		output.Println(i18n.T(i18n.MsgCliError, map[string]interface{}{"Error": err.Error()}))
		return 2
	}

	if *fixRuntime {
		changed, err := fixOpenclawRuntimeNetworkInterfaces()
		if err != nil {
			output.Println(i18n.T(i18n.MsgDoctorRuntimeFixFailed, map[string]interface{}{"Error": err.Error()}))
			return 1
		}
		if changed {
			output.Println(i18n.T(i18n.MsgDoctorRuntimeFixDone))
		} else {
			output.Println(i18n.T(i18n.MsgDoctorRuntimeFixUptodate))
		}
		if !*fix {
			return 0
		}
	}

	if *rollbackRuntimeFix {
		changed, err := rollbackOpenclawRuntimeFix()
		if err != nil {
			output.Println(i18n.T(i18n.MsgDoctorRuntimeRollbackFailed, map[string]interface{}{"Error": err.Error()}))
			return 1
		}
		if changed {
			output.Println(i18n.T(i18n.MsgDoctorRuntimeRollbackDone))
		} else {
			output.Println(i18n.T(i18n.MsgDoctorRuntimeRollbackNotfound))
		}
		if !*fix && !*fixRuntime {
			return 0
		}
	}

	configPath := expandPath(*path)
	report := runDoctorChecks(configPath)
	output.Println(renderReport(report))

	if *fix {
		if err := runDoctorFixes(configPath, report); err != nil {
			output.Println("\n" + i18n.T(i18n.MsgDoctorAutofixFailed, map[string]interface{}{"Error": err.Error()}))
			return 1
		}
		output.Println("\n" + i18n.T(i18n.MsgDoctorAutofixDone))
		report = runDoctorChecks(configPath)
		output.Println(renderReport(report))
	}

	if report.HasErrors {
		return 1
	}
	return 0
}

type doctorIssue struct {
	Level      string
	Message    string
	Suggestion string
}

type doctorReport struct {
	Issues    []doctorIssue
	HasErrors bool
}

func runDoctorChecks(configPath string) doctorReport {
	issues := make([]doctorIssue, 0)
	hasErrors := false

	if _, err := os.Stat(configPath); err != nil {
		issues = append(issues, doctorIssue{
			Level:      "error",
			Message:    i18n.T(i18n.MsgDoctorConfigNotExist, map[string]interface{}{"Path": configPath}),
			Suggestion: i18n.T(i18n.MsgDoctorConfigNotExistSuggestion),
		})
		hasErrors = true
	} else {
		data, err := os.ReadFile(configPath)
		if err != nil {
			issues = append(issues, doctorIssue{
				Level:      "error",
				Message:    i18n.T(i18n.MsgDoctorConfigReadFailed),
				Suggestion: i18n.T(i18n.MsgDoctorConfigReadSuggestion),
			})
			hasErrors = true
		} else {
			var raw map[string]any
			if err := json.Unmarshal(data, &raw); err != nil {
				issues = append(issues, doctorIssue{
					Level:      "error",
					Message:    i18n.T(i18n.MsgDoctorConfigParseFailed),
					Suggestion: i18n.T(i18n.MsgDoctorConfigParseSuggestion),
				})
				hasErrors = true
			} else {
				gw, _ := raw["gateway"].(map[string]any)
				mode, _ := gw["mode"].(string)
				bind, _ := gw["bind"].(string)
				auth, _ := gw["auth"].(map[string]any)
				authToken := strings.TrimSpace(asString(auth["token"]))
				authMode := strings.TrimSpace(asString(auth["mode"]))
				authEnabled := authMode == "token" && authToken != ""
				if _, exists := auth["enabled"]; exists {
					issues = append(issues, doctorIssue{
						Level:      "warning",
						Message:    i18n.T(i18n.MsgDoctorDeprecatedAuthEnabled),
						Suggestion: i18n.T(i18n.MsgDoctorDeprecatedAuthSuggestion),
					})
				}

				if strings.TrimSpace(mode) == "" {
					issues = append(issues, doctorIssue{
						Level:      "error",
						Message:    i18n.T(i18n.MsgDoctorModeNotSet),
						Suggestion: i18n.T(i18n.MsgDoctorModeSuggestion),
					})
					hasErrors = true
				}
				if strings.TrimSpace(bind) == "" {
					issues = append(issues, doctorIssue{
						Level:      "error",
						Message:    i18n.T(i18n.MsgDoctorBindNotSet),
						Suggestion: i18n.T(i18n.MsgDoctorBindSuggestion),
					})
					hasErrors = true
				} else if !isLoopbackBind(bind) && !authEnabled {
					issues = append(issues, doctorIssue{
						Level:      "warning",
						Message:    i18n.T(i18n.MsgDoctorBindNoAuth),
						Suggestion: i18n.T(i18n.MsgDoctorBindNoAuthSuggestion),
					})
				}
				if authMode == "token" && authToken == "" {
					issues = append(issues, doctorIssue{
						Level:      "error",
						Message:    i18n.T(i18n.MsgDoctorTokenNotSet),
						Suggestion: i18n.T(i18n.MsgDoctorTokenSuggestion),
					})
					hasErrors = true
				}
				if strings.TrimSpace(mode) == "remote" {
					remote, _ := gw["remote"].(map[string]any)
					remoteURL := strings.TrimSpace(asString(remote["url"]))
					if remoteURL == "" {
						issues = append(issues, doctorIssue{
							Level:      "error",
							Message:    i18n.T(i18n.MsgDoctorRemoteUrlNotSet),
							Suggestion: i18n.T(i18n.MsgDoctorRemoteUrlSuggestion),
						})
						hasErrors = true
					} else if !strings.HasPrefix(remoteURL, "ws://") && !strings.HasPrefix(remoteURL, "wss://") {
						issues = append(issues, doctorIssue{
							Level:      "warning",
							Message:    i18n.T(i18n.MsgDoctorRemoteUrlInvalid),
							Suggestion: i18n.T(i18n.MsgDoctorRemoteUrlCheck),
						})
					}
					remoteToken := strings.TrimSpace(asString(remote["token"]))
					remotePwd := strings.TrimSpace(asString(remote["password"]))
					if remoteToken == "" && remotePwd == "" {
						issues = append(issues, doctorIssue{
							Level:      "warning",
							Message:    i18n.T(i18n.MsgDoctorRemoteNoAuth),
							Suggestion: i18n.T(i18n.MsgDoctorRemoteAuthCheck),
						})
					}
				}
			}
		}
	}

	envIssues, envHasErrors := checkEnvConfig(expandPath("~/.openclaw/env"))
	issues = append(issues, envIssues...)
	if envHasErrors {
		hasErrors = true
	}

	if _, err := os.Stat(filepath.Join(expandPath("~/.openclaw"), "backups")); err != nil {
		issues = append(issues, doctorIssue{
			Level:      "info",
			Message:    i18n.T(i18n.MsgDoctorBackupNotExist),
			Suggestion: i18n.T(i18n.MsgDoctorBackupSuggestion),
		})
	}

	svc := openclaw.NewService()
	st := svc.Status()
	if !st.Running {
		issues = append(issues, doctorIssue{
			Level:      "warning",
			Message:    i18n.T(i18n.MsgDoctorGatewayNotRunning),
			Suggestion: i18n.T(i18n.MsgDoctorGatewayStartSuggestion),
		})
	} else {
		issues = append(issues, doctorIssue{
			Level:      "info",
			Message:    i18n.T(i18n.MsgDoctorGatewayRunning),
			Suggestion: "",
		})
	}

	return doctorReport{Issues: issues, HasErrors: hasErrors}
}

func runDoctorFixes(configPath string, report doctorReport) error {
	needFix := false
	for _, issue := range report.Issues {
		if issue.Level == "error" || issue.Level == "warning" {
			needFix = true
			break
		}
	}
	if !needFix {
		return nil
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		return err
	}

	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	gw, ok := raw["gateway"].(map[string]any)
	if !ok {
		gw = map[string]any{}
		raw["gateway"] = gw
	}
	if strings.TrimSpace(asString(gw["mode"])) == "" {
		gw["mode"] = "local"
	}
	bind := strings.TrimSpace(asString(gw["bind"]))
	if bind == "" {
		gw["bind"] = "loopback"
		bind = "loopback"
	}
	if _, ok := gw["port"]; !ok {
		gw["port"] = 18789
	}

	auth, ok := gw["auth"].(map[string]any)
	if !ok {
		auth = map[string]any{}
		gw["auth"] = auth
	}
	delete(auth, "enabled")
	if !isLoopbackBind(bind) {
		if strings.TrimSpace(asString(auth["mode"])) == "" {
			auth["mode"] = "token"
		}
		if strings.TrimSpace(asString(auth["token"])) == "" {
			auth["token"] = generateToken(32)
		}
	}

	if err := backupExistingConfig(configPath); err != nil {
		return err
	}

	out, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(configPath, append(out, '\n'), 0o600); err != nil {
		return err
	}

	if changed, err := fixEnvConfig(expandPath("~/.openclaw/env")); err != nil {
		return err
	} else if changed {
		output.Println(i18n.T(i18n.MsgDoctorEnvFixDone))
	}
	return nil
}

func renderReport(report doctorReport) string {
	b := &strings.Builder{}
	fmt.Fprintln(b, output.Colorize("title", i18n.T(i18n.MsgDoctorTitle)))
	fmt.Fprintln(b, output.Colorize("dim", "===="))
	if len(report.Issues) == 0 {
		fmt.Fprintln(b, output.Colorize("success", i18n.T(i18n.MsgDoctorNoIssues)))
		return b.String()
	}

	for _, issue := range report.Issues {
		fmt.Fprintf(b, "%s %s\n", colorDoctorLevel(issue.Level), issue.Message)
		if issue.Suggestion != "" {
			fmt.Fprintf(b, "  %s %s\n", output.Colorize("dim", i18n.T(i18n.MsgDoctorSuggestion)), issue.Suggestion)
		}
	}
	return b.String()
}

func colorDoctorLevel(level string) string {
	switch strings.TrimSpace(level) {
	case "error":
		return output.Colorize("danger", i18n.T(i18n.MsgDoctorLevelError))
	case "warning":
		return output.Colorize("warning", i18n.T(i18n.MsgDoctorLevelWarning))
	case "info":
		return output.Colorize("accent", i18n.T(i18n.MsgDoctorLevelInfo))
	default:
		return "[" + level + "]"
	}
}

func isLoopbackBind(bind string) bool {
	normalized := strings.ToLower(strings.TrimSpace(bind))
	if normalized == "loopback" || normalized == "localhost" {
		return true
	}
	if strings.HasPrefix(normalized, "127.") || normalized == "::1" {
		return true
	}
	if strings.Contains(normalized, ":") {
		host, _, found := strings.Cut(normalized, ":")
		if !found {
			return false
		}
		return host == "127.0.0.1" || host == "localhost" || host == "::1"
	}
	return false
}

func asString(v any) string {
	s, _ := v.(string)
	return s
}

func backupExistingConfig(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	base := filepath.Base(path)
	dirs := []string{
		filepath.Join(expandPath("~/.openclaw"), "backups"),
		filepath.Join(filepath.Dir(path), "backups"),
	}
	var lastErr error
	for _, backupDir := range dirs {
		if err := os.MkdirAll(backupDir, 0o755); err != nil {
			lastErr = err
			continue
		}
		backupPath := filepath.Join(backupDir, fmt.Sprintf("%s.%s.bak", base, time.Now().Format("20060102-150405")))
		if err := os.WriteFile(backupPath, data, 0o600); err == nil {
			return nil
		} else {
			lastErr = err
		}
	}
	return lastErr
}

func checkEnvConfig(envPath string) ([]doctorIssue, bool) {
	issues := make([]doctorIssue, 0)
	hasErrors := false
	values, err := readEnvExports(envPath)
	if err != nil {
		issues = append(issues, doctorIssue{
			Level:      "error",
			Message:    i18n.T(i18n.MsgDoctorEnvReadFailed, map[string]interface{}{"Path": envPath}),
			Suggestion: i18n.T(i18n.MsgDoctorEnvReadSuggestion),
		})
		return issues, true
	}
	if len(values) == 0 {
		issues = append(issues, doctorIssue{
			Level:      "warning",
			Message:    i18n.T(i18n.MsgDoctorEnvNotConfigured),
			Suggestion: i18n.T(i18n.MsgDoctorEnvSuggestion),
		})
		return issues, false
	}

	provider := strings.ToLower(strings.TrimSpace(values["OPENCLAW_AI_PROVIDER"]))
	model := strings.TrimSpace(values["OPENCLAW_AI_MODEL"])
	baseURL := strings.TrimSpace(values["OPENCLAW_BASE_URL"])
	apiKey := strings.TrimSpace(values["OPENCLAW_API_KEY"])
	if provider == "" || model == "" {
		issues = append(issues, doctorIssue{
			Level:      "error",
			Message:    i18n.T(i18n.MsgDoctorAiModelNotConfigured),
			Suggestion: i18n.T(i18n.MsgDoctorAiModelSuggestion),
		})
		hasErrors = true
	} else {
		if provider == "custom" && baseURL == "" {
			issues = append(issues, doctorIssue{
				Level:      "error",
				Message:    i18n.T(i18n.MsgDoctorCustomBaseUrlMissing),
				Suggestion: i18n.T(i18n.MsgDoctorCustomBaseUrlSuggestion),
			})
			hasErrors = true
		}
		if baseURL != "" && !strings.HasPrefix(baseURL, "http://") && !strings.HasPrefix(baseURL, "https://") {
			issues = append(issues, doctorIssue{
				Level:      "warning",
				Message:    i18n.T(i18n.MsgDoctorBaseUrlInvalid),
				Suggestion: i18n.T(i18n.MsgDoctorBaseUrlCheck),
			})
		}
		if requiresAPIKey(provider) && apiKey == "" {
			issues = append(issues, doctorIssue{
				Level:      "warning",
				Message:    i18n.T(i18n.MsgDoctorApiKeyMissing),
				Suggestion: i18n.T(i18n.MsgDoctorApiKeySuggestion),
			})
		}
	}

	if strings.TrimSpace(values["OPENCLAW_BOT_NAME"]) == "" {
		issues = append(issues, doctorIssue{
			Level:      "warning",
			Message:    i18n.T(i18n.MsgDoctorBotNameMissing),
			Suggestion: i18n.T(i18n.MsgDoctorPersonaSuggestion),
		})
	}
	if strings.TrimSpace(values["OPENCLAW_USER_NAME"]) == "" {
		issues = append(issues, doctorIssue{
			Level:      "warning",
			Message:    i18n.T(i18n.MsgDoctorUserNameMissing),
			Suggestion: i18n.T(i18n.MsgDoctorPersonaSuggestion),
		})
	}
	if strings.TrimSpace(values["OPENCLAW_TIMEZONE"]) == "" {
		issues = append(issues, doctorIssue{
			Level:      "warning",
			Message:    i18n.T(i18n.MsgDoctorTimezoneMissing),
			Suggestion: i18n.T(i18n.MsgDoctorTimezoneSuggestion),
		})
	}

	platform := strings.ToLower(strings.TrimSpace(values["OPENCLAW_NOTIFY_PLATFORM"]))
	switch platform {
	case "":
		issues = append(issues, doctorIssue{
			Level:      "warning",
			Message:    i18n.T(i18n.MsgDoctorNotifyNotConfigured),
			Suggestion: i18n.T(i18n.MsgDoctorNotifySuggestion),
		})
	case "telegram":
		token := strings.TrimSpace(firstNonEmpty(os.Getenv("TELEGRAM_BOT_TOKEN"), values["TELEGRAM_BOT_TOKEN"]))
		chatID := strings.TrimSpace(firstNonEmpty(os.Getenv("TELEGRAM_CHAT_ID"), values["TELEGRAM_CHAT_ID"]))
		if token == "" || chatID == "" {
			issues = append(issues, doctorIssue{
				Level:      "warning",
				Message:    i18n.T(i18n.MsgDoctorTelegramIncomplete),
				Suggestion: i18n.T(i18n.MsgDoctorTelegramSuggestion),
			})
		}
	case "slack":
		if strings.TrimSpace(firstNonEmpty(os.Getenv("SLACK_WEBHOOK_URL"), values["SLACK_WEBHOOK_URL"])) == "" {
			issues = append(issues, doctorIssue{
				Level:      "warning",
				Message:    i18n.T(i18n.MsgDoctorSlackMissing),
				Suggestion: i18n.T(i18n.MsgDoctorNotifyReconfigure),
			})
		}
	case "feishu":
		if strings.TrimSpace(firstNonEmpty(os.Getenv("FEISHU_WEBHOOK_URL"), values["FEISHU_WEBHOOK_URL"])) == "" {
			issues = append(issues, doctorIssue{
				Level:      "warning",
				Message:    i18n.T(i18n.MsgDoctorFeishuMissing),
				Suggestion: i18n.T(i18n.MsgDoctorNotifyReconfigure),
			})
		}
	case "custom":
		if strings.TrimSpace(firstNonEmpty(os.Getenv("OPENCLAW_NOTIFY_WEBHOOK"), values["OPENCLAW_NOTIFY_WEBHOOK"])) == "" {
			issues = append(issues, doctorIssue{
				Level:      "warning",
				Message:    i18n.T(i18n.MsgDoctorCustomWebhookMissing),
				Suggestion: i18n.T(i18n.MsgDoctorNotifyReconfigure),
			})
		}
	default:
		issues = append(issues, doctorIssue{
			Level:      "warning",
			Message:    i18n.T(i18n.MsgDoctorNotifyUnknown) + platform,
			Suggestion: i18n.T(i18n.MsgDoctorNotifyReconfigure),
		})
	}

	return issues, hasErrors
}

func requiresAPIKey(provider string) bool {
	switch provider {
	case "openai", "anthropic", "gemini", "deepseek", "qwen":
		return true
	default:
		return false
	}
}

func fixEnvConfig(envPath string) (bool, error) {
	values, err := readEnvExports(envPath)
	if err != nil {
		return false, err
	}
	changed := false

	platform := strings.ToLower(strings.TrimSpace(values["OPENCLAW_NOTIFY_PLATFORM"]))
	if platform == "" {
		if strings.TrimSpace(values["TELEGRAM_BOT_TOKEN"]) != "" || strings.TrimSpace(values["TELEGRAM_CHAT_ID"]) != "" {
			values["OPENCLAW_NOTIFY_PLATFORM"] = "telegram"
			changed = true
		} else if strings.TrimSpace(values["SLACK_WEBHOOK_URL"]) != "" {
			values["OPENCLAW_NOTIFY_PLATFORM"] = "slack"
			changed = true
		} else if strings.TrimSpace(values["FEISHU_WEBHOOK_URL"]) != "" {
			values["OPENCLAW_NOTIFY_PLATFORM"] = "feishu"
			changed = true
		} else if strings.TrimSpace(values["OPENCLAW_NOTIFY_WEBHOOK"]) != "" {
			values["OPENCLAW_NOTIFY_PLATFORM"] = "custom"
			changed = true
		}
	}

	provider := strings.ToLower(strings.TrimSpace(values["OPENCLAW_AI_PROVIDER"]))
	if provider == "" && strings.TrimSpace(values["OPENCLAW_BASE_URL"]) != "" {
		values["OPENCLAW_AI_PROVIDER"] = "custom"
		changed = true
	}

	if strings.TrimSpace(values["OPENCLAW_TIMEZONE"]) == "" {
		if tz := strings.TrimSpace(os.Getenv("TZ")); tz != "" {
			values["OPENCLAW_TIMEZONE"] = tz
			changed = true
		}
	}

	if !changed {
		return false, nil
	}
	if err := writeEnvExports(envPath, values); err != nil {
		return false, err
	}
	return true, nil
}
