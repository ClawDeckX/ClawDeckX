package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/snapshots"
	"ClawDeckX/internal/web"
)

type SnapshotHandler struct {
	svc        *snapshots.Service
	scheduler  *snapshots.Scheduler
	auditRepo  *database.AuditLogRepo
	gatewaySvc *openclaw.Service
}

func NewSnapshotHandler() *SnapshotHandler {
	svc := snapshots.NewService()
	return &SnapshotHandler{
		svc:       svc,
		scheduler: snapshots.NewScheduler(svc),
		auditRepo: database.NewAuditLogRepo(),
	}
}

func (h *SnapshotHandler) Service() *snapshots.Service {
	return h.svc
}

func (h *SnapshotHandler) Scheduler() *snapshots.Scheduler {
	return h.scheduler
}

func (h *SnapshotHandler) SetGatewaySvc(svc *openclaw.Service) {
	h.gatewaySvc = svc
}

func (h *SnapshotHandler) SetGWClient(client *openclaw.GWClient) {
	h.svc.SetGWClient(client)
}

func (h *SnapshotHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.svc.List()
	if err != nil {
		web.FailErr(w, r, web.ErrDBQuery, err.Error())
		return
	}
	web.OK(w, r, items)
}

func (h *SnapshotHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Note        string   `json:"note"`
		Trigger     string   `json:"trigger"`
		ResourceIDs []string `json:"resourceIds"`
		Password    string   `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	rec, err := h.svc.Create(req.Note, req.Trigger, req.Password, req.ResourceIDs)
	if err != nil {
		web.FailErr(w, r, web.ErrSnapshotCreateFailed, err.Error())
		return
	}
	h.auditRepo.Create(&database.AuditLog{UserID: web.GetUserID(r), Username: web.GetUsername(r), Action: constants.ActionSnapshotCreate, Result: "success", Detail: rec.SnapshotID, IP: r.RemoteAddr})
	web.OK(w, r, map[string]any{"snapshotId": rec.SnapshotID, "createdAt": rec.CreatedAt, "resourceCount": rec.ResourceCount, "sizeBytes": rec.SizeBytes})
}

func (h *SnapshotHandler) Schedule(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.GetSchedule(w, r)
	case http.MethodPut:
		h.UpdateSchedule(w, r)
	default:
		web.FailErr(w, r, web.ErrInvalidParam)
	}
}

func (h *SnapshotHandler) GetSchedule(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.scheduler.GetConfig()
	if err != nil {
		web.FailErr(w, r, web.ErrSettingsQueryFail, err.Error())
		return
	}
	web.OK(w, r, cfg)
}

func (h *SnapshotHandler) UpdateSchedule(w http.ResponseWriter, r *http.Request) {
	var req snapshots.ScheduleUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	if err := h.scheduler.UpdateConfig(req, web.GetUserID(r), web.GetUsername(r), r.RemoteAddr); err != nil {
		web.FailErr(w, r, web.ErrSettingsUpdateFail, err.Error())
		return
	}
	web.OK(w, r, map[string]any{"saved": true})
}

func (h *SnapshotHandler) GetScheduleStatus(w http.ResponseWriter, r *http.Request) {
	status, err := h.scheduler.GetStatus()
	if err != nil {
		web.FailErr(w, r, web.ErrSettingsQueryFail, err.Error())
		return
	}
	web.OK(w, r, status)
}

func (h *SnapshotHandler) Action(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	switch {
	case strings.HasSuffix(path, "/unlock-preview"):
		h.UnlockPreview(w, r)
	case strings.HasSuffix(path, "/restore-plan"):
		h.RestorePlan(w, r)
	case strings.HasSuffix(path, "/restore"):
		h.Restore(w, r)
	case strings.HasSuffix(path, "/export"):
		h.Export(w, r)
	case strings.HasSuffix(path, "/export-openclaw"):
		h.ExportOpenClaw(w, r)
	case strings.HasSuffix(path, "/verify"):
		h.Verify(w, r)
	case strings.HasSuffix(path, "/preview-file"):
		h.PreviewFile(w, r)
	case strings.HasSuffix(path, "/diff-file"):
		h.DiffFile(w, r)
	default:
		web.FailErr(w, r, web.ErrInvalidParam)
	}
}

func (h *SnapshotHandler) UnlockPreview(w http.ResponseWriter, r *http.Request) {
	snapshotID := strings.TrimPrefix(r.URL.Path, "/api/v1/snapshots/")
	snapshotID = strings.TrimSuffix(snapshotID, "/unlock-preview")
	if snapshotID == "" || snapshotID == r.URL.Path {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	res, err := h.svc.UnlockPreview(snapshotID, req.Password)
	if err != nil {
		web.FailErr(w, r, web.ErrSnapshotUnlockFailed, err.Error())
		return
	}
	h.auditRepo.Create(&database.AuditLog{UserID: web.GetUserID(r), Username: web.GetUsername(r), Action: constants.ActionSnapshotUnlock, Result: "success", Detail: snapshotID, IP: r.RemoteAddr})
	web.OK(w, r, res)
}

func (h *SnapshotHandler) RestorePlan(w http.ResponseWriter, r *http.Request) {
	snapshotID := strings.TrimPrefix(r.URL.Path, "/api/v1/snapshots/")
	snapshotID = strings.TrimSuffix(snapshotID, "/restore-plan")
	if snapshotID == "" || snapshotID == r.URL.Path {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}
	var req struct {
		PreviewToken      string                      `json:"previewToken"`
		RestoreSelections snapshots.RestoreSelections `json:"restoreSelections"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	plan, err := h.svc.RestorePlan(req.PreviewToken, req.RestoreSelections)
	if err != nil {
		web.FailErr(w, r, web.ErrSnapshotPlanFailed, err.Error())
		return
	}
	web.OK(w, r, plan)
}

func (h *SnapshotHandler) Restore(w http.ResponseWriter, r *http.Request) {
	snapshotID := strings.TrimPrefix(r.URL.Path, "/api/v1/snapshots/")
	snapshotID = strings.TrimSuffix(snapshotID, "/restore")
	if snapshotID == "" || snapshotID == r.URL.Path {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}
	var req struct {
		PreviewToken             string                      `json:"previewToken"`
		RestorePlan              snapshots.RestoreSelections `json:"restorePlan"`
		CreatePreRestoreSnapshot bool                        `json:"createPreRestoreSnapshot"`
		Password                 string                      `json:"password"`
		Stream                   bool                        `json:"stream"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	// Non-streaming fallback for backward compatibility
	if !req.Stream {
		res, err := h.svc.Restore(req.PreviewToken, req.RestorePlan, req.CreatePreRestoreSnapshot, req.Password)
		if err != nil {
			web.FailErr(w, r, web.ErrSnapshotRestoreFailed, err.Error())
			return
		}
		h.auditRepo.Create(&database.AuditLog{UserID: web.GetUserID(r), Username: web.GetUsername(r), Action: constants.ActionSnapshotRestore, Result: "success", Detail: snapshotID, IP: r.RemoteAddr})
		web.OK(w, r, res)
		return
	}
	// SSE streaming mode
	flusher, ok := w.(http.Flusher)
	if !ok {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	sendSSE := func(evt snapshots.RestoreProgressEvent) {
		data, _ := json.Marshal(evt)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}
	res, err := h.svc.RestoreWithProgress(req.PreviewToken, req.RestorePlan, req.CreatePreRestoreSnapshot, req.Password, func(evt snapshots.RestoreProgressEvent) {
		sendSSE(evt)
	})
	if err != nil {
		sendSSE(snapshots.RestoreProgressEvent{Phase: "error", Error: err.Error()})
		return
	}
	h.auditRepo.Create(&database.AuditLog{UserID: web.GetUserID(r), Username: web.GetUsername(r), Action: constants.ActionSnapshotRestore, Result: "success", Detail: snapshotID, IP: r.RemoteAddr})
	// Auto-restart gateway if needed
	if res.NeedsGatewayRestart && h.gatewaySvc != nil {
		sendSSE(snapshots.RestoreProgressEvent{Phase: "restarting", File: "gateway"})
		if err := h.gatewaySvc.Restart(); err != nil {
			res.GatewayRestartError = err.Error()
		} else {
			res.GatewayRestarted = true
		}
	}
	// Send final result
	finalData, _ := json.Marshal(res)
	fmt.Fprintf(w, "event: result\ndata: %s\n\n", finalData)
	flusher.Flush()
}

func (h *SnapshotHandler) Delete(w http.ResponseWriter, r *http.Request) {
	snapshotID := strings.TrimPrefix(r.URL.Path, "/api/v1/snapshots/")
	if snapshotID == "" || snapshotID == r.URL.Path {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}
	if err := h.svc.Delete(snapshotID); err != nil {
		web.FailErr(w, r, web.ErrSnapshotDeleteFailed, err.Error())
		return
	}
	h.auditRepo.Create(&database.AuditLog{UserID: web.GetUserID(r), Username: web.GetUsername(r), Action: constants.ActionSnapshotDelete, Result: "success", Detail: snapshotID, IP: r.RemoteAddr})
	web.OK(w, r, map[string]any{"deleted": true, "id": snapshotID})
}

func (h *SnapshotHandler) ScheduleRunNow(w http.ResponseWriter, r *http.Request) {
	resp, err := h.scheduler.RunNow(web.GetUserID(r), web.GetUsername(r), r.RemoteAddr)
	if err != nil {
		web.FailErr(w, r, web.ErrSnapshotCreateFailed, err.Error())
		return
	}
	web.OK(w, r, resp)
}

func (h *SnapshotHandler) Import(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(200 << 20); err != nil {
		web.FailErr(w, r, web.ErrSnapshotImportFailed, "file too large or invalid multipart form")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		web.FailErr(w, r, web.ErrSnapshotImportFailed, "missing file field")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, 200<<20+1))
	if err != nil || int64(len(data)) > 200<<20 {
		web.FailErr(w, r, web.ErrSnapshotImportFailed, "file too large")
		return
	}
	if len(data) < 8 {
		web.FailErr(w, r, web.ErrSnapshotImportFailed, "invalid backup file: too small")
		return
	}

	// Parse: 8 bytes big-endian header length + header JSON + ciphertext
	headerLen := uint64(data[0])<<56 | uint64(data[1])<<48 | uint64(data[2])<<40 | uint64(data[3])<<32 |
		uint64(data[4])<<24 | uint64(data[5])<<16 | uint64(data[6])<<8 | uint64(data[7])
	if headerLen == 0 || 8+headerLen > uint64(len(data)) {
		web.FailErr(w, r, web.ErrSnapshotImportFailed, "invalid backup file format")
		return
	}
	headerJSON := data[8 : 8+headerLen]
	ciphertext := data[8+headerLen:]

	rec, err := h.svc.ImportSnapshot(headerJSON, ciphertext)
	if err != nil {
		web.FailErr(w, r, web.ErrSnapshotImportFailed, err.Error())
		return
	}
	h.auditRepo.Create(&database.AuditLog{UserID: web.GetUserID(r), Username: web.GetUsername(r), Action: constants.ActionSnapshotImport, Result: "success", Detail: rec.SnapshotID, IP: r.RemoteAddr})
	web.OK(w, r, map[string]any{"snapshotId": rec.SnapshotID, "resourceCount": rec.ResourceCount, "sizeBytes": rec.SizeBytes})
}

func (h *SnapshotHandler) Export(w http.ResponseWriter, r *http.Request) {
	snapshotID := strings.TrimPrefix(r.URL.Path, "/api/v1/snapshots/")
	snapshotID = strings.TrimSuffix(snapshotID, "/export")
	if snapshotID == "" || snapshotID == r.URL.Path {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}
	rec, err := h.svc.ExportSnapshot(snapshotID)
	if err != nil {
		web.FailErr(w, r, web.ErrDBQuery, err.Error())
		return
	}
	exportName := "backup-" + rec.CreatedAt.Format("2006-01-02_150405") + ".clawbak"
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+exportName+"\"")
	envelope := map[string]any{
		"version":       rec.SnapshotVersion,
		"snapshotId":    rec.SnapshotID,
		"note":          rec.Note,
		"trigger":       rec.Trigger,
		"cipherAlg":     rec.CipherAlg,
		"kdfAlg":        rec.KDFAlg,
		"kdfParams":     rec.KDFParamsJSON,
		"salt":          rec.SaltB64,
		"wrappedDEK":    rec.WrappedDEKB64,
		"wrapNonce":     rec.WrapNonceB64,
		"dataNonce":     rec.DataNonceB64,
		"resourceCount": rec.ResourceCount,
		"sizeBytes":     rec.SizeBytes,
	}
	header, _ := json.Marshal(envelope)
	// Write header length (8 bytes big-endian) + header JSON + ciphertext
	headerLen := uint64(len(header))
	buf := make([]byte, 8)
	buf[0] = byte(headerLen >> 56)
	buf[1] = byte(headerLen >> 48)
	buf[2] = byte(headerLen >> 40)
	buf[3] = byte(headerLen >> 32)
	buf[4] = byte(headerLen >> 24)
	buf[5] = byte(headerLen >> 16)
	buf[6] = byte(headerLen >> 8)
	buf[7] = byte(headerLen)
	w.Write(buf)
	w.Write(header)
	w.Write(rec.Ciphertext)
}

func (h *SnapshotHandler) ImportOpenClaw(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(200 << 20); err != nil {
		web.FailErr(w, r, web.ErrSnapshotImportFailed, "file too large or invalid multipart form")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		web.FailErr(w, r, web.ErrSnapshotImportFailed, "missing file field")
		return
	}
	defer file.Close()

	password := r.FormValue("password")
	note := r.FormValue("note")

	data, err := io.ReadAll(io.LimitReader(file, 200<<20+1))
	if err != nil || int64(len(data)) > 200<<20 {
		web.FailErr(w, r, web.ErrSnapshotImportFailed, "file too large")
		return
	}

	result, err := h.svc.ImportFromTarGz(data, password, note)
	if err != nil {
		web.FailErr(w, r, web.ErrSnapshotImportFailed, err.Error())
		return
	}
	h.auditRepo.Create(&database.AuditLog{UserID: web.GetUserID(r), Username: web.GetUsername(r), Action: constants.ActionSnapshotImport, Result: "success", Detail: result.SnapshotID + " (openclaw)", IP: r.RemoteAddr})
	web.OK(w, r, result)
}

func (h *SnapshotHandler) ExportOpenClaw(w http.ResponseWriter, r *http.Request) {
	snapshotID := strings.TrimPrefix(r.URL.Path, "/api/v1/snapshots/")
	snapshotID = strings.TrimSuffix(snapshotID, "/export-openclaw")
	if snapshotID == "" || snapshotID == r.URL.Path {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	data, exportName, err := h.svc.ExportAsOpenClawTarGz(snapshotID, req.Password)
	if err != nil {
		web.FailErr(w, r, web.ErrSnapshotExportFailed, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+exportName+"\"")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
	w.Write(data)
}

func (h *SnapshotHandler) Verify(w http.ResponseWriter, r *http.Request) {
	snapshotID := strings.TrimPrefix(r.URL.Path, "/api/v1/snapshots/")
	snapshotID = strings.TrimSuffix(snapshotID, "/verify")
	if snapshotID == "" || snapshotID == r.URL.Path {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	result, err := h.svc.VerifyIntegrity(snapshotID, req.Password)
	if err != nil {
		web.FailErr(w, r, web.ErrDBQuery, err.Error())
		return
	}
	web.OK(w, r, result)
}

func (h *SnapshotHandler) PreviewFile(w http.ResponseWriter, r *http.Request) {
	snapshotID := strings.TrimPrefix(r.URL.Path, "/api/v1/snapshots/")
	snapshotID = strings.TrimSuffix(snapshotID, "/preview-file")
	_ = snapshotID // snapshot ID extracted but not needed; token carries the context
	var req struct {
		PreviewToken string `json:"previewToken"`
		LogicalPath  string `json:"logicalPath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	content, err := h.svc.PreviewFileContent(req.PreviewToken, req.LogicalPath)
	if err != nil {
		web.FailErr(w, r, web.ErrInvalidParam, err.Error())
		return
	}
	web.OK(w, r, map[string]any{"logical_path": req.LogicalPath, "content": string(content), "size": len(content)})
}

func (h *SnapshotHandler) DiffFile(w http.ResponseWriter, r *http.Request) {
	snapshotID := strings.TrimPrefix(r.URL.Path, "/api/v1/snapshots/")
	snapshotID = strings.TrimSuffix(snapshotID, "/diff-file")
	_ = snapshotID
	var req struct {
		PreviewToken string `json:"previewToken"`
		LogicalPath  string `json:"logicalPath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	diff, err := h.svc.DiffFileContent(req.PreviewToken, req.LogicalPath)
	if err != nil {
		web.FailErr(w, r, web.ErrInvalidParam, err.Error())
		return
	}
	web.OK(w, r, diff)
}

func (h *SnapshotHandler) Stats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.svc.Stats()
	if err != nil {
		web.FailErr(w, r, web.ErrDBQuery, err.Error())
		return
	}
	// Attach schedule enabled status
	if cfg, err := h.scheduler.GetConfig(); err == nil {
		stats.ScheduleEnabled = cfg.Enabled
	}
	web.OK(w, r, stats)
}

func (h *SnapshotHandler) BatchDelete(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	if len(req.IDs) == 0 {
		web.FailErr(w, r, web.ErrInvalidParam, "no snapshot IDs provided")
		return
	}
	deleted, errs := h.svc.BatchDelete(req.IDs)
	if len(deleted) > 0 {
		h.auditRepo.Create(&database.AuditLog{UserID: web.GetUserID(r), Username: web.GetUsername(r), Action: constants.ActionSnapshotDelete, Result: "success", Detail: fmt.Sprintf("batch delete %d snapshots", len(deleted)), IP: r.RemoteAddr})
	}
	web.OK(w, r, map[string]any{"deleted": deleted, "errors": errs})
}

func (h *SnapshotHandler) PruneKeepN(w http.ResponseWriter, r *http.Request) {
	var req struct {
		KeepN int `json:"keepN"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	deleted, err := h.svc.PruneKeepN(req.KeepN)
	if err != nil {
		web.FailErr(w, r, web.ErrSnapshotDeleteFailed, err.Error())
		return
	}
	if len(deleted) > 0 {
		h.auditRepo.Create(&database.AuditLog{UserID: web.GetUserID(r), Username: web.GetUsername(r), Action: constants.ActionSnapshotDelete, Result: "success", Detail: fmt.Sprintf("pruned %d, kept %d", len(deleted), req.KeepN), IP: r.RemoteAddr})
	}
	web.OK(w, r, map[string]any{"deleted": deleted, "kept": req.KeepN})
}
