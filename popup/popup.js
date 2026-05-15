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
const moreMenuBtn = document.getElementById('moreMenuBtn');
const moreMenuDropdown = document.getElementById('moreMenuDropdown');
const clearAllHistory = document.getElementById('clearAllHistory');
const showMoreBtn = document.getElementById('showMoreBtn');
const showMoreWrap = document.getElementById('showMoreWrap');

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

  // Hide progress bar initially (shown only when downloading)
  progressSection.style.display = 'none';

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

  // Restore download state if there's an active/paused/completed download
  const restored = await restoreDownloadState();
  if (restored) {
    log('Restored download state, skipping normal setup');
    return;
  }

  // Check if on YouTube video page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  log(`Tab URL: ${tab.url}`);

  // Check if on YouTube video page (watch or shorts)
  const isYouTubeWatch = tab.url && tab.url.includes('youtube.com/watch');
  const isYouTubeShorts = tab.url && tab.url.includes('youtube.com/shorts/');
  if (!isYouTubeWatch && !isYouTubeShorts) {
    log('Not a YouTube watch page');
    showNonVideoError('请在视频播放页打开扩展');
    return;
  }

  // Get current video ID from URL (watch?v=X or /shorts/X)
  let currentVideoIdFromUrl = null;
  if (isYouTubeWatch) {
    currentVideoIdFromUrl = new URL(tab.url).searchParams.get('v');
  } else if (isYouTubeShorts) {
    const match = tab.url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    if (match) currentVideoIdFromUrl = match[1];
  }
  log(`Current video ID from URL: ${currentVideoIdFromUrl}`);

  // Check if we have cached info for this video — show directly, no loading flash
  if (cachedVideoInfo && cachedVideoInfo.videoId === currentVideoIdFromUrl) {
    log('Using cached video info for fast display');
    currentVideoInfo = cachedVideoInfo;
    currentVideoId = currentVideoIdFromUrl;
    displayVideoInfo(currentVideoInfo);
    // Directly show video, no loading state
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
        let videoId = null;
        if (url.includes('/shorts/')) {
          const m = url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
          if (m) videoId = m[1];
        } else {
          videoId = new URL(url).searchParams.get('v');
        }

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
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return Math.round(mb) + 'MB';
  }
  return mb.toFixed(1) + 'MB';
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

  // Remove duplicate by filePath (same file = same download), but allow same videoId with different formats
  const dupIndex = downloadedVideos.findIndex(v => v.filePath === videoInfo.filePath);
  if (dupIndex >= 0) {
    downloadedVideos.splice(dupIndex, 1);
  }

  // Add to beginning
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

// Render downloaded videos list (shows 3 latest, expandable)
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

  downloadedList.innerHTML = displayVideos.map(video => {
    const meta = video.qualityMeta;
    const resolution = meta?.height ? (meta.height === 2160 ? '4K' : meta.height + 'p') :
                       qualityToLabel(video.quality);
    const ext = meta?.ext || (video.filePath ? video.filePath.split('.').pop().toUpperCase() : '');
    const sizeStr = formatSize(video.filesize);
    const metaParts = [resolution, ext, sizeStr].filter(Boolean);
    const metaText = metaParts.join(' · ');
    return `
    <div class="downloaded-item" data-video-id="${escapeAttr(video.videoId)}" data-path="${escapeAttr(video.filePath)}">
      <img class="thumbnail" src="${escapeAttr(video.thumbnail)}" alt="thumbnail">
      <div class="info">
        <div class="title">${escapeHtml(video.title)}</div>
        <div class="meta">${metaText || (video.filePath ? video.filePath.split('/').pop() : '')}</div>
      </div>
      <div class="actions">
        <button class="mini-btn play" data-path="${escapeAttr(video.filePath)}">播放</button>
        <button class="mini-btn folder" data-path="${escapeAttr(video.filePath)}">文件夹</button>
      </div>
    </div>
  `;}).join('');

  // "Show more" / "Collapse" button
  if (downloadedVideos.length > 3) {
    showMoreWrap.style.display = 'flex';
    showMoreBtn.textContent = showAll ? '收起' : `查看更多 (${downloadedVideos.length - 3})`;
  } else {
    showMoreWrap.style.display = 'none';
  }

  // Add event listeners — whole item clickable to play
  downloadedList.querySelectorAll('.downloaded-item').forEach(item => {
    item.addEventListener('click', () => {
      playDownloaded(item.dataset.path);
    });
  });

  // Add event listeners — mini buttons (stop propagation to avoid double-trigger)
  downloadedList.querySelectorAll('.mini-btn.play').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      playDownloaded(btn.dataset.path);
    });
  });
  downloadedList.querySelectorAll('.mini-btn.folder').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDownloadedFolder(btn.dataset.path);
    });
  });
}

// Convert quality value to human-readable label
function qualityToLabel(quality) {
  if (!quality) return '';
  if (quality === 'best') return '最高';
  if (quality === 'audio') return '音频';
  if (quality === '2160p') return '4K';
  // Strip 'p' suffix
  const num = parseInt(quality);
  if (num > 0) return quality;
  return quality.replace(/p$/i, 'P');
}

// Escape HTML entities
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
    // Send a single playFile action — native host will remove quarantine
    // and open the file in one go, avoiding race conditions with port lifetime
    port.postMessage({ action: 'playFile', filePath: filePath });
    setTimeout(() => {
      try { port.disconnect(); } catch(e) {}
    }, 500);
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

// Populate quality select with all available formats
function populateQualitySelect(formats) {
  qualitySelect.innerHTML = '';

  showLoadingState(false);
  currentVideo.style.display = 'block';

  if (!formats || formats.length === 0) {
    addQualityOption('best', '最高画质', true);
    setDownloadReadyState();
    return;
  }

  // Helper: convert height to display label (e.g. 2160 → 4K)
  const heightLabel = (h) => h === 2160 ? '4K' : `${h}p`;

  // Container priority: MP4 first, then others alphabetically
  const extRank = (ext) => {
    const e = (ext || '').toLowerCase();
    if (e === 'mp4') return 0;
    if (e === 'webm') return 1;
    return 2;
  };

  // Codec priority: H.264 first (most compatible), then AV1, VP9, VP8, others
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

  // Separate video and audio formats (exclude mhtml)
  const videoFmts = formats.filter(f => f.height && f.ext !== 'mhtml');
  const audioFmts = formats.filter(f => !f.height && f.ext !== 'mhtml');

  // Sort video formats: height desc → container priority → codec priority → size asc
  videoFmts.sort((a, b) => {
    if (b.height !== a.height) return b.height - a.height;
    const extDiff = extRank(a.ext) - extRank(b.ext);
    if (extDiff !== 0) return extDiff;
    const codecDiff = codecRank(a.codec) - codecRank(b.codec);
    if (codecDiff !== 0) return codecDiff;
    return (a.filesize || 0) - (b.filesize || 0);
  });

  // Sort audio formats: codec priority → size asc
  audioFmts.sort((a, b) => {
    const codecDiff = codecRank(a.codec) - codecRank(b.codec);
    if (codecDiff !== 0) return codecDiff;
    return (a.filesize || 0) - (b.filesize || 0);
  });

  // Default: first MP4 format (highest resolution MP4)
  let defaultSelected = false;
  const defaultMp4 = videoFmts.find(f => (f.ext || '').toLowerCase() === 'mp4');
  if (defaultMp4) defaultMp4._default = true;

  // Build label for a video format
  const buildVideoLabel = (fmt) => {
    const h = heightLabel(fmt.height);
    const parts = [h];
    if (fmt.codec) parts.push(fmt.codec);
    parts.push((fmt.ext || '').toUpperCase());
    const sizeStr = formatSize(fmt.filesize);
    if (sizeStr) parts.push(sizeStr);
    return parts.join(' ');
  };

  // Add video formats
  for (const fmt of videoFmts) {
    const label = buildVideoLabel(fmt);
    const selected = fmt._default || false;
    addQualityOption(fmt.id, label, selected);
    if (selected) defaultSelected = true;
  }

  // Add separator if there are both video and audio formats
  if (videoFmts.length > 0 && audioFmts.length > 0) {
    const sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = '────────── 仅音频 ──────────';
    qualitySelect.appendChild(sep);
  }

  // Build label for an audio format
  const buildAudioLabel = (fmt) => {
    const parts = ['音频'];
    if (fmt.codec) parts.push(fmt.codec);
    parts.push((fmt.ext || '').toUpperCase());
    const sizeStr = formatSize(fmt.filesize);
    if (sizeStr) parts.push(sizeStr);
    return parts.join(' ');
  };

  // Add audio formats
  for (const fmt of audioFmts) {
    addQualityOption(fmt.id, buildAudioLabel(fmt));
  }

  // Restore previously selected quality (e.g. after popup reopen during paused download)
  if (pendingQualityRestore) {
    const q = pendingQualityRestore;
    const match = qualitySelect.querySelector(`option[value="${CSS.escape(q)}"]`);
    if (match) {
      match.selected = true;
      qualitySelect.value = q;
      log(`Restored quality to: ${q}`);
    }
    pendingQualityRestore = null;
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
        let videoId = null;
        if (location.href.includes('/shorts/')) {
          const m = location.href.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
          if (m) videoId = m[1];
        } else {
          videoId = new URL(location.href).searchParams.get('v');
        }

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

// Start download process (delegates to background service worker)
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

  // Capture format metadata (resolution, ext, codec) for downloaded list display
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

  // Send download command to background (which manages the native port)
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

// Toggle pause/resume download
function togglePauseDownload() {
  if (downloadPaused) {
    // Resume
    downloadPaused = false;
    pauseBtnText.textContent = '暂停';
    pauseBtn.className = 'download-action-btn pause-btn';
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
    // Pause: tell background to pause
    downloadPaused = true;
    pauseBtnText.textContent = '继续';
    pauseBtn.className = 'download-action-btn resume-btn';
    chrome.runtime.sendMessage({ type: 'pauseDownload' }).catch(() => {});
  }
}

// Cancel download and return to initial state
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

// Watch downloadState changes in storage (for real-time progress)
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
          updateProgress(state.progress, state.statusText);
          showDownloadActions();
          progressSection.style.display = 'block';
        }
        break;
      case 'paused':
        updateProgress(state.progress, '下载已暂停');
        showDownloadActions();
        pauseBtnText.textContent = '继续';
        pauseBtn.className = 'download-action-btn resume-btn';
        downloadPaused = true;
        progressSection.style.display = 'block';
        break;
      case 'complete':
        downloadComplete = true;
        if (storageChangeListener) {
          chrome.storage.onChanged.removeListener(storageChangeListener);
          storageChangeListener = null;
        }
        showDownloadBtn();
        progressBar.style.width = '0%';
        statusText.textContent = '';
        progressSection.style.display = 'none';
        // Add to downloaded list
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

// Restore download state when popup opens (e.g., download was started and popup was closed)
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

      // Reconstruct video info from cache
      if (cachedVideoInfo && state.videoId && cachedVideoInfo.videoId === state.videoId) {
        currentVideoInfo = cachedVideoInfo;
        currentVideoId = cachedVideoInfo.videoId;
      } else {
        currentVideoId = state.videoId;
        currentVideoInfo = {
          videoId: state.videoId,
          title: state.videoTitle || '视频',
          url: state.videoId ? `https://www.youtube.com/watch?v=${state.videoId}` : '',
          thumbnail: state.videoId ? `https://i.ytimg.com/vi/${state.videoId}/mqdefault.jpg` : ''
        };
      }

      showLoadingState(false);
      currentVideo.style.display = 'block';

      switch (state.status) {
        case 'downloading':
          displayVideoInfo(currentVideoInfo);
          showDownloadActions();
          downloadPaused = false;
          progressSection.style.display = 'block';
          updateProgress(state.progress, state.statusText || '下载中...');
          downloadBtn.style.display = 'none';
          watchDownloadState();
          // Also fetch formats in background for when download completes
          pendingQualityRestore = state.quality || null;
          if (currentVideoInfo.url) {
            fetchFormats(currentVideoInfo.url);
          }
          break;

        case 'paused':
          displayVideoInfo(currentVideoInfo);
          showDownloadActions();
          downloadPaused = true;
          progressSection.style.display = 'block';
          updateProgress(state.progress, '下载已暂停');
          pauseBtnText.textContent = '继续';
          pauseBtn.className = 'download-action-btn resume-btn';
          downloadBtn.style.display = 'none';
          watchDownloadState();
          pendingQualityRestore = state.quality || null;
          if (currentVideoInfo.url) {
            fetchFormats(currentVideoInfo.url);
          }
          break;

        case 'complete':
          // Add to downloaded list (don't show old completion section)
          downloadComplete = true;
          showDownloadBtn();
          progressSection.style.display = 'none';
          if (state.filePath) {
            // Add to downloaded list
            addDownloadedVideo({
              videoId: currentVideoId,
              title: currentVideoInfo?.title || state.videoTitle || '',
              filePath: state.filePath,
              thumbnail: currentVideoInfo?.thumbnail || '',
              quality: state.quality || '',
              filesize: state.filesize || 0,
              qualityMeta: state.qualityMeta || null
            });
            // Reset state to idle so next open doesn't show completion again
            chrome.runtime.sendMessage({ type: 'cancelDownload' }).catch(() => {});
          }
          break;

        case 'error':
          showError(state.errorMessage || '下载出错');
          chrome.runtime.sendMessage({ type: 'cancelDownload' }).catch(() => {});
          break;

        default:
          resolve(false);
          return;
      }

      // Clean up listener on popup close
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

// Show completion state (keep video section visible)
function showCompletion(path) {
  completionSection.style.display = 'block';
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
  videoTitle.style.textAlign = 'center';
  videoTitle.style.webkitLineClamp = 'unset';
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

  // "..." menu toggle
  moreMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const visible = moreMenuDropdown.style.display === 'block';
    moreMenuDropdown.style.display = visible ? 'none' : 'block';
  });

  // Delete all history
  clearAllHistory.addEventListener('click', () => {
    downloadedVideos = [];
    saveDownloadedVideos();
    // Also clear in background's storage
    if (storageLocal) {
      storageLocal.set({ downloadedVideos: [] });
    }
    downloadedListExpanded = false;
    renderDownloadedList();
    moreMenuDropdown.style.display = 'none';
  });

  // "Show more" / "Collapse" button
  showMoreBtn.addEventListener('click', () => {
    downloadedListExpanded = !downloadedListExpanded;
    renderDownloadedList();
    // Collapse video info section when expanding the downloaded list
    if (downloadedListExpanded && downloadedVideos.length > 3) {
      currentVideo.style.display = 'none';
      downloadBtn.style.display = 'none';
      downloadActions.style.display = 'none';
      progressSection.style.display = 'none';
      completionSection.style.display = 'none';
      errorSection.style.display = 'none';
    } else {
      currentVideo.style.display = 'block';
    }
  });

  // Close dropdown on click outside
  document.addEventListener('click', () => {
    moreMenuDropdown.style.display = 'none';
  });
}
