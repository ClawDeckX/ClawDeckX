package commands

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	runtimePatchNeedle      = "const nets = os.networkInterfaces();"
	runtimePatchReplacement = "let nets;\n\ttry { nets = os.networkInterfaces(); }\n\tcatch { return \"127.0.0.1\"; }"
)

func fixOpenclawRuntimeNetworkInterfaces() (bool, error) {
	root := expandPath("~/.npm-global/lib/node_modules/openclaw/dist")
	pattern := filepath.Join(root, "gateway-cli-*.js")
	files, err := filepath.Glob(pattern)
	if err != nil {
		return false, err
	}
	if len(files) == 0 {
		return false, fmt.Errorf("未找到 OpenClaw gateway-cli 文件: %s", pattern)
	}

	changedAny := false
	for _, file := range files {
		changed, err := patchRuntimeFile(file)
		if err != nil {
			return changedAny, err
		}
		if changed {
			changedAny = true
		}
	}
	return changedAny, nil
}

func patchRuntimeFile(path string) (bool, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	content := string(data)
	if strings.Contains(content, runtimePatchReplacement) {
		return false, nil
	}
	if !strings.Contains(content, runtimePatchNeedle) {
		return false, fmt.Errorf("文件未找到目标片段: %s", path)
	}

	backup := fmt.Sprintf("%s.ClawDeckX-%s.bak", path, time.Now().Format("20060102-150405"))
	if err := os.WriteFile(backup, data, 0o644); err != nil {
		return false, err
	}

	patched := strings.Replace(content, runtimePatchNeedle, runtimePatchReplacement, 1)
	if err := os.WriteFile(path, []byte(patched), 0o644); err != nil {
		return false, err
	}
	return true, nil
}

func rollbackOpenclawRuntimeFix() (bool, error) {
	root := expandPath("~/.npm-global/lib/node_modules/openclaw/dist")
	pattern := filepath.Join(root, "gateway-cli-*.js")
	targets, err := filepath.Glob(pattern)
	if err != nil {
		return false, err
	}
	if len(targets) == 0 {
		return false, fmt.Errorf("未找到 OpenClaw gateway-cli 文件: %s", pattern)
	}

	changedAny := false
	for _, target := range targets {
		backup, ok, err := latestRuntimeBackup(target)
		if err != nil {
			return changedAny, err
		}
		if !ok {
			continue
		}
		data, err := os.ReadFile(backup)
		if err != nil {
			return changedAny, err
		}
		if err := os.WriteFile(target, data, 0o644); err != nil {
			return changedAny, err
		}
		changedAny = true
	}
	return changedAny, nil
}

func latestRuntimeBackup(target string) (string, bool, error) {
	pattern := target + ".ClawDeckX-*.bak"
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return "", false, err
	}
	if len(matches) == 0 {
		return "", false, nil
	}

	sort.Slice(matches, func(i, j int) bool {
		ii, errI := os.Stat(matches[i])
		jj, errJ := os.Stat(matches[j])
		if errI != nil || errJ != nil {
			return matches[i] > matches[j]
		}
		return ii.ModTime().After(jj.ModTime())
	})
	return matches[0], true, nil
}
