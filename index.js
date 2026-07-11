/*  ═══════════════════════════════════════════════════════════════
    ORBY  ◦  A Cosmic YouTube Frontend
    single-file server + client · powered by InnerTube
    ═══════════════════════════════════════════════════════════════ */

'use strict';

const express = require('express');
const { Innertube, UniversalCache, ClientType } = require('youtubei.js');
const ytdl = require('@distube/ytdl-core');

const app = express();
const PORT = process.env.PORT || 3000;

/* ────────────────────────────────────────────────────────────────
   1.  InnerTube session pool (multi-client for resilience)
   ──────────────────────────────────────────────────────────────── */
const ytPool = { WEB: null, ANDROID: null, IOS: null, TV: null };

async function initClient(type) {
  return Innertube.create({
    cache: new UniversalCache(false),
    generate_session_locally: true,
    retrieve_player: true,
    client_type: type,
    lang: 'ja',
    location: 'JP',
  });
}

async function getYT(type = 'WEB') {
  if (!ytPool[type]) ytPool[type] = await initClient(type);
  return ytPool[type];
}

/* ────────────────────────────────────────────────────────────────
   2.  In-memory TTL cache
   ──────────────────────────────────────────────────────────────── */
const cache = new Map();
const TTL = 5 * 60 * 1000;

function cacheGet(k) {
  const v = cache.get(k);
  if (!v) return null;
  if (Date.now() - v.t > TTL) { cache.delete(k); return null; }
  return v.d;
}
function cacheSet(k, d) { cache.set(k, { t: Date.now(), d }); }

async function memo(key, fn) {
  const hit = cacheGet(key);
  if (hit) return hit;
  const d = await fn();
  cacheSet(key, d);
  return d;
}

/* ────────────────────────────────────────────────────────────────
   3.  Helpers
   ──────────────────────────────────────────────────────────────── */
const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const jesc = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

function fmtViews(n) {
  n = Number(n) || 0;
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '億';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function fmtDuration(sec) {
  sec = Number(sec) || 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function bestThumb(thumbs) {
  if (!Array.isArray(thumbs) || !thumbs.length) return '';
  const sorted = [...thumbs].sort((a, b) => (b.width || 0) - (a.width || 0));
  return sorted[0].url || '';
}

// 正規表現でID系を抽出
const RE_VIDEO_ID   = /(?:v=|\/shorts\/|youtu\.be\/|\/embed\/)([A-Za-z0-9_-]{11})/;
const RE_PLAYLIST   = /[?&]list=([A-Za-z0-9_-]+)/;
const RE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

function extractVideoId(s = '') {
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(RE_VIDEO_ID);
  return m ? m[1] : null;
}

/* ────────────────────────────────────────────────────────────────
   4.  Normalizers  (turn youtubei.js nodes into plain JSON)
   ──────────────────────────────────────────────────────────────── */
function normVideo(v) {
  if (!v) return null;
  const id =
    v.id || v.video_id || v.videoId ||
    v.on_tap_endpoint?.payload?.videoId ||
    v.endpoint?.payload?.videoId || null;
  if (!id) return null;

  const title =
    (typeof v.title === 'string' ? v.title : v.title?.text) ||
    v.metadata?.title?.text || '';

  const author =
    v.author?.name || v.author?.author?.name ||
    v.long_byline?.text || v.short_byline?.text || '';

  const authorId =
    v.author?.id || v.author?.channel_id || v.channel_id || '';

  const thumbs = v.thumbnails || v.thumbnail || v.author?.thumbnails || [];
  const durSec =
    v.duration?.seconds ?? v.length_seconds ?? v.duration_seconds ?? 0;

  const viewCount =
    v.view_count?.text || v.short_view_count?.text ||
    v.view_count_text || (v.view_count ? String(v.view_count) : '') || '';

  return {
    id,
    title,
    author,
    authorId,
    thumbnail: bestThumb(thumbs),
    duration: durSec ? fmtDuration(durSec) : (v.duration?.text || ''),
    views: viewCount,
    published: v.published?.text || v.publishedTimeText || '',
  };
}

function normPlaylist(p) {
  if (!p) return null;
  const id = p.id || p.playlist_id || p.endpoint?.payload?.playlistId;
  if (!id) return null;
  return {
    id,
    title: (typeof p.title === 'string' ? p.title : p.title?.text) || '',
    thumbnail: bestThumb(p.thumbnails || p.thumbnail || []),
    videoCount: p.video_count?.text || p.video_count || '',
    author: p.author?.name || '',
  };
}

function normChannel(c) {
  if (!c) return null;
  const id = c.id || c.author?.id || c.channel_id;
  if (!id) return null;
  return {
    id,
    name: c.author?.name || (typeof c.title === 'string' ? c.title : c.title?.text) || '',
    thumbnail: bestThumb(c.author?.thumbnails || c.thumbnails || []),
    subscribers: c.subscriber_count?.text || c.video_count?.text || '',
    description: c.description?.text || c.description_snippet?.text || '',
  };
}

/* ────────────────────────────────────────────────────────────────
   5.  Stream URL aggregation — from BOTH youtubei.js and ytdl-core
   ──────────────────────────────────────────────────────────────── */
async function collectStreams(videoId) {
  const results = {
    servers: [],
    hls: null,
    dash: null,
    thumbnail: null,
    duration: 0,
  };

  // Query multiple clients in parallel for maximum coverage
  const jobs = await Promise.allSettled([
    (async () => {
      const yt = await getYT('WEB');
      return yt.getInfo(videoId);
    })(),
    (async () => {
      const yt = await getYT('ANDROID');
      return yt.getBasicInfo(videoId, { client: 'ANDROID' });
    })(),
    (async () => {
      const yt = await getYT('IOS');
      return yt.getBasicInfo(videoId, { client: 'IOS' });
    })(),
    (async () => {
      // ytdl-core fallback
      return ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`, {
        requestOptions: { headers: { 'User-Agent': 'Mozilla/5.0' } },
      });
    })(),
  ]);

  const seen = new Set();
  const push = (obj) => {
    const key = obj.url && obj.url.split('?')[0] + '|' + obj.itag + '|' + obj.label;
    if (!key || seen.has(key)) return;
    seen.add(key);
    results.servers.push(obj);
  };

  // Job 0/1/2 — youtubei.js  (VideoInfo)
  jobs.slice(0, 3).forEach((r, idx) => {
    if (r.status !== 'fulfilled' || !r.value) return;
    const info = r.value;
    const src = ['ytjs-web', 'ytjs-android', 'ytjs-ios'][idx];

    if (info.basic_info) {
      results.thumbnail ||= bestThumb(info.basic_info.thumbnail || []);
      results.duration  ||= info.basic_info.duration || 0;
      results.title     ||= info.basic_info.title;
      results.author    ||= info.basic_info.author;
      results.authorId  ||= info.basic_info.channel_id;
      results.description ||= info.basic_info.short_description;
      results.views     ||= info.basic_info.view_count;
      results.likes     ||= info.basic_info.like_count;
    }

    const sd = info.streaming_data;
    if (!sd) return;

    if (sd.hls_manifest_url && !results.hls) results.hls = sd.hls_manifest_url;
    if (sd.dash_manifest_url && !results.dash) results.dash = sd.dash_manifest_url;

    const all = [...(sd.formats || []), ...(sd.adaptive_formats || [])];
    for (const f of all) {
      const url = f.url || f.decipher?.(info.player) || null;
      if (!url) continue;
      const isProgressive = (f.has_audio && f.has_video);
      push({
        source: src,
        server: 'googlevideo',
        itag: f.itag,
        url,
        mime: f.mime_type,
        quality: f.quality_label || f.audio_quality || f.quality || '',
        bitrate: f.bitrate,
        hasAudio: !!f.has_audio,
        hasVideo: !!f.has_video,
        kind: isProgressive ? 'progressive' : (f.has_video ? 'video' : 'audio'),
        label: (isProgressive ? '[統合] ' : (f.has_video ? '[映像] ' : '[音声] '))
          + (f.quality_label || f.audio_quality_label || f.quality || '?')
          + (f.mime_type ? ' · ' + f.mime_type.split(';')[0].split('/')[1] : ''),
      });
    }
  });

  // Job 3 — ytdl-core fallback
  if (jobs[3].status === 'fulfilled' && jobs[3].value) {
    const info = jobs[3].value;
    const vd = info.videoDetails || {};
    results.thumbnail ||= bestThumb(vd.thumbnails || []);
    results.duration  ||= Number(vd.lengthSeconds) || 0;
    results.title     ||= vd.title;
    results.author    ||= vd.author?.name;
    results.authorId  ||= vd.author?.id;
    results.description ||= vd.description || vd.shortDescription;
    results.views     ||= vd.viewCount;

    for (const f of info.formats || []) {
      if (!f.url) continue;
      const isProgressive = f.hasAudio && f.hasVideo;
      push({
        source: 'ytdl-core',
        server: 'googlevideo',
        itag: f.itag,
        url: f.url,
        mime: f.mimeType,
        quality: f.qualityLabel || f.audioQuality || f.quality || '',
        bitrate: f.bitrate,
        hasAudio: !!f.hasAudio,
        hasVideo: !!f.hasVideo,
        kind: isProgressive ? 'progressive' : (f.hasVideo ? 'video' : 'audio'),
        label: (isProgressive ? '[統合] ' : (f.hasVideo ? '[映像] ' : '[音声] '))
          + (f.qualityLabel || f.audioQuality || f.quality || '?')
          + (f.mimeType ? ' · ' + f.mimeType.split(';')[0].split('/')[1] : ''),
      });
      if (!results.hls && f.isHLS) results.hls = f.url;
    }
  }

  // add convenience "virtual servers"
  if (results.hls)  results.servers.unshift({
    source: 'youtube', server: 'hls', url: results.hls, kind: 'hls',
    label: '🌐 HLS Manifest (Adaptive)',
  });
  if (results.dash) results.servers.unshift({
    source: 'youtube', server: 'dash', url: results.dash, kind: 'dash',
    label: '🌐 DASH Manifest (Adaptive)',
  });
  results.servers.unshift({
    source: 'youtube', server: 'embed',
    url: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`,
    kind: 'embed', label: '📺 YouTube Embed (fallback)',
  });

  // sort progressive first (highest quality), then video-only, then audio
  const order = { progressive: 0, hls: 1, dash: 2, video: 3, audio: 4, embed: 5 };
  results.servers.sort((a, b) => {
    const oa = order[a.kind] ?? 9, ob = order[b.kind] ?? 9;
    if (oa !== ob) return oa - ob;
    return (b.bitrate || 0) - (a.bitrate || 0);
  });

  return results;
}

/* ────────────────────────────────────────────────────────────────
   6.  API endpoints
   ──────────────────────────────────────────────────────────────── */
app.get('/api/home', async (req, res) => {
  try {
    const data = await memo('home', async () => {
      const yt = await getYT('WEB');
      const feed = await yt.getHomeFeed();
      const videos = (feed.videos || []).map(normVideo).filter(Boolean).slice(0, 60);
      return { videos };
    });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ videos: [], channels: [], playlists: [] });
  try {
    const data = await memo('search:' + q, async () => {
      const yt = await getYT('WEB');
      const [result, suggestions] = await Promise.all([
        yt.search(q),
        yt.getSearchSuggestions(q).catch(() => []),
      ]);
      const videos = [], channels = [], playlists = [];
      for (const item of (result.results || [])) {
        const t = item.type || item.constructor?.name || '';
        if (/Video/i.test(t) && !/Playlist/i.test(t)) {
          const v = normVideo(item); if (v) videos.push(v);
        } else if (/Channel/i.test(t)) {
          const c = normChannel(item); if (c) channels.push(c);
        } else if (/Playlist/i.test(t)) {
          const p = normPlaylist(item); if (p) playlists.push(p);
        }
      }
      return { query: q, suggestions, videos, channels, playlists };
    });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/suggest', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const yt = await getYT('WEB');
    const s = await yt.getSearchSuggestions(q);
    res.json(s || []);
  } catch { res.json([]); }
});

app.get('/api/video/:id', async (req, res) => {
  const id = extractVideoId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  try {
    const data = await memo('video:' + id, async () => {
      const streams = await collectStreams(id);

      // fetch related & comments in parallel from WEB client
      const yt = await getYT('WEB');
      const info = await yt.getInfo(id).catch(() => null);

      const related = [];
      if (info?.watch_next_feed) {
        for (const n of info.watch_next_feed) {
          const v = normVideo(n);
          if (v) related.push(v);
        }
      }

      return {
        id,
        title: streams.title,
        author: streams.author,
        authorId: streams.authorId,
        description: streams.description,
        views: streams.views,
        likes: streams.likes,
        duration: streams.duration,
        thumbnail: streams.thumbnail,
        servers: streams.servers,
        hls: streams.hls,
        dash: streams.dash,
        related: related.slice(0, 30),
      };
    });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/channel/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const data = await memo('channel:' + id, async () => {
      const yt = await getYT('WEB');
      const ch = await yt.getChannel(id);

      let videosTab = ch;
      try { videosTab = await ch.getVideos(); } catch {}

      const meta = ch.metadata || {};
      const header = ch.header || {};
      return {
        id,
        name: meta.title || header.author?.name || '',
        description: meta.description || '',
        thumbnail: bestThumb(meta.thumbnail || header.author?.thumbnails || []),
        banner: bestThumb(header.banner || []),
        subscribers: header.subscribers?.text || '',
        videos: (videosTab.videos || []).map(normVideo).filter(Boolean).slice(0, 60),
      };
    });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/playlist/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const data = await memo('playlist:' + id, async () => {
      const yt = await getYT('WEB');
      const pl = await yt.getPlaylist(id);
      return {
        id,
        title: pl.info?.title || '',
        author: pl.info?.author?.name || '',
        thumbnail: bestThumb(pl.info?.thumbnails || []),
        videoCount: pl.info?.total_items || (pl.videos || []).length,
        videos: (pl.videos || []).map(normVideo).filter(Boolean),
      };
    });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ────────────────────────────────────────────────────────────────
   7.  SPA — cosmic UI
   ──────────────────────────────────────────────────────────────── */
const HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Orby ◦ Cosmic YouTube</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/hls.js@1"><\/script>
<script src="https://cdn.jsdelivr.net/npm/dashjs@4/dist/dash.all.min.js"><\/script>
<style>
:root{
  --bg:#03030a; --bg2:#07071a; --ink:#e9ecff; --muted:#8a8fb8;
  --accent:#8b5cf6; --accent2:#22d3ee; --accent3:#f472b6;
  --glass:rgba(255,255,255,.04); --border:rgba(139,92,246,.25);
  --glow:0 0 40px rgba(139,92,246,.35), 0 0 80px rgba(34,211,238,.15);
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{
  font-family:'Inter',system-ui,sans-serif;color:var(--ink);
  background:var(--bg);overflow-x:hidden;line-height:1.55;
}
/* ─── cosmic background ─── */
.cosmos{position:fixed;inset:0;z-index:-2;overflow:hidden;background:
  radial-gradient(ellipse at 20% 10%,rgba(139,92,246,.25),transparent 55%),
  radial-gradient(ellipse at 80% 30%,rgba(34,211,238,.18),transparent 55%),
  radial-gradient(ellipse at 50% 90%,rgba(244,114,182,.18),transparent 60%),
  linear-gradient(180deg,#03030a 0%,#07071a 60%,#02020a 100%);
}
.cosmos::before,.cosmos::after{
  content:"";position:absolute;inset:-50%;
  background-image:
    radial-gradient(1px 1px at 20% 30%,#fff 50%,transparent),
    radial-gradient(1px 1px at 40% 70%,#fff 50%,transparent),
    radial-gradient(2px 2px at 65% 20%,#fff 50%,transparent),
    radial-gradient(1px 1px at 80% 80%,#fff 50%,transparent),
    radial-gradient(1.5px 1.5px at 90% 40%,#fff 50%,transparent),
    radial-gradient(1px 1px at 10% 60%,#fff 50%,transparent),
    radial-gradient(1px 1px at 55% 55%,#fff 50%,transparent),
    radial-gradient(2px 2px at 30% 85%,#fff 50%,transparent);
  background-size:400px 400px;opacity:.55;
  animation:drift 220s linear infinite;
}
.cosmos::after{
  background-size:600px 600px;opacity:.35;
  animation:drift 320s linear infinite reverse;
}
@keyframes drift{to{transform:translate3d(-200px,-300px,0)}}
.nebula{
  position:fixed;width:600px;height:600px;border-radius:50%;
  filter:blur(120px);opacity:.35;pointer-events:none;z-index:-1;
  animation:float 22s ease-in-out infinite;
}
.n1{background:#8b5cf6;top:-200px;left:-200px}
.n2{background:#22d3ee;top:40%;right:-250px;animation-delay:-7s}
.n3{background:#f472b6;bottom:-300px;left:30%;animation-delay:-14s}
@keyframes float{50%{transform:translate(60px,-60px) scale(1.2)}}

/* ─── header ─── */
header{
  position:sticky;top:0;z-index:100;
  padding:16px 32px;display:flex;align-items:center;gap:20px;
  background:rgba(3,3,10,.65);backdrop-filter:blur(20px) saturate(1.4);
  -webkit-backdrop-filter:blur(20px) saturate(1.4);
  border-bottom:1px solid var(--border);
}
.logo{
  font-family:'Orbitron',sans-serif;font-weight:900;font-size:28px;
  letter-spacing:.15em;cursor:pointer;
  background:linear-gradient(135deg,#fff,var(--accent) 40%,var(--accent2) 80%);
  -webkit-background-clip:text;background-clip:text;color:transparent;
  text-shadow:var(--glow);
}
.logo::after{content:"◦";margin-left:6px;color:var(--accent2);
  text-shadow:0 0 20px var(--accent2);animation:pulse 2s infinite}
@keyframes pulse{50%{opacity:.4}}

.search-wrap{flex:1;max-width:720px;position:relative}
.search{
  width:100%;padding:14px 20px 14px 48px;border-radius:999px;
  background:var(--glass);border:1px solid var(--border);
  color:var(--ink);font-size:15px;outline:none;
  transition:.25s;font-family:inherit;
}
.search:focus{border-color:var(--accent);box-shadow:var(--glow)}
.search::placeholder{color:var(--muted)}
.search-icon{position:absolute;left:16px;top:50%;transform:translateY(-50%);
  color:var(--muted);pointer-events:none;font-size:18px}
.suggest{
  position:absolute;top:calc(100% + 8px);left:0;right:0;
  background:rgba(10,10,26,.95);backdrop-filter:blur(20px);
  border:1px solid var(--border);border-radius:16px;
  overflow:hidden;display:none;box-shadow:var(--glow);z-index:200;
}
.suggest.on{display:block}
.suggest-item{
  padding:12px 20px;cursor:pointer;font-size:14px;
  transition:.15s;display:flex;align-items:center;gap:12px;
}
.suggest-item:hover{background:rgba(139,92,246,.2)}
.suggest-item::before{content:"🔍";opacity:.5}

.nav-btn{
  padding:10px 18px;border-radius:999px;background:var(--glass);
  border:1px solid var(--border);color:var(--ink);cursor:pointer;
  font-family:inherit;font-size:13px;font-weight:500;transition:.2s;
}
.nav-btn:hover{background:rgba(139,92,246,.25);border-color:var(--accent);
  transform:translateY(-1px)}

/* ─── layout ─── */
main{padding:32px;min-height:calc(100vh - 80px)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:22px}
.section-title{
  font-family:'Orbitron',sans-serif;font-size:22px;font-weight:700;
  letter-spacing:.08em;margin:0 0 24px;
  background:linear-gradient(90deg,#fff,var(--accent2));
  -webkit-background-clip:text;background-clip:text;color:transparent;
}

/* ─── card ─── */
.card{
  background:var(--glass);border:1px solid var(--border);border-radius:18px;
  overflow:hidden;cursor:pointer;transition:.3s;position:relative;
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
}
.card::before{
  content:"";position:absolute;inset:0;border-radius:18px;padding:1px;
  background:linear-gradient(135deg,transparent 30%,rgba(139,92,246,.4),transparent 70%);
  -webkit-mask:linear-gradient(#000,#000) content-box,linear-gradient(#000,#000);
  -webkit-mask-composite:xor;mask-composite:exclude;
  opacity:0;transition:.3s;pointer-events:none;
}
.card:hover{transform:translateY(-4px);border-color:var(--accent)}
.card:hover::before{opacity:1}
.card:hover .thumb img{transform:scale(1.06)}
.thumb{position:relative;aspect-ratio:16/9;overflow:hidden;background:#000}
.thumb img{width:100%;height:100%;object-fit:cover;transition:.5s}
.duration{
  position:absolute;bottom:8px;right:8px;padding:3px 8px;
  background:rgba(0,0,0,.85);border-radius:6px;font-size:12px;
  font-weight:600;font-variant-numeric:tabular-nums;
}
.card-body{padding:14px 16px}
.card-title{
  font-size:14.5px;font-weight:600;line-height:1.4;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
  overflow:hidden;margin-bottom:8px;
}
.card-meta{font-size:12.5px;color:var(--muted);line-height:1.6}
.card-meta a{color:var(--muted);text-decoration:none}
.card-meta a:hover{color:var(--accent2)}

/* ─── video page ─── */
.video-page{display:grid;grid-template-columns:1fr 380px;gap:28px;max-width:1600px;margin:0 auto}
@media(max-width:1100px){.video-page{grid-template-columns:1fr}}
.player-shell{
  aspect-ratio:16/9;background:#000;border-radius:20px;overflow:hidden;
  border:1px solid var(--border);box-shadow:var(--glow);
}
.player-shell video,.player-shell iframe{width:100%;height:100%;border:0;background:#000}
.video-title{font-size:22px;font-weight:700;margin:20px 0 12px;line-height:1.35}
.video-meta{
  display:flex;flex-wrap:wrap;align-items:center;gap:12px;
  padding:14px 20px;background:var(--glass);border:1px solid var(--border);
  border-radius:16px;margin-bottom:16px;
}
.meta-badge{
  padding:6px 12px;border-radius:999px;background:rgba(139,92,246,.15);
  border:1px solid var(--border);font-size:12.5px;color:var(--ink);
}

.servers{
  background:var(--glass);border:1px solid var(--border);
  border-radius:16px;padding:16px 20px;margin-bottom:16px;
}
.servers h3{
  font-family:'Orbitron',sans-serif;font-size:14px;letter-spacing:.1em;
  margin-bottom:12px;color:var(--accent2);
}
.server-list{display:flex;flex-wrap:wrap;gap:8px;max-height:180px;overflow-y:auto}
.server-btn{
  padding:8px 14px;border-radius:10px;background:rgba(139,92,246,.1);
  border:1px solid var(--border);color:var(--ink);cursor:pointer;
  font-family:inherit;font-size:12.5px;transition:.2s;font-weight:500;
}
.server-btn:hover{background:rgba(139,92,246,.3);border-color:var(--accent)}
.server-btn.active{
  background:linear-gradient(135deg,var(--accent),var(--accent2));
  border-color:transparent;box-shadow:0 4px 20px rgba(139,92,246,.5);
}

.description{
  background:var(--glass);border:1px solid var(--border);
  border-radius:16px;padding:18px 22px;white-space:pre-wrap;
  font-size:14px;color:#c9cef0;max-height:200px;overflow-y:auto;
}
.description a{color:var(--accent2)}

.related-list{display:flex;flex-direction:column;gap:12px}
.related-item{
  display:flex;gap:12px;padding:8px;border-radius:12px;cursor:pointer;
  transition:.2s;border:1px solid transparent;
}
.related-item:hover{background:var(--glass);border-color:var(--border)}
.related-thumb{flex:0 0 168px;aspect-ratio:16/9;border-radius:8px;overflow:hidden;position:relative;background:#000}
.related-thumb img{width:100%;height:100%;object-fit:cover}
.related-body{flex:1;min-width:0}
.related-title{font-size:13.5px;font-weight:600;line-height:1.35;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.related-meta{font-size:12px;color:var(--muted);margin-top:6px}

/* ─── channel ─── */
.ch-banner{aspect-ratio:6/1;border-radius:20px;overflow:hidden;
  background:linear-gradient(135deg,#1a1a3e,#2a1a5e);position:relative;margin-bottom:20px}
.ch-banner img{width:100%;height:100%;object-fit:cover}
.ch-header{display:flex;gap:20px;align-items:center;margin-bottom:28px;padding:0 8px}
.ch-avatar{width:96px;height:96px;border-radius:50%;overflow:hidden;
  border:2px solid var(--accent);box-shadow:var(--glow);flex-shrink:0}
.ch-avatar img{width:100%;height:100%;object-fit:cover}
.ch-name{font-family:'Orbitron',sans-serif;font-size:24px;font-weight:700}
.ch-sub{color:var(--muted);font-size:14px;margin-top:4px}

/* ─── loader ─── */
.loader{display:flex;justify-content:center;padding:80px 0}
.orb{
  width:60px;height:60px;border-radius:50%;position:relative;
  background:radial-gradient(circle at 30% 30%,var(--accent2),var(--accent) 60%,transparent 70%);
  animation:orb 1.5s ease-in-out infinite;
  box-shadow:0 0 60px var(--accent),0 0 120px var(--accent2);
}
@keyframes orb{50%{transform:scale(1.3);filter:hue-rotate(60deg)}}

.err{
  padding:24px;border-radius:14px;background:rgba(244,114,182,.15);
  border:1px solid rgba(244,114,182,.4);color:#ffc9e0;text-align:center;
}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(139,92,246,.3);border-radius:10px}
::-webkit-scrollbar-thumb:hover{background:rgba(139,92,246,.5)}
</style>
</head>
<body>
<div class="cosmos"></div>
<div class="nebula n1"></div>
<div class="nebula n2"></div>
<div class="nebula n3"></div>

<header>
  <div class="logo" onclick="route('/')">ORBY</div>
  <div class="search-wrap">
    <span class="search-icon">🔭</span>
    <input class="search" id="q" placeholder="宇宙のどこかを探す…" autocomplete="off">
    <div class="suggest" id="suggest"></div>
  </div>
  <button class="nav-btn" onclick="route('/')">🏠 ホーム</button>
  <button class="nav-btn" onclick="route('/trending')">🔥 急上昇</button>
</header>

<main id="app">
  <div class="loader"><div class="orb"></div></div>
</main>

<script>
/* ═══════════════════════════════════════════════
   ORBY  Client-side SPA
   ═══════════════════════════════════════════════ */
const app = document.getElementById('app');
const qEl = document.getElementById('q');
const sug = document.getElementById('suggest');

const state = { route:'/', hlsInst:null, dashInst:null };

const h = (s='') => String(s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

const linkify = (t='') => h(t)
  .replace(/(https?:\\/\\/[^\\s<]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>')
  .replace(/(?:^|\\s)(#[\\w一-龠ぁ-んァ-ヶー]+)/g,' <a href="#/search/$1">$1</a>');

function loader(){ app.innerHTML='<div class="loader"><div class="orb"></div></div>' }
function errBox(m){ app.innerHTML='<div class="err">❌ '+h(m)+'</div>' }

async function api(url){
  const r = await fetch(url);
  if(!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
}

/* ── router ── */
function route(hash){
  if(!hash.startsWith('#')) hash='#'+hash;
  if(location.hash===hash) render(); else location.hash=hash;
}
window.addEventListener('hashchange', render);
window.addEventListener('load', render);

function currentPath(){
  return (location.hash||'#/').slice(1) || '/';
}

async function render(){
  // teardown players
  if(state.hlsInst){ state.hlsInst.destroy(); state.hlsInst=null }
  if(state.dashInst){ state.dashInst.reset(); state.dashInst=null }

  const p = currentPath();
  loader();
  try{
    if(p==='/' || p==='') return renderHome();
    let m;
    if((m=p.match(/^\\/search\\/(.+)/))) return renderSearch(decodeURIComponent(m[1]));
    if((m=p.match(/^\\/watch\\/([A-Za-z0-9_-]{11})/))) return renderWatch(m[1]);
    if((m=p.match(/^\\/channel\\/([A-Za-z0-9_-]+)/))) return renderChannel(m[1]);
    if((m=p.match(/^\\/playlist\\/([A-Za-z0-9_-]+)/))) return renderPlaylist(m[1]);
    errBox('未知の座標: '+p);
  }catch(e){ errBox(e.message) }
}

/* ── card renderer ── */
function videoCard(v){
  return \`
  <div class="card" onclick="route('/watch/\${v.id}')">
    <div class="thumb">
      <img loading="lazy" src="\${h(v.thumbnail||'')}" alt="">
      \${v.duration?\`<div class="duration">\${h(v.duration)}</div>\`:''}
    </div>
    <div class="card-body">
      <div class="card-title">\${h(v.title)}</div>
      <div class="card-meta">
        \${v.authorId
          ? \`<a onclick="event.stopPropagation();route('/channel/\${v.authorId}')">\${h(v.author)}</a>\`
          : h(v.author||'')}
        \${v.views?' · '+h(v.views):''}
        \${v.published?' · '+h(v.published):''}
      </div>
    </div>
  </div>\`;
}

/* ── HOME ── */
async function renderHome(){
  const d = await api('/api/home');
  app.innerHTML = \`
    <h2 class="section-title">✦ HOME FEED</h2>
    <div class="grid">\${d.videos.map(videoCard).join('')}</div>\`;
}

/* ── SEARCH ── */
async function renderSearch(q){
  qEl.value = q;
  const d = await api('/api/search?q='+encodeURIComponent(q));
  let html = \`<h2 class="section-title">🔭 "\${h(q)}" の検索結果</h2>\`;
  if(d.channels?.length){
    html += \`<h3 class="section-title" style="font-size:16px;margin-top:20px">チャンネル</h3><div class="grid">\`;
    for(const c of d.channels.slice(0,4)){
      html += \`
      <div class="card" onclick="route('/channel/\${c.id}')">
        <div class="thumb" style="aspect-ratio:1/1"><img src="\${h(c.thumbnail)}"></div>
        <div class="card-body">
          <div class="card-title">\${h(c.name)}</div>
          <div class="card-meta">\${h(c.subscribers||'')}</div>
        </div>
      </div>\`;
    }
    html += '</div>';
  }
  if(d.playlists?.length){
    html += \`<h3 class="section-title" style="font-size:16px;margin-top:28px">プレイリスト</h3><div class="grid">\`;
    for(const p of d.playlists.slice(0,6)){
      html += \`
      <div class="card" onclick="route('/playlist/\${p.id}')">
        <div class="thumb"><img src="\${h(p.thumbnail)}"><div class="duration">▶ \${h(p.videoCount||'')}</div></div>
        <div class="card-body">
          <div class="card-title">\${h(p.title)}</div>
          <div class="card-meta">\${h(p.author||'')}</div>
        </div>
      </div>\`;
    }
    html += '</div>';
  }
  html += \`<h3 class="section-title" style="font-size:16px;margin-top:28px">動画</h3>
    <div class="grid">\${d.videos.map(videoCard).join('')}</div>\`;
  app.innerHTML = html;
}

/* ── WATCH ── */
async function renderWatch(id){
  const d = await api('/api/video/'+id);
  app.innerHTML = \`
    <div class="video-page">
      <div>
        <div class="player-shell" id="player-shell"></div>
        <h1 class="video-title">\${h(d.title||'')}</h1>
        <div class="video-meta">
          \${d.authorId
            ? \`<a class="meta-badge" style="text-decoration:none;cursor:pointer" onclick="route('/channel/\${d.authorId}')">👤 \${h(d.author||'')}</a>\`
            : \`<span class="meta-badge">👤 \${h(d.author||'')}</span>\`}
          <span class="meta-badge">👁 \${h(String(d.views||0))}</span>
          \${d.likes?\`<span class="meta-badge">👍 \${h(String(d.likes))}</span>\`:''}
          <span class="meta-badge">⏱ \${h(formatDur(d.duration))}</span>
        </div>
        <div class="servers">
          <h3>◦ 動画サーバー選択 (\${d.servers.length})</h3>
          <div class="server-list" id="server-list"></div>
        </div>
        <div class="description">\${linkify(d.description||'')}</div>
      </div>
      <aside>
        <h3 class="section-title" style="font-size:16px">🌌 関連動画</h3>
        <div class="related-list">\${d.related.map(relatedItem).join('')}</div>
      </aside>
    </div>\`;

  // build server buttons
  const list = document.getElementById('server-list');
  d.servers.forEach((s,i)=>{
    const b = document.createElement('button');
    b.className = 'server-btn' + (i===0?' active':'');
    b.textContent = s.label;
    b.onclick = () => {
      document.querySelectorAll('.server-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      loadServer(s, d);
    };
    list.appendChild(b);
  });
  if(d.servers.length) loadServer(d.servers[0], d);
}

function relatedItem(v){
  return \`<div class="related-item" onclick="route('/watch/\${v.id}')">
    <div class="related-thumb">
      <img loading="lazy" src="\${h(v.thumbnail||'')}">
      \${v.duration?\`<div class="duration">\${h(v.duration)}</div>\`:''}
    </div>
    <div class="related-body">
      <div class="related-title">\${h(v.title)}</div>
      <div class="related-meta">\${h(v.author||'')}\${v.views?' · '+h(v.views):''}</div>
    </div>
  </div>\`;
}

function formatDur(s){
  s=Number(s)||0;const h_=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;
  return h_?h_+':'+String(m).padStart(2,'0')+':'+String(x).padStart(2,'0'):m+':'+String(x).padStart(2,'0');
}

function loadServer(s, d){
  const shell = document.getElementById('player-shell');
  if(state.hlsInst){ state.hlsInst.destroy(); state.hlsInst=null }
  if(state.dashInst){ state.dashInst.reset(); state.dashInst=null }
  shell.innerHTML = '';

  if(s.kind==='embed'){
    const f=document.createElement('iframe');
    f.src=s.url;f.allow='autoplay;encrypted-media;picture-in-picture';f.allowFullscreen=true;
    shell.appendChild(f);return;
  }
  const v = document.createElement('video');
  v.controls=true;v.autoplay=true;v.playsInline=true;
  v.poster = d.thumbnail || '';
  shell.appendChild(v);

  if(s.kind==='hls'){
    if(window.Hls && Hls.isSupported()){
      state.hlsInst = new Hls();
      state.hlsInst.loadSource(s.url);
      state.hlsInst.attachMedia(v);
    }else{ v.src = s.url }
  }else if(s.kind==='dash'){
    if(window.dashjs){
      state.dashInst = dashjs.MediaPlayer().create();
      state.dashInst.initialize(v, s.url, true);
    }else{ v.src = s.url }
  }else{
    v.src = s.url;
    v.crossOrigin = 'anonymous';
  }
}

/* ── CHANNEL ── */
async function renderChannel(id){
  const d = await api('/api/channel/'+id);
  app.innerHTML = \`
    \${d.banner?\`<div class="ch-banner"><img src="\${h(d.banner)}"></div>\`:''}
    <div class="ch-header">
      <div class="ch-avatar"><img src="\${h(d.thumbnail||'')}"></div>
      <div>
        <div class="ch-name">\${h(d.name||'')}</div>
        <div class="ch-sub">\${h(d.subscribers||'')}</div>
        <div class="ch-sub" style="max-width:600px;margin-top:6px">\${h((d.description||'').slice(0,180))}</div>
      </div>
    </div>
    <h2 class="section-title">✦ 動画</h2>
    <div class="grid">\${d.videos.map(videoCard).join('')}</div>\`;
}

/* ── PLAYLIST ── */
async function renderPlaylist(id){
  const d = await api('/api/playlist/'+id);
  app.innerHTML = \`
    <h2 class="section-title">📜 \${h(d.title||'')}</h2>
    <div class="video-meta" style="margin-bottom:24px">
      <span class="meta-badge">👤 \${h(d.author||'')}</span>
      <span class="meta-badge">🎞 \${h(String(d.videoCount||d.videos.length))} 本</span>
    </div>
    <div class="grid">\${d.videos.map(videoCard).join('')}</div>\`;
}

/* ── search input handlers ── */
let sugTimer;
qEl.addEventListener('input', () => {
  clearTimeout(sugTimer);
  const q = qEl.value.trim();
  if(!q){ sug.classList.remove('on'); return; }
  sugTimer = setTimeout(async () => {
    try{
      const s = await api('/api/suggest?q='+encodeURIComponent(q));
      if(!s.length){ sug.classList.remove('on'); return; }
      sug.innerHTML = s.slice(0,8).map(x =>
        \`<div class="suggest-item" onclick="pickSug('\${x.replace(/'/g,'&#39;')}')">\${h(x)}</div>\`
      ).join('');
      sug.classList.add('on');
    }catch{}
  }, 180);
});
qEl.addEventListener('keydown', (e) => {
  if(e.key==='Enter' && qEl.value.trim()){
    sug.classList.remove('on');
    route('/search/'+encodeURIComponent(qEl.value.trim()));
  }
});
document.addEventListener('click', (e) => {
  if(!sug.contains(e.target) && e.target!==qEl) sug.classList.remove('on');
});
function pickSug(x){ qEl.value = x; sug.classList.remove('on'); route('/search/'+encodeURIComponent(x)); }
</script>
</body>
</html>`;

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(HTML);
});

/* ────────────────────────────────────────────────────────────────
   8.  Startup / export (Vercel & standalone)
   ──────────────────────────────────────────────────────────────── */
if (require.main === module) {
  app.listen(PORT, () => console.log(`◦ Orby is drifting on :${PORT}`));
}
module.exports = app;
