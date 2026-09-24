// extractors/youtube.js
// YouTube: youtube.com/watch, youtu.be/, /shorts/, /live/ are all handled by yt-dlp's
// single YouTube extractor already (it reads the video ID regardless of URL shape), so
// there is nothing URL-shape-specific to do here. This module exists so YouTube-only
// tuning (extractor-args, player-client overrides, etc.) has one clear place to live,
// separate from every other platform.
'use strict';
const core = require('../lib/ytdlpCore');

// Deliberately NOT hardcoding --extractor-args "youtube:player_client=..." here: YouTube's
// accepted client set changes over time, and a hardcoded override can start silently
// failing when YouTube changes what it accepts (this broke a web_safari/mweb/tv override
// in this project in mid-Sept 2026). We let yt-dlp pick its current default and rely on
// the bgutil PO-token sidecar (see server.js / Dockerfile) to make the request trusted.
const EXTRA_ARGS = [];

module.exports = {
  id: 'youtube',
  label: 'YouTube',
  info: (url) => core.info(url, EXTRA_ARGS),
  buildDownloadArgs: (url, type, h, lang, base, maxMB) => core.buildArgs(url, type, h, lang, base, EXTRA_ARGS, maxMB),
};
