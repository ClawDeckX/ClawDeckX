# v0.2.13

_2026-05-08_

## What's Changed

### ✨ New Features / 新功能

- add elevated tools UI in overview security card with provider auto-detection

### 🐛 Bug Fixes / 修复

- route safe apply through patch when possible
- wait for gateway restart before finishing wizard
- prefer patch saves to reduce apply rate limits
- keep openclaw peer symlink scanner-safe

---
**Full Changelog**: [v0.2.12...v0.2.13](https://github.com/ClawDeckX/ClawDeckX/compare/v0.2.12...v0.2.13)



---

# v0.2.12

_2026-05-06_

## What's Changed

### 🐛 Bug Fixes / 修复

- harden docker config workflows
- serialize gateway config writes
- strip leaked NO_REPLY sentinel from displayed messages

### ⚡ Performance / 性能优化

- proactive write budget + patch coalescing to prevent rate limiting

---
**Full Changelog**: [v0.2.11...v0.2.12](https://github.com/ClawDeckX/ClawDeckX/compare/v0.2.11...v0.2.12)



---

# v0.2.11

_2026-05-06_

## What's Changed

### ✨ New Features / 新功能

- remote OpenClaw migration with auth, .clawbak import and restore deep-link

### 🐛 Bug Fixes / 修复

- request default operator scopes
- non-constant format string in Errorf flagged by go vet
- repair OpenClaw rollback and exec host patch
- stabilize readiness and OpenClaw version picker

---
**Full Changelog**: [v0.2.10...v0.2.11](https://github.com/ClawDeckX/ClawDeckX/compare/v0.2.10...v0.2.11)



---

# v0.2.10

_2026-05-01_

## What's Changed

### ✨ New Features / 新功能

- add daily digest reports
- observability state endpoint, dashboard/editor/plugin-center polish
- support volces ClawHub mirror + enriched detail modal
- edit button on local gateway card + selectable update logs

### 🐛 Bug Fixes / 修复

- adjust digest time select width
- optimize wizard apply timeout fallback to direct file write

### 🌐 Internationalization / 国际化

- sync dashboard/gateway/extension-store/channels keys across 5 locales

---
**Full Changelog**: [v0.2.9...v0.2.10](https://github.com/ClawDeckX/ClawDeckX/compare/v0.2.9...v0.2.10)



---

# v0.2.9

_2026-04-29_

## What's Changed

### ✨ New Features / 新功能

- version selection in wizard + Windows force-remove before install
- add security and maintenance sections to optimize wizard

---
**Full Changelog**: [v0.2.8...v0.2.9](https://github.com/ClawDeckX/ClawDeckX/compare/v0.2.8...v0.2.9)



---

# v0.2.8

_2026-04-29_

## What's Changed

### ✨ New Features / 新功能

- add config direct-update handler, optimize wizard, diagnose enhancements

### 🐛 Bug Fixes / 修复

- make restart grace period configurable and activate post-restart protection
- relax watchdog health to not require /ready

---
**Full Changelog**: [v0.2.7...v0.2.8](https://github.com/ClawDeckX/ClawDeckX/compare/v0.2.7...v0.2.8)



---

# v0.4.0

_2026-04-20_

## What's Changed — AgentRoom 接入 OpenClaw Gateway Bridge（破坏性重构）

### 🔥 Breaking Changes

- **agentroom/bridge**: AgentRoom 推理后端从 `llmdirect` 切换为 **OpenClaw Gateway RPC**
  所有 agent 发言、竞价裁判、会议纪要、todo 抽取统一走 `internal/agentroom/ocbridge.go` 上的
  `agents.run` / `agents.result` / `sessions.history` / `sessions.ensure` / `sessions.delete` RPC。
  ClawDeckX 不再直接持有 provider 凭证，工具调用与审批由 OpenClaw 原生 `exec.approval` 流处理。
- **agentroom/api**: 移除 `POST /api/v1/agentroom/tool-approval/:id`（审批流已改由 OpenClaw UI 接管）
- **agentroom/db**: `AgentRoomMember` 新增 `agent_id` / `session_key` / `thinking` 列；
  创建房间时每个 agent 成员自动 `sessions.ensure`，删除房间时 best-effort `sessions.delete`
- **agentroom/ws**: 移除 `tool.approval` 事件；`tool.result` 语义保留（OpenClaw 回推工具调用汇总）

### ✨ New Features / 新功能

- **agentroom/gateway-proxy**: 新增 `GET /api/v1/agentroom/gateway/agents` 与 `/gateway/status`，
  Member 编辑器据此动态拉取 OpenClaw 已注册 agent 目录
- **agentroom/wizard**: 「自定义房间」向导 Step 2 增加 *OpenClaw Agent* + *Thinking* 级别选择，
  并在 Gateway 离线时给出提示横幅
- **agentroom/tool-card**: OpenClaw 每轮汇报的工具调用以 `MsgKindTool` 消息 + `tool.result` 事件
  双通道同步到时间线，ClawDeckX 前端不再维护本地审批状态

### 🗑️ Removed

- `internal/agentroom/toolbridge.go`（本地工具代理）
- `web/windows/AgentRoom/components/ToolApprovalBanner.tsx` 与相关 `pendingApprovals` state
- `internal/llmdirect` 在 AgentRoom 下的所有引用（仍保留用于 Multi-Agent 生成向导 `multiagent.go`）

### 🛠️ Migration Notes

- 旧房间中已创建的 agent 成员会随首次发言自动 `sessions.ensure`；无需迁移脚本
- 原本以 `tool.approval` 暴露给第三方脚本的 WS 订阅请移除，改监听 OpenClaw 的 `exec.approval`

---

# v0.3.0

_2026-04-20_

## What's Changed — AgentRoom v0.6 协作质量 · 决策 · 长期记忆

### ✨ New Features / 新功能

- **agentroom/quality**: 软标签协议 (`#confidence` / `#stance` / `#human-needed`)
  每轮 agent 输出经 `ParseSoftTags` 抽取并剥离；消息气泡上显示置信度/立场/需人介入等徽章，低置信被高亮
- **agentroom/decision**: 决策锚 —— `POST/DELETE /messages/{mid}/promote-decision`
  右侧 `DecisionsPanel` 按时间线展示所有已锚定的决策，点号跳转定位原消息
- **agentroom/artifact**: 房间级交付物一等公民
  `Artifact` 表 + `/rooms/:id/artifacts` CRUD + `/artifacts/:id` 更新/删除，前端 `ArtifactsPanel` 支持
  新建/编辑/下载（md/code/json/text）
- **agentroom/close**: `/close` 生成会议纪要 `POST /rooms/:id/close/synthesize`
  可选模板（minutes/prd/adr/review），生成后作为 Artifact 落盘 + minutes 消息注入
- **agentroom/todo**: `POST /rooms/:id/extract-todo` 从讨论中抽取任务入 Tasks 表
- **agentroom/rerun**: `POST /messages/{mid}/rerun` 换模型重跑同一条消息
- **agentroom/ask-all**: `POST /rooms/:id/ask-all` 向所有 agent 广播同一问题（并发收集独立答案）
- **agentroom/constitution**: 房间宪法（红线列表）字段 `constitution`，每轮注入 system prompt 最高优先级
- **agentroom/goal + roundBudget**: 房间目标 + 预期轮次预算 + `rounds_used` 轮次计数器 + 达阈值系统提示 + 顶栏 `TimeboxMeter`
- **agentroom/self-critique**: 开关 `selfCritique` 打开后 agent 发言落盘前跑轻量 rubric（+15% tokens，低胡说八道率）
- **agentroom/persona-memory**: 长期画像记忆跨房间复用 `PersonaMemory` 表 + `/persona-memory[/:key]` CRUD
- **agentroom/playbook**: 经验库 `Playbook` 表 + `/playbooks[/:id]` CRUD
- **agentroom/quality-panel**: 右侧 `QualityPanel` 统一编辑 goal / roundBudget / selfCritique / constitution，带进度条
- **agentroom/human-needed-banner**: 讨论区顶部 `HumanNeededBanner` 汇聚 agent 明确请求人类介入的消息，"查看/已读" 动作
- **agentroom/injection-sentinel**: `DetectInjection` 扫常见提示注入/越狱片段，外部内容注入时自动 `<untrusted>` 包裹
- **agentroom/pii-redact**: `RedactPII` 对出站投影做 email/手机/身份证/AWS/OpenAI/GitHub token/PEM 脱敏，徽章展示命中数
- **agentroom/composer-slash**: `/close` `/extract-todo` `/ask-all <q>` `/decision [摘要]` 加入 palette
- **agentroom/playbook-library**: TopBar 📚 入口，`PlaybookLibraryModal` 跨房间浏览/搜索/删除 Playbook；新建时可勾选"从当前房间生成"让后端填充 problem/approach/conclusion
- **agentroom/persona-memory-ui**: MemberRail 展开态新增"长期记忆"按钮，`PersonaMemoryModal` 以 `user:<uid>:<role>` 为 key 加载/覆盖/追加/清空跨房间画像；8 KB 字节预算条 + 过量警告
- **agentroom/playbook-apply**: `POST /rooms/:id/playbooks/:pid/apply` 把 Playbook 4 段（标题/问题/方法/结论）渲染为 markdown，作为 `kind=summary` 消息注入当前房间（few-shot 贴群风格）；`PlaybookLibraryModal` 每条右侧悬浮"应用"按钮
- **agentroom/away-summary**: `AwaySummaryBanner` —— 用户离开 >10 分钟回到房间时，顶部快报新增消息数、决策数、需人介入数、工具调用数、产出数以及最活跃 agent；一键跳到第一条未读或标记已读。纯前端实现（localStorage lastSeen 追踪，切房/标签 blur/unload 自动刷新），零后端压力
- **agentroom/message-menu**: `MessageBubble` 下拉菜单新增"推为决策 / 撤销决策 / 换模型重跑"；`/decision` `/rerun` 不再只能作用于最近一条消息，任何可见消息都能直接操作
- **agentroom/quality-metrics**: 右侧新增 `QualityMetricsPanel`（标准/高级模式可见）—— 总发言数、置信度均值、决策数总览；置信度 4 档分布、立场 5 档分布条形图；需人介入/untrusted/PII 脱敏/自我批判率告警卡。纯前端聚合，零后端开销

### 🔧 Schema

- `agentroom_rooms` += `goal / round_budget / rounds_used / self_critique / constitution`
- `agentroom_messages` += `confidence / stance / human_needed / untrusted / pii_redacted_count / is_decision / decision_summary`
- 新增表 `agentroom_artifacts / agentroom_playbooks / agentroom_persona_memories`
- WS 广播：`message.update` 的 patch 可携 `isDecision/decisionSummary`

### 🧪 Tests / 测试

- 12 个 Go 单测覆盖 `ParseSoftTags` / `DetectInjection` / `RedactPII` / `BuildConstitutionBlock` / `WrapUntrusted`，全量通过

---
**Full Changelog**: [v0.2.7...v0.3.0](https://github.com/ClawDeckX/ClawDeckX/compare/v0.2.7...v0.3.0)

---

# v0.2.7

_2026-04-29_

## What's Changed

### 🐛 Bug Fixes / 修复

- merge legacy channel fields into accounts.default

### ♻️ Refactoring / 重构

- unify watchdog probe with live+ready checks

---
**Full Changelog**: [v0.2.6...v0.2.7](https://github.com/ClawDeckX/ClawDeckX/compare/v0.2.6...v0.2.7)



---

# v0.2.6

_2026-04-28_

## What's Changed

### ✨ New Features / 新功能

- check OpenClaw version before enabling prometheus plugin
- auto-enable diagnostics-prometheus plugin on 404
- integrate Prometheus diagnostics from OpenClaw
- Claude / Hermes one-click importer wizard
- QQBot group chat + Yuanbao 2026.4.27 config

### 🐛 Bug Fixes / 修复

- correct toast argument order (type, message)
- pass baseHash to all config.set calls for concurrency control
- pass baseHash to config.set for optimistic concurrency
- state-driven restart suppression instead of fixed grace timer
- prevent reconnect grace from shortening restart grace period
- poll for plugin readiness instead of fixed 3s wait
- show plugin-not-enabled hint on 404

### ⚡ Performance / 性能优化

- parallelize Scan() and extend gateway start timeout to 180s

### 🎨 UI & Styling / 界面优化

- collapsible scrape config with copyable fields

### 🌐 Internationalization / 国际化

- fix watchdog inactive hint wording

---
**Full Changelog**: [v0.2.5...v0.2.6](https://github.com/ClawDeckX/ClawDeckX/compare/v0.2.5...v0.2.6)



---

# v0.2.5

_2026-04-28_

## What's Changed

### ✨ New Features / 新功能

- sync OpenClaw 2026.4.27 + per-agent TTS + node pair remove
- scheduler blueprint, UI unification, cross-room bus
- add defaults-map and ModelField for schema-driven config defaults
- openclaw 2026.4.22 compat - slash commands, gpt5 personality toggle, sessions runner field, i18n keys

### 🐛 Bug Fixes / 修复

- kill openclaw process tree to unblock npm upgrade on Windows

### 🌐 Internationalization / 国际化

- trim locales from 13 to 5 (en/zh/zh-TW/ja/ko)

### ♻️ Refactoring / 重构

- local-only UI, merge probe badges, runtime i18n

---
**Full Changelog**: [v0.2.4...v0.2.5](https://github.com/ClawDeckX/ClawDeckX/compare/v0.2.4...v0.2.5)



---

# v0.2.4

_2026-04-24_

## What's Changed

### ✨ New Features / 新功能

- multi-agent meeting room with deadline action, UX polish
- allow custom backup directory outside container

### 🐛 Bug Fixes / 修复

- extend deadline summary timeout to 3min with retry
- surface backup path editor above all snapshot tabs

### ⚡ Performance / 性能优化

- dynamic timeout for deadline summary based on rounds

---
**Full Changelog**: [v0.2.3...v0.2.4](https://github.com/ClawDeckX/ClawDeckX/compare/v0.2.3...v0.2.4)



---

# v0.2.3

_2026-04-19_

## What's Changed

### ✨ New Features / 新功能

- persistent snippets, local sysinfo, Windows ConPTY, i18n
- add container/local file browser for native PTY shell
- add native PTY local/container shell (bypass SSH)
- add QR login via direct iLink API, bypassing plugin's missing web.login.start

### 🐛 Bug Fixes / 修复

- rename qqPrep/qqPitfall/qqHelpUrl to qqbotPrep/qqbotPitfall/qqbotHelpUrl
- sync qqbot config with upstream openclaw, fix channel plugin specs
- smoother plugin install & wizard flow, restore prep/pitfall i18n
- reset ws backoff on user-triggered restart
- local-tab snippets history + commands panel parity
- add channels.status fallback for residue channel plugins
- use plugins.entries fallback instead of unsupported plugins.status RPC

### 🎨 UI & Styling / 界面优化

- unify dmPolicy row styling with other SelectField rows

---
**Full Changelog**: [v0.2.2...v0.2.3](https://github.com/ClawDeckX/ClawDeckX/compare/v0.2.2...v0.2.3)



---

# v0.2.2

_2026-04-18_

## What's Changed

### ✨ New Features / 新功能

- add background tasks tab, cron event refresh and toast notifications
- auto-generate admin credentials on first run and display after deploy

### 🐛 Bug Fixes / 修复

- handle residue directory via force-reinstall and runtime status check
- prevent double restart and stale config overwrite on plugin install
- restore full log tail for docker first-boot credentials
- remove stray 'local' keyword in top-level Docker scan
- background launch with inline credential display
- auto-restart gateway after OpenClaw upgrade in Docker
- add confirm dialog for Docker restart, toast restart hint after OpenClaw upgrade
- graceful degradation for ModelAuthStatus RPC timeout
- fix ModelAuthStatus i18n path and add translations
- remove entrypoint credential gen, let binary handle first-boot admin

---
**Full Changelog**: [v0.2.1...v0.2.2](https://github.com/ClawDeckX/ClawDeckX/compare/v0.2.1...v0.2.2)



---

# v0.2.1

_2026-04-18_

## What's Changed

### ✨ New Features / 新功能

- add select-all and invert-selection to Activity batch mode

### 🐛 Bug Fixes / 修复

- use docker-compose-clawdeckx.yml as default compose filename to avoid conflicts with other projects
- change gateway log level filter to include mode

---
**Full Changelog**: [v0.2.0...v0.2.1](https://github.com/ClawDeckX/ClawDeckX/compare/v0.2.0...v0.2.1)



---

# v0.2.0

_2026-04-17_

## What's Changed

### ✨ New Features / 新功能

- add HermesDeckX link in about section
- add legacy slash commands trace, pair, card, phone, active-memory
- surface contextLimits, skillsLimits, localModelLean and unknownToolThreshold
- add models.authStatus support and Dashboard auth card
- add SSH command templates and reauth credential prompt
- add SSH terminal workspace

### 🐛 Bug Fixes / 修复

- fall back to saved credentials when testing SSH with blank password
- smart input - single keypress when choices <= 9

### 🌐 Internationalization / 国际化

- add Model Auth card, Editor fields and slash command keys for 13 locales
- localize SSH test errors

### 📝 Documentation / 文档

- add HermesDeckX cross-promotion in README

---
**Full Changelog**: [v0.1.9...v0.2.0](https://github.com/ClawDeckX/ClawDeckX/compare/v0.1.9...v0.2.0)



---

# v0.1.9

_2026-04-13_

## What's Changed

### ✨ New Features / 新功能

- add commands.list RPC, dynamic slash commands, and bump openclawCompat to >=2026.4.12

### 🐛 Bug Fixes / 修复

- rewrite auto-approve pairing to use pairing list + requestId for OpenClaw 4.11 compat
- relax filename validation to allow suffixed date files and named files like MEMORY.md
- persist config on field change and allow applying empty values to clear system settings
- simplify QR channel wizard step 2 for openclaw-weixin and whatsapp

---
**Full Changelog**: [v0.1.8...v0.1.9](https://github.com/ClawDeckX/ClawDeckX/compare/v0.1.8...v0.1.9)



---

# v0.1.8

_2026-04-09_

## What's Changed

### ✨ New Features / 新功能

- add ClawHub mirror presets
- improve update overview and settings update guidance
- add WeChat/Telegram contact QR code in menubar
- add task audit health display, smart cron navigation, session key picker
- sync OpenClaw v2026.4.9 doctor.memory RPC methods and Dreams UI

---
**Full Changelog**: [v0.1.7...v0.1.8](https://github.com/ClawDeckX/ClawDeckX/compare/v0.1.7...v0.1.8)



---

# v0.1.7

_2026-04-08_

## What's Changed

### ✨ New Features / 新功能

- add snapshot management updates

### 🌐 Internationalization / 国际化

- localize dreaming confirmations

---
**Full Changelog**: [v0.1.6...v0.1.7](https://github.com/ClawDeckX/ClawDeckX/compare/v0.1.6...v0.1.7)



---

# v0.1.6

_2026-04-08_

## What's Changed

### ✨ New Features / 新功能

- surface notification delivery status
- add session compaction and skill detail
- improve ws diagnostics and watchdog status
- add Dreams tab and Dashboard dreaming status card

### 🎨 UI & Styling / 界面优化

- expand llm provider icon mapping

### 📦 Build & Deploy / 构建部署

- bump openclaw compatibility to 2026.4.5

---
**Full Changelog**: [v0.1.5...v0.1.6](https://github.com/ClawDeckX/ClawDeckX/compare/v0.1.5...v0.1.6)



---

# v0.1.5

_2026-04-07_

## What's Changed

### ✨ New Features / 新功能

- add scripts for config path migration, test scaffold generator, CI compat gate, and enhanced doc generation
- add config path migration, enhanced doc generation, test scaffold generator, CI compat gate, and schema version drift hook
- add SchemaRemainder component and integrate into all sections
- add 2026.4.5 fields, i18n keys, and section tests
- add global Command Palette with deep-link protocol and runtime hooks
- align editor with OpenClaw v2026.4.4 schema changes
- channel-level toggles and event-based routing

### 🐛 Bug Fixes / 修复

- stabilize new session lifecycle
- guard null template metadata
- refresh update badges after checks
- refresh overview cache after upgrades
- stop running process on uninstall
- resolve [object Object] in command palette for usage window
- exempt translate-notes and config APIs from XSS body check
- add manual translate button for OpenClaw release notes
- move useCallback before early return in SchemaRemainder to fix React error #310
- update notify callback signature in gwclient_test
- use runtime.GOOS for platform and upgrade device auth to v3
- auto select generation model

### 🌐 Internationalization / 国际化

- add update backup prompts

### ✅ Tests / 测试

- add SchemaRemainder regression tests for hook order stability (React #310)
- add unit tests (Vitest) and E2E tests (Playwright)

### 🔧 Maintenance / 维护

- remove CI workflow and untrack gitignored scripts

---
**Full Changelog**: [v0.1.4...v0.1.5](https://github.com/ClawDeckX/ClawDeckX/compare/v0.1.4...v0.1.5)



---

# v0.1.4

_2026-04-04_

## What's Changed

### ✨ New Features / 新功能

- add remaining uncovered config fields to Editor
- add webchat chatHistoryMaxChars to GatewaySection

### 🐛 Bug Fixes / 修复

- update agent patching and tooltips
- add settings badge for software updates in sidebar and WS broadcast
- SSE stream completion detection + stale watchdog for team builder
- register gateway.webchat in sectionRegistry
- align openclaw state path resolution

### 🌐 Internationalization / 国际化

- add missing tooltips for webchat, channel health, reload deferral, otel headers, nodeHost browserProxy and other new config fields

---
**Full Changelog**: [v0.1.3...v0.1.4](https://github.com/ClawDeckX/ClawDeckX/compare/v0.1.3...v0.1.4)



---

# v0.1.3

_2026-04-03_

## What's Changed

### 🐛 Bug Fixes / 修复

- auto-export OCD_OPENCLAW_CONFIG_PATH in entrypoint
- add OCD_OPENCLAW_CONFIG_PATH for existing releases

---
**Full Changelog**: [v0.1.2...v0.1.3](https://github.com/ClawDeckX/ClawDeckX/compare/v0.1.2...v0.1.3)



---

# v0.1.2

_2026-04-03_

## What's Changed

### ✨ New Features / 新功能

- add dashboard update checks

### 🐛 Bug Fixes / 修复

- track version/compat.go and anchor gitignore VERSION rule
- guide model setup in team builder

---
**Full Changelog**: [v0.1.1...v0.1.2](https://github.com/ClawDeckX/ClawDeckX/compare/v0.1.1...v0.1.2)



---

# v0.1.1

_2026-04-03_

## What's Changed

### ✨ New Features / 新功能

- add task insights and gateway sync fixes

### 🐛 Bug Fixes / 修复

- align openclaw integrations and locales
- unify exec policy configuration and summaries

### 📦 Build & Deploy / 构建部署

- bump openclaw compat to 2026.4.2

---
**Full Changelog**: [v0.1.0...v0.1.1](https://github.com/ClawDeckX/ClawDeckX/compare/v0.1.0...v0.1.1)



---

# v0.1.0

_2026-04-02_

## What's Changed

### ✨ New Features / 新功能

- auto-scroll stream output to bottom on token update
- default expand first agent file preview and add skipExisting hint
- add agent file preview and edit panel in deploy configure step
- upgrade fallback file prompts to detailed per-file instructions with zh support
- show elapsed time and token count in agent live output stream
- add dedicated prompts for all 8 scenario templates
- show prompt source badge (Default/Template/Edited) on prompt label
- add rich agentFile prompt to default template; load it for step2
- show all scoped templates in AI write panel with multi-agent prefix label
- add scope field to separate single-agent vs multi-agent templates
- add workflowDescription placeholder with semantic descriptions per workflow type
- add _default template with generic step1 prompt; always pre-fill prompt-review textarea
- add per-file prompts in template JSON and type definitions
- add template picker to AI write panel for prompt selection
- add template-driven prompts and AI file write in Agents tab
- wizard-style step-by-step generation with SSE streaming

### 🐛 Bug Fixes / 修复

- rewrite files prompts - AGENTS.md structure, IDENTITY.md multi-line, HEARTBEAT.md judge-first, USER.md standard template
- fix all ZH prompt issues - heartbeat judge-first, identityMd multi-line format
- add Session Startup and Red Lines structure to all agentsMd prompts
- restore domain-specific agentFile prompts with correct format specs
- let AI decide if HEARTBEAT tasks needed, never force-fill
- rewrite agent file prompts with accurate OpenClaw file specs and formats
- overwrite workspace files when skipExisting=false, add updated status
- pass AI-generated soul/agentsMd/userMd/identityMd through to deploy
- reduce hard cap to 10min for wizard step1/step2
- replace fixed timeout with 120s idle timeout (activity-based)
- increase wizard step1/step2 LLM timeout to 480s (8 min)
- increase wizard step1/step2 LLM timeout from 120/180s to 300s
- update team size ranges to small 2-3, medium 4-6, large 7-10
- hide empty role/description lines from AI gen prompt header
- read role/description from selected agent, fix useEffect hoisting
- fix identity lookup to use identity[selectedId] instead of identity.name
- fix agent auto-advance stall using wzAgentsRef and wzRunAgentRef
- re-apply template prompt after async load; add prompt source badge
- hide internal default template from visible template list
- reset user-edited flag when returning from wizard or applying template
- increase agent-file timeout to 180s and max_tokens to 4096 for rich Markdown output
- retry useEffect loads correct template prompt, not always default
- skip auto-clear of prompt when template is being applied
- add missing id/version/type fields and register new templates in local loader
- remove duplicate Back buttons in wizard step2, keep footer only
- auto-regenerate step1 prompt when params change if not user-edited
- add wzEditPrompt/wzStoppedByUser i18n; fix single-agent start chaining
- remove debug logs; move Start button to footer with primary style
- remove old _default.json (renamed to default.json)
- rename _default template to default to fix Vite chunk 404
- bust stale cache and surface empty-load failure for prompt retry
- show config chips in wizard step1; retry prompt load on mount
- fix stale localStorage sources wiping built-in local source
- use Promise.allSettled for template loading; re-resolve prompt on file switch
- remove hardcoded fallback prompt; do not auto-start wizard step1
- add manifestPath to GitHub source to resolve manifest.json 404
- register _default template in loadLocalMultiAgent for zh prompt resolution
- remove hardcoded buildPrompt, wire prompt-review to wzStep1Prompt; use CustomSelect in AI gen panel

### 🎨 UI & Styling / 界面优化

- make prompt textareas collapsible and vertically resizable
- increase font sizes throughout wizard UI for readability
- match AI gen template picker style to exec security dropdown

### 🌐 Internationalization / 国际化

- add localized names for 4 new multi-agent templates in all 13 locales
- rename generateWizardBtn to 'Generate Team' in en/zh locales
- add 22 missing wizard i18n keys to all 13 cm_multi locales
- add promptPlaceholder key to all 13 cm_multi locales

### ♻️ Refactoring / 重构

- hardcode directLlm=true, remove toggle UI
- merge prompt-review step into input step; auto-load prompt on param change
- inline wizard into ScenarioTeamBuilder, delete GenerationWizard.tsx

### 🔧 Maintenance / 维护

- remove unused templates/official/manifest.json

---
**Full Changelog**: [v0.0.42...v0.1.0](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.42...v0.1.0)



---

# v0.0.42

_2026-04-02_

## What's Changed

### ✨ New Features / 新功能

- add agents tasks tab

### 🐛 Bug Fixes / 修复

- normalize exec security dashboard display
- add session key protocol compatibility

---
**Full Changelog**: [v0.0.41...v0.0.42](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.41...v0.0.42)



---

# v0.0.41

_2026-04-01_

## What's Changed

### 🐛 Bug Fixes / 修复

- avoid token-triggered reconnect storm

---
**Full Changelog**: [v0.0.40...v0.0.41](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.40...v0.0.41)



---

# v0.0.40

_2026-04-01_

## What's Changed

### 🐛 Bug Fixes / 修复

- add reconnect diagnostics
- stabilize gwclient reconnect and proxy flow
- refine session delete prompts
- avoid false session disconnect errors

---
**Full Changelog**: [v0.0.39...v0.0.40](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.39...v0.0.40)



---

# v0.0.39

_2026-04-01_

## What's Changed

### 🐛 Bug Fixes / 修复

- increase gateway stop wait time for Windows file lock release
- stop gateway before OpenClaw upgrade to prevent Windows file lock errors
- improve start reliability and auto-create MEMORY.md

### ♻️ Refactoring / 重构

- remove unused gateway service wiring

---
**Full Changelog**: [v0.0.38...v0.0.39](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.38...v0.0.39)



---

# v0.0.38

_2026-04-01_

## What's Changed

### ✨ New Features / 新功能

- enrich multi-agent soulSnippets and render persona examples in UI

### 🐛 Bug Fixes / 修复

- disable test send when config has unsaved changes
- harden watchdog and notify flows

### 🌐 Internationalization / 国际化

- add stepIdentity/stepScenarios/stepMemory tab labels for all 13 locales
- add category label keys for all 13 locales

---
**Full Changelog**: [v0.0.37...v0.0.38](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.37...v0.0.38)



---

# v0.0.37

_2026-03-31_

## What's Changed

### ✨ New Features / 新功能

- add generation mode toggle (agent session vs direct LLM)
- bypass agent session with direct LLM streaming via llmdirect
- async AI team generation with background task + WS push
- add AI team generation and scenario builder

### 🐛 Bug Fixes / 修复

- two-step direct LLM generation to avoid max_tokens truncation
- resolve connectLoop storm and invalid-handshake on restart

---
**Full Changelog**: [v0.0.36...v0.0.37](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.36...v0.0.37)



---

# v0.0.36

_2026-03-30_

## What's Changed

### 🐛 Bug Fixes / 修复

- preload device pairing counts
- refresh history token on auth failure
- make code block copy button reliably clickable
- keep code block copy button visible during copied/failed feedback
- add 3-attempt retry for ClawHub and SkillHub CLI install
- add git push retry logic with 3 attempts and exit on failure

### 📦 Build & Deploy / 构建部署

- optimize arm64 smoke test for QEMU slowness
- replace softprops/action-gh-release with gh CLI

---
**Full Changelog**: [v0.0.35...v0.0.36](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.35...v0.0.36)



---

# v0.0.35

_2026-03-30_

## What's Changed

### ✨ New Features / 新功能

- add confirm step before saving SKILL.md to prevent accidental overwrites
- add JSON edit tab to server editor, move mcp-remote button above extra JSON
- add mcp-remote bridge conversion button for SSE servers
- add headers editor for SSE servers in McpCenter form

### 🐛 Bug Fixes / 修复

- remove UTF-8 BOM from all cm_sk.json locale files
- use inline borderColor style to override theme-field border on JSON error
- validate JSON on every keystroke and highlight textarea border on error
- keep stdio stdin open for mcp-remote proxies, extend test timeout to 20s
- restrict attachments to images only, matching openclaw gateway behavior
- handle baseUrl-only single server and streamable-http type in JSON paste
- recognize baseUrl field and forward headers for HTTP servers

### 📦 Build & Deploy / 构建部署

- upgrade upload-artifact and download-artifact to v6 (Node.js 24)

---
**Full Changelog**: [v0.0.34...v0.0.35](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.34...v0.0.35)



---

# v0.0.34

_2026-03-29_

## What's Changed

### ✨ New Features / 新功能

- handle context_compaction events and includeSpawned
- sync with openclaw v2026.3.28
- add MCP handler, mirror config, McpCenter UI and settings

### 🐛 Bug Fixes / 修复

- relax SKILL.md path validation, expand editor modal, add resize
- remove save button from mirror settings, make prefs sections collapsible
- resolve api key for model discovery

### 🌐 Internationalization / 国际化

- add mirror and mcp test keys to all 11 non-en locales

---
**Full Changelog**: [v0.0.33...v0.0.34](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.33...v0.0.34)



---

# v0.0.33

_2026-03-27_

## What's Changed

### 🐛 Bug Fixes / 修复

- route recipe install through gateway RPC
- ignore cached URL translations
- reject garbage translations containing URLs for skill names
- use clipboard fallback for context menu copy in Sessions
- use clipboard fallback for code block copy in non-HTTPS context

### 🎨 UI & Styling / 界面优化

- move tool policy above model picker in UsagePanel

### 🌐 Internationalization / 国际化

- add secProfile tool strategy labels for all 13 locales

---
**Full Changelog**: [v0.0.32...v0.0.33](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.32...v0.0.33)



---

# v0.0.32

_2026-03-27_

## What's Changed

### 🐛 Bug Fixes / 修复

- hide snapshot toolbar on config-history tab
- backup dir outside state path, radio scope, notify reorder, i18n ON/OFF

### 🌐 Internationalization / 国际化

- rename ocBackupFull to Standard backup for clarity

### 📦 Build & Deploy / 构建部署

- upgrade Node.js from 22 to 24

---
**Full Changelog**: [v0.0.31...v0.0.32](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.31...v0.0.32)



---

# v0.0.31

_2026-03-27_

## What's Changed

### ✨ New Features / 新功能

- usage panel UX overhaul with expandable models, session filters, and enhanced metrics
- security config navigation, channel policy editor, collapsible tool pickers, i18n

### 🌐 Internationalization / 国际化

- remove 1054 unused keys per locale across 13 languages

---
**Full Changelog**: [v0.0.30...v0.0.31](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.30...v0.0.31)



---

# v0.0.30

_2026-03-26_

## What's Changed

### ✨ New Features / 新功能

- fallback to model config contextWindow when gateway maxContextTokens is 0
- collapsible KPI dashboard in Activity page with i18n
- show agent name badge in session sidebar before kind badge
- enhance Activity KPI dashboard and session cards with missing data
- enhance UsagePanel with full session data visualization
- scope new session to selected agent filter
- buffered save for A2A and subagents, cleanup on delete
- add paginated session history endpoint

### 🐛 Bug Fixes / 修复

- correct A2A empty list defaults and toggle behavior
- resolve agent list clobbering and display name improvements
- render CustomSelect dropdown via portal to prevent clipping
- unified safePatch/safeApply with auto hash refresh and retry
- agent create shows default workspace path in Docker and validates empty workspace

### ⚡ Performance / 性能优化

- add 15s getCached TTL to sessionsUsage and usageCost endpoints
- add 30s in-memory cache to UsagePanel data loading

### 🎨 UI & Styling / 界面优化

- hide wildcard * chips in allowed agents and subagents lists
- group agent and kind badges together in session sidebar

### 🌐 Internationalization / 国际化

- add editSession key to all 13 locales
- add agent and chat locale keys for all 13 locales

### ♻️ Refactoring / 重构

- remove agent info and kind chip from UsagePanel (shown in sidebar)

---
**Full Changelog**: [v0.0.29...v0.0.30](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.29...v0.0.30)



---

# v0.0.29

_2026-03-25_

## What's Changed

### ✨ New Features / 新功能

- add editable combobox to plugin allow/deny fields
- auto-manage plugins.allow on install and uninstall
- add PATH registration for installers and streaming improvements
- add workspace memory logs API and UI

### 🐛 Bug Fixes / 修复

- reload page after Docker runtime update to show new version
- correct required credential validation for all channels
- preserve partial stream on error and suppress error during active streaming

---
**Full Changelog**: [v0.0.28...v0.0.29](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.28...v0.0.29)



---

# v0.0.28

_2026-03-25_

## What's Changed

### ✨ New Features / 新功能

- schema-aware tooltips with auto-fallback and range/enum display
- unified OpenClaw binary discovery across all platforms and install methods

### 🐛 Bug Fixes / 修复

- hide MCP from unmapped config section, remove unused tools toggle

### 🎨 UI & Styling / 界面优化

- remove expand/collapse tools button from AI chat menu
- remove TTS speak button from AI chat messages
- optimize AI chat layout and wallpaper toolbar UX
- remove language label from chat code blocks

### 🌐 Internationalization / 国际化

- add missing tooltip keys to all 10 remaining locales
- translate DM to native terms in zh and zh-TW locales

---
**Full Changelog**: [v0.0.27...v0.0.28](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.27...v0.0.28)



---

# v0.0.27

_2026-03-24_

## What's Changed

### 🐛 Bug Fixes / 修复

- derive cookie name from request Host header for Docker port mapping
- restart with overlay binary after runtime update
- read tokens from multi-account config path in test-channel
- port-specific cookie name to prevent cross-instance collision
- enhance config load diagnostics for JWT secret persistence tracking
- add diagnostic logging for 401 auth failures in middleware
- use correct param name 'key' for sessions.messages RPC
- persist JWT secret across Docker restarts and add diagnostic logging

### 🎨 UI & Styling / 界面优化

- fix model dropdown dark mode contrast

### 🔧 Maintenance / 维护

- bump openclawCompat to >=2026.3.23

---
**Full Changelog**: [v0.0.26...v0.0.27](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.26...v0.0.27)



---

# v0.0.26

_2026-03-24_

## What's Changed

### ✨ New Features / 新功能

- register gateway stale/restart keys and add MCP Servers editor
- add subscription convergence, TTS speak, and send timeout recovery
- show gateway presence on nodes page
- add skills.install and system-presence RPC wrappers
- adapt to openclaw v2026.3.14 API changes
- add openclaw-weixin channel integration with QR login
- multi-account UI with auto-migration and styled forms
- add CLI fix fallback for doctor one-click repair button

### 🐛 Bug Fixes / 修复

- harden runtime apt install in prebuilt image
- decouple docker install version from compat
- add builder diagnostics for prebuilt image
- remove openclaw-cn compat and harden binary detection
- move QR login to post-save step in wizard flow
- align editor sections with upstream openclaw config schema
- bypass GitHub API rate limit with direct URL download
- fallback to direct pull when mirror image pull fails

### ♻️ Refactoring / 重构

- always use CLI fix for doctor one-click repair

### 📝 Documentation / 文档

- add note about quoting passwords with special characters
- add account lockout policy and prominent mirror warnings

---
**Full Changelog**: [v0.0.25...v0.0.26](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.25...v0.0.26)



---

# v0.0.25

_2026-03-23_

## What's Changed

### 🐛 Bug Fixes / 修复

- scroll wizard into view on step change in add provider flow
- remove invalid redact param from config.get RPC calls
- increase health check wait to 150s for first-boot gateway startup
- show host volume paths instead of container-internal paths
- remove duplicate admin credentials output from startup banner

---
**Full Changelog**: [v0.0.24...v0.0.25](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.24...v0.0.25)



---

# v0.0.24

_2026-03-23_

## What's Changed

### ✨ New Features / 新功能

- add firewall port reminder in access URL output
- show LAN and public IP in post-install access URLs
- smart auto-detect next available instance name for multi-deploy
- support multiple Docker deployments in installer scripts
- smart port detection for Docker and binary installs
- change default port from 18788 to 18800 to avoid OpenClaw range
- unified adaptive menu for coexisting Docker and binary installs

### 🐛 Bug Fixes / 修复

- standardize internal port to 18788, Docker host port to 18700
- unified rpc retry for gateway transient disconnects
- retry hash refresh after gateway reload to prevent stale hash
- update Dockerfile.prebuilt port from 18788 to 18800
- show correct host port in container banner via OCD_HOST_PORT
- comprehensive audit fixes for reliability and compatibility
- auto-add openclaw user to docker group for cross-account access

### 🎨 UI & Styling / 界面优化

- replace technical Binary/������ labels with ClawDeckX

### 📝 Documentation / 文档

- update README to reflect unified installer for Docker

---
**Full Changelog**: [v0.0.23...v0.0.24](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.23...v0.0.24)



---

# v0.0.23

_2026-03-22_

## What's Changed

### ✨ New Features / 新功能

- enable wallpaper image by default for new users
- add Docker install/manage/mirror support to install scripts

### 🐛 Bug Fixes / 修复

- show user-configured model count instead of total gateway models
- set explicit network name and auto-show logs after install
- hide console window for all exec.Command calls on Windows
- use logs --tail 50 for credential viewing hint
- increase first-run gateway wait to 120s with progress
- improve install mode text and fix duplicate Docker ready message
- add login credential hint after Docker install
- improve first-run password visibility in Docker logs
- code block copy button and auto-scroll on tool calls

### 🎨 UI & Styling / 界面优化

- remove green checkmark badge from chat welcome screen

---
**Full Changelog**: [v0.0.22...v0.0.23](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.22...v0.0.23)



---

# v0.0.22

_2026-03-21_

## What's Changed

### ✨ New Features / 新功能

- add required credential validation to channel wizard

### 🐛 Bug Fixes / 修复

- stop deleting runtime .md files from OpenClaw package
- auto-reset run phase after error and stuck detection
- enhance chat error display with HTTP status hints
- split provider/model in session model switch for correct local display
- auto-set supportsUsageInStreaming for custom openai-completions providers

---
**Full Changelog**: [v0.0.21...v0.0.22](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.21...v0.0.22)



---

# v0.0.21

_2026-03-20_

## What's Changed

### ✨ New Features / 新功能

- smart provider test with API type auto-detection
- change default startup window from dashboard to none
- show channel display names in Gateway Monitor channel list
- show theme input in create dialog and persist via config.patch
- add model/default/theme to create/edit dialog
- prefill defaults in create dialog and model dropdown in edit

### 🐛 Bug Fixes / 修复

- sync arm64 docker smoke test and fix Dockerfile.prebuilt drift
- add toast feedback to Resolve and Compact session actions
- prevent model switch revert after loadSessions refresh
- sync wallpaper history selection
- persist emoji via config.patch identity.emoji instead of agents.update
- resolve template icon colors in KnowledgeHub, TemplateManager, WorkflowRunner, Market, UsageWizard
- resolve scenario template icon colors via inline styles
- resolve template icon colors via inline styles for Tailwind JIT compat
- use correct config nesting fallback in resolveAgentConfig
- simplify config.patch to minimal agent entry merge
- persist model/workspace via config.patch instead of agents.update
- reload config after create/update to reflect changes
- prefer explicit config name over identity name in sidebar
- replace missing Material Symbols icons in multi-agent templates
- handle nested config structure for models and workspace
- increase first-start gateway wait time to 60s

### ⚡ Performance / 性能优化

- optimize WS reconnect, streaming, and chat UX
- optimize GWClient reconnect and WSHub backpressure handling

### 🎨 UI & Styling / 界面优化

- collapse session toolbar into overflow menu

---
**Full Changelog**: [v0.0.20...v0.0.21](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.20...v0.0.21)



---

# v0.0.20

_2026-03-19_

## What's Changed

### ✨ New Features / 新功能

- add JSON semantic diff with key-path changes summary
- add unified diff view with color-coded add/remove lines
- add OpenClaw native backup integration with method selector
- add Config History tab for OpenClaw .bak file management
- CLI version detection, upgrade prompts, real-time search

### 🐛 Bug Fixes / 修复

- use whole-line grep and trailer-style Docker-Build marker
- change skip-docker marker to SKIP_DOCKER=true to avoid changelog false match
- use GitHub API instead of checkout to read tag message in check-docker job
- suppress GORM record-not-found log for missing settings

### ⚡ Performance / 性能优化

- optimize ClawHub real-time search with 500ms debounce

### 🎨 UI & Styling / 界面优化

- unify stats order and icons in ClawHub/SkillHub cards and details

### 🌐 Internationalization / 国际化

- add Run Now button locale keys for all 13 languages

### ♻️ Refactoring / 重构

- route ClawHub search and detail via Convex HTTP actions

### 📦 Build & Deploy / 构建部署

- invert Docker flag - default skip, -d enables Docker build
- add -d alias for -NoDocker shorthand
- add -NoDocker flag to skip Docker builds via [skip-docker] tag marker

---
**Full Changelog**: [v0.0.19...v0.0.20](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.19...v0.0.20)



---

# v0.0.19

_2026-03-19_

## What's Changed

### ✨ New Features / 新功能

- show Docker volume mount paths in setup wizard
- add persistent runtime update overlay

### 🐛 Bug Fixes / 修复

- show all sessions instead of only last 24h active
- make memory card clickable to navigate to editor config
- remove unused react-shiki that crashes Sessions window
- display actual GitHub release tag for recovery releases
- show CLI install banner on every visit when not installed
- add missing dark mode variants across windows, remove duplicate SourceConfigModal
- allow description click to bubble for detail modal
- streamline skillhub remote flow
- sanitize skillhub config and docs
- allow longer first gateway startup

### 🎨 UI & Styling / 界面优化

- increase font sizes in KPI dashboard and session cards
- batch theme and layout refinements across windows
- add light mode theme support to Events, Channels, Service, Debug panels
- card grid for tools catalog, card-click detail for plugins
- card-click opens detail, remove detail buttons, card-style capabilities
- unify skillhub and plugin center UI patterns

### 🌐 Internationalization / 国际化

- add topConsumers key to all 13 locales
- add missing logout and sort keys across 10 locales

---
**Full Changelog**: [v0.0.18...v0.0.19](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.18...v0.0.19)



---

# v0.0.18

_2026-03-18_

## What's Changed

### ✨ New Features / 新功能

- install clawhub and skillhub by default

### 🐛 Bug Fixes / 修复

- use official skillhub cli installer

---
**Full Changelog**: [v0.0.17...v0.0.18](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.17...v0.0.18)



---

# v0.0.17

_2026-03-18_

## What's Changed

### ✨ New Features / 新功能

- add wallpaper handler
- improve wallpaper and settings experience
- add wallpaper source selection with random/Picsum/Unsplash options and enlarge preview
- update Docker onboarding and setup flows
- add window controls position and desktop wallpaper preferences
- render scope tags from uiHints in SchemaField badges
- add dedicated UI for media retention, talk silence, APNs relay
- show Docker-managed status in Settings service panel
- add entrypoint script for OpenClaw gateway auto-start
- inline model picker on UsagePanel with direct patching
- clickable model card in UsagePanel to open session settings
- Escape key to abort run, dismiss btw, add Esc hint
- display btw/side-result inline messages from gateway
- fun waiting phrases, sending-waiting-streaming flow, reconnect toast
- add live tool streaming, fast mode override, and enhanced run phases
- add imageModel selector in models section with i18n

### 🐛 Bug Fixes / 修复

- replace openclaw onboard with minimal config write
- move app port to 18788
- accept generated config
- wait for docker health
- bootstrap openclaw config
- enable tini subreaper mode
- stabilize bundled openclaw runtime
- improve plugin and wallpaper handling
- use runtime plugin ids in plugin center
- correct wallpaper controls behavior
- correct wallpaper controls behavior
- make ClawHub and SkillHub URLs configurable
- stabilize window namespace hook deps
- break session list refresh loop by using silent polls and stable deps
- debounce gwReady to prevent chat unmount on brief connectivity blips
- suppress sidebar refresh flicker by making background polls silent
- stabilize session list by preventing unnecessary re-renders from polling and i18n deps
- stop session list flickering caused by i18n dep in WS effect
- allow wallpaper fetch through CSP and use img element loading
- add OpenClaw persistence, log rotation, network isolation, and startup diagnostics
- session rename not persisting after switching sessions
- sync session metadata more eagerly
- smooth sessions sidebar loading
- reduce sessions race conditions
- harden sessions markdown and history loading
- preserve pending tab navigation on window open
- correct schema paths for media.ttlHours and gateway.push.apns.relay
- tooltip fallback per-key instead of per-language
- cancel pending RAF on stream clear to prevent duplicate messages
- prevent duplicate messages from re-broadcast events
- preserve usage/cost/model metadata from streaming events
- stop leaking JWT token in WebSocket URL console errors
- use react-shiki plug-and-play import to prevent crash
- prevent duplicate messages during streaming via ref-based dedup guard

### ⚡ Performance / 性能优化

- stabilize i18n and gwReady deps across Sessions, Agents, Skills
- smooth session switching transitions

### 🌐 Internationalization / 国际化

- add missing wallpaper alt locale keys
- fix missing keys in tooltips, cm_set, and cm_sk across locales
- add Chinese tooltips for new config keys
- localize waiting phrases across 13 locales
- revise capability limit text to warn about risks

### ♻️ Refactoring / 重构

- unify default port to 18788 across codebase
- rename openclaw volume
- separate runtime from builder
- use fixed bundled openclaw path
- extract shared utilities for time, polling, errors, storage, and skeletons
- unify gateway status polling with shared hook
- replace service install buttons with Settings link

### 📦 Build & Deploy / 构建部署

- upgrade release action
- upgrade upload artifact action
- improve runtime tooling and release checks
- add TZ default, STOPSIGNAL, OCI labels, resource limits, and .dockerignore
- switch to Ubuntu 22.04 with Node.js 22 and OpenClaw support

### 📝 Documentation / 文档

- update Docker section with accurate volume and env details
- expand Docker section with ports, env vars, volumes, and resource limits

---
**Full Changelog**: [v0.0.16...v0.0.17](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.16...v0.0.17)



---

# v0.0.16

_2026-03-15_

## What's Changed

### ✨ New Features / 新功能

- add doctor health checks, snapshot import, and API extensions
- add model vision capability config, drag-drop images, usage panel improvements
- auto-select first session on initial load when default has no messages
- add model, stopReason and rich metadata badges to chat messages
- show per-message token/cost badges and improve empty tool output display
- beautify chat sidebar with chart visuals and fix streaming status stuck
- per-session usage cards with chart-based KPI dashboard visuals
- enrich activity monitor with aggregate usage data from sessions.usage API
- enrich usage panel with full session data from sessions.usage API
- replace model override text input with dropdown from config
- Add ToolsCatalog component and market locale files, update skill locales

### 🐛 Bug Fixes / 修复

- add image input capability to default model config in wizard and installer
- fix image sending protocol and preserve images across history reloads
- send raw base64 in attachments and preserve images across history reloads
- resolve duplicate messages and stuck streaming via improved dedup and reconciliation
- raise body size limit to 20 MB and fix image attachment base64 prefix
- add tooltip to CustomSelect for truncated option labels
- robust 3-layer uninstall with force-remove fallback and Windows npm fix
- fall back to npm uninstall when openclaw CLI is broken
- enforce Node >= 22.16 in installer and update Dockerfile to node:22-alpine
- add Node 22.x minor version check in environment scanner
- detect Node version too old and show clear upgrade prompt
- add timeout to model/channel connection test requests
- smart npm mirror fallback retry and accurate speed test
- add config.apply retry with baseHash and improve error handling

### ⚡ Performance / 性能优化

- prioritize chat history loading over sessions list refresh

### 🎨 UI & Styling / 界面优化

- remove duplicate model name from top bar and show time in duration
- merge session stats into context row in usage sidebar
- fix gateway log area layout and tab text wrapping
- add sci-tech theme and modernize all window components

### 🌐 Internationalization / 国际化

- add usage panel keys for tools, duration, models across all 13 locales
- fill missing locale keys across all 13 locales (1784 keys)

### ♻️ Refactoring / 重构

- clean up gateway WebSocket client debug code
- move session info to right sidebar panel for better space usage

### 📦 Build & Deploy / 构建部署

- add CI workflow, i18n checker, and clean up unused files
- pin Node base image to 22.16-alpine

### 📝 Documentation / 文档

- update pull request template

### 🔧 Maintenance / 维护

- bump openclawCompat to >=2026.3.12

---
**Full Changelog**: [v0.0.15...v0.0.16](https://github.com/ClawDeckX/ClawDeckX/compare/v0.0.15...v0.0.16)



---





































































































