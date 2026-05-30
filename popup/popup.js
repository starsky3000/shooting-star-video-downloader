// StarDownload Popup Script

// Must match NATIVE_HOST_VERSION in stardownload.py — bump only when stardownload.py changes
const EXPECTED_NATIVE_HOST_VERSION = '1.0.2';

let currentVideoInfo = null;
let currentVideoId = null;
let currentPlatform = null;
let currentCookie = ''; // B站登录 Cookie, passed to yt-dlp for HD formats
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
const thumbnailPlaceholder = document.getElementById('thumbnailPlaceholder');
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

  // Detect platform from URL
  const platform = detectPlatform(tab.url);
  currentPlatform = platform;
  let currentVideoIdFromUrl = null;
  if (platform) {
    currentVideoIdFromUrl = platform.extractId(tab.url);
  }
  log(`Platform: ${platform ? platform.id : 'none'}, Video ID from URL: ${currentVideoIdFromUrl}`);

  // Read login cookie for platforms that need it (B站 needs SESSDATA for HD)
  if (platform && platform.id === 'bilibili') {
    await readBilibiliCookie();
  }

  // === Step 1: Check download state FIRST ===
  const restored = await restoreDownloadState();
  if (restored) {
    log('Restored download state, skipping normal setup');
    checkNativeHost().then(r => { if (!r.ok) log('Native host unavailable after restore'); });
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
    const cacheKey = platform ? `${platform.id}:${currentVideoIdFromUrl}` : currentVideoIdFromUrl;
    const keys = Object.keys(formatsByVideoId);
    log(`formatsByVideoId cache has ${keys.length} entries: [${keys.join(', ')}]`);
    if (formatsByVideoId[cacheKey]) {
      log(`Found cached formats for current video ${cacheKey}`);
      populateQualitySelect(formatsByVideoId[cacheKey].formats);
    } else {
      log(`No cached formats for ${cacheKey}, fetching from native`);
      formatsAlreadyFetching = true;
      fetchFormats(currentVideoInfo.url || (platform ? platform.watchUrl(currentVideoIdFromUrl) : tab.url), false);
    }
    cachedUsed = true;
  }

  // === Step 3: Check native host and version (only blocks after cache is shown) ===
  const nativeOk = await checkNativeHost();
  const versionMismatch = nativeOk.ok && (!nativeOk.version || nativeOk.version !== EXPECTED_NATIVE_HOST_VERSION);
  log(`Native host version: ${nativeOk.version || 'missing'}, expected: ${EXPECTED_NATIVE_HOST_VERSION}`);

  if (!nativeOk.ok) {
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

  if (versionMismatch) {
    log(`Native host outdated (${nativeOk.version} != ${expectedVersion}), showing setup UI`);
    showSetupUI();
    return;
  }

  // === Step 4: If cached info was shown, refresh formats in background and return ===
  if (cachedUsed) {
    log('Cached info already shown, refreshing formats in background');
    if (!formatsAlreadyFetching) {
      // Force re-fetch when we have a cookie (cached formats may be 480p without login)
      fetchFormats(currentVideoInfo.url, currentCookie ? false : true);
    }
    log('Setup complete (cached)');
    return;
  }

  // === Step 5: Not on a supported video page? Show error ===
  if (!platform || !currentVideoIdFromUrl) {
    log('Not on a supported video page');
    showNonVideoError(I18n.t('error_no_video'));
    return;
  }

  // Get video info from yt-dlp (title, duration, thumbnail all come from listFormats response)
  currentVideoId = currentVideoIdFromUrl;
  showLoadingState(false);
  currentVideo.style.display = 'block';
  qualitySelect.innerHTML = '';
  addQualityOption('loading', I18n.t('status_loading_formats'), true);

  // Set initial thumbnail (if platform provides one)
  currentVideoInfo = {
    url: tab.url,
    videoId: currentVideoIdFromUrl,
    title: I18n.t('status_loading_video'),
    duration: null,
    thumbnail: platform.thumbnailUrl(currentVideoIdFromUrl) || ''
  };

  if (currentVideoInfo.thumbnail) {
    thumbnail.src = currentVideoInfo.thumbnail;
  }
  videoTitle.textContent = currentVideoInfo.title;
  durationBadge.style.display = 'none';

  log('Calling fetchFormats to get video info...');
  fetchFormats(tab.url, false);
  log('Setup complete');
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

// Read B站 login cookie (SESSDATA + bili_jct) to pass to yt-dlp for HD formats
async function readBilibiliCookie() {
  try {
    const [sessdata, biliJct] = await Promise.all([
      chrome.cookies.get({ url: 'https://bilibili.com', name: 'SESSDATA' }),
      chrome.cookies.get({ url: 'https://bilibili.com', name: 'bili_jct' }),
    ]);
    const parts = [];
    if (sessdata && sessdata.value) {
      parts.push(`SESSDATA=${sessdata.value}`);
    }
    if (biliJct && biliJct.value) {
      parts.push(`bili_jct=${biliJct.value}`);
    }
    currentCookie = parts.join('; ');
    if (currentCookie) {
      log(`Bilibili cookie read: SESSDATA=${sessdata ? '***' : 'missing'}, bili_jct=${biliJct ? '***' : 'missing'}`);
    } else {
      log('No Bilibili login cookie found');
    }
  } catch (e) {
    log(`Failed to read Bilibili cookie: ${e.message}`);
    currentCookie = '';
  }
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

  const cacheKey = (currentPlatform && currentVideoId) ? `${currentPlatform.id}:${currentVideoId}` : null;

  if (useCached && cacheKey && formatsByVideoId[cacheKey]) {
    log(`Using per-videoId cached formats for ${cacheKey}`);
    populateQualitySelect(formatsByVideoId[cacheKey].formats);
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
    addQualityOption('loading', I18n.t('quality_formats_timeout'), true);
    downloadBtn.style.display = 'none';
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

        // Extract video info from yt-dlp response (title, duration, thumbnail)
        if (response.title && currentVideoInfo) {
          currentVideoInfo.title = response.title;
          currentVideoInfo.duration = response.duration ? Math.round(response.duration * 1000) : null;
          if (response.thumbnail) {
            currentVideoInfo.thumbnail = response.thumbnail;
          }
          displayVideoInfo(currentVideoInfo);
          cacheVideoInfo(currentVideoInfo);
        }

        cacheFormats(response.formats);
        populateQualitySelect(response.formats);
      } else if (response.type === 'error') {
        log(`Formats error: ${response.message}`);
        showError(response.message);
        // Hide download button since no formats are available
        downloadBtn.style.display = 'none';
      }
    });

    port.onDisconnect.addListener(() => {
      log('Port disconnected');
      clearTimeout(timeoutId);
      if (!timedOut) {
        if (cachedFormats) {
          populateQualitySelect(cachedFormats);
        } else {
          showError(I18n.t('error_disconnected'));
          downloadBtn.style.display = 'none';
        }
      }
    });

    log('Sending listFormats message...');
    const msg = { action: 'listFormats', url: url };
    if (currentCookie) {
      msg.cookie = currentCookie;
    }
    port.postMessage(msg);
    log('Message sent');
  } catch (err) {
    log(`fetchFormats exception: ${err.message}`);
    clearTimeout(timeoutId);
    if (cachedFormats) {
      populateQualitySelect(cachedFormats);
    } else {
      showError(I18n.t('error_native_unavailable'));
      downloadBtn.style.display = 'none';
    }
  }
}

function populateQualitySelect(formats) {
  qualitySelect.innerHTML = '';

  showLoadingState(false);
  currentVideo.style.display = 'block';

  chrome.runtime.sendMessage({ type: 'formatsReady' }).catch(() => {});

  if (!formats || formats.length === 0) {
    addQualityOption('loading', I18n.t('quality_formats_timeout'), true);
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
    const cacheKey = currentPlatform ? `${currentPlatform.id}:${currentVideoId}` : currentVideoId;
    storageLocal.get(['formatsCacheByVideoId'], (result) => {
      const cache = result.formatsCacheByVideoId || {};
      cache[cacheKey] = { formats, timestamp: Date.now() };
      storageLocal.set({ formatsCacheByVideoId: cache });
      log(`Synced formats to formatsCacheByVideoId for ${cacheKey}`);
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
  if (info.thumbnail) {
    thumbnail.src = info.thumbnail;
    thumbnail.style.display = 'block';
    thumbnailPlaceholder.style.display = 'none';
  } else {
    thumbnail.style.display = 'none';
    thumbnailPlaceholder.style.display = 'flex';
  }

  videoTitle.textContent = info.title;

  if (info.duration) {
    durationBadge.textContent = formatDuration(Math.floor(info.duration / 1000));
    durationBadge.style.display = 'block';
  } else {
    durationBadge.style.display = 'none';
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
    qualityMeta: qualityMeta,
    platformId: currentPlatform ? currentPlatform.id : null,
    cookie: currentCookie || null
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
      isResume: true,
      cookie: currentCookie || null
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
        currentPlatform = detectPlatform(cachedVideoInfo.url || '');
      } else {
        currentVideoId = state.videoId;
        // Try to detect platform from stored URL or fall back
        const url = state.url || '';
        const platform = detectPlatform(url) || currentPlatform;
        const thumb = platform && platform.thumbnailUrl(state.videoId);
        currentVideoInfo = {
          videoId: state.videoId,
          title: state.videoTitle || I18n.t('video_unknown_title'),
          url: url || (platform ? platform.watchUrl(state.videoId) : ''),
          thumbnail: thumb || ''
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
          const cacheKey = currentPlatform ? `${currentPlatform.id}:${currentVideoId}` : currentVideoId;
          // When we have a login cookie, always re-fetch to get HD formats
          // (cached formats may be low-res from background prefetch without cookie)
          if (currentCookie && currentVideoInfo.url) {
            log('Complete case: cookie present, fetching fresh formats from native');
            fetchFormats(currentVideoInfo.url, false);
          } else if (formatsByVideoId[cacheKey] && formatsByVideoId[cacheKey].formats) {
            log(`Complete case: loading formats from cache for ${cacheKey}`);
            populateQualitySelect(formatsByVideoId[cacheKey].formats);
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
        resolve({ ok: false });
      }
    }, 5000);

    try {
      const port = chrome.runtime.connectNative('com.stardownload.host');
      if (chrome.runtime.lastError) {
        log(`checkNativeHost: connectNative error: ${chrome.runtime.lastError.message}`);
        clearTimeout(timeout);
        resolve({ ok: false });
        return;
      }

      port.onMessage.addListener((msg) => {
        if (msg.type === 'pong' && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          log(`checkNativeHost: received pong, version=${msg.version || 'missing'}`);
          port.disconnect();
          resolve({ ok: true, version: msg.version || '' });
        }
      });

      port.onDisconnect.addListener(() => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          log('checkNativeHost: disconnected without pong');
          resolve({ ok: false });
        }
      });

      port.postMessage({ action: 'ping' });
    } catch (e) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        log(`checkNativeHost: exception: ${e.message}`);
        resolve({ ok: false });
      }
    }
  });
}

function detectCurrentBrowser() {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('Brave')) return 'brave';
  if (ua.includes('Chrome/')) return 'chrome';
  return 'chrome';
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

function generateMacInstallScript(extensionId, browser) {
  const lines = [
    '#!/bin/bash',
    'set -e',
    '',
    'echo "=== StarDownload 安装 ==="',
    '',
    '# 1. 检测浏览器并创建 JSON',
    'echo "1/3 注册 Native Host..."',
    `APP_SUPPORT="\${HOME}/Library/Application Support"`,
    `BROWSER_DIR="${browser === 'edge' ? 'Microsoft Edge' : browser === 'brave' ? 'BraveSoftware/Brave-Browser' : 'Google/Chrome'}"`,
    `TARGET_DIR="$APP_SUPPORT/$BROWSER_DIR/NativeMessagingHosts"`,
    'mkdir -p "$TARGET_DIR"',
    `echo "  浏览器: $BROWSER_DIR"`,
    'cat > "$TARGET_DIR/com.stardownload.host.json" << JSONEOF',
    '{',
    '  "name": "com.stardownload.host",',
    '  "description": "StarDownload Native Messaging Host",',
    `  "path": "\${HOME}/.local/bin/stardownload",`,
    '  "type": "stdio",',
    `  "allowed_origins": ["chrome-extension://${extensionId}/"]`,
    '}',
    'JSONEOF',
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
    '  FF_INSTALLED=0',
    '  if which brew >/dev/null 2>&1; then',
    '    if brew install ffmpeg 2>/dev/null; then',
    '      echo "  ffmpeg 通过 brew 安装成功"',
    '      FF_INSTALLED=1',
    '    fi',
    '  fi',
    '  if [ "$FF_INSTALLED" -eq 0 ]; then',
    '    echo "  从 evermeet.cx 下载 ffmpeg..."',
    '    TMP_ZIP="/tmp/ffmpeg.zip"',
    '    if curl -L -o "$TMP_ZIP" "https://evermeet.cx/ffmpeg/get/ffmpeg.zip" 2>/dev/null; then',
    '      if which unzip >/dev/null 2>&1; then',
    '        unzip -o "$TMP_ZIP" -d /tmp/ffmpeg_extracted >/dev/null 2>&1',
    '        if [ -f /tmp/ffmpeg_extracted/ffmpeg ]; then',
    '          chmod +x /tmp/ffmpeg_extracted/ffmpeg',
    '          mkdir -p ~/.local/bin',
    '          cp /tmp/ffmpeg_extracted/ffmpeg ~/.local/bin/ffmpeg',
    '          echo "  ffmpeg 已安装到 ~/.local/bin/ffmpeg"',
    '          # Add ~/.local/bin to PATH',
    '          if ! echo "$PATH" | grep -q "$HOME/.local/bin"; then',
    '            if [ -f ~/.zshrc ]; then',
    '              echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> ~/.zshrc',
    '            fi',
    '            if [ -f ~/.bashrc ]; then',
    '              echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> ~/.bashrc',
    '            fi',
    '            export PATH="$HOME/.local/bin:$PATH"',
    '          fi',
    '          FF_INSTALLED=1',
    '        fi',
    '        rm -rf /tmp/ffmpeg_extracted',
    '      fi',
    '      rm -f "$TMP_ZIP"',
    '    fi',
    '    if [ "$FF_INSTALLED" -eq 0 ]; then',
    '      echo "  ⚠ ffmpeg 安装失败，请手动安装: https://ffmpeg.org/download.html"',
    '    fi',
    '  fi',
    'fi',
    '',
    'echo ""',
    '# Clean up downloaded files',
    `echo "清理下载文件..."`,
    `rm -f "$PY_FILE"`,
    `rm -f "\${HOME}/Downloads/install.sh"`,
    '',
    'echo "✓ 安装完成！请退出浏览器后重新打开。"',
  ];
  return lines.join('\n');
}

function generateWindowsInstallScript(extensionId, browser) {
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
    '# Search for stardownload.py in multiple common locations',
    '# (Edge installed on D: drive often downloads to D: instead of C:',
    '$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path',
    '$searchPaths = @(',
    '    "$scriptDir\\stardownload.py",',
    '    "$scriptDir\\native\\stardownload.py",',
    '    "$env:USERPROFILE\\Downloads\\stardownload.py"',
    ')',
    '# Also read Edge download path from Registry if available',
    'try {',
    '    $edgeDownDir = Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Edge\\" -Name "DefaultDownloadDirectory" -ErrorAction SilentlyContinue',
    '    if ($edgeDownDir -and $edgeDownDir.DefaultDownloadDirectory) {',
    '        $searchPaths += $edgeDownDir.DefaultDownloadDirectory + "\\stardownload.py"',
    '        Write-Host "  Found Edge download dir: $($edgeDownDir.DefaultDownloadDirectory)"',
    '    }',
    '} catch {}',
    'try {',
    '    $edgePrefs = "$env:LOCALAPPDATA\\Microsoft\\Edge\\User Data\\Default\\Preferences"',
    '    if (Test-Path $edgePrefs) {',
    '        $prefs = Get-Content $edgePrefs -Raw | ConvertFrom-Json',
    '        if ($prefs.download.default_directory) {',
    '            $searchPaths += $prefs.download.default_directory + "\\stardownload.py"',
    '            Write-Host "  Found Edge download dir from preferences: $($prefs.download.default_directory)"',
    '        }',
    '    }',
    '} catch {}',
    '# Also try common alternative download roots',
    '$searchPaths += "D:\\Downloads\\stardownload.py"',
    '$searchPaths += "E:\\Downloads\\stardownload.py"',
    '$pyFile = $null',
    'foreach ($p in $searchPaths) {',
    '    if ($p -and (Test-Path $p)) { $pyFile = $p; Write-Host "  Found: $pyFile"; break }',
    '}',
    'if (-not $pyFile) {',
    '    Write-Host "Search paths tried:"',
    '    $searchPaths | ForEach-Object { if ($_) { Write-Host "  $_" } }',
    '    Write-Error "Cannot find stardownload.py. Please download it and put it in C:\\Users\\$env:USERNAME\\Downloads"',
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
    '# Register for the current browser only',
    `$browserName   = "${browser === 'edge' ? 'Microsoft\\Edge' : browser === 'brave' ? 'BraveSoftware\\Brave-Browser' : 'Google\\Chrome'}"`,
    `$browserRegKey = "${browser === 'edge' ? 'Microsoft\\Edge' : browser === 'brave' ? 'BraveSoftware\\Brave-Browser' : 'Google\\Chrome'}"`,
    `$browserAppDir = "$env:LOCALAPPDATA\\$browserName"`,
    `$regKey        = "HKCU:\\Software\\$browserRegKey\\NativeMessagingHosts\\com.stardownload.host"`,
    `Write-Host "  Browser: $browserName"`,
    '',
    'try {',
    '    $targetDir = "$browserAppDir\\NativeMessagingHosts"',
    '    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null',
    '    Set-Content -Path "$targetDir\\com.stardownload.host.json" -Value $manifestJson -Encoding UTF8',
    '    $parentKey = Split-Path $regKey -Parent',
    '    New-RegistryKey $parentKey',
    '    New-Item -Path $regKey -Force | Out-Null',
    '    Set-ItemProperty -Path $regKey -Name "(default)" -Value "$targetDir\\com.stardownload.host.json"',
    '    Write-Host "  Registered successfully"',
    '} catch {',
    '    Write-Warning "  Registration failed: $_"',
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
    '$ffmpegTargetDir = "$env:LOCALAPPDATA\\ffmpeg\\bin"',
    '$ffmpegTargetExe = "$ffmpegTargetDir\\ffmpeg.exe"',
    'if ((Get-Command ffmpeg -ErrorAction SilentlyContinue) -or (Test-Path $ffmpegTargetExe)) {',
    '    Write-Host "  ffmpeg already installed"',
    '} else {',
    '    Write-Host "  Installing ffmpeg..."',
    '    $ffmpegInstalled = $false',
    '    # Try winget first',
    '    try {',
    '        winget install Gyan.FFmpeg --accept-source-agreements --accept-package-agreements',
    '        if ($LASTEXITCODE -eq 0) { $ffmpegInstalled = $true; Write-Host "  ffmpeg installed via winget" }',
    '    } catch {}',
    '    # Fallback: direct download',
    '    if (-not $ffmpegInstalled) {',
    '        Write-Host "  winget failed, downloading ffmpeg directly..."',
    '        $ffmpegZip = "$env:TEMP\\ffmpeg.zip"',
    '        try {',
    '            Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $ffmpegZip -ErrorAction Stop',
    '            $extractDir = "$env:TEMP\\ffmpeg_extracted"',
    '            if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }',
    '            Expand-Archive -Path $ffmpegZip -DestinationPath $extractDir -Force',
    '            $ffmpegExe = Get-ChildItem -Path $extractDir -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1',
    '            if ($ffmpegExe) {',
    '                New-Item -ItemType Directory -Force -Path $ffmpegTargetDir | Out-Null',
    '                Copy-Item $ffmpegExe.FullName -Destination $ffmpegTargetExe -Force',
    '                $ffprobeExe = Get-ChildItem -Path $extractDir -Recurse -Filter "ffprobe.exe" | Select-Object -First 1',
    '                if ($ffprobeExe) { Copy-Item $ffprobeExe.FullName -Destination "$ffmpegTargetDir\\ffprobe.exe" -Force }',
    '                $env:PATH = "$ffmpegTargetDir;$env:PATH"',
    '                Write-Host "  ffmpeg installed to $ffmpegTargetDir"',
    '            } else {',
    '                Write-Warning "Cannot find ffmpeg.exe in extracted archive"',
    '            }',
    '            Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue',
    '        } catch {',
    '            Write-Warning "ffmpeg download/extract failed: $_"',
    '        }',
    '        Remove-Item $ffmpegZip -ErrorAction SilentlyContinue',
    '    }',
    '}',
    '',
    '# --------------- done ---------------',
    'Write-Host ""',
    'Write-Host "======================================"',
    '',
    '# Clean up downloaded files',
    'Write-Host "Cleaning up downloaded files..."',
    'if ($pyFile -and (Test-Path $pyFile)) { Remove-Item $pyFile -Force; Write-Host "  Deleted: $pyFile" }',
    'if ($MyInvocation.MyCommand.Path) { Remove-Item $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue; Write-Host "  Deleted: $($MyInvocation.MyCommand.Path)" }',
    '',
    'Write-Host "  Installation complete!"',
    'Write-Host "======================================"',
    'Write-Host ""',
    'Write-Host "Next: close and reopen your browser, then open the extension."',
    'Write-Host ""'
  ];
  return lines.join('\r\n');
}

function generateInstallScript(extensionId) {
  const browser = detectCurrentBrowser();
  if (currentOS === 'win') {
    return generateWindowsInstallScript(extensionId, browser);
  }
  return generateMacInstallScript(extensionId, browser);
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
