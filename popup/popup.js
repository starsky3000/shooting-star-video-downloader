// StarDownload Popup Script

let currentVideoInfo = null;
let downloadComplete = false;
let currentVideoId = null;
let downloadedVideos = [];
let downloadPort = null;
let downloadPaused = false;
let lastDownloadRequest = null;

// Cache storage reference
let storageLocal = null;

// DOM Elements
const thumbnail = document.getElementById('thumbnail');
const videoTitle = document.getElementById('videoTitle');
const durationBadge = document.getElementById('durationBadge');
const qualitySelect = document.getElementById('qualitySelect');
const downloadBtn = document.getElementById('downloadBtn');
const btnText = document.getElementById('btnText');
const pauseBtn = document.getElementById('pauseBtn');
const pauseBtnText = document.getElementById('pauseBtnText');
const cancelBtn = document.getElementById('cancelBtn');
const downloadActions = document.getElementById('downloadActions');
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
const downloadedList = document.getElementById('downloadedList');
const downloadedSection = document.getElementById('downloadedSection');
const downloadedTitle = document.getElementById('downloadedTitle');
const currentVideo = document.getElementById('currentVideo');
const loadingState = document.getElementById('loadingState');
const setupSection = document.getElementById('setupSection');
const downloadScriptBtn = document.getElementById('downloadScriptBtn');
const downloadInstallBtn = document.getElementById('downloadInstallBtn');
const copyRunCmdBtn = document.getElementById('copyRunCmdBtn');
const setupHint = document.getElementById('setupHint');

// Cached video info
let cachedVideoInfo = null;

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  log('Popup starting');

  // Cache storage reference immediately
  storageLocal = chrome.storage?.local;
  log(`Storage available: ${!!storageLocal}`);

  // Set up event listeners FIRST
  downloadBtn.addEventListener('click', startDownload);
  pauseBtn.addEventListener('click', togglePauseDownload);
  cancelBtn.addEventListener('click', cancelDownload);
  playBtn.addEventListener('click', playVideo);
  openFolderBtn.addEventListener('click', openFolder);
  retryBtn.addEventListener('click', resetState);
  setupEventListeners();

  // Load downloaded videos directly from storage
  loadDownloadedVideos();
  renderDownloadedList();

  // Load cached video info and formats for fast display
  await loadCachedVideoInfo();
  await loadCachedFormats();

  // Check native host connectivity first
  const nativeOk = await checkNativeHost();
  if (!nativeOk) {
    log('Native host not available, showing setup UI');
    showSetupUI();
    return;
  }

  // Check if on YouTube video page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  log(`Tab URL: ${tab.url}`);

  if (!tab.url || !tab.url.includes('youtube.com/watch')) {
    log('Not a YouTube watch page');
    showNonVideoError('请在视频播放页打开扩展');
    return;
  }

  // Get current video ID from URL
  const currentVideoIdFromUrl = new URL(tab.url).searchParams.get('v');
  log(`Current video ID from URL: ${currentVideoIdFromUrl}`);

  // Check if we have cached info for this video
  if (cachedVideoInfo && cachedVideoInfo.videoId === currentVideoIdFromUrl) {
    log('Using cached video info for fast display');
    currentVideoInfo = cachedVideoInfo;
    currentVideoId = currentVideoIdFromUrl;
    displayVideoInfo(currentVideoInfo);
    showLoadingState(false);
    currentVideo.style.display = 'block';
    // Notify background that video info is ready (for icon)
    chrome.runtime.sendMessage({ type: 'videoInfoReceived' }).catch(() => {});
    // Fetch formats in background
    fetchFormats(currentVideoInfo.url);
    // Also refresh title/duration from the page (cached data may be stale)
    refreshVideoMeta(tab.id, currentVideoIdFromUrl);
    log('Setup complete (cached)');
    return;
  }

  // Get video info directly via scripting
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const url = location.href;
        const videoId = new URL(url).searchParams.get('v');

        // For title: document.title is the most reliable after SPA navigation.
        // Clean it: remove "- YouTube" suffix and unread count like "(2)" at the START.
        let title = document.title.replace(/ - YouTube$/, '').trim();
        title = title.replace(/^\s*\(\d+\)\s*/, '').trim();

        // Get duration - handle SPA navigation where ytInitialPlayerResponse and meta may be stale
        let duration = null;

        // Method 1: ytInitialPlayerResponse (always has real video duration, even during ads)
        // But on SPA navigation it's stale → must check videoId first
        try {
          if (typeof ytInitialPlayerResponse !== 'undefined' && ytInitialPlayerResponse) {
            if (ytInitialPlayerResponse.videoDetails?.videoId === videoId) {
              const len = ytInitialPlayerResponse.videoDetails?.lengthSeconds;
              if (len) duration = parseInt(len) * 1000;
            }
          }
        } catch (e) {}

        // Method 2: .ytp-time-duration from player controls (always updated on SPA nav)
        // ONLY use it when an ad is NOT playing (during ads it shows ad duration)
        if (!duration) {
          try {
            const isAd = document.querySelector('.ytp-ad-player-overlay') ||
                         document.querySelector('.video-ads .ytp-ad-module') ||
                         document.querySelector('.ad-showing');
            if (!isAd) {
              const timeEl = document.querySelector('.ytp-time-duration');
              if (timeEl && timeEl.textContent) {
                const parts = timeEl.textContent.trim().split(':').map(Number);
                if (parts.length === 3) {
                  duration = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
                } else if (parts.length === 2) {
                  duration = (parts[0] * 60 + parts[1]) * 1000;
                }
              }
            }
          } catch (e) {}
        }

        // Method 3: Fallback to meta tag
        if (!duration) {
          const meta = document.querySelector('meta[itemprop="duration"]');
          if (meta) {
            const iso = meta.getAttribute('content');
            if (iso) {
              const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
              if (match) {
                const hours = parseInt(match[1] || 0);
                const minutes = parseInt(match[2] || 0);
                const seconds = parseInt(match[3] || 0);
                duration = (hours * 3600 + minutes * 60 + seconds) * 1000;
              }
            }
          }
        }

        return { url, videoId, title, duration };
      }
    });
    const info = results[0].result;
    log(`Video info: ${JSON.stringify(info)}`);

    if (!info || !info.videoId) {
      throw new Error('Could not get video info');
    }

    currentVideoInfo = {
      url: info.url,
      videoId: info.videoId,
      title: info.title,
      duration: info.duration,
      thumbnail: `https://i.ytimg.com/vi/${info.videoId}/mqdefault.jpg`
    };
    currentVideoId = info.videoId;

    // Cache the video info
    cacheVideoInfo(currentVideoInfo);

    // Notify background script that video info is ready
    chrome.runtime.sendMessage({ type: 'videoInfoReceived' }).catch(() => {});

    displayVideoInfo(currentVideoInfo);

    // Keep loading state visible while fetching formats
    showLoadingState(true);
    currentVideo.style.display = 'none'; // Hide video section until formats are ready

    // Skip getDownloadState - not needed for fresh fetch
    // Directly fetch formats
    log('Calling fetchFormats...');
    fetchFormats(currentVideoInfo.url);
    log('Setup complete');
  } catch (err) {
    log(`Script execution failed: ${err.message}`);
    // Fallback: get basic info from URL only
    try {
      const videoId = new URL(tab.url).searchParams.get('v');
      if (videoId) {
        currentVideoInfo = {
          url: tab.url,
          videoId: videoId,
          title: '视频',
          duration: null,
          thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
        };
        currentVideoId = videoId;
        displayVideoInfo(currentVideoInfo);
        // Show loading while fetching formats
        showLoadingState(true);
        currentVideo.style.display = 'none';
        fetchFormats(tab.url);
        log('Using fallback video info');
        return;
      }
    } catch (e) {
      log(`Fallback also failed: ${e.message}`);
    }
    showLoadingState(false);
    showError('无法获取视频信息，请刷新页面后重试');
    setDownloadReadyState();
  }

  log('Event listeners set up');
});

// Cache video info to storage
function cacheVideoInfo(info) {
  cachedVideoInfo = info;
  if (storageLocal) {
    storageLocal.set({ cachedVideoInfo: info });
  }
}

// Load cached video info from storage
async function loadCachedVideoInfo() {
  cachedVideoInfo = null;
  if (storageLocal) {
    try {
      const result = await storageLocal.get(['cachedVideoInfo']);
      if (result.cachedVideoInfo) {
        cachedVideoInfo = result.cachedVideoInfo;
        log('Loaded cached video info: ' + cachedVideoInfo.videoId);
      }
    } catch (e) {
      log('Failed to load cached video info: ' + e.message);
    }
  }
}

// Cache formats to storage
let cachedFormats = null;
function cacheFormats(formats) {
  cachedFormats = formats;
  if (storageLocal) {
    storageLocal.set({ cachedFormats: formats });
  }
}

// Load cached formats from storage
async function loadCachedFormats() {
  cachedFormats = null;
  if (storageLocal) {
    try {
      const result = await storageLocal.get(['cachedFormats']);
      if (result.cachedFormats) {
        cachedFormats = result.cachedFormats;
        log('Loaded cached formats: ' + cachedFormats.length);
      }
    } catch (e) {
      log('Failed to load cached formats: ' + e.message);
    }
  }
}

// Show/hide loading state
function showLoadingState(show) {
  loadingState.style.display = show ? 'flex' : 'none';
}

// Format duration in MM:SS or HH:MM:SS
function formatDuration(seconds) {
  if (!seconds) return '--:--';
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Format file size
function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024 * 1024) {
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'G';
  }
  return Math.round(bytes / (1024 * 1024)) + 'MB';
}

// Load downloaded videos directly from storage
function loadDownloadedVideos() {
  if (!storageLocal) {
    log('chrome.storage.local not available');
    downloadedVideos = [];
    renderDownloadedList();
    return;
  }
  storageLocal.get(['downloadedVideos'], (result) => {
    downloadedVideos = result.downloadedVideos || [];
    log(`Loaded ${downloadedVideos.length} downloaded videos`);
    renderDownloadedList();
  });
}

// Save downloaded videos directly to storage
function saveDownloadedVideos() {
  if (storageLocal) {
    storageLocal.set({ downloadedVideos });
  }
}

// Add downloaded video to list
function addDownloadedVideo(videoInfo) {
  log('addDownloadedVideo called');

  // Always work with local array first (even if storage fails)
  const existingIndex = downloadedVideos.findIndex(v => v.videoId === videoInfo.videoId);
  if (existingIndex >= 0) {
    downloadedVideos.splice(existingIndex, 1);
  }

  // Add to beginning
  downloadedVideos.unshift({
    videoId: videoInfo.videoId,
    title: videoInfo.title,
    filePath: videoInfo.filePath,
    thumbnail: videoInfo.thumbnail,
    downloadedAt: Date.now()
  });

  // Keep only last 20
  downloadedVideos = downloadedVideos.slice(0, 20);

  // Always render the list immediately
  renderDownloadedList();

  // Try to save to storage
  try {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ downloadedVideos }, () => {
        log('Downloaded videos saved to storage');
      });
    } else {
      log('Storage not available, keeping in memory only');
    }
  } catch (e) {
    log(`Storage error: ${e.message}`);
  }
}

// Render downloaded videos list
function renderDownloadedList() {
  if (downloadedVideos.length === 0) {
    downloadedTitle.style.display = 'none';
    downloadedList.innerHTML = '';
    return;
  }

  downloadedTitle.style.display = 'block';
  downloadedList.innerHTML = downloadedVideos.map(video => `
    <div class="downloaded-item" data-video-id="${video.videoId}">
      <img class="thumbnail" src="${video.thumbnail}" alt="thumbnail">
      <div class="info">
        <div class="title">${video.title}</div>
        <div class="meta">${video.filePath ? video.filePath.split('/').pop() : ''}</div>
      </div>
      <div class="actions">
        <button class="mini-btn play" data-path="${escapeAttr(video.filePath)}">播放</button>
        <button class="mini-btn folder" data-path="${escapeAttr(video.filePath)}">文件夹</button>
      </div>
    </div>
  `).join('');

  // Add event listeners
  downloadedList.querySelectorAll('.mini-btn.play').forEach(btn => {
    btn.addEventListener('click', () => playDownloaded(btn.dataset.path));
  });
  downloadedList.querySelectorAll('.mini-btn.folder').forEach(btn => {
    btn.addEventListener('click', () => openDownloadedFolder(btn.dataset.path));
  });
}

// Escape attribute for HTML
function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

// Play downloaded video
function playDownloaded(filePath) {
  log('playDownloaded called, filePath: ' + filePath);
  try {
    const port = chrome.runtime.connectNative('com.stardownload.host');
    port.postMessage({ action: 'openFile', filePath: filePath });
    // Don't disconnect immediately - let Chrome flush the message to the native host
  } catch (err) {
    log(`playDownloaded error: ${err.message}`);
  }
}

// Open folder for downloaded video
function openDownloadedFolder(filePath) {
  log('openDownloadedFolder called, filePath: ' + filePath);
  try {
    const port = chrome.runtime.connectNative('com.stardownload.host');
    port.postMessage({ action: 'openFolder', filePath: filePath });
    // Don't disconnect immediately - let Chrome flush the message to the native host
  } catch (err) {
    log(`openDownloadedFolder error: ${err.message}`);
  }
}

// Fetch available formats from native host
function fetchFormats(url, useCached = true) {
  log(`fetchFormats called with URL: ${url}, useCached=${useCached}`);

  // Check if we have cached formats for this URL
  if (useCached && cachedFormats) {
    log('Using cached formats');
    populateQualitySelect(cachedFormats);
    // Still fetch in background to update cache
    fetchFormatsFromNative(url);
    return;
  }

  // No cached formats, fetch from native
  fetchFormatsFromNative(url);
}

function fetchFormatsFromNative(url) {
  log('fetchFormatsFromNative called');

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    log('fetchFormats timeout');
    showLoadingState(false);
    currentVideo.style.display = 'block';
    qualitySelect.innerHTML = '';
    addQualityOption('best', '最高画质 (格式获取超时)', true);
    setDownloadReadyState();
  }, 15000);

  try {
    log('Connecting to native host...');
    const port = chrome.runtime.connectNative('com.stardownload.host');
    log(`Port created: ${port}, lastError: ${chrome.runtime.lastError ? chrome.runtime.lastError.message : 'none'}`);

    port.onMessage.addListener((response) => {
      log(`onMessage received: ${JSON.stringify(response)}`);
      clearTimeout(timeoutId);
      if (timedOut) return;
      if (response.type === 'formats') {
        log(`Formats received: ${JSON.stringify(response.formats)}`);
        // Cache the formats
        cacheFormats(response.formats);
        populateQualitySelect(response.formats);
      } else if (response.type === 'error') {
        log(`Formats error: ${response.message}`);
        populateQualitySelect([]);
      }
    });

    port.onDisconnect.addListener(() => {
      log('Port disconnected');
      clearTimeout(timeoutId);
      if (!timedOut) {
        // Only show fallback if we haven't already shown it
        if (cachedFormats) {
          populateQualitySelect(cachedFormats);
        } else {
          populateQualitySelect([]);
        }
      }
    });

    log('Sending listFormats message...');
    port.postMessage({ action: 'listFormats', url: url });
    log('Message sent');
  } catch (err) {
    log(`fetchFormats exception: ${err.message}`);
    clearTimeout(timeoutId);
    if (cachedFormats) {
      populateQualitySelect(cachedFormats);
    } else {
      populateQualitySelect([]);
    }
  }
}

// Populate quality select with available formats
function populateQualitySelect(formats) {
  qualitySelect.innerHTML = '';

  // Now show the current video section
  showLoadingState(false);
  currentVideo.style.display = 'block';

  if (!formats || formats.length === 0) {
    addQualityOption('best', '最高画质', true);
    setDownloadReadyState();
    return;
  }

  // Find best MP4 option (default)
  let bestMp4 = null;
  let hasVideo = false;

  for (const fmt of formats) {
    // Skip mhtml format - it's not a real video format
    if (fmt.height && fmt.ext !== 'mhtml') {
      hasVideo = true;
      if (fmt.ext === 'mp4' && (!bestMp4 || fmt.height > bestMp4.height)) {
        bestMp4 = fmt;
      }
    }
  }

  // Add video formats (exclude mhtml which is not a real video format)
  if (hasVideo) {
    if (bestMp4) {
      const sizeStr = formatSize(bestMp4.filesize);
      const label = sizeStr ? `${bestMp4.height}p MP4 ${sizeStr} (推荐)` : `${bestMp4.height}p MP4 (推荐)`;
      addQualityOption(bestMp4.id, label, true);
    }

    const addedHeights = new Set();
    if (bestMp4) addedHeights.add(bestMp4.height);

    for (const fmt of formats) {
      // Skip mhtml format - it's not a real video format
      if (fmt.height && fmt.ext !== 'mhtml' && !addedHeights.has(fmt.height)) {
        const sizeStr = formatSize(fmt.filesize);
        const label = fmt.ext === 'mp4'
          ? (sizeStr ? `${fmt.height}p MP4 ${sizeStr}` : `${fmt.height}p MP4`)
          : `${fmt.height}p ${fmt.ext.toUpperCase()}${sizeStr ? ' ' + sizeStr : ''}`;
        addQualityOption(fmt.id, label);
        addedHeights.add(fmt.height);
      }
    }
  }

  // Add audio formats (exclude mhtml)
  const audioFormats = formats.filter(f => !f.height && f.ext !== 'mhtml');
  if (audioFormats.length > 0) {
    const addedExts = new Set();
    for (const fmt of audioFormats) {
      if (!addedExts.has(fmt.ext)) {
        const sizeStr = formatSize(fmt.filesize);
        addQualityOption(fmt.id, `音频 ${fmt.ext.toUpperCase()}${sizeStr ? ' ' + sizeStr : ''}`);
        addedExts.add(fmt.ext);
      }
    }
  }

  log(`Quality select populated with ${qualitySelect.options.length} options`);
}

// Add option to quality select
function addQualityOption(value, label, selected = false) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  if (selected) option.selected = true;
  qualitySelect.appendChild(option);
}

// Add logging helper
function log(msg) {
  console.log(`[StarDownload Popup] ${msg}`);
}

// Display video information
function displayVideoInfo(info) {
  thumbnail.src = info.thumbnail;
  videoTitle.textContent = info.title;

  // Show duration badge if available - NOT tied to thumbnail load state
  if (info.duration) {
    durationBadge.textContent = formatDuration(Math.floor(info.duration / 1000));
    durationBadge.style.display = 'block';
  } else {
    durationBadge.style.display = 'none';
  }
}

// Refresh title and duration from page (used when showing cached data)
async function refreshVideoMeta(tabId, expectedVideoId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        let title = document.title.replace(/ - YouTube$/, '').trim();
        title = title.replace(/^\s*\(\d+\)\s*/, '').trim();

        let duration = null;
        const videoId = new URL(location.href).searchParams.get('v');

        // Method 1: ytInitialPlayerResponse (reliable but stale on SPA nav)
        try {
          if (typeof ytInitialPlayerResponse !== 'undefined' && ytInitialPlayerResponse) {
            if (ytInitialPlayerResponse.videoDetails?.videoId === videoId) {
              const len = ytInitialPlayerResponse.videoDetails?.lengthSeconds;
              if (len) duration = parseInt(len) * 1000;
            }
          }
        } catch (e) {}

        // Method 2: .ytp-time-duration (always updated on SPA nav, but shows ad duration during ads)
        if (!duration) {
          try {
            const isAd = document.querySelector('.ytp-ad-player-overlay') ||
                         document.querySelector('.video-ads .ytp-ad-module') ||
                         document.querySelector('.ad-showing');
            if (!isAd) {
              const timeEl = document.querySelector('.ytp-time-duration');
              if (timeEl && timeEl.textContent) {
                const parts = timeEl.textContent.trim().split(':').map(Number);
                if (parts.length === 3) duration = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
                else if (parts.length === 2) duration = (parts[0] * 60 + parts[1]) * 1000;
              }
            }
          } catch (e) {}
        }

        // Method 3: meta tag
        if (!duration) {
          const meta = document.querySelector('meta[itemprop="duration"]');
          if (meta && meta.getAttribute('content')) {
            const iso = meta.getAttribute('content');
            const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
            if (match) {
              duration = ((parseInt(match[1] || 0) * 3600) + (parseInt(match[2] || 0) * 60) + parseInt(match[3] || 0)) * 1000;
            }
          }
        }
        return { title, duration };
      }
    });
    const meta = results[0].result;
    if (!meta) return;
    log(`Refreshed meta: title="${meta.title}", duration=${meta.duration}`);

    // Only update if the video hasn't changed since we started
    if (currentVideoId === expectedVideoId) {
      if (meta.title && meta.title !== currentVideoInfo.title) {
        currentVideoInfo.title = meta.title;
        videoTitle.textContent = meta.title;
      }
      if (meta.duration && meta.duration !== currentVideoInfo.duration) {
        currentVideoInfo.duration = meta.duration;
        durationBadge.textContent = formatDuration(Math.floor(meta.duration / 1000));
        durationBadge.style.display = 'block';
      }
      // Update cache with fresh data
      cacheVideoInfo(currentVideoInfo);
    }
  } catch (err) {
    log(`refreshVideoMeta failed: ${err.message}`);
  }
}

// Start download process
function startDownload() {
  log('startDownload called');
  if (!currentVideoInfo) {
    log('No video info, showing error');
    showError('视频信息无效');
    return;
  }

  downloadPaused = false;
  downloadComplete = false;

  const quality = qualitySelect.value;
  log(`Quality selected: ${quality}`);
  lastDownloadRequest = {
    action: 'download',
    url: currentVideoInfo.url,
    title: currentVideoInfo.title,
    quality: quality
  };
  log(`Download request: ${JSON.stringify(lastDownloadRequest)}`);

  try {
    log('Connecting to native host');
    downloadPort = chrome.runtime.connectNative('com.stardownload.host');
    log('Native port connected');

    downloadPort.onMessage.addListener((response) => {
      log(`Native message: ${JSON.stringify(response)}`);
      handleNativeMessage(response);
    });

    downloadPort.onDisconnect.addListener(() => {
      log('Native port disconnected');
      downloadPort = null;
      if (!downloadComplete) {
        showError('连接中断，请重试');
        showDownloadBtn();
      }
    });

    log('Sending download request');
    downloadPort.postMessage(lastDownloadRequest);
    log('Download request sent');

    setDownloadingState();

  } catch (err) {
    log(`startDownload error: ${err.message}`);
    showError('无法启动下载：' + err.message);
    showDownloadBtn();
  }
}

// Toggle pause/resume download
function togglePauseDownload() {
  if (downloadPaused) {
    // Resume: restart download
    downloadPaused = false;
    pauseBtnText.textContent = '暂停';
    pauseBtn.className = 'download-action-btn pause-btn';
    startDownload();
  } else {
    // Pause: kill the current download
    downloadPaused = true;
    pauseBtnText.textContent = '继续';
    pauseBtn.className = 'download-action-btn resume-btn';
    statusText.textContent = '下载已暂停';
    if (downloadPort) {
      downloadPort.disconnect();
      downloadPort = null;
    }
  }
}

// Cancel download and return to initial state
function cancelDownload() {
  log('cancelDownload called');
  downloadPaused = false;
  downloadComplete = false;
  if (downloadPort) {
    downloadPort.disconnect();
    downloadPort = null;
  }
  resetState();
}

// Show download button (hide pause/cancel)
function showDownloadBtn() {
  downloadBtn.style.display = 'block';
  downloadActions.style.display = 'none';
}

// Show pause/cancel buttons (hide download)
function showDownloadActions() {
  downloadBtn.style.display = 'none';
  downloadActions.style.display = 'flex';
  pauseBtnText.textContent = '暂停';
  pauseBtn.className = 'download-action-btn pause-btn';
}

// Handle messages from native host
function handleNativeMessage(message) {
  switch (message.type) {
    case 'progress':
      updateProgress(message.percent, message.status);
      // Fire and forget - don't wait for background script response
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: 'downloadProgress',
          percent: message.percent,
          status: message.status,
          videoId: currentVideoId
        }).catch(() => {});
      }, 0);
      break;
    case 'complete':
      downloadComplete = true;
      downloadPort = null;
      showDownloadBtn();
      showCompletion(message.filePath);
      // Add to downloaded list
      addDownloadedVideo({
        videoId: currentVideoId,
        title: currentVideoInfo.title,
        filePath: message.filePath,
        thumbnail: currentVideoInfo.thumbnail
      });
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: 'downloadComplete',
          filePath: message.filePath,
          videoId: currentVideoId
        }).catch(() => {});
      }, 0);
      break;
    case 'error':
      downloadComplete = true;
      downloadPort = null;
      showDownloadBtn();
      showError(message.message);
      if (message.message && message.message.includes('format is not available')) {
        setDownloadingState();
        statusText.textContent = '正在检查 yt-dlp 版本...';
        tryUpdateYtDlp();
      }
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: 'downloadError',
          message: message.message,
          videoId: currentVideoId
        }).catch(() => {});
      }, 0);
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
  currentVideo.style.display = 'none';
  completionSection.style.display = 'block';
  downloadedSection.style.display = 'block'; // Keep downloaded section visible
  filePath.textContent = path;
  downloadComplete = true;
  log('showCompletion - completed section shown');
}

// Show error state
function showError(message) {
  log(`showError called: ${message}`);
  currentVideo.style.display = 'block';
  completionSection.style.display = 'none';
  errorSection.style.display = 'block';
  errorMessage.textContent = message;
  downloadBtn.disabled = false;
  btnText.textContent = '下载';
  showDownloadBtn();
}

// Show non-video page error (hide video section, show only error)
function showNonVideoError(message) {
  log(`showNonVideoError: ${message}`);
  showLoadingState(false);
  currentVideo.style.display = 'block';
  videoTitle.textContent = message;
  videoTitle.style.color = '#888888';
  videoTitle.style.fontSize = '14px';
  thumbnail.style.display = 'none';
  durationBadge.style.display = 'none';
  qualitySelect.parentElement.style.display = 'none';
  downloadBtn.style.display = 'none';
  downloadActions.style.display = 'none';
  progressSection.style.display = 'none';
  completionSection.style.display = 'none';
  errorSection.style.display = 'none';
}

// Set downloading state
function setDownloadingState() {
  showDownloadActions();
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
  showDownloadBtn();
  progressSection.style.display = 'block';
  progressBar.style.width = '0%';
  statusText.textContent = '';
  errorSection.style.display = 'none';
  downloadComplete = false;
  currentVideo.style.display = 'block';
}

// Set download ready state
function setDownloadReadyState() {
  log('setDownloadReadyState called');
  downloadBtn.disabled = false;
  btnText.textContent = '下载';
  showDownloadBtn();
  progressSection.style.display = 'block';
  progressBar.style.width = '0%';
  statusText.textContent = '';
  completionSection.style.display = 'none';
  errorSection.style.display = 'none';
}

// Play video (via native host)
function playVideo() {
  log('playVideo called, filePath: ' + filePath.textContent);
  try {
    const path = filePath.textContent;
    if (!path) {
      showError('文件路径无效');
      return;
    }
    const port = chrome.runtime.connectNative('com.stardownload.host');
    port.postMessage({ action: 'openFile', filePath: path });
    // Don't disconnect immediately - let Chrome flush the message to the native host
  } catch (err) {
    showError('无法打开视频：' + err.message);
  }
}

// Open folder (via native host)
function openFolder() {
  log('openFolder called, filePath: ' + filePath.textContent);
  try {
    const path = filePath.textContent;
    if (!path) {
      showError('文件路径无效');
      return;
    }
    const port = chrome.runtime.connectNative('com.stardownload.host');
    port.postMessage({ action: 'openFolder', filePath: path });
    // Don't disconnect immediately - let Chrome flush the message to the native host
  } catch (err) {
    showError('无法打开文件夹：' + err.message);
  }
}

// Check if native host is available by sending a ping
function checkNativeHost() {
  return new Promise((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        log('checkNativeHost: timeout');
        resolve(false);
      }
    }, 2000);

    try {
      const port = chrome.runtime.connectNative('com.stardownload.host');
      if (chrome.runtime.lastError) {
        log(`checkNativeHost: connectNative error: ${chrome.runtime.lastError.message}`);
        clearTimeout(timeout);
        resolve(false);
        return;
      }

      port.onMessage.addListener((msg) => {
        if (msg.type === 'pong' && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          log('checkNativeHost: received pong');
          port.disconnect();
          resolve(true);
        }
      });

      port.onDisconnect.addListener(() => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          log('checkNativeHost: disconnected without pong');
          resolve(false);
        }
      });

      port.postMessage({ action: 'ping' });
    } catch (e) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        log(`checkNativeHost: exception: ${e.message}`);
        resolve(false);
      }
    }
  });
}

// Show the setup/installation guide UI
function showSetupUI() {
  showLoadingState(false);
  currentVideo.style.display = 'none';
  downloadedSection.style.display = 'none';
  completionSection.style.display = 'none';
  errorSection.style.display = 'none';
  setupSection.style.display = 'flex';
}

// Generate the install.sh script content as a proper shell script file
function generateInstallScript(extensionId) {
  // NOTE: In JS template literals, \${X} escapes ${X} so it appears literally
  // in the output. The unquoted heredoc below allows bash to expand ${HOME}.
  const lines = [
    '#!/bin/bash',
    'set -e',
    '',
    'echo "=== StarDownload 安装 ==="',
    '',
    '# 1. 检测浏览器并创建 JSON',
    'echo "1/3 检测浏览器并创建 JSON..."',
    `APP_SUPPORT="\${HOME}/Library/Application Support"`,
    'FOUND_ANY=false',
    'for dir in "Google/Chrome" "Chromium" "Microsoft Edge" "360Chrome" "BraveSoftware/Brave-Browser" "Vivaldi"; do',
    '  if [ -d "$APP_SUPPORT/$dir" ]; then',
    '    FOUND_ANY=true',
    '    TARGET_DIR="$APP_SUPPORT/$dir/NativeMessagingHosts"',
    '    mkdir -p "$TARGET_DIR"',
    '    echo "  检测到: $dir"',
    '    cat > "$TARGET_DIR/com.stardownload.host.json" << JSONEOF',
    '{',
    '  "name": "com.stardownload.host",',
    '  "description": "StarDownload Native Messaging Host",',
    `  "path": "\${HOME}/.local/bin/stardownload",`,
    '  "type": "stdio",',
    `  "allowed_origins": ["chrome-extension://${extensionId}/"]`,
    '}',
    'JSONEOF',
    '  fi',
    'done',
    'if [ "$FOUND_ANY" = false ]; then',
    '  echo "  未检测到支持的浏览器，写入默认 Chrome 路径"',
    `  TARGET_DIR="\${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"`,
    '  mkdir -p "$TARGET_DIR"',
    '  cat > "$TARGET_DIR/com.stardownload.host.json" << JSONEOF',
    '{',
    '  "name": "com.stardownload.host",',
    '  "description": "StarDownload Native Messaging Host",',
    `  "path": "\${HOME}/.local/bin/stardownload",`,
    '  "type": "stdio",',
    `  "allowed_origins": ["chrome-extension://${extensionId}/"]`,
    '}',
    'JSONEOF',
    'fi',
    '',
    '# 2. 部署 Native Host',
    'echo "2/3 部署脚本..."',
    `PY_FILE="\${HOME}/Downloads/stardownload.py"`,
    'if [ ! -f "$PY_FILE" ]; then',
    '  echo "  错误: 找不到 ~/Downloads/stardownload.py，请先下载"',
    '  exit 1',
    'fi',
    `mkdir -p "\${HOME}/.local/bin"`,
    `cp "$PY_FILE" "\${HOME}/.local/bin/stardownload"`,
    `chmod +x "\${HOME}/.local/bin/stardownload"`,
    `echo "  已部署到 ~/.local/bin/stardownload"`,
    '',
    '# 3. 安装依赖',
    'echo "3/3 安装依赖..."',
    'if which yt-dlp >/dev/null 2>&1; then',
    '  echo "  yt-dlp 已安装"',
    'else',
    '  echo "  安装 yt-dlp..."',
    '  if which brew >/dev/null 2>&1; then',
    '    brew install yt-dlp',
    '  elif which pipx >/dev/null 2>&1; then',
    '    pipx install yt-dlp',
    '  elif which pip3 >/dev/null 2>&1; then',
    '    pip3 install --user yt-dlp',
    '  else',
    '    echo "  错误: 未找到包管理器"',
    '    exit 1',
    '  fi',
    'fi',
    '',
    'if which ffmpeg >/dev/null 2>&1; then',
    '  echo "  ffmpeg 已安装"',
    'else',
    '  echo "  安装 ffmpeg..."',
    '  brew install ffmpeg',
    'fi',
    '',
    'echo ""',
    'echo "✓ 安装完成！请退出浏览器后重新打开。"',
  ];
  return lines.join('\n');
}

// Download a file as blob to user's downloads folder (stardownload.py)
async function downloadStardownloadPy() {
  try {
    const response = await fetch(chrome.runtime.getURL('native/stardownload.py'));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const content = await response.text();
    const blob = new Blob([content], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stardownload.py';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setupHint.textContent = '\u2713 stardownload.py 已下载到 ~/Downloads';
    setupHint.style.color = '#02CF66';
  } catch (e) {
    log(`stardownload.py download failed: ${e.message}`);
    setupHint.textContent = '下载失败，请重试';
    setupHint.style.color = '#ff6b6b';
  }
}

// Download install.sh to user's downloads folder
function downloadInstallScript() {
  const extensionId = chrome.runtime.id;
  const content = generateInstallScript(extensionId);
  const blob = new Blob([content], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'install.sh';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setupHint.textContent = '\u2713 install.sh 已下载到 ~/Downloads';
  setupHint.style.color = '#02CF66';
}

// Bind setup section event listeners
function setupEventListeners() {
  downloadScriptBtn.addEventListener('click', () => {
    downloadStardownloadPy();
  });

  downloadInstallBtn.addEventListener('click', () => {
    downloadInstallScript();
  });

  copyRunCmdBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText('bash ~/Downloads/install.sh');
      setupHint.textContent = '\u2713 命令已复制';
      setupHint.style.color = '#02CF66';
    } catch (e) {
      setupHint.textContent = '复制失败';
      setupHint.style.color = '#ff6b6b';
    }
  });
}
