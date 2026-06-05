package openclaw

import (
	"ClawDeckX/internal/executil"
	"ClawDeckX/internal/i18n"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

func ResolveOpenClawCmd() string {
	// Fast path: check cache first
	discoveryMu.RLock()
	if discoveryDone {
		p := discoveredPath
		discoveryMu.RUnlock()
		return p
	}
	discoveryMu.RUnlock()

	// Full discovery scan
	discoveryMu.Lock()
	defer discoveryMu.Unlock()
	if discoveryDone {
		return discoveredPath
	}
	discoveredPath = discoverOpenClawBinary()
	discoveryDone = true
	return discoveredPath
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
	executil.HideWindow(c)
	c.Env = appendOpenClawEnv(os.Environ())
	out, err := c.CombinedOutput()
	if err != nil {
		return strings.TrimSpace(string(out)), fmt.Errorf("%s %s: %s", cmd, strings.Join(args, " "), strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

func appendOpenClawEnv(env []string) []string {
	if stateDir := ResolveStateDir(); stateDir != "" && envValue(env, "OPENCLAW_STATE_DIR") == "" {
		env = append(env, "OPENCLAW_STATE_DIR="+stateDir)
	}
	if cfgPath := ResolveConfigPath(); cfgPath != "" && envValue(env, "OPENCLAW_CONFIG_PATH") == "" {
		env = append(env, "OPENCLAW_CONFIG_PATH="+cfgPath)
	}
	return env
}

func envValue(env []string, key string) string {
	prefix := key + "="
	for _, entry := range env {
		if strings.HasPrefix(entry, prefix) {
			return strings.TrimSpace(strings.TrimPrefix(entry, prefix))
		}
	}
	return ""
}

func ConfigGet(key string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return RunCLI(ctx, "config", "get", key, "--json")
}

func ConfigSet(key string, value string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := RunCLI(ctx, "config", "set", key, value, "--json")
	if err != nil {
		// openclaw config set may exit non-zero but still succeed.
		// Detect success by checking for "Updated" + "Restart the gateway" in output.
		if strings.Contains(out, "Updated") && strings.Contains(out, "gateway") {
			return nil
		}
	}
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
	executil.HideWindow(cmd)
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
		return cmd, "", false
	}
	out = strings.TrimSpace(out)
	if out == "" {
		return cmd, "", false
	}
	return cmd, out, true
}

func NpmUninstallGlobal(ctx context.Context, pkg string) (string, error) {
	var c *exec.Cmd
	if runtime.GOOS == "windows" {
		c = exec.CommandContext(ctx, "cmd", "/c", "npm", "uninstall", "-g", pkg)
	} else {
		cmdStr := "npm uninstall -g " + pkg
		if !isRunningAsRoot() {
			cmdStr = "sudo " + cmdStr
		}
		c = exec.CommandContext(ctx, "sh", "-c", cmdStr)
	}
	executil.HideWindow(c)
	out, err := c.CombinedOutput()
	if err != nil {
		return strings.TrimSpace(string(out)), fmt.Errorf("npm uninstall -g %s: %s", pkg, strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

// ForceRemoveOpenClaw removes OpenClaw files directly from disk. Used as a
// pre-install step on all platforms to bypass npm's "retire" rename, which
// fails when processes hold file handles (Windows: Defender/indexers; Linux/macOS:
// running gateway). Also used as a last-resort fallback after lock-retry exhaustion.
func ForceRemoveOpenClaw(pkg string) error {
	npmGlobalDir := resolveNpmGlobalDir()
	if npmGlobalDir == "" {
		return fmt.Errorf("cannot determine npm global directory")
	}

	// Remove the package directory
	pkgDir := filepath.Join(npmGlobalDir, "node_modules", pkg)
	if err := forceRemoveDir(pkgDir); err != nil {
		return fmt.Errorf("failed to remove %s: %w", pkgDir, err)
	}

	// Remove bin files
	binNames := []string{pkg}
	if runtime.GOOS == "windows" {
		binNames = append(binNames, pkg+".cmd", pkg+".ps1")
	}
	for _, name := range binNames {
		_ = os.Remove(filepath.Join(npmGlobalDir, name))
	}

	// Clean up npm temp directories (e.g., .openclaw-Fs1wLkSf)
	entries, _ := os.ReadDir(filepath.Join(npmGlobalDir, "node_modules"))
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "."+pkg+"-") {
			_ = forceRemoveDir(filepath.Join(npmGlobalDir, "node_modules", e.Name()))
		}
	}

	return nil
}

// forceRemoveDir removes a directory, falling back to `cmd /c rd /s /q` on
// Windows when Go's os.RemoveAll fails (e.g., file held by Defender/indexer).
func forceRemoveDir(dir string) error {
	if _, err := os.Stat(dir); err != nil {
		return nil // already gone
	}
	if err := os.RemoveAll(dir); err == nil {
		return nil
	}
	if runtime.GOOS != "windows" {
		return os.RemoveAll(dir) // retry once on Unix
	}
	// Windows: rd /s /q is more aggressive than Go's RemoveAll and can
	// remove files that are transiently locked by Defender/indexer.
	c := exec.Command("cmd", "/c", "rd", "/s", "/q", dir)
	executil.HideWindow(c)
	_ = c.Run()
	// If still present, try takeown + icacls + rd (mirrors uninstall script)
	if _, err := os.Stat(dir); err == nil {
		_ = exec.Command("cmd", "/c", "takeown", "/F", dir, "/R", "/D", "Y").Run()
		_ = exec.Command("cmd", "/c", "icacls", dir, "/grant", os.Getenv("USERNAME")+":F", "/T", "/C", "/Q").Run()
		c2 := exec.Command("cmd", "/c", "rd", "/s", "/q", dir)
		executil.HideWindow(c2)
		_ = c2.Run()
	}
	if _, err := os.Stat(dir); err == nil {
		return fmt.Errorf("directory still exists after force removal: %s", dir)
	}
	return nil
}

// ResolveNpmGlobalDir returns the npm global prefix directory (exported wrapper).
func ResolveNpmGlobalDir() string { return resolveNpmGlobalDir() }

// resolveNpmGlobalDir returns the npm global prefix directory.
func resolveNpmGlobalDir() string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var c *exec.Cmd
	if runtime.GOOS == "windows" {
		c = exec.CommandContext(ctx, "cmd", "/c", "npm", "config", "get", "prefix")
	} else {
		c = exec.CommandContext(ctx, "npm", "config", "get", "prefix")
	}
	executil.HideWindow(c)
	out, err := c.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
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

// BackupCreateOptions configures the openclaw backup create command.
type BackupCreateOptions struct {
	Output           string `json:"output,omitempty"`
	IncludeWorkspace bool   `json:"includeWorkspace"`
	OnlyConfig       bool   `json:"onlyConfig"`
	Verify           bool   `json:"verify"`
}

// BackupCreateResult is the JSON output from openclaw backup create --json.
type BackupCreateResult struct {
	CreatedAt        string              `json:"createdAt"`
	ArchiveRoot      string              `json:"archiveRoot"`
	ArchivePath      string              `json:"archivePath"`
	DryRun           bool                `json:"dryRun"`
	IncludeWorkspace bool                `json:"includeWorkspace"`
	OnlyConfig       bool                `json:"onlyConfig"`
	Verified         bool                `json:"verified"`
	Assets           []BackupCreateAsset `json:"assets"`
}

type BackupCreateAsset struct {
	Kind        string `json:"kind"`
	SourcePath  string `json:"sourcePath"`
	DisplayPath string `json:"displayPath"`
}

// BackupCreate runs `openclaw backup create` with the given options and returns the parsed result.
func BackupCreate(opts BackupCreateOptions) (*BackupCreateResult, error) {
	if !IsOpenClawInstalled() {
		return nil, fmt.Errorf("openclaw CLI is unavailable")
	}

	args := []string{"backup", "create", "--json"}
	if opts.Output != "" {
		args = append(args, "--output", opts.Output)
	}
	if opts.OnlyConfig {
		args = append(args, "--only-config")
	}
	if !opts.IncludeWorkspace {
		args = append(args, "--no-include-workspace")
	}
	if opts.Verify {
		args = append(args, "--verify")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	out, err := RunCLI(ctx, args...)
	if err != nil {
		return nil, err
	}

	// The CLI may emit non-JSON warnings before the JSON object (e.g. version
	// mismatch notices). Extract the JSON portion starting from the first '{'.
	jsonStr := out
	if idx := strings.Index(out, "{"); idx > 0 {
		jsonStr = out[idx:]
	}

	var result BackupCreateResult
	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil {
		return nil, fmt.Errorf("parse backup create json: %w\nraw output: %s", err, out)
	}
	return &result, nil
}

// BackupListArchives lists .tar.gz backup archives in the given directory.
func BackupListArchives(dir string) ([]BackupArchiveInfo, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var archives []BackupArchiveInfo
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".tar.gz") {
			continue
		}
		if !strings.Contains(e.Name(), "openclaw-backup") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		archives = append(archives, BackupArchiveInfo{
			Name:    e.Name(),
			Path:    filepath.Join(dir, e.Name()),
			Size:    info.Size(),
			ModTime: info.ModTime().Format(time.RFC3339),
		})
	}
	return archives, nil
}

type BackupArchiveInfo struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
}

// DefaultBackupDir returns the default directory for storing OpenClaw native backups.
// The directory MUST be outside the OpenClaw state dir (~/.openclaw), because the
// OpenClaw CLI refuses to write backup archives inside a source path.
func DefaultBackupDir() string {
	home, _ := os.UserHomeDir()
	if home == "" {
		return ""
	}
	dir := filepath.Join(home, "ClawDeckX", "backups")
	os.MkdirAll(dir, 0o700)
	return dir
}

func PairingApprove(channel, code string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return RunCLI(ctx, "pairing", "approve", channel, code)
}
