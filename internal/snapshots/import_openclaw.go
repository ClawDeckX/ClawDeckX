package snapshots

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"sort"
	"strings"
	"time"

	"ClawDeckX/internal/database"
)

// openclawManifest mirrors the manifest.json structure from `openclaw backup create`.
type openclawManifest struct {
	SchemaVersion  int    `json:"schemaVersion"`
	CreatedAt      string `json:"createdAt"`
	ArchiveRoot    string `json:"archiveRoot"`
	RuntimeVersion string `json:"runtimeVersion"`
	Platform       string `json:"platform"`
	NodeVersion    string `json:"nodeVersion"`
	Options        struct {
		IncludeWorkspace bool `json:"includeWorkspace"`
		OnlyConfig       bool `json:"onlyConfig,omitempty"`
	} `json:"options"`
	Paths struct {
		StateDir      string   `json:"stateDir"`
		ConfigPath    string   `json:"configPath"`
		OAuthDir      string   `json:"oauthDir"`
		WorkspaceDirs []string `json:"workspaceDirs"`
	} `json:"paths"`
	Assets []struct {
		Kind        string `json:"kind"`
		SourcePath  string `json:"sourcePath"`
		ArchivePath string `json:"archivePath"`
	} `json:"assets"`
	Skipped []struct {
		Kind       string `json:"kind"`
		SourcePath string `json:"sourcePath"`
		Reason     string `json:"reason"`
		CoveredBy  string `json:"coveredBy,omitempty"`
	} `json:"skipped"`
}

// OpenClawImportResult contains information about the imported backup.
type OpenClawImportResult struct {
	SnapshotID    string `json:"snapshot_id"`
	ResourceCount int    `json:"resource_count"`
	SizeBytes     int64  `json:"size_bytes"`
	Platform      string `json:"platform,omitempty"`
	RuntimeVer    string `json:"runtime_version,omitempty"`
	CreatedAt     string `json:"created_at,omitempty"`
}

// ImportFromTarGz imports an OpenClaw `.tar.gz` backup archive, re-encrypts it
// as a ClawDeckX snapshot using the provided password, and stores it.
func (s *Service) ImportFromTarGz(data []byte, password, note string) (*OpenClawImportResult, error) {
	if len(password) < 6 {
		return nil, errors.New("password too short")
	}
	existing, _ := s.repo.List()
	if len(existing) >= MaxSnapshotCount {
		return nil, fmt.Errorf("snapshot limit reached (%d), please delete old snapshots first", MaxSnapshotCount)
	}

	ocManifest, files, err := parseTarGz(data)
	if err != nil {
		return nil, fmt.Errorf("invalid OpenClaw backup: %w", err)
	}

	resources := convertOpenClawToResources(ocManifest, files)
	if len(resources) == 0 {
		return nil, errors.New("no importable resources found in the backup archive")
	}

	manifest, err := buildManifest(resources)
	if err != nil {
		return nil, fmt.Errorf("failed to build manifest: %w", err)
	}
	if t, parseErr := time.Parse(time.RFC3339, ocManifest.CreatedAt); parseErr == nil {
		manifest.CreatedAt = t
	}

	bundle, err := packBundle(manifest, resources)
	if err != nil {
		return nil, fmt.Errorf("failed to pack bundle: %w", err)
	}
	kdfJSON, saltB64, wrappedDEKB64, wrapNonceB64, dataNonceB64, ciphertext, err := encryptBundleWithEnvelope(password, bundle)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt: %w", err)
	}

	summary := map[string]any{
		"resource_ids":       idsOfManifest(manifest.Resources),
		"resource_paths":     logicalPathsOfManifest(manifest.Resources),
		"config_field_count": len(manifest.ConfigFields),
		"import_source":      "openclaw-backup",
		"platform":           ocManifest.Platform,
		"runtime_version":    ocManifest.RuntimeVersion,
	}
	summaryJSON, _ := json.Marshal(summary)
	resTypeStats := map[string]int{}
	for _, r := range manifest.Resources {
		resTypeStats[r.Type]++
	}
	resTypeJSON, _ := json.Marshal(resTypeStats)

	if note == "" {
		note = fmt.Sprintf("Imported from OpenClaw backup (%s)", ocManifest.Platform)
	}

	record := &database.SnapshotRecord{
		SnapshotID:          newSnapshotID(),
		SnapshotVersion:     SnapshotVersion1,
		Note:                note,
		Trigger:             "import_openclaw",
		ResourceCount:       len(manifest.Resources),
		ResourceTypesJSON:   string(resTypeJSON),
		ManifestSummaryJSON: string(summaryJSON),
		SizeBytes:           int64(len(ciphertext)),
		CipherAlg:           "aes-256-gcm",
		KDFAlg:              "argon2id",
		KDFParamsJSON:       kdfJSON,
		SaltB64:             saltB64,
		WrappedDEKB64:       wrappedDEKB64,
		WrapNonceB64:        wrapNonceB64,
		DataNonceB64:        dataNonceB64,
		Ciphertext:          ciphertext,
	}
	if err := s.repo.Create(record); err != nil {
		return nil, err
	}

	return &OpenClawImportResult{
		SnapshotID:    record.SnapshotID,
		ResourceCount: record.ResourceCount,
		SizeBytes:     record.SizeBytes,
		Platform:      ocManifest.Platform,
		RuntimeVer:    ocManifest.RuntimeVersion,
		CreatedAt:     ocManifest.CreatedAt,
	}, nil
}

// parseTarGz extracts the OpenClaw manifest and all file contents from a tar.gz archive.
func parseTarGz(data []byte) (*openclawManifest, map[string][]byte, error) {
	gr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, nil, fmt.Errorf("not a valid gzip archive: %w", err)
	}
	defer gr.Close()

	tr := tar.NewReader(gr)
	files := map[string][]byte{}
	var manifest *openclawManifest

	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, nil, fmt.Errorf("tar read error: %w", err)
		}
		if hdr.Typeflag != tar.TypeReg {
			continue
		}
		if hdr.Size > 100*1024*1024 {
			continue
		}
		content, err := io.ReadAll(io.LimitReader(tr, 100*1024*1024+1))
		if err != nil {
			return nil, nil, fmt.Errorf("tar read file error: %w", err)
		}
		name := path.Clean(hdr.Name)
		if path.Base(name) == "manifest.json" {
			var m openclawManifest
			if err := json.Unmarshal(content, &m); err != nil {
				return nil, nil, fmt.Errorf("invalid manifest.json: %w", err)
			}
			manifest = &m
		} else {
			files[name] = content
		}
	}
	if manifest == nil {
		return nil, nil, errors.New("manifest.json not found in archive")
	}
	return manifest, files, nil
}

// convertOpenClawToResources maps OpenClaw backup assets to ClawDeckX resource content.
func convertOpenClawToResources(m *openclawManifest, files map[string][]byte) []ResourceContent {
	var resources []ResourceContent

	for archivePath, content := range files {
		logicalPath, resType, displayName := classifyOpenClawAsset(archivePath, m)
		if logicalPath == "" {
			continue
		}

		restoreMode := RestoreModeFile
		if logicalPath == "files/config/openclaw.json" {
			restoreMode = RestoreModeJSON
		}

		resources = append(resources, ResourceContent{
			Definition: ResourceDefinition{
				ID:          logicalPath,
				Type:        resType,
				DisplayName: displayName,
				LogicalPath: logicalPath,
				RestoreMode: restoreMode,
			},
			Path:    archivePath,
			Content: content,
		})
	}

	sort.Slice(resources, func(i, j int) bool {
		return resources[i].Definition.ID < resources[j].Definition.ID
	})
	return resources
}

// classifyOpenClawAsset determines the logical path, resource type, and display name
// for a file extracted from an OpenClaw backup archive.
func classifyOpenClawAsset(archivePath string, m *openclawManifest) (logicalPath, resType, displayName string) {
	stripped := archivePath
	if m.ArchiveRoot != "" {
		if s := strings.TrimPrefix(archivePath, m.ArchiveRoot+"/"); s != archivePath {
			stripped = s
		}
	}

	base := path.Base(stripped)
	lowerBase := strings.ToLower(base)

	if lowerBase == "openclaw.json" {
		return "files/config/openclaw.json", "config", "openclaw.json"
	}
	if strings.Contains(stripped, "credentials/") || strings.Contains(stripped, "oauth") {
		return "files/credentials/" + base, "credential", base
	}
	if lowerBase == "env" || lowerBase == ".env" {
		return "files/env", "env", "env"
	}
	if strings.Contains(stripped, "workspace/") {
		parts := strings.SplitN(stripped, "workspace/", 2)
		if len(parts) == 2 && parts[1] != "" {
			relPath := parts[1]
			return "files/workspace/" + relPath, classifyWorkspaceFile(relPath), path.Base(relPath)
		}
	}
	if strings.Contains(stripped, ".openclaw/") {
		parts := strings.SplitN(stripped, ".openclaw/", 2)
		if len(parts) == 2 && parts[1] != "" {
			relPath := parts[1]
			return "files/" + relPath, "state", base
		}
	}
	if stripped != "" && stripped != "." {
		return "files/" + stripped, "other", base
	}
	return "", "", ""
}

func classifyWorkspaceFile(relPath string) string {
	lower := strings.ToLower(relPath)
	switch {
	case strings.Contains(lower, "soul") || strings.Contains(lower, "persona"):
		return "persona"
	case strings.Contains(lower, "knowledge"):
		return "knowledge"
	case strings.HasSuffix(lower, ".json"):
		return "config"
	case strings.HasSuffix(lower, ".md"):
		return "document"
	default:
		return "workspace"
	}
}

// ExportAsOpenClawTarGz decrypts a snapshot and re-exports it as an OpenClaw-compatible
// .tar.gz archive with a manifest.json.
func (s *Service) ExportAsOpenClawTarGz(snapshotID, password string) ([]byte, string, error) {
	record, err := s.repo.FindBySnapshotID(snapshotID)
	if err != nil {
		return nil, "", err
	}
	bundle, err := decryptBundleWithEnvelope(password, record.KDFParamsJSON, record.SaltB64,
		record.WrappedDEKB64, record.WrapNonceB64, record.DataNonceB64, record.Ciphertext)
	if err != nil {
		return nil, "", err
	}
	manifest, files, err := unpackBundle(bundle)
	if err != nil {
		return nil, "", err
	}

	now := manifest.CreatedAt
	archiveRoot := now.Format("2006-01-02T15-04-05.000Z") + "-openclaw-backup"

	ocManifest := openclawManifest{
		SchemaVersion:  1,
		CreatedAt:      now.Format(time.RFC3339),
		ArchiveRoot:    archiveRoot,
		RuntimeVersion: manifest.AppVersion,
		Platform:       "clawdeckx",
	}
	for _, res := range manifest.Resources {
		ocManifest.Assets = append(ocManifest.Assets, struct {
			Kind        string `json:"kind"`
			SourcePath  string `json:"sourcePath"`
			ArchivePath string `json:"archivePath"`
		}{
			Kind:        res.Type,
			SourcePath:  res.LogicalPath,
			ArchivePath: archiveRoot + "/" + res.LogicalPath,
		})
	}

	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)

	manifestJSON, _ := json.MarshalIndent(ocManifest, "", "  ")
	if err := writeTarEntry(tw, archiveRoot+"/manifest.json", manifestJSON, now); err != nil {
		return nil, "", err
	}
	for _, res := range manifest.Resources {
		content, ok := files[res.LogicalPath]
		if !ok {
			continue
		}
		if err := writeTarEntry(tw, archiveRoot+"/"+res.LogicalPath, content, now); err != nil {
			return nil, "", err
		}
	}

	if err := tw.Close(); err != nil {
		return nil, "", err
	}
	if err := gw.Close(); err != nil {
		return nil, "", err
	}

	exportName := "openclaw-backup-" + now.Format("2006-01-02_150405") + ".tar.gz"
	return buf.Bytes(), exportName, nil
}

func writeTarEntry(tw *tar.Writer, name string, data []byte, modTime time.Time) error {
	hdr := &tar.Header{
		Name:    name,
		Mode:    0o600,
		Size:    int64(len(data)),
		ModTime: modTime,
	}
	if err := tw.WriteHeader(hdr); err != nil {
		return err
	}
	_, err := tw.Write(data)
	return err
}

// VerifyIntegrity checks whether a snapshot can be decrypted and its contents pass SHA256 verification.
type VerifyResult struct {
	OK             bool   `json:"ok"`
	ResourceCount  int    `json:"resource_count"`
	VerifiedCount  int    `json:"verified_count"`
	TotalSizeBytes int64  `json:"total_size_bytes"`
	Error          string `json:"error,omitempty"`
}

func (s *Service) VerifyIntegrity(snapshotID, password string) (*VerifyResult, error) {
	record, err := s.repo.FindBySnapshotID(snapshotID)
	if err != nil {
		return nil, err
	}
	bundle, err := decryptBundleWithEnvelope(password, record.KDFParamsJSON, record.SaltB64,
		record.WrappedDEKB64, record.WrapNonceB64, record.DataNonceB64, record.Ciphertext)
	if err != nil {
		return &VerifyResult{OK: false, Error: "decryption failed: " + err.Error()}, nil
	}
	manifest, files, err := unpackBundle(bundle)
	if err != nil {
		return &VerifyResult{OK: false, Error: "unpack failed: " + err.Error()}, nil
	}

	result := &VerifyResult{
		OK:            true,
		ResourceCount: len(manifest.Resources),
	}
	for _, res := range manifest.Resources {
		content, ok := files[res.LogicalPath]
		if !ok {
			result.OK = false
			result.Error = fmt.Sprintf("missing file: %s", res.LogicalPath)
			return result, nil
		}
		result.TotalSizeBytes += int64(len(content))
		if res.SHA256 != "" {
			h := sha256.Sum256(content)
			if hex.EncodeToString(h[:]) != res.SHA256 {
				result.OK = false
				result.Error = fmt.Sprintf("SHA256 mismatch for %s", res.LogicalPath)
				return result, nil
			}
		}
		result.VerifiedCount++
	}
	return result, nil
}

// Stats returns aggregate snapshot statistics.
type SnapshotStats struct {
	TotalCount      int     `json:"total_count"`
	TotalSizeBytes  int64   `json:"total_size_bytes"`
	LatestBackupAt  *string `json:"latest_backup_at"`
	OldestBackupAt  *string `json:"oldest_backup_at"`
	ManualCount     int     `json:"manual_count"`
	ScheduledCount  int     `json:"scheduled_count"`
	ImportCount     int     `json:"import_count"`
	DaysSinceBackup int     `json:"days_since_backup"`
	ScheduleEnabled bool    `json:"schedule_enabled"`
}

func (s *Service) Stats() (*SnapshotStats, error) {
	records, err := s.repo.List()
	if err != nil {
		return nil, err
	}
	stats := &SnapshotStats{}
	stats.TotalCount = len(records)
	for _, r := range records {
		stats.TotalSizeBytes += r.SizeBytes
		switch r.Trigger {
		case "manual":
			stats.ManualCount++
		case "scheduled":
			stats.ScheduledCount++
		case "import", "import_openclaw":
			stats.ImportCount++
		}
	}
	if len(records) > 0 {
		latest := records[0].CreatedAt.Format(time.RFC3339)
		oldest := records[len(records)-1].CreatedAt.Format(time.RFC3339)
		stats.LatestBackupAt = &latest
		stats.OldestBackupAt = &oldest
		stats.DaysSinceBackup = int(time.Since(records[0].CreatedAt).Hours() / 24)
	} else {
		stats.DaysSinceBackup = -1
	}
	return stats, nil
}

// BatchDelete deletes multiple snapshots by their IDs.
func (s *Service) BatchDelete(snapshotIDs []string) (deleted []string, errs []string) {
	for _, id := range snapshotIDs {
		if err := s.repo.DeleteBySnapshotID(id); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %s", id, err.Error()))
		} else {
			deleted = append(deleted, id)
		}
	}
	return
}

// PruneKeepN deletes all snapshots except the most recent N.
func (s *Service) PruneKeepN(keepN int) (deleted []string, err error) {
	if keepN < 1 {
		keepN = 1
	}
	records, err := s.repo.List()
	if err != nil {
		return nil, err
	}
	if len(records) <= keepN {
		return nil, nil
	}
	for _, r := range records[keepN:] {
		if delErr := s.repo.DeleteBySnapshotID(r.SnapshotID); delErr != nil {
			return deleted, delErr
		}
		deleted = append(deleted, r.SnapshotID)
	}
	return deleted, nil
}

// PreviewFileContent decrypts and returns the content of a specific file in a snapshot.
func (s *Service) PreviewFileContent(previewToken, logicalPath string) ([]byte, error) {
	ub, err := s.getToken(previewToken)
	if err != nil {
		return nil, err
	}
	content, ok := ub.Files[logicalPath]
	if !ok {
		return nil, fmt.Errorf("file not found: %s", logicalPath)
	}
	return content, nil
}

// DiffFileContent returns the backup file content and the current file content for comparison.
type FileDiff struct {
	LogicalPath    string `json:"logical_path"`
	BackupContent  string `json:"backup_content"`
	CurrentContent string `json:"current_content"`
	BackupExists   bool   `json:"backup_exists"`
	CurrentExists  bool   `json:"current_exists"`
}

func (s *Service) DiffFileContent(previewToken, logicalPath string) (*FileDiff, error) {
	ub, err := s.getToken(previewToken)
	if err != nil {
		return nil, err
	}
	diff := &FileDiff{LogicalPath: logicalPath}
	if content, ok := ub.Files[logicalPath]; ok {
		diff.BackupContent = string(content)
		diff.BackupExists = true
	}
	currentData, err := s.readCurrentFile(logicalPath)
	if err == nil {
		diff.CurrentContent = string(currentData)
		diff.CurrentExists = true
	}
	return diff, nil
}

func (s *Service) readCurrentFile(logicalPath string) ([]byte, error) {
	if data, ok, err := s.readResourceViaGateway(logicalPath); ok {
		return data, err
	}
	if dest := resolveLogicalPathDirect(logicalPath); dest != "" {
		return readFileBytes(dest)
	}
	return nil, fmt.Errorf("cannot resolve path: %s", logicalPath)
}

func readFileBytes(p string) ([]byte, error) {
	return os.ReadFile(p)
}
