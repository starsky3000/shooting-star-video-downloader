// StarDownload Background Service Worker

// Import i18n module
importScripts('popup/i18n.js');

// Initialize i18n
I18n.init().then(() => {
  log(`i18n ready: ${I18n.getLang()}`);
}).catch(e => {
  log(`i18n init failed: ${e.message}`);
});

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

// Track whether popup is currently open (for badge suppression)
let popupOpen = false;

// Background format prefetch
let formatFetchTimer = null;
let activePrefetchVideoId = null;

// Cancel any pending format prefetch
function cancelFormatPrefetch() {
  if (formatFetchTimer) {
    clearTimeout(formatFetchTimer);
    formatFetchTimer = null;
  }
  activePrefetchVideoId = null;
}

// Start 3-second timer before fetching formats in background
function scheduleFormatPrefetch(tabId, url, videoId) {
  cancelFormatPrefetch();
  log(`Scheduling format prefetch for ${videoId} in 3s`);
  activePrefetchVideoId = videoId;
  formatFetchTimer = setTimeout(() => {
    formatFetchTimer = null;
    // Only fetch if still on the same video
    if (activePrefetchVideoId === videoId) {
      doBackgroundFormatFetch(url, videoId);
    }
  }, 3000);
}

// Actually fetch formats in background via native host
function doBackgroundFormatFetch(url, videoId) {
  log(`doBackgroundFormatFetch for video: ${videoId}`);
  try {
    const port = chrome.runtime.connectNative('com.stardownload.host');
    let resolved = false;

    port.onMessage.addListener((response) => {
      if (resolved) return;
      if (response.type === 'formats') {
        resolved = true;
        log(`Background fetched ${response.formats.length} formats for ${videoId}`);
        cacheFormatsByVideoId(videoId, response.formats);
        // If still watching this video, turn icon green
        if (activePrefetchVideoId === videoId) {
          updateIcon(true, true);
          cancelFormatPrefetch();
        }
        port.disconnect();
      } else if (response.type === 'error') {
        resolved = true;
        log(`Background format fetch error: ${response.message}`);
        port.disconnect();
      }
    });

    port.onDisconnect.addListener(() => {
      if (!resolved) {
        log('Background format fetch port disconnected');
      }
    });

    port.postMessage({ action: 'listFormats', url });
  } catch (err) {
    log(`doBackgroundFormatFetch error: ${err.message}`);
  }
}

// Cache formats by videoId in storage
function cacheFormatsByVideoId(videoId, formats) {
  chrome.storage.local.get(['formatsCacheByVideoId'], (result) => {
    const cache = result.formatsCacheByVideoId || {};
    cache[videoId] = { formats, timestamp: Date.now() };
    // Keep only last 20 entries
    const keys = Object.keys(cache);
    if (keys.length > 20) {
      keys.sort((a, b) => cache[b].timestamp - cache[a].timestamp);
      keys.slice(20).forEach(k => delete cache[k]);
    }
    chrome.storage.local.set({ formatsCacheByVideoId: cache });
  });
}

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
    const youtubeTabs = tabs.filter(t => t.url && (t.url.includes('youtube.com/watch') || t.url.includes('youtube.com/shorts/')));
    youtubeTabs.forEach(tab => {
      checkYouTubeVideoStatus(tab.id, tab.url);
    });
  });
}

// Listen for tab updates to check YouTube video status
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  cancelFormatPrefetch();
  if (changeInfo.status === 'complete' && tab.url) {
    checkYouTubeVideoStatus(tabId, tab.url);
  }
});

// Listen for tab activation changes
chrome.tabs.onActivated.addListener((activeInfo) => {
  cancelFormatPrefetch();
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab) {
      if (tab.url) {
        checkYouTubeVideoStatus(tab.id, tab.url);
      } else {
        updateIcon(false, false);
      }
    }
  });
});

// Check if URL is a YouTube watch page or shorts with video
function checkYouTubeVideoStatus(tabId, url) {
  if (!url || (!url.includes('youtube.com/watch') && !url.includes('youtube.com/shorts/'))) {
    updateIcon(false, false);
    cancelFormatPrefetch();
    return;
  }

  // Extract videoId from URL
  let videoId = null;
  if (url.includes('youtube.com/shorts/')) {
    const match = url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    if (match) videoId = match[1];
  } else {
    try {
      videoId = new URL(url).searchParams.get('v');
    } catch (e) {}
  }

  if (!videoId) {
    updateIcon(true, false);
    return;
  }

  // Check if formats are already cached for this video
  chrome.storage.local.get(['formatsCacheByVideoId'], (result) => {
    const cache = result.formatsCacheByVideoId || {};
    if (cache[videoId]) {
      // Formats already cached, icon green immediately
      log(`Formats already cached for ${videoId}, icon green`);
      updateIcon(true, true);
    } else {
      // Formats not cached, stay gray, schedule prefetch
      log(`Formats not cached for ${videoId}, icon gray, scheduling prefetch`);
      updateIcon(true, false);
      scheduleFormatPrefetch(tabId, url, videoId);
    }
  });
}

// === Download Management (Native Port in Background) ===

function doStartDownload(request) {
  log('doStartDownload called');
  downloadComplete = false;

  lastDownloadRequest = {
    action: 'download',
    url: request.url,
    title: request.title,
    quality: request.quality,
    qualityMeta: request.qualityMeta,
    isResume: request.isResume || false
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
          errorMessage: I18n.t('error_disconnected')
        });
      }
    });

    downloadPort.postMessage(lastDownloadRequest);
    log('Download request sent');

    updateDownloadState({
      status: 'downloading',
      progress: pausedProgress,
      statusText: pausedProgress > 0 ? I18n.t('status_resuming') : I18n.t('status_parsing'),
      videoId: request.videoId || null,
      videoTitle: request.title || null,
      qualityMeta: request.qualityMeta || null,
      quality: request.quality || null
    });

  } catch (err) {
    log(`doStartDownload error: ${err.message}`);
    updateDownloadState({
      status: 'error',
      errorMessage: I18n.t('error_cannot_start') + err.message
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
          statusText: message.status,
          speed: message.speed || null
        });
      } else {
        updateDownloadState({
          status: 'downloading',
          progress: message.percent,
          statusText: message.status,
          speed: message.speed || null
        });
      }
      break;

    case 'complete':
      downloadComplete = true;
      pausedProgress = 0;
      downloadPort = null;
      // Show light blue badge on icon only when popup is closed
      // (if popup is open, user already sees the download completion in the UI)
      if (!popupOpen) {
        chrome.action.setBadgeText({ text: '✓' });
        chrome.action.setBadgeBackgroundColor({ color: '#4FC3F7' });
        chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
      }
      // Preserve qualityMeta/quality/videoTitle from the start state
      updateDownloadState({
        status: 'complete',
        progress: 100,
        statusText: I18n.t('status_download_complete'),
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
    statusText: I18n.t('status_paused')
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
    // Video info is available — icon can go green
    updateIcon(true, true);
    sendResponse({ success: true });
  } else if (request.type === 'formatsReady') {
    log('formatsReady from popup — icon green');
    // Icon green now; background prefetch is unaffected and will complete on its own
    updateIcon(true, true);
    sendResponse({ success: true });
  } else if (request.type === 'startDownload') {
    doStartDownload(request);
    sendResponse({ success: true });
  } else if (request.type === 'pauseDownload') {
    doPauseDownload();
    sendResponse({ success: true });
  } else if (request.type === 'languageChanged') {
    I18n.setLang(request.lang).then(() => {
      log(`Background language changed to: ${request.lang}`);
      // Re-send current download state to update popup text
      if (downloadState.status && downloadState.status !== 'idle') {
        // Update status text in current language
        updateDownloadState({ statusText: downloadState.statusText });
      }
    }).catch(e => {
      log(`Background language change failed: ${e.message}`);
    });
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

// Track popup open/close via port connection (for badge suppression)
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    popupOpen = true;
    log('Popup opened');
    port.onDisconnect.addListener(() => {
      popupOpen = false;
      log('Popup closed');
    });
  }
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
      errorMessage: I18n.t('error_restarted')
    });
  }
  if (downloadState.status === 'paused') {
    log('Service worker restarted with paused state - resetting');
    updateDownloadState({
      status: 'error',
      errorMessage: I18n.t('error_restarted')
    });
  }
});

// Set all icons to gray immediately, then check YouTube tabs
initAllTabsGray();

// Listen for storage changes: when popup stores formats, update icon immediately
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'local' || !changes.formatsCacheByVideoId) return;
  // Popup wrote formats — check if current tab icon should turn green
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab && tab.url) {
      checkYouTubeVideoStatus(tab.id, tab.url);
    }
  });
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
