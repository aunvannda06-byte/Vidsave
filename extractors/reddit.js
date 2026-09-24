// extractors/reddit.js
// Reddit: delegated to yt-dlp's own Reddit extractor.
// Covers reddit.com and redd.it video posts. Text-only or image-only posts correctly
// surface as 'nomedia'.
'use strict';
const core = require('../lib/ytdlpCore');

const EXTRA_ARGS = [];

module.exports = {
  id: 'reddit',
  label: 'Reddit',
  info: (url) => core.info(url, EXTRA_ARGS),
  buildDownloadArgs: (url, type, h, lang, base, maxMB) => core.buildArgs(url, type, h, lang, base, EXTRA_ARGS, maxMB),
};
