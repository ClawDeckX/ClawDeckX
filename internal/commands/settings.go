package commands

import (
	"flag"
	"fmt"
	"strings"

	"ClawDeckX/internal/appconfig"
	"ClawDeckX/internal/output"
)

func SettingsShow(args []string) int {
	fs := flag.NewFlagSet("settings show", flag.ContinueOnError)
	if err := fs.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		output.Printf("错误: %s\n", err)
		return 2
	}

	path := appconfig.ConfigPath()
	cfg, err := appconfig.Load(path)
	if err != nil {
		output.Printf("错误: 读取配置失败: %s\n", err)
		return 1
	}
	output.Println("ClawDeckX 配置")
	fmt.Printf("路径: %s\n", path)
	fmt.Printf("模式: %s\n", cfg.Mode)
	fmt.Printf("调试输出: %t\n", cfg.IsDebug())
	return 0
}

func SettingsSetMode(args []string) int {
	fs := flag.NewFlagSet("settings set-mode", flag.ContinueOnError)
	mode := fs.String("mode", appconfig.ModeProduction, "模式: production 或 debug")
	if err := fs.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		output.Printf("错误: %s\n", err)
		return 2
	}

	cfg := appconfig.Config{Mode: *mode}.Normalize()
	input := strings.ToLower(strings.TrimSpace(*mode))
	if input != appconfig.ModeProduction && input != appconfig.ModeDebug {
		output.Println("错误: mode 仅支持 production 或 debug")
		return 2
	}
	if err := appconfig.Save(appconfig.ConfigPath(), cfg); err != nil {
		output.Printf("错误: 保存配置失败: %s\n", err)
		return 1
	}
	output.SetDebug(cfg.IsDebug())
	output.Printf("已设置模式: %s\n", cfg.Mode)
	return 0
}
