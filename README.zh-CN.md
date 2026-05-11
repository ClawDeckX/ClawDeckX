<div align="center">

# ClawDeckX

**Complexity within, simplicity without.**<br>
**繁于内，简于形。**

[English](README.md) | **简体中文**

[![Release](https://img.shields.io/github/v/release/ClawDeckX/ClawDeckX?style=for-the-badge&logo=rocket)](https://github.com/ClawDeckX/ClawDeckX/releases)
[![Build](https://img.shields.io/badge/Build-Passing-success?style=for-the-badge&logo=github-actions)](https://github.com/ClawDeckX/ClawDeckX/actions)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)


</div>

---

**ClawDeckX** 是专为 [OpenClaw](https://github.com/openclaw/openclaw) 打造的开源 Web 可视化管理平台，专注于降低使用门槛，让安装、配置、观测与优化更加简单高效，为全球用户，尤其是新手用户，提供更友好的上手体验。

> [!CAUTION]
> **Beta 预览版** — 当前为初始预览版本，尚未进行深度完整的覆盖测试，**请勿用于生产环境。**

> [!TIP]
> **正在使用 [HermesAgent](https://github.com/NousResearch/hermes-agent)？** 欢迎了解姊妹项目 [HermesDeckX](https://github.com/HermesDeckX/HermesDeckX) — 为 HermesAgent 提供同样的可视化管理体验。

## 快速导航

- [界面预览](#-界面预览)
- [为什么选择 ClawDeckX？](#-为什么选择-clawdeckx)
- [快速开始](#-快速开始)
- [Docker 安装](#docker-安装)
- [功能特性](#-功能特性)
- [技术栈](#-技术栈)

## 📸 界面预览

<div align="center">
  <img src="assets/screenshots/dashboard.png" width="800" alt="Dashboard Overview" />
  <p><sub>仪表盘总览</sub></p>
</div>

<br>

<div align="center">
  <img src="assets/screenshots/scenarios.png" width="390" alt="Scenario Templates" />
  &nbsp;
  <img src="assets/screenshots/multi-agent.png" width="390" alt="Multi-Agent Workflow" />
  <p><sub>场景模板列表 &amp; 多智能体工作流</sub></p>
</div>

<br>

<div align="center">
  <img src="assets/screenshots/config.png" width="390" alt="Configuration Center" />
  &nbsp;
  <img src="assets/screenshots/skills.png" width="390" alt="Skills Center" />
  <p><sub>配置中心 &amp; 技能中心</sub></p>
</div>

## ✨ 为什么选择 ClawDeckX？

### macOS 级视觉体验

界面高度还原 macOS 设计语言，采用精致的毛玻璃效果、圆角卡片和细腻的动画过渡，让管理 AI 智能体像操作原生桌面应用一样流畅自然。

### 新用户极友好

图形化引导和预设模板，让你无需记忆复杂命令，即可快速完成 OpenClaw 的初始配置与模型接入。

### 深度配置能力

支持对 OpenClaw 底层参数进行精细调控，包括模型切换、记忆管理、插件加载、频道路由等，满足高级用户的定制化需求。

### 全景观测系统

内置实时监控仪表盘，直观展示 AI 的执行状态、资源消耗和任务历史，让你对智能体的运行了如指掌。

### 全平台支持

单文件零依赖，原生支持 Windows、macOS（Intel 与 Apple Silicon）和 Linux（amd64 & arm64）。下载即用，开箱即跑。

### 屏幕自适应与移动端适配

完整的响应式布局，从大屏桌面到平板和手机无缝适配。随时随地管理你的 AI 智能体，功能体验零妥协。

### 多语言支持

完整的国际化架构，内置 13 种语言支持。新增语言只需提供翻译的 JSON 文件夹，并修改少量代码即可完成接入。

### 本地与远程网关

同时支持本地网关与远程网关管理。一键切换网关配置档案，轻松应对开发、测试、生产等多环境部署场景。

## 🚀 快速开始

### 部署方案

#### 1. 本地部署（推荐）

在 OpenClaw 所在的服务器上安装 ClawDeckX，享受完整功能支持和直接命令执行能力。

**优势：**
- 完整功能支持，包括直接执行 OpenClaw 命令
- 更低延迟，响应更快
- ClawDeckX 与 OpenClaw 之间无网络依赖

#### 2. 远程网关

在本机安装 ClawDeckX，通过 WebSocket 连接远程 OpenClaw 实例。

**限制：**
- 部分需要直接调用 OpenClaw 命令的功能不可用
- 依赖 ClawDeckX 与 OpenClaw Gateway 之间的稳定网络连接
- 操作延迟略高

### 一键安装 / 卸载 / 维护

统一安装脚本自动检测已有安装，通过自适应菜单即可**安装、更新、管理或卸载** Binary 和 Docker 两种部署方式。

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/ClawDeckX/ClawDeckX/main/install.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/ClawDeckX/ClawDeckX/main/install.ps1 | iex
```

#### 非交互式安装

安装脚本支持通过命令行参数实现全自动无人值守安装，适用于 CI/CD 流水线、批量部署和自动化运维场景。

```bash
# 二进制一键安装（全部使用默认值）
curl -fsSL https://raw.githubusercontent.com/ClawDeckX/ClawDeckX/main/install.sh | bash -s -- \
  --yes --mode binary

# Docker 安装，指定端口和实例名
curl -fsSL https://raw.githubusercontent.com/ClawDeckX/ClawDeckX/main/install.sh | bash -s -- \
  --yes --mode docker --port 19000 --instance-name myapp

# 二进制安装，精细控制各选项
curl -fsSL https://raw.githubusercontent.com/ClawDeckX/ClawDeckX/main/install.sh | bash -s -- \
  --yes --mode binary --port 8080 --register-path --install-service --start

# 非交互式更新，不自动启动
bash install.sh --yes --mode update --no-start
```

| 参数 | 说明 |
| :--- | :--- |
| `--yes` / `-y` | 自动确认所有提示（同时启用非交互模式） |
| `--non-interactive` | 非交互模式，所有提示使用默认值 |
| `--mode <模式>` | 跳过菜单直接执行：`binary`、`docker`、`update`、`stop` |
| `--port <端口>` | 指定服务端口 |
| `--instance-name <名称>` | Docker 实例名称（默认 `clawdeckx`） |
| `--register-path` | 将 `clawdeckx` 添加到 PATH |
| `--no-register-path` | 跳过 PATH 注册 |
| `--install-service` | 安装 systemd 自启服务 |
| `--no-install-service` | 跳过服务安装 |
| `--start` / `--no-start` | 安装/更新后是否启动 |
| `--help` / `-h` | 显示帮助信息 |

> [!NOTE]
> 以 root 用户执行非交互式安装时，脚本会跳过用户创建，直接在当前目录安装。交互模式下则会引导创建专用的 `openclaw` 用户。

### 手动下载

从 [Releases](https://github.com/ClawDeckX/ClawDeckX/releases) 下载二进制文件，零依赖，直接运行。

```bash
./ClawDeckX
./ClawDeckX --port 18788 --bind 0.0.0.0
./ClawDeckX --user admin --pass your_password
./ClawDeckX --bind 0.0.0.0 --port 18788 --user admin --pass your_password
```

| 参数 | 简写 | 说明 |
| :--- | :---: | :--- |
| `--port` | `-p` | 服务端口（默认 `18788`） |
| `--bind` | `-b` | 绑定地址（默认 `127.0.0.1`） |
| `--user` | `-u` | 初始管理员用户名（仅首次） |
| `--pass` | | 初始管理员密码（至少 6 位） |
| `--debug` | | 启用调试日志 |

### 命令行工具

| 命令 | 用法 | 说明 |
| :--- | :--- | :--- |
| `reset-password` | `ClawDeckX reset-password <user> <pass>` | 重置用户密码 |
| `reset-username` | `ClawDeckX reset-username <old> <new>` | 修改用户名 |
| `list-users` | `ClawDeckX list-users` | 列出所有已注册用户 |
| `unlock` | `ClawDeckX unlock <user>` | 解锁被锁定的用户账户 |

> [!TIP]
> 忘记登录凭据时，可运行 `ClawDeckX list-users` 查看用户名，然后使用 `ClawDeckX reset-password <用户名> <新密码>` 重置密码。
> 若密码含特殊符号（如 `!`, `$`, `#`, `&` 等），请用**单引号**包裹以避免被 shell 解释，例如：`ClawDeckX reset-password admin 'P@ss!w0rd#$'`。

> [!WARNING]
> 连续输错密码 **5 次**，账户将被自动锁定 **15 分钟**。锁定期间即使输入正确密码也无法登录。如需立即解锁，可运行 `ClawDeckX unlock <用户名>`。

> [!IMPORTANT]
> 首次运行时，若未指定 `--user` 和 `--pass`，系统会自动生成管理员账户，凭据将打印到控制台。请在登录后立即前往系统设置或账户安全页面修改用户名和密码。

### Docker 安装

> **推荐：** 使用上方[一键安装脚本](#一键安装--卸载--维护)，选择 **Docker** 模式即可。脚本会自动下载配置文件、设置端口、检测镜像源并显示登录凭据。

**手动安装：**

```bash
curl -fsSL https://raw.githubusercontent.com/ClawDeckX/ClawDeckX/main/docker-compose.yml -o docker-compose.yml
docker compose up -d
```

更新镜像后，如需应用新的 Dockerfile 或入口脚本变更，请重建容器：

```bash
docker compose up -d --force-recreate
```

浏览器打开 `http://localhost:18700`（Docker）或 `http://localhost:18788`（本机安装），首次启动会自动生成管理员账户，凭据将显示在容器日志中。

ClawDeckX 与 OpenClaw 运行在同一个容器中。官方 Docker 镜像已预装 OpenClaw，版本与兼容性已锁定。容器启动时，入口脚本会在配置文件存在时自动启动 OpenClaw Gateway。如果尚未配置，请在 Web 界面中完成安装向导即可，无需手动安装。

官方 Docker 镜像还预装了常见技能/运行时依赖，包括 `go`、`python3`、`uv`、`ffmpeg`、`jq`、`ripgrep`、`wget` 与 `make`，因此许多 OpenClaw 技能在首次启动后即可直接使用，无需额外安装系统包。

默认情况下，镜像内的 ClawDeckX 服务会连接容器内本地 Gateway：`127.0.0.1:18789`。如果你需要改为连接宿主机或外部 Gateway，请在 `docker-compose.yml` 中覆盖 `OCD_OPENCLAW_GATEWAY_HOST` 与 `OCD_OPENCLAW_GATEWAY_PORT`。

```bash
docker logs clawdeckx
```

#### Docker 配置说明

**端口映射：**

| 端口 | 服务 | 说明 |
| :--- | :--- | :--- |
| `18700` → `18788` | ClawDeckX Web UI | 主界面（宿主机 18700 → 容器内 18788） |
| `18789` | OpenClaw Gateway | 可选：映射后可从容器外调试 Gateway |

如需从容器外访问 Gateway，在 `docker-compose.yml` 的 `ports` 中添加 `- "18789:18789"`。

注意，仅映射 `18789` 并不一定能从宿主机访问 Gateway。默认生成的最小 OpenClaw 配置会将 Gateway 绑定到 `loopback`，因此如果需要外部访问，可能还需要同步调整 Gateway 的绑定地址。

**环境变量：**

| 变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `OPENCLAW_HOME` | `/data/openclaw/home` | OpenClaw home 根目录覆盖 |
| `OPENCLAW_STATE_DIR` | `/data/openclaw/state` | OpenClaw 状态目录 |
| `OPENCLAW_CONFIG_PATH` | `/data/openclaw/state/openclaw.json` | OpenClaw 配置文件路径 |
| `NPM_CONFIG_PREFIX` | `/data/openclaw/npm` | 持久化 npm 前缀（用于用户自行升级安装） |
| `OCD_DB_SQLITE_PATH` | `/data/clawdeckx/ClawDeckX.db` | ClawDeckX SQLite 数据库路径 |
| `OCD_LOG_FILE` | `/data/clawdeckx/ClawDeckX.log` | ClawDeckX 服务日志路径 |
| `OCD_GATEWAY_LOG` | `/data/openclaw/logs/gateway.log` | 持久化 OpenClaw Gateway 日志 |
| `OCD_SETUP_INSTALL_LOG` | `/data/openclaw/logs/install.log` | 安装向导日志路径 |
| `OCD_SETUP_DOCTOR_LOG` | `/data/openclaw/logs/doctor.log` | 诊断日志路径 |
| `OCD_OPENCLAW_GATEWAY_HOST` | `127.0.0.1` | Gateway 地址 |
| `OCD_OPENCLAW_GATEWAY_PORT` | `18789` | Gateway 端口 |
| `OCD_OPENCLAW_GATEWAY_TOKEN` | *(empty)* | Gateway 认证令牌 |
| `OCD_PORT` | `18788` | ClawDeckX 监听端口（容器内部） |
| `OCD_BIND` | `0.0.0.0` | ClawDeckX 绑定地址 |
| `TZ` | `UTC` | 容器时区（如 `Asia/Shanghai`） |

**预装运行时工具：**

- **`go`**
- **`python3`**
- **`uv`**
- **`ffmpeg`**
- **`jq`**
- **`ripgrep`**
- **`wget`**
- **`make`**

> [!NOTE]
> Docker 镜像体积大于最小化运行时，因为它包含了 OpenClaw 技能的完整运行时工具链。这样可以确保许多技能开箱即用，无需在容器内额外安装系统包。

**数据卷：**

| 卷名 | 挂载点 | 说明 |
| :--- | :--- | :--- |
| `clawdeckx-data` | `/data/clawdeckx` | ClawDeckX 数据库与应用日志 |
| `clawdeckx-openclaw-data` | `/data/openclaw` | OpenClaw 配置、状态、日志与用户升级安装数据 |

> [!TIP]
> OpenClaw 已内置在镜像中，配置通过 Docker 卷持久化。执行 `docker pull` 并重建容器后，OpenClaw 仍然可用，配置也会保留。

**持久化路径：**

| 路径 | 用途 |
| :--- | :--- |
| `/data/openclaw/npm` | 用户安装的 npm 包（升级用） |
| `/data/openclaw/state` | OpenClaw 状态目录 |
| `/data/openclaw/state/openclaw.json` | OpenClaw 配置文件 |
| `/data/openclaw/logs/gateway.log` | Gateway 启动与运行日志 |
| `/data/openclaw/logs/install.log` | 安装向导日志 |
| `/data/openclaw/logs/doctor.log` | 诊断日志 |
| `/data/openclaw/bootstrap/gateway-bootstrap.json` | 入口脚本启动状态文件 |

如果尚未配置 OpenClaw，ClawDeckX 会引导你通过安装向导完成初始配置。

容器健康检查使用 `/api/v1/health` 作为存活探测。排障时可调用 `/api/v1/health?detailed=true`，同时查看 ClawDeckX、OpenClaw、Gateway 与启动状态文件的信息。

**资源限制：**

默认 `docker-compose.yml` 限制内存 2 GB、CPU 2 核，可根据需要调整 `deploy.resources.limits`。

## ✨ 功能特性

| | 功能 | 说明 |
| :---: | :--- | :--- |
| 💎 | **Pixel-Perfect UI** | macOS 级视觉体验，毛玻璃效果、流畅动画、明暗主题 |
| 🎛️ | **Gateway Control** | 一键启停网关，实时健康监控 |
| 🖼 | **Visual Config Editor** | 可视化配置编辑器，告别手写 JSON/YAML |
| 🧙 | **Setup Wizard** | 新手引导向导，逐步完成配置 |
| 🧩 | **Template Center** | 模板中心，秒级部署新代理人设 |
| 📊 | **Live Dashboard** | 实时仪表盘，会话追踪与活动监控 |
| 🛡️ | **Security Built-in** | 内置安全体系：JWT 认证、HttpOnly Cookie、告警系统 |
| 🌍 | **i18n Ready** | 内置 13 种语言，轻松扩展 |
| 📱 | **Responsive Design** | 响应式设计，桌面与移动端无缝适配 |

## 🛠️ 技术栈

| 层级 | 技术 | 说明 |
| :--- | :--- | :--- |
| **Backend** | Go (Golang) | 单文件编译，零外部依赖 |
| **Frontend** | React + TailwindCSS | 响应式、主题感知 UI |
| **Database** | SQLite / PostgreSQL | 默认 SQLite，可选 PostgreSQL |
| **Real-time** | WebSocket + SSE | 实时双向通信 |
| **Deployment** | Single binary, cross-platform | 单文件跨平台（Windows / macOS / Linux） |
| **Container** | Docker / Docker Compose | 一键 Docker 部署，支持 amd64 & arm64 |

## 🤝 参与贡献

欢迎参与贡献。无论是修复 Bug、添加功能还是改进文档，我们都非常感谢。

## 💬 作者寄语

这是我的第一个开源项目，也希望它能在大家的参与下变得越来越好。如果你发现问题，或有任何改进想法，欢迎提交 [Issue](https://github.com/ClawDeckX/ClawDeckX/issues) 或 [Pull Request](https://github.com/ClawDeckX/ClawDeckX/pulls)。感谢你的关注和支持，每一次反馈，都是这个项目成长的一部分。

> *某 AI 曾预言本项目会大火——不过众所周知，AI 这东西，是会产生幻觉的😅。*

## 📄 开源协议

本项目基于 [MIT 协议](LICENSE) 开源，可自由使用、修改和分发，适用于个人及商业用途。

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=ClawDeckX/ClawDeckX&type=Date)](https://star-history.com/#ClawDeckX/ClawDeckX&Date)

<div align="center">
  <sub>Designed with ❤️ by ClawDeckX</sub>
</div>
