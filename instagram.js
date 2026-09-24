// extractors/instagram.js
// Instagram: delegated to yt-dlp's own Instagram extractor.
// Covers reels, posts and stories that are public. Private/followers-only content will
// correctly surface as a 'private' error from core.why() rather than a generic failure.
'use strict';
const core = require('../lib/ytdlpCore');

const EXTRA_ARGS = [];

module.exports = {
  id: 'instagram',
  label: 'Instagram',
  info: (url) => core.info(url, EXTRA_ARGS),
  buildDownloadArgs: (url, type, h, lang, base, maxMB) => core.buildArgs(url, type, h, lang, base, EXTRA_ARGS, maxMB),
};
