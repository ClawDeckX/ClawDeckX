package handlers

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"ClawDeckX/internal/snapshots"
)

func normalizeRemoteConfig(raw json.RawMessage) ([]byte, map[string]any, error) {
	var outer map[string]any
	if err := json.Unmarshal(raw, &outer); err != nil { return nil, nil, err }
	cfg, _ := outer["config"].(map[string]any)
	if cfg == nil { cfg, _ = outer["parsed"].(map[string]any) }
	if cfg == nil { cfg = outer }
	b, err := json.MarshalIndent(cfg, "", "  ")
	return b, cfg, err
}

func readRemoteAgentFiles(rpc *remoteGatewayRPC, cfg map[string]any) []snapshots.ResourceContent {
	agents, _ := cfg["agents"].(map[string]any)
	list, _ := agents["list"].([]any)
	names := []string{"SOUL.md", "AGENTS.md", "USER.md", "IDENTITY.md", "MEMORY.md", "HEARTBEAT.md", "TOOLS.md", "BOOTSTRAP.md"}
	out := []snapshots.ResourceContent{}
	for _, raw := range list {
		entry, _ := raw.(map[string]any)
		if entry == nil { continue }
		agent, _ := entry["id"].(string)
		if agent == "" { agent, _ = entry["name"].(string) }
		agent = strings.TrimSpace(agent)
		if agent == "" { continue }
		for _, name := range names {
			content, ok := remoteAgentFileContent(rpc, agent, name)
			if !ok { continue }
			logical := filepath.ToSlash(filepath.Join("files", "agents", agent, name))
			id := fmt.Sprintf("agent.%s.%s", safeRemoteSegment(agent), safeRemoteSegment(name))
			out = append(out, snapshots.ResourceContent{Definition: snapshots.ResourceDefinition{ID: id, Type: "markdown", DisplayName: fmt.Sprintf("Agent %s %s", agent, name), LogicalPath: logical, RestoreMode: snapshots.RestoreModeFile, Scope: snapshots.BackupScopeOpenClaw}, Content: []byte(content)})
		}
	}
	return out
}
