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

// Downloaded videos list (persisted)
let downloadedVideos = [];

// Current yt-dlp version
const REQUIRED_YTDLP_VERSION = null; // No longer used, we check against actual latest

// Update download state
function updateDownloadState(state) {
  downloadState = { ...downloadState, ...state };
  // Persist state
  chrome.storage.local.set({ downloadState });
}

// Update downloaded videos list
function updateDownloadedVideos(videos) {
  downloadedVideos = videos;
  chrome.storage.local.set({ downloadedVideos });
}

// Update extension icon based on whether we're on a YouTube video page
function updateIcon(isYouTubeVideo, hasVideoInfo) {
  if (isYouTubeVideo && hasVideoInfo) {
    // Video page with info - enable icon (normal)
    chrome.action.setIcon({ path: {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }});
  } else if (isYouTubeVideo && !hasVideoInfo) {
    // YouTube but not a video page or waiting for info - use disabled icon
    chrome.action.setIcon({ path: {
      "16": "icons/icon-disabled-16.png",
      "32": "icons/icon-disabled-32.png",
      "48": "icons/icon-disabled-48.png",
      "128": "icons/icon128.png"  // Use normal for 128 as we don't have disabled version
    }});
  } else {
    // Not on YouTube video page - use disabled icon
    chrome.action.setIcon({ path: {
      "16": "icons/icon-disabled-16.png",
      "32": "icons/icon-disabled-32.png",
      "48": "icons/icon-disabled-48.png",
      "128": "icons/icon128.png"
    }});
  }
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

// Track current tab's video status
let currentTabVideoReady = false;
let currentTabIsYouTubeWatch = false;

// Check if URL is a YouTube watch page with video
function checkYouTubeVideoStatus(tabId, url) {
  if (!url || !url.includes('youtube.com')) {
    currentTabIsYouTubeWatch = false;
    currentTabVideoReady = false;
    updateIcon(false, false);
    return;
  }

  // Check if it's a watch page (video page)
  if (url.includes('/watch')) {
    currentTabIsYouTubeWatch = true;
    // It's a watch page - disable icon initially (waiting for info)
    updateIcon(true, false);

    // Try to get video info from the page to confirm it's a video
    try {
      chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
        if (chrome.runtime.lastError) {
          // Content script not loaded yet, that's fine
          return;
        }
        if (response && response.hasVideo) {
          currentTabVideoReady = true;
          updateIcon(true, true);
        }
      });
    } catch (e) {
      // Tab might not be ready
    }
  } else {
    // Not a watch page (homepage, search, channel, etc.)
    currentTabIsYouTubeWatch = false;
    currentTabVideoReady = false;
    updateIcon(false, false);
  }
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'videoInfoReceived') {
    // Content script detected video info on the page
    updateIcon(true, true);
    sendResponse({ success: true });
  } else if (request.type === 'downloadProgress') {
    updateDownloadState({
      status: 'downloading',
      progress: request.percent,
      statusText: request.status,
      videoId: request.videoId || downloadState.videoId
    });
  } else if (request.type === 'downloadComplete') {
    updateDownloadState({
      status: 'complete',
      progress: 100,
      statusText: '下载完成！',
      filePath: request.filePath,
      videoId: request.videoId || downloadState.videoId
    });
    // Download done, enable icon
    chrome.action.enable();
  } else if (request.type === 'downloadError') {
    updateDownloadState({
      status: 'error',
      errorMessage: request.message,
      videoId: request.videoId || downloadState.videoId
    });
  } else if (request.type === 'getDownloadState') {
    // Return current state to popup
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

// Handle extension icon click (popup mode - no action needed since popup handles it)
chrome.action.onClicked.addListener((tab) => {
  // Popup mode - do nothing, browser handles popup automatically
});

// Handle installation - do NOT set global side panel options
chrome.runtime.onInstalled.addListener((details) => {
  console.log('StarDownload: Extension installed/updated');
});

// Initialize state from storage on startup
chrome.storage.local.get(['downloadState', 'downloadedVideos'], (result) => {
  if (result.downloadState) {
    downloadState = result.downloadState;
  }
  if (result.downloadedVideos) {
    downloadedVideos = result.downloadedVideos;
  }
});

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