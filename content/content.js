// StarDownload Content Script - Runs on YouTube pages

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getVideoInfo') {
    const videoInfo = getVideoInfo();
    sendResponse({ success: !!videoInfo, data: videoInfo });
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
  // Method 1: From meta tag
  const metaTitle = document.querySelector('meta[name="title"]');
  if (metaTitle) {
    return metaTitle.getAttribute('content').replace(' - YouTube', '');
  }

  // Method 2: From og:title meta tag
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) {
    return ogTitle.getAttribute('content').replace(' - YouTube', '');
  }

  // Method 3: From title tag
  const titleTag = document.querySelector('title');
  if (titleTag) {
    return titleTag.textContent.replace(' - YouTube', '').trim();
  }

  return '未知标题';
}

// Get the best available thumbnail
function getThumbnail(videoId) {
  // Try maxresdefault first (best quality)
  const maxRes = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

  // If maxresdefault fails, we'll use hqdefault as fallback
  return maxRes;
}

// For backwards compatibility with older YouTube layouts
function getLegacyThumbnail(videoId) {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}