// lib/ytdlpCore.js
// Shared logic for every platform whose extraction is delegated to yt-dlp
// (YouTube, TikTok, Instagram, Facebook, X/Twitter, Reddit, Pinterest, Threads, Snapchat).
// Telegram does NOT use this file — see extractors/telegram.js.
'use strict';
const { execFile } = require('child_process');
const fs = require('fs');

// --js-runtimes node is required for yt-dlp's own signature/nsig decryption (mainly YouTube),
// harmless to pass for every other extractor.
const COMMON_ARGS = ['--js-runtimes', 'node'];

// Optional: path to a Netscape-format cookies.txt file, exported from a real logged-in
// browser session, set as a server-side-only secret (e.g. a Render Secret File). NEVER
// accept a cookies file or path from the frontend/request — this only ever reads a path
// the operator configured via environment variable at deploy time. If the platform's own
// bot-check is blocking the server's IP outright (common on shared/free hosting), cookies
// make the request look like it's coming from an authenticated browser and are the fix
// yt-dlp itself recommends. Leave COOKIES_FILE unset to run with no cookies at all.
const COOKIES_FILE = process.env.COOKIES_FILE || '';
const cookieArgs = () => (COOKIES_FILE && fs.existsSync(COOKIES_FILE)) ? ['--cookies', COOKIES_FILE] : [];

function ytdlpJSON(url, extraArgs = []) {
  return new Promise((ok, no) => {
    execFile(
      'yt-dlp',
      ['-J', '--no-playlist', '--no-warnings', ...COMMON_ARGS, ...cookieArgs(), ...extraArgs, url],
      { timeout: 60000, maxBuffer: 64e6 },
      (e, out, err) => {
        if (e) return no(new Error(String(err || '') + ' ' + e.message));
        try {
          ok(JSON.parse(out));
        } catch (x) {
          no(new Error('failed to parse yt-dlp output'));
        }
      }
    );
  });
}

function buildInfo(j) {
  const F = j.formats || [];
  const ab = F.filter(f => f.vcodec === 'none' && f.acodec && f.acodec !== 'none')
    .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
  const asz = ab ? (ab.filesize || ab.filesize_approx || 0) : 0;
  const by = {};
  F.filter(f => f.vcodec && f.vcodec !== 'none' && f.height).forEach(f => {
    const size = (f.filesize || f.filesize_approx || 0) + (f.acodec === 'none' ? asz : 0);
    const o = by[f.height];
    if (!o || (f.tbr || 0) > o.tbr) by[f.height] = { height: f.height, size, tbr: f.tbr || 0 };
  });
  let videos = Object.values(by).sort((a, b) => b.height - a.height).map(({ height, size }) => ({ height, size }));
  if (!videos.length && j.height) videos = [{ height: j.height, size: j.filesize || j.filesize_approx || 0 }];

  const subs = {};
  for (const [k, v] of Object.entries(j.subtitles || {})) subs[k] = { lang: k, name: (v[0] && v[0].name) || k, auto: false };
  for (const [k, v] of Object.entries(j.automatic_captions || {})) if (!subs[k]) subs[k] = { lang: k, name: (v[0] && v[0].name) || k, auto: true };
  const PRI = ['km', 'en'];
  const subtitles = Object.values(subs)
    .sort((a, b) => ((PRI.indexOf(a.lang) + 1) || 99) - ((PRI.indexOf(b.lang) + 1) || 99) || a.lang.localeCompare(b.lang))
    .slice(0, 24);

  return {
    title: j.title || 'video',
    thumb: j.thumbnail || '',
    duration: j.duration || 0,
    source: j.extractor_key || '',
    videos,
    audioSize: Math.round((j.duration || 0) * 16000),
    subtitles,
  };
}

// Maps a raw yt-dlp/stderr blob to one of a fixed set of user-facing error codes.
// Order matters: the bot-check message contains the word "sign in", so it must be
// checked before the broader private/login pattern or it gets mis-labelled.
function why(s) {
  if (/confirm (you.?re|you are) not a bot|sign in to confirm/i.test(s)) return 'bot';
  if (/private|log ?in|cookies|members|not available|age.?restrict/i.test(s)) return 'private';
  if (/max-filesize|larger than/i.test(s)) return 'toolarge';
  if (/unsupported url|no extractor/i.test(s)) return 'unsupported';
  if (/no video formats|requested format not available|unable to extract.*video|no formats found|nonetype.*subscript|has no attribute/i.test(s)) return 'nomedia';
  return 'failed';
}

function runDownload(args) {
  return new Promise((ok, no) => {
    execFile('yt-dlp', args, { timeout: 600000, maxBuffer: 16e6 }, (e, so, se) => {
      if (e) return no(new Error(String(se || '') + ' ' + e.message));
      ok();
    });
  });
}

function buildArgs(url, type, h, lang, base, extraArgs = [], maxMB) {
  const a = ['--no-playlist', '--no-warnings', ...COMMON_ARGS, ...cookieArgs(), ...extraArgs];
  if (type === 'subtitle') {
    a.push('--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', lang, '--sub-format', 'srt/vtt', '--convert-subs', 'srt', '-o', base + '.%(ext)s');
  } else if (type === 'audio') {
    a.push('--max-filesize', maxMB + 'M', '-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', base + '.%(ext)s');
  } else {
    a.push('--max-filesize', maxMB + 'M', '-f', `bv*[height=${h}]+ba/b[height=${h}]`, '--merge-output-format', 'mp4', '-o', base + '.%(ext)s');
  }
  a.push(url);
  return a;
}

// Fetch + normalize info, with one retry on a transient bot-check (the PO-token
// cache for YouTube can still be warming up right after container start).
async function info(url, extraArgs = []) {
  try {
    return buildInfo(await ytdlpJSON(url, extraArgs));
  } catch (e) {
    if (why(e.message) === 'bot') {
      await new Promise(res => setTimeout(res, 1500));
      try {
        return buildInfo(await ytdlpJSON(url, extraArgs));
      } catch (e2) {
        console.error('[info]', url, e2.message);
        throw new Error(why(e2.message));
      }
    }
    console.error('[info]', url, e.message);
    throw new Error(why(e.message));
  }
}

const safe = t => String(t || 'video').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'video';

module.exports = { ytdlpJSON, buildInfo, why, runDownload, buildArgs, info, safe, COMMON_ARGS };
