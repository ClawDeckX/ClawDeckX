package commands

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/output"
)

func Doctor(args []string) int {
	fs := flag.NewFlagSet("doctor", flag.ContinueOnError)
	fix := fs.Bool("fix", false, "尝试安全修复")
	fixRuntime := fs.Bool("fix-runtime", false, "修复 OpenClaw 运行时启动崩溃（networkInterfaces）")
	rollbackRuntimeFix := fs.Bool("rollback-runtime-fix", false, "回滚 OpenClaw 运行时热修复（恢复最近备份）")
	path := fs.String("path", "~/.openclaw/openclaw.json", "配置路径")
	if err := fs.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		output.Printf("错误: %s\n", err)
		return 2
	}

	if *fixRuntime {
		changed, err := fixOpenclawRuntimeNetworkInterfaces()
		if err != nil {
			output.Printf("运行时修复失败: %s\n", err)
			return 1
		}
		if changed {
			output.Println("运行时修复完成。")
		} else {
			output.Println("运行时修复已是最新状态，无需修改。")
		}
		if !*fix {
			return 0
		}
	}

	if *rollbackRuntimeFix {
		changed, err := rollbackOpenclawRuntimeFix()
		if err != nil {
			output.Printf("运行时回滚失败: %s\n", err)
			return 1
		}
		if changed {
			output.Println("运行时回滚完成。")
		} else {
			output.Println("未找到可回滚的运行时备份。")
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
			output.Printf("\n自动修复失败: %s\n", err)
			return 1
		}
		output.Println("\n自动修复完成。")
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
			Level:      "错误",
			Message:    "配置文件不存在: " + configPath,
			Suggestion: "运行 `ClawDeckX init` 生成最小安全配置",
		})
		hasErrors = true
	} else {
		data, err := os.ReadFile(configPath)
		if err != nil {
			issues = append(issues, doctorIssue{
				Level:      "错误",
				Message:    "配置文件读取失败",
				Suggestion: "检查文件权限",
			})
			hasErrors = true
		} else {
			var raw map[string]any
			if err := json.Unmarshal(data, &raw); err != nil {
				issues = append(issues, doctorIssue{
					Level:      "错误",
					Message:    "配置 JSON 解析失败",
					Suggestion: "修正配置格式或重新运行 `ClawDeckX init`",
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
						Level:      "警告",
						Message:    "检测到已废弃配置项 gateway.auth.enabled",
						Suggestion: "运行 `ClawDeckX doctor --fix` 自动迁移并移除该字段",
					})
				}

				if strings.TrimSpace(mode) == "" {
					issues = append(issues, doctorIssue{
						Level:      "错误",
						Message:    "未设置 gateway.mode",
						Suggestion: "建议设置为 `local`",
					})
					hasErrors = true
				}
				if strings.TrimSpace(bind) == "" {
					issues = append(issues, doctorIssue{
						Level:      "错误",
						Message:    "未设置 gateway.bind",
						Suggestion: "建议设置为 `loopback`",
					})
					hasErrors = true
				} else if !isLoopbackBind(bind) && !authEnabled {
					issues = append(issues, doctorIssue{
						Level:      "警告",
						Message:    "网关绑定非回环地址且未启用鉴权",
						Suggestion: "设置 gateway.auth.mode=token 和 gateway.auth.token，或改为回环地址",
					})
				}
				if authMode == "token" && authToken == "" {
					issues = append(issues, doctorIssue{
						Level:      "错误",
						Message:    "gateway.auth.mode=token 但未设置 gateway.auth.token",
						Suggestion: "设置 gateway.auth.token 或切换为回环地址",
					})
					hasErrors = true
				}
				if strings.TrimSpace(mode) == "remote" {
					remote, _ := gw["remote"].(map[string]any)
					remoteURL := strings.TrimSpace(asString(remote["url"]))
					if remoteURL == "" {
						issues = append(issues, doctorIssue{
							Level:      "错误",
							Message:    "gateway.mode=remote 但未设置 gateway.remote.url",
							Suggestion: "设置远程网关地址（如 ws://host:18789）",
						})
						hasErrors = true
					} else if !strings.HasPrefix(remoteURL, "ws://") && !strings.HasPrefix(remoteURL, "wss://") {
						issues = append(issues, doctorIssue{
							Level:      "警告",
							Message:    "gateway.remote.url 不是 ws:// 或 wss:// 开头",
							Suggestion: "请检查远程网关地址",
						})
					}
					remoteToken := strings.TrimSpace(asString(remote["token"]))
					remotePwd := strings.TrimSpace(asString(remote["password"]))
					if remoteToken == "" && remotePwd == "" {
						issues = append(issues, doctorIssue{
							Level:      "警告",
							Message:    "远程网关未配置 token/password",
							Suggestion: "确认远程网关是否需要鉴权",
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
			Level:      "信息",
			Message:    "备份目录不存在",
			Suggestion: "首次写配置后会自动创建",
		})
	}

	svc := openclaw.NewService()
	st := svc.Status()
	if !st.Running {
		issues = append(issues, doctorIssue{
			Level:      "警告",
			Message:    "网关未运行",
			Suggestion: "运行 `ClawDeckX gateway start` 启动",
		})
	} else {
		issues = append(issues, doctorIssue{
			Level:      "信息",
			Message:    "网关运行正常",
			Suggestion: "",
		})
	}

	return doctorReport{Issues: issues, HasErrors: hasErrors}
}

func runDoctorFixes(configPath string, report doctorReport) error {
	needFix := false
	for _, issue := range report.Issues {
		if issue.Level == "错误" || issue.Level == "警告" {
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
		output.Println("已自动修复环境变量配置。")
	}
	return nil
}

func renderReport(report doctorReport) string {
	b := &strings.Builder{}
	fmt.Fprintln(b, output.Colorize("title", "诊断"))
	fmt.Fprintln(b, output.Colorize("dim", "===="))
	if len(report.Issues) == 0 {
		fmt.Fprintln(b, output.Colorize("success", "未发现问题。"))
		return b.String()
	}

	for _, issue := range report.Issues {
		fmt.Fprintf(b, "%s %s\n", colorDoctorLevel(issue.Level), issue.Message)
		if issue.Suggestion != "" {
			fmt.Fprintf(b, "  %s %s\n", output.Colorize("dim", "建议:"), issue.Suggestion)
		}
	}
	return b.String()
}

func colorDoctorLevel(level string) string {
	switch strings.TrimSpace(level) {
	case "错误":
		return output.Colorize("danger", "[错误]")
	case "警告":
		return output.Colorize("warning", "[警告]")
	case "信息":
		return output.Colorize("accent", "[信息]")
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
			Level:      "错误",
			Message:    "环境变量配置读取失败: " + envPath,
			Suggestion: "检查文件权限或重新运行向导",
		})
		return issues, true
	}
	if len(values) == 0 {
		issues = append(issues, doctorIssue{
			Level:      "警告",
			Message:    "未检测到环境变量配置",
			Suggestion: "运行 `ClawDeckX model wizard` / `ClawDeckX channels wizard` 进行配置",
		})
		return issues, false
	}

	provider := strings.ToLower(strings.TrimSpace(values["OPENCLAW_AI_PROVIDER"]))
	model := strings.TrimSpace(values["OPENCLAW_AI_MODEL"])
	baseURL := strings.TrimSpace(values["OPENCLAW_BASE_URL"])
	apiKey := strings.TrimSpace(values["OPENCLAW_API_KEY"])
	if provider == "" || model == "" {
		issues = append(issues, doctorIssue{
			Level:      "错误",
			Message:    "未配置 AI 模型",
			Suggestion: "运行 `ClawDeckX model wizard` 配置模型",
		})
		hasErrors = true
	} else {
		if provider == "custom" && baseURL == "" {
			issues = append(issues, doctorIssue{
				Level:      "错误",
				Message:    "自定义模型未设置 Base URL",
				Suggestion: "在模型配置中填写自定义端点",
			})
			hasErrors = true
		}
		if baseURL != "" && !strings.HasPrefix(baseURL, "http://") && !strings.HasPrefix(baseURL, "https://") {
			issues = append(issues, doctorIssue{
				Level:      "警告",
				Message:    "Base URL 不是 http(s):// 开头",
				Suggestion: "请检查自定义端点配置",
			})
		}
		if requiresAPIKey(provider) && apiKey == "" {
			issues = append(issues, doctorIssue{
				Level:      "警告",
				Message:    "模型提供商未配置 API Key",
				Suggestion: "补充 API Key 或切换为无需密钥的模型",
			})
		}
	}

	if strings.TrimSpace(values["OPENCLAW_BOT_NAME"]) == "" {
		issues = append(issues, doctorIssue{
			Level:      "警告",
			Message:    "未设置助手名称",
			Suggestion: "运行 `ClawDeckX persona wizard` 设置助手风格",
		})
	}
	if strings.TrimSpace(values["OPENCLAW_USER_NAME"]) == "" {
		issues = append(issues, doctorIssue{
			Level:      "警告",
			Message:    "未设置用户称呼",
			Suggestion: "运行 `ClawDeckX persona wizard` 设置助手风格",
		})
	}
	if strings.TrimSpace(values["OPENCLAW_TIMEZONE"]) == "" {
		issues = append(issues, doctorIssue{
			Level:      "警告",
			Message:    "未设置时区",
			Suggestion: "运行 `ClawDeckX persona wizard` 设置时区",
		})
	}

	platform := strings.ToLower(strings.TrimSpace(values["OPENCLAW_NOTIFY_PLATFORM"]))
	switch platform {
	case "":
		issues = append(issues, doctorIssue{
			Level:      "警告",
			Message:    "未配置通知平台",
			Suggestion: "运行 `ClawDeckX channels wizard` 配置通知",
		})
	case "telegram":
		token := strings.TrimSpace(firstNonEmpty(os.Getenv("TELEGRAM_BOT_TOKEN"), values["TELEGRAM_BOT_TOKEN"]))
		chatID := strings.TrimSpace(firstNonEmpty(os.Getenv("TELEGRAM_CHAT_ID"), values["TELEGRAM_CHAT_ID"]))
		if token == "" || chatID == "" {
			issues = append(issues, doctorIssue{
				Level:      "警告",
				Message:    "Telegram 通知未完整配置",
				Suggestion: "设置 TELEGRAM_BOT_TOKEN 与 TELEGRAM_CHAT_ID",
			})
		}
	case "slack":
		if strings.TrimSpace(firstNonEmpty(os.Getenv("SLACK_WEBHOOK_URL"), values["SLACK_WEBHOOK_URL"])) == "" {
			issues = append(issues, doctorIssue{
				Level:      "警告",
				Message:    "Slack Webhook 未配置",
				Suggestion: "运行 `ClawDeckX channels wizard` 配置",
			})
		}
	case "feishu":
		if strings.TrimSpace(firstNonEmpty(os.Getenv("FEISHU_WEBHOOK_URL"), values["FEISHU_WEBHOOK_URL"])) == "" {
			issues = append(issues, doctorIssue{
				Level:      "警告",
				Message:    "飞书 Webhook 未配置",
				Suggestion: "运行 `ClawDeckX channels wizard` 配置",
			})
		}
	case "custom":
		if strings.TrimSpace(firstNonEmpty(os.Getenv("OPENCLAW_NOTIFY_WEBHOOK"), values["OPENCLAW_NOTIFY_WEBHOOK"])) == "" {
			issues = append(issues, doctorIssue{
				Level:      "警告",
				Message:    "自定义 Webhook 未配置",
				Suggestion: "运行 `ClawDeckX channels wizard` 配置",
			})
		}
	default:
		issues = append(issues, doctorIssue{
			Level:      "警告",
			Message:    "通知平台未识别: " + platform,
			Suggestion: "运行 `ClawDeckX channels wizard` 重新配置",
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
