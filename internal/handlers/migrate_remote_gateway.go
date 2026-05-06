package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/snapshots"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type remoteGatewayRPC struct {
	conn *websocket.Conn
}

func (h *MigrateHandler) importFromRemoteGateway(ctx context.Context, req remoteOpenClawRequest) (*database.SnapshotRecord, error) {
	rpc, err := dialRemoteGateway(ctx, req)
	if err != nil {
		return nil, err
	}
	defer rpc.conn.Close()
	cfgRaw, err := rpc.call("config.get", map[string]any{})
	if err != nil {
		return nil, err
	}
	cfgBytes, cfgMap, err := normalizeRemoteConfig(cfgRaw)
	if err != nil {
		return nil, err
	}
	resources := []snapshots.ResourceContent{{
		Definition: snapshots.ResourceDefinition{ID: "openclaw.config", Type: "json", DisplayName: "OpenClaw config", LogicalPath: "files/config/openclaw.json", RestoreMode: snapshots.RestoreModeJSON, Scope: snapshots.BackupScopeOpenClaw},
		Content:    cfgBytes,
	}}
	resources = append(resources, readRemoteAgentFiles(rpc, cfgMap)...)
	return snapshots.NewService().CreateFromResources(req.Note, "remote-openclaw-gateway", req.Password, resources)
}

func dialRemoteGateway(ctx context.Context, req remoteOpenClawRequest) (*remoteGatewayRPC, error) {
	host := strings.TrimSpace(req.Host)
	if host == "" {
		host = "127.0.0.1"
	}
	port := req.Port
	if port == 0 {
		port = 18789
	}
	path := req.GatewayPath
	if path == "" {
		path = "/"
	}
	u := url.URL{Scheme: "ws", Host: fmt.Sprintf("%s:%d", host, port), Path: path}
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, _, err := dialer.DialContext(ctx, u.String(), nil)
	if err != nil {
		return nil, err
	}
	rpc := &remoteGatewayRPC{conn: conn}
	_, err = rpc.call("connect", openclaw.ConnectParams{MinProtocol: 1, MaxProtocol: 1, Role: "operator", Scopes: []string{"config:read", "files:read"}, Caps: []string{"config", "files"}, Auth: &openclaw.ConnectAuth{Token: req.Token}, Client: openclaw.ConnectClient{ID: "clawdeckx-remote-migrate", DisplayName: "ClawDeckX Remote Migration", Version: "1", Platform: "clawdeckx", Mode: "migration"}})
	if err != nil {
		conn.Close()
		return nil, err
	}
	return rpc, nil
}

func (r *remoteGatewayRPC) call(method string, params any) (json.RawMessage, error) {
	id := uuid.New().String()
	if err := r.conn.WriteJSON(openclaw.RequestFrame{Type: "req", ID: id, Method: method, Params: params}); err != nil {
		return nil, err
	}
	deadline := time.Now().Add(30 * time.Second)
	_ = r.conn.SetReadDeadline(deadline)
	for {
		var raw json.RawMessage
		if err := r.conn.ReadJSON(&raw); err != nil {
			return nil, err
		}
		var resp openclaw.ResponseFrame
		if json.Unmarshal(raw, &resp) != nil || resp.ID != id {
			continue
		}
		if !resp.OK {
			if resp.Error != nil {
				return nil, fmt.Errorf("%s", resp.Error.Message)
			}
			return nil, fmt.Errorf("remote gateway rpc failed")
		}
		return resp.Payload, nil
	}
}
