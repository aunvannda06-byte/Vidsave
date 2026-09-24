// extractors/twitter.js
// X / Twitter: delegated to yt-dlp's own X / Twitter extractor.
// Covers both twitter.com and x.com (same yt-dlp extractor). Protected/suspended
// accounts surface as 'private' or 'nomedia' respectively.
'use strict';
const core = require('../lib/ytdlpCore');

const EXTRA_ARGS = [];

module.exports = {
  id: 'twitter',
  label: 'X / Twitter',
  info: (url) => core.info(url, EXTRA_ARGS),
  buildDownloadArgs: (url, type, h, lang, base, maxMB) => core.buildArgs(url, type, h, lang, base, EXTRA_ARGS, maxMB),
};
