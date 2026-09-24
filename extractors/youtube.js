// extractors/youtube.js
// YouTube: youtube.com/watch, youtu.be/, /shorts/, /live/ are all handled by yt-dlp's
// single YouTube extractor already (it reads the video ID regardless of URL shape), so
// there is nothing URL-shape-specific to do here. This module exists so YouTube-only
// tuning (extractor-args, player-client overrides, etc.) has one clear place to live,
// separate from every other platform.
'use strict';
const core = require('../lib/ytdlpCore');

// Try the android client first, falling back to web if it's rejected: the android
// client frequently skips the "sign in to confirm you're not a bot" challenge that the
// default web client can trigger on datacenter IPs (like Render's), since it doesn't
// rely on the same PO-token-gated code path. This is not a permanent guarantee — YouTube
// changes what it accepts over time — so if this stops working, check yt-dlp's own
// issue tracker for the currently-recommended --extractor-args player_client value.
const EXTRA_ARGS = ['--extractor-args', 'youtube:player_client=android,web'];

module.exports = {
  id: 'youtube',
  label: 'YouTube',
  info: (url) => core.info(url, EXTRA_ARGS),
  buildDownloadArgs: (url, type, h, lang, base, maxMB) => core.buildArgs(url, type, h, lang, base, EXTRA_ARGS, maxMB),
};
