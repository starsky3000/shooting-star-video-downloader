// StarDownload Popup Script

let currentVideoInfo = null;
let currentVideoId = null;
let downloadedVideos = [];
let downloadComplete = false;
let downloadPaused = false;
let lastDownloadRequest = null;
let storageChangeListener = null;
let downloadedListExpanded = false;
let pendingQualityRestore = null;

// Cache storage reference
let storageLocal = null;

// OS detection
function getOS() {
    const p = (navigator.platform || '').toLowerCase();
    if (p.includes('win')) return 'win';
    if (p.includes('mac')) return 'mac';
    return 'linux';
}
const currentOS = getOS();

// DOM Elements
const thumbnail = document.getElementById('thumbnail');
const videoTitle = document.getElementById('videoTitle');
const durationBadge = document.getElementById('durationBadge');
const qualitySelect = document.getElementById('qualitySelect');
const downloadBtn = document.getElementById('downloadBtn');
const btnText = document.getElementById('btnText');
const thickProgress = document.getElementById('thickProgress');
const thickProgressFill = document.getElementById('thickProgressFill');
const thickProgressLabel = document.getElementById('thickProgressLabel');
const thickProgressControls = document.getElementById('thickProgressControls');
const progressPauseBtn = document.getElementById('progressPauseBtn');
const progressCancelBtn = document.getElementById('progressCancelBtn');
const downloadCompleted = document.getElementById('downloadCompleted');
const refreshBtn = document.getElementById('refreshBtn');
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
const moreMenuBtn = document.getElementById('moreMenuBtn');
const moreMenuDropdown = document.getElementById('moreMenuDropdown');
const clearAllHistory = document.getElementById('clearAllHistory');
const showMoreBtn = document.getElementById('showMoreBtn');
const showMoreWrap = document.getElementById('showMoreWrap');

// Cached video info
let cachedVideoInfo = null;

// ---- i18n helper ----

function translatePage() {
  // Translate elements with data-i18n
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const text = I18n.t(key);
    if (text !== key) {
      el.textContent = text;
    }
  });
  // Translate elements with data-i18n-title
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    const text = I18n.t(key);
    if (text !== key) {
      el.title = text;
    }
  });
  // Translate elements with data-i18n-placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const text = I18n.t(key);
    if (text !== key) {
      el.placeholder = text;
    }
  });
  // Update language select
  const langSelect = document.getElementById('languageSelect');
  if (langSelect) {
    langSelect.value = I18n.getLang();
  }
}

// ---- Settings navigation ----

function setupSettingsNavigation() {
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsBackBtn = document.getElementById('settingsBackBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const mainContent = document.getElementById('mainContent');
  const settingsVersion = document.getElementById('settingsVersion');
  const languageSelect = document.getElementById('languageSelect');

  // Open settings
  settingsBtn.addEventListener('click', () => {
    const version = chrome.runtime.getManifest().version;
    settingsVersion.textContent = 'v' + version;
    mainContent.style.display = 'none';
    settingsPanel.style.display = 'flex';
    languageSelect.value = I18n.getLang();
  });

  // Close settings (back button)
  settingsBackBtn.addEventListener('click', () => {
    settingsPanel.style.display = 'none';
    mainContent.style.display = 'block';
  });

  // Language switch
  languageSelect.addEventListener('change', async () => {
    const newLang = languageSelect.value;
    await I18n.setLang(newLang);
    translatePage();
    // Re-render dynamic content
    renderDownloadedList();
    // If quality select has options loaded, re-translate them
    if (qualitySelect.options.length > 0 && qualitySelect.value !== 'loading') {
      if (cachedFormats && cachedFormats.length > 0) {
        populateQualitySelect(cachedFormats);
      }
    }
    // Update setup UI if visible
    if (setupSection.style.display === 'flex') {
      updateSetupUI();
    }
    // Notify background of language change
    chrome.runtime.sendMessage({ type: 'languageChanged', lang: newLang }).catch(() => {});
  });
}

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  log('Popup starting');

  // Initialize i18n first
  try {
    await I18n.init();
    translatePage();
    log(`i18n ready: ${I18n.getLang()}`);
  } catch (e) {
    log(`i18n init failed: ${e.message}`);
  }

  // Set up settings navigation
  setupSettingsNavigation();

  // Set version display
  const settingsVersion = document.getElementById('settingsVersion');
  if (settingsVersion) {
    settingsVersion.textContent = 'v' + chrome.runtime.getManifest().version;
  }

  // Clear download-complete badge on icon
  chrome.action.setBadgeText({ text: '' });

  // Notify background that popup is open (suppress badge during popup session)
  const popupPort = chrome.runtime.connect({ name: 'popup' });

  // Cache storage reference immediately
  storageLocal = chrome.storage?.local;
  log(`Storage available: ${!!storageLocal}`);

  // Set up event listeners FIRST
  downloadBtn.addEventListener('click', startDownload);
  progressPauseBtn.addEventListener('click', togglePauseDownload);
  progressCancelBtn.addEventListener('click', cancelDownload);
  refreshBtn.addEventListener('click', () => {
    downloadCompleted.style.display = 'none';
    showDownloadBtn();
  });
  playBtn.addEventListener('click', playVideo);
  openFolderBtn.addEventListener('click', openFolder);
  retryBtn.addEventListener('click', resetState);
  setupEventListeners();

  // Clean up storage listener when popup closes
  window.addEventListener('beforeunload', () => {
    if (storageChangeListener) {
      chrome.storage.onChanged.removeListener(storageChangeListener);
      storageChangeListener = null;
    }
  });

  // Load downloaded videos directly from storage
  loadDownloadedVideos();
  renderDownloadedList();

  // Load cached video info and formats for fast display
  await loadCachedVideoInfo();
  await loadCachedFormats();

  // Get current tab URL immediately (fast API call)
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  log(`Tab URL: ${tab.url}`);

  const isYouTubeWatch = tab.url && tab.url.includes('youtube.com/watch');
  const isYouTubeShorts = tab.url && tab.url.includes('youtube.com/shorts/');
  let currentVideoIdFromUrl = null;
  if (isYouTubeWatch) {
    currentVideoIdFromUrl = new URL(tab.url).searchParams.get('v');
  } else if (isYouTubeShorts) {
    const match = tab.url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    if (match) currentVideoIdFromUrl = match[1];
  }
  log(`Current video ID from URL: ${currentVideoIdFromUrl}`);

  // === Step 1: Check download state FIRST ===
  const restored = await restoreDownloadState();
  if (restored) {
    log('Restored download state, skipping normal setup');
    checkNativeHost().then(ok => { if (!ok) log('Native host unavailable after restore'); });
    return;
  }

  // === Step 2: Show cached info IMMEDIATELY, but ONLY for the current video ===
  let cachedUsed = false;
  let formatsAlreadyFetching = false;
  if (cachedVideoInfo && currentVideoIdFromUrl && cachedVideoInfo.videoId === currentVideoIdFromUrl) {
    displayVideoInfo(cachedVideoInfo);
    currentVideoInfo = cachedVideoInfo;
    currentVideoId = cachedVideoInfo.videoId;
    currentVideo.style.display = 'block';
    showLoadingState(false);
    chrome.runtime.sendMessage({ type: 'videoInfoReceived' }).catch(() => {});
    const keys = Object.keys(formatsByVideoId);
    log(`formatsByVideoId cache has ${keys.length} entries: [${keys.join(', ')}]`);
    if (formatsByVideoId[currentVideoIdFromUrl]) {
      log(`Found cached formats for current video ${currentVideoIdFromUrl}`);
      populateQualitySelect(formatsByVideoId[currentVideoIdFromUrl].formats);
    } else {
      log(`No cached formats for ${currentVideoIdFromUrl}, fetching from native`);
      formatsAlreadyFetching = true;
      fetchFormats(currentVideoInfo.url || `https://www.youtube.com/watch?v=${currentVideoIdFromUrl}`, false);
    }
    cachedUsed = true;
  }

  // === Step 3: Check native host (only blocks after cache is shown) ===
  const nativeOk = await checkNativeHost();
  if (!nativeOk) {
    if (currentVideoInfo) {
      qualitySelect.innerHTML = '';
      addQualityOption('native-unavailable', I18n.t('error_native_unavailable'), true);
      downloadBtn.style.display = 'none';
      return;
    }
    log('Native host not available, showing setup UI');
    showSetupUI();
    return;
  }

  // === Step 4: If cached info was shown, refresh in background and return ===
  if (cachedUsed) {
    log('Cached info already shown, refreshing formats and meta in background');
    if (!formatsAlreadyFetching) {
      fetchFormats(currentVideoInfo.url);
    }
    refreshVideoMeta(tab.id, currentVideoIdFromUrl);
    log('Setup complete (cached)');
    return;
  }

  // === Step 5: Not YouTube? Show error ===
  if (!isYouTubeWatch && !isYouTubeShorts) {
    log('Not a YouTube watch page');
    showNonVideoError(I18n.t('error_not_youtube'));
    return;
  }

  // Get video info directly via scripting
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const url = location.href;
        let videoId = null;
        if (url.includes('/shorts/')) {
          const m = url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
          if (m) videoId = m[1];
        } else {
          videoId = new URL(url).searchParams.get('v');
        }

        let title = document.title.replace(/ - YouTube$/, '').trim();
        title = title.replace(/^\s*\(\d+\)\s*/, '').trim();

        let duration = null;

        try {
          if (typeof ytInitialPlayerResponse !== 'undefined' && ytInitialPlayerResponse) {
            if (ytInitialPlayerResponse.videoDetails?.videoId === videoId) {
              const len = ytInitialPlayerResponse.videoDetails?.lengthSeconds;
              if (len) duration = parseInt(len) * 1000;
            }
          }
        } catch (e) {}

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

    cacheVideoInfo(currentVideoInfo);

    chrome.runtime.sendMessage({ type: 'videoInfoReceived' }).catch(() => {});

    displayVideoInfo(currentVideoInfo);

    showLoadingState(false);
    currentVideo.style.display = 'block';
    qualitySelect.innerHTML = '';
    addQualityOption('loading', I18n.t('status_loading_formats'), true);

    log('Calling fetchFormats (fresh)...');
    fetchFormats(currentVideoInfo.url, false);
    log('Setup complete');
  } catch (err) {
    log(`Script execution failed: ${err.message}`);
    try {
      let videoId = null;
      const shortsMatch = tab.url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
      if (shortsMatch) {
        videoId = shortsMatch[1];
      } else {
        videoId = new URL(tab.url).searchParams.get('v');
      }
      if (videoId) {
        currentVideoInfo = {
          url: tab.url,
          videoId: videoId,
          title: I18n.t('video_unknown_title'),
          duration: null,
          thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
        };
        currentVideoId = videoId;
        displayVideoInfo(currentVideoInfo);
        showLoadingState(false);
        currentVideo.style.display = 'block';
        qualitySelect.innerHTML = '';
        addQualityOption('loading', I18n.t('status_loading_formats'), true);
        fetchFormats(tab.url, false);
        log('Using fallback video info');
        return;
      }
    } catch (e) {
      log(`Fallback also failed: ${e.message}`);
    }
    showLoadingState(false);
    showError(I18n.t('error_cannot_get_info'));
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

let cachedFormats = null;
let formatsByVideoId = {};
function cacheFormats(formats) {
  cachedFormats = formats;
  if (storageLocal) {
    storageLocal.set({ cachedFormats: formats });
  }
}

async function loadCachedFormats() {
  cachedFormats = null;
  formatsByVideoId = {};
  if (storageLocal) {
    try {
      const result = await storageLocal.get(['cachedFormats', 'formatsCacheByVideoId']);
      if (result.cachedFormats) {
        cachedFormats = result.cachedFormats;
        log('Loaded cached formats: ' + cachedFormats.length);
      }
      if (result.formatsCacheByVideoId) {
        formatsByVideoId = result.formatsCacheByVideoId;
        log('Loaded per-videoId format cache with ' + Object.keys(formatsByVideoId).length + ' entries');
      }
    } catch (e) {
      log('Failed to load cached formats: ' + e.message);
    }
  }
}

function showLoadingState(show) {
  loadingState.style.display = show ? 'flex' : 'none';
}

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

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024 * 1024) {
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'G';
  }
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return Math.round(mb) + 'MB';
  }
  return mb.toFixed(1) + 'MB';
}

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

function saveDownloadedVideos() {
  if (storageLocal) {
    storageLocal.set({ downloadedVideos });
  }
}

function addDownloadedVideo(videoInfo) {
  log('addDownloadedVideo called');

  const dupIndex = downloadedVideos.findIndex(v => v.filePath === videoInfo.filePath);
  if (dupIndex >= 0) {
    downloadedVideos.splice(dupIndex, 1);
  }

  downloadedVideos.unshift({
    videoId: videoInfo.videoId,
    title: videoInfo.title,
    filePath: videoInfo.filePath,
    thumbnail: videoInfo.thumbnail,
    downloadedAt: Date.now(),
    quality: videoInfo.quality || '',
    filesize: videoInfo.filesize || 0,
    qualityMeta: videoInfo.qualityMeta || null
  });

  downloadedVideos = downloadedVideos.slice(0, 20);
  window._justDownloadedPath = videoInfo.filePath;
  renderDownloadedList();

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

function renderDownloadedList() {
  if (downloadedVideos.length === 0) {
    downloadedTitle.style.display = 'none';
    downloadedList.innerHTML = '';
    showMoreWrap.style.display = 'none';
    moreMenuBtn.style.display = 'none';
    moreMenuDropdown.style.display = 'none';
    return;
  }

  moreMenuBtn.style.display = 'block';
  downloadedTitle.style.display = 'block';
  const showAll = downloadedListExpanded || downloadedVideos.length <= 3;
  const displayVideos = showAll ? downloadedVideos : downloadedVideos.slice(0, 3);

  const folderTitle = I18n.t('btn_open_folder');
  const deleteTitle = I18n.t('btn_delete_record');

  downloadedList.innerHTML = displayVideos.map(video => {
    const formatLabel = buildFormatLabel(video);
    const meta = video.qualityMeta;
    const ext = meta?.ext || (video.filePath ? video.filePath.split('.').pop().toUpperCase() : '');
    const sizeStr = formatSize(video.filesize);
    const highlightClass = video.filePath === window._justDownloadedPath ? ' just-downloaded' : '';
    return `
    <div class="downloaded-item${highlightClass}" data-video-id="${escapeAttr(video.videoId)}" data-path="${escapeAttr(video.filePath)}">
      <img class="thumbnail" src="${escapeAttr(video.thumbnail)}" alt="thumbnail">
      <div class="info">
        <div class="title">${escapeHtml(video.title)}</div>
        <div class="format-info">${escapeHtml(formatLabel)}</div>
      </div>
      <div class="actions">
        <button class="mini-btn folder" data-path="${escapeAttr(video.filePath)}" title="${folderTitle}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        </button>
        <button class="mini-btn delete" data-path="${escapeAttr(video.filePath)}" title="${deleteTitle}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>
  `;}).join('');

  if (downloadedVideos.length > 3 && !downloadedListExpanded) {
    showMoreWrap.style.display = 'flex';
    showMoreBtn.textContent = I18n.t('btn_show_all');
  } else {
    showMoreWrap.style.display = 'none';
  }

  downloadedList.querySelectorAll('.downloaded-item').forEach(item => {
    item.addEventListener('click', () => {
      playDownloaded(item.dataset.path);
    });
  });

  downloadedList.querySelectorAll('.mini-btn.folder').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDownloadedFolder(btn.dataset.path);
    });
  });
  downloadedList.querySelectorAll('.mini-btn.delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteDownloadedVideo(btn.dataset.path);
    });
  });
}

function qualityToLabel(quality) {
  if (!quality) return '';
  if (quality === 'best') return I18n.t('quality_best');
  if (quality === 'audio') return I18n.t('quality_audio');
  if (quality === '2160p') return '4K';
  const num = parseInt(quality);
  if (num > 0) return quality;
  return quality.replace(/p$/i, 'P');
}

function buildFormatLabel(video) {
  const meta = video.qualityMeta;
  if (meta && meta.height) {
    const h = meta.height === 2160 ? '4K' : meta.height + 'P';
    const parts = [h];
    if (meta.ext) parts.push(meta.ext);
    const sizeStr = formatSize(video.filesize || meta.filesize);
    if (sizeStr) parts.push(sizeStr);
    return parts.join(' ');
  }
  const ext = video.filePath ? video.filePath.split('.').pop().toUpperCase() : '';
  const sizeStr = formatSize(video.filesize);
  return [ext, sizeStr].filter(Boolean).join(' ');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function playDownloaded(filePath) {
  log('playDownloaded called, filePath: ' + filePath);
  try {
    const port = chrome.runtime.connectNative('com.stardownload.host');
    port.postMessage({ action: 'playFile', filePath: filePath });
    setTimeout(() => {
      try { port.disconnect(); } catch(e) {}
    }, 500);
  } catch (err) {
    log(`playDownloaded error: ${err.message}`);
  }
}

function openDownloadedFolder(filePath) {
  log('openDownloadedFolder called, filePath: ' + filePath);
  try {
    const port = chrome.runtime.connectNative('com.stardownload.host');
    port.postMessage({ action: 'openFolder', filePath: filePath });
  } catch (err) {
    log(`openDownloadedFolder error: ${err.message}`);
  }
}

function deleteDownloadedVideo(filePath) {
  log('deleteDownloadedVideo called, filePath: ' + filePath);
  downloadedVideos = downloadedVideos.filter(v => v.filePath !== filePath);
  saveDownloadedVideos();
  renderDownloadedList();
}

function fetchFormats(url, useCached = true) {
  log(`fetchFormats called with URL: ${url}, useCached=${useCached}`);

  if (useCached && currentVideoId && formatsByVideoId[currentVideoId]) {
    log(`Using per-videoId cached formats for ${currentVideoId}`);
    populateQualitySelect(formatsByVideoId[currentVideoId].formats);
    fetchFormatsFromNative(url);
    return;
  }

  if (useCached && cachedFormats) {
    log('Using global cached formats');
    populateQualitySelect(cachedFormats);
    fetchFormatsFromNative(url);
    return;
  }

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
    addQualityOption('best', I18n.t('quality_formats_timeout'), true);
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
        if (cachedFormats) {
          populateQualitySelect(cachedFormats);
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

function populateQualitySelect(formats) {
  qualitySelect.innerHTML = '';

  showLoadingState(false);
  currentVideo.style.display = 'block';

  chrome.runtime.sendMessage({ type: 'formatsReady' }).catch(() => {});

  if (!formats || formats.length === 0) {
    addQualityOption('best', I18n.t('quality_best'), true);
    setDownloadReadyState();
    return;
  }

  const heightLabel = (h) => h === 2160 ? '4K' : `${h}p`;

  const extRank = (ext) => {
    const e = (ext || '').toLowerCase();
    if (e === 'mp4') return 0;
    if (e === 'webm') return 1;
    return 2;
  };

  const codecRank = (codec) => {
    if (!codec) return 10;
    if (codec === 'H.264') return 0;
    if (codec === 'AV1') return 1;
    if (codec === 'VP9') return 2;
    if (codec === 'VP8') return 3;
    if (codec === 'AAC') return 4;
    if (codec === 'Opus') return 5;
    return 9;
  };

  const videoFmts = formats.filter(f => f.height && f.ext !== 'mhtml');
  const audioFmts = formats.filter(f => !f.height && f.ext !== 'mhtml');

  videoFmts.sort((a, b) => {
    if (b.height !== a.height) return b.height - a.height;
    const extDiff = extRank(a.ext) - extRank(b.ext);
    if (extDiff !== 0) return extDiff;
    const codecDiff = codecRank(a.codec) - codecRank(b.codec);
    if (codecDiff !== 0) return codecDiff;
    return (a.filesize || 0) - (b.filesize || 0);
  });

  audioFmts.sort((a, b) => {
    const codecDiff = codecRank(a.codec) - codecRank(b.codec);
    if (codecDiff !== 0) return codecDiff;
    return (a.filesize || 0) - (b.filesize || 0);
  });

  let defaultSelected = false;
  const defaultMp4 = videoFmts.find(f => (f.ext || '').toLowerCase() === 'mp4');
  if (defaultMp4) defaultMp4._default = true;

  let bestAudioSize = 0;
  if (audioFmts.length > 0) {
    const bestAudio = audioFmts.reduce((best, f) => (f.filesize || 0) > (best.filesize || 0) ? f : best, audioFmts[0]);
    bestAudioSize = bestAudio.filesize || 0;
  }

  const buildVideoLabel = (fmt) => {
    const h = heightLabel(fmt.height);
    const parts = [h];
    if (fmt.codec) parts.push(fmt.codec);
    parts.push((fmt.ext || '').toUpperCase());
    const combinedSize = (fmt.filesize || 0) + bestAudioSize;
    const sizeStr = formatSize(combinedSize);
    if (sizeStr) parts.push(sizeStr);
    return parts.join(' ');
  };

  for (const fmt of videoFmts) {
    const label = buildVideoLabel(fmt);
    const selected = fmt._default || false;
    addQualityOption(fmt.id, label, selected);
    if (selected) defaultSelected = true;
  }

  if (videoFmts.length > 0 && audioFmts.length > 0) {
    const sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = I18n.t('section_audio_separator');
    qualitySelect.appendChild(sep);
  }

  const buildAudioLabel = (fmt) => {
    const parts = [I18n.t('quality_audio')];
    if (fmt.codec) parts.push(fmt.codec);
    parts.push((fmt.ext || '').toUpperCase());
    const sizeStr = formatSize(fmt.filesize);
    if (sizeStr) parts.push(sizeStr);
    return parts.join(' ');
  };

  for (const fmt of audioFmts) {
    addQualityOption(fmt.id, buildAudioLabel(fmt));
  }

  if (pendingQualityRestore) {
    const q = pendingQualityRestore;
    const match = qualitySelect.querySelector(`option[value="${CSS.escape(q)}"]`);
    if (match) {
      match.selected = true;
      qualitySelect.value = q;
      log(`Restored quality to: ${q}`);
    }
  }

  log(`Quality select populated with ${qualitySelect.options.length} options`);

  downloadBtn.disabled = false;
  btnText.textContent = I18n.t('btn_download');
  completionSection.style.display = 'none';
  errorSection.style.display = 'none';

  if (thickProgress.style.display !== 'block' && downloadCompleted.style.display !== 'flex') {
    showDownloadBtn();
  }

  if (currentVideoId && storageLocal && formats.length > 0) {
    storageLocal.get(['formatsCacheByVideoId'], (result) => {
      const cache = result.formatsCacheByVideoId || {};
      cache[currentVideoId] = { formats, timestamp: Date.now() };
      storageLocal.set({ formatsCacheByVideoId: cache });
      log(`Synced formats to formatsCacheByVideoId for ${currentVideoId}`);
    });
  }
}

function addQualityOption(value, label, selected = false) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  if (selected) option.selected = true;
  qualitySelect.appendChild(option);
}

function log(msg) {
  console.log(`[StarDownload Popup] ${msg}`);
}

function displayVideoInfo(info) {
  thumbnail.src = info.thumbnail;
  videoTitle.textContent = info.title;

  if (info.duration) {
    durationBadge.textContent = formatDuration(Math.floor(info.duration / 1000));
    durationBadge.style.display = 'block';
  } else {
    durationBadge.style.display = 'none';
  }
}

async function refreshVideoMeta(tabId, expectedVideoId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        let title = document.title.replace(/ - YouTube$/, '').trim();
        title = title.replace(/^\s*\(\d+\)\s*/, '').trim();

        let duration = null;
        let videoId = null;
        if (location.href.includes('/shorts/')) {
          const m = location.href.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
          if (m) videoId = m[1];
        } else {
          videoId = new URL(location.href).searchParams.get('v');
        }

        try {
          if (typeof ytInitialPlayerResponse !== 'undefined' && ytInitialPlayerResponse) {
            if (ytInitialPlayerResponse.videoDetails?.videoId === videoId) {
              const len = ytInitialPlayerResponse.videoDetails?.lengthSeconds;
              if (len) duration = parseInt(len) * 1000;
            }
          }
        } catch (e) {}

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
      cacheVideoInfo(currentVideoInfo);
    }
  } catch (err) {
    log(`refreshVideoMeta failed: ${err.message}`);
  }
}

function startDownload() {
  log('startDownload called');
  if (!currentVideoInfo) {
    log('No video info, showing error');
    showError(I18n.t('error_invalid_info'));
    return;
  }

  downloadPaused = false;
  downloadComplete = false;
  pendingQualityRestore = null;

  const quality = qualitySelect.value;
  log(`Quality selected: ${quality}`);

  let qualityMeta = null;
  if (cachedFormats) {
    const fmt = cachedFormats.find(f => f.id === quality);
    if (fmt) {
      qualityMeta = {
        height: fmt.height,
        ext: fmt.ext?.toUpperCase() || '',
        codec: fmt.codec || '',
        filesize: fmt.filesize
      };
    }
  }

  lastDownloadRequest = { qualityMeta };

  chrome.runtime.sendMessage({
    type: 'startDownload',
    url: currentVideoInfo.url,
    title: currentVideoInfo.title,
    quality: quality,
    videoId: currentVideoId,
    qualityMeta: qualityMeta
  }).catch(() => {});

  setDownloadingState();
  watchDownloadState();
}

function togglePauseDownload() {
  if (downloadPaused) {
    downloadPaused = false;
    thickProgress.classList.remove('paused');
    progressPauseBtn.title = I18n.t('btn_pause');
    progressPauseBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
    chrome.runtime.sendMessage({
      type: 'startDownload',
      url: currentVideoInfo.url,
      title: currentVideoInfo.title,
      quality: qualitySelect.value,
      videoId: currentVideoId,
      qualityMeta: lastDownloadRequest?.qualityMeta || null,
      isResume: true
    }).catch(() => {});
    watchDownloadState();
  } else {
    downloadPaused = true;
    thickProgress.classList.add('paused');
    thickProgressLabel.textContent = I18n.t('status_paused');
    progressPauseBtn.title = I18n.t('btn_resume');
    progressPauseBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
    chrome.runtime.sendMessage({ type: 'pauseDownload' }).catch(() => {});
  }
}

function cancelDownload() {
  log('cancelDownload called');
  downloadPaused = false;
  downloadComplete = false;
  chrome.runtime.sendMessage({ type: 'cancelDownload' }).catch(() => {});
  if (storageChangeListener) {
    chrome.storage.onChanged.removeListener(storageChangeListener);
    storageChangeListener = null;
  }
  resetState();
}

function showDownloadBtn() {
  downloadBtn.style.display = 'block';
  thickProgress.style.display = 'none';
  downloadCompleted.style.display = 'none';
}

function showDownloadCompleted() {
  downloadBtn.style.display = 'none';
  thickProgress.style.display = 'none';
  downloadCompleted.style.display = 'flex';
}

function showThickProgress() {
  downloadBtn.style.display = 'none';
  thickProgress.style.display = 'block';
  thickProgress.classList.remove('paused');
  progressPauseBtn.title = I18n.t('btn_pause');
  progressPauseBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
}

function watchDownloadState() {
  if (storageChangeListener) {
    chrome.storage.onChanged.removeListener(storageChangeListener);
  }
  storageChangeListener = (changes, namespace) => {
    if (namespace !== 'local' || !changes.downloadState) return;
    const state = changes.downloadState.newValue;
    if (!state) return;
    log(`Storage change: status=${state.status}, progress=${state.progress}`);

    switch (state.status) {
      case 'downloading':
        if (!downloadPaused) {
          thickProgress.classList.remove('paused');
          progressPauseBtn.title = I18n.t('btn_pause');
          updateProgress(state.progress, state.statusText, state.speed);
          showThickProgress();
        }
        break;
      case 'paused':
        thickProgress.classList.add('paused');
        showThickProgress();
        updateProgress(state.progress, I18n.t('status_paused'));
        thickProgressLabel.textContent = I18n.t('status_paused');
        progressPauseBtn.title = I18n.t('btn_resume');
        progressPauseBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
        downloadPaused = true;
        break;
      case 'complete':
        downloadComplete = true;
        if (storageChangeListener) {
          chrome.storage.onChanged.removeListener(storageChangeListener);
          storageChangeListener = null;
        }
        showDownloadCompleted();
        thickProgressFill.style.width = '0%';
        thickProgressLabel.textContent = I18n.t('status_downloading');
        addDownloadedVideo({
          videoId: currentVideoId,
          title: currentVideoInfo?.title || cachedVideoInfo?.title || '',
          filePath: state.filePath,
          thumbnail: currentVideoInfo?.thumbnail || cachedVideoInfo?.thumbnail || '',
          quality: qualitySelect.value,
          filesize: state.filesize || 0,
          qualityMeta: lastDownloadRequest?.qualityMeta || null
        });
        break;
      case 'error':
        downloadComplete = true;
        if (storageChangeListener) {
          chrome.storage.onChanged.removeListener(storageChangeListener);
          storageChangeListener = null;
        }
        showDownloadBtn();
        showError(state.errorMessage);
        break;
      case 'idle':
        if (storageChangeListener) {
          chrome.storage.onChanged.removeListener(storageChangeListener);
          storageChangeListener = null;
        }
        break;
    }
  };
  chrome.storage.onChanged.addListener(storageChangeListener);
}

async function restoreDownloadState() {
  return new Promise((resolve) => {
    if (!storageLocal) {
      resolve(false);
      return;
    }
    storageLocal.get(['downloadState'], (result) => {
      const state = result.downloadState;
      if (!state || state.status === 'idle') {
        resolve(false);
        return;
      }

      log(`Restoring download state: status=${state.status}, progress=${state.progress}`);

      if (cachedVideoInfo && state.videoId && cachedVideoInfo.videoId === state.videoId) {
        currentVideoInfo = cachedVideoInfo;
        currentVideoId = cachedVideoInfo.videoId;
      } else {
        currentVideoId = state.videoId;
        currentVideoInfo = {
          videoId: state.videoId,
          title: state.videoTitle || I18n.t('video_unknown_title'),
          url: state.videoId ? `https://www.youtube.com/watch?v=${state.videoId}` : '',
          thumbnail: state.videoId ? `https://i.ytimg.com/vi/${state.videoId}/mqdefault.jpg` : ''
        };
      }

      showLoadingState(false);
      currentVideo.style.display = 'block';

      switch (state.status) {
        case 'downloading':
          displayVideoInfo(currentVideoInfo);
          showThickProgress();
          thickProgress.classList.remove('paused');
          progressPauseBtn.title = I18n.t('btn_pause');
          downloadPaused = false;
          updateProgress(state.progress, state.statusText || I18n.t('status_downloading_dots'));
          watchDownloadState();
          pendingQualityRestore = state.quality || null;
          if (currentVideoInfo.url) {
            fetchFormats(currentVideoInfo.url);
          }
          break;

        case 'paused':
          displayVideoInfo(currentVideoInfo);
          showThickProgress();
          thickProgress.classList.add('paused');
          downloadPaused = true;
          updateProgress(state.progress, I18n.t('status_paused'));
          thickProgressLabel.textContent = I18n.t('status_paused');
          progressPauseBtn.title = I18n.t('btn_resume');
          progressPauseBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
          watchDownloadState();
          pendingQualityRestore = state.quality || null;
          if (currentVideoInfo.url) {
            fetchFormats(currentVideoInfo.url);
          }
          break;

        case 'complete':
          displayVideoInfo(currentVideoInfo);
          downloadComplete = true;
          showDownloadCompleted();
          if (formatsByVideoId[currentVideoId] && formatsByVideoId[currentVideoId].formats) {
            log(`Complete case: loading formats from cache for ${currentVideoId}`);
            populateQualitySelect(formatsByVideoId[currentVideoId].formats);
          } else if (currentVideoInfo.url) {
            log('Complete case: fetching formats from native');
            fetchFormats(currentVideoInfo.url);
          }
          if (state.filePath) {
            addDownloadedVideo({
              videoId: currentVideoId,
              title: currentVideoInfo?.title || state.videoTitle || '',
              filePath: state.filePath,
              thumbnail: currentVideoInfo?.thumbnail || '',
              quality: state.quality || '',
              filesize: state.filesize || 0,
              qualityMeta: state.qualityMeta || null
            });
            chrome.runtime.sendMessage({ type: 'cancelDownload' }).catch(() => {});
          }
          break;

        case 'error':
          showError(state.errorMessage || I18n.t('error_download_failed'));
          chrome.runtime.sendMessage({ type: 'cancelDownload' }).catch(() => {});
          break;

        default:
          resolve(false);
          return;
      }

      window.addEventListener('beforeunload', () => {
        if (storageChangeListener) {
          chrome.storage.onChanged.removeListener(storageChangeListener);
          storageChangeListener = null;
        }
      });

      resolve(true);
    });
  });
}

async function tryUpdateYtDlp() {
  try {
    const port = chrome.runtime.connectNative('com.stardownload.host');
    port.onMessage.addListener((response) => {
      if (response.type === 'versionCheck') {
        if (response.needsUpdate) {
          statusText.textContent = I18n.t('status_updating_ytdlp');
        } else {
          showError(I18n.t('error_format_unavailable'));
        }
      } else if (response.type === 'updateComplete') {
        port.disconnect();
        if (response.success) {
          showError(I18n.t('error_ytdlp_updated'));
        } else {
          showError(I18n.t('error_ytdlp_update_failed'));
        }
      }
    });
    port.postMessage({ action: 'checkAndUpdate' });
    port.onDisconnect.addListener(() => {});
  } catch (err) {
    showError(I18n.t('error_cannot_check_version'));
  }
}

function updateProgress(percent, status, speed) {
  thickProgressFill.style.width = `${percent}%`;
  if (percent <= 0) {
    thickProgressLabel.textContent = I18n.t('status_downloading');
  } else if (speed) {
    thickProgressLabel.textContent = speed;
  } else {
    thickProgressLabel.textContent = `${percent.toFixed(1)}%`;
  }
}

function showCompletion(path) {
  completionSection.style.display = 'block';
  filePath.textContent = path;
  downloadComplete = true;
  log('showCompletion - completed section shown');
}

function showError(message) {
  log(`showError called: ${message}`);
  currentVideo.style.display = 'block';
  completionSection.style.display = 'none';
  errorSection.style.display = 'block';
  errorMessage.textContent = message;
  downloadBtn.disabled = false;
  btnText.textContent = I18n.t('btn_download');
  showDownloadBtn();
}

function showNonVideoError(message) {
  log(`showNonVideoError: ${message}`);
  showLoadingState(false);
  currentVideo.style.display = 'block';
  videoTitle.textContent = message;
  videoTitle.style.color = '#888888';
  videoTitle.style.fontSize = '14px';
  videoTitle.style.textAlign = 'center';
  videoTitle.style.webkitLineClamp = 'unset';
  thumbnail.style.display = 'none';
  durationBadge.style.display = 'none';
  qualitySelect.parentElement.style.display = 'none';
  downloadBtn.style.display = 'none';
  thickProgress.style.display = 'none';
  downloadCompleted.style.display = 'none';
  completionSection.style.display = 'none';
  errorSection.style.display = 'none';
}

function setDownloadingState() {
  showThickProgress();
  thickProgressFill.style.width = '0%';
  thickProgressLabel.textContent = I18n.t('status_downloading');
  completionSection.style.display = 'none';
  errorSection.style.display = 'none';
}

function resetState() {
  downloadBtn.disabled = false;
  btnText.textContent = I18n.t('btn_download');
  showDownloadBtn();
  thickProgressFill.style.width = '0%';
  thickProgressLabel.textContent = '0%';
  errorSection.style.display = 'none';
  downloadComplete = false;
  currentVideo.style.display = 'block';
}

function setDownloadReadyState() {
  log('setDownloadReadyState called');
  downloadBtn.disabled = false;
  btnText.textContent = I18n.t('btn_download');
  showDownloadBtn();
  thickProgressFill.style.width = '0%';
  thickProgressLabel.textContent = '0%';
  completionSection.style.display = 'none';
  errorSection.style.display = 'none';
}

function playVideo() {
  log('playVideo called, filePath: ' + filePath.textContent);
  try {
    const path = filePath.textContent;
    if (!path) {
      showError(I18n.t('error_invalid_path'));
      return;
    }
    const port = chrome.runtime.connectNative('com.stardownload.host');
    port.postMessage({ action: 'openFile', filePath: path });
  } catch (err) {
    showError(I18n.t('error_cannot_play') + err.message);
  }
}

function openFolder() {
  log('openFolder called, filePath: ' + filePath.textContent);
  try {
    const path = filePath.textContent;
    if (!path) {
      showError(I18n.t('error_invalid_path'));
      return;
    }
    const port = chrome.runtime.connectNative('com.stardownload.host');
    port.postMessage({ action: 'openFolder', filePath: path });
  } catch (err) {
    showError(I18n.t('error_cannot_open_folder') + err.message);
  }
}

function checkNativeHost() {
  return new Promise((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        log('checkNativeHost: timeout');
        resolve(false);
      }
    }, 5000);

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

function showSetupUI() {
  showLoadingState(false);
  currentVideo.style.display = 'none';
  downloadedSection.style.display = 'none';
  completionSection.style.display = 'none';
  errorSection.style.display = 'none';
  setupSection.style.display = 'flex';

  updateSetupUI();
}

function updateSetupUI() {
  const terminalName = currentOS === 'win' ? I18n.t('setup_terminal_windows') : I18n.t('setup_terminal_mac');
  const setupTerminalName = document.getElementById('setupTerminalName');
  const setupTerminalName2 = document.getElementById('setupTerminalName2');
  if (setupTerminalName) setupTerminalName.textContent = terminalName;
  if (setupTerminalName2) setupTerminalName2.textContent = terminalName;

  const setupCommandDisplay = document.getElementById('setupCommandDisplay');
  if (setupCommandDisplay) {
    setupCommandDisplay.textContent = currentOS === 'win'
      ? I18n.t('setup_command_windows')
      : I18n.t('setup_command_mac');
  }

  const setupDownloadHint = document.getElementById('setupDownloadHint');
  if (setupDownloadHint) {
    setupDownloadHint.textContent = currentOS === 'win'
      ? I18n.t('setup_download_hint_windows')
      : I18n.t('setup_download_hint_mac');
  }

  downloadInstallBtn.textContent = currentOS === 'win'
    ? I18n.t('btn_install_script_windows')
    : I18n.t('btn_install_script_mac');
}

function generateMacInstallScript(extensionId) {
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

function generateWindowsInstallScript(extensionId) {
  const lines = [
    '# StarDownload Windows Install Script',
    '# Run from PowerShell: powershell -ExecutionPolicy Bypass -File install.ps1',
    '',
    '$ErrorActionPreference = "Continue"',
    '',
    'Write-Host "======================================"',
    'Write-Host "  StarDownload Installer (Windows)"',
    'Write-Host "======================================"',
    'Write-Host ""',
    '',
    '# Helper: create registry key recursively (New-Item does NOT create parent keys)',
    'function New-RegistryKey {',
    '    param([string]$Path)',
    '    $parts = $Path -split "\\\\"',
    '    $current = ""',
    '    foreach ($part in $parts) {',
    '        if ($current -eq "") { $current = $part } else { $current = "$current\\$part" }',
    '        if (!(Test-Path $current)) { New-Item -Path $current -Force | Out-Null }',
    '    }',
    '}',
    '',
    '# --------------- step 1: set up install directory ---------------',
    'Write-Host "1/4 Setting up install directory..."',
    '$appDir = "$env:LOCALAPPDATA\\StarDownload"',
    'New-Item -ItemType Directory -Force -Path $appDir | Out-Null',
    '',
    '# --------------- step 2: copy stardownload.py ---------------',
    'Write-Host "2/4 Deploying native host..."',
    '# Look for stardownload.py alongside this script first, then in Downloads',
    '$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path',
    '$pyFile = "$scriptDir\\native\\stardownload.py"',
    'if (-not (Test-Path $pyFile)) {',
    '    $pyFile = "$env:USERPROFILE\\Downloads\\stardownload.py"',
    '}',
    'if (-not (Test-Path $pyFile)) {',
    '    Write-Error "Cannot find stardownload.py. Please download it first."',
    '    exit 1',
    '}',
    'Copy-Item $pyFile "$appDir\\stardownload.py" -Force',
    'Write-Host "  Deployed to $appDir\\stardownload.py"',
    '',
    '# Create stardownload.bat wrapper',
    '$batFile = "$appDir\\stardownload.bat"',
    'Set-Content -Path $batFile -Value "@echo off`r`npy `"%~dp0stardownload.py`" %*" -Encoding ASCII',
    'Write-Host "  Created stardownload.bat wrapper"',
    '',
    '# --------------- step 3: register native messaging host ---------------',
    'Write-Host "3/4 Registering browser Native Host..."',
    '',
    '# Write manifest JSON file',
    '$manifestJson = @{',
    '    name = "com.stardownload.host"',
    '    description = "StarDownload Native Messaging Host"',
    '    path = "$appDir\\stardownload.bat"',
    '    type = "stdio"',
    '    allowed_origins = @("chrome-extension://' + extensionId + '/")',
    '} | ConvertTo-Json',
    '',
    '# Check which browsers are installed',
    '$browsers = @()',
    'if (Test-Path "$env:LOCALAPPDATA\\Google\\Chrome") {',
    '    Write-Host "  Detected: Chrome"',
    '    $browsers += @{',
    '        Name = "Chrome"',
    '        Dir = "$env:LOCALAPPDATA\\Google\\Chrome"',
    '        RegKey = "HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.stardownload.host"',
    '    }',
    '}',
    'if (Test-Path "$env:LOCALAPPDATA\\Microsoft\\Edge") {',
    '    Write-Host "  Detected: Edge"',
    '    $browsers += @{',
    '        Name = "Edge"',
    '        Dir = "$env:LOCALAPPDATA\\Microsoft\\Edge"',
    '        RegKey = "HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.stardownload.host"',
    '    }',
    '}',
    'if (Test-Path "$env:LOCALAPPDATA\\BraveSoftware\\Brave-Browser") {',
    '    Write-Host "  Detected: Brave"',
    '    $browsers += @{',
    '        Name = "Brave"',
    '        Dir = "$env:LOCALAPPDATA\\BraveSoftware\\Brave-Browser"',
    '        RegKey = "HKCU:\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\com.stardownload.host"',
    '    }',
    '}',
    '',
    'if ($browsers.Count -eq 0) {',
    '    Write-Host "  No Chromium browser detected. Writing default Chrome config."',
    '    $browsers += @{',
    '        Name = "Chrome (default)"',
    '        Dir = "$env:LOCALAPPDATA\\Google\\Chrome"',
    '        RegKey = "HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.stardownload.host"',
    '    }',
    '}',
    '',
    'foreach ($browser in $browsers) {',
    '    try {',
    '        # Write JSON manifest file to browser dir',
    '        $targetDir = "$($browser.Dir)\\NativeMessagingHosts"',
    '        New-Item -ItemType Directory -Force -Path $targetDir | Out-Null',
    '        Set-Content -Path "$targetDir\\com.stardownload.host.json" -Value $manifestJson -Encoding UTF8',
    '        # Create registry key recursively',
    '        $parentKey = Split-Path $browser.RegKey -Parent',
    '        New-RegistryKey $parentKey',
    '        New-Item -Path $browser.RegKey -Force | Out-Null',
    '        Set-ItemProperty -Path $browser.RegKey -Name "(default)" -Value "$targetDir\\com.stardownload.host.json"',
    '        Write-Host "  $($browser.Name): registered"',
    '    } catch {',
    '        Write-Warning "  $($browser.Name): registration failed - $_"',
    '    }',
    '}',
    '',
    '# --------------- step 4: install dependencies ---------------',
    'Write-Host "4/4 Installing dependencies..."',
    '',
    '# Find Python (use py launcher to bypass Microsoft Store redirect)',
    '$pythonCmd = $null',
    'if (Get-Command py -ErrorAction SilentlyContinue) { $pythonCmd = "py" }',
    'if (-not $pythonCmd) {',
    '    foreach ($ver in @(313, 312, 311, 310, 39, 38)) {',
    '        $p = "$env:LOCALAPPDATA\\Programs\\Python\\Python$ver\\python.exe"',
    '        if (Test-Path $p) { $pythonCmd = $p; break }',
    '    }',
    '}',
    'if (-not $pythonCmd) {',
    '    Write-Warning "Python not found. Install from https://www.python.org/downloads/"',
    '} else {',
    '    Write-Host "  Installing yt-dlp via pip..."',
    '    & $pythonCmd -m pip install --upgrade yt-dlp *>$null',
    '    # Add Scripts to PATH',
    '    $scriptsDir = & $pythonCmd -c "import sysconfig; print(sysconfig.get_path(\"scripts\"))" 2>$null',
    '    if ($scriptsDir) { $env:PATH = "$scriptsDir;$env:PATH" }',
    '    Write-Host "  yt-dlp installed"',
    '}',
    '',
    'Write-Host "  Checking ffmpeg..."',
    'if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {',
    '    Write-Host "  ffmpeg already installed"',
    '} else {',
    '    try {',
    '        winget install Gyan.FFmpeg --accept-source-agreements --accept-package-agreements',
    '        Write-Host "  ffmpeg installed"',
    '    } catch {',
    '        Write-Warning "ffmpeg install failed. Install manually: https://ffmpeg.org/download.html"',
    '    }',
    '}',
    '',
    '# --------------- done ---------------',
    'Write-Host ""',
    'Write-Host "======================================"',
    'Write-Host "  Installation complete!"',
    'Write-Host "======================================"',
    'Write-Host ""',
    'Write-Host "Next: close and reopen your browser, then open the extension."',
    'Write-Host ""'
  ];
  return lines.join('\r\n');
}

function generateInstallScript(extensionId) {
  if (currentOS === 'win') {
    return generateWindowsInstallScript(extensionId);
  }
  return generateMacInstallScript(extensionId);
}

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
    const downloadPath = currentOS === 'win' ? I18n.t('setup_download_hint_windows') : I18n.t('setup_download_hint_mac');
    setupHint.textContent = '\u2713 stardownload.py ' + I18n.t('setup_downloaded_to') + ' ' + downloadPath;
    setupHint.style.color = '#02CF66';
  } catch (e) {
    log(`stardownload.py download failed: ${e.message}`);
    setupHint.textContent = I18n.t('error_script_download_failed');
    setupHint.style.color = '#ff6b6b';
  }
}

function downloadInstallScript() {
  const extensionId = chrome.runtime.id;
  const content = generateInstallScript(extensionId);
  const filename = currentOS === 'win' ? 'install.ps1' : 'install.sh';
  const blob = new Blob([content], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  const downloadPath = currentOS === 'win' ? I18n.t('setup_download_hint_windows') : I18n.t('setup_download_hint_mac');
  setupHint.textContent = '\u2713 ' + filename + ' ' + I18n.t('setup_downloaded_to') + ' ' + downloadPath;
  setupHint.style.color = '#02CF66';
}

function setupEventListeners() {
  downloadScriptBtn.addEventListener('click', () => {
    downloadStardownloadPy();
  });

  downloadInstallBtn.addEventListener('click', () => {
    downloadInstallScript();
  });

  copyRunCmdBtn.addEventListener('click', async () => {
    try {
      const cmd = currentOS === 'win'
        ? I18n.t('setup_command_windows')
        : I18n.t('setup_command_mac');
      await navigator.clipboard.writeText(cmd);
      setupHint.textContent = '\u2713 ' + I18n.t('setup_copied');
      setupHint.style.color = '#02CF66';
    } catch (e) {
      setupHint.textContent = I18n.t('setup_copy_failed');
      setupHint.style.color = '#ff6b6b';
    }
  });

  moreMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const visible = moreMenuDropdown.style.display === 'block';
    moreMenuDropdown.style.display = visible ? 'none' : 'block';
  });

  clearAllHistory.addEventListener('click', () => {
    downloadedVideos = [];
    saveDownloadedVideos();
    if (storageLocal) {
      storageLocal.set({ downloadedVideos: [] });
    }
    downloadedListExpanded = false;
    renderDownloadedList();
    moreMenuDropdown.style.display = 'none';
  });

  showMoreBtn.addEventListener('click', () => {
    downloadedListExpanded = true;
    renderDownloadedList();
    currentVideo.style.display = 'none';
    downloadBtn.style.display = 'none';
    thickProgress.style.display = 'none';
    downloadCompleted.style.display = 'none';
    completionSection.style.display = 'none';
    errorSection.style.display = 'none';
    downloadedList.style.maxHeight = '400px';
  });

  document.addEventListener('click', () => {
    moreMenuDropdown.style.display = 'none';
  });
}
