package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"ClawDeckX/internal/database"
)

func (h *MigrateHandler) importFromRemoteClawDeckX(ctx context.Context, req remoteOpenClawRequest) (*database.SnapshotRecord, error) {
	base, err := url.Parse(strings.TrimRight(req.BaseURL, "/"))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return nil, fmt.Errorf("invalid remote url")
	}
	client := &http.Client{Timeout: 5 * time.Minute}
	if req.Username != "" && req.LoginPassword != "" {
		cookie, err := remoteLogin(ctx, client, base, req.Username, req.LoginPassword)
		if err != nil {
			return nil, fmt.Errorf("remote login failed: %w", err)
		}
		req.Cookie = cookie
	}
	createPayload := map[string]any{"password": req.Password, "trigger": "remote-openclaw", "note": req.Note, "scope": req.Scope, "resourceIds": req.ResourceIDs}
	data, err := remotePostJSON(ctx, client, base, "/api/v1/snapshots", createPayload, req)
	if err != nil {
		return nil, err
	}
	var created struct {
		Success bool `json:"success"`
		Data    struct {
			SnapshotID string `json:"snapshotId"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(data, &created); err != nil {
		return nil, err
	}
	if !created.Success || created.Data.SnapshotID == "" {
		return nil, fmt.Errorf("remote snapshot create failed: %s", created.Message)
	}
	exported, err := remoteExportSnapshot(ctx, client, base, created.Data.SnapshotID, req)
	if err != nil {
		return nil, err
	}
	return importClawbakBytes(exported)
}
