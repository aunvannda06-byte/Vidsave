// extractors/index.js
// Central platform detector + registry. server.js only talks to this file, never to an
// individual extractor module directly, and never shells out itself.
'use strict';

const YTDLP_MODULES = {
  youtube: require('./youtube'),
  tiktok: require('./tiktok'),
  instagram: require('./instagram'),
  facebook: require('./facebook'),
  twitter: require('./twitter'),
  reddit: require('./reddit'),
  pinterest: require('./pinterest'),
  threads: require('./threads'),
  snapchat: require('./snapchat'),
};
const telegram = require('./telegram');

const HOST_PATTERNS = {
  youtube: /(^|\.)(youtube\.com|youtu\.be)$/i,
  tiktok: /(^|\.)tiktok\.com$/i,
  instagram: /(^|\.)instagram\.com$/i,
  facebook: /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/i,
  twitter: /(^|\.)(twitter\.com|x\.com)$/i,
  reddit: /(^|\.)(reddit\.com|redd\.it)$/i,
  pinterest: /(^|\.)(pinterest\.[a-z.]+|pin\.it)$/i,
  threads: /(^|\.)(threads\.net|threads\.com)$/i,
  snapchat: /(^|\.)snapchat\.com$/i,
  telegram: /(^|\.)t\.me$/i,
};

// Returns a platform key (e.g. 'youtube') or null if the URL is not http(s) or matches
// no supported platform. This is the single point of server-side URL validation — nothing
// downstream trusts an unvalidated URL.
function detectPlatform(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch (e) {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  for (const [platform, re] of Object.entries(HOST_PATTERNS)) {
    if (re.test(u.hostname)) return platform;
  }
  return null;
}

// Returns the extractor module for a platform key, or null. Telegram is intentionally
// not part of YTDLP_MODULES since its interface (info/download) differs from the shared
// yt-dlp one (info/buildDownloadArgs) — server.js branches on platform === 'telegram'.
function getExtractor(platform) {
  if (platform === 'telegram') return telegram;
  return YTDLP_MODULES[platform] || null;
}

module.exports = { detectPlatform, getExtractor, HOST_PATTERNS };
