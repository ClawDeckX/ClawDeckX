#!/bin/bash
set -e

# ==============================================================================
# ClawDeckX - One-Click Launcher
# ==============================================================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Installation paths - prefer current directory
BINARY_NAME="clawdeckx"
DEFAULT_PORT=18791
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
ExecStart=$INSTALLED_BINARY
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
LATEST_VERSION_RAW=$(curl -s $API_URL | grep '"tag_name"' | cut -d '"' -f 4)
if [ -z "$LATEST_VERSION_RAW" ]; then
    LATEST_VERSION_RAW="latest"
fi
# Remove 'v' prefix for display and comparison
LATEST_VERSION="${LATEST_VERSION_RAW#v}"

echo -e "${CYAN}:: ClawDeckX Launcher - ${LATEST_VERSION} ::${NC}"
echo ""

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
            exec "$0" "$@"
        fi
        
        if [ "$MODE" = "1" ]; then
            # Quick uninstall - remove everything
            echo ""
            echo -e "${CYAN}Quick uninstall will remove: / 快速卸载将删除：${NC}"
            echo "  - $INSTALLED_LOCATION (binary / 二进制文件)"
            
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
            echo "  - Binary / 二进制文件：${RED}will be removed / 将被删除${NC}"
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
    
    # Remove binary (handle relative path)
    if [[ "$INSTALLED_LOCATION" == ./* ]]; then
        rm -f "$INSTALLED_LOCATION"
    else
        rm -f "$INSTALLED_LOCATION"
    fi
    echo -e "${GREEN}✓ Removed binary / 已删除二进制文件${NC}"
    
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
    pid=$(ss -tlnp 2>/dev/null | grep ":${port} " | grep -oP 'pid=\K[0-9]+' | head -1)
    if [ -z "$pid" ]; then
        # Fallback: try lsof
        pid=$(lsof -ti :"$port" 2>/dev/null | head -1)
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
            echo -e "${CYAN}Falling back to direct binary start... / 回退到直接启动二进制文件...${NC}"
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
    echo -e "${BLUE}Starting binary... / 正在启动二进制文件...${NC}"
    "$INSTALLED_LOCATION" > /dev/null 2>"$err_file" &
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
    
    # Get download URL for update
    API_URL="https://api.github.com/repos/$REPO/releases/latest"
    ASSET_PATTERN="clawdeckx-${OS}-${ARCH}"
    DOWNLOAD_URL=$(curl -s $API_URL | grep "browser_download_url" | grep "$ASSET_PATTERN" | cut -d '"' -f 4)
    
    if [ -z "$DOWNLOAD_URL" ]; then
        echo -e "${RED}Error: Could not find download URL for $OS/$ARCH${NC}"
        exit 1
    fi
    
    if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
        echo -e "${GREEN}✓ Already up to date! / 已经是最新版本！${NC}"
        echo ""
        echo -n "Force re-download? / 强制重新下载？ [y/N] "
        read -n 1 -r </dev/tty
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 0
        fi
    else
        echo -n "Proceed with update? / 确认更新？ [Y/n] "
        read -n 1 -r </dev/tty
        echo
        if [[ $REPLY =~ ^[Nn]$ ]]; then
            exit 0
        fi
    fi
    
    # Check if ClawDeckX is currently running
    echo ""
    if check_process_running; then
        echo -e "${YELLOW}⚠ ClawDeckX is currently running / ClawDeckX 正在运行${NC}"
        echo -e "${YELLOW}The program needs to be stopped before updating. / 更新前需要停止程序。${NC}"
        echo ""
        echo -n "Stop ClawDeckX now and continue update? / 立即停止 ClawDeckX 并继续更新？ [Y/n] "
        read -n 1 -r </dev/tty
        echo
        if [[ $REPLY =~ ^[Nn]$ ]]; then
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
    
    # Download the update
    curl -L -o "$INSTALLED_LOCATION" "$DOWNLOAD_URL" --progress-bar
    
    # Make executable
    chmod +x "$INSTALLED_LOCATION"
    echo -e "${GREEN}✓ Download complete! / 下载完成${NC}"
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✅ Update complete! / 更新完成！${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    
    # Ask if user wants to restart ClawDeckX
    echo -n "Start ClawDeckX now? / 立即启动 ClawDeckX？ [Y/n] "
    read -n 1 -r </dev/tty
    echo
    
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        start_clawdeckx
        
        # Show access URL if running
        if check_process_running; then
            echo ""
            echo -e "${CYAN}You can access ClawDeckX at: / 可以访问 ClawDeckX：${NC}"
            echo -e "  ${GREEN}http://localhost:${PORT}${NC}"
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

# Check if already installed
if check_installed; then
    # Resolve port from config file
    get_config_port
    
    echo -e "${GREEN}✓ ClawDeckX is already installed / ClawDeckX 已安装${NC}"
    echo -e "${CYAN}Location / 位置：${NC} $INSTALLED_LOCATION"
    echo -e "${CYAN}Current version / 当前版本：${NC} $CURRENT_VERSION"
    echo -e "${CYAN}Latest version / 最新版本：${NC} $LATEST_VERSION"
    echo -e "${CYAN}Port / 端口：${NC} $PORT"
    
    # Check systemd service status
    SERVICE_RUNNING=false
    if check_systemd_service; then
        echo -e "${CYAN}Systemd service / systemd 服务：${NC} ${GREEN}Installed${NC} ($SYSTEMD_SERVICE_TYPE-level)"
        # Check if service is active/running
        if [ "$SYSTEMD_SERVICE_TYPE" = "user" ]; then
            if systemctl --user is-active --quiet clawdeckx 2>/dev/null; then
                SERVICE_RUNNING=true
                echo -e "${CYAN}Service status / 服务状态：${NC} ${GREEN}Running / 运行中${NC}"
            else
                echo -e "${CYAN}Service status / 服务状态：${NC} ${YELLOW}Stopped / 已停止${NC}"
            fi
        else
            if systemctl is-active --quiet clawdeckx 2>/dev/null; then
                SERVICE_RUNNING=true
                echo -e "${CYAN}Service status / 服务状态：${NC} ${GREEN}Running / 运行中${NC}"
            else
                echo -e "${CYAN}Service status / 服务状态：${NC} ${YELLOW}Stopped / 已停止${NC}"
            fi
        fi
    fi
    
    echo ""
    
    # Check if update is available
    IS_LATEST=false
    if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
        IS_LATEST=true
    fi
    
    # Show menu based on version status and service state
    if [ "$IS_LATEST" = true ]; then
        echo -e "${GREEN}✓ Already up to date! / 已是最新版本！${NC}"
        echo ""
        echo -e "${YELLOW}What would you like to do? / 您想做什么？${NC}"
        echo "  1) Re-download current version / 重新下载当前版本"
        
        # Show service management options based on status
        if [ "$SERVICE_RUNNING" = true ]; then
            echo "  2) Stop service / 停止服务"
            echo "  3) Uninstall / 卸载"
            echo "  4) Exit / 退出"
        else
            # Service installed but stopped
            if check_systemd_service; then
                echo "  2) Start service / 启动服务"
                echo "  3) Uninstall / 卸载"
                echo "  4) Exit / 退出"
            else
                echo "  2) Uninstall / 卸载"
                echo "  3) Exit / 退出"
            fi
        fi
    else
        echo -e "${YELLOW}New version available! / 有新版本可用！${NC}"
        echo ""
        echo -e "${YELLOW}What would you like to do? / 您想做什么？${NC}"
        echo "  1) Update to latest version / 更新到最新版本"
        
        # Show service management options based on status
        if [ "$SERVICE_RUNNING" = true ]; then
            echo "  2) Stop service / 停止服务"
            echo "  3) Uninstall / 卸载"
            echo "  4) Exit / 退出"
        else
            # Service installed but stopped
            if check_systemd_service; then
                echo "  2) Start service / 启动服务"
                echo "  3) Uninstall / 卸载"
                echo "  4) Exit / 退出"
            else
                echo "  2) Uninstall / 卸载"
                echo "  3) Exit / 退出"
            fi
        fi
    fi
    echo ""
    echo -n "Enter your choice [1-4] / 输入选择 [1-4]: "
    read -n 1 -r CHOICE </dev/tty
    echo
    
    # Handle empty input
    if [ -z "$CHOICE" ]; then
        echo -e "${RED}Invalid input. Please enter a number between 1-4. / 输入无效，请输入 1-4 之间的数字。${NC}"
        echo -e "${YELLOW}Press any key to continue... / 按任意键继续...${NC}"
        read -n 1 -s </dev/tty
        exec "$0" "$@"
    fi
    
    case $CHOICE in
        1)
            update
            ;;
        2)
            if [ "$SERVICE_RUNNING" = true ]; then
                stop_service
                exit 0
            elif check_systemd_service; then
                # Start service
                echo ""
                echo -e "${BLUE}Starting systemd service... / 正在启动 systemd 服务...${NC}"
                if [ "$SYSTEMD_SERVICE_TYPE" = "user" ]; then
                    systemctl --user start clawdeckx
                else
                    sudo systemctl start clawdeckx
                fi
                
                # Check if started successfully
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
                echo -e "${CYAN}You can access ClawDeckX at: / 可以访问 ClawDeckX：${NC}"
                echo -e "  ${GREEN}http://localhost:${PORT}${NC}"
                echo ""
                echo -e "${YELLOW}Service management commands / 服务管理命令：${NC}"
                echo -e "  ${GREEN}systemctl --user status clawdeckx${NC}   - Check status / 查看状态"
                echo -e "  ${GREEN}systemctl --user stop clawdeckx${NC}     - Stop service / 停止服务"
                exit 0
            else
                uninstall
            fi
            ;;
        3)
            # Always uninstall (option 3 is always "Uninstall")
            uninstall
            ;;
        4)
            # Exit
            echo -e "${YELLOW}Exiting / 退出${NC}"
            exit 0
            ;;
        *)
            # Invalid input
            echo -e "${RED}Invalid choice. Please enter a number between 1-4. / 选择无效，请输入 1-4 之间的数字。${NC}"
            echo -e "${YELLOW}Press any key to continue... / 按任意键继续...${NC}"
            read -n 1 -s </dev/tty
            exec "$0" "$@"
            ;;
    esac
fi

# 0. Check root user
if [ "$(id -u)" = "0" ]; then
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
        
        # 创建用户（无密码模式，稍后设置）
        adduser --gecos "" --disabled-password openclaw
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

# 2. Define Download URL (GitHub Releases)
# REPO 和 API_URL 已在脚本开头定义

echo -e "${YELLOW}Fetching latest release info... (${LATEST_VERSION})${NC}"

# Use curl to get the download URL for the specific asset
# Asset name convention: ClawDeckX-{os}-{arch} (e.g., ClawDeckX-linux-amd64)
# If on macOS, the binary might be named ClawDeckX-darwin-amd64 or similar.
# Adjusting based on standard Go build naming.
BINARY_NAME="clawdeckx"
ASSET_PATTERN="clawdeckx-${OS}-${ARCH}"

# Fallback for Windows (if run in git bash/wsl)
if [[ "$OS" == *"mingw"* || "$OS" == *"cygwin"* ]]; then
    OS="windows"
    ASSET_PATTERN="clawdeckx-windows-${ARCH}.exe"
    BINARY_NAME="clawdeckx.exe"
fi

DOWNLOAD_URL=$(curl -s $API_URL | grep "browser_download_url" | grep "$ASSET_PATTERN" | cut -d '"' -f 4)

if [ -z "$DOWNLOAD_URL" ]; then
    echo -e "${RED}Error: Could not find a release asset for $OS/$ARCH${NC}"
    echo "This might be because:"
    echo "1. No release has been published yet."
    echo "2. The asset naming does not match '$ASSET_PATTERN'."
    exit 1
fi

echo -e "${GREEN}✓ Found asset:${NC} $DOWNLOAD_URL"

# 3. Download - use $(pwd) to get current working directory
INSTALLED_BINARY="$(pwd)/$BINARY_NAME"
echo -e "${YELLOW}Downloading $BINARY_NAME ...${NC}"
curl -L -o "$INSTALLED_BINARY" "$DOWNLOAD_URL" --progress-bar

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
echo -e "${CYAN}Binary location / 二进制文件位置：${NC} $INSTALLED_BINARY"
echo -e "${CYAN}Config & Data directory / 配置和数据目录：${NC} $(dirname "$INSTALLED_BINARY")/data"
echo ""
echo -e "${GREEN}✓ Installed in current directory / 已安装在当前目录${NC}"
echo ""

# Ask if user wants to install systemd service
SERVICE_JUST_INSTALLED=false
if ! check_systemd_service; then
    echo -e "${YELLOW}Would you like to install auto-start service?"
    echo -e "是否安装自动启动服务？（系统重启后自动运行）${NC}"
    echo -n "Install auto-start service? / 安装自动启动服务？ [Y/n] "
    read -n 1 -r </dev/tty
    echo
    
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
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

echo -n "Start ClawDeckX now? / 立即启动 ClawDeckX？ [Y/n] "
read -n 1 -r </dev/tty
echo

if [[ $REPLY =~ ^[Nn]$ ]]; then
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

# 6. Run with arguments
echo -e "${BLUE}>> Starting ClawDeckX...${NC}"
echo "----------------------------------------"
"$INSTALLED_BINARY" "$@"
