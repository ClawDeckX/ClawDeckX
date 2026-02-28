package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/web"
)

// TemplateHandler manages workspace file template CRUD.
type TemplateHandler struct {
	repo *database.TemplateRepo
}

func NewTemplateHandler() *TemplateHandler {
	return &TemplateHandler{
		repo: database.NewTemplateRepo(),
	}
}

// List returns all templates, optionally filtered by ?target_file=SOUL.md
func (h *TemplateHandler) List(w http.ResponseWriter, r *http.Request) {
	targetFile := r.URL.Query().Get("target_file")
	templates, err := h.repo.List(targetFile)
	if err != nil {
		web.FailErr(w, r, web.ErrDBQuery)
		return
	}
	web.OK(w, r, templates)
}

// Get returns a single template by ID (query param ?id=).
func (h *TemplateHandler) Get(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}
	tpl, err := h.repo.GetByID(uint(id))
	if err != nil {
		web.FailErr(w, r, web.ErrNotFound)
		return
	}
	web.OK(w, r, tpl)
}

// createRequest is the JSON body for creating/updating a template.
type createTemplateRequest struct {
	TemplateID string `json:"template_id"`
	TargetFile string `json:"target_file"`
	Icon       string `json:"icon"`
	Category   string `json:"category"`
	Tags       string `json:"tags"`
	Author     string `json:"author"`
	I18n       string `json:"i18n"`
}

// Create adds a new user template.
func (h *TemplateHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createTemplateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	if req.TemplateID == "" || req.TargetFile == "" || req.I18n == "" {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}
	// Validate i18n is valid JSON
	var i18nCheck map[string]interface{}
	if err := json.Unmarshal([]byte(req.I18n), &i18nCheck); err != nil {
		web.FailErr(w, r, web.ErrInvalidParam, "i18n must be valid JSON")
		return
	}
	// Ensure template_id doesn't conflict
	if existing, _ := h.repo.GetByTemplateID(req.TemplateID); existing != nil {
		web.FailErr(w, r, web.ErrTemplateExists)
		return
	}
	tpl := &database.Template{
		TemplateID: req.TemplateID,
		TargetFile: req.TargetFile,
		Icon:       req.Icon,
		Category:   req.Category,
		Tags:       req.Tags,
		Author:     req.Author,
		BuiltIn:    false,
		I18n:       req.I18n,
		Version:    1,
	}
	if err := h.repo.Create(tpl); err != nil {
		web.FailErr(w, r, web.ErrTemplateCreateFail)
		return
	}
	web.OK(w, r, tpl)
}

// Update modifies an existing user template. Built-in templates cannot be updated.
func (h *TemplateHandler) Update(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID         uint   `json:"id"`
		TemplateID string `json:"template_id"`
		TargetFile string `json:"target_file"`
		Icon       string `json:"icon"`
		Category   string `json:"category"`
		Tags       string `json:"tags"`
		Author     string `json:"author"`
		I18n       string `json:"i18n"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	if req.ID == 0 {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}
	tpl, err := h.repo.GetByID(req.ID)
	if err != nil {
		web.FailErr(w, r, web.ErrNotFound)
		return
	}
	if tpl.BuiltIn {
		web.FailErr(w, r, web.ErrTemplateBuiltinRO)
		return
	}
	if req.TemplateID != "" {
		tpl.TemplateID = req.TemplateID
	}
	if req.TargetFile != "" {
		tpl.TargetFile = req.TargetFile
	}
	if req.Icon != "" {
		tpl.Icon = req.Icon
	}
	if req.Category != "" {
		tpl.Category = req.Category
	}
	if req.Tags != "" {
		tpl.Tags = req.Tags
	}
	if req.Author != "" {
		tpl.Author = req.Author
	}
	if req.I18n != "" {
		var i18nCheck map[string]interface{}
		if err := json.Unmarshal([]byte(req.I18n), &i18nCheck); err != nil {
			web.FailErr(w, r, web.ErrInvalidParam, "i18n must be valid JSON")
			return
		}
		tpl.I18n = req.I18n
	}
	if err := h.repo.Update(tpl); err != nil {
		web.FailErr(w, r, web.ErrTemplateUpdateFail)
		return
	}
	web.OK(w, r, tpl)
}

// Delete removes a user template. Built-in templates cannot be deleted.
func (h *TemplateHandler) Delete(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}
	tpl, err := h.repo.GetByID(uint(id))
	if err != nil {
		web.FailErr(w, r, web.ErrNotFound)
		return
	}
	if tpl.BuiltIn {
		web.FailErr(w, r, web.ErrTemplateBuiltinRO)
		return
	}
	if err := h.repo.Delete(uint(id)); err != nil {
		web.FailErr(w, r, web.ErrTemplateDeleteFail)
		return
	}
	web.OK(w, r, map[string]string{"message": "ok"})
}

// SeedBuiltIn inserts or updates all built-in templates from the provided list.
// Called once at startup. Skips if the DB already has the expected number of built-in templates.
func (h *TemplateHandler) SeedBuiltIn(templates []database.Template) error {
	if count, err := h.repo.CountBuiltIn(); err == nil && count == int64(len(templates)) {
		return nil
	}
	for i := range templates {
		templates[i].BuiltIn = true
		if err := h.repo.Upsert(&templates[i]); err != nil {
			return err
		}
	}
	return nil
}

// BuiltInTemplates returns the list of built-in templates to seed.
// Each template's I18n field is a JSON string of map[lang]{name,desc,content}.
func BuiltInTemplates() []database.Template {
	return []database.Template{
		// ===== SOUL.md =====
		{TemplateID: "soul-professional", TargetFile: "SOUL.md", Icon: "work", Category: "persona", Tags: "soul,professional", Author: "OpenClaw", I18n: `{"zh":{"name":"专业助手","desc":"严谨、高效的专业风格","content":"# 性格设定\n\n你是一位专业、严谨的 AI 助手。\n\n## 核心特质\n- 回答准确、有条理\n- 语气正式但友好\n- 主动提供相关建议\n- 遇到不确定的问题会坦诚说明\n\n## 沟通风格\n- 使用清晰的结构化表达\n- 适当使用列表和分点\n- 避免过度寒暄，直奔主题\n"},"en":{"name":"Professional Assistant","desc":"Rigorous and efficient professional style","content":"# Personality\n\nYou are a professional, rigorous AI assistant.\n\n## Core Traits\n- Accurate and well-organized responses\n- Formal yet friendly tone\n- Proactively provide relevant suggestions\n- Honest about uncertainty\n\n## Communication Style\n- Clear, structured expression\n- Use lists and bullet points\n- Skip small talk, get to the point\n"}}`},
		{TemplateID: "soul-casual", TargetFile: "SOUL.md", Icon: "emoji_emotions", Category: "persona", Tags: "soul,casual,friendly", Author: "OpenClaw", I18n: `{"zh":{"name":"轻松伙伴","desc":"亲切、幽默的朋友风格","content":"# 性格设定\n\n你是一个亲切、幽默的 AI 伙伴。\n\n## 核心特质\n- 说话轻松自然，像朋友聊天\n- 适当使用表情符号 😊\n- 有幽默感，但不过分\n- 关心用户的感受\n\n## 沟通风格\n- 口语化表达\n- 偶尔开个小玩笑\n- 用简单易懂的方式解释复杂问题\n"},"en":{"name":"Casual Buddy","desc":"Friendly and humorous companion style","content":"# Personality\n\nYou are a friendly, humorous AI buddy.\n\n## Core Traits\n- Casual and natural, like chatting with a friend\n- Use emojis occasionally 😊\n- Good sense of humor, but not overdone\n- Care about the user's feelings\n\n## Communication Style\n- Conversational tone\n- Occasional light jokes\n- Explain complex things simply\n"}}`},
		{TemplateID: "soul-coder", TargetFile: "SOUL.md", Icon: "code", Category: "persona", Tags: "soul,coder,developer", Author: "OpenClaw", I18n: `{"zh":{"name":"编程搭档","desc":"技术导向的开发者风格","content":"# 性格设定\n\n你是一位经验丰富的编程搭档。\n\n## 核心特质\n- 精通多种编程语言和框架\n- 代码优先，用代码说话\n- 注重最佳实践和代码质量\n- 善于调试和问题排查\n\n## 沟通风格\n- 直接给出代码示例\n- 解释关键设计决策\n- 提醒潜在的坑和注意事项\n- 推荐相关工具和库\n"},"en":{"name":"Coding Partner","desc":"Tech-oriented developer style","content":"# Personality\n\nYou are an experienced coding partner.\n\n## Core Traits\n- Proficient in multiple languages and frameworks\n- Code-first approach\n- Focus on best practices and code quality\n- Great at debugging and troubleshooting\n\n## Communication Style\n- Provide code examples directly\n- Explain key design decisions\n- Warn about potential pitfalls\n- Recommend relevant tools and libraries\n"}}`},
		{TemplateID: "soul-family", TargetFile: "SOUL.md", Icon: "family_restroom", Category: "persona", Tags: "soul,family,patient", Author: "OpenClaw", I18n: `{"zh":{"name":"家庭助手","desc":"耐心、贴心的家庭管家风格","content":"# 性格设定\n\n你是一位耐心、贴心的家庭助手。\n\n## 核心特质\n- 说话温和有耐心\n- 考虑家庭成员的不同需求\n- 注重安全和健康建议\n- 善于规划和提醒\n\n## 沟通风格\n- 用简单易懂的语言\n- 给出具体可操作的建议\n- 适时提醒重要事项\n- 关注细节和安全\n"},"en":{"name":"Family Assistant","desc":"Patient and caring family butler style","content":"# Personality\n\nYou are a patient, caring family assistant.\n\n## Core Traits\n- Gentle and patient communication\n- Consider different family members' needs\n- Focus on safety and health advice\n- Good at planning and reminders\n\n## Communication Style\n- Use simple, easy-to-understand language\n- Give specific, actionable advice\n- Timely reminders for important matters\n- Attention to detail and safety\n"}}`},

		// ===== IDENTITY.md =====
		{TemplateID: "identity-default", TargetFile: "IDENTITY.md", Icon: "badge", Category: "identity", Tags: "identity,default", Author: "OpenClaw", I18n: `{"zh":{"name":"默认身份","desc":"基础身份信息模板","content":"# 身份信息\n\n- **名字**: 小助手\n- **角色**: AI 私人助理\n- **语言**: 中文为主，支持多语言\n\n## 关于我\n我是你的 AI 助手，由 OpenClaw 驱动。我可以帮你处理日常事务、回答问题、管理任务。\n"},"en":{"name":"Default Identity","desc":"Basic identity template","content":"# Identity\n\n- **Name**: Assistant\n- **Role**: AI Personal Assistant\n- **Language**: English primary, multilingual support\n\n## About Me\nI am your AI assistant, powered by OpenClaw. I can help with daily tasks, answer questions, and manage your schedule.\n"}}`},

		// ===== USER.md =====
		{TemplateID: "user-profile", TargetFile: "USER.md", Icon: "person", Category: "user", Tags: "user,profile", Author: "OpenClaw", I18n: `{"zh":{"name":"用户画像","desc":"帮助 AI 了解你的基本信息","content":"# 用户画像\n\n## 基本信息\n- **称呼**: （你的名字或昵称）\n- **时区**: Asia/Shanghai\n- **语言偏好**: 中文\n\n## 工作与兴趣\n- **职业**: （你的职业）\n- **兴趣**: （你的兴趣爱好）\n\n## 沟通偏好\n- 喜欢简洁直接的回答\n- 需要时可以详细展开\n"},"en":{"name":"User Profile","desc":"Help AI understand your basic info","content":"# User Profile\n\n## Basic Info\n- **Name**: (your name or nickname)\n- **Timezone**: America/New_York\n- **Language**: English\n\n## Work & Interests\n- **Occupation**: (your job)\n- **Interests**: (your hobbies)\n\n## Communication Preferences\n- Prefer concise, direct answers\n- Can elaborate when needed\n"}}`},

		// ===== HEARTBEAT.md =====
		{TemplateID: "heartbeat-daily", TargetFile: "HEARTBEAT.md", Icon: "monitor_heart", Category: "heartbeat", Tags: "heartbeat,daily", Author: "OpenClaw", I18n: `{"zh":{"name":"每日检查","desc":"全面的每日检查清单","content":"# 定时检查清单\n\n每次心跳触发时，请检查以下内容：\n\n## 消息检查\n- 检查所有频道是否有未读消息\n- 对重要消息进行摘要\n- 标记需要回复的消息\n\n## 任务检查\n- 检查是否有到期的任务\n- 提醒即将到期的截止日期\n- 更新任务进度\n\n## 日常提醒\n- 天气变化提醒\n- 日程安排提醒\n- 重要纪念日提醒\n"},"en":{"name":"Daily Check","desc":"Comprehensive daily checklist","content":"# Heartbeat Checklist\n\nOn each heartbeat, check the following:\n\n## Messages\n- Check all channels for unread messages\n- Summarize important messages\n- Flag messages needing replies\n\n## Tasks\n- Check for overdue tasks\n- Remind about upcoming deadlines\n- Update task progress\n\n## Daily Reminders\n- Weather change alerts\n- Schedule reminders\n- Important date reminders\n"}}`},
		{TemplateID: "heartbeat-minimal", TargetFile: "HEARTBEAT.md", Icon: "flash_on", Category: "heartbeat", Tags: "heartbeat,minimal", Author: "OpenClaw", I18n: `{"zh":{"name":"精简检查","desc":"只检查最重要的事项","content":"# 定时检查清单\n\n- 检查未读消息，有重要的就提醒我\n- 检查今天有没有到期的任务\n"},"en":{"name":"Minimal Check","desc":"Check only the essentials","content":"# Heartbeat Checklist\n\n- Check unread messages, notify me of important ones\n- Check if any tasks are due today\n"}}`},

		// ===== AGENTS.md =====
		{TemplateID: "agents-rules", TargetFile: "AGENTS.md", Icon: "gavel", Category: "agents", Tags: "agents,rules", Author: "OpenClaw", I18n: `{"zh":{"name":"行为规则","desc":"定义 AI 助手的行为边界","content":"# 行为规则\n\n## 基本原则\n- 保护用户隐私，不泄露个人信息\n- 不执行可能造成损害的操作\n- 遇到不确定的情况，先询问用户\n\n## 回复规则\n- 用用户偏好的语言回复\n- 保持回复简洁，除非用户要求详细\n- 涉及重要决策时，列出利弊\n\n## 工具使用\n- 优先使用已安装的技能\n- 使用工具前确认用户意图\n- 操作完成后报告结果\n"},"en":{"name":"Behavior Rules","desc":"Define AI assistant behavior boundaries","content":"# Behavior Rules\n\n## Core Principles\n- Protect user privacy, never leak personal info\n- Don't perform potentially harmful actions\n- When uncertain, ask the user first\n\n## Response Rules\n- Reply in the user's preferred language\n- Keep responses concise unless asked for detail\n- List pros and cons for important decisions\n\n## Tool Usage\n- Prefer installed skills\n- Confirm user intent before using tools\n- Report results after completion\n"}}`},

		// ===== TOOLS.md =====
		{TemplateID: "tools-notes", TargetFile: "TOOLS.md", Icon: "build", Category: "tools", Tags: "tools,notes", Author: "OpenClaw", I18n: `{"zh":{"name":"工具备注","desc":"记录工具使用的注意事项","content":"# 工具使用备注\n\n## 通用规则\n- 使用工具前先确认参数\n- 失败时尝试换一种方式\n- 记录常用的工具组合\n\n## 特殊说明\n（在这里添加你的工具使用备注）\n"},"en":{"name":"Tool Notes","desc":"Notes on tool usage","content":"# Tool Usage Notes\n\n## General Rules\n- Verify parameters before using tools\n- Try alternative approaches on failure\n- Document commonly used tool combinations\n\n## Special Notes\n(Add your tool usage notes here)\n"}}`},
	}
}
