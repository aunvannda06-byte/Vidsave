// extractors/threads.js
// Threads: delegated to yt-dlp's own Threads extractor.
// Covers threads.net and threads.com. Text-only threads with no attached video/image
// surface as 'nomedia'.
'use strict';
const core = require('../lib/ytdlpCore');

const EXTRA_ARGS = [];

module.exports = {
  id: 'threads',
  label: 'Threads',
  info: (url) => core.info(url, EXTRA_ARGS),
  buildDownloadArgs: (url, type, h, lang, base, maxMB) => core.buildArgs(url, type, h, lang, base, EXTRA_ARGS, maxMB),
};
