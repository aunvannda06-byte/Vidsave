// extractors/telegram.js
// A t.me/<channel>/<id> URL is an HTML message page, not a media file — yt-dlp has no
// extractor for it and can't be pointed at it. This module instead reads Telegram's own
// public "instant view" preview page (t.me/s/<channel>/<id>), which every public channel
// exposes with no login, and pulls the real media URL out of its Open Graph meta tags.
//
// This only works for genuinely PUBLIC channels — exactly the "public content only"
// requirement for this project. Private channels, channels requiring membership, and
// deleted/nonexistent messages all correctly fail with a clear error below. There is no
// Telegram Bot API token or MTProto/user-session login involved, so no Telegram
// credentials of any kind are needed or exposed.
'use strict';
const https = require('https');
const fs = require('fs');

function parseTelegramUrl(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol) || !/(^|\.)t\.me$/i.test(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  let idx = 0;
  if (parts[idx] === 's') idx++; // t.me/s/<channel>/<id> (already the preview form)
  const channel = parts[idx];
  const msgId = parts[idx + 1];
  if (!channel || !/^\d+$/.test(msgId)) return null;
  if (/^(joinchat|addstickers|share|proxy|socks)$/i.test(channel)) return null; // not a message link
  return { channel, msgId: msgId.replace(/\D/g, '') };
}

function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VidsaveBot/1.0)' }, timeout: 15000 }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        return resolve(get(next, redirects - 1));
      }
      resolve(res);
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

function fetchBody(url) {
  return get(url).then(res => new Promise((resolve, reject) => {
    if (res.statusCode !== 200) { res.resume(); return reject(new Error('private')); }
    let data = '';
    res.setEncoding('utf8');
    res.on('data', c => { data += c; if (data.length > 2e6) res.destroy(); });
    res.on('end', () => resolve(data));
    res.on('error', reject);
  }));
}

function meta(html, prop) {
  const re = new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i');
  const m = html.match(re);
  if (!m) return '';
  return m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// Resolves a message URL to its direct media URL + basic metadata. Shared by info() and
// download() so the (short-lived) CDN URL is always freshly fetched right before use.
async function resolve(urlStr) {
  const parsed = parseTelegramUrl(urlStr);
  if (!parsed) throw new Error('unsupported');
  const previewUrl = `https://t.me/s/${parsed.channel}/${parsed.msgId}`;
  let html;
  try {
    html = await fetchBody(previewUrl);
  } catch (e) {
    throw new Error('private');
  }
  if (!html || /tgme_page_deleted|channel.*doesn.t exist|isn.t available/i.test(html)) throw new Error('private');

  const videoUrl = meta(html, 'og:video') || meta(html, 'og:video:secure_url') || meta(html, 'og:video:url');
  const imageUrl = meta(html, 'og:image');
  const title = meta(html, 'og:title') || `${parsed.channel} #${parsed.msgId}`;
  const description = meta(html, 'og:description') || '';

  if (!videoUrl) throw new Error('nomedia'); // post exists but has no video (text/photo-only)

  return {
    title: description ? `${title} — ${description}`.slice(0, 160) : title,
    thumb: imageUrl,
    directUrl: videoUrl,
  };
}

async function info(urlStr) {
  const r = await resolve(urlStr);
  return {
    title: r.title,
    thumb: r.thumb,
    duration: 0,
    source: 'Telegram',
    // Telegram message previews expose exactly one media rendition — height 0 is a
    // sentinel the frontend renders as "Original" quality rather than "0p".
    videos: [{ height: 0, size: 0 }],
    audioSize: 0,
    subtitles: [],
  };
}

// Streams the resolved media straight to disk, enforcing the same MAX_MB cap as the
// yt-dlp path. Returns the file extension actually written.
async function download(urlStr, destBase, maxMB) {
  const r = await resolve(urlStr);
  const maxBytes = maxMB * 1024 * 1024;
  const ext = /\.(mp4|mov|webm)(\?|$)/i.exec(r.directUrl)?.[1]?.toLowerCase() || 'mp4';
  const dest = destBase + '.' + ext;

  const res = await get(r.directUrl);
  if (res.statusCode !== 200) { res.resume(); throw new Error('failed'); }
  const len = +res.headers['content-length'] || 0;
  if (len && len > maxBytes) { res.resume(); throw new Error('toolarge'); }

  await new Promise((resolve2, reject) => {
    let written = 0;
    const file = fs.createWriteStream(dest);
    res.on('data', chunk => {
      written += chunk.length;
      if (written > maxBytes) {
        res.destroy();
        file.close(() => fs.unlink(dest, () => reject(new Error('toolarge'))));
      }
    });
    res.pipe(file);
    file.on('finish', () => file.close(resolve2));
    file.on('error', reject);
    res.on('error', reject);
  });

  return ext;
}

module.exports = { parseTelegramUrl, info, download };
