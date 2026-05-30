// StarDownload - Platform Registry

// Register all platforms here. Adding a new platform is as simple as
// creating a new module and adding it to this array.
const PLATFORMS = [
  YouTubePlatform,
  BilibiliPlatform,
];

function detectPlatform(url) {
  if (!url) return null;
  for (const platform of PLATFORMS) {
    if (platform.match(url)) {
      return platform;
    }
  }
  return null;
}

function isSupported(url) {
  return detectPlatform(url) !== null;
}
