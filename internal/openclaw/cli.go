package openclaw

import (
	"ClawDeckX/internal/i18n"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

func ResolveOpenClawCmd() string {
	if _, err := exec.LookPath("openclaw"); err == nil {
		return "openclaw"
	}
	if _, err := exec.LookPath("openclaw-cn"); err == nil {
		return "openclaw-cn"
	}
	return ""
}

func IsOpenClawInstalled() bool {
	return ResolveOpenClawCmd() != ""
}

func RunCLI(ctx context.Context, args ...string) (string, error) {
	cmd := ResolveOpenClawCmd()
	if cmd == "" {
		return "", fmt.Errorf("%s", i18n.T(i18n.MsgErrOpenclawNotInstalled))
	}
	c := exec.CommandContext(ctx, cmd, args...)
	out, err := c.CombinedOutput()
	if err != nil {
		return strings.TrimSpace(string(out)), fmt.Errorf("%s %s: %s", cmd, strings.Join(args, " "), strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

func ConfigGet(key string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return RunCLI(ctx, "config", "get", key, "--json")
}

func ConfigSet(key string, value string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := RunCLI(ctx, "config", "set", key, value, "--json")
	return err
}

func ConfigSetString(key string, value string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := RunCLI(ctx, "config", "set", key, value)
	return err
}

func ConfigUnset(key string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := RunCLI(ctx, "config", "unset", key)
	return err
}

func ConfigSetBatch(pairs map[string]string) error {
	for key, value := range pairs {
		if err := ConfigSet(key, value); err != nil {
			return fmt.Errorf("%s", fmt.Sprintf(i18n.T(i18n.MsgErrConfigSetFailed), key, err))
		}
	}
	return nil
}

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

type OnboardOptions struct {
	GatewayPort  int
	GatewayBind  string
	GatewayAuth  string
	GatewayToken string
	SkipHealth   bool
	JSON         bool
}

type ConfigValidateIssue struct {
	Path    string `json:"path"`
	Level   string `json:"level"`
	Message string `json:"message"`
	Hint    string `json:"hint,omitempty"`
}

type ConfigValidateResult struct {
	OK      bool                  `json:"ok"`
	Code    string                `json:"code"`
	Summary string                `json:"summary"`
	Issues  []ConfigValidateIssue `json:"issues"`
}

func ConfigValidate(config map[string]interface{}) (*ConfigValidateResult, error) {
	if !IsOpenClawInstalled() {
		return nil, fmt.Errorf("openclaw CLI is unavailable")
	}

	stateDir, err := os.MkdirTemp("", "openclaw-validate-*")
	if err != nil {
		return nil, fmt.Errorf("create temp state dir: %w", err)
	}
	defer os.RemoveAll(stateDir)

	cfgPath := stateDir + string(os.PathSeparator) + "openclaw.json"
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal config: %w", err)
	}
	if err := os.WriteFile(cfgPath, data, 0o600); err != nil {
		return nil, fmt.Errorf("write temp config: %w", err)
	}

	cmdName := ResolveOpenClawCmd()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, cmdName, "doctor", "--json")
	cmd.Env = append(os.Environ(),
		"OPENCLAW_STATE_DIR="+stateDir,
		"OPENCLAW_CONFIG_PATH="+cfgPath,
	)
	outBytes, runErr := cmd.CombinedOutput()
	out := strings.TrimSpace(string(outBytes))
	if runErr != nil {
		if out == "" {
			out = runErr.Error()
		}
		return nil, fmt.Errorf("%s doctor --json: %s", cmdName, out)
	}

	var doc map[string]interface{}
	if err := json.Unmarshal([]byte(out), &doc); err != nil {
		return nil, fmt.Errorf("parse doctor json: %w", err)
	}

	issues := make([]ConfigValidateIssue, 0)
	if rawChecks, ok := doc["checks"].([]interface{}); ok {
		for _, c := range rawChecks {
			m, ok := c.(map[string]interface{})
			if !ok {
				continue
			}
			status, _ := m["status"].(string)
			if status == "pass" {
				continue
			}
			name, _ := m["name"].(string)
			msg, _ := m["message"].(string)
			hint, _ := m["suggestion"].(string)
			level := "error"
			if status == "warn" {
				level = "warn"
			}
			issues = append(issues, ConfigValidateIssue{
				Path:    name,
				Level:   level,
				Message: msg,
				Hint:    hint,
			})
		}
	}

	if len(issues) > 0 {
		return &ConfigValidateResult{
			OK:      false,
			Code:    "CONFIG_VALIDATE_FAILED",
			Summary: fmt.Sprintf("%d issue(s) found", len(issues)),
			Issues:  issues,
		}, nil
	}

	return &ConfigValidateResult{
		OK:      true,
		Code:    "CONFIG_VALIDATE_OK",
		Summary: "validation passed",
		Issues:  issues,
	}, nil
}

func ConfigApplyFull(config map[string]interface{}) error {
	for key, value := range config {
		jsonValue, err := json.Marshal(value)
		if err != nil {
			return fmt.Errorf("%s", fmt.Sprintf(i18n.T(i18n.MsgErrSerializeKeyFailed), key, err))
		}
		if err := ConfigSet(key, string(jsonValue)); err != nil {
			return fmt.Errorf("%s", fmt.Sprintf(i18n.T(i18n.MsgErrConfigSetFailed), key, err))
		}
	}
	return nil
}

func InitDefaultConfig() (string, error) {
	cmd := ResolveOpenClawCmd()
	if cmd == "" {
		return "", fmt.Errorf("%s", i18n.T(i18n.MsgErrOpenclawNotInstalledNoConfig))
	}

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

	// Check if the error is due to Node version being too old.
	// openclaw prints "requires Node >=X.Y.Z" when the version is insufficient.
	errStr := err.Error()
	if strings.Contains(errStr, "requires Node") || strings.Contains(errStr, "Upgrade Node") {
		return "", fmt.Errorf("%s", i18n.T(i18n.MsgErrNodeVersionTooOld))
	}

	pairs := map[string]string{
		"gateway.mode": `"local"`,
		"gateway.bind": `"loopback"`,
		"gateway.port": "18789",
	}

	for key, value := range pairs {
		if setErr := ConfigSet(key, value); setErr != nil {
			// Also check config set error for Node version issue
			setErrStr := setErr.Error()
			if strings.Contains(setErrStr, "requires Node") || strings.Contains(setErrStr, "Upgrade Node") {
				return "", fmt.Errorf("%s", i18n.T(i18n.MsgErrNodeVersionTooOld))
			}
			return "", fmt.Errorf("%s", fmt.Sprintf(i18n.T(i18n.MsgErrConfigSetFallbackFailed), err, setErr))
		}
	}

	return i18n.T(i18n.MsgCliDefaultConfigGenerated), nil
}

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

func NpmUninstallGlobal(ctx context.Context, pkg string) (string, error) {
	cmdStr := "npm uninstall -g " + pkg
	if runtime.GOOS != "windows" && !isRunningAsRoot() {
		cmdStr = "sudo " + cmdStr
	}
	c := exec.CommandContext(ctx, "sh", "-c", cmdStr)
	out, err := c.CombinedOutput()
	if err != nil {
		return strings.TrimSpace(string(out)), fmt.Errorf("npm uninstall -g %s: %s", pkg, strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

func isRunningAsRoot() bool {
	if runtime.GOOS == "windows" {
		return false
	}
	return os.Getuid() == 0
}

func RunCLIWithTimeout(args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return RunCLI(ctx, args...)
}

func IsWindows() bool {
	return runtime.GOOS == "windows"
}

type PairingRequest struct {
	ID         string            `json:"id"`
	Code       string            `json:"code"`
	CreatedAt  string            `json:"createdAt"`
	LastSeenAt string            `json:"lastSeenAt"`
	Meta       map[string]string `json:"meta,omitempty"`
}

type PairingListResult struct {
	Channel  string           `json:"channel"`
	Requests []PairingRequest `json:"requests"`
}

func PairingList(channel string) (*PairingListResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := RunCLI(ctx, "pairing", "list", channel, "--json")
	if err != nil {
		return nil, err
	}
	var result PairingListResult
	if err := json.Unmarshal([]byte(out), &result); err != nil {
		return nil, fmt.Errorf("%s", fmt.Sprintf(i18n.T(i18n.MsgErrParsePairingListFailed), err))
	}
	return &result, nil
}

func PairingApprove(channel, code string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return RunCLI(ctx, "pairing", "approve", channel, code)
}
