package snapshots

import (
	"fmt"
	"path/filepath"
	"strings"
)

func gatewayDiscoveredAgentResources(cfg map[string]interface{}) []ResourceDefinition {
	agents, _ := cfg["agents"].(map[string]interface{})
	list, _ := agents["list"].([]interface{})
	names := []string{"SOUL.md", "AGENTS.md", "USER.md", "IDENTITY.md", "MEMORY.md", "HEARTBEAT.md", "TOOLS.md", "BOOTSTRAP.md"}
	out := make([]ResourceDefinition, 0, len(list)*len(names))
	for _, raw := range list {
		entry, _ := raw.(map[string]interface{})
		if entry == nil { continue }
		agent, _ := entry["id"].(string)
		if agent == "" { agent, _ = entry["name"].(string) }
		agent = strings.TrimSpace(agent)
		seg := sanitizeResourceSegment(agent)
		if seg == "" { continue }
		for _, name := range names {
			out = append(out, ResourceDefinition{ID: fmt.Sprintf("agent.%s.%s", seg, sanitizeResourceSegment(name)), Type: "markdown", DisplayName: fmt.Sprintf("Agent %s %s", agent, name), LogicalPath: filepath.ToSlash(filepath.Join("files", "agents", agent, name)), RestoreMode: RestoreModeFile, Scope: BackupScopeOpenClaw, ResolvePath: func() string { return "" }})
		}
	}
	return out
}
