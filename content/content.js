// StarDownload Content Script - Runs on supported video pages

// Initialize i18n
if (typeof I18n !== 'undefined') {
  I18n.init().catch(() => {});
}

// Read the platform modules (injected via manifest content_scripts order)
// Access PLATFORMS and isSupported from the platform scripts

// Proactively report video availability to background for icon update
function reportVideoStatus() {
  const url = window.location.href;
  const platform = typeof detectPlatform === 'function' ? detectPlatform(url) : null;
  if (platform) {
    chrome.runtime.sendMessage({ type: 'videoInfoReceived' }).catch(() => {});
  }
}

// Report immediately on load
reportVideoStatus();

// Also report after SPA navigations (e.g., clicking another video)
let lastUrl = window.location.href;
new MutationObserver(() => {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    setTimeout(reportVideoStatus, 2000);
  }
}).observe(document.querySelector('title') || document.body, { subtree: true, childList: true });

// Listen for messages from popup or background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getVideoInfo') {
    // Video info is now fetched via yt-dlp; return null to indicate DOM scraping is no longer used
    sendResponse({ success: false, data: null });
  } else if (request.action === 'ping') {
    const url = window.location.href;
    const platform = typeof detectPlatform === 'function' ? detectPlatform(url) : null;
    sendResponse({ hasVideo: !!platform });
  }
  return true;
});
