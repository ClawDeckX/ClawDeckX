package commands

import (
	"flag"
	"fmt"
	"strings"

	"ClawDeckX/internal/appconfig"
	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/output"
)

func SettingsShow(args []string) int {
	fs := flag.NewFlagSet("settings show", flag.ContinueOnError)
	if err := fs.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		output.Printf(i18n.T(i18n.MsgCliError, map[string]interface{}{"Error": err.Error()}) + "\n")
		return 2
	}

	path := appconfig.ConfigPath()
	cfg, err := appconfig.Load(path)
	if err != nil {
		output.Println(i18n.T(i18n.MsgSettingsConfigReadFailed, map[string]interface{}{"Error": err.Error()}))
		return 1
	}
	output.Println(i18n.T(i18n.MsgSettingsConfigTitle))
	fmt.Println(i18n.T(i18n.MsgSettingsPath, map[string]interface{}{"Path": path}))
	fmt.Println(i18n.T(i18n.MsgSettingsMode, map[string]interface{}{"Mode": cfg.Mode}))
	fmt.Println(i18n.T(i18n.MsgSettingsDebug, map[string]interface{}{"Debug": cfg.IsDebug()}))
	return 0
}

func SettingsSetMode(args []string) int {
	fs := flag.NewFlagSet("settings set-mode", flag.ContinueOnError)
	mode := fs.String("mode", appconfig.ModeProduction, i18n.T(i18n.MsgSettingsModeFlag))
	if err := fs.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		output.Printf(i18n.T(i18n.MsgCliError, map[string]interface{}{"Error": err.Error()}) + "\n")
		return 2
	}

	cfg := appconfig.Config{Mode: *mode}.Normalize()
	input := strings.ToLower(strings.TrimSpace(*mode))
	if input != appconfig.ModeProduction && input != appconfig.ModeDebug {
		output.Println(i18n.T(i18n.MsgSettingsInvalidMode))
		return 2
	}
	if err := appconfig.Save(appconfig.ConfigPath(), cfg); err != nil {
		output.Println(i18n.T(i18n.MsgSettingsConfigSaveFailed, map[string]interface{}{"Error": err.Error()}))
		return 1
	}
	output.SetDebug(cfg.IsDebug())
	output.Println(i18n.T(i18n.MsgSettingsModeSet, map[string]interface{}{"Mode": cfg.Mode}))
	return 0
}
