// StarDownload Background Service Worker

// Download state management
let downloadState = {
  status: 'idle', // idle, downloading, paused, complete, error
  progress: 0,
  statusText: '',
  filePath: '',
  errorMessage: '',
  videoId: null
};

// Downloaded videos list (persisted)
let downloadedVideos = [];

// Native port for download
let downloadPort = null;
let downloadComplete = false;
let pausedProgress = 0;
let lastDownloadRequest = null;

// Update download state
function updateDownloadState(state) {
  downloadState = { ...downloadState, ...state };
  chrome.storage.local.set({ downloadState });
}

// Update downloaded videos list
function updateDownloadedVideos(videos) {
  downloadedVideos = videos;
  chrome.storage.local.set({ downloadedVideos });
}

// Update extension icon based on whether we're on a YouTube video page with valid video info
function updateIcon(isYouTubeVideo, hasVideoInfo) {
  if (isYouTubeVideo && hasVideoInfo) {
    chrome.action.setIcon({ path: {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }});
  } else {
    chrome.action.setIcon({ path: {
      "16": "icons/icon-disabled-16.png",
      "32": "icons/icon-disabled-32.png",
      "48": "icons/icon-disabled-48.png",
      "128": "icons/icon-disabled-48.png"
    }});
  }
}

// Initialize all tabs with gray icon
function initAllTabsGray() {
  updateIcon(false, false);
  chrome.tabs.query({}, (tabs) => {
    const youtubeTabs = tabs.filter(t => t.url && t.url.includes('youtube.com/watch'));
    youtubeTabs.forEach(tab => {
      checkYouTubeVideoStatus(tab.id, tab.url);
    });
  });
}

// Listen for tab updates to check YouTube video status
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    checkYouTubeVideoStatus(tabId, tab.url);
  }
});

// Listen for tab activation changes
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab && tab.url) {
      checkYouTubeVideoStatus(tab.id, tab.url);
    }
  });
});

// Check if URL is a YouTube watch page with video
function checkYouTubeVideoStatus(tabId, url) {
  if (!url || !url.includes('youtube.com/watch')) {
    updateIcon(false, false);
    return;
  }

  updateIcon(true, false);

  try {
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const videoId = new URL(location.href).searchParams.get('v');
        const videoEl = document.querySelector('video');
        return !!(videoId && videoEl && videoEl.duration);
      },
      world: 'MAIN'
    }).then((results) => {
      if (results && results[0] && results[0].result) {
        updateIcon(true, true);
      }
    }).catch(() => {});
  } catch (e) {}
}

// === Download Management (Native Port in Background) ===

function doStartDownload(request) {
  log('doStartDownload called');
  downloadComplete = false;

  lastDownloadRequest = {
    action: 'download',
    url: request.url,
    title: request.title,
    quality: request.quality
  };

  if (request.isResume) {
    log(`Resuming download, pausedProgress=${pausedProgress}`);
  } else {
    pausedProgress = 0;
  }

  try {
    downloadPort = chrome.runtime.connectNative('com.stardownload.host');
    log('Native port connected for download');

    downloadPort.onMessage.addListener((response) => {
      log(`Native message: ${JSON.stringify(response)}`);
      handleDownloadMessage(response);
    });

    downloadPort.onDisconnect.addListener(() => {
      log('Native port disconnected');
      downloadPort = null;
      if (!downloadComplete && downloadState.status === 'downloading') {
        updateDownloadState({
          status: 'error',
          errorMessage: '连接中断，请重试'
        });
      }
    });

    downloadPort.postMessage(lastDownloadRequest);
    log('Download request sent');

    updateDownloadState({
      status: 'downloading',
      progress: pausedProgress,
      statusText: pausedProgress > 0 ? '继续下载...' : '正在解析视频信息...',
      videoId: request.videoId || null,
      videoTitle: request.title || null,
      qualityMeta: request.qualityMeta || null,
      quality: request.quality || null
    });

  } catch (err) {
    log(`doStartDownload error: ${err.message}`);
    updateDownloadState({
      status: 'error',
      errorMessage: '无法启动下载：' + err.message
    });
  }
}

function handleDownloadMessage(message) {
  switch (message.type) {
    case 'progress':
      if (pausedProgress > 0) {
        const adjusted = pausedProgress + (message.percent * (100 - pausedProgress) / 100);
        updateDownloadState({
          status: 'downloading',
          progress: adjusted,
          statusText: message.status
        });
      } else {
        updateDownloadState({
          status: 'downloading',
          progress: message.percent,
          statusText: message.status
        });
      }
      break;

    case 'complete':
      downloadComplete = true;
      pausedProgress = 0;
      downloadPort = null;
      // Preserve qualityMeta/quality/videoTitle from the start state
      updateDownloadState({
        status: 'complete',
        progress: 100,
        statusText: '下载完成！',
        filePath: message.filePath,
        filesize: message.filesize || 0
      });
      break;

    case 'error':
      downloadComplete = true;
      pausedProgress = 0;
      downloadPort = null;
      updateDownloadState({
        status: 'error',
        errorMessage: message.message
      });
      break;
  }
}

function doPauseDownload() {
  log('doPauseDownload called');
  pausedProgress = downloadState.progress;
  if (downloadPort) {
    downloadPort.disconnect();
    downloadPort = null;
  }
  updateDownloadState({
    status: 'paused',
    progress: pausedProgress,
    statusText: '下载已暂停'
  });
}

function doCancelDownload() {
  log('doCancelDownload called');
  downloadComplete = true;
  pausedProgress = 0;
  if (downloadPort) {
    downloadPort.disconnect();
    downloadPort = null;
  }
  updateDownloadState({
    status: 'idle',
    progress: 0,
    statusText: '',
    filePath: '',
    errorMessage: '',
    videoId: null
  });
}

function log(msg) {
  console.log(`[StarDownload BG] ${msg}`);
}

// Handle messages from popup and content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'videoInfoReceived') {
    updateIcon(true, true);
    sendResponse({ success: true });
  } else if (request.type === 'startDownload') {
    doStartDownload(request);
    sendResponse({ success: true });
  } else if (request.type === 'pauseDownload') {
    doPauseDownload();
    sendResponse({ success: true });
  } else if (request.type === 'cancelDownload') {
    doCancelDownload();
    sendResponse({ success: true });
  } else if (request.type === 'getDownloadState') {
    sendResponse(downloadState);
    return true;
  } else if (request.type === 'getDownloadedVideos') {
    sendResponse(downloadedVideos);
    return true;
  } else if (request.type === 'updateDownloadedVideos') {
    updateDownloadedVideos(request.videos);
    sendResponse({ success: true });
    return true;
  } else if (request.type === 'checkVersion') {
    checkYtDlpVersion().then(info => {
      sendResponse({
        currentVersion: info.version,
        latestVersion: info.latestVersion,
        needsUpdate: info.needsUpdate
      });
    }).catch(() => {
      sendResponse({
        currentVersion: null,
        latestVersion: null,
        needsUpdate: true
      });
    });
    return true;
  }
  return true;
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  // Popup mode - browser handles popup automatically
});

// Handle installation
chrome.runtime.onInstalled.addListener((details) => {
  console.log('StarDownload: Extension installed/updated');
});

// Initialize state from storage on startup
chrome.storage.local.get(['downloadState', 'downloadedVideos'], (result) => {
  if (result.downloadState) {
    downloadState = result.downloadState;
    pausedProgress = downloadState.progress || 0;
  }
  if (result.downloadedVideos) {
    downloadedVideos = result.downloadedVideos;
  }
  // If service worker was killed during download, reset to idle (port is gone)
  if (downloadState.status === 'downloading') {
    log('Service worker restarted with active download state - resetting');
    updateDownloadState({
      status: 'error',
      errorMessage: '浏览器已重启，请重新下载'
    });
  }
  if (downloadState.status === 'paused') {
    log('Service worker restarted with paused state - resetting');
    updateDownloadState({
      status: 'error',
      errorMessage: '浏览器已重启，请重新下载'
    });
  }
});

// Set all icons to gray immediately, then check YouTube tabs
initAllTabsGray();

// Check yt-dlp version by querying native host
function checkYtDlpVersion() {
  return new Promise((resolve, reject) => {
    try {
      const port = chrome.runtime.connectNative('com.stardownload.host');
      let timeoutId = null;

      port.onMessage.addListener((response) => {
        if (response.type === 'version') {
          clearTimeout(timeoutId);
          port.disconnect();
          resolve(response);
        } else if (response.type === 'error') {
          clearTimeout(timeoutId);
          port.disconnect();
          resolve({ version: null, latestVersion: null, needsUpdate: true });
        }
      });

      port.onDisconnect.addListener(() => {
        clearTimeout(timeoutId);
        resolve({ version: null, latestVersion: null, needsUpdate: true });
      });

      port.postMessage({ action: 'getVersion' });

      timeoutId = setTimeout(() => {
        port.disconnect();
        resolve({ version: null, latestVersion: null, needsUpdate: true });
      }, 10000);
    } catch (err) {
      reject(err);
    }
  });
}
