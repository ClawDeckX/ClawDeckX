<div align="center">

# ClawDeckX

**Complexity within, simplicity without.**<br>
**繁于内，简于形。**

**English** | [简体中文](README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/ClawDeckX/ClawDeckX?style=for-the-badge&logo=rocket)](https://github.com/ClawDeckX/ClawDeckX/releases)
[![Build](https://img.shields.io/badge/Build-Passing-success?style=for-the-badge&logo=github-actions)](https://github.com/ClawDeckX/ClawDeckX/actions)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

---

**ClawDeckX** is an open-source web visual management platform built for [OpenClaw](https://github.com/openclaw/openclaw). It is designed to lower the barrier to entry, making installation, configuration, monitoring, and optimization simpler and more efficient, while providing a more accessible onboarding experience for users worldwide, especially beginners.

</div>

> [!CAUTION]
> **Beta Preview** — This is an early preview release. It has not undergone comprehensive testing. **Do not use in production environments.**

<br>

> [!TIP]
> **Using [HermesAgent](https://github.com/NousResearch/hermes-agent) instead?** Check out [HermesDeckX](https://github.com/HermesDeckX/HermesDeckX) — a sister project offering the same visual management experience for HermesAgent.

## Quick Navigation

- [Screenshots](#-screenshots)
- [Why ClawDeckX?](#-why-clawdeckx)
- [Quick Start](#-quick-start)
- [Docker Install](#docker-install)
- [Features](#-features)
- [Tech Stack](#-tech-stack)

## 📸 Screenshots

<div align="center">
  <img src="assets/screenshots/dashboard.png" width="800" alt="Dashboard Overview" />
  <p><sub>Dashboard Overview</sub></p>
</div>

<br>

<div align="center">
  <img src="assets/screenshots/scenarios.png" width="390" alt="Scenario Templates" />
  &nbsp;
  <img src="assets/screenshots/multi-agent.png" width="390" alt="Multi-Agent Workflow" />
  <p><sub>Scenario Templates &amp; Multi-Agent Workflow</sub></p>
</div>

<br>

<div align="center">
  <img src="assets/screenshots/config.png" width="390" alt="Configuration Center" />
  &nbsp;
  <img src="assets/screenshots/skills.png" width="390" alt="Skills Center" />
  <p><sub>Configuration Center &amp; Skills Center</sub></p>
</div>

<br>

## ✨ Why ClawDeckX?

### macOS-Grade Visual Experience

The interface faithfully recreates the macOS design language — refined glassmorphism, rounded cards, and smooth animation transitions. Managing AI agents feels as natural as using a native desktop app.

### Beginner-Friendly Setup

Guided wizards and pre-built templates let you complete OpenClaw's initial configuration and model setup without memorizing a single command.

### Deep Configuration

Fine-tune every OpenClaw parameter — model switching, memory management, plugin loading, channel routing — all through a beautiful visual editor.

### Real-Time Observability

Built-in monitoring dashboard with live execution status, resource consumption, and task history — full visibility into every agent's behavior.

### Cross-Platform

Single binary, zero dependencies. Runs natively on Windows, macOS (Intel & Apple Silicon), and Linux (amd64 & arm64). Download and run — that's it.

### Responsive & Mobile-Ready

Fully responsive layout that adapts seamlessly from large desktop monitors to tablets and mobile phones. Manage your AI agents on the go — no compromise on functionality.

### Multilingual Support

Full i18n architecture with 5 built-in languages (English, Simplified Chinese, Traditional Chinese, Japanese, Korean). Adding a new language requires only a translated JSON folder and a two-line code change.

### Local & Remote Gateway

Seamlessly manage both local and remote OpenClaw gateways. Switch between gateway profiles with one click — perfect for multi-environment setups like dev, staging, and production.

## 🚀 Quick Start

### Deployment Options

Choose the deployment method that best fits your needs:

#### 1️⃣ Local Deployment (Recommended)

Install ClawDeckX on the same server as OpenClaw for full feature access and direct command execution.

**✅ Advantages:**
- Full feature support including direct OpenClaw command execution
- Lower latency and faster response times
- No network dependency between ClawDeckX and OpenClaw

#### 2️⃣ Remote Gateway

Install ClawDeckX on your local machine and connect to remote OpenClaw instances via WebSocket.

**⚠️ Limitations:**
- Some features requiring direct OpenClaw command execution are unavailable
- Depends on stable network connection between ClawDeckX and OpenClaw Gateway
- Slightly higher latency for operations

---

### One-Click Install & Maintain

The unified installer detects existing installations and lets you **install, update, manage, or uninstall** both Binary and Docker deployments from a single adaptive menu.

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/ClawDeckX/ClawDeckX/main/install.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/ClawDeckX/ClawDeckX/main/install.ps1 | iex
```

#### Non-Interactive Install

The installer supports fully non-interactive (headless) installation via command-line flags — perfect for CI/CD pipelines, provisioning scripts, and automated deployments.

```bash
# Binary install with all defaults (auto-confirm everything)
curl -fsSL https://raw.githubusercontent.com/ClawDeckX/ClawDeckX/main/install.sh | bash -s -- \
  --yes --mode binary

# Docker install with custom port and instance name
curl -fsSL https://raw.githubusercontent.com/ClawDeckX/ClawDeckX/main/install.sh | bash -s -- \
  --yes --mode docker --port 19000 --instance-name myapp

# Binary install with fine-grained control
curl -fsSL https://raw.githubusercontent.com/ClawDeckX/ClawDeckX/main/install.sh | bash -s -- \
  --yes --mode binary --port 8080 --register-path --install-service --start

# Non-interactive update without restarting
bash install.sh --yes --mode update --no-start
```

| Flag | Description |
| :--- | :--- |
| `--yes` / `-y` | Auto-confirm all prompts (implies `--non-interactive`) |
| `--non-interactive` | Use default values for all prompts without confirming |
| `--mode <mode>` | Skip menu: `binary`, `docker`, `update`, or `stop` |
| `--port <port>` | Specify service port |
| `--instance-name <name>` | Docker instance name (default: `clawdeckx`) |
| `--register-path` | Add `clawdeckx` to PATH |
| `--no-register-path` | Skip PATH registration |
| `--install-service` | Install systemd auto-start service |
| `--no-install-service` | Skip service installation |
| `--start` / `--no-start` | Start (or skip starting) after install/update |
| `--help` / `-h` | Show usage help |

> [!NOTE]
> The binary is always installed to `/opt/clawdeckx/` regardless of user. Non-root users will be prompted for `sudo` to create the directory. A symlink is placed in `/usr/local/bin` (root) or `~/.local/bin` (user) for global access.

### Manual Download

Download from [Releases](https://github.com/ClawDeckX/ClawDeckX/releases). Single file, no dependencies. Just run.

```bash
# Run with default settings (localhost:18788)
./ClawDeckX

# Specify port and bind address
./ClawDeckX --port 18788 --bind 0.0.0.0

# Create initial admin user on first run
./ClawDeckX --user admin --pass your_password

# All options combined
./ClawDeckX --bind 0.0.0.0 --port 18788 --user admin --pass your_password
```

| Flag | Short | Description |
| :--- | :---: | :--- |
| `--port` | `-p` | Server port (default: `18788`) |
| `--bind` | `-b` | Bind address (default: `127.0.0.1`) |
| `--user` | `-u` | Initial admin username (first run only) |
| `--pass` | | Initial admin password (min 6 chars) |
| `--debug` | | Enable debug logging |

### CLI Commands

| Command | Usage | Description |
| :--- | :--- | :--- |
| `reset-password` | `ClawDeckX reset-password <user> <pass>` | Reset a user's password |
| `reset-username` | `ClawDeckX reset-username <old> <new>` | Change a user's username |
| `list-users` | `ClawDeckX list-users` | List all registered users |
| `unlock` | `ClawDeckX unlock <user>` | Unlock a locked user account |

> [!TIP]
> **Forgot your credentials?** Run `ClawDeckX list-users` to find your username, then `ClawDeckX reset-password <username> <new_password>` to reset your password.
> If your password contains special characters (e.g. `!`, `$`, `#`, `&`), wrap it in **single quotes** to prevent shell interpretation: `ClawDeckX reset-password admin 'P@ss!w0rd#$'`.

> [!WARNING]
> **Account lockout:** After **5** consecutive failed login attempts, the account is automatically locked for **15 minutes**. During this period, login is blocked even with the correct password. To unlock immediately, run `ClawDeckX unlock <username>`.

> [!IMPORTANT]
> **Security Reminder:** On first run, if no `--user` and `--pass` are provided, the auto-generated admin credentials will be printed to the console. Please change your username and password in the settings page immediately after logging in.

<br>

### Docker Install

> **Recommended:** Use the [one-click installer](#one-click-install--maintain) above — choose **Docker** when prompted. It handles download, port configuration, mirror detection, and shows credentials automatically.

**Manual method:**

```bash
curl -fsSL https://raw.githubusercontent.com/ClawDeckX/ClawDeckX/main/docker-compose.yml -o docker-compose.yml
docker compose up -d
```

After updating the image, recreate the container to apply Dockerfile and entrypoint changes:

```bash
docker compose up -d --force-recreate
```

Open your browser at `http://localhost:18700` (Docker) or `http://localhost:18788` (native). The first run will auto-generate an admin account — credentials will be shown in the container logs.

ClawDeckX and OpenClaw run in the same container. OpenClaw is **preinstalled** in the official Docker image with version-pinned compatibility. On startup, the container entrypoint auto-starts the OpenClaw Gateway if a configuration file exists. If OpenClaw is not yet configured, complete the Setup Wizard in the web UI — no manual installation is needed.

The official Docker image also preinstalls common skill/runtime dependencies including `go`, `python3`, `uv`, `ffmpeg`, `jq`, `ripgrep`, `wget`, and `make`, so many OpenClaw skills can run out of the box without extra system package installation.

By default, the bundled ClawDeckX service connects to the local in-container Gateway at `127.0.0.1:18789`. If you need to use a host or external Gateway instead, override `OCD_OPENCLAW_GATEWAY_HOST` and `OCD_OPENCLAW_GATEWAY_PORT` in `docker-compose.yml`.

```bash
# View credentials
docker logs clawdeckx
```

#### Docker Configuration

**Ports:**

| Port | Service | Description |
| :--- | :--- | :--- |
| `18700` → `18788` | ClawDeckX Web UI | Main dashboard (host 18700 → container 18788) |
| `18789` | OpenClaw Gateway | Optional: expose for external debugging |

To expose the Gateway port, add `- "18789:18789"` under `ports` in `docker-compose.yml`.

Note that exposing `18789` alone does not guarantee host access to the Gateway. The generated minimal OpenClaw config binds the Gateway to `loopback` by default, so you may also need to adjust the Gateway bind setting for external access.

**Environment Variables:**

| Variable | Default | Description |
| :--- | :--- | :--- |
| `OPENCLAW_HOME` | `/data/openclaw/home` | OpenClaw home root override |
| `OPENCLAW_STATE_DIR` | `/data/openclaw/state` | OpenClaw state directory |
| `OPENCLAW_CONFIG_PATH` | `/data/openclaw/state/openclaw.json` | OpenClaw config file path |
| `NPM_CONFIG_PREFIX` | `/data/openclaw/npm` | Persistent npm prefix for user-installed upgrades |
| `OCD_DB_SQLITE_PATH` | `/data/clawdeckx/ClawDeckX.db` | ClawDeckX SQLite database path |
| `OCD_LOG_FILE` | `/data/clawdeckx/ClawDeckX.log` | ClawDeckX server log path |
| `OCD_GATEWAY_LOG` | `/data/openclaw/logs/gateway.log` | Persistent OpenClaw Gateway log |
| `OCD_SETUP_INSTALL_LOG` | `/data/openclaw/logs/install.log` | Setup/install log path |
| `OCD_SETUP_DOCTOR_LOG` | `/data/openclaw/logs/doctor.log` | Doctor/diagnostic log path |
| `OCD_OPENCLAW_GATEWAY_HOST` | `127.0.0.1` | Gateway host address |
| `OCD_OPENCLAW_GATEWAY_PORT` | `18789` | Gateway port |
| `OCD_OPENCLAW_GATEWAY_TOKEN` | *(empty)* | Gateway auth token |
| `OCD_PORT` | `18788` | ClawDeckX listen port (internal) |
| `OCD_BIND` | `0.0.0.0` | ClawDeckX bind address |
| `TZ` | `UTC` | Container timezone (e.g. `Asia/Shanghai`) |

**Preinstalled Runtime Tools:**

- **`go`**
- **`python3`**
- **`uv`**
- **`ffmpeg`**
- **`jq`**
- **`ripgrep`**
- **`wget`**
- **`make`**

> [!NOTE]
> The Docker image is larger than a minimal runtime because it includes the full runtime toolchain for OpenClaw skills. This ensures many skills can run out of the box without requiring you to install system packages inside the container.

**Volumes:**

| Volume | Mount Point | Description |
| :--- | :--- | :--- |
| `clawdeckx-data` | `/data/clawdeckx` | ClawDeckX database and app logs |
| `clawdeckx-openclaw-data` | `/data/openclaw` | OpenClaw config, state, logs, and user-installed upgrades |

> [!TIP]
> OpenClaw is bundled in the image and its configuration is persisted via Docker volumes. After `docker pull` and recreate, OpenClaw remains available and your configuration is preserved.

**Persistent Paths:**

| Path | Purpose |
| :--- | :--- |
| `/data/openclaw/npm` | User-installed npm packages (upgrades) |
| `/data/openclaw/state` | OpenClaw state directory |
| `/data/openclaw/state/openclaw.json` | OpenClaw config file |
| `/data/openclaw/logs/gateway.log` | Gateway startup/runtime log |
| `/data/openclaw/logs/install.log` | Setup/install log |
| `/data/openclaw/logs/doctor.log` | Doctor/diagnostic log |
| `/data/openclaw/bootstrap/gateway-bootstrap.json` | Entrypoint bootstrap status |

OpenClaw is preinstalled in the Docker image. If it is not yet configured, ClawDeckX will guide you through the Setup Wizard to complete the initial configuration.

The container health check uses `/api/v1/health` for liveness. For diagnostics, you can call `/api/v1/health?detailed=true` to inspect ClawDeckX, OpenClaw, Gateway, and bootstrap state together.

**Resource Limits:**

The default `docker-compose.yml` sets memory limit to 2 GB and CPU limit to 2 cores. Adjust `deploy.resources.limits` as needed.

<br>

## ✨ Features

| | Feature | Description |
| :---: | :--- | :--- |
| 💎 | **Pixel-Perfect UI** | Native macOS feel with glassmorphism, smooth animations, dark/light themes |
| 🎛️ | **Gateway Control** | Start, stop, restart your Gateway instantly with real-time health monitoring |
| 🖼 | **Visual Config Editor** | Edit configurations and agent profiles without touching JSON/YAML |
| 🧙 | **Setup Wizard** | Step-by-step guided setup for first-time users |
| 🧩 | **Template Center** | Deploy new agent personas in seconds with built-in templates |
| 📊 | **Live Dashboard** | Real-time metrics, session tracking, and activity monitoring |
| 🛡️ | **Security Built-in** | JWT auth, HttpOnly cookies, and alert system from day one |
| 🌍 | **i18n Ready** | 5 built-in languages (en/zh/zh-TW/ja/ko), easily extensible |
| 📱 | **Responsive Design** | Works seamlessly on desktop and mobile |

<br>

## 🛠️ Tech Stack

| Layer | Technology | Notes |
| :--- | :--- | :--- |
| **Backend** | Go (Golang) | Single-binary backend with no external runtime dependency |
| **Frontend** | React + TailwindCSS | Responsive, theme-aware UI |
| **Database** | SQLite / PostgreSQL | SQLite by default, PostgreSQL optional |
| **Real-time** | WebSocket + SSE | Bi-directional real-time communication |
| **Deployment** | Single binary, cross-platform | Windows / macOS / Linux |
| **Container** | Docker / Docker Compose | One-command container deployment for amd64 & arm64 |

<br>

## 🤝 Contributing

We welcome contributions! Whether you're fixing bugs, adding features, or improving documentation, your help is appreciated.

<br>

## 💬 A Note from the Author

This is my first open-source project, and I hope it will continue to improve with the help of the community. If you run into any issues or have ideas for improvement, feel free to open an [Issue](https://github.com/ClawDeckX/ClawDeckX/issues) or submit a [Pull Request](https://github.com/ClawDeckX/ClawDeckX/pulls). Thank you for your support. Every piece of feedback helps this project grow.

> *An AI predicted this project would go viral. But as we all know, AIs do hallucinate sometimes 😅*

<br>

## 📄 License

This project is licensed under the [MIT License](LICENSE) — free to use, modify, and distribute for both personal and commercial purposes.

<br>

## ⭐ Star History

[![Star History Chart](https://star-history.dera.page/svg?repos=ClawDeckX/ClawDeckX&type=Date)](https://star-history.dera.page/#ClawDeckX/ClawDeckX&Date)

<br>

<div align="center">
  <sub>Designed with ❤️ by ClawDeckX</sub>
</div>
