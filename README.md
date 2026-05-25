# Shooting Star Downloader（流星视频下载）

一键下载 YouTube 视频的浏览器扩展，所有处理均在本地完成。

> 目前支持 Chromium 内核浏览器，如 Microsoft Edge、Google Chrome、360 安全浏览器，支持 Windows 和 macOS 平台

## 功能

- 打开 YouTube 视频页面，点击扩展图标，选择画质即可下载
- 支持 4K / 1080P / 720P 等多种画质，也支持仅下载音频
- 自动合并视频流和音频流，输出完整的 MP4 文件
- 实时显示下载进度，支持暂停和恢复
- 下载完成后可在扩展内直接播放或打开文件所在文件夹
- 支持中英文界面切换

## 界面截图

<img src="screenshots/main.jpg" alt="主界面" width="400">
<img src="screenshots/choose-format.jpg" alt="选择格式" width="400">
<img src="screenshots/downloading.jpg" alt="下载中" width="400">

## 原理

```
YouTube 页面 → 扩展获取视频信息 → Native Messaging → 本地 Python 脚本 → yt-dlp 下载 + FFmpeg 合并 → 保存到本地
```

1. 扩展从 YouTube 页面提取视频标题和可用格式
2. 用户选择画质后，扩展通过 Chrome Native Messaging 将下载指令传给本机的 `stardownload.py`
3. `stardownload.py` 调用 yt-dlp 下载视频流和音频流
4. 下载完成后调用 FFmpeg 合并为完整视频
5. 视频保存到 `~/Downloads` 目录

全程在本地执行，不会上传任何用户数据。

## 安装

### 从商店安装（推荐）

[![Edge Add-ons](https://img.shields.io/badge/Edge%20Add--ons-%E6%B5%81%E6%98%9F%E8%A7%86%E9%A2%91%E4%B8%8B%E8%BD%BD-0078D7?logo=microsoftedge)](https://microsoftedge.microsoft.com/addons/detail/%E6%B5%81%E6%98%9F%E8%A7%86%E9%A2%91%E4%B8%8B%E8%BD%BD/jflocelmhojnkfdiohkoaeepedilngjc)

> 首次使用时会自动弹出安装引导，引导下载两个安装文件，然后复制命令到终端里运行一键安装 yt-dlp 和 FFmpeg

### 开发者模式加载

1. 克隆本项目
2. 打开Chromium浏览器，进入 `chrome://extensions/`
3. 开启「开发者模式」
4. 点击「加载已解压的扩展程序」，选择本项目目录

## 项目结构

```
├── manifest.json           # 扩展配置
├── background.js           # Service Worker
├── content/
│   └── content.js          # YouTube 页面内容脚本
├── popup/
│   ├── popup.html          # 弹出窗口
│   ├── popup.js            # 弹出窗口逻辑
│   ├── popup.css           # 弹出窗口样式
│   └── i18n.js             # 国际化模块
├── locales/                # 多语言文件
│   ├── en.json
│   └── zh_CN.json
├── _locales/               # Chrome 商店多语言
│   ├── en/messages.json
│   └── zh_CN/messages.json
├── native/
│   └── stardownload.py     # Native Messaging Host（Python）
├── icons/                  # 扩展图标
├── install.sh              # macOS 安装脚本
└── install.ps1             # Windows 安装脚本
```

## 致谢

本工具基于以下开源项目构建：

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — 视频解析与下载引擎
- [FFmpeg](https://ffmpeg.org) — 音视频合并处理

## License

本项目基于 MIT 协议开源，详见 [LICENSE](LICENSE)。
