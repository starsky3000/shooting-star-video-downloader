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

## License

MIT