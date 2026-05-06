package handlers

import (
	"fmt"
	"net/http"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/snapshots"
)

func setRemoteAuth(req *http.Request, auth remoteOpenClawRequest) {
	if auth.Cookie != "" {
		req.Header.Set("Cookie", auth.Cookie)
	}
	if auth.Token != "" {
		req.Header.Set("Authorization", "Bearer "+auth.Token)
	}
}

func importClawbakBytes(data []byte) (*database.SnapshotRecord, error) {
	if len(data) < 8 {
		return nil, fmt.Errorf("invalid remote backup: too small")
	}
	headerLen := uint64(data[0])<<56 | uint64(data[1])<<48 | uint64(data[2])<<40 | uint64(data[3])<<32 | uint64(data[4])<<24 | uint64(data[5])<<16 | uint64(data[6])<<8 | uint64(data[7])
	if headerLen == 0 || 8+headerLen > uint64(len(data)) {
		return nil, fmt.Errorf("invalid remote backup format")
	}
	return snapshots.NewService().ImportSnapshot(data[8:8+headerLen], data[8+headerLen:])
}
