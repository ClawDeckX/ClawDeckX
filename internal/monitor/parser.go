package monitor

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/logger"
)

// RawEvent Sessions JSONL 中的原始事件结构
type RawEvent struct {
	Type      string                 `json:"type"`
	Timestamp string                 `json:"timestamp"`
	Tool      string                 `json:"tool"`
	Input     map[string]interface{} `json:"input"`
	Output    interface{}            `json:"output"`
	Error     interface{}            `json:"error"`
	SessionID string                 `json:"session_id"`
	Extra     map[string]interface{} `json:"extra"`
}

// NormalizedEvent 归一化后的事件
type NormalizedEvent struct {
	EventID   string    `json:"event_id"`
	Timestamp time.Time `json:"timestamp"`
	Category  string    `json:"category"`
	Risk      string    `json:"risk"`
	Summary   string    `json:"summary"`
	Detail    string    `json:"detail"`
	Source    string    `json:"source"`
	SessionID string   `json:"session_id"`
}

// SessionParser Sessions JSONL 增量解析器
type SessionParser struct {
	sessionsDir string
	offsets     map[string]int64 // 文件名 → 已读取偏移量
}

func NewSessionParser(openclawDir string) *SessionParser {
	return &SessionParser{
		sessionsDir: filepath.Join(openclawDir, "sessions"),
		offsets:     make(map[string]int64),
	}
}

// ReadNewEvents 增量读取所有 session 文件中的新事件
func (p *SessionParser) ReadNewEvents() ([]NormalizedEvent, error) {
	var allEvents []NormalizedEvent

	files, err := filepath.Glob(filepath.Join(p.sessionsDir, "*.jsonl"))
	if err != nil {
		return nil, err
	}

	for _, filePath := range files {
		events, err := p.readFile(filePath)
		if err != nil {
			logger.Monitor.Warn().Str("file", filePath).Err(err).Msg("解析 session 文件失败")
			continue
		}
		allEvents = append(allEvents, events...)
	}

	return allEvents, nil
}

// readFile 增量读取单个 JSONL 文件
func (p *SessionParser) readFile(filePath string) ([]NormalizedEvent, error) {
	fileName := filepath.Base(filePath)
	offset := p.offsets[fileName]

	f, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	// 跳到上次读取位置
	if offset > 0 {
		if _, err := f.Seek(offset, 0); err != nil {
			return nil, err
		}
	}

	var events []NormalizedEvent
	scanner := bufio.NewScanner(f)
	// 增大缓冲区以处理大行
	scanner.Buffer(make([]byte, 0, 256*1024), 1024*1024)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var raw RawEvent
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			logger.Monitor.Debug().Str("line", line[:min(len(line), 100)]).Msg("跳过无法解析的行")
			continue
		}

		event := normalizeEvent(raw)
		if event != nil {
			events = append(events, *event)
		}
	}

	// 更新偏移量
	newOffset, _ := f.Seek(0, 1) // 获取当前位置
	p.offsets[fileName] = newOffset

	return events, scanner.Err()
}

// normalizeEvent 将原始事件归一化
func normalizeEvent(raw RawEvent) *NormalizedEvent {
	ts := parseTimestamp(raw.Timestamp)
	category := classifyCategory(raw.Tool, raw.Type)
	risk := assessRisk(raw.Tool, raw.Input)
	summary := buildSummary(raw)
	detail, _ := json.Marshal(raw)

	// 生成事件 ID
	eventID := "evt_" + ts.Format("20060102150405") + "_" + sanitize(raw.Tool)

	return &NormalizedEvent{
		EventID:   eventID,
		Timestamp: ts,
		Category:  category,
		Risk:      risk,
		Summary:   summary,
		Detail:    string(detail),
		Source:    raw.Tool,
		SessionID: raw.SessionID,
	}
}

// classifyCategory 根据工具名分类
func classifyCategory(tool, eventType string) string {
	tool = strings.ToLower(tool)

	switch {
	case strings.Contains(tool, "bash") || strings.Contains(tool, "shell") || strings.Contains(tool, "command"):
		return constants.CategoryShell
	case strings.Contains(tool, "file") || strings.Contains(tool, "read") || strings.Contains(tool, "write") || strings.Contains(tool, "edit"):
		return constants.CategoryFile
	case strings.Contains(tool, "http") || strings.Contains(tool, "fetch") || strings.Contains(tool, "curl") || strings.Contains(tool, "network"):
		return constants.CategoryNetwork
	case strings.Contains(tool, "browser") || strings.Contains(tool, "chrome") || strings.Contains(tool, "puppeteer"):
		return constants.CategoryBrowser
	case strings.Contains(tool, "message") || strings.Contains(tool, "chat") || strings.Contains(tool, "telegram") || strings.Contains(tool, "slack"):
		return constants.CategoryMessage
	case strings.Contains(tool, "memory") || strings.Contains(tool, "remember"):
		return constants.CategoryMemory
	default:
		return constants.CategorySystem
	}
}

// assessRisk 评估风险等级
func assessRisk(tool string, input map[string]interface{}) string {
	tool = strings.ToLower(tool)

	// Shell 命令风险评估
	if strings.Contains(tool, "bash") || strings.Contains(tool, "shell") {
		cmd := extractCommand(input)
		cmdLower := strings.ToLower(cmd)

		// 高危命令
		highRiskPatterns := []string{
			"rm -rf", "rm -r /", "mkfs", "dd if=",
			"chmod 777", "curl | sh", "wget | sh",
			"ssh ", "scp ", "rsync ",
			"> /dev/", "shutdown", "reboot",
			"passwd", "useradd", "userdel",
		}
		for _, p := range highRiskPatterns {
			if strings.Contains(cmdLower, p) {
				return constants.RiskHigh
			}
		}

		// 中等风险
		mediumRiskPatterns := []string{
			"sudo ", "pip install", "npm install",
			"apt install", "yum install", "brew install",
			"chmod ", "chown ", "kill ",
		}
		for _, p := range mediumRiskPatterns {
			if strings.Contains(cmdLower, p) {
				return constants.RiskMedium
			}
		}
	}

	// 网络请求风险
	if strings.Contains(tool, "http") || strings.Contains(tool, "fetch") {
		return constants.RiskMedium
	}

	// 文件写入风险
	if strings.Contains(tool, "write") || strings.Contains(tool, "edit") {
		return constants.RiskLow
	}

	return constants.RiskLow
}

// buildSummary 构建事件摘要
func buildSummary(raw RawEvent) string {
	tool := raw.Tool
	if tool == "" {
		tool = raw.Type
	}

	// 尝试从 input 中提取关键信息
	if cmd := extractCommand(raw.Input); cmd != "" {
		if len(cmd) > 120 {
			cmd = cmd[:120] + "..."
		}
		return "执行 " + cmd
	}

	if path, ok := raw.Input["path"].(string); ok {
		return tool + " → " + path
	}

	if url, ok := raw.Input["url"].(string); ok {
		return tool + " → " + url
	}

	return tool
}

// extractCommand 从 input 中提取命令字符串
func extractCommand(input map[string]interface{}) string {
	for _, key := range []string{"command", "cmd", "script", "code"} {
		if v, ok := input[key].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

// parseTimestamp 解析时间戳
func parseTimestamp(s string) time.Time {
	formats := []string{
		time.RFC3339,
		time.RFC3339Nano,
		"2006-01-02T15:04:05Z",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, s); err == nil {
			return t.UTC()
		}
	}
	return time.Now().UTC()
}

// sanitize 清理字符串用于 ID 生成
func sanitize(s string) string {
	s = strings.ReplaceAll(s, ".", "_")
	s = strings.ReplaceAll(s, " ", "_")
	if len(s) > 20 {
		s = s[:20]
	}
	return s
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
