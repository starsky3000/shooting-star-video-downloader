# StarDownload - YouTube 视频下载 Chrome 扩展

一键下载 YouTube 视频，自动继承浏览器登录状态和代理设置。

## 功能特性

- **免密码下载**：自动使用 Chrome 中已登录的 YouTube Cookie
- **免终端操作**：所有操作在浏览器内完成
- **代理支持**：支持配置代理服务器
- **画质选择**：支持最高画质/4K/1080p/720p/480p/仅音频
- **进度显示**：实时显示下载进度
- **自动合并**：使用 ffmpeg 自动合并视频和音频

## 安装步骤

### 1. 运行安装脚本

```bash
chmod +x install.sh
./install.sh
```

此脚本会：
- 安装 Homebrew（如未安装）
- 安装 yt-dlp 和 ffmpeg
- 复制原生主机程序到 `/usr/local/bin/`

### 2. 加载 Chrome 扩展

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目目录
5. 将扩展图标固定到工具栏
6. **复制扩展的 ID**（用于下一步配置）

### 3. 打包扩展（推荐）

打包后的扩展拥有固定 ID，更便于配置 Native Messaging。

1. 在扩展页面点击「打包扩展程序」
2. 选择扩展目录（项目根目录）
3. 点击打包，生成 `.crx` 文件和 `.pem` 私钥
4. 卸载未打包的扩展
5. 将 `.crx` 文件拖入 Chrome 扩展页面安装

> 保留好 `.pem` 私钥，后续更新扩展时需要用同一个私钥打包，才能保持扩展 ID 不变。

### 4. 配置 Native Messaging Host

1. 创建配置文件：

```bash
mkdir -p ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts
```

2. 编辑配置文件，将 `<YOUR_EXTENSION_ID>` 替换为实际扩展 ID：

```bash
cat > ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.stardownload.host.json << 'EOF'
{
  "name": "com.stardownload.host",
  "description": "StarDownload Native Host for YouTube Downloads",
  "path": "/usr/local/bin/stardownload",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://<YOUR_EXTENSION_ID>/"
  ]
}
EOF
```

扩展 ID 形如：`abcdefghijklmnopqrstuvwxyzabcdef`

## 使用方法

1. 打开 YouTube 视频页面
2. 点击工具栏中的 StarDownload 图标
3. 弹窗会显示视频封面和标题
4. 选择画质，点击「下载」
5. 等待下载完成，可点击「播放视频」或「打开文件夹」

## 项目结构

```
StarDownload/
├── manifest.json          # Chrome 扩展配置
├── background.js         # 后台服务脚本
├── content/
│   └── content.js        # 内容脚本（注入 YouTube 页面）
├── popup/
│   ├── popup.html        # 弹窗界面
│   ├── popup.js          # 弹窗逻辑
│   └── popup.css         # 弹窗样式
├── options/
│   ├── options.html      # 设置页面
│   ├── options.js        # 设置逻辑
│   └── options.css       # 设置样式
├── icons/                # 扩展图标
├── native/
│   ├── stardownload.py   # 原生主机程序
│   └── com.stardownload.host.json  # Native Messaging 配置模板
└── install.sh            # 安装脚本
```

## 系统要求

- macOS 10.15+
- Chrome 浏览器
- Homebrew（用于安装依赖）
- yt-dlp
- ffmpeg

## 更新 yt-dlp

```bash
yt-dlp -U
```

## 故障排除

### 下载失败

1. 确保 yt-dlp 和 ffmpeg 已正确安装：
   ```bash
   which yt-dlp
   which ffmpeg
   ```

2. 确保 Chrome 扩展 ID 已正确配置到 native messaging host

3. 检查 yt-dlp 是否需要更新：
   ```bash
   yt-dlp -U
   ```

### 无法读取 Cookie

确保 Chrome 已登录 YouTube，并尝试重启 Chrome。

## 更新日志

### V1.1.2 — 下载合并 & 图标优化

1. **下载合并修复**：新增 `get_ffmpeg_path()` 自动查找 ffmpeg 并传给 yt-dlp，确保视频+音频流正确合并成单个 MP4 文件；优化 `find_downloaded_file()` 按文件大小+时间找合并后的输出文件
2. **图标智能切换**：content.js 主动检测视频页并通知 background，非 YouTube 页面保持灰色图标，YouTube 视频页后台获取信息后自动变绿色，用户无需等待即可下载
3. **已下载视频列表优化**：标题显示 2 行超出省略；第三行显示分辨率 · 格式 · 文件大小（< 1GB 显示 MB，≥1GB 显示 X.XG）
4. **图标按钮**：播放按钮改为 ▶ 三角图标，文件夹按钮改为 📁 图标
5. **视频标题优化**：当前视频标题置顶对齐，最多显示 4 行
6. **画质标签**：最高画质后显示"最高画质"替代"推荐"

### V1.1.1 — 下载优化 & UI 改进

1. **下载格式修复**：强制使用 MP4/M4A 格式，确保下载视频包含画面和声音，非 WebM 纯音频
2. **图标显示优化**：只在 YouTube 视频页且视频数据可用时才显示绿色图标，其它情况显示灰色
3. **消除弹窗闪烁**：已有缓存视频信息时直接展示，不再闪现 loading 界面
4. **已下载列表优化**：第二行显示格式、分辨率、文件大小（如 `MP4 · 1080P · 128MB`）；播放按钮改为绿色
5. **隐藏进度条**：下载开始前隐藏进度条区域，仅在下载时显示
6. **提示文字居中**："请在视频播放页打开扩展" 水平居中
7. **画质标签**：2160P 显示为 4K
8. **文件名优化**：yt-dlp 格式选择器精确匹配 MP4 流，避免文件名出现格式 ID 后缀

### V1.1.0 — 精简安装引导

**问题**：旧版安装命令将 `stardownload.py`（576行）嵌入 shell 命令中，导致命令极长（~600行），用户手动复制粘贴时内容不完整，且在 zsh 终端出现 heredoc 挂起、路径换行截断等问题。

**方案**：将安装改为「下载文件 + 运行脚本」模式，彻底避免终端粘贴问题。

**改动文件**：

| 文件 | 改动 |
|------|------|
| `popup/popup.html` | 替换复制命令区为两个下载按钮 + `bash` 运行提示 + 复制按钮 |
| `popup/popup.js` | 新增 `generateInstallScript()` 生成 install.sh、新增 `downloadStardownloadPy()` / `downloadInstallScript()` 下载功能、精简 `showSetupUI()` |
| `popup/popup.css` | 新增 `.install-script-btn`、`.run-command-row`、`.copy-cmd-btn`、`.setup-desc code` 样式 |

**安装流程**：

1. 打开弹窗 → 检测到 Native Host 未安装 → 显示安装引导
2. 点击 **"1. 下载 stardownload.py"** → 保存到 `~/Downloads/`
3. 点击 **"2. 下载 install.sh"** → 保存到 `~/Downloads/`
4. 终端运行 `bash ~/Downloads/install.sh`
5. 退出浏览器重新打开即可

**install.sh 功能**：

- 自动检测系统中所有 Chromium 内核浏览器（Chrome / Chromium / Brave / Edge / Vivaldi / 360Chrome）
- **向所有检测到的浏览器目录写入** Native Messaging JSON 配置（不再只写第一个）
- JSON 中 `path` 字段自动展开为实际路径（非 `${HOME}` 占位符）
- 将 `stardownload.py` 部署到 `~/.local/bin/stardownload`
- 安装 yt-dlp 和 ffmpeg（支持 brew / pipx / pip3 多种方式）

**设计要点**：

- `install.sh` 在 popup.js 中动态生成，扩展 ID 自动填入，无需用户手动替换
- `stardownload.py` 和 `install.sh` 均从扩展自身提供，通过 Blob URL 下载，**无需外部服务器**
- `install.sh` 使用**无引号 heredoc**（`<< JSONEOF`），让 bash 自动展开 `${HOME}` 为实际路径，避免 sed 替换路径的复杂转义问题

## License

MIT