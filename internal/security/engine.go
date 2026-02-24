package security

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"strings"
	"sync"
	"time"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/web"
)

// Notifier is the interface used to send external notifications.
type Notifier interface {
	SendAlert(risk, message, detail string)
}

// Engine 风险规则引擎
type Engine struct {
	ruleRepo     *database.RiskRuleRepo
	alertRepo    *database.AlertRepo
	activityRepo *database.ActivityRepo
	auditRepo    *database.AuditLogRepo
	wsHub        *web.WSHub
	notifier     Notifier
	rules        []database.RiskRule
	compiled     map[uint]*regexp.Regexp
	mu           sync.RWMutex
}

// MatchResult 规则匹配结果
type MatchResult struct {
	Matched bool
	Rule    *database.RiskRule
	Actions []string
}

func NewEngine(wsHub *web.WSHub) *Engine {
	return &Engine{
		ruleRepo:     database.NewRiskRuleRepo(),
		alertRepo:    database.NewAlertRepo(),
		activityRepo: database.NewActivityRepo(),
		auditRepo:    database.NewAuditLogRepo(),
		wsHub:        wsHub,
		compiled:     make(map[uint]*regexp.Regexp),
	}
}

// SetNotifier injects the external notification sender.
func (e *Engine) SetNotifier(n Notifier) {
	e.notifier = n
}

// Init 初始化引擎：种子内置规则 + 加载规则到内存
func (e *Engine) Init() error {
	// 种子内置规则
	if err := e.ruleRepo.SeedBuiltinRules(BuiltinRules()); err != nil {
		return err
	}
	return e.Reload()
}

// Reload 重新加载规则到内存
func (e *Engine) Reload() error {
	rules, err := e.ruleRepo.ListEnabled()
	if err != nil {
		return err
	}

	compiled := make(map[uint]*regexp.Regexp)
	for _, r := range rules {
		if r.Pattern != "" {
			re, err := regexp.Compile(r.Pattern)
			if err != nil {
				logger.Security.Warn().
					Str("rule_id", r.RuleID).
					Str("pattern", r.Pattern).
					Err(err).
					Msg("规则正则编译失败，跳过")
				continue
			}
			compiled[r.ID] = re
		}
	}

	e.mu.Lock()
	e.rules = rules
	e.compiled = compiled
	e.mu.Unlock()

	logger.Security.Info().Int("count", len(rules)).Msg("风险规则已加载")
	return nil
}

// Evaluate 评估事件，返回最高风险的匹配结果
func (e *Engine) Evaluate(category, source, summary string) *MatchResult {
	e.mu.RLock()
	defer e.mu.RUnlock()

	var bestMatch *MatchResult
	text := strings.ToLower(source + " " + summary)

	for i := range e.rules {
		rule := &e.rules[i]

		// 分类匹配
		if rule.Category != "" && !strings.EqualFold(rule.Category, category) {
			continue
		}

		// 正则匹配
		re, ok := e.compiled[rule.ID]
		if !ok || re == nil {
			continue
		}
		if !re.MatchString(text) {
			continue
		}

		// 取最高风险等级的匹配
		if bestMatch == nil || riskLevel(rule.Risk) > riskLevel(bestMatch.Rule.Risk) {
			var actions []string
			json.Unmarshal([]byte(rule.Actions), &actions)
			bestMatch = &MatchResult{
				Matched: true,
				Rule:    rule,
				Actions: actions,
			}
		}
	}

	return bestMatch
}

// ProcessEvent 处理事件：评估 + 执行动作 + 记录
func (e *Engine) ProcessEvent(category, source, summary, detail, sessionID string) string {
	result := e.Evaluate(category, source, summary)
	if result == nil || !result.Matched {
		return constants.ActionTakenAllow
	}

	actionTaken := constants.ActionTakenAllow
	for _, action := range result.Actions {
		switch action {
		case "warn":
			if actionTaken == constants.ActionTakenAllow {
				actionTaken = constants.ActionTakenWarn
			}
		case "abort":
			actionTaken = constants.ActionTakenAbort
		case "notify":
			if actionTaken != constants.ActionTakenAbort {
				actionTaken = constants.ActionTakenNotify
			}
		}
	}

	// 记录告警
	if actionTaken != constants.ActionTakenAllow {
		alert := &database.Alert{
			AlertID: "alert_" + time.Now().UTC().Format("20060102150405") + "_" + randomHex(4),
			Risk:    result.Rule.Risk,
			Message: result.Rule.Reason + "：" + summary,
			Detail:  detail,
		}
		e.alertRepo.Create(alert)

		// WebSocket 推送告警
		e.wsHub.Broadcast("alert", "alert", map[string]interface{}{
			"id":        alert.AlertID,
			"risk":      alert.Risk,
			"message":   alert.Message,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})

		logger.Security.Warn().
			Str("rule_id", result.Rule.RuleID).
			Str("risk", result.Rule.Risk).
			Str("action", actionTaken).
			Str("summary", summary).
			Msg("安全规则触发")

		// 发送外部通知
		if e.notifier != nil {
			go e.notifier.SendAlert(alert.Risk, alert.Message, "")
		}
	}

	return actionTaken
}

func randomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// riskLevel 风险等级数值化（用于比较）
func riskLevel(risk string) int {
	switch risk {
	case constants.RiskCritical:
		return 4
	case constants.RiskHigh:
		return 3
	case constants.RiskMedium:
		return 2
	case constants.RiskLow:
		return 1
	default:
		return 0
	}
}
