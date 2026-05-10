// StarDownload Popup Script

let currentVideoInfo = null;
let downloadComplete = false;
let currentVideoId = null; // Track current video to persist state

// DOM Elements
const thumbnail = document.getElementById('thumbnail');
const videoTitle = document.getElementById('videoTitle');
const qualitySelect = document.getElementById('qualitySelect');
const downloadBtn = document.getElementById('downloadBtn');
const btnText = document.getElementById('btnText');
const progressSection = document.getElementById('progressSection');
const progressBar = document.getElementById('progressBar');
const statusText = document.getElementById('statusText');
const completionSection = document.getElementById('completionSection');
const successText = document.getElementById('successText');
const filePath = document.getElementById('filePath');
const playBtn = document.getElementById('playBtn');
const openFolderBtn = document.getElementById('openFolderBtn');
const errorSection = document.getElementById('errorSection');
const errorMessage = document.getElementById('errorMessage');
const retryBtn = document.getElementById('retryBtn');

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  log('Popup starting');
  // Check if on YouTube video page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  log(`Tab URL: ${tab.url}`);

  if (!tab.url || !tab.url.includes('youtube.com/watch')) {
    log('Not a YouTube watch page');
    showError('请在 YouTube 视频页面使用此扩展');
    return;
  }

  // Get video info from content script
  log('Sending getVideoInfo message');
  const response = await chrome.tabs.sendMessage(tab.id, { action: 'getVideoInfo' }).catch(err => {
    log(`sendMessage catch: ${err.message}`);
    return { success: false, data: null };
  });
  log(`Response: ${JSON.stringify(response)}`);

  if (response && response.success && response.data) {
    log('Video info success');
    currentVideoInfo = response.data;
    log(`Video title: ${currentVideoInfo.title}`);

    const urlParams = new URLSearchParams(new URL(currentVideoInfo.url).search);
    const videoId = urlParams.get('v');
    log(`Video ID: ${videoId}`);

    currentVideoId = videoId;
    displayVideoInfo(currentVideoInfo);
    setDownloadReadyState();
    log('Setup complete');
  } else {
    log('Video info failed');
    showError('无法获取视频信息，请刷新页面后重试');
    setDownloadReadyState();
  }

  // Set up event listeners
  downloadBtn.addEventListener('click', startDownload);
  playBtn.addEventListener('click', playVideo);
  openFolderBtn.addEventListener('click', openFolder);
  retryBtn.addEventListener('click', resetState);
  log('Event listeners set up');
});

// Restore previous state for same video
async function restoreState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getDownloadState' });
    log(`restoreState: status=${response?.status}, videoId=${response?.videoId}`);

    if (response && response.status === 'downloading') {
      // Can't verify if download is still running - native messaging is stateless
      // Show interrupted error since popup was closed
      showError('下载中断，请重试');
      log(`restoreState: showing interrupted error`);
    } else if (response && response.status === 'complete') {
      showCompletion(response.filePath);
      log(`restoreState: showing complete state`);
    } else if (response && response.status === 'error') {
      showError(response.errorMessage || '下载失败');
      log(`restoreState: showing error state`);
    } else {
      // idle - show ready
      displayVideoInfo(currentVideoInfo);
      setDownloadReadyState();
      log(`restoreState: showing ready state`);
    }
  } catch (err) {
    log(`restoreState: error ${err}`);
    displayVideoInfo(currentVideoInfo);
    setDownloadReadyState();
  }
}

// Add logging helper
function log(msg) {
  console.log(`[StarDownload Popup] ${msg}`);
}

// Display video information
function displayVideoInfo(info) {
  thumbnail.src = info.thumbnail;
  videoTitle.textContent = info.title;
}

// Start download process
async function startDownload() {
  log('startDownload called');
  if (!currentVideoInfo) {
    log('No video info, showing error');
    showError('视频信息无效');
    return;
  }

  log('Setting downloading state');
  setDownloadingState();

  const quality = qualitySelect.value;
  log(`Quality selected: ${quality}`);
  const downloadRequest = {
    action: 'download',
    url: currentVideoInfo.url,
    title: currentVideoInfo.title,
    quality: quality
  };
  log(`Download request: ${JSON.stringify(downloadRequest)}`);

  try {
    log('Connecting to native host');
    // Set up port for native messaging
    const port = chrome.runtime.connectNative('com.stardownload.host');
    log('Native port connected');

    port.onMessage.addListener((response) => {
      log(`Native message: ${JSON.stringify(response)}`);
      handleNativeMessage(response);
    });

    port.onDisconnect.addListener(() => {
      log('Native port disconnected');
      if (!downloadComplete) {
        showError('连接中断，请重试');
      }
    });

    // Send download request
    log('Sending download request');
    port.postMessage(downloadRequest);
    log('Download request sent');

  } catch (err) {
    log(`startDownload error: ${err.message}`);
    showError('无法启动下载：' + err.message);
  }
}

// Handle messages from native host
function handleNativeMessage(message) {
  switch (message.type) {
    case 'progress':
      updateProgress(message.percent, message.status);
      // Send progress to background to persist
      chrome.runtime.sendMessage({
        type: 'downloadProgress',
        percent: message.percent,
        status: message.status,
        videoId: currentVideoId
      }).catch(() => {});
      break;
    case 'complete':
      downloadComplete = true;
      showCompletion(message.filePath);
      chrome.runtime.sendMessage({
        type: 'downloadComplete',
        filePath: message.filePath,
        videoId: currentVideoId
      }).catch(() => {});
      break;
    case 'error':
      downloadComplete = true;
      showError(message.message);
      // Check if this is a yt-dlp issue that needs updating
      if (message.message && message.message.includes('format is not available')) {
        // Try to update yt-dlp
        setDownloadingState();
        statusText.textContent = '正在检查 yt-dlp 版本...';
        tryUpdateYtDlp();
      }
      chrome.runtime.sendMessage({
        type: 'downloadError',
        message: message.message,
        videoId: currentVideoId
      }).catch(() => {});
      break;
  }
}

// Try to update yt-dlp after download failure
async function tryUpdateYtDlp() {
  try {
    const port = chrome.runtime.connectNative('com.stardownload.host');
    port.onMessage.addListener((response) => {
      if (response.type === 'versionCheck') {
        if (response.needsUpdate) {
          statusText.textContent = '正在更新 yt-dlp...';
        } else {
          showError('视频格式不可用，可能是 YouTube 限制');
        }
      } else if (response.type === 'updateComplete') {
        port.disconnect();
        if (response.success) {
          showError('yt-dlp 已更新，请重试下载');
        } else {
          showError('yt-dlp 更新失败，请手动更新: pipx install yt-dlp');
        }
      }
    });
    port.postMessage({ action: 'checkAndUpdate' });
    port.onDisconnect.addListener(() => {});
  } catch (err) {
    showError('无法检查 yt-dlp 版本');
  }
}

// Update progress display
function updateProgress(percent, status) {
  progressBar.style.width = `${percent}%`;
  statusText.textContent = status || `下载中... ${percent.toFixed(1)}%`;
}

// Show completion state
function showCompletion(path) {
  progressSection.style.display = 'none';
  errorSection.style.display = 'none';
  completionSection.style.display = 'block';
  filePath.textContent = path;
  downloadComplete = true;
}

// Show error state
function showError(message) {
  log(`showError called: ${message}`);
  progressSection.style.display = 'none';
  completionSection.style.display = 'none';
  errorSection.style.display = 'block';
  errorMessage.textContent = message;
  downloadBtn.disabled = false;
  btnText.textContent = '下载';
}

// Set downloading state
function setDownloadingState() {
  downloadBtn.disabled = true;
  btnText.textContent = '正在准备下载...';
  progressSection.style.display = 'block';
  progressBar.style.width = '0%';
  statusText.textContent = '正在解析视频信息...';
  completionSection.style.display = 'none';
  errorSection.style.display = 'none';
}

// Reset to initial state
function resetState() {
  downloadBtn.disabled = false;
  btnText.textContent = '下载';
  progressSection.style.display = 'block';
  progressBar.style.width = '0%';
  statusText.textContent = '准备就绪';
  errorSection.style.display = 'none';
  downloadComplete = false;
}

// Set download ready state
function setDownloadReadyState() {
  log('setDownloadReadyState called');
  downloadBtn.disabled = false;
  btnText.textContent = '下载';
  progressSection.style.display = 'block';
  progressBar.style.width = '0%';
  statusText.textContent = '准备就绪';
  completionSection.style.display = 'none';
  errorSection.style.display = 'none';
}

// Play video (via native host)
async function playVideo() {
  try {
    const port = chrome.runtime.connectNative('com.stardownload.host');
    port.postMessage({
      action: 'openFile',
      filePath: filePath.textContent
    });
    port.disconnect();
  } catch (err) {
    showError('无法打开视频：' + err.message);
  }
}

// Open folder (via native host)
async function openFolder() {
  log('openFolder called, filePath: ' + filePath.textContent);
  try {
    const port = chrome.runtime.connectNative('com.stardownload.host');
    port.onMessage.addListener((response) => {
      log(`openFolder response: ${JSON.stringify(response)}`);
    });
    port.onDisconnect.addListener(() => {
      log('openFolder port disconnected');
    });
    port.postMessage({
      action: 'openFolder',
      filePath: filePath.textContent
    });
    // Give time for command to execute before disconnecting
    setTimeout(() => port.disconnect(), 1000);
  } catch (err) {
    log(`openFolder error: ${err.message}`);
    showError('无法打开文件夹：' + err.message);
  }
}