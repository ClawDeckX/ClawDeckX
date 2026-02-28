package commands

import (
	"fmt"
	"os"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/webconfig"

	"golang.org/x/crypto/bcrypt"
)

func ResetPassword(args []string) int {
	if len(args) < 2 {
		fmt.Fprintln(os.Stderr, i18n.T(i18n.MsgResetPasswordUsage))
		return 2
	}

	username := args[0]
	newPassword := args[1]

	if len(newPassword) < 6 {
		fmt.Fprintln(os.Stderr, i18n.T(i18n.MsgResetPasswordTooShort))
		return 1
	}

	cfg, err := webconfig.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, i18n.T(i18n.MsgResetPasswordConfigLoadFailed, map[string]interface{}{"Error": err.Error()}))
		return 1
	}

	logger.Init(cfg.Log)

	if err := database.Init(cfg.Database, false); err != nil {
		fmt.Fprintln(os.Stderr, i18n.T(i18n.MsgResetPasswordDbInitFailed, map[string]interface{}{"Error": err.Error()}))
		return 1
	}
	defer database.Close()

	repo := database.NewUserRepo()
	user, err := repo.FindByUsername(username)
	if err != nil {
		fmt.Fprintln(os.Stderr, i18n.T(i18n.MsgResetPasswordUserNotFound, map[string]interface{}{"Username": username}))
		return 1
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		fmt.Fprintln(os.Stderr, i18n.T(i18n.MsgResetPasswordEncryptFailed, map[string]interface{}{"Error": err.Error()}))
		return 1
	}

	if err := repo.UpdatePassword(user.ID, string(hash)); err != nil {
		fmt.Fprintln(os.Stderr, i18n.T(i18n.MsgResetPasswordUpdateFailed, map[string]interface{}{"Error": err.Error()}))
		return 1
	}

	fmt.Println(i18n.T(i18n.MsgResetPasswordSuccess, map[string]interface{}{"Username": username}))
	return 0
}
