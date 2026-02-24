package commands

import (
	"fmt"
	"os"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/webconfig"

	"golang.org/x/crypto/bcrypt"
)

func ResetPassword(args []string) int {
	if len(args) < 2 {
		fmt.Fprintln(os.Stderr, "用法: ClawDeckX reset-password <用户名> <新密码>")
		return 2
	}

	username := args[0]
	newPassword := args[1]

	if len(newPassword) < 6 {
		fmt.Fprintln(os.Stderr, "错误: 密码至少 6 位")
		return 1
	}

	cfg, err := webconfig.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "配置加载失败: %v\n", err)
		return 1
	}

	logger.Init(cfg.Log)

	if err := database.Init(cfg.Database, false); err != nil {
		fmt.Fprintf(os.Stderr, "数据库初始化失败: %v\n", err)
		return 1
	}
	defer database.Close()

	repo := database.NewUserRepo()
	user, err := repo.FindByUsername(username)
	if err != nil {
		fmt.Fprintf(os.Stderr, "用户 %s 不存在\n", username)
		return 1
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		fmt.Fprintf(os.Stderr, "密码加密失败: %v\n", err)
		return 1
	}

	if err := repo.UpdatePassword(user.ID, string(hash)); err != nil {
		fmt.Fprintf(os.Stderr, "密码更新失败: %v\n", err)
		return 1
	}

	fmt.Printf("用户 %s 的密码已重置\n", username)
	return 0
}
