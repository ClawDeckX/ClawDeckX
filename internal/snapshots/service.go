package snapshots

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/webconfig"
)

type unlockedBundle struct {
	Manifest SnapshotManifest
	Files    map[string][]byte
	ExpireAt time.Time
}

type Service struct {
	repo     *database.SnapshotRepo
	mu       sync.Mutex
	tokens   map[string]unlockedBundle
	gwClient *openclaw.GWClient
}

func NewService() *Service {
	return &Service{
		repo:   database.NewSnapshotRepo(),
		tokens: map[string]unlockedBundle{},
	}
}

func (s *Service) SetGWClient(client *openclaw.GWClient) {
	s.gwClient = client
}

// StartTokenCleanup runs a background goroutine that periodically removes expired preview tokens.
func (s *Service) StartTokenCleanup(done <-chan struct{}) {
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				s.cleanExpiredTokens()
			}
		}
	}()
}

func (s *Service) cleanExpiredTokens() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for k, ub := range s.tokens {
		if now.After(ub.ExpireAt) {
			delete(s.tokens, k)
		}
	}
}

// ExportSnapshot returns the encrypted ciphertext and metadata for a snapshot so it can be downloaded.
func (s *Service) ExportSnapshot(snapshotID string) (*database.SnapshotRecord, error) {
	return s.repo.FindBySnapshotID(snapshotID)
}

// ImportSnapshot imports a snapshot from an exported .clawbak envelope (header JSON + ciphertext).
func (s *Service) ImportSnapshot(headerJSON []byte, ciphertext []byte) (*database.SnapshotRecord, error) {
	existing, _ := s.repo.List()
	if len(existing) >= MaxSnapshotCount {
		return nil, fmt.Errorf("snapshot limit reached (%d), please delete old snapshots first", MaxSnapshotCount)
	}
	if int64(len(ciphertext)) > MaxSnapshotSizeBytes {
		return nil, fmt.Errorf("import file too large (max %d MB)", MaxSnapshotSizeBytes/(1024*1024))
	}
	var envelope struct {
		Version    int    `json:"version"`
		SnapshotID string `json:"snapshotId"`
		Note       string `json:"note"`
		Trigger    string `json:"trigger"`
		CipherAlg  string `json:"cipherAlg"`
		KDFAlg     string `json:"kdfAlg"`
		KDFParams  string `json:"kdfParams"`
		Salt       string `json:"salt"`
		WrappedDEK string `json:"wrappedDEK"`
		WrapNonce  string `json:"wrapNonce"`
		DataNonce  string `json:"dataNonce"`
		ResCount   int    `json:"resourceCount"`
		SizeBytes  int64  `json:"sizeBytes"`
	}
	if err := json.Unmarshal(headerJSON, &envelope); err != nil {
		return nil, fmt.Errorf("invalid backup file header: %w", err)
	}
	if envelope.CipherAlg == "" || envelope.Salt == "" || envelope.WrappedDEK == "" {
		return nil, errors.New("invalid backup file: missing encryption fields")
	}
	// Avoid duplicate import by snapshot ID
	if envelope.SnapshotID != "" {
		if _, err := s.repo.FindBySnapshotID(envelope.SnapshotID); err == nil {
			return nil, errors.New("this backup has already been imported")
		}
	}
	snapshotID := envelope.SnapshotID
	if snapshotID == "" {
		snapshotID = newSnapshotID()
	}
	record := &database.SnapshotRecord{
		SnapshotID:      snapshotID,
		SnapshotVersion: envelope.Version,
		Note:            envelope.Note,
		Trigger:         "import",
		ResourceCount:   envelope.ResCount,
		SizeBytes:       int64(len(ciphertext)),
		CipherAlg:       envelope.CipherAlg,
		KDFAlg:          envelope.KDFAlg,
		KDFParamsJSON:   envelope.KDFParams,
		SaltB64:         envelope.Salt,
		WrappedDEKB64:   envelope.WrappedDEK,
		WrapNonceB64:    envelope.WrapNonce,
		DataNonceB64:    envelope.DataNonce,
		Ciphertext:      ciphertext,
	}
	if err := s.repo.Create(record); err != nil {
		return nil, err
	}
	return record, nil
}

// MaxSnapshotCount is the hard limit on stored snapshots to prevent DB bloat.
const MaxSnapshotCount = 100

// MaxSnapshotSizeBytes is the per-snapshot size ceiling (200 MB).
const MaxSnapshotSizeBytes = 200 * 1024 * 1024

func (s *Service) List() ([]SnapshotSummary, error) {
	records, err := s.repo.List()
	if err != nil {
		return nil, err
	}
	out := make([]SnapshotSummary, 0, len(records))
	for _, r := range records {
		resourceIDs, resourcePaths := extractResourceSummary(r.ManifestSummaryJSON)
		out = append(out, SnapshotSummary{
			ID:            r.SnapshotID,
			Note:          r.Note,
			Trigger:       r.Trigger,
			CreatedAt:     r.CreatedAt,
			ResourceCount: r.ResourceCount,
			SizeBytes:     r.SizeBytes,
			ResourceIDs:   resourceIDs,
			ResourcePaths: resourcePaths,
		})
	}
	return out, nil
}

func (s *Service) Create(note, trigger, password string, resourceIDs []string, opts ...string) (*database.SnapshotRecord, error) {
	scope := ""
	if len(opts) > 0 {
		scope = opts[0]
	}
	if trigger == "" {
		trigger = DefaultSnapshotTag
	}
	if len(password) < 6 {
		return nil, errors.New("password too short")
	}
	existing, _ := s.repo.List()
	if len(existing) >= MaxSnapshotCount {
		return nil, fmt.Errorf("snapshot limit reached (%d), please delete old snapshots first", MaxSnapshotCount)
	}
	resources, err := s.collectResourcesByScope(resourceIDs, scope)
	if err != nil {
		return nil, err
	}
	manifest, err := buildManifest(resources)
	if err != nil {
		return nil, err
	}
	bundle, err := packBundle(manifest, resources)
	if err != nil {
		return nil, err
	}
	kdfJSON, saltB64, wrappedDEKB64, wrapNonceB64, dataNonceB64, ciphertext, err := encryptBundleWithEnvelope(password, bundle)
	if err != nil {
		return nil, err
	}
	summary := map[string]any{
		"resource_ids":       idsOfManifest(manifest.Resources),
		"resource_paths":     logicalPathsOfManifest(manifest.Resources),
		"config_field_count": len(manifest.ConfigFields),
	}
	summaryJSON, _ := json.Marshal(summary)
	resTypeStats := map[string]int{}
	for _, r := range manifest.Resources {
		resTypeStats[r.Type]++
	}
	resTypeJSON, _ := json.Marshal(resTypeStats)
	record := &database.SnapshotRecord{
		SnapshotID:          newSnapshotID(),
		SnapshotVersion:     SnapshotVersion1,
		Note:                note,
		Trigger:             trigger,
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
	return record, nil
}

func (s *Service) UnlockPreview(snapshotID, password string) (*UnlockPreviewResponse, error) {
	record, err := s.repo.FindBySnapshotID(snapshotID)
	if err != nil {
		return nil, err
	}
	bundle, err := decryptBundleWithEnvelope(password, record.KDFParamsJSON, record.SaltB64, record.WrappedDEKB64, record.WrapNonceB64, record.DataNonceB64, record.Ciphertext)
	if err != nil {
		return nil, err
	}
	manifest, files, err := unpackBundle(bundle)
	if err != nil {
		return nil, err
	}
	token := newPreviewToken()
	s.mu.Lock()
	s.tokens[token] = unlockedBundle{Manifest: manifest, Files: files, ExpireAt: time.Now().Add(PreviewTokenTTL)}
	s.mu.Unlock()
	return &UnlockPreviewResponse{PreviewToken: token, Manifest: manifest, Resources: manifest.Resources, ConfigFields: manifest.ConfigFields}, nil
}

func (s *Service) RestorePlan(previewToken string, sel RestoreSelections) (*RestorePlanResponse, error) {
	ub, err := s.getToken(previewToken)
	if err != nil {
		return nil, err
	}
	fileSet := map[string]struct{}{}
	for _, id := range sel.Files {
		fileSet[id] = struct{}{}
	}
	cfgSet := map[string]struct{}{}
	for _, p := range sel.ConfigPaths {
		cfgSet[p] = struct{}{}
	}
	// Check resource existence in parallel to avoid serial RPC bottleneck
	type existResult struct {
		id     string
		exists bool
	}
	var selected []ManifestResource
	for _, r := range ub.Manifest.Resources {
		if r.RestoreMode == RestoreModeJSON {
			continue
		}
		if _, ok := fileSet[r.ID]; ok {
			selected = append(selected, r)
		}
	}
	results := make([]existResult, len(selected))
	var wg sync.WaitGroup
	for i, r := range selected {
		wg.Add(1)
		go func(idx int, res ManifestResource) {
			defer wg.Done()
			results[idx] = existResult{id: res.ID, exists: s.resourceExists(res.LogicalPath)}
		}(i, r)
	}
	wg.Wait()
	warnings := []string{}
	for _, er := range results {
		if er.exists {
			warnings = append(warnings, fmt.Sprintf("%s will be overwritten", er.id))
		}
	}
	return &RestorePlanResponse{WillModifyFiles: len(fileSet), WillModifyConfigPaths: len(cfgSet), Warnings: warnings}, nil
}

func (s *Service) Restore(previewToken string, sel RestoreSelections, createPreRestore bool, passwordForPreRestore string) (*RestoreResponse, error) {
	return s.RestoreWithProgress(previewToken, sel, createPreRestore, passwordForPreRestore, nil)
}

func (s *Service) RestoreWithProgress(previewToken string, sel RestoreSelections, createPreRestore bool, passwordForPreRestore string, progressFn ProgressFn) (*RestoreResponse, error) {
	if progressFn == nil {
		progressFn = func(evt RestoreProgressEvent) {}
	}
	ub, err := s.getToken(previewToken)
	if err != nil {
		return nil, err
	}
	// Count total steps: pre-backup(0 or 1) + files + config(0 or 1)
	var filesToRestore []ManifestResource
	selectedFiles := map[string]struct{}{}
	for _, id := range sel.Files {
		selectedFiles[id] = struct{}{}
	}
	for _, mr := range ub.Manifest.Resources {
		if mr.RestoreMode == RestoreModeJSON {
			continue
		}
		if _, ok := selectedFiles[mr.ID]; ok {
			filesToRestore = append(filesToRestore, mr)
		}
	}
	hasConfig := len(sel.ConfigPaths) > 0
	totalSteps := len(filesToRestore)
	if hasConfig {
		totalSteps++
	}
	if createPreRestore {
		totalSteps++
	}
	step := 0

	resp := &RestoreResponse{RestoredResources: []string{}, RestoredConfigPaths: []string{}}
	if createPreRestore {
		step++
		progressFn(RestoreProgressEvent{Phase: "pre_backup", Current: step, Total: totalSteps, File: "pre-restore backup"})
		pre, err := s.Create("auto pre-restore backup", "pre_restore", passwordForPreRestore, nil)
		if err == nil {
			resp.PreRestoreSnapshotID = pre.SnapshotID
		}
	}
	for _, mr := range filesToRestore {
		data, ok := ub.Files[mr.LogicalPath]
		if !ok {
			continue
		}
		if mr.SHA256 != "" {
			h := sha256.Sum256(data)
			if hex.EncodeToString(h[:]) != mr.SHA256 {
				return nil, fmt.Errorf("integrity check failed for %s: SHA256 mismatch", mr.ID)
			}
		}
		step++
		progressFn(RestoreProgressEvent{Phase: "file", Current: step, Total: totalSteps, File: mr.ID})
		if err := s.writeResource(mr.LogicalPath, data); err != nil {
			return nil, err
		}
		resp.RestoredResources = append(resp.RestoredResources, mr.ID)
	}
	if hasConfig {
		configData, ok := ub.Files["files/config/openclaw.json"]
		if !ok {
			return nil, fmt.Errorf("backup missing openclaw config")
		}
		step++
		progressFn(RestoreProgressEvent{Phase: "config", Current: step, Total: totalSteps, File: "openclaw.json"})
		if err := s.restoreConfigPaths(configData, sel.ConfigPaths); err != nil {
			return nil, err
		}
		resp.RestoredConfigPaths = append(resp.RestoredConfigPaths, sel.ConfigPaths...)
	}
	// Gateway only needs restart if config paths were modified (agent files are read on demand)
	resp.NeedsGatewayRestart = len(resp.RestoredConfigPaths) > 0
	progressFn(RestoreProgressEvent{Phase: "done", Current: totalSteps, Total: totalSteps})
	return resp, nil
}

func (s *Service) readResource(def ResourceDefinition) ([]byte, error) {
	if data, ok, err := s.readResourceViaGateway(def.LogicalPath); ok {
		if err != nil {
			return nil, err
		}
		s.logStoreUse("read", "gateway", def.LogicalPath)
		return data, nil
	}
	path := def.ResolvePath()
	s.logStoreUse("read", "local", def.LogicalPath)
	return os.ReadFile(path)
}

func (s *Service) isLocalGateway() bool {
	return s.gwClient == nil || s.gwClient.IsLocalGateway()
}

func (s *Service) writeResource(logicalPath string, data []byte) error {
	// Local gateway: direct filesystem write (fast, no RPC overhead)
	if s.isLocalGateway() {
		if dest := resolveLogicalPathDirect(logicalPath); dest != "" {
			s.logStoreUse("write", "local", logicalPath)
			return writeAtomic(dest, data)
		}
	}
	// Remote gateway or direct path not resolved: use gateway RPC
	if handled, err := s.writeResourceViaGateway(logicalPath, data); handled {
		if err != nil {
			return err
		}
		s.logStoreUse("write", "gateway", logicalPath)
		return nil
	}
	// Last resort for openclaw.json: CLI config set
	if logicalPath == "files/config/openclaw.json" && openclaw.IsOpenClawInstalled() {
		current := map[string]any{}
		if err := json.Unmarshal(data, &current); err == nil {
			if err := openclaw.ConfigApplyFull(current); err == nil {
				s.logStoreUse("write", "local", logicalPath)
				return nil
			}
		}
	}
	return fmt.Errorf("cannot resolve write path for %s", logicalPath)
}

func (s *Service) resourceExists(logicalPath string) bool {
	// Local gateway: prefer direct filesystem check
	if s.isLocalGateway() {
		if dest := resolveLogicalPathDirect(logicalPath); dest != "" {
			s.logStoreUse("exists", "local", logicalPath)
			_, err := os.Stat(dest)
			return err == nil
		}
		if source := logicalPathToSourcePath(logicalPath); source != "" {
			s.logStoreUse("exists", "local", logicalPath)
			_, err := os.Stat(source)
			return err == nil
		}
	}
	// Remote gateway or path not resolved: use gateway RPC
	if exists, ok := s.resourceExistsViaGateway(logicalPath); ok {
		s.logStoreUse("exists", "gateway", logicalPath)
		return exists
	}
	return false
}

func (s *Service) logStoreUse(action, store, logicalPath string) {
	logger.Log.Debug().
		Str("module", "snapshots").
		Str("action", action).
		Str("store", store).
		Str("logicalPath", logicalPath).
		Msg("snapshot storage path selected")
}

func (s *Service) readResourceViaGateway(logicalPath string) ([]byte, bool, error) {
	if s.gwClient == nil || !s.gwClient.IsConnected() {
		return nil, false, nil
	}
	if logicalPath == "files/config/openclaw.json" {
		cfg, err := s.getGatewayConfig()
		if err != nil {
			return nil, true, err
		}
		b, err := json.MarshalIndent(cfg, "", "  ")
		if err != nil {
			return nil, true, err
		}
		return b, true, nil
	}
	agentID, fileName, ok := parseAgentLogicalPath(logicalPath)
	if !ok {
		return nil, false, nil
	}
	data, err := s.gwClient.RequestWithTimeout("agents.files.get", map[string]interface{}{
		"agentId": agentID,
		"name":    fileName,
	}, 8*time.Second)
	if err != nil {
		return nil, true, err
	}
	var resp map[string]interface{}
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, true, err
	}
	if fileObj, ok := resp["file"].(map[string]interface{}); ok {
		if missing, _ := fileObj["missing"].(bool); missing {
			return nil, true, os.ErrNotExist
		}
		if content, _ := fileObj["content"].(string); content != "" || fileObj["content"] != nil {
			return []byte(content), true, nil
		}
	}
	if exists, _ := resp["exists"].(bool); !exists {
		return nil, true, os.ErrNotExist
	}
	if content, _ := resp["content"].(string); content != "" || resp["content"] != nil {
		return []byte(content), true, nil
	}
	return []byte{}, true, nil
}

func (s *Service) writeResourceViaGateway(logicalPath string, data []byte) (bool, error) {
	if s.gwClient == nil || !s.gwClient.IsConnected() {
		return false, nil
	}
	if logicalPath == "files/config/openclaw.json" {
		current := map[string]interface{}{}
		if err := json.Unmarshal(data, &current); err != nil {
			return true, err
		}
		raw, jsonErr := json.Marshal(current)
		if jsonErr != nil {
			return true, jsonErr
		}
		// Fetch baseHash for optimistic concurrency
		setParams := map[string]interface{}{
			"raw": string(raw),
		}
		if getResp, getErr := s.gwClient.RequestWithTimeout("config.get", map[string]interface{}{}, 5*time.Second); getErr == nil {
			var wrapper map[string]interface{}
			if json.Unmarshal(getResp, &wrapper) == nil {
				if h, ok := wrapper["hash"].(string); ok && h != "" {
					setParams["baseHash"] = h
				}
			}
		}
		_, err := s.gwClient.RequestWithTimeout("config.set", setParams, 15*time.Second)
		return true, err
	}
	agentID, fileName, ok := parseAgentLogicalPath(logicalPath)
	if !ok {
		return false, nil
	}
	_, err := s.gwClient.RequestWithTimeout("agents.files.set", map[string]interface{}{
		"agentId": agentID,
		"name":    fileName,
		"content": string(data),
	}, 30*time.Second)
	return true, err
}

func (s *Service) resourceExistsViaGateway(logicalPath string) (bool, bool) {
	if s.gwClient == nil || !s.gwClient.IsConnected() {
		return false, false
	}
	if logicalPath == "files/config/openclaw.json" {
		if _, err := s.getGatewayConfig(); err != nil {
			return false, true
		}
		return true, true
	}
	agentID, fileName, ok := parseAgentLogicalPath(logicalPath)
	if !ok {
		return false, false
	}
	data, err := s.gwClient.RequestWithTimeout("agents.files.get", map[string]interface{}{
		"agentId": agentID,
		"name":    fileName,
	}, 5*time.Second)
	if err != nil {
		return false, true
	}
	var resp map[string]interface{}
	if json.Unmarshal(data, &resp) != nil {
		return false, true
	}
	if fileObj, ok := resp["file"].(map[string]interface{}); ok {
		if missing, _ := fileObj["missing"].(bool); missing {
			return false, true
		}
		if _, has := fileObj["content"]; has {
			return true, true
		}
	}
	if exists, ok := resp["exists"].(bool); ok {
		return exists, true
	}
	if _, has := resp["content"]; has {
		return true, true
	}
	return false, true
}

func (s *Service) getGatewayConfig() (map[string]interface{}, error) {
	data, err := s.gwClient.RequestWithTimeout("config.get", map[string]interface{}{}, 15*time.Second)
	if err != nil {
		return nil, err
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	if cfg, ok := raw["config"].(map[string]interface{}); ok {
		return cfg, nil
	}
	if parsed, ok := raw["parsed"].(map[string]interface{}); ok {
		return parsed, nil
	}
	return raw, nil
}

func parseAgentLogicalPath(logicalPath string) (string, string, bool) {
	prefix := "files/agents/"
	if !strings.HasPrefix(logicalPath, prefix) {
		return "", "", false
	}
	rest := strings.TrimPrefix(logicalPath, prefix)
	parts := strings.Split(rest, "/")
	if len(parts) < 2 {
		return "", "", false
	}
	agentID := parts[0]
	fileName := strings.Join(parts[1:], "/")
	if agentID == "" || !isSafeSnapshotRelativePath(fileName) {
		return "", "", false
	}
	return agentID, fileName, true
}

func isSafeSnapshotRelativePath(pathValue string) bool {
	if pathValue == "" || filepath.IsAbs(pathValue) {
		return false
	}
	clean := filepath.Clean(filepath.FromSlash(pathValue))
	return clean != "." && clean != ".." && !strings.HasPrefix(clean, ".."+string(filepath.Separator))
}

func (s *Service) Scan(scope string) (*SnapshotScanResult, error) {
	if scope == "" {
		scope = BackupScopeBoth
	}
	registry := registryByScope(scope)
	if scope == BackupScopeOpenClaw || scope == BackupScopeBoth || scope == "" {
		registry = s.extendOpenClawRegistryFromGateway(registry)
	}
	groups := map[string][]SnapshotScanResource{}
	order := make([]string, 0)
	summary := SnapshotScanSummary{TotalResources: len(registry)}
	for _, def := range registry {
		exists, sizeBytes := s.scanResource(def)
		item := SnapshotScanResource{
			ID:          def.ID,
			Type:        def.Type,
			DisplayName: def.DisplayName,
			LogicalPath: def.LogicalPath,
			Scope:       def.Scope,
			Required:    def.Required,
			Exists:      exists,
			SizeBytes:   sizeBytes,
		}
		groupID := scanGroupID(def.LogicalPath, def.Scope)
		if _, ok := groups[groupID]; !ok {
			order = append(order, groupID)
		}
		groups[groupID] = append(groups[groupID], item)
		if exists {
			summary.ExistingResources++
			summary.TotalBytes += sizeBytes
		} else {
			summary.MissingResources++
		}
	}
	out := &SnapshotScanResult{Scope: scope, Summary: summary, Groups: make([]SnapshotScanGroup, 0, len(order))}
	for _, groupID := range order {
		items := groups[groupID]
		sort.Slice(items, func(i, j int) bool {
			if items[i].LogicalPath == items[j].LogicalPath {
				return items[i].ID < items[j].ID
			}
			return items[i].LogicalPath < items[j].LogicalPath
		})
		out.Groups = append(out.Groups, SnapshotScanGroup{
			ID:        groupID,
			Title:     scanGroupTitle(groupID),
			Resources: items,
		})
	}
	return out, nil
}

func (s *Service) scanResource(def ResourceDefinition) (bool, int64) {
	path := strings.TrimSpace(def.ResolvePath())
	if path != "" {
		if fi, err := os.Stat(path); err == nil && !fi.IsDir() {
			return true, fi.Size()
		}
	}
	if data, handled, err := s.readResourceViaGateway(def.LogicalPath); handled {
		if err == nil {
			return true, int64(len(data))
		}
		if errors.Is(err, os.ErrNotExist) {
			return false, 0
		}
		return false, 0
	}
	if path == "" {
		path = resolveLogicalPathDirect(def.LogicalPath)
	}
	if path == "" {
		path = logicalPathToSourcePath(def.LogicalPath)
	}
	if path == "" {
		return false, 0
	}
	if fi, err := os.Stat(path); err == nil && !fi.IsDir() {
		return true, fi.Size()
	}
	return false, 0
}

func scanGroupID(logicalPath, scope string) string {
	if strings.HasPrefix(logicalPath, "files/agents/") {
		return "agents"
	}
	if strings.HasPrefix(logicalPath, "files/personas/") {
		return "personas"
	}
	if strings.HasPrefix(logicalPath, "files/credentials/") {
		return "credentials"
	}
	if strings.HasPrefix(logicalPath, "files/clawdeckx/") {
		return "clawdeckx"
	}
	if strings.HasPrefix(logicalPath, "files/config/") {
		return "config"
	}
	if scope == BackupScopeClawDeckX {
		return "clawdeckx"
	}
	return "other"
}

func scanGroupTitle(groupID string) string {
	switch groupID {
	case "agents":
		return "Agents"
	case "personas":
		return "Personas"
	case "credentials":
		return "Credentials"
	case "clawdeckx":
		return "ClawDeckX"
	case "config":
		return "Config"
	default:
		return "Other"
	}
}

func (s *Service) PruneScheduledBackups(retentionCount int) ([]string, error) {
	if retentionCount < 1 {
		retentionCount = 1
	}
	records, err := s.repo.ListByTrigger(ScheduledSnapshotTag)
	if err != nil {
		return nil, err
	}
	if len(records) <= retentionCount {
		return nil, nil
	}
	pruned := make([]string, 0, len(records)-retentionCount)
	for _, r := range records[retentionCount:] {
		if err := s.repo.DeleteBySnapshotID(r.SnapshotID); err != nil {
			return pruned, err
		}
		pruned = append(pruned, r.SnapshotID)
	}
	return pruned, nil
}

func (s *Service) Delete(snapshotID string) error {
	return s.repo.DeleteBySnapshotID(snapshotID)
}

func (s *Service) collectResources(resourceIDs []string) ([]ResourceContent, error) {
	return s.collectResourcesByScope(resourceIDs, "")
}

func (s *Service) collectResourcesByScope(resourceIDs []string, scope string) ([]ResourceContent, error) {
	allow := map[string]struct{}{}
	for _, id := range resourceIDs {
		allow[id] = struct{}{}
	}
	items := make([]ResourceContent, 0)
	registry := registryByScope(scope)
	if scope == BackupScopeOpenClaw || scope == BackupScopeBoth || scope == "" {
		registry = s.extendOpenClawRegistryFromGateway(registry)
	}
	for _, def := range registry {
		if len(allow) > 0 {
			if _, ok := allow[def.ID]; !ok {
				continue
			}
		}
		data, err := s.readResource(def)
		if err != nil {
			if def.Required {
				return nil, err
			}
			continue
		}
		items = append(items, ResourceContent{Definition: def, Content: data})
	}
	if len(items) == 0 {
		return nil, errors.New("no resources to backup")
	}
	return items, nil
}

func (s *Service) extendOpenClawRegistryFromGateway(registry []ResourceDefinition) []ResourceDefinition {
	if s.gwClient == nil || !s.gwClient.IsConnected() {
		return registry
	}
	cfg, err := s.getGatewayConfig()
	if err != nil {
		return registry
	}
	seen := map[string]struct{}{}
	for _, def := range registry {
		seen[def.LogicalPath] = struct{}{}
	}
	for _, def := range gatewayDiscoveredAgentResources(cfg) {
		if _, ok := seen[def.LogicalPath]; ok {
			continue
		}
		registry = append(registry, def)
		seen[def.LogicalPath] = struct{}{}
	}
	return registry
}

func (s *Service) getToken(token string) (unlockedBundle, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ub, ok := s.tokens[token]
	if !ok {
		return unlockedBundle{}, errors.New("invalid preview token")
	}
	if time.Now().After(ub.ExpireAt) {
		delete(s.tokens, token)
		return unlockedBundle{}, errors.New("preview token expired")
	}
	return ub, nil
}

func idsOfManifest(resources []ManifestResource) []string {
	ids := make([]string, 0, len(resources))
	for _, r := range resources {
		ids = append(ids, r.ID)
	}
	sort.Strings(ids)
	return ids
}

func logicalPathsOfManifest(resources []ManifestResource) []string {
	paths := make([]string, 0, len(resources))
	for _, r := range resources {
		paths = append(paths, r.LogicalPath)
	}
	sort.Strings(paths)
	return paths
}

func extractResourceSummary(manifestSummaryJSON string) ([]string, []string) {
	if manifestSummaryJSON == "" {
		return nil, nil
	}
	var summary struct {
		ResourceIDs   []string `json:"resource_ids"`
		ResourcePaths []string `json:"resource_paths"`
	}
	if err := json.Unmarshal([]byte(manifestSummaryJSON), &summary); err != nil {
		return nil, nil
	}
	if len(summary.ResourceIDs) > 0 {
		sort.Strings(summary.ResourceIDs)
	}
	if len(summary.ResourcePaths) > 0 {
		sort.Strings(summary.ResourcePaths)
	}
	return summary.ResourceIDs, summary.ResourcePaths
}

func newSnapshotID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return fmt.Sprintf("snap_%s", hex.EncodeToString(b))
}

func newPreviewToken() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return fmt.Sprintf("preview_%s", hex.EncodeToString(b))
}
func nowUTC() time.Time { return time.Now().UTC() }

func logicalPathToSourcePath(logicalPath string) string {
	for _, def := range defaultRegistry() {
		if def.LogicalPath == logicalPath {
			return def.ResolvePath()
		}
	}
	return ""
}

// resolveLogicalPathDirect resolves a logical path to a filesystem path
// without relying on the registry (which only contains existing files).
// This is needed for restore: the target file may not exist yet.
func resolveLogicalPathDirect(logicalPath string) string {
	stateDir := resolveStateDir()
	if stateDir == "" {
		return ""
	}
	// files/agents/{agentName}/{filename} → {stateDir}/agents/{agentName}/{filename}
	if strings.HasPrefix(logicalPath, "files/agents/") {
		if dest := resolveAgentLogicalPath(logicalPath, stateDir); dest != "" {
			return dest
		}
		rel := strings.TrimPrefix(logicalPath, "files/")
		return filepath.Join(stateDir, filepath.FromSlash(rel))
	}
	// files/config/openclaw.json → {stateDir}/openclaw.json
	if logicalPath == "files/config/openclaw.json" {
		return filepath.Join(stateDir, "openclaw.json")
	}
	// files/config/.env → {stateDir}/.env
	if logicalPath == "files/config/.env" {
		return filepath.Join(stateDir, ".env")
	}
	// files/personas/{name} → {stateDir}/personas/{name}
	if strings.HasPrefix(logicalPath, "files/personas/") {
		rel := strings.TrimPrefix(logicalPath, "files/")
		return filepath.Join(stateDir, filepath.FromSlash(rel))
	}
	// files/credentials/{name} → {stateDir}/credentials/{name}
	if strings.HasPrefix(logicalPath, "files/credentials/") {
		rel := strings.TrimPrefix(logicalPath, "files/")
		return filepath.Join(stateDir, filepath.FromSlash(rel))
	}
	// files/config/{subpath} (include files) → {stateDir}/{subpath}
	if strings.HasPrefix(logicalPath, "files/config/") {
		rel := strings.TrimPrefix(logicalPath, "files/config/")
		return filepath.Join(stateDir, filepath.FromSlash(rel))
	}
	// files/clawdeckx/{name} → {dataDir}/{name}
	if strings.HasPrefix(logicalPath, "files/clawdeckx/") {
		rel := strings.TrimPrefix(logicalPath, "files/clawdeckx/")
		dataDir := webconfig.DataDir()
		if dataDir != "" {
			return filepath.Join(dataDir, filepath.FromSlash(rel))
		}
	}
	// Fallback: try registry
	return logicalPathToSourcePath(logicalPath)
}

func resolveAgentLogicalPath(logicalPath, stateDir string) string {
	rel := strings.TrimPrefix(logicalPath, "files/agents/")
	parts := strings.SplitN(rel, "/", 2)
	if len(parts) != 2 {
		return ""
	}
	agentID := strings.TrimSpace(parts[0])
	fileName := strings.TrimSpace(parts[1])
	if agentID == "" || !isSafeSnapshotRelativePath(fileName) {
		return ""
	}
	for _, candidate := range discoverAgentWorkspaceCandidates(stateDir) {
		if candidate.id == agentID {
			return filepath.Join(candidate.workspace, filepath.FromSlash(fileName))
		}
	}
	return ""
}

func writeAtomic(path string, data []byte) error {
	if path == "" {
		return errors.New("empty path")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return os.WriteFile(path, data, 0o600)
	}
	return nil
}

func (s *Service) restoreConfigPaths(snapshotConfig []byte, paths []string) error {
	src := map[string]any{}
	if err := json.Unmarshal(snapshotConfig, &src); err != nil {
		return err
	}
	current := map[string]any{}
	if s.isLocalGateway() {
		// Local gateway: read config directly from disk
		configPath := openclaw.ResolveConfigPath()
		if configPath == "" {
			configPath = filepath.Join(resolveStateDir(), "openclaw.json")
		}
		if b, err := os.ReadFile(configPath); err == nil {
			_ = json.Unmarshal(b, &current)
		}
	} else {
		// Remote gateway: read config via RPC
		if b, ok, err := s.readResourceViaGateway("files/config/openclaw.json"); ok {
			if err != nil {
				return err
			}
			_ = json.Unmarshal(b, &current)
		}
	}
	for _, p := range paths {
		setPath(current, p, getPath(src, p))
	}
	out, err := json.MarshalIndent(current, "", "  ")
	if err != nil {
		return err
	}
	return s.writeResource("files/config/openclaw.json", out)
}

func getPath(root map[string]any, path string) any {
	if path == "" {
		return root
	}
	parts := strings.Split(path, ".")
	var cur any = root
	for _, p := range parts {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		next, ok := m[p]
		if !ok {
			return nil
		}
		cur = next
	}
	return cur
}

func setPath(root map[string]any, path string, val any) {
	if path == "" {
		return
	}
	parts := strings.Split(path, ".")
	cur := root
	for i, p := range parts {
		if i == len(parts)-1 {
			if val == nil {
				delete(cur, p)
			} else {
				cur[p] = val
			}
			return
		}
		next, ok := cur[p]
		if !ok {
			nm := map[string]any{}
			cur[p] = nm
			cur = nm
			continue
		}
		nm, ok := next.(map[string]any)
		if !ok {
			nm = map[string]any{}
			cur[p] = nm
		}
		cur = nm
	}
}

func AuditActionCreate() string { return constants.ActionSnapshotCreate }
