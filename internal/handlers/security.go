package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/security"
	"ClawDeckX/internal/web"
)

// SecurityHandler manages security rules.
type SecurityHandler struct {
	ruleRepo *database.RiskRuleRepo
	engine   *security.Engine
}

func NewSecurityHandler(engine *security.Engine) *SecurityHandler {
	return &SecurityHandler{
		ruleRepo: database.NewRiskRuleRepo(),
		engine:   engine,
	}
}

// ListRules returns all risk rules.
func (h *SecurityHandler) ListRules(w http.ResponseWriter, r *http.Request) {
	rules, err := h.ruleRepo.ListAll()
	if err != nil {
		web.FailErr(w, r, web.ErrSecurityQueryFail)
		return
	}
	web.OK(w, r, rules)
}

// createRuleRequest is the request body for creating a rule.
type createRuleRequest struct {
	RuleID   string `json:"rule_id"`
	Category string `json:"category"`
	Risk     string `json:"risk"`
	Pattern  string `json:"pattern"`
	Reason   string `json:"reason"`
	Actions  string `json:"actions"`
	Enabled  bool   `json:"enabled"`
}

// CreateRule creates a custom rule.
func (h *SecurityHandler) CreateRule(w http.ResponseWriter, r *http.Request) {
	var req createRuleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	if req.RuleID == "" || req.Pattern == "" || req.Reason == "" {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	if existing, _ := h.ruleRepo.FindByRuleID(req.RuleID); existing != nil {
		web.FailErr(w, r, web.ErrSecurityRuleExists)
		return
	}

	rule := &database.RiskRule{
		RuleID:   req.RuleID,
		Category: req.Category,
		Risk:     req.Risk,
		Pattern:  req.Pattern,
		Reason:   req.Reason,
		Actions:  req.Actions,
		Enabled:  req.Enabled,
		BuiltIn:  false,
	}

	if err := h.ruleRepo.Create(rule); err != nil {
		web.FailErr(w, r, web.ErrSecurityCreateFail)
		return
	}

	h.engine.Reload()

	logger.Security.Info().Str("rule_id", req.RuleID).Msg("custom rule created")
	web.OK(w, r, rule)
}

// UpdateRule updates a rule.
func (h *SecurityHandler) UpdateRule(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/v1/security/rules/")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	existing, err := h.ruleRepo.FindByID(uint(id))
	if err != nil {
		web.FailErr(w, r, web.ErrNotFound)
		return
	}

	var req createRuleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	// builtin rules can only toggle enabled
	if existing.BuiltIn {
		existing.Enabled = req.Enabled
	} else {
		if req.Category != "" {
			existing.Category = req.Category
		}
		if req.Risk != "" {
			existing.Risk = req.Risk
		}
		if req.Pattern != "" {
			existing.Pattern = req.Pattern
		}
		if req.Reason != "" {
			existing.Reason = req.Reason
		}
		if req.Actions != "" {
			existing.Actions = req.Actions
		}
		existing.Enabled = req.Enabled
	}

	if err := h.ruleRepo.Update(existing); err != nil {
		web.FailErr(w, r, web.ErrSecurityUpdateFail)
		return
	}

	h.engine.Reload()

	logger.Security.Info().Str("rule_id", existing.RuleID).Msg("rule updated")
	web.OK(w, r, existing)
}

// DeleteRule deletes a rule (builtin rules cannot be deleted).
func (h *SecurityHandler) DeleteRule(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/v1/security/rules/")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	existing, err := h.ruleRepo.FindByID(uint(id))
	if err != nil {
		web.FailErr(w, r, web.ErrNotFound)
		return
	}

	if existing.BuiltIn {
		web.FailErr(w, r, web.ErrSecurityBuiltinRO)
		return
	}

	if err := h.ruleRepo.Delete(uint(id)); err != nil {
		web.FailErr(w, r, web.ErrSecurityDeleteFail)
		return
	}

	h.engine.Reload()

	logger.Security.Info().Str("rule_id", existing.RuleID).Msg("rule deleted")
	web.OK(w, r, map[string]string{"message": "ok"})
}
