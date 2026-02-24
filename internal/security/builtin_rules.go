package security

import (
	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
)

// BuiltinRules 返回内置风险规则列表
func BuiltinRules() []database.RiskRule {
	return []database.RiskRule{
		// ========== Shell 高危命令 ==========
		{
			RuleID:   "builtin_shell_rm_rf",
			Category: constants.CategoryShell,
			Risk:     constants.RiskCritical,
			Pattern:  `(?i)rm\s+(-[a-z]*f[a-z]*\s+)?/`,
			Reason:   "检测到危险的递归删除命令",
			Actions:  `["abort","notify"]`,
		},
		{
			RuleID:   "builtin_shell_mkfs",
			Category: constants.CategoryShell,
			Risk:     constants.RiskCritical,
			Pattern:  `(?i)mkfs\.|format\s+[a-z]:`,
			Reason:   "检测到磁盘格式化命令",
			Actions:  `["abort","notify"]`,
		},
		{
			RuleID:   "builtin_shell_dd",
			Category: constants.CategoryShell,
			Risk:     constants.RiskCritical,
			Pattern:  `(?i)dd\s+if=.+of=/dev/`,
			Reason:   "检测到 dd 写入设备操作",
			Actions:  `["abort","notify"]`,
		},
		{
			RuleID:   "builtin_shell_shutdown",
			Category: constants.CategoryShell,
			Risk:     constants.RiskHigh,
			Pattern:  `(?i)(shutdown|reboot|init\s+[06]|poweroff)`,
			Reason:   "检测到系统关机/重启命令",
			Actions:  `["abort","notify"]`,
		},
		{
			RuleID:   "builtin_shell_passwd",
			Category: constants.CategoryShell,
			Risk:     constants.RiskHigh,
			Pattern:  `(?i)(passwd|useradd|userdel|usermod|groupadd)`,
			Reason:   "检测到用户/密码管理命令",
			Actions:  `["warn","notify"]`,
		},
		{
			RuleID:   "builtin_shell_chmod_777",
			Category: constants.CategoryShell,
			Risk:     constants.RiskHigh,
			Pattern:  `(?i)chmod\s+(777|a\+rwx)`,
			Reason:   "检测到过度开放的文件权限设置",
			Actions:  `["warn","notify"]`,
		},
		{
			RuleID:   "builtin_shell_curl_pipe",
			Category: constants.CategoryShell,
			Risk:     constants.RiskCritical,
			Pattern:  `(?i)(curl|wget)\s+.+\|\s*(sh|bash|zsh|python)`,
			Reason:   "检测到远程脚本直接执行（管道注入风险）",
			Actions:  `["abort","notify"]`,
		},
		{
			RuleID:   "builtin_shell_sudo",
			Category: constants.CategoryShell,
			Risk:     constants.RiskMedium,
			Pattern:  `(?i)sudo\s+`,
			Reason:   "检测到 sudo 提权操作",
			Actions:  `["warn"]`,
		},
		{
			RuleID:   "builtin_shell_pkg_install",
			Category: constants.CategoryShell,
			Risk:     constants.RiskMedium,
			Pattern:  `(?i)(pip|npm|yarn|apt|yum|brew|cargo)\s+install`,
			Reason:   "检测到包安装操作",
			Actions:  `["warn"]`,
		},

		// ========== 网络外连 ==========
		{
			RuleID:   "builtin_net_ssh",
			Category: constants.CategoryNetwork,
			Risk:     constants.RiskHigh,
			Pattern:  `(?i)ssh\s+\S+@`,
			Reason:   "检测到 SSH 外连操作",
			Actions:  `["warn","notify"]`,
		},
		{
			RuleID:   "builtin_net_reverse_shell",
			Category: constants.CategoryShell,
			Risk:     constants.RiskCritical,
			Pattern:  `(?i)(nc|ncat|netcat)\s+.+\s+-e\s+/bin/(sh|bash)|/dev/tcp/`,
			Reason:   "检测到疑似反弹 Shell",
			Actions:  `["abort","notify"]`,
		},
		{
			RuleID:   "builtin_net_scp_rsync",
			Category: constants.CategoryNetwork,
			Risk:     constants.RiskMedium,
			Pattern:  `(?i)(scp|rsync)\s+`,
			Reason:   "检测到远程文件传输",
			Actions:  `["warn"]`,
		},

		// ========== 文件敏感路径 ==========
		{
			RuleID:   "builtin_file_etc_passwd",
			Category: constants.CategoryFile,
			Risk:     constants.RiskHigh,
			Pattern:  `(?i)/etc/(passwd|shadow|sudoers)`,
			Reason:   "检测到访问系统敏感文件",
			Actions:  `["warn","notify"]`,
		},
		{
			RuleID:   "builtin_file_ssh_keys",
			Category: constants.CategoryFile,
			Risk:     constants.RiskHigh,
			Pattern:  `(?i)(\.ssh/|id_rsa|id_ed25519|authorized_keys)`,
			Reason:   "检测到访问 SSH 密钥文件",
			Actions:  `["warn","notify"]`,
		},
		{
			RuleID:   "builtin_file_env",
			Category: constants.CategoryFile,
			Risk:     constants.RiskMedium,
			Pattern:  `(?i)(\.env|\.env\.local|\.env\.production)`,
			Reason:   "检测到访问环境变量文件",
			Actions:  `["warn"]`,
		},
		{
			RuleID:   "builtin_file_openclaw_config",
			Category: constants.CategoryFile,
			Risk:     constants.RiskHigh,
			Pattern:  `(?i)\.openclaw/(openclaw\.json|moltbot\.json|clawdbot\.json)`,
			Reason:   "检测到访问 OpenClaw 配置文件（可能含 API Key）",
			Actions:  `["warn","notify"]`,
		},

		// ========== 凭据泄露 ==========
		{
			RuleID:   "builtin_cred_api_key",
			Category: "",
			Risk:     constants.RiskCritical,
			Pattern:  `(?i)(sk-ant-|sk-[a-z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|xoxb-|xoxp-)`,
			Reason:   "检测到疑似 API Key 泄露",
			Actions:  `["abort","notify"]`,
		},
		{
			RuleID:   "builtin_cred_private_key",
			Category: "",
			Risk:     constants.RiskCritical,
			Pattern:  `(?i)-----BEGIN\s+(RSA|EC|OPENSSH)\s+PRIVATE\s+KEY-----`,
			Reason:   "检测到私钥内容泄露",
			Actions:  `["abort","notify"]`,
		},

		// ========== 浏览器操作 ==========
		{
			RuleID:   "builtin_browser_screenshot",
			Category: constants.CategoryBrowser,
			Risk:     constants.RiskLow,
			Pattern:  `(?i)(screenshot|capture|puppeteer)`,
			Reason:   "检测到浏览器截图操作",
			Actions:  `["warn"]`,
		},
	}
}
