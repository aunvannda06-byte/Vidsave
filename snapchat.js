// extractors/snapchat.js
// Snapchat: delegated to yt-dlp's own Snapchat extractor.
// IMPORTANT: yt-dlp's Snapchat support is limited to public 'Spotlight' links
// (snapchat.com/spotlight/...). Regular Story/Snap share links are not public HTTP
// resources at all and will correctly come back as 'unsupported' or 'nomedia' — this is
// an honest limitation of what's publicly fetchable, not a bug in this module.
'use strict';
const core = require('../lib/ytdlpCore');

const EXTRA_ARGS = [];

module.exports = {
  id: 'snapchat',
  label: 'Snapchat',
  info: (url) => core.info(url, EXTRA_ARGS),
  buildDownloadArgs: (url, type, h, lang, base, maxMB) => core.buildArgs(url, type, h, lang, base, EXTRA_ARGS, maxMB),
};
