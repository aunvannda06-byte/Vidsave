// extractors/facebook.js
// Facebook: delegated to yt-dlp's own Facebook extractor.
// Covers facebook.com and fb.watch public video posts/reels. Group- or friends-only
// videos will surface as 'private'.
'use strict';
const core = require('../lib/ytdlpCore');

const EXTRA_ARGS = [];

module.exports = {
  id: 'facebook',
  label: 'Facebook',
  info: (url) => core.info(url, EXTRA_ARGS),
  buildDownloadArgs: (url, type, h, lang, base, maxMB) => core.buildArgs(url, type, h, lang, base, EXTRA_ARGS, maxMB),
};
