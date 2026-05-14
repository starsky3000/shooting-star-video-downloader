// StarDownload Content Script - Runs on YouTube pages

// Listen for messages from popup or background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getVideoInfo') {
    const videoInfo = getVideoInfo();
    sendResponse({ success: !!videoInfo, data: videoInfo });
  } else if (request.action === 'ping') {
    // Respond to ping from background script
    const hasVideo = window.location.href.includes('/watch?v=');
    sendResponse({ hasVideo: hasVideo });
  }
  return true;
});

// Extract video information from YouTube page
function getVideoInfo() {
  const url = window.location.href;

  // Check if this is a valid YouTube video page
  if (!url.includes('/watch?v=')) {
    return null;
  }

  // Get video ID
  const videoId = getVideoId(url);
  if (!videoId) {
    return null;
  }

  // Get video title
  const title = getVideoTitle();

  // Get thumbnail URL
  const thumbnail = getThumbnail(videoId);

  return {
    url: url,
    videoId: videoId,
    title: title,
    thumbnail: thumbnail
  };
}

// Extract video ID from URL
function getVideoId(url) {
  const urlParams = new URLSearchParams(new URL(url).search);
  return urlParams.get('v');
}

// Extract video title
function getVideoTitle() {
  // Document title is most reliable after SPA navigation
  // Clean it: remove "- YouTube" suffix and unread count like "(2)" at the START
  let title = document.title.replace(/ - YouTube$/, '').trim();
  title = title.replace(/^\s*\(\d+\)\s*/, '').trim();
  return title || '未知标题';
}

// Get the smaller thumbnail (default size)
function getThumbnail(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/default.jpg`;
}

// For backwards compatibility with older YouTube layouts
function getLegacyThumbnail(videoId) {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}