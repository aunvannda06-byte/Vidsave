// extractors/tiktok.js
// TikTok: delegated to yt-dlp's own TikTok extractor.
// No TikTok-specific extractor-args needed today; kept as its own module so watermark
// handling / API-hostname overrides can be added here later without touching other platforms.
'use strict';
const core = require('../lib/ytdlpCore');

const EXTRA_ARGS = [];

module.exports = {
  id: 'tiktok',
  label: 'TikTok',
  info: (url) => core.info(url, EXTRA_ARGS),
  buildDownloadArgs: (url, type, h, lang, base, maxMB) => core.buildArgs(url, type, h, lang, base, EXTRA_ARGS, maxMB),
};
