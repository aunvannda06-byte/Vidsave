// Vidsave: paste a public link -> list qualities -> download video (exact resolution),
// music (MP3), or subtitles (SRT).
// YouTube/TikTok/Instagram/Facebook/X/Reddit/Pinterest/Threads/Snapchat go through
// yt-dlp + ffmpeg + the bgutil PO-token provider (see Dockerfile).
// Telegram public posts go through extractors/telegram.js (no yt-dlp, no credentials).
// Public content only: no cookies, no logins, no API keys are ever accepted from or sent
// to the frontend.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const core = require('./lib/ytdlpCore');
const { detectPlatform, getExtractor } = require('./extractors');
const telegram = require('./extractors/telegram');

const PORT = process.env.PORT || 3000, MAX_MB = +process.env.MAX_MB || 500, MAX_JOBS = +process.env.MAX_JOBS || 3;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-'));
const jobs = new Map(), hits = new Map();
let running = 0;
const json = (r, c, o) => { r.writeHead(c, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(o)); };

// Simple fixed-window rate limit: 20 requests/minute per IP across /api/info and /api/prepare.
const limited = ip => {
  const n = Date.now(), a = (hits.get(ip) || []).filter(t => n - t < 60000);
  a.push(n); hits.set(ip, a);
  return a.length > 20;
};

// User-facing error copy. Every error code returned by an extractor maps to exactly one
// of these — the frontend never sees a raw yt-dlp/HTTP error, and no server path,
// command, or stack trace is ever included in a response.
const M = {
  private: 'This video is private, login-only, or otherwise unavailable.',
  bot: 'The platform is currently blocking automated verification. Please wait a moment and try again.',
  unsupported: 'This URL is not supported.',
  nomedia: 'No downloadable video was found in this post.',
  busy: 'The server is busy right now, please try again shortly.',
  toolarge: 'This video exceeds the server download limit.',
  failed: 'This video could not be downloaded. Please check the link and try again.',
};

const CT = { mp3: 'audio/mpeg', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', srt: 'application/x-subrip', vtt: 'text/vtt' };

setInterval(() => {
  const n = Date.now();
  for (const [id, j] of jobs) if (n - j.t > 15 * 60000) { if (j.file) fs.unlink(j.file, () => {}); jobs.delete(id); }
}, 60000).unref();

async function prepareYtdlp(job, extractor, url, type, h, lang, title) {
  const base = path.join(TMP, job.id);
  let lastErr = null;
  try {
    await core.runDownload(extractor.buildDownloadArgs(url, type, h, lang, base, MAX_MB));
  } catch (e) {
    lastErr = e;
    if (core.why(e.message) === 'bot') {
      await new Promise(res => setTimeout(res, 1500));
      try {
        await core.runDownload(extractor.buildDownloadArgs(url, type, h, lang, base, MAX_MB));
        lastErr = null;
      } catch (e2) {
        lastErr = e2;
      }
    }
  }
  const f = fs.readdirSync(TMP).find(x => x.startsWith(job.id + '.') && !/\.(part|ytdl)$/.test(x));
  if (lastErr || !f) {
    job.state = 'error';
    job.msg = core.why(lastErr ? lastErr.message : '');
    console.error('[prepare]', job.id, url, lastErr && lastErr.message);
    return;
  }
  const ext = path.extname(f).slice(1);
  const suffix = type === 'audio' ? '' : type === 'subtitle' ? ` [${lang}]` : ` ${h}p`;
  Object.assign(job, { state: 'ready', file: path.join(TMP, f), ext, size: fs.statSync(path.join(TMP, f)).size, name: core.safe(title) + suffix + '.' + ext });
}

async function prepareTelegram(job, url, title) {
  const base = path.join(TMP, job.id);
  try {
    const ext = await telegram.download(url, base, MAX_MB);
    const file = base + '.' + ext;
    Object.assign(job, { state: 'ready', file, ext, size: fs.statSync(file).size, name: core.safe(title) + '.' + ext });
  } catch (e) {
    job.state = 'error';
    job.msg = ['private', 'nomedia', 'toolarge', 'unsupported'].includes(e.message) ? e.message : 'failed';
    console.error('[prepare:telegram]', job.id, url, e.message);
  }
}

async function prepare(id, url, platform, type, h, lang, title) {
  const job = jobs.get(id);
  try {
    if (platform === 'telegram') {
      await prepareTelegram(job, url, title);
    } else {
      const extractor = getExtractor(platform);
      await prepareYtdlp(job, extractor, url, type, h, lang, title);
    }
  } finally {
    running--;
  }
}

http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x');
  const ip = (q.headers['x-forwarded-for'] || q.socket.remoteAddress || '').split(',')[0].trim();

  if (u.pathname === '/api/info') {
    if (limited(ip)) return json(r, 429, { error: 'busy' });
    const raw = u.searchParams.get('url') || '';
    const platform = detectPlatform(raw);
    if (!platform) return json(r, 400, { error: 'unsupported' });
    const extractor = getExtractor(platform);
    return extractor.info(raw).then(
      d => json(r, 200, { ...d, platform }),
      e => json(r, 422, { error: M[e.message] ? e.message : 'failed' })
    );
  }

  if (u.pathname === '/api/prepare' && q.method === 'POST') {
    let b = '';
    q.on('data', c => { b += c; if (b.length > 5e3) q.destroy(); });
    q.on('end', () => {
      let m;
      try { m = JSON.parse(b); } catch (e) { return json(r, 400, { error: 'unsupported' }); }
      const url = String(m.url || '');
      const platform = detectPlatform(url);
      const h = +m.h;
      const type = m.type === 'audio' ? 'audio' : m.type === 'subtitle' ? 'subtitle' : 'video';
      const lang = String(m.lang || '').slice(0, 10);
      const title = String(m.title || '').slice(0, 200);

      if (!platform) return json(r, 400, { error: 'unsupported' });
      if (platform === 'telegram') {
        // Telegram exposes exactly one media rendition per post; type/h/lang are ignored.
      } else if (type === 'video' && !(Number.isInteger(h) && h > 0 && h < 10000)) {
        return json(r, 400, { error: 'unsupported' });
      } else if (type === 'subtitle' && !lang) {
        return json(r, 400, { error: 'unsupported' });
      }
      if (limited(ip) || running >= MAX_JOBS) return json(r, 503, { error: 'busy' });

      const id = crypto.randomBytes(9).toString('hex');
      jobs.set(id, { id, state: 'working', t: Date.now() });
      running++;
      prepare(id, url, platform, type, h, lang, title); // fire and forget; poll /api/job/:id
      json(r, 200, { id });
    });
    return;
  }

  let m = u.pathname.match(/^\/api\/job\/(\w+)$/);
  if (m) {
    const j = jobs.get(m[1]);
    if (!j) return json(r, 404, { state: 'error', msg: 'failed' });
    return json(r, 200, { state: j.state, msg: j.msg, size: j.size });
  }

  m = u.pathname.match(/^\/api\/file\/(\w+)$/);
  if (m) {
    const j = jobs.get(m[1]);
    if (!j || j.state !== 'ready') return json(r, 404, {});
    const ascii = j.name.replace(/[^\x20-\x7e]/g, '_');
    r.writeHead(200, {
      'Content-Type': CT[j.ext] || 'application/octet-stream',
      'Content-Length': j.size,
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(j.name)}`,
    });
    const s = fs.createReadStream(j.file);
    s.pipe(r);
    r.on('close', () => { s.destroy(); });
    r.on('finish', () => { fs.unlink(j.file, () => {}); jobs.delete(m[1]); });
    return;
  }

  fs.readFile(path.join(__dirname, 'index.html'), (e, d) => {
    if (e) { r.writeHead(500); return r.end('index.html not found'); }
    r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    r.end(d);
  });
}).listen(PORT, () => console.log('Vidsave on ' + PORT));
