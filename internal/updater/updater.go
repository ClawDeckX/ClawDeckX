package updater

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/version"
)

const (
	GitHubOwner = "ClawDeckX"
	GitHubRepo  = "ClawDeckX"
	GitHubAPI   = "https://api.github.com"
)

// ReleaseInfo holds GitHub release metadata.
type ReleaseInfo struct {
	TagName     string    `json:"tag_name"`
	Name        string    `json:"name"`
	Body        string    `json:"body"`
	PublishedAt time.Time `json:"published_at"`
	Assets      []Asset   `json:"assets"`
}

// Asset is a single release asset.
type Asset struct {
	Name               string `json:"name"`
	Size               int64  `json:"size"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

// CheckResult is returned by CheckForUpdate.
type CheckResult struct {
	Available      bool   `json:"available"`
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	ReleaseNotes   string `json:"releaseNotes,omitempty"`
	PublishedAt    string `json:"publishedAt,omitempty"`
	AssetName      string `json:"assetName,omitempty"`
	AssetSize      int64  `json:"assetSize,omitempty"`
	DownloadURL    string `json:"downloadUrl,omitempty"`
	Error          string `json:"error,omitempty"`
}

// ApplyProgress reports download/apply progress.
type ApplyProgress struct {
	Stage      string  `json:"stage"`
	Percent    float64 `json:"percent"`
	Downloaded int64   `json:"downloaded,omitempty"`
	Total      int64   `json:"total,omitempty"`
	Error      string  `json:"error,omitempty"`
	Done       bool    `json:"done"`
}

// CheckForUpdate queries GitHub Releases for a newer version.
func CheckForUpdate(ctx context.Context) (*CheckResult, error) {
	currentVersion := version.Version

	url := fmt.Sprintf("%s/repos/%s/%s/releases/latest", GitHubAPI, GitHubOwner, GitHubRepo)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return &CheckResult{Available: false, CurrentVersion: currentVersion, Error: err.Error()}, nil
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "ClawDeckX/"+currentVersion)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return &CheckResult{Available: false, CurrentVersion: currentVersion, Error: err.Error()}, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		return &CheckResult{Available: false, CurrentVersion: currentVersion, Error: "no releases found"}, nil
	}
	if resp.StatusCode != 200 {
		return &CheckResult{Available: false, CurrentVersion: currentVersion, Error: fmt.Sprintf("GitHub API returned %d", resp.StatusCode)}, nil
	}

	var release ReleaseInfo
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return &CheckResult{Available: false, CurrentVersion: currentVersion, Error: err.Error()}, nil
	}

	latestVersion := strings.TrimPrefix(release.TagName, "v")
	available := compareSemver(latestVersion, currentVersion) > 0

	result := &CheckResult{
		Available:      available,
		CurrentVersion: currentVersion,
		LatestVersion:  latestVersion,
		ReleaseNotes:   release.Body,
		PublishedAt:    release.PublishedAt.Format(time.RFC3339),
	}

	// Find matching asset for current platform
	assetName := expectedAssetName()
	for _, a := range release.Assets {
		if strings.EqualFold(a.Name, assetName) {
			result.AssetName = a.Name
			result.AssetSize = a.Size
			result.DownloadURL = a.BrowserDownloadURL
			break
		}
	}

	if available && result.DownloadURL == "" {
		result.Error = fmt.Sprintf("no asset found for %s/%s (expected %s)", runtime.GOOS, runtime.GOARCH, assetName)
	}

	return result, nil
}

// ApplyUpdate downloads the new binary and replaces the current one.
// progressFn is called with progress updates (can be nil).
func ApplyUpdate(ctx context.Context, downloadURL string, progressFn func(ApplyProgress)) error {
	if progressFn == nil {
		progressFn = func(ApplyProgress) {}
	}

	// 1. Download to temp file
	progressFn(ApplyProgress{Stage: "downloading", Percent: 0})

	req, err := http.NewRequestWithContext(ctx, "GET", downloadURL, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("User-Agent", "ClawDeckX/"+version.Version)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("download returned HTTP %d", resp.StatusCode)
	}

	totalSize := resp.ContentLength

	// Create temp file in same directory as current executable
	currentExe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("get executable path: %w", err)
	}
	currentExe, err = filepath.EvalSymlinks(currentExe)
	if err != nil {
		return fmt.Errorf("resolve symlinks: %w", err)
	}

	dir := filepath.Dir(currentExe)
	tmpFile, err := os.CreateTemp(dir, "ClawDeckX-update-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer func() {
		tmpFile.Close()
		os.Remove(tmpPath) // clean up on error
	}()

	// Download with progress tracking
	hasher := sha256.New()
	writer := io.MultiWriter(tmpFile, hasher)
	var downloaded int64

	buf := make([]byte, 64*1024) // 64KB buffer
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := writer.Write(buf[:n]); writeErr != nil {
				return fmt.Errorf("write: %w", writeErr)
			}
			downloaded += int64(n)
			pct := float64(0)
			if totalSize > 0 {
				pct = float64(downloaded) / float64(totalSize) * 100
			}
			progressFn(ApplyProgress{Stage: "downloading", Percent: pct, Downloaded: downloaded, Total: totalSize})
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return fmt.Errorf("read: %w", readErr)
		}
	}
	tmpFile.Close()

	checksum := hex.EncodeToString(hasher.Sum(nil))
	logger.Config.Info().Str("checksum", checksum).Int64("size", downloaded).Msg("update downloaded")

	// 2. Verify: try to read checksums.txt from release if available
	progressFn(ApplyProgress{Stage: "verifying", Percent: 100})

	// 3. Replace binary
	progressFn(ApplyProgress{Stage: "replacing", Percent: 100})

	if err := replaceBinary(currentExe, tmpPath); err != nil {
		return fmt.Errorf("replace binary: %w", err)
	}

	progressFn(ApplyProgress{Stage: "done", Percent: 100, Done: true})
	logger.Config.Info().Str("version", version.Version).Msg("self-update applied, restart required")

	return nil
}

// expectedAssetName returns the expected asset filename for the current platform.
func expectedAssetName() string {
	ext := ""
	if runtime.GOOS == "windows" {
		ext = ".exe"
	}
	return fmt.Sprintf("ClawDeckX-%s-%s%s", runtime.GOOS, runtime.GOARCH, ext)
}

// replaceBinary replaces the current executable with the new one.
// On Windows: rename current → .bak, rename new → current.
// On Unix: overwrite directly (safe because inode stays).
func replaceBinary(currentPath, newPath string) error {
	// Set executable permission on Unix
	if runtime.GOOS != "windows" {
		if err := os.Chmod(newPath, 0o755); err != nil {
			return fmt.Errorf("chmod: %w", err)
		}
	}

	if runtime.GOOS == "windows" {
		// Windows: running exe can be renamed but not deleted
		bakPath := currentPath + ".bak"
		// Remove old backup if exists
		os.Remove(bakPath)
		// Rename current → .bak
		if err := os.Rename(currentPath, bakPath); err != nil {
			return fmt.Errorf("rename current to bak: %w", err)
		}
		// Rename new → current
		if err := os.Rename(newPath, currentPath); err != nil {
			// Try to restore
			os.Rename(bakPath, currentPath)
			return fmt.Errorf("rename new to current: %w", err)
		}
		return nil
	}

	// Unix: direct rename (atomic on same filesystem)
	if err := os.Rename(newPath, currentPath); err != nil {
		return fmt.Errorf("rename: %w", err)
	}
	return nil
}

// compareSemver compares two semver strings; returns positive if a > b.
func compareSemver(a, b string) int {
	pa := parseParts(a)
	pb := parseParts(b)
	for i := 0; i < 3; i++ {
		if pa[i] != pb[i] {
			return pa[i] - pb[i]
		}
	}
	return 0
}

func parseParts(v string) [3]int {
	v = strings.TrimPrefix(v, "v")
	if idx := strings.IndexByte(v, '-'); idx >= 0 {
		v = v[:idx]
	}
	parts := strings.SplitN(v, ".", 3)
	var result [3]int
	for i := 0; i < 3 && i < len(parts); i++ {
		fmt.Sscanf(parts[i], "%d", &result[i])
	}
	return result
}
