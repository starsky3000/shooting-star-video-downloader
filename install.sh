#!/bin/bash
#
# StarDownload Installer for macOS
# This script installs the native host and registers it with Chrome
#

set -e

echo "======================================"
echo "  StarDownload 安装脚本"
echo "======================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running on macOS
if [[ "$(uname)" != "Darwin" ]]; then
    echo -e "${RED}错误：此脚本仅支持 macOS 系统${NC}"
    exit 1
fi

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NATIVE_DIR="$SCRIPT_DIR/native"

echo "检测 Homebrew..."
if ! command -v brew &> /dev/null; then
    echo -e "${YELLOW}Homebrew 未安装，是否安装？${NC}"
    read -p "按回车键安装，或 Ctrl+C 取消..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

echo ""
echo "安装 yt-dlp 和 ffmpeg..."
brew install yt-dlp ffmpeg

echo ""
echo "复制原生主机程序到 /usr/local/bin/..."
if [ -f "$NATIVE_DIR/stardownload.py" ]; then
    cp "$NATIVE_DIR/stardownload.py" /usr/local/bin/stardownload
    chmod +x /usr/local/bin/stardownload
    echo -e "${GREEN}✓ 已安装 stardownload 到 /usr/local/bin/${NC}"
else
    echo -e "${RED}错误：找不到 stardownload.py${NC}"
    exit 1
fi

echo ""
echo "======================================"
echo -e "${GREEN}  安装完成！${NC}"
echo "======================================"
echo ""
echo "接下来的步骤："
echo ""
echo "步骤 1: 加载扩展"
echo "  1. 打开 Chrome，进入 chrome://extensions/"
echo "  2. 开启右上角的「开发者模式」"
echo "  3. 点击「加载已解压的扩展程序」"
echo "  4. 选择 $SCRIPT_DIR 目录"
echo "  5. 将扩展图标固定到工具栏"
echo "  6. 复制扩展的 ID（32位字母）"
echo ""
echo "步骤 2: 打包扩展（生成固定 ID）"
echo "  1. 在扩展页面点击「打包扩展程序」"
echo "  2. 选择扩展目录 $SCRIPT_DIR"
echo "  3. 点击打包，会生成 .crx 和 .pem 私钥文件"
echo "  4. 卸载未打包的扩展"
echo "  5. 拖入 .crx 文件安装打包后的扩展"
echo ""
echo "步骤 3: 注册 Native Messaging Host"
echo "  1. 编辑 ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.stardownload.host.json"
echo "  2. 将 <YOUR_EXTENSION_ID> 替换为实际的扩展 ID"
echo ""
echo "示例配置："
echo '{'
echo '  "name": "com.stardownload.host",'
echo '  "path": "/usr/local/bin/stardownload",'
echo '  "type": "stdio",'
echo '  "allowed_origins": ['
echo '    "chrome-extension://这里填扩展ID/"'
echo '  ]'
echo '}'