// StarDownload - Bilibili Platform Module

const BilibiliPlatform = {
  id: 'bilibili',
  name: 'Bilibili',

  match(url) {
    return /bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/.test(url);
  },

  extractId(url) {
    const m = url.match(/\/video\/(BV[a-zA-Z0-9]+)/);
    return m ? m[1] : null;
  },

  thumbnailUrl(id) {
    // B站 thumbnail URLs are not predictable, rely on yt-dlp
    return '';
  },

  watchUrl(id) {
    return `https://www.bilibili.com/video/${id}`;
  },
};
