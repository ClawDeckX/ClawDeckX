package cli

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"ClawDeckX/internal/appconfig"
	"ClawDeckX/internal/commands"
	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/output"
	"ClawDeckX/internal/version"

	"golang.org/x/term"
)

func Run(args []string) int {
	cfgPath := appconfig.ConfigPath()
	cfg, err := appconfig.Load(cfgPath)
	if err != nil {
		output.Printf("警告: 读取 ClawDeckX 配置失败: %s\n", err)
		cfg = appconfig.Default()
	}
	output.SetDebug(cfg.IsDebug())
	output.Debugf("已加载配置: %s mode=%s\n", cfgPath, cfg.Mode)

	// Initialize i18n
	i18n.Init()

	// Language selection for interactive terminal mode (serve command only)
	if isInteractiveMode(args) && isTerminal() {
		i18n.SelectLanguageWithTimeout(5)
	} else {
		// Non-interactive: use system language
		i18n.SetLanguage(i18n.DetectSystemLanguage())
	}

	if len(args) < 2 {
		return commands.RunServe(nil)
	}

	switch args[1] {
	case "-h", "--help", "help":
		output.Println(usage())
		return 0
	case "-v", "--version", "version":
		output.Printf("ClawDeckX %s\n", version.Version)
		return 0
	case "doctor":
		return commands.Doctor(args[2:])
	case "settings":
		return handleSettings(args[2:])
	case "reset-password":
		return commands.ResetPassword(args[2:])
	default:
		// 所有其他参数传递给 serve
		return commands.RunServe(args[1:])
	}
}

func usage() string {
	b := &strings.Builder{}
	fmt.Fprintln(b, "ClawDeckX (ClawDeckX) - OpenClaw Web 管理后台")
	fmt.Fprintln(b, "")
	fmt.Fprintln(b, "用法:")
	fmt.Fprintln(b, "  ClawDeckX [参数]                启动 Web 管理后台")
	fmt.Fprintln(b, "  ClawDeckX <命令> [参数]")
	fmt.Fprintln(b, "")
	fmt.Fprintln(b, "参数:")
	fmt.Fprintln(b, "  -p, --port PORT       指定监听端口")
	fmt.Fprintln(b, "  -b, --bind ADDR       指定绑定地址 (默认 0.0.0.0)")
	fmt.Fprintln(b, "  -u, --user USER       初始管理员用户名")
	fmt.Fprintln(b, "      --password PASS   初始管理员密码 (需配合 --user)")
	fmt.Fprintln(b, "      --debug           启用调试模式")
	fmt.Fprintln(b, "  -h, --help            显示帮助")
	fmt.Fprintln(b, "  -v, --version         显示版本")
	fmt.Fprintln(b, "")
	fmt.Fprintln(b, "辅助命令:")
	fmt.Fprintln(b, "  doctor           诊断配置与环境")
	fmt.Fprintln(b, "  settings         查看/设置运行模式")
	fmt.Fprintln(b, "  reset-password   重置管理员密码")
	fmt.Fprintln(b, "")
	fmt.Fprintln(b, "示例:")
	fmt.Fprintln(b, "  ClawDeckX                                    # 启动 Web 后台")
	fmt.Fprintln(b, "  ClawDeckX -p 9090 -b 0.0.0.0                 # 指定端口和绑定地址")
	fmt.Fprintln(b, "  ClawDeckX -u admin --password mypass123       # 启动并创建初始用户")
	fmt.Fprintln(b, "  ClawDeckX doctor                             # 诊断环境")
	return b.String()
}

func handleSettings(args []string) int {
	if len(args) == 0 {
		output.Println(settingsUsage())
		return 2
	}
	switch args[0] {
	case "show":
		return commands.SettingsShow(args[1:])
	case "set-mode":
		return commands.SettingsSetMode(args[1:])
	default:
		output.Printf("未知 settings 子命令: %s\n\n", args[0])
		output.Println(settingsUsage())
		return 2
	}
}

func settingsUsage() string {
	return subUsage("settings", []string{
		"show      显示当前 ClawDeckX 配置",
		"set-mode  设置模式（production/debug）",
	})
}

func subUsage(name string, lines []string) string {
	b := &strings.Builder{}
	fmt.Fprintf(b, "用法:\n  ClawDeckX %s <子命令> [参数]\n\n", name)
	fmt.Fprintln(b, "子命令:")
	for _, line := range lines {
		fmt.Fprintf(b, "  %s\n", line)
	}
	return b.String()
}

var ErrInvalidArgs = errors.New(i18n.T(i18n.MsgErrInvalidArgs))

func PrintError(err error) {
	if err == nil {
		return
	}
	output.Printf("错误: %s\n", err)
	os.Exit(1)
}

// isInteractiveMode checks if the CLI is running in interactive mode (serve command).
func isInteractiveMode(args []string) bool {
	if len(args) < 2 {
		return true // Default to serve
	}
	cmd := args[1]
	// Non-interactive commands
	nonInteractive := []string{"-h", "--help", "help", "-v", "--version", "version", "doctor", "settings", "reset-password"}
	for _, ni := range nonInteractive {
		if cmd == ni {
			return false
		}
	}
	return true
}

// isTerminal checks if stdin is a terminal (not piped or redirected).
func isTerminal() bool {
	return term.IsTerminal(int(os.Stdin.Fd()))
}
