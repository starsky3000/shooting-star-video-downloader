// StarDownload - YouTube Platform Module

const YouTubePlatform = {
  id: 'youtube',
  name: 'YouTube',

  match(url) {
    return url.includes('youtube.com/watch') || url.includes('youtube.com/shorts/');
  },

  extractId(url) {
    if (url.includes('/shorts/')) {
      const m = url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
      if (m) return m[1];
    }
    try {
      return new URL(url).searchParams.get('v');
    } catch (e) {}
    return null;
  },

  thumbnailUrl(id) {
    return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  },

  watchUrl(id) {
    return `https://www.youtube.com/watch?v=${id}`;
  },
};
