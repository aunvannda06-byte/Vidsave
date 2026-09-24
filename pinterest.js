// extractors/pinterest.js
// Pinterest: delegated to yt-dlp's own Pinterest extractor.
// Covers pinterest.<tld> and the pin.it short-link domain. Image-only pins surface as
// 'nomedia' rather than a generic failure.
'use strict';
const core = require('../lib/ytdlpCore');

const EXTRA_ARGS = [];

module.exports = {
  id: 'pinterest',
  label: 'Pinterest',
  info: (url) => core.info(url, EXTRA_ARGS),
  buildDownloadArgs: (url, type, h, lang, base, maxMB) => core.buildArgs(url, type, h, lang, base, EXTRA_ARGS, maxMB),
};
