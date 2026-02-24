package openclaw

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// ResolveOpenClawCmd 查找可用的 openclaw 命令（优先 openclaw，其次 openclaw-cn）
func ResolveOpenClawCmd() string {
	if _, err := exec.LookPath("openclaw"); err == nil {
		return "openclaw"
	}
	if _, err := exec.LookPath("openclaw-cn"); err == nil {
		return "openclaw-cn"
	}
	return ""
}

// IsOpenClawInstalled 检测 openclaw 是否已安装
func IsOpenClawInstalled() bool {
	return ResolveOpenClawCmd() != ""
}

// RunCLI 执行 openclaw CLI 命令，返回 stdout 和 error
func RunCLI(ctx context.Context, args ...string) (string, error) {
	cmd := ResolveOpenClawCmd()
	if cmd == "" {
		return "", fmt.Errorf("openclaw 未安装")
	}
	c := exec.CommandContext(ctx, cmd, args...)
	out, err := c.CombinedOutput()
	if err != nil {
		return strings.TrimSpace(string(out)), fmt.Errorf("%s %s: %s", cmd, strings.Join(args, " "), strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

// ConfigGet 通过 CLI 读取配置项
func ConfigGet(key string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return RunCLI(ctx, "config", "get", key, "--json")
}

// ConfigSet 通过 CLI 设置配置项（值为 JSON5 字符串）
func ConfigSet(key string, value string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := RunCLI(ctx, "config", "set", key, value, "--json")
	return err
}

// ConfigSetString 通过 CLI 设置字符串类型的配置项
func ConfigSetString(key string, value string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := RunCLI(ctx, "config", "set", key, value)
	return err
}

// ConfigUnset 通过 CLI 删除配置项
func ConfigUnset(key string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := RunCLI(ctx, "config", "unset", key)
	return err
}

// ConfigSetBatch 批量设置配置项（key → JSON value）
func ConfigSetBatch(pairs map[string]string) error {
	for key, value := range pairs {
		if err := ConfigSet(key, value); err != nil {
			return fmt.Errorf("设置 %s 失败: %w", key, err)
		}
	}
	return nil
}

// OnboardNonInteractive 使用非交互式 onboard 生成默认配置
func OnboardNonInteractive(opts OnboardOptions) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	args := []string{"onboard", "--non-interactive", "--accept-risk"}

	if opts.GatewayPort > 0 {
		args = append(args, "--gateway-port", fmt.Sprintf("%d", opts.GatewayPort))
	}
	if opts.GatewayBind != "" {
		args = append(args, "--gateway-bind", opts.GatewayBind)
	}
	if opts.GatewayAuth != "" {
		args = append(args, "--gateway-auth", opts.GatewayAuth)
	}
	if opts.GatewayToken != "" {
		args = append(args, "--gateway-token", opts.GatewayToken)
	}
	if opts.SkipHealth {
		args = append(args, "--skip-health")
	}
	if opts.JSON {
		args = append(args, "--json")
	}

	return RunCLI(ctx, args...)
}

// OnboardOptions 非交互式 onboard 选项
type OnboardOptions struct {
	GatewayPort  int
	GatewayBind  string
	GatewayAuth  string
	GatewayToken string
	SkipHealth   bool
	JSON         bool
}

// ConfigApplyFull 通过 CLI 全量写入配置（将整个 config 对象序列化后通过 config set 逐键写入）
// 这比直接写文件更安全，因为每次写入都经过 openclaw 的验证
func ConfigApplyFull(config map[string]interface{}) error {
	for key, value := range config {
		jsonValue, err := json.Marshal(value)
		if err != nil {
			return fmt.Errorf("序列化 %s 失败: %w", key, err)
		}
		if err := ConfigSet(key, string(jsonValue)); err != nil {
			return fmt.Errorf("设置 %s 失败: %w", key, err)
		}
	}
	return nil
}

// InitDefaultConfig 使用 openclaw CLI 安全地初始化默认配置
// 优先使用 onboard --non-interactive，降级为 config set 逐键写入
func InitDefaultConfig() (string, error) {
	cmd := ResolveOpenClawCmd()
	if cmd == "" {
		return "", fmt.Errorf("openclaw 未安装，无法生成配置")
	}

	// 方案1：尝试 onboard --non-interactive
	output, err := OnboardNonInteractive(OnboardOptions{
		GatewayPort: 18789,
		GatewayBind: "loopback",
		GatewayAuth: "token",
		SkipHealth:  true,
		JSON:        true,
	})
	if err == nil {
		return output, nil
	}

	// 方案2：降级为 config set 逐键写入
	// 先确保配置目录和空文件存在（writeConfigFile 会自动创建）
	pairs := map[string]string{
		"gateway.mode": `"local"`,
		"gateway.bind": `"loopback"`,
		"gateway.port": "18789",
	}

	for key, value := range pairs {
		if setErr := ConfigSet(key, value); setErr != nil {
			return "", fmt.Errorf("config set 降级也失败: onboard 错误: %v, config set 错误: %w", err, setErr)
		}
	}

	return "默认配置已通过 config set 生成", nil
}

// DetectOpenClawBinary 检测 openclaw 二进制文件信息
func DetectOpenClawBinary() (cmd string, version string, installed bool) {
	cmd = ResolveOpenClawCmd()
	if cmd == "" {
		return "", "", false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := RunCLI(ctx, "--version")
	if err != nil {
		return cmd, "", true
	}
	return cmd, out, true
}

// NpmUninstallGlobal 通过 npm uninstall -g 卸载全局包
func NpmUninstallGlobal(ctx context.Context, pkg string) (string, error) {
	c := exec.CommandContext(ctx, "npm", "uninstall", "-g", pkg)
	out, err := c.CombinedOutput()
	if err != nil {
		return strings.TrimSpace(string(out)), fmt.Errorf("npm uninstall -g %s: %s", pkg, strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

// RunCLIWithTimeout 执行 openclaw CLI 命令（带默认超时）
func RunCLIWithTimeout(args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return RunCLI(ctx, args...)
}

// IsWindows 检测是否为 Windows 系统
func IsWindows() bool {
	return runtime.GOOS == "windows"
}

// PairingRequest 配对请求
type PairingRequest struct {
	ID         string            `json:"id"`
	Code       string            `json:"code"`
	CreatedAt  string            `json:"createdAt"`
	LastSeenAt string            `json:"lastSeenAt"`
	Meta       map[string]string `json:"meta,omitempty"`
}

// PairingListResult 配对列表结果
type PairingListResult struct {
	Channel  string           `json:"channel"`
	Requests []PairingRequest `json:"requests"`
}

// PairingList 列出指定频道的待处理配对请求
func PairingList(channel string) (*PairingListResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := RunCLI(ctx, "pairing", "list", channel, "--json")
	if err != nil {
		return nil, err
	}
	var result PairingListResult
	if err := json.Unmarshal([]byte(out), &result); err != nil {
		return nil, fmt.Errorf("解析配对列表失败: %w", err)
	}
	return &result, nil
}

// PairingApprove 批准配对码
func PairingApprove(channel, code string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return RunCLI(ctx, "pairing", "approve", channel, code)
}
