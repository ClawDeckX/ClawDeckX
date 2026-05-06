package handlers

import (
	"encoding/json"
	"regexp"
	"strings"
)

func remoteAgentFileContent(rpc *remoteGatewayRPC, agent, name string) (string, bool) {
	data, err := rpc.call("agents.files.get", map[string]any{"agentId": agent, "name": name})
	if err != nil { return "", false }
	var resp map[string]any
	if json.Unmarshal(data, &resp) != nil { return "", false }
	if fileObj, ok := resp["file"].(map[string]any); ok {
		if missing, _ := fileObj["missing"].(bool); missing { return "", false }
		if content, ok := fileObj["content"].(string); ok { return content, true }
	}
	if exists, ok := resp["exists"].(bool); ok && !exists { return "", false }
	content, ok := resp["content"].(string)
	return content, ok
}

var remoteSegmentRE = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

func safeRemoteSegment(v string) string {
	v = strings.Trim(remoteSegmentRE.ReplaceAllString(v, "_"), "._-")
	if v == "" { return "item" }
	return v
}
