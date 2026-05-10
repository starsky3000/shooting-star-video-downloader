// StarDownload Background Service Worker

// Download state management
let downloadState = {
  status: 'idle', // idle, checking, updating, downloading, complete, error
  progress: 0,
  statusText: '',
  filePath: '',
  errorMessage: '',
  videoId: null // Track current video ID for state restoration
};

// Current yt-dlp version
const REQUIRED_YTDLP_VERSION = null; // No longer used, we check against actual latest

// Update download state
function updateDownloadState(state) {
  downloadState = { ...downloadState, ...state };
  // Persist state
  chrome.storage.local.set({ downloadState });
}

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

      // Send version check request
      port.postMessage({ action: 'getVersion' });

      // Timeout after 10 seconds (longer for network requests)
      timeoutId = setTimeout(() => {
        port.disconnect();
        resolve({ version: null, latestVersion: null, needsUpdate: true });
      }, 10000);
    } catch (err) {
      reject(err);
    }
  });
}

// Handle native message responses for download progress
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'downloadProgress') {
    updateDownloadState({
      status: 'downloading',
      progress: request.percent,
      statusText: request.status,
      videoId: request.videoId || downloadState.videoId
    });
    chrome.runtime.sendMessage(request).catch(() => {});
  } else if (request.type === 'downloadComplete') {
    updateDownloadState({
      status: 'complete',
      progress: 100,
      statusText: '下载完成！',
      filePath: request.filePath,
      videoId: request.videoId || downloadState.videoId
    });
    chrome.runtime.sendMessage(request).catch(() => {});
  } else if (request.type === 'downloadError') {
    updateDownloadState({
      status: 'error',
      errorMessage: request.message,
      videoId: request.videoId || downloadState.videoId
    });
    chrome.runtime.sendMessage(request).catch(() => {});
  } else if (request.type === 'getDownloadState') {
    // Return current state to popup
    sendResponse(downloadState);
    return true;
  } else if (request.type === 'checkVersion') {
    // Popup asking for version status
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

// Handle extension icon click when no popup is defined
chrome.action.onClicked.addListener((tab) => {
});

// Handle installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('StarDownload extension installed');
  } else if (details.reason === 'update') {
    console.log('StarDownload extension updated');
  }
});

// Initialize state from storage on startup
chrome.storage.local.get(['downloadState'], (result) => {
  if (result.downloadState) {
    downloadState = result.downloadState;
  }
});