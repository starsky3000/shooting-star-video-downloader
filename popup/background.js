// StarDownload Background Service Worker

// Download state management
let downloadState = {
  status: 'idle', // idle, checking, updating, downloading, complete, error
  progress: 0,
  statusText: '',
  filePath: '',
  errorMessage: ''
};

// Current yt-dlp version
const REQUIRED_YTDLP_VERSION = '2026.03.17';

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
          resolve(response.version);
        } else if (response.type === 'error') {
          // Version check not supported, assume old
          port.disconnect();
          resolve(null);
        }
      });

      port.onDisconnect.addListener(() => {
        clearTimeout(timeoutId);
        resolve(null);
      });

      // Send version check request
      port.postMessage({ action: 'getVersion' });

      // Timeout after 5 seconds
      timeoutId = setTimeout(() => {
        port.disconnect();
        resolve(null);
      }, 5000);
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
      statusText: request.status
    });
    chrome.runtime.sendMessage(request).catch(() => {});
  } else if (request.type === 'downloadComplete') {
    updateDownloadState({
      status: 'complete',
      progress: 100,
      statusText: '下载完成！',
      filePath: request.filePath
    });
    chrome.runtime.sendMessage(request).catch(() => {});
  } else if (request.type === 'downloadError') {
    updateDownloadState({
      status: 'error',
      errorMessage: request.message
    });
    chrome.runtime.sendMessage(request).catch(() => {});
  } else if (request.type === 'getDownloadState') {
    // Return current state to popup
    sendResponse(downloadState);
    return true;
  } else if (request.type === 'checkVersion') {
    // Popup asking for version status
    checkYtDlpVersion().then(version => {
      sendResponse({
        currentVersion: version,
        isLatest: version === REQUIRED_YTDLP_VERSION || version > REQUIRED_YTDLP_VERSION,
        requiredVersion: REQUIRED_YTDLP_VERSION
      });
    }).catch(() => {
      sendResponse({
        currentVersion: null,
        isLatest: false,
        requiredVersion: REQUIRED_YTDLP_VERSION
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