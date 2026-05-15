## What's Changed

### ✨ New Features / 新功能

- support single-agent team generation
- show breathing 'Background' status when session has active run
- add session describe info panel and agentRuntime display
- integrate 2026.5.7 RPC enhancements and smart restart
- adapt task debugging surfaces

### 🐛 Bug Fixes / 修复

- confirm deployed agent workspaces
- normalize single-agent workflow preview
- use standalone mode for single agents
- use patch and Windows restart for plugin load
- use --force for CLI plugin install
- copy plugin to extensions/ and register in plugins.installs
- add system npm fallback for plugin install
- handle agentRuntime as object {id,source} not string
- auto-install diagnostics-prometheus plugin before enabling
- smart restart gateway + refresh UI after OpenClaw update
- handle redacted gateway credentials

---
**Full Changelog**: [v0.2.14...v0.2.15](https://github.com/ClawDeckX/ClawDeckX/compare/v0.2.14...v0.2.15)


