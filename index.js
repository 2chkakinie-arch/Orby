// ============================================================================
// Orby v4 — Autonomous Coding Agent Backend
// - Default: scira-gemini-3.1-flash-lite (best tool-following)
// - File attachment support (server-side storage + read_file tool)
// - Full model catalog via /api/upstream-models
// ============================================================================

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

const NIE_BASE = "https://nie-ai.vercel.app/api";
const DEFAULT_MODEL = "scira-gemini-3.1-flash-lite";

const SHORTCUTS = new Map();      // @alias -> {content, kind}
const UPLOADED_FILES = new Map(); // id -> {name, content, mime}  (agent artifacts)
const ATTACHMENTS = new Map();    // id -> {name, content, mime, size}  (user uploads)

// ============================================================================
// Skills
// ============================================================================
const SKILLS = {
  "UI-SKILL": `# UI/UX Skill
- Dark theme, mostly monochrome + subtle accent (indigo/violet).
- Typography: system fonts, tight tracking on headings.
- 8px grid, 150ms cubic-bezier(.4,0,.2,1) transitions.
- Borders 1px rgba(255,255,255,.08). Rounded 10-14px.
- Focus states visible. CSS grid/flex over positioning tricks.`,

  "CODING-SKILL": `# Coding Skill
- Production-grade. Handle edge cases + errors.
- Modern JS ES2022+ / Python 3.11+ with type hints.
- Self-documenting names. Comment WHY not WHAT.
- Full apps in one go: entry + config + assets.
- After writing, mentally trace + check for bugs.
- Single-file HTML: inline CSS+JS, zero CDN unless required.`,

  "WEB-RESEARCH-SKILL": `# Web Research Skill
- web_search → pick 1-3 authoritative URLs → html_fetch each in parallel.
- Cross-reference 2+ sources. Cite URLs in final answer.
- For time-sensitive queries, include the year in the search.`,

  "PARALLEL-THINK-SKILL": `# Parallel Thinking Skill
- For hard/ambiguous: architecture, algorithm, subjective judgment.
- Consult scira-nemotron-3-super + gpt-4 + deepseek-r1.
- Merge sharpest reasoning, not average.`,

  "IMAGE-SKILL": `# Image Skill
- image_generate returns Pollinations URL. Embed as ![](url).
- Prompts: subject + style + lighting + composition + camera detail.`,

  "GAME-DEV-SKILL": `# Game Dev Skill
- Canvas 2D or DOM. 60fps. rAF + delta-time. Separate state/update/render.
- Input: keyboard + click + touch.
- Board games (Othello/Chess): 2D array, minimax + alpha-beta, positional eval.
- UI: score, restart, difficulty. Zero external deps.`,
};

// ============================================================================
// Upstream helpers
// ============================================================================
async function nieChat({ model, messages, temperature = 0.7 }) {
  const r = await fetch(`${NIE_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature, stream: false }),
  });
  if (!r.ok) throw new Error(`nieChat ${r.status}`);
  return r.json();
}

async function nieChatStream({ model, messages, temperature = 0.7 }, onDelta) {
  const r = await fetch(`${NIE_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature, stream: true }),
  });
  if (!r.ok || !r.body) throw new Error(`nieChatStream ${r.status}`);
  let buf = "", full = "";
  for await (const chunk of r.body) {
    buf += chunk.toString("utf8");
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return full;
      try {
        const j = JSON.parse(data);
        const delta = j.choices?.[0]?.delta?.content || "";
        if (delta) { full += delta; onDelta && onDelta(delta); }
      } catch (_) {}
    }
  }
  return full;
}

// ============================================================================
// Tool: web_search — Bing RSS + Wikipedia fallback
// ============================================================================
function decodeXmlEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'")
    .replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

async function searchBing(query, max_results) {
  const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}&count=${Math.max(max_results, 10)}`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept": "application/rss+xml, application/xml, text/xml, */*",
      "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
    },
  });
  if (!r.ok) throw new Error(`bing rss ${r.status}`);
  const xml = await r.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  const results = [];
  const seen = new Set();
  for (const it of items) {
    if (results.length >= max_results) break;
    const t = it.match(/<title>([\s\S]*?)<\/title>/);
    const l = it.match(/<link>([\s\S]*?)<\/link>/);
    const d = it.match(/<description>([\s\S]*?)<\/description>/);
    if (!t || !l) continue;
    const url = decodeXmlEntities(l[1]).trim();
    if (!/^https?:\/\//.test(url) || seen.has(url)) continue;
    seen.add(url);
    results.push({
      title: decodeXmlEntities(t[1]).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
      url,
      snippet: d ? decodeXmlEntities(d[1]).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "",
    });
  }
  return results;
}

async function searchWikipedia(query, max_results, lang = "en") {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${max_results}&utf8=1`;
  const r = await fetch(url, { headers: { "User-Agent": "Orby/4.0" } });
  const j = await r.json();
  return (j.query?.search || []).map(s => ({
    title: s.title,
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`,
    snippet: s.snippet.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"'),
  }));
}

async function tool_web_search({ query, max_results = 6 }) {
  const errors = [];
  try {
    const bing = await searchBing(query, max_results);
    if (bing.length > 0) return { query, source: "bing", results: bing };
  } catch (e) { errors.push(`bing: ${e.message}`); }
  try {
    const isJa = /[\u3040-\u30ff\u4e00-\u9fff]/.test(query);
    const wiki = await searchWikipedia(query, max_results, isJa ? "ja" : "en");
    if (wiki.length > 0) return { query, source: "wikipedia", results: wiki, note: "Bing empty; using Wikipedia" };
  } catch (e) { errors.push(`wiki: ${e.message}`); }
  return { query, source: "none", results: [], errors };
}

// ============================================================================
// Tool: html_fetch
// ============================================================================
async function tool_html_fetch({ url, mode = "text", max_chars = 12000 }) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,*/*",
      "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
    },
    redirect: "follow",
    timeout: 20000,
  });
  const html = await r.text();
  if (mode === "raw") return { url, status: r.status, html: html.slice(0, 200000) };
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let mainHtml = html;
  const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (article && article[1].length > 500) mainHtml = article[1];
  else if (main && main[1].length > 500) mainHtml = main[1];

  const text = mainHtml
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();

  return {
    url,
    status: r.status,
    title: titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "",
    text: text.slice(0, max_chars),
    length: text.length,
    truncated: text.length > max_chars,
  };
}

// ============================================================================
// Tool: js_exec — VM sandbox
// ============================================================================
async function tool_js_exec({ code, timeout_ms = 5000 }) {
  const logs = [];
  const sandbox = {
    console: {
      log:   (...a) => logs.push(a.map(x => typeof x === "object" ? JSON.stringify(x) : String(x)).join(" ")),
      error: (...a) => logs.push("[err] " + a.map(String).join(" ")),
      warn:  (...a) => logs.push("[warn] " + a.map(String).join(" ")),
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Math, JSON, Date, Array, Object, String, Number, Boolean,
    Map, Set, Promise, RegExp, Error, Symbol, Proxy, Reflect,
    Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array,
    Float32Array, Float64Array, ArrayBuffer,
  };
  const ctx = vm.createContext(sandbox);
  try {
    const wrapped = `(async()=>{${code}\n})().then(v=>{globalThis.__result=v;globalThis.__done=true}).catch(e=>{globalThis.__error=e&&e.stack?e.stack:String(e);globalThis.__done=true});`;
    new vm.Script(wrapped, { timeout: timeout_ms }).runInContext(ctx, { timeout: timeout_ms });
    const deadline = Date.now() + Math.min(timeout_ms, 8000);
    while (!ctx.__done && Date.now() < deadline) await new Promise(r => setTimeout(r, 30));
    if (!ctx.__done) return { ok: false, error: "timeout", logs };
    return {
      ok: !ctx.__error,
      result: ctx.__result === undefined ? null : (typeof ctx.__result === "string" ? ctx.__result : JSON.stringify(ctx.__result, null, 2)),
      logs,
      error: ctx.__error || null,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e), logs };
  }
}

// ============================================================================
// Tool: load_skill
// ============================================================================
async function tool_load_skill({ name }) {
  const key = String(name || "").replace(/\.md$/i, "").toUpperCase();
  const content = SKILLS[key];
  if (!content) return { ok: false, error: `Unknown skill: ${name}`, available: Object.keys(SKILLS) };
  return { ok: true, name: key, content };
}

// ============================================================================
// Tool: parallel_think
// ============================================================================
async function tool_parallel_think({ prompt, models }) {
  const list = (models && models.length) ? models : ["scira-nemotron-3-super", "gpt-4", "deepseek-r1"];
  const settled = await Promise.allSettled(
    list.map(m =>
      nieChat({
        model: m,
        messages: [
          { role: "system", content: "Answer concisely and expertly. Focus on insight, not fluff. 200 words max." },
          { role: "user", content: prompt },
        ],
      })
    )
  );
  return {
    prompt,
    answers: settled.map((s, i) => ({
      model: list[i],
      ok: s.status === "fulfilled",
      content: s.status === "fulfilled"
        ? (s.value?.content || s.value?.choices?.[0]?.message?.content || "")
        : String(s.reason).slice(0, 200),
    })),
  };
}

// ============================================================================
// Tool: image_generate
// ============================================================================
async function tool_image_generate({ prompt, width = 1024, height = 1024, model = "flux", seed }) {
  const params = new URLSearchParams({ width: String(width), height: String(height), model, nologo: "true" });
  if (seed) params.set("seed", String(seed));
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`;
  return { url, prompt, width, height, model };
}

// ============================================================================
// Tool: file_upload (agent → user artifact)
// ============================================================================
function guessMime(filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  return ({
    html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
    js: "text/javascript; charset=utf-8", ts: "text/typescript; charset=utf-8",
    css: "text/css; charset=utf-8", json: "application/json; charset=utf-8",
    md: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8",
    py: "text/x-python; charset=utf-8", svg: "image/svg+xml",
    xml: "application/xml", csv: "text/csv; charset=utf-8",
  })[ext] || "text/plain; charset=utf-8";
}

async function tool_file_upload({ filename, content, mime }) {
  const id = crypto.randomBytes(8).toString("hex");
  const m = mime || guessMime(filename);
  UPLOADED_FILES.set(id, { name: filename, content, mime: m });
  return {
    id, filename, mime: m,
    size: Buffer.byteLength(content, "utf8"),
    lines: (content.match(/\n/g) || []).length + 1,
    language: (filename || "").split(".").pop() || "text",
    download_url: `/api/files/${id}`,
    preview_url: `/api/files/${id}?inline=1`,
  };
}

// ============================================================================
// Tool: read_file — read a user-attached file
// ============================================================================
async function tool_read_file({ attachment_id, max_chars = 30000, start = 0 }) {
  const f = ATTACHMENTS.get(attachment_id);
  if (!f) return { ok: false, error: `Unknown attachment: ${attachment_id}` };
  const s = Math.max(0, Number(start) || 0);
  const slice = f.content.slice(s, s + max_chars);
  return {
    ok: true,
    id: attachment_id,
    filename: f.name,
    mime: f.mime,
    size: f.size,
    total_chars: f.content.length,
    start: s,
    returned_chars: slice.length,
    truncated: f.content.length > s + max_chars,
    content: slice,
  };
}

// ============================================================================
// Tool: shorten_element
// ============================================================================
async function tool_shorten_element({ name, content, kind = "text" }) {
  const id = "@" + (name || "el_" + crypto.randomBytes(3).toString("hex")).replace(/[^\w-]/g, "");
  SHORTCUTS.set(id, { name: id, content, kind });
  return { id, name: id, kind, length: content.length, preview: content.slice(0, 120) };
}
function expandShortcuts(text) {
  if (!text || typeof text !== "string") return text;
  return text.replace(/@[\w-]+/g, m => SHORTCUTS.has(m) ? SHORTCUTS.get(m).content : m);
}

// ============================================================================
// Tool registry
// ============================================================================
const TOOLS = {
  web_search:      { desc: "Bing RSS 経由の Web 検索。フォールバック: Wikipedia。", run: tool_web_search },
  html_fetch:      { desc: "URL の本文を取得。article/main 要素を優先抽出。", run: tool_html_fetch },
  js_exec:         { desc: "サンドボックスで JS を実行。async 対応。", run: tool_js_exec },
  load_skill:      { desc: "内蔵スキル読み込み: UI-SKILL / CODING-SKILL / WEB-RESEARCH-SKILL / PARALLEL-THINK-SKILL / IMAGE-SKILL / GAME-DEV-SKILL", run: tool_load_skill },
  parallel_think:  { desc: "複数モデル (scira-nemotron-3-super, gpt-4, deepseek-r1 等) と並列思考。", run: tool_parallel_think },
  image_generate:  { desc: "Pollinations で画像 URL を生成。", run: tool_image_generate },
  file_upload:     { desc: "生成物 (HTML/JS/コード) をダウンロード可能なファイルとして提供。", run: tool_file_upload },
  read_file:       { desc: "ユーザーがアップロードした添付ファイルを読み込む (id 指定)。", run: tool_read_file },
  shorten_element: { desc: "巨大テキストを @alias に短縮。", run: tool_shorten_element },
};

// ============================================================================
// System prompt
// ============================================================================
function buildSystemPrompt(mainModel, attachments) {
  const attachSection = attachments && attachments.length > 0
    ? `\n\n════════════════════════════════════════════════════════════════
📎 ユーザーが添付したファイル (${attachments.length} 件)
════════════════════════════════════════════════════════════════

${attachments.map(a => `- id: **${a.id}** — "${a.name}" (${a.mime}, ${a.size} bytes)`).join("\n")}

ファイル内容を読むには **read_file** ツールを使用:
\`\`\`tool
{"tool":"read_file","args":{"attachment_id":"<id>"}}
\`\`\`
ユーザーの質問がファイルに関連する場合、必ず最初に read_file で内容を確認してください。`
    : "";

  return `あなたは "Orby" — Genspark 級の超規模コーディング特化型・自律エージェント。メインモデル: ${mainModel}。

════════════════════════════════════════════════════════════════
🎯 あなたの本質
════════════════════════════════════════════════════════════════

あなたは **積極的** かつ **徹底的**。ユーザーは最高品質を求め、あなたは応えるまで諦めません。

- **怠けるな**: 情報が浅ければ深掘り。検索したら興味深いURLは必ず html_fetch。
- **並列で考えろ**: 難問なら parallel_think で複数モデル相談。
- **サンドボックスで確かめろ**: コード動作が不安なら js_exec で試す。
- **完璧まで再試行**: 失敗したら別角度から再アプローチ。

════════════════════════════════════════════════════════════════
🔧 ツール呼び出しプロトコル
════════════════════════════════════════════════════════════════

\`\`\`tool
{"tool":"<name>","args":{...}}
\`\`\`

- 1ブロック = 1ツール。複数並列は複数ブロックを並べる。
- JSON は1行推奨。文字列内改行は \\n でエスケープ。
- ツール名: web_search / html_fetch / js_exec / load_skill / parallel_think / image_generate / file_upload / read_file / shorten_element
- ツールブロックのみの応答は「作業継続中」。最終回答は次ラウンド以降。

════════════════════════════════════════════════════════════════
🚀 自律連鎖パターン
════════════════════════════════════════════════════════════════

【A: 深掘り Web リサーチ】
1: web_search
2: html_fetch × 複数（並列）
3: 引用つき日本語回答

【B: 並列思考 → 実装】
1: parallel_think
2: load_skill (必要なら)
3: file_upload
4: 完成報告

【C: コード生成】
1: load_skill("CODING-SKILL"/"GAME-DEV-SKILL"/"UI-SKILL")
2: file_upload
3: 機能説明 + [filename](/api/files/xxx) リンク

【D: ファイル解析】
1: read_file (attachment_id)
2: (必要なら js_exec で解析コード実行)
3: 分析結果を日本語で

════════════════════════════════════════════════════════════════
⚡ 積極性ルール
════════════════════════════════════════════════════════════════

- 「調べて」→ web_search → 興味深い結果は必ず html_fetch まで連鎖
- 「比較」「選定」「意見」→ parallel_think
- 「作って」「実装」「書いて」→ load_skill → file_upload
- 「計算」「実行」→ js_exec
- 「画像」→ image_generate
- 添付ファイルがある → まず read_file

**禁止**:
- スニペットだけで満足して html_fetch を怠る
- 難問を単一モデル独断で答える
- load_skill の内容をユーザーに露出させる
- 大きなコードをチャットに貼り付ける (必ず file_upload)

════════════════════════════════════════════════════════════════
✨ 最終回答スタイル
════════════════════════════════════════════════════════════════

- 前置き不要、実質から入る。ミニマル・洗練。
- ダウンロードリンクは [filename](/api/files/xxx) 形式。
- Web リサーチはソース URL を必ず引用。
- コードは file_upload、チャットには短い抜粋のみ。${attachSection}`;
}

// ============================================================================
// SSE
// ============================================================================
function sseSend(res, event, data) {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (_) {}
}

function parseToolCalls(text) {
  const calls = [];
  const re = /```tool\s*\n?([\s\S]*?)\n?```/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[1].trim();
    if (!raw) continue;
    let parsed = null;
    try { parsed = JSON.parse(raw); }
    catch {
      const jm = raw.match(/\{[\s\S]*\}/);
      if (jm) { try { parsed = JSON.parse(jm[0]); } catch {} }
    }
    if (parsed && parsed.tool && TOOLS[parsed.tool]) {
      calls.push({ tool: parsed.tool, args: parsed.args || {} });
    }
  }
  return calls;
}

function stripToolBlocks(text) {
  return text.replace(/```tool\s*[\s\S]*?```/g, "").trim();
}

// ============================================================================
// /api/upload — user file attachment
// ============================================================================
app.post("/api/upload", (req, res) => {
  const { filename, content, mime } = req.body || {};
  if (!filename || content == null) return res.status(400).json({ error: "filename and content required" });
  const id = crypto.randomBytes(8).toString("hex");
  const m = mime || guessMime(filename);
  ATTACHMENTS.set(id, {
    name: filename, content: String(content), mime: m,
    size: Buffer.byteLength(String(content), "utf8"),
  });
  res.json({
    id, filename, mime: m,
    size: Buffer.byteLength(String(content), "utf8"),
    lines: (String(content).match(/\n/g) || []).length + 1,
  });
});

app.delete("/api/upload/:id", (req, res) => {
  ATTACHMENTS.delete(req.params.id);
  res.json({ ok: true });
});

// ============================================================================
// /api/agent
// ============================================================================
app.post("/api/agent", async (req, res) => {
  const { messages = [], model = DEFAULT_MODEL, max_rounds = 10, attachments = [] } = req.body || {};

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders && res.flushHeaders();

  const isClosed = () => res.writableEnded || res.destroyed;

  // Resolve attachment metadata
  const attachMeta = attachments
    .map(id => ATTACHMENTS.get(id) ? { id, name: ATTACHMENTS.get(id).name, mime: ATTACHMENTS.get(id).mime, size: ATTACHMENTS.get(id).size } : null)
    .filter(Boolean);

  const sysText = buildSystemPrompt(model, attachMeta);
  const sys = { role: "system", content: sysText };

  const userMsgs = messages.map(m => ({
    ...m,
    content: typeof m.content === "string" ? expandShortcuts(m.content) : m.content,
  }));

  if (userMsgs.length > 0 && userMsgs[0].role === "user") {
    const originalFirst = userMsgs[0].content;
    userMsgs[0] = {
      role: "user",
      content:
`[システム指示]
${sysText}
[/システム指示]

─── ユーザーメッセージ ───
${originalFirst}
─── ここまで ───

[Orby として応答。ツール実行が必要なら \`\`\`tool\`\`\` ブロックで呼び出す。積極的に自律連鎖してください。]`
    };
  }

  const convo = [sys, ...userMsgs];
  let finalEmitted = false;

  try {
    for (let round = 1; round <= max_rounds; round++) {
      if (isClosed()) break;
      sseSend(res, "round", { round });

      let assistantText = "";
      sseSend(res, "assistant_start", { round });

      let streamedText = "";
      try {
        streamedText = await nieChatStream(
          { model, messages: convo, temperature: 0.6 },
          (delta) => { sseSend(res, "assistant_delta", { text: delta }); }
        );
      } catch (_) {}

      const knownToolNames = new Set(Object.keys(TOOLS));
      const toolNameMatches = [...streamedText.matchAll(/```tool\s*\n?\s*\{\s*"tool"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
      const hasInvalidToolName = toolNameMatches.length > 0 && toolNameMatches.every(n => !knownToolNames.has(n));
      const looksTruncated =
        !streamedText ||
        !streamedText.trim() ||
        (streamedText.match(/```tool/g) || []).length > (streamedText.match(/```tool[\s\S]*?```/g) || []).length ||
        streamedText.trim().endsWith('{"tool":"skill') ||
        hasInvalidToolName;

      if (looksTruncated) {
        const escalationChain = hasInvalidToolName
          ? ["felo-chat", "gpt-4o", "scira-nemotron-3-super", "gpt-4"]
          : [model, "felo-chat", "scira-nemotron-3-super"];

        let replaced = false;
        for (const alt of escalationChain) {
          try {
            const j = await nieChat({ model: alt, messages: convo, temperature: 0.6 });
            const full = j.content || j.choices?.[0]?.message?.content || "";
            if (full && full.trim()) {
              const altNames = [...full.matchAll(/```tool\s*\n?\s*\{\s*"tool"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
              const altInvalid = altNames.length > 0 && altNames.every(n => !knownToolNames.has(n));
              if (altInvalid) continue;
              sseSend(res, "assistant_reset", {});
              sseSend(res, "assistant_delta", { text: full });
              assistantText = full;
              replaced = true;
              break;
            }
          } catch (_) {}
        }
        if (!replaced) assistantText = streamedText;
      } else {
        assistantText = streamedText;
      }

      sseSend(res, "assistant_end", { round });

      const calls = parseToolCalls(assistantText);
      convo.push({ role: "assistant", content: assistantText || " " });

      if (calls.length === 0) {
        sseSend(res, "final", { text: stripToolBlocks(assistantText) });
        finalEmitted = true;
        break;
      }

      sseSend(res, "tools_start", { count: calls.length });

      const results = await Promise.all(calls.map(async (c) => {
        const t0 = Date.now();
        const callId = crypto.randomBytes(4).toString("hex");
        sseSend(res, "tool_call", { id: callId, tool: c.tool, args: c.args });
        try {
          const out = await TOOLS[c.tool].run(c.args || {});
          const dt = Date.now() - t0;
          sseSend(res, "tool_result", { id: callId, tool: c.tool, args: c.args, result: out, elapsed_ms: dt });
          return { tool: c.tool, args: c.args, result: out };
        } catch (e) {
          const dt = Date.now() - t0;
          const err = { error: String(e.message || e) };
          sseSend(res, "tool_result", { id: callId, tool: c.tool, args: c.args, result: err, elapsed_ms: dt });
          return { tool: c.tool, args: c.args, result: err };
        }
      }));

      const feedback = results.map(r => {
        let resStr;
        try { resStr = JSON.stringify(r.result, null, 2); }
        catch { resStr = String(r.result); }
        if (resStr.length > 6000) resStr = resStr.slice(0, 6000) + "\n... (truncated)";
        return "```tool_result\ntool: " + r.tool + "\nargs: " + JSON.stringify(r.args) + "\nresult:\n" + resStr + "\n```";
      }).join("\n\n");

      const used = new Set(results.map(r => r.tool));
      let nudge = "";
      if (used.has("web_search") && !used.has("html_fetch")) {
        const sr = results.find(r => r.tool === "web_search")?.result;
        const urls = (sr?.results || []).slice(0, 3).map(r => r.url);
        nudge = `

[自律連鎖] 検索結果を受け取りました。ユーザーの質問に**深く**答えるため、次のラウンドで**必ず**上位1-3件のURLを html_fetch で並列取得してください。同ラウンド内で複数の \`\`\`tool\`\`\` ブロックを並べれば並列実行されます。

推奨URL候補:
${urls.map((u, i) => `${i+1}. ${u}`).join("\n")}

スニペットで既に十分と判断できる場合のみ html_fetch をスキップして最終回答へ。基本は本文取得まで連鎖。`;
      } else if (used.has("load_skill") && !used.has("file_upload")) {
        nudge = `

[重要] load_skill は内部ガイドです。ユーザーに露出させないでください。
このラウンドで、スキルを踏まえて実際のタスク(コード生成など)を実行し、完成物を file_upload でアップロードしてください。`;
      } else {
        nudge = `

[次のアクション] ツール結果を見てタスクが完了したか判断:
- 未完了 → 次のツールを呼び出して継続
- 完了 → \`\`\`tool\`\`\` ブロックなしで日本語の最終回答を出す。`;
      }

      convo.push({ role: "user", content: feedback + nudge });

      if (round === max_rounds && !finalEmitted) {
        sseSend(res, "round", { round: round + 1, forced: true });
        try {
          convo.push({ role: "user", content: "[最大ラウンド到達。これ以上ツール呼び出しはせず、最終回答を日本語で出してください。]" });
          const j = await nieChat({ model, messages: convo, temperature: 0.4 });
          const finalText = stripToolBlocks(j.content || j.choices?.[0]?.message?.content || "");
          sseSend(res, "assistant_start", { round: round + 1 });
          sseSend(res, "assistant_delta", { text: finalText });
          sseSend(res, "assistant_end", { round: round + 1 });
          sseSend(res, "final", { text: finalText });
          finalEmitted = true;
        } catch (_) {
          sseSend(res, "final", { text: "（最大ラウンド到達）" });
        }
      }
    }
  } catch (e) {
    sseSend(res, "error", { message: String(e.message || e) });
  } finally {
    if (!finalEmitted) sseSend(res, "final", { text: "" });
    sseSend(res, "done", {});
    res.end();
  }
});

// ============================================================================
// Other endpoints
// ============================================================================
app.get("/api/upstream-models", async (_req, res) => {
  try {
    const r = await fetch(`${NIE_BASE}/models`);
    const j = await r.json();
    // Dedupe by id
    const seen = new Set();
    const models = [];
    for (const m of (j.data || [])) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      models.push({ id: m.id, provider: m.provider || m.owned_by, description: m.description });
    }
    res.json({ models });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e), models: [] });
  }
});

app.get("/api/files/:id", (req, res) => {
  const f = UPLOADED_FILES.get(req.params.id);
  if (!f) return res.status(404).send("not found");
  res.setHeader("Content-Type", f.mime);
  res.setHeader("Content-Disposition", `${req.query.inline ? "inline" : "attachment"}; filename="${f.name}"`);
  res.send(f.content);
});

app.get("/api/files/:id/raw", (req, res) => {
  const f = UPLOADED_FILES.get(req.params.id);
  if (!f) return res.status(404).json({ error: "not found" });
  res.json({ id: req.params.id, filename: f.name, content: f.content, mime: f.mime });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "orby", version: "4.0.0", default_model: DEFAULT_MODEL, tools: Object.keys(TOOLS), skills: Object.keys(SKILLS) });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Orby v4 running on http://localhost:${PORT}`));
}

module.exports = app;
