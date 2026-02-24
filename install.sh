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

echo -e "${BLUE}
  ___                  ___ _               ___         _   
 / _ \ _ __  ___ _ _  / __| |__ ___ __ __ |   \ ___ __| |__
| (_) | '_ \/ -_) ' \| (__| / _\` \ V  V / | |) / -_) _| / /
 \___/| .__/\___|_||_|\___|_\__,_|\_/\_/  |___/\___\__|_\_\\
      |_|                                                  
${NC}"

# 获取最新版本号
REPO="ClawDeckX/ClawDeckX"
API_URL="https://api.github.com/repos/$REPO/releases/latest"
LATEST_VERSION=$(curl -s $API_URL | grep '"tag_name"' | cut -d '"' -f 4)
if [ -z "$LATEST_VERSION" ]; then
    LATEST_VERSION="latest"
fi

echo -e "${CYAN}:: ClawDeckX Launcher - ${LATEST_VERSION} ::${NC}"
echo ""

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
        
        # 设置密码
        echo ""
        echo -e "${YELLOW}Please set password for 'openclaw' (enter twice):"
        echo -e "请为 'openclaw' 设置密码（需输入两次）：${NC}"
        passwd openclaw </dev/tty
        
        # 添加到 sudo 组
        usermod -aG sudo openclaw
        echo -e "${GREEN}✓ Added to sudo group / 已添加到 sudo 组${NC}"
        
        # 配置 NOPASSWD
        echo 'openclaw ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/openclaw
        chmod 440 /etc/sudoers.d/openclaw
        echo -e "${GREEN}✓ Configured NOPASSWD sudo / 已配置免密 sudo${NC}"
        
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
BINARY_NAME="ClawDeckX"
ASSET_PATTERN="ClawDeckX-${OS}-${ARCH}"

# Fallback for Windows (if run in git bash/wsl)
if [[ "$OS" == *"mingw"* || "$OS" == *"cygwin"* ]]; then
    OS="windows"
    ASSET_PATTERN="ClawDeckX-windows-${ARCH}.exe"
    BINARY_NAME="ClawDeckX.exe"
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

# 3. Download
echo -e "${YELLOW}Downloading $BINARY_NAME ...${NC}"
curl -L -o "$BINARY_NAME" "$DOWNLOAD_URL" --progress-bar

# 4. Make Executable
chmod +x "$BINARY_NAME"
echo -e "${GREEN}✓ Download complete!${NC}"

# 5. Run with arguments
echo -e "${BLUE}>> Starting OpenClaw Deck...${NC}"
echo "----------------------------------------"
./"$BINARY_NAME" "$@"
