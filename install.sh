#!/bin/bash
set -e

# ==============================================================================
# ClawDeckX - One-Click Launcher
# ==============================================================================

# Save script to temp file for reliable re-exec (curl|bash sets $0 to "bash")
SELF_SCRIPT="${BASH_SOURCE[0]:-}"
if [ -z "$SELF_SCRIPT" ] || [ "$SELF_SCRIPT" = "bash" ] || [ "$SELF_SCRIPT" = "/bin/bash" ] || [ ! -f "$SELF_SCRIPT" ]; then
    SELF_SCRIPT="/tmp/.clawdeckx-installer.sh"
    # When piped, save stdin (already consumed) — re-download if needed
    if [ ! -f "$SELF_SCRIPT" ]; then
        curl -fsSL "https://raw.githubusercontent.com/ClawDeckX/ClawDeckX/main/install.sh" -o "$SELF_SCRIPT" 2>/dev/null || true
    fi
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# CLI options
ASSUME_YES=false
NON_INTERACTIVE=false
CLI_MODE=""
CLI_PORT=""
CLI_INSTANCE_NAME=""
CLI_REGISTER_PATH="ask"
CLI_INSTALL_SERVICE="ask"
CLI_START="ask"

usage() {
    cat << EOF
Usage: install.sh [options]

Options:
  --yes, -y
  --non-interactive
  --mode <binary|docker|update|stop>
  --port <port>
  --instance-name <name>
  --register-path | --no-register-path
  --install-service | --no-install-service
  --start | --no-start
  --help, -h
EOF
}

parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --yes|-y) ASSUME_YES=true; NON_INTERACTIVE=true ;;
            --non-interactive) NON_INTERACTIVE=true ;;
            --mode) CLI_MODE="$2"; shift ;;
            --port) CLI_PORT="$2"; shift ;;
            --instance-name) CLI_INSTANCE_NAME="$2"; shift ;;
            --register-path) CLI_REGISTER_PATH="yes" ;;
            --no-register-path) CLI_REGISTER_PATH="no" ;;
            --install-service) CLI_INSTALL_SERVICE="yes" ;;
            --no-install-service) CLI_INSTALL_SERVICE="no" ;;
            --start) CLI_START="yes" ;;
            --no-start) CLI_START="no" ;;
            --help|-h) usage; exit 0 ;;
            *) echo -e "${RED}Error: Unknown option: $1${NC}"; usage; exit 1 ;;
        esac
        shift
    done
}

is_non_interactive() {
    [ "$NON_INTERACTIVE" = true ] || [ "$ASSUME_YES" = true ]
}

validate_port() {
    local port="$1"
    [ -n "$port" ] && [ "$port" -gt 0 ] 2>/dev/null && [ "$port" -le 65535 ] 2>/dev/null
}

confirm_default_yes() {
    local prompt="$1"
    if is_non_interactive; then
        echo -e "$prompt ${GREEN}[auto: yes]${NC}"
        return 0
    fi
    echo -n "$prompt"
    read -n 1 -r </dev/tty
    echo
    [[ $REPLY =~ ^[Nn]$ ]] && return 1
    return 0
}

confirm_default_no() {
    local prompt="$1"
    if is_non_interactive; then
        echo -e "$prompt ${YELLOW}[auto: no]${NC}"
        return 1
    fi
    echo -n "$prompt"
    read -n 1 -r </dev/tty
    echo
    [[ $REPLY =~ ^[Yy]$ ]] && return 0
    return 1
}

prompt_with_default() {
    local __resultvar="$1"
    local prompt="$2"
    local default_value="$3"
    local value=""
    if is_non_interactive; then
        value="$default_value"
        echo -e "$prompt ${GREEN}[auto: ${value}]${NC}"
    else
        echo -n "$prompt"
        read -r value </dev/tty
        value="${value:-$default_value}"
    fi
    printf -v "$__resultvar" '%s' "$value"
}

parse_args "$@"

# Installation paths - prefer current directory
BINARY_NAME="clawdeckx"
DEFAULT_PORT=18788
INTERNAL_PORT=18788
DEFAULT_HOST_PORT=18700
PORT=$DEFAULT_PORT
# Config and data directories are relative to executable location
CONFIG_DIR=""
DATA_DIR=""

# Function to check if ClawDeckX is installed and find its location
check_installed() {
    # Check current directory (preferred location)
    if [ -f "./$BINARY_NAME" ] && [ -x "./$BINARY_NAME" ]; then
        INSTALLED_LOCATION="./$BINARY_NAME"
        RAW_VERSION=$(./$BINARY_NAME --version 2>/dev/null || echo "unknown")
        # Extract version number from output like "ClawDeckX 0.0.11"
        CURRENT_VERSION=$(echo "$RAW_VERSION" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
        if [ -z "$CURRENT_VERSION" ]; then
            CURRENT_VERSION="$RAW_VERSION"
        fi
        # Set config and data directories relative to executable
        CONFIG_DIR="$(dirname "$INSTALLED_LOCATION")/data"
        DATA_DIR="$(dirname "$INSTALLED_LOCATION")/data"
        return 0
    fi
    
    return 1
}

# Function to get configured port
# Priority: OCD_PORT env > data/ClawDeckX.json server.port > DEFAULT_PORT
get_config_port() {
    # Check environment variable first
    if [ -n "$OCD_PORT" ] && [ "$OCD_PORT" -gt 0 ] 2>/dev/null && [ "$OCD_PORT" -le 65535 ] 2>/dev/null; then
        PORT=$OCD_PORT
        return
    fi
    
    # Try to read from config file
    local config_file=""
    if [ -n "$INSTALLED_LOCATION" ]; then
        config_file="$(dirname "$INSTALLED_LOCATION")/data/ClawDeckX.json"
    elif [ -n "$INSTALLED_BINARY" ]; then
        config_file="$(dirname "$INSTALLED_BINARY")/data/ClawDeckX.json"
    else
        config_file="$(pwd)/data/ClawDeckX.json"
    fi
    
    if [ -f "$config_file" ]; then
        local p
        # Use grep+sed for portability (no jq dependency)
        p=$(grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]*' "$config_file" | head -1 | grep -o '[0-9]*$')
        if [ -n "$p" ] && [ "$p" -gt 0 ] 2>/dev/null && [ "$p" -le 65535 ] 2>/dev/null; then
            PORT=$p
            return
        fi
    fi
    
    PORT=$DEFAULT_PORT
}

# Print all access URLs (localhost + LAN + public IP) for a given port
# Usage: print_access_urls <port>
print_access_urls() {
    local port="${1:-$PORT}"
    echo -e "${CYAN}Access ClawDeckX at / 访问 ClawDeckX：${NC}"
    echo -e "  ${GREEN}http://localhost:${port}${NC}"
    # LAN IPs (exclude loopback)
    local lan_ips
    lan_ips=$(hostname -I 2>/dev/null || ip -4 addr show 2>/dev/null | grep -oP 'inet \K[\d.]+' | grep -v '^127\.' || true)
    for ip in $lan_ips; do
        [ "$ip" = "127.0.0.1" ] && continue
        echo -e "  ${GREEN}http://${ip}:${port}${NC}  (LAN)"
    done
    # Public IP
    local pub_ip=""
    pub_ip=$(curl -sf --connect-timeout 3 --max-time 5 https://api.ipify.org 2>/dev/null \
          || curl -sf --connect-timeout 3 --max-time 5 https://ifconfig.me 2>/dev/null \
          || curl -sf --connect-timeout 3 --max-time 5 https://ipinfo.io/ip 2>/dev/null \
          || true)
    if [ -n "$pub_ip" ]; then
        echo -e "  ${GREEN}http://${pub_ip}:${port}${NC}  (Public / 公网)"
    fi
    # Firewall reminder when remote access is relevant
    if [ -n "$pub_ip" ] || [ -n "$lan_ips" ]; then
        echo ""
        echo -e "  ${YELLOW}🔒 Remember to open port ${port} in your firewall for remote access${NC}"
        echo -e "  ${YELLOW}   请确保服务器防火墙已放行端口 ${port}，否则外网无法访问${NC}"
    fi
}

# Check if a specific port is available (not in use)
check_port_available() {
    local port=$1
    # Method 1: ss (most common on modern Linux)
    if command -v ss &>/dev/null; then
        if ss -tlnH 2>/dev/null | grep -qE ":${port}\b"; then
            return 1
        fi
        return 0
    fi
    # Method 2: lsof
    if command -v lsof &>/dev/null; then
        if lsof -iTCP:"$port" -sTCP:LISTEN -P -n >/dev/null 2>&1; then
            return 1
        fi
        return 0
    fi
    # Method 3: /dev/tcp (bash built-in, connect test)
    if (echo >/dev/tcp/127.0.0.1/"$port") 2>/dev/null; then
        return 1
    fi
    return 0
}

# Find the next available port starting from a given port
# Usage: find_available_port [start_port]
# Sets FOUND_PORT to the available port
find_available_port() {
    local start=${1:-$DEFAULT_PORT}
    local port=$start
    local max_attempts=20
    local attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if check_port_available "$port"; then
            FOUND_PORT=$port
            return 0
        fi
        echo -e "${YELLOW}  Port $port is in use / 端口 $port 已被占用${NC}"
        port=$((port + 1))
        attempt=$((attempt + 1))
    done
    # All ports occupied, return the start port and let user decide
    FOUND_PORT=$start
    return 1
}

# Ensure XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS are set for systemctl --user.
# Without these, systemctl --user fails with "Failed to connect to bus: No medium found"
# when the user session was started via su (not a login shell).
ensure_user_systemd_env() {
    local uid
    uid=$(id -u)
    if [ -z "$XDG_RUNTIME_DIR" ]; then
        export XDG_RUNTIME_DIR="/run/user/$uid"
    fi
    if [ -z "$DBUS_SESSION_BUS_ADDRESS" ] && [ -S "$XDG_RUNTIME_DIR/bus" ]; then
        export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
    fi
}

# Check if systemctl --user is actually usable (user systemd instance running).
# Returns 0 if usable, 1 if not (e.g. su session without pam_systemd).
can_use_systemctl_user() {
    ensure_user_systemd_env
    # Quick check: if systemctl --user can talk to the bus at all
    systemctl --user --no-pager show-environment > /dev/null 2>&1
}

# Function to check if systemd service is installed
check_systemd_service() {
    ensure_user_systemd_env
    SYSTEMD_SERVICE_INSTALLED=false
    SYSTEMD_SERVICE_TYPE=""
    
    # Check user-level service
    USER_SERVICE_PATH="$HOME/.config/systemd/user/clawdeckx.service"
    if [ -f "$USER_SERVICE_PATH" ]; then
        SYSTEMD_SERVICE_INSTALLED=true
        SYSTEMD_SERVICE_TYPE="user"
        return 0
    fi
    
    # Check system-level service
    SYSTEM_SERVICE_PATH="/etc/systemd/system/clawdeckx.service"
    if [ -f "$SYSTEM_SERVICE_PATH" ]; then
        SYSTEMD_SERVICE_INSTALLED=true
        SYSTEMD_SERVICE_TYPE="system"
        return 0
    fi
    
    # Check if service is enabled/active via systemctl
    if systemctl --user is-enabled --quiet clawdeckx 2>/dev/null; then
        SYSTEMD_SERVICE_INSTALLED=true
        SYSTEMD_SERVICE_TYPE="user"
        return 0
    fi
    
    if systemctl is-enabled --quiet clawdeckx 2>/dev/null; then
        SYSTEMD_SERVICE_INSTALLED=true
        SYSTEMD_SERVICE_TYPE="system"
        return 0
    fi
    
    return 1
}

# Function to install systemd service
install_systemd_service() {
    ensure_user_systemd_env
    echo ""
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  Install Auto-Start Service / 安装自动启动服务${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    
    echo -e "${CYAN}Installing user-level auto-start service... / 正在安装用户级自动启动服务...${NC}"
    echo -e "${YELLOW}Note: Service will start automatically on next system boot"
    echo -e "说明：服务将在下次系统启动时自动运行${NC}"
    echo ""
    
    # Create user systemd directory if it doesn't exist
    mkdir -p "$HOME/.config/systemd/user"
    
    # Create service file
    USER_SERVICE_PATH="$HOME/.config/systemd/user/clawdeckx.service"
    cat > "$USER_SERVICE_PATH" << EOF
[Unit]
Description=ClawDeckX Service
After=network.target

[Service]
Type=simple
ExecStart=$INSTALLED_BINARY --port $PORT
WorkingDirectory=$(pwd)
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF
    
    echo -e "${GREEN}✓ Created service file / 已创建服务文件${NC}"
    
    # Reload daemon and enable service (but don't start)
    # systemctl --user requires a D-Bus session bus which may not exist
    # in non-interactive pipes (curl | bash) or SSH sessions without lingering.
    if systemctl --user daemon-reload 2>/dev/null; then
        systemctl --user enable clawdeckx 2>/dev/null
        echo -e "${GREEN}✓ Auto-start service installed / 自动启动服务已安装${NC}"
        echo -e "${GREEN}✓ Service will start automatically on next system boot / 服务将在下次系统启动时自动运行${NC}"
    else
        echo -e "${YELLOW}⚠ Could not enable service automatically (no D-Bus session bus)."
        echo -e "   无法自动启用服务（没有 D-Bus 会话总线）。${NC}"
        echo -e "${CYAN}After logging in, run these commands to enable the service:"
        echo -e "登录后请运行以下命令启用服务：${NC}"
        echo -e "  ${GREEN}systemctl --user daemon-reload${NC}"
        echo -e "  ${GREEN}systemctl --user enable clawdeckx${NC}"
        # Enable lingering so user services start at boot without login
        echo -e "${CYAN}To start service at boot without login / 无需登录即可在开机时启动服务：${NC}"
        echo -e "  ${GREEN}loginctl enable-linger \$(whoami)${NC}"
    fi
    echo -e "${YELLOW}⚠ Service is NOT started yet / 服务尚未启动${NC}"
}

# Function to stop the service
stop_service() {
    echo ""
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  Stop Service / 停止服务${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    
    if check_systemd_service; then
        echo -e "${CYAN}Stopping $SYSTEMD_SERVICE_TYPE-level service... / 正在停止$SYSTEMD_SERVICE_TYPE 级服务...${NC}"
        
        if [ "$SYSTEMD_SERVICE_TYPE" = "user" ]; then
            systemctl --user stop clawdeckx
            echo -e "${GREEN}✓ Service stopped / 服务已停止${NC}"
        else
            sudo systemctl stop clawdeckx
            echo -e "${GREEN}✓ Service stopped / 服务已停止${NC}"
        fi
        
        echo ""
        echo -e "${CYAN}You can now start ClawDeckX manually with: / 现在可以手动启动 ClawDeckX：${NC}"
        echo -e "  ${GREEN}./$BINARY_NAME${NC}"
    else
        echo -e "${YELLOW}No service found / 未发现服务${NC}"
    fi
}

# ==============================================================================
# Docker Mode Functions
# ==============================================================================

DOCKER_COMPOSE_URL="https://raw.githubusercontent.com/ClawDeckX/ClawDeckX/main/docker-compose.yml"
DOCKER_COMPOSE_URL_CN="https://ghfast.top/https://raw.githubusercontent.com/ClawDeckX/ClawDeckX/main/docker-compose.yml"
DOCKER_IMAGE="knowhunters/clawdeckx:latest"
DOCKER_COMPOSE_FILE="docker-compose-clawdeckx.yml"
NEED_MIRROR=false
DOCKER_MIRROR=""

# Docker registry mirrors for China mainland
# These are well-known, publicly available mirrors
DOCKER_MIRRORS=(
    "https://docker.1ms.run"
    "https://docker.xuanyuan.me"
)

# Cross-platform sed -i (macOS requires '' suffix, Linux does not)
sed_inplace() {
    if [[ "$(uname -s)" == "Darwin" ]]; then
        sed -i '' "$@"
    else
        sed -i "$@"
    fi
}

# Register ClawDeckX binary in PATH via ~/.local/bin symlink (preferred)
# or shell profile export as fallback.
# Usage: register_path <absolute_binary_path>
register_path() {
    local binary_abs="$1"
    # Resolve to absolute path if relative
    if [[ "$binary_abs" != /* ]]; then
        binary_abs="$(cd "$(dirname "$binary_abs")" && pwd)/$(basename "$binary_abs")"
    fi
    local install_dir
    install_dir="$(dirname "$binary_abs")"
    local link_dir="$HOME/.local/bin"

    # Method 1: symlink in ~/.local/bin (XDG standard, cleanest)
    if mkdir -p "$link_dir" 2>/dev/null; then
        ln -sf "$binary_abs" "$link_dir/clawdeckx"
        echo -e "${GREEN}✓ Created symlink: $link_dir/clawdeckx → $binary_abs${NC}"

        # Ensure ~/.local/bin is in PATH for future shells
        if ! echo "$PATH" | tr ':' '\n' | grep -qx "$link_dir"; then
            local profile_file=""
            if [ -f "$HOME/.zshrc" ]; then
                profile_file="$HOME/.zshrc"
            elif [ -f "$HOME/.bashrc" ]; then
                profile_file="$HOME/.bashrc"
            elif [ -f "$HOME/.profile" ]; then
                profile_file="$HOME/.profile"
            fi
            if [ -n "$profile_file" ]; then
                local marker='# ClawDeckX PATH'
                if ! grep -qF "$marker" "$profile_file" 2>/dev/null; then
                    printf '\n%s\nexport PATH="%s:$PATH"\n' "$marker" "$link_dir" >> "$profile_file"
                    echo -e "${GREEN}✓ Added $link_dir to PATH in $(basename "$profile_file")${NC}"
                fi
            fi
            echo -e "${YELLOW}  Run ${GREEN}source ~/${profile_file##*/}${YELLOW} or open a new terminal to use ${GREEN}clawdeckx${YELLOW} globally${NC}"
        else
            echo -e "${GREEN}✓ $link_dir is already in PATH${NC}"
        fi
        return 0
    fi

    # Method 2: direct PATH export in shell profile
    local profile_file=""
    if [ -f "$HOME/.zshrc" ]; then
        profile_file="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then
        profile_file="$HOME/.bashrc"
    elif [ -f "$HOME/.profile" ]; then
        profile_file="$HOME/.profile"
    fi

    if [ -n "$profile_file" ]; then
        local marker='# ClawDeckX PATH'
        if ! grep -qF "$marker" "$profile_file" 2>/dev/null; then
            printf '\n%s\nexport PATH="%s:$PATH"\n' "$marker" "$install_dir" >> "$profile_file"
            echo -e "${GREEN}✓ Added $install_dir to PATH in $(basename "$profile_file")${NC}"
            echo -e "${YELLOW}  Run ${GREEN}source ~/${profile_file##*/}${YELLOW} or open a new terminal to use ${GREEN}clawdeckx${YELLOW} globally${NC}"
        else
            echo -e "${GREEN}✓ PATH entry already exists in $(basename "$profile_file")${NC}"
        fi
        return 0
    fi

    echo -e "${YELLOW}⚠ Could not auto-register PATH. Add manually:${NC}"
    echo -e "  ${GREEN}export PATH=\"$install_dir:\$PATH\"${NC}"
    return 1
}

# Remove ClawDeckX PATH registration (for uninstall)
# Usage: unregister_path
unregister_path() {
    local link_dir="$HOME/.local/bin"

    # Remove symlink
    if [ -L "$link_dir/clawdeckx" ]; then
        rm -f "$link_dir/clawdeckx"
        echo -e "${GREEN}✓ Removed symlink: $link_dir/clawdeckx${NC}"
    fi

    # Remove PATH entries from shell profiles
    local marker='# ClawDeckX PATH'
    for profile_file in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
        if [ -f "$profile_file" ] && grep -qF "$marker" "$profile_file" 2>/dev/null; then
            # Remove the marker line and the export line following it
            sed_inplace "/$marker/,+1d" "$profile_file"
            echo -e "${GREEN}✓ Removed PATH entry from $(basename "$profile_file")${NC}"
        fi
    done
}

# Download a file with China proxy fallback
# Usage: download_with_fallback <url> <cn_url> <output_file>
download_with_fallback() {
    local url="$1" cn_url="$2" output="$3"
    if [ "$NEED_MIRROR" = true ] && [ -n "$cn_url" ]; then
        echo -e "${CYAN}Using China proxy... / 使用中国代理...${NC}"
        if curl -fsSL --connect-timeout 10 --max-time 30 "$cn_url" -o "$output" 2>/dev/null; then
            return 0
        fi
        echo -e "${YELLOW}China proxy failed, trying direct... / 中国代理失败，尝试直连...${NC}"
    fi
    curl -fsSL --connect-timeout 15 --max-time 60 "$url" -o "$output"
}

# Detect if direct access to Docker Hub / international network is blocked
# Returns 0 if mirror is needed (China mainland), 1 if direct access works
detect_network() {
    # Try to reach Docker Hub registry API with a short timeout
    if curl -sf --connect-timeout 3 --max-time 5 "https://registry-1.docker.io/v2/" >/dev/null 2>&1; then
        return 1
    fi
    # Fallback: try Google (common GFW indicator)
    if curl -sf --connect-timeout 3 --max-time 5 "https://www.google.com" >/dev/null 2>&1; then
        return 1
    fi
    # Both blocked — likely behind GFW
    return 0
}

# Configure Docker daemon to use registry mirrors (for China mainland)
configure_docker_mirror() {
    local daemon_json="/etc/docker/daemon.json"

    echo -e "${CYAN}Configuring Docker registry mirrors for faster pulls..."
    echo -e "正在配置 Docker 镜像加速器以加快拉取速度...${NC}"

    # Build mirrors JSON array
    local mirrors_json=""
    for m in "${DOCKER_MIRRORS[@]}"; do
        if [ -n "$mirrors_json" ]; then mirrors_json="$mirrors_json, "; fi
        mirrors_json="$mirrors_json\"$m\""
    done

    sudo mkdir -p /etc/docker

    if [ -f "$daemon_json" ]; then
        # Check if mirrors are already configured
        if grep -q "registry-mirrors" "$daemon_json" 2>/dev/null; then
            echo -e "${YELLOW}Docker mirrors already configured in $daemon_json"
            echo -e "$daemon_json 中已配置镜像加速器${NC}"
            return 0
        fi
        # Merge into existing config: insert "registry-mirrors" before the last }
        # Use a simple sed approach — insert before the closing brace
        local tmp_json
        tmp_json=$(mktemp)
        # Remove trailing } and whitespace, append mirrors, re-close
        sed '$ s/}$//' "$daemon_json" > "$tmp_json"
        echo "  ,\"registry-mirrors\": [$mirrors_json]" >> "$tmp_json"
        echo "}" >> "$tmp_json"
        sudo cp "$tmp_json" "$daemon_json"
        rm -f "$tmp_json"
    else
        # Create new config
        sudo tee "$daemon_json" > /dev/null << EOF
{
  "registry-mirrors": [$mirrors_json]
}
EOF
    fi

    echo -e "${GREEN}✓ Docker registry mirrors configured / Docker 镜像加速器已配置${NC}"
    for m in "${DOCKER_MIRRORS[@]}"; do
        echo -e "  ${CYAN}$m${NC}"
    done

    # Restart Docker to apply mirror config
    if command -v systemctl &>/dev/null && systemctl is-active --quiet docker 2>/dev/null; then
        echo -e "${CYAN}Restarting Docker to apply mirror config... / 正在重启 Docker 以应用镜像加速器...${NC}"
        sudo systemctl restart docker 2>/dev/null || true
        sleep 2
    fi

    return 0
}

# Replace Docker image with mirrored version in docker-compose.yml
apply_image_mirror() {
    local compose_file="$1"
    if [ "$NEED_MIRROR" != true ] || [ -z "$DOCKER_MIRROR" ]; then
        return
    fi
    # The mirror prefix replaces the default Docker Hub pull path
    # e.g., knowhunters/clawdeckx:latest → docker.1ms.run/knowhunters/clawdeckx:latest
    local mirror_host
    mirror_host=$(echo "$DOCKER_MIRROR" | sed 's|https\?://||')
    local original_image="knowhunters/clawdeckx"
    local mirrored_image="${mirror_host}/${original_image}"
    if grep -q "$mirrored_image" "$compose_file" 2>/dev/null; then
        return  # Already mirrored
    fi
    sed_inplace "s|image: ${original_image}|image: ${mirrored_image}|" "$compose_file"
    echo -e "${GREEN}✓ Using mirror for image pull / 使用镜像加速拉取：${NC} $mirrored_image"
}

# Revert mirrored image back to original in docker-compose.yml
revert_image_mirror() {
    local compose_file="$1"
    if [ -z "$DOCKER_MIRROR" ]; then return; fi
    local mirror_host
    mirror_host=$(echo "$DOCKER_MIRROR" | sed 's|https\?://||')
    local original_image="knowhunters/clawdeckx"
    local mirrored_image="${mirror_host}/${original_image}"
    if grep -q "$mirrored_image" "$compose_file" 2>/dev/null; then
        sed_inplace "s|image: ${mirrored_image}|image: ${original_image}|" "$compose_file"
    fi
}

# Check if running inside a Docker container
is_inside_docker() {
    [ -f /.dockerenv ] || grep -qE '/(docker|lxc|containerd)/' /proc/1/cgroup 2>/dev/null
}

# Check if Docker is installed and usable
# Pass "verbose" as $1 to enable output and auto-start attempt
check_docker() {
    local verbose="${1:-}"
    if ! command -v docker &>/dev/null; then
        return 1
    fi
    # Verify daemon is running
    if ! docker info &>/dev/null; then
        if [ "$verbose" = "verbose" ]; then
            echo -e "${YELLOW}⚠ Docker is installed but the daemon is not running."
            echo -e "  Docker 已安装但守护进程未运行。${NC}"
            if command -v systemctl &>/dev/null; then
                echo -e "${CYAN}Attempting to start Docker... / 正在尝试启动 Docker...${NC}"
                sudo systemctl start docker 2>/dev/null
                sleep 2
                if docker info &>/dev/null; then
                    echo -e "${GREEN}✓ Docker started / Docker 已启动${NC}"
                    return 0
                fi
            fi
            echo -e "${YELLOW}Please start Docker manually: sudo systemctl start docker${NC}"
        fi
        return 2
    fi
    return 0
}

# Check if docker compose (plugin or standalone) is available
check_docker_compose() {
    if docker compose version &>/dev/null; then
        COMPOSE_CMD="docker compose"
        return 0
    elif command -v docker-compose &>/dev/null; then
        COMPOSE_CMD="docker-compose"
        return 0
    fi
    return 1
}

# Install Docker Engine (Linux only)
install_docker_engine() {
    echo ""
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  Install Docker / 安装 Docker${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo ""

    echo -e "${CYAN}Docker is not installed. Installing via official script..."
    echo -e "未检测到 Docker，正在通过官方脚本安装...${NC}"
    echo ""

    local install_ok=false
    if [ "$NEED_MIRROR" = true ]; then
        echo -e "${CYAN}Using Aliyun mirror for Docker installation..."
        echo -e "使用阿里云镜像安装 Docker...${NC}"
        if curl -fsSL https://get.docker.com | sh -s -- --mirror Aliyun; then
            install_ok=true
        fi
    fi

    if [ "$install_ok" = false ]; then
        if ! curl -fsSL https://get.docker.com | sh; then
            echo -e "${RED}✗ Docker installation failed / Docker 安装失败${NC}"
            echo -e "${YELLOW}Please install Docker manually: https://docs.docker.com/engine/install/${NC}"
            return 1
        fi
    fi

    echo -e "${GREEN}✓ Docker installed successfully / Docker 安装成功${NC}"

    # Start and enable Docker service
    echo -e "${CYAN}Starting Docker service... / 正在启动 Docker 服务...${NC}"
    if command -v systemctl &>/dev/null; then
        sudo systemctl start docker 2>/dev/null || true
        sudo systemctl enable docker 2>/dev/null || true
    fi

    # Add current user to docker group (avoid needing sudo for docker commands)
    local current_user
    current_user=$(whoami)
    if [ "$current_user" != "root" ]; then
        echo -e "${CYAN}Adding user '$current_user' to docker group..."
        echo -e "正在将用户 '$current_user' 添加到 docker 组...${NC}"
        sudo usermod -aG docker "$current_user" 2>/dev/null || true

        # Apply docker group in current session so subsequent docker commands work
        # without requiring the user to log out and back in
        if ! docker info &>/dev/null 2>&1; then
            echo -e "${CYAN}Activating docker group for current session..."
            echo -e "正在为当前会话激活 docker 组...${NC}"
            sg docker -c "true" 2>/dev/null || true
        fi

        # If docker still doesn't work without sudo, fall back to sudo for this session
        if ! docker info &>/dev/null 2>&1; then
            echo -e "${YELLOW}⚠ Docker group not yet effective in this session."
            echo -e "  Will use sudo for docker commands in this session."
            echo -e "  Docker 组在当前会话未生效，本次将使用 sudo 执行 docker 命令。"
            echo -e "  Please log out and back in for future sessions."
            echo -e "  请重新登录以在后续会话中生效。${NC}"
        fi
    fi

    return 0
}

# Prompt user for a new Docker instance name, then call docker_install
docker_install_new() {
    # Auto-detect next available instance name
    local default_name="clawdeckx"
    if [ -f "docker-compose-clawdeckx.yml" ] || { [ -f "docker-compose.yml" ] && grep -q "knowhunters/clawdeckx" "docker-compose.yml" 2>/dev/null; }; then
        # Default instance exists, find next available number
        local n=2
        while [ -f "docker-compose-clawdeckx-${n}.yml" ]; do
            n=$((n + 1))
        done
        default_name="clawdeckx-${n}"
    fi

    echo ""
    echo -e "${CYAN}Each Docker deployment needs a unique instance name."
    echo -e "每个 Docker 部署需要一个唯一的实例名称。${NC}"
    echo ""
    echo -e "Suggested instance name: ${GREEN}${default_name}${NC}"
    echo -e "Examples: clawdeckx-2, clawdeckx-dev, clawdeckx-test"
    echo ""
    if [ -n "$CLI_INSTANCE_NAME" ]; then
        INSTANCE_NAME="$CLI_INSTANCE_NAME"
    else
        prompt_with_default INSTANCE_NAME "Enter instance name (or press Enter for '${default_name}') / 输入实例名称（回车使用 '${default_name}'）: " "$default_name"
    fi
    # Sanitize: lowercase, replace spaces with hyphens, remove invalid chars
    INSTANCE_NAME=$(echo "$INSTANCE_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9_-]//g')
    if [ -z "$INSTANCE_NAME" ]; then
        INSTANCE_NAME="$default_name"
    fi

    # Check if this instance name is already in use
    local check_file="docker-compose-clawdeckx.yml"
    if [ "$INSTANCE_NAME" != "clawdeckx" ]; then
        check_file="docker-compose-${INSTANCE_NAME}.yml"
    fi
    if [ -f "$check_file" ]; then
     echo -e "${YELLOW}⚠ Instance '$INSTANCE_NAME' already exists ($check_file)."
     echo -e "  实例 '$INSTANCE_NAME' 已存在 ($check_file)${NC}"
     if ! confirm_default_no "Continue anyway? (will overwrite) / 继续？（将覆盖） [y/N] "; then
         return 1
     fi
 fi

 docker_install "$INSTANCE_NAME"
}

# Install ClawDeckX via Docker
# Usage: docker_install [instance_name]
#   instance_name: unique name for this Docker deployment (default: clawdeckx)
#   When not "clawdeckx", compose file is saved as docker-compose-{name}.yml
#   with unique container name and volume names for isolation.
docker_install() {
    local instance_name="${1:-clawdeckx}"
    local compose_file="docker-compose-clawdeckx.yml"
    # Backward compat: if old docker-compose.yml has our image, use it
    if [ "$instance_name" = "clawdeckx" ] && [ ! -f "docker-compose-clawdeckx.yml" ] && [ -f "docker-compose.yml" ] && grep -q "knowhunters/clawdeckx" "docker-compose.yml" 2>/dev/null; then
        compose_file="docker-compose.yml"
    elif [ "$instance_name" != "clawdeckx" ]; then
        compose_file="docker-compose-${instance_name}.yml"
    fi

    echo ""
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  Install ClawDeckX (Docker) / 安装 ClawDeckX (Docker)${NC}"
    if [ "$instance_name" != "clawdeckx" ]; then
        echo -e "${YELLOW}  Instance / 实例: ${instance_name}${NC}"
    fi
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo ""

    # Step 0: Detect network early (needed for Docker install mirror + image pull mirror)
    echo -e "${CYAN}Checking network connectivity... / 正在检测网络连通性...${NC}"
    if detect_network; then
        NEED_MIRROR=true
        DOCKER_MIRROR="${DOCKER_MIRRORS[0]}"
        echo ""
        echo -e "${YELLOW}┌─────────────────────────────────────────────────────────┐${NC}"
        echo -e "${YELLOW}│  ⚠  ACCELERATED DOWNLOAD MODE / 加速下载模式已启用      │${NC}"
        echo -e "${YELLOW}├─────────────────────────────────────────────────────────┤${NC}"
        echo -e "${YELLOW}│  Docker Hub unreachable — using mirror proxies.         │${NC}"
        echo -e "${YELLOW}│  Docker Hub 不可访问 — 已启用镜像加速代理。             │${NC}"
        echo -e "${YELLOW}│                                                         │${NC}"
        echo -e "${YELLOW}│  Mirror / 镜像站: ${CYAN}${DOCKER_MIRROR}${YELLOW}              │${NC}"
        echo -e "${YELLOW}│  GitHub Proxy / 代理: ${CYAN}ghfast.top${YELLOW}                       │${NC}"
        echo -e "${YELLOW}│                                                         │${NC}"
        echo -e "${YELLOW}│  If download fails, the mirror site may be down.        │${NC}"
        echo -e "${YELLOW}│  若下载失败，可能是加速站点不可用，请检查网络或换源。   │${NC}"
        echo -e "${YELLOW}└─────────────────────────────────────────────────────────┘${NC}"
    else
        echo -e "${GREEN}✓ Direct network access OK / 网络直连正常${NC}"
    fi
    echo ""

    # Step 1: Ensure Docker is installed
    if ! check_docker verbose; then
        if ! confirm_default_yes "Docker is not installed. Install Docker now? / Docker 未安装，现在安装？ [Y/n] "; then
            echo -e "${YELLOW}Cannot proceed without Docker. / 没有 Docker 无法继续。${NC}"
            exit 1
        fi
        if ! install_docker_engine; then
            exit 1
        fi
        echo ""
    fi

    # Step 2: Ensure docker compose is available
    if ! check_docker_compose; then
        echo -e "${RED}✗ docker compose not found / 未找到 docker compose${NC}"
        echo -e "${YELLOW}Please install Docker Compose plugin: https://docs.docker.com/compose/install/${NC}"
        exit 1
    fi

    echo -e "${GREEN}✓ Docker is ready / Docker 已就绪${NC}"
    echo -e "${GREEN}✓ Compose: $COMPOSE_CMD${NC}"
    echo ""

    # Step 2.5: Configure Docker daemon mirrors if needed (requires Docker to be installed)
    if [ "$NEED_MIRROR" = true ]; then
        configure_docker_mirror
        echo ""
    fi

    # Step 3: Download docker-compose file
    echo -e "${CYAN}Downloading ${compose_file}... / 正在下载 ${compose_file}...${NC}"
    download_with_fallback "$DOCKER_COMPOSE_URL" "$DOCKER_COMPOSE_URL_CN" "$compose_file"
    echo -e "${GREEN}✓ Downloaded / 已下载${NC}"

    # Step 3.5: Customize compose file for non-default instance (unique names for isolation)
    if [ "$instance_name" != "clawdeckx" ]; then
        echo -e "${CYAN}Customizing for instance '$instance_name'... / 正在为实例 '$instance_name' 定制配置...${NC}"
        sed_inplace "s/container_name: clawdeckx/container_name: ${instance_name}/" "$compose_file"
        sed_inplace "s/name: clawdeckx-data/name: ${instance_name}-data/" "$compose_file"
        sed_inplace "s/name: openclaw-data/name: ${instance_name}-openclaw-data/" "$compose_file"
        sed_inplace "s/name: clawdeckx-runtime/name: ${instance_name}-runtime/" "$compose_file"
        sed_inplace "s/name: clawdeckx-net/name: ${instance_name}-net/" "$compose_file"
        echo -e "${GREEN}✓ Configured for instance: $instance_name${NC}"
    fi

    # Step 4: Smart port configuration — auto-detect available host port
    # Docker maps HOST_PORT → INTERNAL_PORT (18788). Host port starts from DEFAULT_HOST_PORT (18700).
    # Collect ports already assigned by other Docker instances
    echo ""
    echo -e "${CYAN}Detecting available port... / 正在检测可用端口...${NC}"
    local start_port=$DEFAULT_HOST_PORT
    local assigned_ports=()
    for _cf in docker-compose-clawdeckx.yml docker-compose.yml docker-compose-*.yml; do
        [ -f "$_cf" ] || continue
        [ "$_cf" = "$compose_file" ] && continue  # Skip our own file
        local _ap
        _ap=$(grep -oE '"[0-9]+:18788"' "$_cf" 2>/dev/null | head -1 | grep -oE '^"[0-9]+' | tr -d '"')
        [ -n "$_ap" ] && assigned_ports+=("$_ap")
    done
    # Find a port that is both unoccupied AND not assigned to another instance
    find_available_port $start_port
    local auto_port=$FOUND_PORT
    # If found port is assigned to another instance (stopped), bump and retry
    for _used in "${assigned_ports[@]}"; do
        while [ "$auto_port" = "$_used" ]; do
            find_available_port $((auto_port + 1))
            auto_port=$FOUND_PORT
        done
    done

    if [ "$auto_port" -ne "$DEFAULT_HOST_PORT" ]; then
        echo -e "${YELLOW}Default port $DEFAULT_HOST_PORT is occupied, auto-selected: $auto_port"
        echo -e "默认端口 $DEFAULT_HOST_PORT 已被占用，自动选择：$auto_port${NC}"
    else
        echo -e "${GREEN}✓ Port $auto_port is available / 端口 $auto_port 可用${NC}"
    fi

    if validate_port "$CLI_PORT"; then
        auto_port="$CLI_PORT"
    elif ! confirm_default_yes "Use port $auto_port? / 使用端口 $auto_port？ [Y/n] "; then
        prompt_with_default CUSTOM_PORT "Enter port / 输入端口: " "$auto_port"
        if validate_port "$CUSTOM_PORT"; then
            auto_port=$CUSTOM_PORT
        else
            echo -e "${YELLOW}Invalid port, using $auto_port / 端口无效，使用 $auto_port${NC}"
        fi
    fi

    PORT=$auto_port
    # Replace host port in compose file; internal port stays at INTERNAL_PORT
    sed_inplace "s/\"${DEFAULT_HOST_PORT}:${INTERNAL_PORT}\"/\"${PORT}:${INTERNAL_PORT}\"/" "$compose_file"
    # Inject OCD_HOST_PORT so the container banner shows the correct external URL
    if grep -q "OCD_HOST_PORT" "$compose_file" 2>/dev/null; then
        sed_inplace "s/OCD_HOST_PORT: .*/OCD_HOST_PORT: \"${PORT}\"/" "$compose_file"
    else
        sed_inplace "/OCD_OPENCLAW_GATEWAY_PORT:/a\\      OCD_HOST_PORT: \"${PORT}\"" "$compose_file"
    fi
    echo -e "${GREEN}✓ Port set to $PORT / 端口已设置为 $PORT${NC}"

    # Step 5: Apply image mirror if needed, then pull and start
    apply_image_mirror "$compose_file"

    local compose_run="$COMPOSE_CMD -f $compose_file -p $instance_name"

    echo ""
    echo -e "${BLUE}Pulling Docker image... / 正在拉取 Docker 镜像...${NC}"
    if ! $compose_run pull; then
        if [ "$NEED_MIRROR" = true ]; then
            echo ""
            echo -e "${YELLOW}⚠ Mirror pull failed, reverting to direct pull..."
            echo -e "  镜像加速拉取失败，回退为直连拉取...${NC}"
            revert_image_mirror "$compose_file"
            $compose_run pull
        else
            echo -e "${RED}Docker pull failed / Docker 拉取失败${NC}"
            return 1
        fi
    fi

    echo ""
    echo -e "${BLUE}Starting ClawDeckX container... / 正在启动 ClawDeckX 容器...${NC}"
    $compose_run up -d

    # Step 6: Wait for health check
    # The entrypoint waits up to 120s for the gateway on first boot, then starts
    # ClawDeckX. We need to wait longer than 120s to allow the full startup chain.
    echo ""
    echo -e "${CYAN}Waiting for ClawDeckX to become ready (first boot may take ~2 min)...${NC}"
    echo -e "${CYAN}等待 ClawDeckX 就绪（首次启动可能需要约 2 分钟）...${NC}"
    local max_wait=150
    local waited=0
    while [ $waited -lt $max_wait ]; do
        if curl -sf "http://localhost:${PORT}/api/v1/health" >/dev/null 2>&1; then
            break
        fi
        sleep 2
        waited=$((waited + 2))
        if [ $((waited % 10)) -eq 0 ]; then
            printf "\r  ${waited}s / ${max_wait}s ..."
        fi
    done
    printf "\r                          \r"

    if [ $waited -ge $max_wait ]; then
        echo -e "${YELLOW}⚠ ClawDeckX is still starting. Check status with:"
        echo -e "  ClawDeckX 仍在启动中，请用以下命令检查状态：${NC}"
        echo -e "  ${GREEN}$compose_run ps${NC}"
        echo -e "  ${GREEN}$compose_run logs --tail 30${NC}"
    else
        echo -e "${GREEN}✓ ClawDeckX is ready! / ClawDeckX 已就绪！${NC}"
    fi

    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✅ Docker installation complete! / Docker 安装完成！${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    print_access_urls "$PORT"
    echo ""
    # Resolve actual volume names from compose file (handles custom instance renaming)
    local vol_data vol_openclaw vol_runtime
    vol_data=$(grep -A1 'clawdeckx-data:' "$compose_file" 2>/dev/null | grep 'name:' | awk '{print $2}' || echo "${instance_name}-data")
    vol_openclaw=$(grep -A1 'clawdeckx-openclaw-data:' "$compose_file" 2>/dev/null | grep 'name:' | awk '{print $2}' || echo "${instance_name}-openclaw-data")
    vol_runtime=$(grep -A1 'clawdeckx-runtime:' "$compose_file" 2>/dev/null | grep 'name:' | awk '{print $2}' || echo "${instance_name}-runtime")
    local vol_base="/var/lib/docker/volumes"
    echo -e "${CYAN}📂 Data volumes (host path) / 数据卷（宿主机路径）：${NC}"
    echo -e "  ClawDeckX:  ${GREEN}${vol_base}/${vol_data}/_data${NC}"
    echo -e "  OpenClaw:   ${GREEN}${vol_base}/${vol_openclaw}/_data${NC}"
    echo -e "  Runtime:    ${GREEN}${vol_base}/${vol_runtime}/_data${NC}"
    echo ""
    echo -e "${YELLOW}🔐 First-time login / 首次登录：${NC}"
    echo -e "  View initial admin credentials in container logs below:"
    echo -e "  初始管理员账户信息见下方容器日志："
    echo ""
    echo "────────────────────────────────────────"
    $compose_run logs --tail 50
    echo "────────────────────────────────────────"
    echo ""
    echo -e "${YELLOW}Docker management commands / Docker 管理命令：${NC}"
    echo -e "  ${GREEN}$compose_run ps${NC}              - Status / 状态"
    echo -e "  ${GREEN}$compose_run logs --tail 50${NC}  - Logs / 日志"
    echo -e "  ${GREEN}$compose_run restart${NC}         - Restart / 重启"
    echo -e "  ${GREEN}$compose_run stop${NC}            - Stop / 停止"
    echo -e "  ${GREEN}$compose_run down${NC}            - Remove container / 删除容器"
    echo ""
    exit 0
}

# Update ClawDeckX Docker deployment
# Usage: docker_update <compose_file> <instance_name>
docker_update() {
    local compose_file="${1:-$DOCKER_COMPOSE_FILE}"
    local instance_name="${2:-clawdeckx}"
    local compose_run="$COMPOSE_CMD -f $compose_file -p $instance_name"

    echo ""
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  Update ClawDeckX (Docker) / 更新 ClawDeckX (Docker)${NC}"
    if [ "$instance_name" != "clawdeckx" ]; then
        echo -e "${YELLOW}  Instance / 实例: ${instance_name}${NC}"
    fi
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo ""

    # Extract container name and port from compose file
    local container_name
    container_name=$(grep -oP 'container_name:\s*\K\S+' "$compose_file" 2>/dev/null | head -1 || true)
    container_name="${container_name:-$instance_name}"

    local compose_port
    compose_port=$(grep -oE '"[0-9]+:18788"' "$compose_file" 2>/dev/null | head -1 | grep -oE '^"[0-9]+' | tr -d '"' || true)
    if [ -n "$compose_port" ]; then
        PORT=$compose_port
    fi

    local current_ver
    current_ver=$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$container_name" 2>/dev/null || echo "unknown")
    [ "$current_ver" = "<no value>" ] && current_ver="unknown"
    echo -e "${CYAN}Current image version / 当前镜像版本：${NC} $current_ver"
    echo -e "${CYAN}Will pull / 将拉取：${NC} $DOCKER_IMAGE"
    echo ""

    if ! confirm_default_yes "Proceed with update? / 确认更新？ [Y/n] "; then
        echo -e "${YELLOW}Update cancelled / 更新已取消${NC}"
        return
    fi

    # Detect network and configure mirrors if needed
    echo ""
    echo -e "${CYAN}Checking network connectivity... / 正在检测网络连通性...${NC}"
    if detect_network; then
        NEED_MIRROR=true
        DOCKER_MIRROR="${DOCKER_MIRRORS[0]}"
        echo ""
        echo -e "${YELLOW}┌─────────────────────────────────────────────────────────┐${NC}"
        echo -e "${YELLOW}│  ⚠  ACCELERATED DOWNLOAD MODE / 加速下载模式已启用      │${NC}"
        echo -e "${YELLOW}├─────────────────────────────────────────────────────────┤${NC}"
        echo -e "${YELLOW}│  Mirror / 镜像站: ${CYAN}${DOCKER_MIRROR}${YELLOW}              │${NC}"
        echo -e "${YELLOW}│  If download fails, the mirror site may be down.        │${NC}"
        echo -e "${YELLOW}│  若下载失败，可能是加速站点不可用，请检查网络或换源。   │${NC}"
        echo -e "${YELLOW}└─────────────────────────────────────────────────────────┘${NC}"
        configure_docker_mirror
        apply_image_mirror "$compose_file"
    else
        echo -e "${GREEN}✓ Direct network access OK / 网络直连正常${NC}"
    fi

    echo ""
    echo -e "${BLUE}Pulling latest image... / 正在拉取最新镜像...${NC}"
    if ! $compose_run pull; then
        if [ "$NEED_MIRROR" = true ]; then
            echo ""
            echo -e "${YELLOW}⚠ Mirror pull failed, reverting to direct pull..."
            echo -e "  镜像加速拉取失败，回退为直连拉取...${NC}"
            revert_image_mirror "$compose_file"
            $compose_run pull
        else
            echo -e "${RED}Docker pull failed / Docker 拉取失败${NC}"
            return 1
        fi
    fi

    echo ""
    echo -e "${BLUE}Recreating container with new image... / 正在用新镜像重建容器...${NC}"
    $compose_run up -d

    # Wait for health check
    echo ""
    echo -e "${CYAN}Waiting for ClawDeckX to become ready... / 等待 ClawDeckX 就绪...${NC}"
    local max_wait=150
    local waited=0
    while [ $waited -lt $max_wait ]; do
        if curl -sf "http://localhost:${PORT}/api/v1/health" >/dev/null 2>&1; then
            break
        fi
        sleep 2
        waited=$((waited + 2))
        if [ $((waited % 10)) -eq 0 ]; then
            printf "\r  ${waited}s / ${max_wait}s ..."
        fi
    done
    printf "\r                          \r"

    local new_ver
    new_ver=$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$container_name" 2>/dev/null || echo "unknown")
    [ "$new_ver" = "<no value>" ] && new_ver="unknown"

    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✅ Docker update complete! / Docker 更新完成！${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${CYAN}Previous version / 旧版本：${NC} $current_ver"
    echo -e "${CYAN}Current version  / 新版本：${NC} $new_ver"
    print_access_urls "$PORT"
    echo ""
}

# Uninstall ClawDeckX Docker deployment
# Usage: docker_uninstall <compose_file> <instance_name>
docker_uninstall() {
    local compose_file="${1:-$DOCKER_COMPOSE_FILE}"
    local instance_name="${2:-clawdeckx}"
    local compose_run="$COMPOSE_CMD -f $compose_file -p $instance_name"

    echo ""
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  Uninstall ClawDeckX (Docker: ${instance_name}) / 卸载 ClawDeckX (Docker: ${instance_name})${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo ""

    echo -e "${CYAN}This will: / 将执行：${NC}"
    echo "  - Stop and remove the ClawDeckX container / 停止并删除 ClawDeckX 容器"
    echo ""

    # Ask about volumes
    local remove_volumes=false
    echo -n "Also remove data volumes? (config, database, logs) / 同时删除数据卷？（配置、数据库、日志）[y/N] "
    read -n 1 -r </dev/tty
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        remove_volumes=true
        echo -e "  ${RED}- Data volumes will be removed / 数据卷将被删除${NC}"
    fi

    # Ask about image
    local remove_image=false
    echo -n "Also remove Docker image? / 同时删除 Docker 镜像？ [y/N] "
    read -n 1 -r </dev/tty
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        remove_image=true
        echo -e "  ${RED}- Docker image will be removed / Docker 镜像将被删除${NC}"
    fi

    # Ask about compose file
    local remove_compose=false
    echo -n "Also remove $compose_file? / 同时删除 $compose_file？ [y/N] "
    read -n 1 -r </dev/tty
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        remove_compose=true
        echo -e "  ${RED}- $compose_file will be removed / $compose_file 将被删除${NC}"
    fi

    echo ""
    echo -n -e "${RED}Confirm uninstall? / 确认卸载？ [y/N] ${NC}"
    read -n 1 -r </dev/tty
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Uninstall cancelled / 卸载已取消${NC}"
        return
    fi

    echo ""
    echo -e "${BLUE}Stopping and removing container... / 正在停止并删除容器...${NC}"
    if [ "$remove_volumes" = true ]; then
        $compose_run down -v
        echo -e "${GREEN}✓ Container and volumes removed / 容器和数据卷已删除${NC}"
    else
        $compose_run down
        echo -e "${GREEN}✓ Container removed (volumes preserved) / 容器已删除（数据卷已保留）${NC}"
    fi

    if [ "$remove_image" = true ]; then
        echo -e "${BLUE}Removing Docker image... / 正在删除 Docker 镜像...${NC}"
        # Remove both original and any mirrored image names
        docker rmi "$DOCKER_IMAGE" 2>/dev/null || true
        # Also try to remove mirrored variants
        for m in "${DOCKER_MIRRORS[@]}"; do
            local mhost
            mhost=$(echo "$m" | sed 's|https\?://||')
            docker rmi "${mhost}/knowhunters/clawdeckx:latest" 2>/dev/null || true
        done
        echo -e "${GREEN}✓ Image removed / 镜像已删除${NC}"
    fi

    if [ "$remove_compose" = true ]; then
        rm -f "$compose_file"
        echo -e "${GREEN}✓ $compose_file removed / $compose_file 已删除${NC}"
    fi

    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✅ Docker uninstall complete! / Docker 卸载完成！${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    exit 0
}

# Show Docker management menu for existing Docker deployment
# Usage: docker_management_menu <compose_file> <instance_name>
docker_management_menu() {
    local compose_file="${1:-$DOCKER_COMPOSE_FILE}"
    local instance_name="${2:-clawdeckx}"
    local compose_run="$COMPOSE_CMD -f $compose_file -p $instance_name"

    check_docker_compose || return 1

    # Extract container name from compose file
    local container_name
    container_name=$(grep -oP 'container_name:\s*\K\S+' "$compose_file" 2>/dev/null | head -1 || true)
    container_name="${container_name:-$instance_name}"

    local docker_ver
    docker_ver=$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$container_name" 2>/dev/null || echo "unknown")
    [ "$docker_ver" = "<no value>" ] && docker_ver="unknown"

    local is_running=false
    if docker ps --filter "name=^${container_name}$" --filter "status=running" --format '{{.Names}}' 2>/dev/null | grep -q .; then
        is_running=true
    fi

    # Read port from compose file
    local compose_port
    compose_port=$(grep -oE '"[0-9]+:18788"' "$compose_file" 2>/dev/null | head -1 | grep -oE '^"[0-9]+' | tr -d '"')
    if [ -n "$compose_port" ]; then
        PORT=$compose_port
    fi

    echo -e "${GREEN}✓ Docker deployment: ${instance_name}${NC}"
    echo -e "${CYAN}Compose file / 配置文件：${NC} $compose_file"
    echo -e "${CYAN}Image version / 镜像版本：${NC} $docker_ver"
    echo -e "${CYAN}Port / 端口：${NC} $PORT"
    if [ "$is_running" = true ]; then
        echo -e "${CYAN}Status / 状态：${NC} ${GREEN}Running / 运行中${NC}"
    else
        echo -e "${CYAN}Status / 状态：${NC} ${YELLOW}Stopped / 已停止${NC}"
    fi
    echo ""

    echo -e "${YELLOW}What would you like to do? / 您想做什么？${NC}"
    echo "  1) Update / 更新"
    if [ "$is_running" = true ]; then
        echo "  2) Stop / 停止"
    else
        echo "  2) Start / 启动"
    fi
    echo "  3) Restart / 重启"
    echo "  4) Logs / 查看日志"
    echo "  5) Status / 查看状态"
    echo "  6) Uninstall / 卸载"
    echo "  7) Back / 返回"
    echo ""
    echo -n "Enter your choice [1-7] / 输入选择 [1-7]: "
    read -n 1 -r CHOICE </dev/tty
    echo

    case $CHOICE in
        1)
            docker_update "$compose_file" "$instance_name"
            ;;
        2)
            if [ "$is_running" = true ]; then
                echo ""
                echo -e "${BLUE}Stopping ClawDeckX container... / 正在停止 ClawDeckX 容器...${NC}"
                $compose_run stop
                echo -e "${GREEN}✓ Stopped / 已停止${NC}"
            else
                echo ""
                echo -e "${BLUE}Starting ClawDeckX container... / 正在启动 ClawDeckX 容器...${NC}"
                $compose_run up -d
                sleep 2
                echo -e "${GREEN}✓ Started / 已启动${NC}"
                print_access_urls "$PORT"
            fi
            ;;
        3)
            echo ""
            echo -e "${BLUE}Restarting ClawDeckX container... / 正在重启 ClawDeckX 容器...${NC}"
            $compose_run restart
            echo -e "${GREEN}✓ Restarted / 已重启${NC}"
            ;;
        4)
            echo ""
            echo -e "${CYAN}Recent logs / 最近日志：${NC}"
            echo "────────────────────────────────────────"
            $compose_run logs --tail 50
            echo "────────────────────────────────────────"
            ;;
        5)
            echo ""
            $compose_run ps
            echo ""
            if docker ps --filter "name=^${container_name}$" --filter "status=running" --format '{{.Names}}' 2>/dev/null | grep -q .; then
                echo -e "${GREEN}✓ ClawDeckX is running / ClawDeckX 运行中${NC}"
                print_access_urls "$PORT"
            else
                echo -e "${YELLOW}ClawDeckX is not running / ClawDeckX 未运行${NC}"
            fi
            ;;
        6)
            docker_uninstall "$compose_file" "$instance_name"
            ;;
        7)
            exec bash "$SELF_SCRIPT" "$@"
            ;;
        *)
            echo -e "${RED}Invalid choice / 选择无效${NC}"
            ;;
    esac
    exit 0
}

echo -e "${BLUE}"
cat << 'LOGO'
  ___ _             ___          _  __  __
 / __| |__ ___ __ _|   \ ___ __| |/ / \ \/ /
| (__| / _` \ V  V / |) / -_) _| ' <   >  <
 \___|_\__,_|\_/\_/|___/\___|__|_|\_\/_/\_\
LOGO
echo -e "${NC}"

# 获取最新版本号
REPO="ClawDeckX/ClawDeckX"
API_URL="https://api.github.com/repos/$REPO/releases/latest"

# Primary: get version via 302 redirect (no API quota cost)
LATEST_VERSION_RAW=$(curl -sI "https://github.com/$REPO/releases/latest" 2>/dev/null \
    | grep -i '^location:' | sed 's/.*\/tag\///' | tr -d '\r\n')

# Fallback: use API if redirect method failed
if [ -z "$LATEST_VERSION_RAW" ]; then
    API_RESPONSE=$(curl -s "$API_URL")
    LATEST_VERSION_RAW=$(echo "$API_RESPONSE" | grep '"tag_name"' | cut -d '"' -f 4)
    # Check for API rate limit
    if [ -z "$LATEST_VERSION_RAW" ]; then
        if echo "$API_RESPONSE" | grep -q "rate limit"; then
            echo -e "${RED}GitHub API rate limit exceeded / GitHub API 请求频率超限${NC}"
            echo -e "${YELLOW}Will attempt direct download... / 将尝试直接下载...${NC}"
        fi
        LATEST_VERSION_RAW="latest"
    fi
fi
# Remove 'v' prefix for display and comparison
LATEST_VERSION="${LATEST_VERSION_RAW#v}"

echo -e "${CYAN}:: ClawDeckX Launcher - ${LATEST_VERSION} ::${NC}"
echo ""

# Detect all existing installations simultaneously
HAS_BINARY=false
IS_CONTAINER=false

# Docker: detect all instances (docker-compose.yml + docker-compose-*.yml)
DOCKER_INSTANCES=()       # Array of compose files
DOCKER_INSTANCE_NAMES=()  # Array of instance names
DOCKER_INSTANCE_PORTS=()  # Array of ports
DOCKER_INSTANCE_VERS=()   # Array of versions
DOCKER_INSTANCE_RUNNING=() # Array of running status (true/false)

if is_inside_docker; then
    IS_CONTAINER=true
fi

if [ "$IS_CONTAINER" = false ] && check_docker && check_docker_compose; then
    # Scan for all compose files that reference our image
    for cf in docker-compose-clawdeckx.yml docker-compose.yml docker-compose-*.yml; do
        [ -f "$cf" ] || continue
        if grep -q "knowhunters/clawdeckx" "$cf" 2>/dev/null; then
            # Skip duplicates (glob may re-match explicit entries)
            _dup=false
            for _ei in "${DOCKER_INSTANCES[@]}"; do [ "$_ei" = "$cf" ] && _dup=true; done
            [ "$_dup" = true ] && continue
            DOCKER_INSTANCES+=("$cf")
            # Extract instance name from filename
            if [ "$cf" = "docker-compose-clawdeckx.yml" ] || [ "$cf" = "docker-compose.yml" ]; then
                DOCKER_INSTANCE_NAMES+=("clawdeckx")
            else
                local_name="${cf#docker-compose-}"
                local_name="${local_name%.yml}"
                DOCKER_INSTANCE_NAMES+=("$local_name")
            fi
            # Extract port
            local_port=$(grep -oE '"[0-9]+:18788"' "$cf" 2>/dev/null | head -1 | grep -oE '^"[0-9]+' | tr -d '"')
            DOCKER_INSTANCE_PORTS+=("${local_port:-$DEFAULT_PORT}")
            # Extract container name for version/status check
            local_container=$(grep -oP 'container_name:\s*\K\S+' "$cf" 2>/dev/null | head -1 || true)
            local_container="${local_container:-clawdeckx}"
            # Version
            local_ver=$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$local_container" 2>/dev/null || echo "unknown")
            [ "$local_ver" = "<no value>" ] && local_ver="unknown"
            DOCKER_INSTANCE_VERS+=("$local_ver")
            # Running status
            local_running=$(docker ps --filter "name=^${local_container}$" --filter "status=running" --format '{{.Names}}' 2>/dev/null)
            if [ -n "$local_running" ]; then
                DOCKER_INSTANCE_RUNNING+=("true")
            else
                DOCKER_INSTANCE_RUNNING+=("false")
            fi
        fi
    done
fi

HAS_DOCKER=false
if [ ${#DOCKER_INSTANCES[@]} -gt 0 ]; then
    HAS_DOCKER=true
fi

if check_installed; then
    HAS_BINARY=true
    get_config_port
fi

# Function to uninstall ClawDeckX
uninstall() {
    echo ""
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  Uninstall ClawDeckX / 卸载 ClawDeckX${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    
    if [ -n "$INSTALLED_LOCATION" ]; then
        echo -e "${CYAN}Found installation / 发现安装：${NC} $INSTALLED_LOCATION"
        echo -e "${CYAN}Current version / 当前版本：${NC} $CURRENT_VERSION"
        echo ""
        
        # Ask for uninstall mode
        echo -e "${YELLOW}Choose uninstall mode / 选择卸载模式：${NC}"
        echo "  1) Quick uninstall (remove everything) / 快速卸载（删除所有）"
        echo "  2) Custom uninstall (select what to remove) / 自定义卸载（选择删除内容）"
        echo ""
        echo -n "Enter your choice [1-2] / 输入选择 [1-2]: "
        read -n 1 -r MODE </dev/tty
        echo
        
        # Handle empty or invalid input
        if [ -z "$MODE" ] || { [ "$MODE" != "1" ] && [ "$MODE" != "2" ]; }; then
            echo -e "${RED}Invalid input. Please enter 1 or 2. / 输入无效，请输入 1 或 2。${NC}"
            echo -e "${YELLOW}Press any key to continue... / 按任意键继续...${NC}"
            read -n 1 -s </dev/tty
            exec bash "$SELF_SCRIPT" "$@"
        fi
        
        if [ "$MODE" = "1" ]; then
            # Quick uninstall - remove everything
            echo ""
            echo -e "${CYAN}Quick uninstall will remove: / 快速卸载将删除：${NC}"
            echo "  - $INSTALLED_LOCATION (ClawDeckX)"
            
            SYSTEMD_UNINSTALL=false
            if check_systemd_service; then
                echo "  - clawdeckx.service (systemd service / systemd 服务)"
                echo -e "    ${YELLOW}Note: Service will be stopped automatically / 注意：服务将自动停止${NC}"
                SYSTEMD_UNINSTALL=true
            fi
            
            if [ -d "$CONFIG_DIR" ]; then
                echo "  - $CONFIG_DIR (config / 配置)"
            fi
            
            if [ -d "$DATA_DIR" ]; then
                echo "  - $DATA_DIR (data / 数据)"
            fi
            
            echo ""
            echo -n -e "${RED}Confirm quick uninstall? / 确认快速卸载？ [y/N] ${NC}"
            read -n 1 -r </dev/tty
            echo
            
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                perform_uninstall true true true
            else
                echo -e "${YELLOW}Uninstall cancelled / 卸载已取消${NC}"
                exit 0
            fi
        else
            # Custom uninstall
            echo ""
            echo -e "${CYAN}Custom uninstall / 自定义卸载${NC}"
            echo ""
            
            # Check for systemd service
            SYSTEMD_UNINSTALL=false
            if check_systemd_service; then
                echo -e "${YELLOW}⚠  Systemd service detected / 检测到 systemd 服务：${NC}"
                echo "  - clawdeckx.service ($SYSTEMD_SERVICE_TYPE-level)"
                echo -e "    ${CYAN}Service will be stopped automatically during uninstall / 卸载时将自动停止服务${NC}"
                echo ""
                echo -n "Also uninstall systemd service? / 同时卸载 systemd 服务？ [Y/n] "
                read -n 1 -r </dev/tty
                echo
                if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
                    SYSTEMD_UNINSTALL=true
                fi
            else
                echo -e "${CYAN}No systemd service found / 未发现 systemd 服务${NC}"
            fi
            
            # Ask about config and data
            REMOVE_CONFIG=false
            REMOVE_DATA=false
            
            if [ -d "$CONFIG_DIR" ]; then
                echo -n "Also remove config directory ($CONFIG_DIR)? / 同时删除配置目录？ [y/N] "
                read -n 1 -r </dev/tty
                echo
                if [[ $REPLY =~ ^[Yy]$ ]]; then
                    REMOVE_CONFIG=true
                    echo "  - $CONFIG_DIR (config / 配置)"
                fi
            else
                echo -e "${CYAN}No config directory found / 未发现配置目录${NC}"
            fi
            
            if [ -d "$DATA_DIR" ]; then
                echo -n "Also remove data directory ($DATA_DIR)? / 同时删除数据目录？ [y/N] "
                read -n 1 -r </dev/tty
                echo
                if [[ $REPLY =~ ^[Yy]$ ]]; then
                    REMOVE_DATA=true
                    echo "  - $DATA_DIR (data / 数据)"
                fi
            else
                echo -e "${CYAN}No data directory found / 未发现数据目录${NC}"
            fi
            
            echo ""
            echo -e "${YELLOW}Summary / 摘要：${NC}"
            echo "  - ClawDeckX：${RED}will be removed / 将被删除${NC}"
            if [ "$SYSTEMD_UNINSTALL" = true ]; then
                echo "  - Systemd service / systemd 服务：${RED}will be removed / 将被删除${NC}"
            fi
            if [ "$REMOVE_CONFIG" = true ]; then
                echo "  - Config directory / 配置目录：${RED}will be removed / 将被删除${NC}"
            fi
            if [ "$REMOVE_DATA" = true ]; then
                echo "  - Data directory / 数据目录：${RED}will be removed / 将被删除${NC}"
            fi
            
            echo ""
            echo -n -e "${RED}Confirm custom uninstall? / 确认自定义卸载？ [y/N] ${NC}"
            read -n 1 -r </dev/tty
            echo
            
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                perform_uninstall "$SYSTEMD_UNINSTALL" "$REMOVE_CONFIG" "$REMOVE_DATA"
            else
                echo -e "${YELLOW}Uninstall cancelled / 卸载已取消${NC}"
                exit 0
            fi
        fi
    else
        echo -e "${RED}ClawDeckX is not installed / ClawDeckX 未安装${NC}"
        exit 1
    fi
}

# Helper function to perform the actual uninstall
perform_uninstall() {
    ensure_user_systemd_env
    local SYSTEMD_UNINSTALL=$1
    local REMOVE_CONFIG=$2
    local REMOVE_DATA=$3
    
    # Uninstall systemd service if requested
    if [ "$SYSTEMD_UNINSTALL" = true ]; then
        echo -e "${BLUE}Uninstalling systemd service... / 正在卸载 systemd 服务...${NC}"
        
        if [ "$SYSTEMD_SERVICE_TYPE" = "user" ]; then
            # Stop and disable user service
            echo -e "${YELLOW}Stopping user service... / 正在停止用户级服务...${NC}"
            systemctl --user stop clawdeckx 2>/dev/null || true
            echo -e "${YELLOW}Disabling service... / 正在禁用服务...${NC}"
            systemctl --user disable clawdeckx 2>/dev/null || true
            systemctl --user daemon-reload 2>/dev/null || true
            
            # Remove user unit file
            USER_SERVICE_PATH="$HOME/.config/systemd/user/clawdeckx.service"
            if [ -f "$USER_SERVICE_PATH" ]; then
                rm -f "$USER_SERVICE_PATH"
                echo -e "${GREEN}✓ Removed user systemd service / 已删除用户级 systemd 服务${NC}"
            fi
        else
            # Stop and disable system service
            echo -e "${YELLOW}Stopping system service... / 正在停止系统级服务...${NC}"
            sudo systemctl stop clawdeckx 2>/dev/null || true
            echo -e "${YELLOW}Disabling service... / 正在禁用服务...${NC}"
            sudo systemctl disable clawdeckx 2>/dev/null || true
            sudo systemctl daemon-reload 2>/dev/null || true
            
            # Remove system unit file
            SYSTEM_SERVICE_PATH="/etc/systemd/system/clawdeckx.service"
            if [ -f "$SYSTEM_SERVICE_PATH" ]; then
                sudo rm -f "$SYSTEM_SERVICE_PATH"
                echo -e "${GREEN}✓ Removed system systemd service / 已删除系统级 systemd 服务${NC}"
            fi
        fi
    fi
    
    if pgrep -f "$BINARY_NAME" > /dev/null 2>&1; then
        echo -e "${BLUE}Stopping running process... / 正在停止运行中的进程...${NC}"
        pkill -f "$BINARY_NAME" 2>/dev/null || true
        sleep 1
    fi
    stop_port_process "$PORT"
    
    # Remove PATH registration (symlink + shell profile entries)
    unregister_path
    
    # Remove binary (handle relative path)
    if [[ "$INSTALLED_LOCATION" == ./* ]]; then
        rm -f "$INSTALLED_LOCATION"
    else
        rm -f "$INSTALLED_LOCATION"
    fi
    echo -e "${GREEN}✓ Removed ClawDeckX / 已删除 ClawDeckX${NC}"
    
    # Remove config if requested
    if [ "$REMOVE_CONFIG" = true ]; then
        rm -rf "$CONFIG_DIR"
        echo -e "${GREEN}✓ Removed config directory / 已删除配置目录${NC}"
    fi
    
    # Remove data if requested
    if [ "$REMOVE_DATA" = true ]; then
        rm -rf "$DATA_DIR"
        echo -e "${GREEN}✓ Removed data directory / 已删除数据目录${NC}"
    fi
    
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✅ Uninstall complete! / 卸载完成！${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    exit 0
}

# Function to check if ClawDeckX is running
check_process_running() {
    # Check if binary process is running
    if pgrep -f "$BINARY_NAME" > /dev/null 2>&1; then
        return 0
    fi
    
    # Check if systemd service is running
    if check_systemd_service; then
        if [ "$SYSTEMD_SERVICE_TYPE" = "user" ]; then
            if systemctl --user is-active --quiet clawdeckx 2>/dev/null; then
                return 0
            fi
        else
            if systemctl is-active --quiet clawdeckx 2>/dev/null; then
                return 0
            fi
        fi
    fi
    
    return 1
}

# Function to kill any process holding a specific port
stop_port_process() {
    local port=$1
    local pid
    pid=$(ss -tlnp 2>/dev/null | grep ":${port} " | grep -oP 'pid=\K[0-9]+' | head -1 || true)
    if [ -z "$pid" ]; then
        # Fallback: try lsof
        pid=$(lsof -ti :"$port" 2>/dev/null | head -1 || true)
    fi
    if [ -n "$pid" ] && [ "$pid" -gt 0 ] 2>/dev/null; then
        local pname
        pname=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")
        echo -e "${YELLOW}Killing process on port ${port}: ${pname} (PID ${pid}) / 正在终止占用端口 ${port} 的进程: ${pname} (PID ${pid})${NC}"
        kill -9 "$pid" 2>/dev/null || true
        sleep 1
    fi
}

# Function to stop ClawDeckX
stop_clawdeckx() {
    ensure_user_systemd_env
    echo -e "${CYAN}Stopping ClawDeckX... / 正在停止 ClawDeckX...${NC}"
    
    # Try to stop systemd service first
    if check_systemd_service; then
        if [ "$SYSTEMD_SERVICE_TYPE" = "user" ] && ! can_use_systemctl_user; then
            : # skip systemctl --user in su sessions, will kill process below
        else
            echo -e "${BLUE}Stopping systemd service... / 正在停止 systemd 服务...${NC}"
            if [ "$SYSTEMD_SERVICE_TYPE" = "user" ]; then
                systemctl --user stop clawdeckx > /dev/null 2>&1 || true
            else
                sudo systemctl stop clawdeckx > /dev/null 2>&1 || true
            fi
            sleep 2
        fi
    fi
    
    # Kill any remaining process
    if pgrep -f "$BINARY_NAME" > /dev/null 2>&1; then
        echo -e "${BLUE}Killing process... / 正在终止进程...${NC}"
        pkill -f "$BINARY_NAME" 2>/dev/null || true
        sleep 1
    fi
    
    # Also kill any process holding the configured port (e.g. stale node from dev)
    stop_port_process $PORT
    
    echo -e "${GREEN}✓ ClawDeckX stopped / ClawDeckX 已停止${NC}"
}

# Function to start ClawDeckX
start_clawdeckx() {
    ensure_user_systemd_env
    echo -e "${CYAN}Starting ClawDeckX... / 正在启动 ClawDeckX...${NC}"
    
    # Kill any stale process or port holder to avoid conflict
    if pgrep -f "$BINARY_NAME" > /dev/null 2>&1; then
        echo -e "${YELLOW}Stopping existing instance... / 正在停止已有实例...${NC}"
        pkill -f "$BINARY_NAME" 2>/dev/null || true
        sleep 1
    else
        # Process name not found, but port might be held by another process
        stop_port_process $PORT
    fi
    
    # Try to start systemd service if installed
    if check_systemd_service; then
        if [ "$SYSTEMD_SERVICE_TYPE" = "user" ] && ! can_use_systemctl_user; then
            echo -e "${YELLOW}⚠ Cannot use systemctl --user (no user session bus, likely su session)"
            echo -e "  无法使用 systemctl --user（无用户会话总线，可能是 su 会话）${NC}"
            echo -e "${CYAN}Falling back to direct start... / 回退到直接启动...${NC}"
        else
            echo -e "${BLUE}Starting systemd service... / 正在启动 systemd 服务...${NC}"
            if [ "$SYSTEMD_SERVICE_TYPE" = "user" ]; then
                systemctl --user start clawdeckx > /dev/null 2>&1
            else
                sudo systemctl start clawdeckx > /dev/null 2>&1
            fi
            sleep 2
            
            # Check if started successfully
            if [ "$SYSTEMD_SERVICE_TYPE" = "user" ]; then
                if systemctl --user is-active --quiet clawdeckx 2>/dev/null; then
                    echo -e "${GREEN}✓ Service started successfully / 服务启动成功${NC}"
                    return 0
                fi
            else
                if systemctl is-active --quiet clawdeckx 2>/dev/null; then
                    echo -e "${GREEN}✓ Service started successfully / 服务启动成功${NC}"
                    return 0
                fi
            fi
        fi
    fi
    
    # Fallback: start binary directly
    local err_file="/tmp/.clawdeckx-start-err.log"
    echo -e "${BLUE}Starting ClawDeckX on port $PORT... / 正在启动 ClawDeckX (端口 $PORT)...${NC}"
    if [ "$PORT" -ne "$DEFAULT_PORT" ]; then
        "$INSTALLED_LOCATION" --port "$PORT" > /dev/null 2>"$err_file" &
    else
        "$INSTALLED_LOCATION" > /dev/null 2>"$err_file" &
    fi
    sleep 2
    
    if pgrep -f "$BINARY_NAME" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ ClawDeckX started successfully / ClawDeckX 启动成功${NC}"
        rm -f "$err_file"
        return 0
    else
        echo -e "${YELLOW}⚠ Failed to start ClawDeckX / 启动 ClawDeckX 失败${NC}"
        if [ -s "$err_file" ]; then
            echo -e "${RED}  Error output / 错误输出:${NC}"
            echo -e "${RED}  $(cat "$err_file")${NC}"
            rm -f "$err_file"
        fi
        echo -e "${YELLOW}  Try running manually to see full output: / 尝试手动运行查看完整输出:${NC}"
        echo -e "  ${GREEN}./$BINARY_NAME${NC}"
        return 1
    fi
}

# Function to update ClawDeckX
update() {
    echo ""
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  Update ClawDeckX / 更新 ClawDeckX${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    
    echo -e "${CYAN}Current version / 当前版本：${NC} $CURRENT_VERSION"
    echo -e "${CYAN}Latest version / 最新版本：${NC} $LATEST_VERSION"
    echo ""
    
    # Detect OS and Arch for update
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)
    
    case $ARCH in
        x86_64)
            ARCH="amd64"
            ;;
        aarch64|arm64)
            ARCH="arm64"
            ;;
        *)
            echo -e "${RED}Error: Unsupported architecture: $ARCH${NC}"
            exit 1
            ;;
    esac
    
    # Detect network for proxy
    if [ "$NEED_MIRROR" != true ]; then
        echo -e "${CYAN}Checking network connectivity... / 正在检测网络连通性...${NC}"
        if detect_network; then
            NEED_MIRROR=true
        fi
    fi
    if [ "$NEED_MIRROR" = true ]; then
        echo ""
        echo -e "${YELLOW}┌─────────────────────────────────────────────────────────┐${NC}"
        echo -e "${YELLOW}│  ⚠  ACCELERATED DOWNLOAD MODE / 加速下载模式已启用      │${NC}"
        echo -e "${YELLOW}├─────────────────────────────────────────────────────────┤${NC}"
        echo -e "${YELLOW}│  GitHub Proxy / 代理: ${CYAN}ghfast.top${YELLOW}                       │${NC}"
        echo -e "${YELLOW}│  If download fails, the mirror site may be down.        │${NC}"
        echo -e "${YELLOW}│  若下载失败，可能是加速站点不可用，请检查网络或换源。   │${NC}"
        echo -e "${YELLOW}└─────────────────────────────────────────────────────────┘${NC}"
        echo ""
    fi

    # Get download URL for update
    ASSET_PATTERN="clawdeckx-${OS}-${ARCH}"
    DOWNLOAD_URL=""

    # Primary: construct direct download URL (no API needed, no rate limit)
    if [ "$LATEST_VERSION_RAW" != "latest" ]; then
        DOWNLOAD_URL="https://github.com/$REPO/releases/download/${LATEST_VERSION_RAW}/${ASSET_PATTERN}"
        HTTP_CODE=$(curl -sI -o /dev/null -w "%{http_code}" -L "$DOWNLOAD_URL" 2>/dev/null)
        if [ "$HTTP_CODE" != "200" ]; then
            echo -e "${YELLOW}Direct URL returned $HTTP_CODE, trying API fallback...${NC}"
            DOWNLOAD_URL=""
        fi
    fi

    # Fallback: use API
    if [ -z "$DOWNLOAD_URL" ]; then
        API_URL="https://api.github.com/repos/$REPO/releases/latest"
        API_RESPONSE=$(curl -s "$API_URL")
        if echo "$API_RESPONSE" | grep -q "rate limit"; then
            echo -e "${RED}⚠ GitHub API rate limit exceeded / GitHub API 请求频率超限${NC}"
            echo -e "${YELLOW}Tip: Wait a few minutes and retry, or set GITHUB_TOKEN env var${NC}"
            exit 1
        fi
        DOWNLOAD_URL=$(echo "$API_RESPONSE" | grep "browser_download_url" | grep "$ASSET_PATTERN" | cut -d '"' -f 4)
    fi

    if [ -z "$DOWNLOAD_URL" ]; then
        echo -e "${RED}Error: Could not find download URL for $OS/$ARCH${NC}"
        echo "Try again later or set GITHUB_TOKEN to bypass rate limit."
        exit 1
    fi
    
    if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
        echo -e "${GREEN}✓ Already up to date! / 已经是最新版本！${NC}"
        echo ""
        if ! confirm_default_no "Force re-download? / 强制重新下载？ [y/N] "; then
            exit 0
        fi
    else
        if ! confirm_default_yes "Proceed with update? / 确认更新？ [Y/n] "; then
            exit 0
        fi
    fi
    
    # Check if ClawDeckX is currently running
    echo ""
    if check_process_running; then
        echo -e "${YELLOW}⚠ ClawDeckX is currently running / ClawDeckX 正在运行${NC}"
        echo -e "${YELLOW}The program needs to be stopped before updating. / 更新前需要停止程序。${NC}"
        echo ""
        if ! confirm_default_yes "Stop ClawDeckX now and continue update? / 立即停止 ClawDeckX 并继续更新？ [Y/n] "; then
            echo -e "${YELLOW}Update cancelled. / 更新已取消${NC}"
            exit 0
        fi
        
        # Stop ClawDeckX
        stop_clawdeckx
        
        # Wait a moment to ensure process is fully stopped
        sleep 2
    fi
    
    echo ""
    echo -e "${BLUE}Downloading update... / 正在下载更新...${NC}"
    
    # Download the update (with China proxy fallback)
    if [ "$NEED_MIRROR" = true ]; then
        local cn_url="https://ghfast.top/$DOWNLOAD_URL"
        echo -e "${CYAN}Using China proxy... / 使用中国代理...${NC}"
        if ! curl -L -o "$INSTALLED_LOCATION" "$cn_url" --progress-bar 2>/dev/null; then
            echo -e "${YELLOW}China proxy failed, trying direct... / 中国代理失败，尝试直连...${NC}"
            curl -L -o "$INSTALLED_LOCATION" "$DOWNLOAD_URL" --progress-bar
        fi
    else
        curl -L -o "$INSTALLED_LOCATION" "$DOWNLOAD_URL" --progress-bar
    fi
    
    # Make executable
    chmod +x "$INSTALLED_LOCATION"
    echo -e "${GREEN}✓ Download complete! / 下载完成${NC}"
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✅ Update complete! / 更新完成！${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    
    # Ask if user wants to restart ClawDeckX
    local do_start=true
    if [ "$CLI_START" = "no" ]; then
        do_start=false
    elif [ "$CLI_START" = "ask" ] && ! confirm_default_yes "Start ClawDeckX now? / 立即启动 ClawDeckX？ [Y/n] "; then
        do_start=false
    fi
    
    if [ "$do_start" = true ]; then
        start_clawdeckx
        
        # Show access URL if running
        if check_process_running; then
            echo ""
            print_access_urls "$PORT"
            echo ""
            if check_systemd_service; then
                echo -e "${YELLOW}Service management commands / 服务管理命令：${NC}"
                echo -e "  ${GREEN}systemctl --user status clawdeckx${NC}   - Check status / 查看状态"
                echo -e "  ${GREEN}systemctl --user stop clawdeckx${NC}     - Stop service / 停止服务"
            fi
        fi
    else
        echo -e "${YELLOW}You can start it later with: / 稍后可以使用以下命令启动：${NC}"
        echo -e "  ${GREEN}./$BINARY_NAME${NC}"
        if check_systemd_service; then
            echo ""
            echo -e "${CYAN}Service management commands / 服务管理命令：${NC}"
            echo -e "  ${GREEN}systemctl --user start clawdeckx${NC}    - Start service / 启动服务"
            echo -e "  ${GREEN}systemctl --user stop clawdeckx${NC}     - Stop service / 停止服务"
            echo -e "  ${GREEN}systemctl --user status clawdeckx${NC}   - Check status / 查看状态"
        fi
    fi
    
    exit 0
}

# ==============================================================================
# Unified Adaptive Main Menu
# ==============================================================================
# Shows detected installations and offers all relevant actions.
# The menu is built dynamically based on what's detected (Docker, Binary, both, or neither).

# --- Display detected installations ---
if [ "$HAS_DOCKER" = true ] || [ "$HAS_BINARY" = true ]; then
    echo -e "${CYAN}Detected installations / 检测到的安装：${NC}"

    if [ "$HAS_DOCKER" = true ]; then
        for i in "${!DOCKER_INSTANCES[@]}"; do
            local_ver="${DOCKER_INSTANCE_VERS[$i]}"
            local_port="${DOCKER_INSTANCE_PORTS[$i]}"
            local_name="${DOCKER_INSTANCE_NAMES[$i]}"
            local_running="${DOCKER_INSTANCE_RUNNING[$i]}"
            local_label="Docker"
            if [ ${#DOCKER_INSTANCES[@]} -gt 1 ] || [ "$local_name" != "clawdeckx" ]; then
                local_label="Docker [$local_name]"
            fi
            if [ "$local_running" = "true" ]; then
                echo -e "  🐳 ${local_label}: ${GREEN}v${local_ver}${NC} (${GREEN}Running / 运行中${NC}) on port ${local_port}"
            else
                echo -e "  🐳 ${local_label}: ${GREEN}v${local_ver}${NC} (${YELLOW}Stopped / 已停止${NC}) on port ${local_port}"
            fi
        done
    fi

    if [ "$HAS_BINARY" = true ]; then
        BINARY_SERVICE_RUNNING=false
        BINARY_SERVICE_STATUS=""
        if check_systemd_service; then
            if [ "$SYSTEMD_SERVICE_TYPE" = "user" ]; then
                if systemctl --user is-active --quiet clawdeckx 2>/dev/null; then
                    BINARY_SERVICE_RUNNING=true
                    BINARY_SERVICE_STATUS="${GREEN}Running / 运行中${NC}"
                else
                    BINARY_SERVICE_STATUS="${YELLOW}Stopped / 已停止${NC}"
                fi
            else
                if systemctl is-active --quiet clawdeckx 2>/dev/null; then
                    BINARY_SERVICE_RUNNING=true
                    BINARY_SERVICE_STATUS="${GREEN}Running / 运行中${NC}"
                else
                    BINARY_SERVICE_STATUS="${YELLOW}Stopped / 已停止${NC}"
                fi
            fi
            echo -e "  📦 ClawDeckX: ${GREEN}v${CURRENT_VERSION}${NC} ($BINARY_SERVICE_STATUS) at $INSTALLED_LOCATION"
        else
            echo -e "  📦 ClawDeckX: ${GREEN}v${CURRENT_VERSION}${NC} at $INSTALLED_LOCATION"
        fi
    fi

    echo ""
fi

# --- Build adaptive menu ---
MENU_ITEMS=()
MENU_ACTIONS=()
MENU_DOCKER_INDEX=()  # Maps menu index to Docker instance index
N=0

if [ "$HAS_DOCKER" = true ]; then
    for i in "${!DOCKER_INSTANCES[@]}"; do
        local_name="${DOCKER_INSTANCE_NAMES[$i]}"
        local_label="Manage Docker"
        if [ ${#DOCKER_INSTANCES[@]} -gt 1 ] || [ "$local_name" != "clawdeckx" ]; then
            local_label="Manage Docker [$local_name]"
        fi
        N=$((N + 1))
        MENU_ITEMS+=("$N) ${local_label} / 管理 Docker ${local_name}")
        MENU_ACTIONS+=("manage_docker")
        MENU_DOCKER_INDEX+=("$i")
    done
fi

if [ "$HAS_BINARY" = true ]; then
    N=$((N + 1)); MENU_ITEMS+=("$N) Manage local ClawDeckX / 管理本机 ClawDeckX"); MENU_ACTIONS+=("manage_binary")
fi

if [ "$IS_CONTAINER" = false ]; then
    if [ "$HAS_BINARY" = false ]; then
        N=$((N + 1)); MENU_ITEMS+=("$N) Install ClawDeckX locally / 在本机安装 ClawDeckX"); MENU_ACTIONS+=("install_binary")
    fi
    N=$((N + 1)); MENU_ITEMS+=("$N) New Docker deployment / 新建 Docker 部署"); MENU_ACTIONS+=("install_docker")
fi

N=$((N + 1)); MENU_ITEMS+=("$N) Exit / 退出"); MENU_ACTIONS+=("exit")

if [ -n "$CLI_MODE" ]; then
    case "$CLI_MODE" in
        binary)
            SELECTED_ACTION="install_binary"
            ;;
        docker)
            SELECTED_ACTION="install_docker"
            ;;
        update)
            if [ "$HAS_BINARY" = true ]; then
                update
                exit 0
            fi
            echo -e "${RED}Error: No local binary installation found for update${NC}"
            exit 1
            ;;
        stop)
            stop_service
            exit 0
            ;;
        *)
            echo -e "${RED}Error: Invalid mode '$CLI_MODE'${NC}"
            usage
            exit 1
            ;;
    esac
else

echo -e "${YELLOW}What would you like to do? / 您想做什么？${NC}"
for item in "${MENU_ITEMS[@]}"; do
    echo "  $item"
done
echo ""
echo -n "Enter your choice [1-$N] / 输入选择 [1-$N]: "
if [ "$N" -le 9 ]; then
    read -n 1 -r MAIN_CHOICE </dev/tty
    echo
else
    read -r MAIN_CHOICE </dev/tty
fi

# Validate input
if [ -z "$MAIN_CHOICE" ] || ! [[ "$MAIN_CHOICE" =~ ^[0-9]+$ ]] || [ "$MAIN_CHOICE" -lt 1 ] || [ "$MAIN_CHOICE" -gt "$N" ]; then
    echo -e "${RED}Invalid choice / 选择无效${NC}"
    echo -e "${YELLOW}Press any key to continue... / 按任意键继续...${NC}"
    read -n 1 -s </dev/tty
    exec bash "$SELF_SCRIPT" "$@"
fi

SELECTED_ACTION="${MENU_ACTIONS[$((MAIN_CHOICE - 1))]}"
fi

case "$SELECTED_ACTION" in
    manage_docker)
        # Find which Docker instance was selected
        SELECTED_DOCKER_IDX="${MENU_DOCKER_INDEX[$((MAIN_CHOICE - 1))]}"
        DOCKER_COMPOSE_FILE="${DOCKER_INSTANCES[$SELECTED_DOCKER_IDX]}"
        DOCKER_MGMT_NAME="${DOCKER_INSTANCE_NAMES[$SELECTED_DOCKER_IDX]}"
        docker_management_menu "$DOCKER_COMPOSE_FILE" "$DOCKER_MGMT_NAME"
        exit 0
        ;;
    manage_binary)
        # --- Binary management sub-menu ---
        echo ""
        echo -e "${GREEN}✓ Local ClawDeckX / 本机 ClawDeckX${NC}"
        echo -e "${CYAN}Location / 位置：${NC} $INSTALLED_LOCATION"
        echo -e "${CYAN}Current version / 当前版本：${NC} $CURRENT_VERSION"
        echo -e "${CYAN}Latest version / 最新版本：${NC} $LATEST_VERSION"
        echo -e "${CYAN}Port / 端口：${NC} $PORT"

        SERVICE_RUNNING=$BINARY_SERVICE_RUNNING
        if check_systemd_service; then
            echo -e "${CYAN}Service / 服务：${NC} ${GREEN}Installed${NC} ($SYSTEMD_SERVICE_TYPE-level) — $BINARY_SERVICE_STATUS"
        fi
        echo ""

        IS_LATEST=false
        if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
            IS_LATEST=true
            echo -e "${GREEN}✓ Already up to date! / 已是最新版本！${NC}"
        else
            echo -e "${YELLOW}New version available! / 有新版本可用！${NC}"
        fi
        echo ""

        echo -e "${YELLOW}What would you like to do? / 您想做什么？${NC}"
        if [ "$IS_LATEST" = true ]; then
            echo "  1) Re-download current version / 重新下载当前版本"
        else
            echo "  1) Update to latest version / 更新到最新版本"
        fi
        if [ "$SERVICE_RUNNING" = true ]; then
            echo "  2) Stop service / 停止服务"
        elif check_systemd_service; then
            echo "  2) Start service / 启动服务"
        fi
        echo "  3) Uninstall / 卸载"
        echo "  4) Back / 返回"
        echo ""
        echo -n "Enter your choice [1-4] / 输入选择 [1-4]: "
        read -n 1 -r BCHOICE </dev/tty
        echo

        case $BCHOICE in
            1)
                update
                ;;
            2)
                if [ "$SERVICE_RUNNING" = true ]; then
                    stop_service
                    exit 0
                elif check_systemd_service; then
                    echo ""
                    echo -e "${BLUE}Starting systemd service... / 正在启动 systemd 服务...${NC}"
                    if [ "$SYSTEMD_SERVICE_TYPE" = "user" ]; then
                        systemctl --user start clawdeckx
                    else
                        sudo systemctl start clawdeckx
                    fi
                    sleep 2
                    if [ "$SYSTEMD_SERVICE_TYPE" = "user" ]; then
                        if systemctl --user is-active --quiet clawdeckx 2>/dev/null; then
                            echo -e "${GREEN}✓ Service started successfully / 服务启动成功${NC}"
                        else
                            echo -e "${YELLOW}⚠ Service failed to start / 服务启动失败${NC}"
                        fi
                    else
                        if systemctl is-active --quiet clawdeckx 2>/dev/null; then
                            echo -e "${GREEN}✓ Service started successfully / 服务启动成功${NC}"
                        else
                            echo -e "${YELLOW}⚠ Service failed to start / 服务启动失败${NC}"
                        fi
                    fi
                    echo ""
                    print_access_urls "$PORT"
                    exit 0
                else
                    echo -e "${RED}Invalid choice / 选择无效${NC}"
                fi
                ;;
            3)
                uninstall
                ;;
            4)
                exec bash "$SELF_SCRIPT" "$@"
                ;;
            *)
                echo -e "${RED}Invalid choice / 选择无效${NC}"
                exec bash "$SELF_SCRIPT" "$@"
                ;;
        esac
        exit 0
        ;;
    install_docker)
        docker_install_new
        ;;
    install_binary)
        # Fall through to binary install below
        ;;
    exit)
        echo -e "${YELLOW}Exiting / 退出${NC}"
        exit 0
        ;;
esac

# 0. Check root user (Binary install only — Docker does not need a dedicated user)
if [ "$(id -u)" = "0" ]; then
    if is_non_interactive; then
        echo -e "${YELLOW}⚠ Running non-interactive binary install as root."
        echo -e "  以 root 用户执行非交互式安装，跳过用户创建。${NC}"
    else
    echo ""
    echo -e "${RED}⚠  Warning: Running as root is not recommended"
    echo -e "   不建议以 root 用户运行，可能导致权限和安全问题${NC}"
    echo ""
    echo -e "${YELLOW}If you have an existing user, switch to it:"
    echo -e "如果已有其他用户，可以切换：${NC}"
    echo -e "  ${GREEN}su - username${NC}"
    echo ""
    
    # 检测 openclaw 用户是否已存在
    if id "openclaw" &>/dev/null; then
        echo -e "${GREEN}✓ User 'openclaw' already exists / 用户 'openclaw' 已存在${NC}"
        # Ensure openclaw is in docker group if Docker is installed
        if getent group docker &>/dev/null; then
            if ! id -nG openclaw 2>/dev/null | grep -qw docker; then
                usermod -aG docker openclaw
                echo -e "${GREEN}✓ Added 'openclaw' to docker group / 已将 'openclaw' 添加到 docker 组${NC}"
            else
                echo -e "${GREEN}✓ 'openclaw' is already in docker group / 'openclaw' 已在 docker 组中${NC}"
            fi
        fi
        echo ""
        echo -e "${YELLOW}Please run the following commands to switch user and re-run:"
        echo -e "请执行以下命令切换用户并重新运行：${NC}"
        echo ""
        echo -e "  ${GREEN}su - openclaw${NC}"
        echo -e "  ${GREEN}curl -fsSL https://raw.githubusercontent.com/ClawDeckX/ClawDeckX/main/install.sh | bash${NC}"
        echo ""
        exit 0
    fi
    
    # 询问是否自动创建用户
    echo -e "${YELLOW}Or auto-create a new user with sudo privileges:"
    echo -e "或者自动创建一个新用户并赋予 sudo 权限：${NC}"
    echo ""
    echo -n "Auto-create user 'openclaw'? / 自动创建用户 'openclaw'？ [Y/n] "
    read -n 1 -r REPLY </dev/tty
    echo
    if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
        echo ""
        echo -e "${BLUE}Creating user 'openclaw'... / 正在创建用户 'openclaw'...${NC}"
        
        # 创建用户（跨发行版兼容：Debian/Ubuntu 用 adduser，CentOS/RHEL 用 useradd）
        if command -v adduser &>/dev/null && adduser --help 2>&1 | grep -q -- '--gecos'; then
            adduser --gecos "" --disabled-password openclaw
        else
            useradd -m -s /bin/bash openclaw
        fi
        echo -e "${GREEN}✓ User created / 用户已创建${NC}"
        
        # 设置密码（最多重试 3 次）
        echo ""
        PASSWD_SET=false
        for i in 1 2 3; do
            echo -e "${YELLOW}Please set password for 'openclaw' (enter twice):"
            echo -e "请为 'openclaw' 设置密码（需输入两次）：${NC}"
            if passwd openclaw </dev/tty; then
                PASSWD_SET=true
                break
            fi
            echo ""
            if [ "$i" -lt 3 ]; then
                echo -e "${RED}Passwords did not match, please try again ($i/3)"
                echo -e "密码不匹配，请重试 ($i/3)${NC}"
                echo ""
            fi
        done
        
        if [ "$PASSWD_SET" = false ]; then
            echo -e "${RED}✗ Failed to set password after 3 attempts. Removing user 'openclaw'..."
            echo -e "✗ 3 次密码设置均失败，正在删除用户 'openclaw'...${NC}"
            userdel -r openclaw 2>/dev/null
            echo -e "${YELLOW}Please re-run the script to try again."
            echo -e "请重新运行脚本重试。${NC}"
            exit 1
        fi
        
        # 添加到 sudo 组
        usermod -aG sudo openclaw
        echo -e "${GREEN}✓ Added to sudo group / 已添加到 sudo 组${NC}"
        
        # 添加到 docker 组（如果 Docker 已安装）
        if getent group docker &>/dev/null; then
            usermod -aG docker openclaw
            echo -e "${GREEN}✓ Added to docker group / 已添加到 docker 组${NC}"
        fi
        
        # 配置 NOPASSWD
        echo 'openclaw ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/openclaw
        chmod 440 /etc/sudoers.d/openclaw
        echo -e "${GREEN}✓ Configured NOPASSWD sudo / 已配置免密 sudo${NC}"
        
        # 启用 lingering，使 systemd --user 实例在无登录会话时也能运行
        loginctl enable-linger openclaw 2>/dev/null || true
        echo -e "${GREEN}✓ Enabled lingering for systemd user services / 已启用 systemd 用户服务持久化${NC}"
        
        echo ""
        echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
        echo -e "${GREEN}✅ User 'openclaw' created successfully!${NC}"
        echo -e "${GREEN}✅ 用户 'openclaw' 创建成功！${NC}"
        echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
        echo ""
        echo -e "${YELLOW}Please run the following commands to switch user and re-run:"
        echo -e "请执行以下命令切换用户并重新运行：${NC}"
        echo ""
        echo -e "  ${GREEN}su - openclaw${NC}"
        echo -e "  ${GREEN}curl -fsSL https://raw.githubusercontent.com/ClawDeckX/ClawDeckX/main/install.sh | bash${NC}"
        echo ""
        echo -e "${YELLOW}⚠ Note: Use \"su - openclaw\" (with dash), not \"su openclaw\"."
        echo -e "  The dash ensures a full login session required for systemd services."
        echo -e "⚠ 注意：请使用 \"su - openclaw\"（带短横线），不要用 \"su openclaw\"。"
        echo -e "  短横线确保完整登录会话，这是 systemd 用户级服务正常运行所必需的。${NC}"
        echo ""
        exit 0
    fi
    
    # 如果用户选择不创建，询问是否以 root 继续
    echo ""
    echo -n "Continue as root anyway? / 仍然以 root 继续？ [y/N] "
    read -n 1 -r REPLY </dev/tty
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
    fi
fi

# 1. Detect OS and Arch
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case $ARCH in
    x86_64)
        ARCH="amd64"
        ;;
    aarch64|arm64)
        ARCH="arm64"
        ;;
    *)
        echo -e "${RED}Error: Unsupported architecture: $ARCH${NC}"
        exit 1
        ;;
esac

echo -e "${GREEN}✓ Detected System:${NC} $OS/$ARCH"

# 1.5. Detect network for binary download proxy
if [ "$NEED_MIRROR" != true ]; then
    echo -e "${CYAN}Checking network connectivity... / 正在检测网络连通性...${NC}"
    if detect_network; then
        NEED_MIRROR=true
        echo -e "${YELLOW}⚠ GitHub may be slow — will use China proxy for download"
        echo -e "  GitHub 可能较慢 — 将使用中国代理下载${NC}"
    else
        echo -e "${GREEN}✓ Direct network access OK / 网络直连正常${NC}"
    fi
fi

# 2. Define Download URL (GitHub Releases)
# REPO 和 API_URL 已在脚本开头定义

echo -e "${YELLOW}Fetching latest release info... (${LATEST_VERSION})${NC}"

BINARY_NAME="clawdeckx"
ASSET_PATTERN="clawdeckx-${OS}-${ARCH}"

# Fallback for Windows (if run in git bash/wsl)
if [[ "$OS" == *"mingw"* || "$OS" == *"cygwin"* ]]; then
    OS="windows"
    ASSET_PATTERN="clawdeckx-windows-${ARCH}.exe"
    BINARY_NAME="clawdeckx.exe"
fi

# Primary: construct direct download URL (no API needed, no rate limit)
if [ "$LATEST_VERSION_RAW" != "latest" ]; then
    DOWNLOAD_URL="https://github.com/$REPO/releases/download/${LATEST_VERSION_RAW}/${ASSET_PATTERN}"
    # Verify the URL exists (HEAD request, follow redirects)
    HTTP_CODE=$(curl -sI -o /dev/null -w "%{http_code}" -L "$DOWNLOAD_URL" 2>/dev/null)
    if [ "$HTTP_CODE" != "200" ]; then
        echo -e "${YELLOW}Direct URL returned $HTTP_CODE, trying API fallback...${NC}"
        DOWNLOAD_URL=""
    fi
fi

# Fallback: use API to find asset URL
if [ -z "$DOWNLOAD_URL" ]; then
    API_RESPONSE=$(curl -s "$API_URL")
    # Check for rate limit
    if echo "$API_RESPONSE" | grep -q "rate limit"; then
        echo -e "${RED}⚠ GitHub API rate limit exceeded / GitHub API 请求频率超限${NC}"
        echo -e "${YELLOW}Tip: Wait a few minutes and retry, or set GITHUB_TOKEN env var${NC}"
        echo -e "${YELLOW}提示：等待几分钟后重试，或设置 GITHUB_TOKEN 环境变量${NC}"
        exit 1
    fi
    DOWNLOAD_URL=$(echo "$API_RESPONSE" | grep "browser_download_url" | grep "$ASSET_PATTERN" | cut -d '"' -f 4)
fi

if [ -z "$DOWNLOAD_URL" ]; then
    echo -e "${RED}Error: Could not find a release asset for $OS/$ARCH${NC}"
    echo "This might be because:"
    echo "1. No release has been published yet."
    echo "2. The asset naming does not match '$ASSET_PATTERN'."
    echo "3. GitHub API rate limit — try again later or set GITHUB_TOKEN."
    exit 1
fi

echo -e "${GREEN}✓ Found asset:${NC} $DOWNLOAD_URL"

# 3. Download - use $(pwd) to get current working directory (with China proxy fallback)
INSTALLED_BINARY="$(pwd)/$BINARY_NAME"
echo -e "${YELLOW}Downloading $BINARY_NAME ...${NC}"
if [ "$NEED_MIRROR" = true ]; then
    CN_DL_URL="https://ghfast.top/$DOWNLOAD_URL"
    echo -e "${CYAN}Using China proxy... / 使用中国代理...${NC}"
    if ! curl -L -o "$INSTALLED_BINARY" "$CN_DL_URL" --progress-bar 2>/dev/null; then
        echo -e "${YELLOW}China proxy failed, trying direct... / 中国代理失败，尝试直连...${NC}"
        curl -L -o "$INSTALLED_BINARY" "$DOWNLOAD_URL" --progress-bar
    fi
else
    curl -L -o "$INSTALLED_BINARY" "$DOWNLOAD_URL" --progress-bar
fi

# 4. Make Executable
chmod +x "$INSTALLED_BINARY"
echo -e "${GREEN}✓ Download complete!${NC}"

# 5. Installation complete (binary already in correct location)
echo ""
echo -e "${BLUE}Installing to current directory ($PWD) ...${NC}"
echo -e "${GREEN}✓ Installed: $INSTALLED_BINARY${NC}"

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Installation complete! / 安装完成！${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${CYAN}ClawDeckX location / ClawDeckX 位置：${NC} $INSTALLED_BINARY"
echo -e "${CYAN}Config & Data directory / 配置和数据目录：${NC} $(dirname "$INSTALLED_BINARY")/data"
echo ""
echo -e "${GREEN}✓ Installed in current directory / 已安装在当前目录${NC}"
echo ""

# Register in PATH so `clawdeckx` is available globally
if ! command -v clawdeckx &>/dev/null || [ "$(command -v clawdeckx 2>/dev/null)" != "$INSTALLED_BINARY" ]; then
    echo -e "${YELLOW}Would you like to add clawdeckx to PATH for global access?"
    echo -e "是否将 clawdeckx 添加到 PATH 以便全局使用？${NC}"
    if [ "$CLI_REGISTER_PATH" = "yes" ]; then
        register_path "$INSTALLED_BINARY"
    elif [ "$CLI_REGISTER_PATH" = "ask" ] && confirm_default_yes "Register in PATH? / 注册到 PATH？ [Y/n] "; then
        register_path "$INSTALLED_BINARY"
    fi
fi
echo ""

# Smart port detection for binary install
echo -e "${CYAN}Detecting available port... / 正在检测可用端口...${NC}"
find_available_port $DEFAULT_PORT
BINARY_PORT=$FOUND_PORT

if [ "$BINARY_PORT" -ne "$DEFAULT_PORT" ]; then
    echo -e "${YELLOW}Default port $DEFAULT_PORT is occupied, auto-selected: $BINARY_PORT"
    echo -e "默认端口 $DEFAULT_PORT 已被占用，自动选择：$BINARY_PORT${NC}"
else
    echo -e "${GREEN}✓ Port $BINARY_PORT is available / 端口 $BINARY_PORT 可用${NC}"
fi

if validate_port "$CLI_PORT"; then
    BINARY_PORT="$CLI_PORT"
elif ! confirm_default_yes "Use port $BINARY_PORT? / 使用端口 $BINARY_PORT？ [Y/n] "; then
    prompt_with_default CUSTOM_PORT "Enter port / 输入端口: " "$BINARY_PORT"
    if validate_port "$CUSTOM_PORT"; then
        BINARY_PORT=$CUSTOM_PORT
    else
        echo -e "${YELLOW}Invalid port, using $BINARY_PORT / 端口无效，使用 $BINARY_PORT${NC}"
    fi
    echo ""
fi
PORT=$BINARY_PORT
echo -e "${GREEN}✓ Port set to $PORT / 端口已设置为 $PORT${NC}"
echo ""

# Ask if user wants to install systemd service
SERVICE_JUST_INSTALLED=false
if ! check_systemd_service; then
    echo -e "${YELLOW}Would you like to install auto-start service?"
    echo -e "是否安装自动启动服务？（系统重启后自动运行）${NC}"
    if [ "$CLI_INSTALL_SERVICE" = "yes" ]; then
        install_systemd_service
        SERVICE_JUST_INSTALLED=true
    elif [ "$CLI_INSTALL_SERVICE" = "ask" ] && confirm_default_yes "Install auto-start service? / 安装自动启动服务？ [Y/n] "; then
        install_systemd_service
        SERVICE_JUST_INSTALLED=true
    fi
fi

# Always ask if user wants to run now
if [ "$SERVICE_JUST_INSTALLED" = true ]; then
    echo ""
    echo -e "${CYAN}Note: Service is installed but NOT started."
    echo -e "说明：服务已安装但未启动。${NC}"
    echo ""
fi

START_NOW=true
if [ "$CLI_START" = "no" ]; then
    START_NOW=false
elif [ "$CLI_START" = "ask" ] && ! confirm_default_yes "Start ClawDeckX now? / 立即启动 ClawDeckX？ [Y/n] "; then
    START_NOW=false
fi

if [ "$START_NOW" = false ]; then
    echo ""
    echo -e "${YELLOW}You can start it later with: / 稍后可以使用以下命令启动：${NC}"
    echo -e "  ${GREEN}./$BINARY_NAME${NC}"
    if check_systemd_service; then
        echo ""
        echo -e "${CYAN}Service management commands / 服务管理命令：${NC}"
        echo -e "  ${GREEN}systemctl --user start clawdeckx${NC}    - Start service / 启动服务"
        echo -e "  ${GREEN}systemctl --user stop clawdeckx${NC}     - Stop service / 停止服务"
        echo -e "  ${GREEN}systemctl --user status clawdeckx${NC}   - Check status / 查看状态"
    fi
    exit 0
fi

# 6. Start ClawDeckX in the background (preferred) and display first-boot
#    credentials inline so the user never has to hunt for them. Fallback
#    chain: systemd --user → nohup+disown → foreground with a warning.
BG_MODE=""   # "systemd" | "nohup" | "foreground"
BG_PID=""
DATA_DIR="$(dirname "$INSTALLED_BINARY")/data"
CRED_FILE="$DATA_DIR/.first-boot-credentials.tmp"
mkdir -p "$DATA_DIR" 2>/dev/null || true

# Try systemd --user first if a unit file exists and the user bus is reachable
if check_systemd_service && [ "$SYSTEMD_SERVICE_TYPE" = "user" ] && can_use_systemctl_user; then
    echo -e "${BLUE}>> Starting ClawDeckX via systemd --user on port $PORT..."
    echo -e ">> 通过 systemd --user 在端口 $PORT 启动 ClawDeckX...${NC}"
    if systemctl --user start clawdeckx 2>/dev/null; then
        BG_MODE="systemd"
        # Enable linger so the service survives logout on shared servers
        if command -v loginctl &>/dev/null; then
            loginctl enable-linger "$(whoami)" 2>/dev/null || true
        fi
    fi
fi

# Fallback: nohup in background with output redirected to log file
if [ -z "$BG_MODE" ]; then
    NOHUP_LOG="$DATA_DIR/ClawDeckX.log"
    echo -e "${BLUE}>> Starting ClawDeckX in background on port $PORT..."
    echo -e ">> 在后台启动 ClawDeckX（端口 $PORT）...${NC}"
    if [ "$PORT" -ne "$DEFAULT_PORT" ]; then
        nohup "$INSTALLED_BINARY" --port "$PORT" "$@" >"$NOHUP_LOG" 2>&1 </dev/null &
    else
        nohup "$INSTALLED_BINARY" "$@" >"$NOHUP_LOG" 2>&1 </dev/null &
    fi
    BG_PID=$!
    disown "$BG_PID" 2>/dev/null || true
    echo "$BG_PID" > "$DATA_DIR/clawdeckx.pid" 2>/dev/null || true
    # Sanity check: give it 2s, make sure the process actually stayed up
    sleep 2
    if kill -0 "$BG_PID" 2>/dev/null; then
        BG_MODE="nohup"
    else
        BG_MODE=""
        echo -e "${YELLOW}⚠ Background launch did not stay alive, falling back to foreground."
        echo -e "  后台启动失败，回退为前台运行。${NC}"
    fi
fi

# Final fallback: foreground. The service will die when the terminal closes,
# so make sure the user understands that before we hand over.
if [ -z "$BG_MODE" ]; then
    echo ""
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  ⚠ RUNNING IN FOREGROUND / 前台运行${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  Keep this terminal open — closing it will stop ClawDeckX."
    echo -e "  请保持此终端打开 —— 关闭窗口将停止 ClawDeckX。${NC}"
    echo ""
    if [ "$PORT" -ne "$DEFAULT_PORT" ]; then
        exec "$INSTALLED_BINARY" --port "$PORT" "$@"
    else
        exec "$INSTALLED_BINARY" "$@"
    fi
fi

# Wait for the server to become ready (up to 30s). On slow disks or first-run
# DB migration this can take a few seconds.
echo -e "${CYAN}Waiting for ClawDeckX to become ready... / 等待 ClawDeckX 就绪...${NC}"
HEALTH_OK=false
for _i in $(seq 1 60); do
    if curl -sf "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null 2>&1; then
        HEALTH_OK=true
        break
    fi
    sleep 0.5
done

if [ "$HEALTH_OK" != true ]; then
    echo -e "${YELLOW}⚠ ClawDeckX did not report healthy within 30s."
    echo -e "  ClawDeckX 在 30 秒内未就绪。${NC}"
    if [ "$BG_MODE" = "nohup" ]; then
        echo -e "${CYAN}  See log: ${GREEN}$DATA_DIR/ClawDeckX.log${NC}"
    elif [ "$BG_MODE" = "systemd" ]; then
        echo -e "${CYAN}  See log: ${GREEN}journalctl --user -u clawdeckx -n 50${NC}"
    fi
fi

# Poll for one-shot first-boot credentials file (only exists on fresh install).
# The file is written by the Go binary when it auto-creates the admin user,
# and is unlinked by us below. We intentionally do not tell the user about
# this file; it is an internal handoff mechanism.
CRED_USER=""
CRED_PASS=""
for _i in $(seq 1 20); do
    if [ -f "$CRED_FILE" ]; then
        CRED_USER=$(grep -o '"username"[[:space:]]*:[[:space:]]*"[^"]*"' "$CRED_FILE" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
        CRED_PASS=$(grep -o '"password"[[:space:]]*:[[:space:]]*"[^"]*"' "$CRED_FILE" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
        rm -f "$CRED_FILE"
        break
    fi
    sleep 0.5
done

# Display result
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ ClawDeckX is running / ClawDeckX 已启动${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""

print_access_urls "$PORT"
echo ""

if [ -n "$CRED_USER" ] && [ -n "$CRED_PASS" ]; then
    echo -e "${YELLOW}🔐 First-time login / 首次登录：${NC}"
    echo -e "   Username / 用户名:  ${GREEN}${CRED_USER}${NC}"
    echo -e "   Password / 密码:    ${GREEN}${CRED_PASS}${NC}"
    echo ""
    echo -e "${YELLOW}   ⚠  Please change the password after logging in."
    echo -e "   ⚠  登录后请立即修改密码。${NC}"
    echo ""
fi

# Management hints tailored to how we actually started it
case "$BG_MODE" in
    systemd)
        echo -e "${CYAN}Service management / 服务管理：${NC}"
        echo -e "  ${GREEN}systemctl --user status clawdeckx${NC}   - Status / 查看状态"
        echo -e "  ${GREEN}systemctl --user stop clawdeckx${NC}     - Stop / 停止"
        echo -e "  ${GREEN}systemctl --user restart clawdeckx${NC}  - Restart / 重启"
        ;;
    nohup)
        echo -e "${CYAN}Process management / 进程管理：${NC}"
        echo -e "  ${GREEN}cat $DATA_DIR/clawdeckx.pid${NC}         - Show PID / 查看 PID"
        echo -e "  ${GREEN}tail -f $DATA_DIR/ClawDeckX.log${NC}     - Follow logs / 查看日志"
        echo -e "  ${GREEN}kill \$(cat $DATA_DIR/clawdeckx.pid)${NC} - Stop / 停止"
        ;;
esac

exit 0
