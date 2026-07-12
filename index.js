// ============================================================================
// Orby v3 — Autonomous Coding Agent Backend
// - Default model: scira-default
// - Aggressive autonomy: chained web_search → html_fetch, parallel_think usage
// - Compact tool cards (no raw JSON exposure in chat)
// - Bing RSS search (reliable) + Wikipedia fallback
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

const SHORTCUTS = new Map();
const UPLOADED_FILES = new Map();

// ============================================================================
// Skills
// ============================================================================
const SKILLS = {
  "UI-SKILL": `# UI/UX Skill
- Dark theme, monochrome (black/white/gray). One accent color max.
- Typography: system fonts, tight tracking on headings, generous line-height.
- 8px grid. 150ms cubic-bezier(.4,0,.2,1) transitions.
- Borders 1px rgba(255,255,255,.08). Rounded 10-14px.
- Visible focus states. CSS grid/flex over positioning tricks.
- Micro-interactions on hover/active. Never cramped.`,

  "CODING-SKILL": `# Coding Skill
- Production-grade. Handle edge cases + errors.
- Modern JS ES2022+ / Python 3.11+ with type hints.
- Self-documenting names. Comment WHY not WHAT.
- Full apps in one go: entry + config + assets.
- After writing, mentally trace + check for bugs.
- Use js_exec to verify small pieces when unsure.
- Single-file HTML: inline CSS+JS, zero CDN unless required.`,

  "WEB-RESEARCH-SKILL": `# Web Research Skill
- web_search → pick 1-3 authoritative URLs → html_fetch each in the SAME round (parallel).
- Cross-reference 2+ sources. Cite URLs in final answer.
- If snippets are enough for the question, skip html_fetch.
- For time-sensitive queries, include the year in the search.`,

  "PARALLEL-THINK-SKILL": `# Parallel Thinking Skill
- For hard/ambiguous problems: architecture, algorithm choice, subjective judgment.
- Use parallel_think to consult scira-nemotron-3-super + gpt-4 + deepseek-r1.
- Merge strongest points. Don't blindly average — pick the sharpest reasoning.`,

  "IMAGE-SKILL": `# Image Skill
- image_generate returns a Pollinations URL. Embed as markdown ![](url).
- Good prompts: subject + style + lighting + composition + camera detail.`,

  "GAME-DEV-SKILL": `# Game Dev Skill (Single-File HTML)
- Canvas 2D or DOM. 60fps target. requestAnimationFrame + delta-time.
- Separate state / update / render clearly.
- Input: keyboard + click + touch.
- Board games (Othello/Chess): 2D array board, move validator, minimax + alpha-beta, evaluation (material + positional + mobility).
- UI: score, restart, difficulty toggle.
- Zero external dependencies. Fully offline.`,
};

// ============================================================================
// Upstream (nie-ai) helpers
// ============================================================================
async function nieChat({ model, messages, temperature = 0.7 }) {
  const r = await fetch(`${NIE_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature, stream: false }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`nieChat ${r.status}: ${text.slice(0, 200)}`);
  }
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
// Tool: web_search — Bing RSS (reliable) + Wikipedia fallback
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
  const r = await fetch(url, { headers: { "User-Agent": "Orby/3.0" } });
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
    errors.push("bing: 0 results");
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
  // Try to extract main content: article, main, or largest body block
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
      log: (...a) => logs.push(a.map(x => typeof x === "object" ? JSON.stringify(x) : String(x)).join(" ")),
      error: (...a) => logs.push("[err] " + a.map(String).join(" ")),
      warn: (...a) => logs.push("[warn] " + a.map(String).join(" ")),
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
// Tool: parallel_think — multi-model consultation
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
  const answers = settled.map((s, i) => ({
    model: list[i],
    ok: s.status === "fulfilled",
    content: s.status === "fulfilled"
      ? (s.value?.content || s.value?.choices?.[0]?.message?.content || "")
      : String(s.reason).slice(0, 200),
  }));
  return { prompt, answers };
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
// Tool: file_upload — produces a downloadable artifact
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
    id, filename,
    mime: m,
    size: Buffer.byteLength(content, "utf8"),
    lines: (content.match(/\n/g) || []).length + 1,
    language: (filename || "").split(".").pop() || "text",
    download_url: `/api/files/${id}`,
    preview_url: `/api/files/${id}?inline=1`,
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
  html_fetch:      { desc: "URL の本文を取得（CORS 制限なし・article/main 抽出）。", run: tool_html_fetch },
  js_exec:         { desc: "サンドボックスで JS を実行。async/await 対応、console.log と戻り値を返す。", run: tool_js_exec },
  load_skill:      { desc: "内蔵スキルを読み込む: UI-SKILL / CODING-SKILL / WEB-RESEARCH-SKILL / PARALLEL-THINK-SKILL / IMAGE-SKILL / GAME-DEV-SKILL", run: tool_load_skill },
  parallel_think:  { desc: "複数モデル (scira-nemotron-3-super, gpt-4, deepseek-r1 等) と並列思考して意見集約。", run: tool_parallel_think },
  image_generate:  { desc: "Pollinations で画像 URL を生成。", run: tool_image_generate },
  file_upload:     { desc: "生成物 (HTML/JS/コード) をダウンロード可能なファイルとして提供。", run: tool_file_upload },
  shorten_element: { desc: "巨大テキスト/コードを @alias に短縮。以降のプロンプトで参照可能。", run: tool_shorten_element },
};

// ============================================================================
// System prompt — designed to make the agent aggressive and thorough
// ============================================================================
function buildSystemPrompt(mainModel) {
  return `あなたは "Orby" — Genspark 級の超規模コーディング特化型・自律エージェント。メインモデル: ${mainModel}。

════════════════════════════════════════════════════════════════
🎯 あなたの本質
════════════════════════════════════════════════════════════════

あなたは **積極的** かつ **徹底的** です。ユーザーは最高品質の結果を求めており、あなたはそれに応えるまで諦めません。

- **怠けるな**: 情報が浅ければ深掘りする。検索したら興味深いURLは必ず html_fetch する。
- **並列で考えろ**: 難問なら parallel_think で複数モデルに相談してから答える。
- **サンドボックスで確かめろ**: コードの動作が不安なら js_exec で試す。
- **完璧まで再試行**: ツールが失敗したら別の角度から再アプローチ。

════════════════════════════════════════════════════════════════
🔧 ツール呼び出しプロトコル（絶対厳守）
════════════════════════════════════════════════════════════════

ツールを使うときは以下の JSON ブロックのみを使用:

\`\`\`tool
{"tool":"<name>","args":{...}}
\`\`\`

**重要なルール**:

1. **1ブロック = 1ツール**。同じラウンドで複数ツールを並列実行したい場合は複数ブロックを並べる（推奨）。
2. **JSON は1行推奨**。改行するときは文字列内は \\n でエスケープ。コメント・末尾カンマ禁止。
3. **知っていることでも実行可能タスクなら必ずツールで確認/実行せよ**（推測で答えない）。
4. **ツールブロックだけの応答は「作業継続中」を意味する**。最終回答は次のラウンド以降で。
5. ツール名: web_search / html_fetch / js_exec / load_skill / parallel_think / image_generate / file_upload / shorten_element

════════════════════════════════════════════════════════════════
🚀 自律連鎖パターン（このパターンを積極的に使え）
════════════════════════════════════════════════════════════════

【パターンA: 深掘り Web リサーチ】
ラウンド1: web_search でトピック検索
  ↓ 結果を見て、興味深い/権威ある URL を 1-3 個ピック
ラウンド2: **同時に** html_fetch × 複数（並列ブロック）で本文を取得
  ↓ 各ページの本文を統合
ラウンド3: ソースを引用しつつ日本語で回答

【パターンB: 並列思考 → 実装】
ラウンド1: parallel_think でアーキテクチャ選定を複数モデルに相談
  ↓ 各モデルの意見を統合
ラウンド2: (必要に応じ) load_skill で該当スキル読み込み
ラウンド3: file_upload で完成コードをアップロード
ラウンド4: 日本語で完成報告 + リンク提示

【パターンC: コード生成タスク】
ラウンド1: load_skill("CODING-SKILL") or "GAME-DEV-SKILL" or "UI-SKILL"
ラウンド2: file_upload で完成物をアップロード（コード全体を content に埋め込む）
ラウンド3: 日本語で機能説明 + [filename](/api/files/xxx) リンク

════════════════════════════════════════════════════════════════
📋 具体例
════════════════════════════════════════════════════════════════

**例1**: 「今週のAIニュースを調べて」
ラウンド1:
\`\`\`tool
{"tool":"web_search","args":{"query":"AI news 2026 July","max_results":5}}
\`\`\`

ラウンド2 (検索結果を見て興味深い URL を並列取得):
\`\`\`tool
{"tool":"html_fetch","args":{"url":"https://techcrunch.com/..."}}
\`\`\`
\`\`\`tool
{"tool":"html_fetch","args":{"url":"https://arstechnica.com/..."}}
\`\`\`

ラウンド3: 各ソースを統合して日本語で要約 + URL 引用

**例2**: 「Rust vs Go どちらが速い？」
ラウンド1:
\`\`\`tool
{"tool":"parallel_think","args":{"prompt":"Rust と Go の速度比較。ベンチマーク傾向、ユースケース別優劣、メモリモデルの違い","models":["scira-nemotron-3-super","gpt-4","deepseek-r1"]}}
\`\`\`

ラウンド2: 3モデルの意見を統合した日本語回答

**例3**: 「index.html でAIオセロ作って」
ラウンド1:
\`\`\`tool
{"tool":"load_skill","args":{"name":"GAME-DEV-SKILL"}}
\`\`\`

ラウンド2:
\`\`\`tool
{"tool":"file_upload","args":{"filename":"othello.html","content":"<!DOCTYPE html>...（完全なHTML/CSS/JS、ミニマックスAI搭載）..."}}
\`\`\`

ラウンド3: 「オセロを作りました。[othello.html](/api/files/xxx) からダウンロードして開いてください。α-β 枝刈り付きミニマックス AI 搭載で、Easy/Normal/Hard 選択可能です。」

════════════════════════════════════════════════════════════════
⚡ 積極性ルール（重要）
════════════════════════════════════════════════════════════════

- 「調べて」「知りたい」→ 必ず web_search、興味深い結果は必ず html_fetch まで連鎖
- 「比較」「選定」「アーキテクチャ」「意見」→ 必ず parallel_think
- 「作って」「実装して」「書いて」→ 必ず load_skill → file_upload
- 「計算して」「実行して」「確かめて」→ 必ず js_exec
- 「画像」「絵」「イラスト」→ 必ず image_generate

**絶対禁止**:
- 検索スニペットだけで満足して html_fetch を怠ること
- 難問を単一モデルの独断で答えること（parallel_think を使え）
- ツール結果をユーザーへの返答に生JSONで貼り付けること（file_upload や自然な要約を使え）
- load_skill の内容をユーザーに見せること（内部ガイド、隠せ）

════════════════════════════════════════════════════════════════
✨ 最終回答スタイル
════════════════════════════════════════════════════════════════

- ツール使用が全て終わったら \`\`\`tool\`\`\` ブロックを含まない最終回答を日本語で出す。それが完了合図。
- 前置き不要、実質から入る。ミニマルで洗練された文体。
- ダウンロードリンクは [filename](/api/files/xxx) 形式で明示。
- Web リサーチの結論は必ずソース URL を引用。
- コードは file_upload を使い、チャット内には短い抜粋のみ表示。`;
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
// Agent endpoint
// ============================================================================
app.post("/api/agent", async (req, res) => {
  const { messages = [], model = "scira-default", max_rounds = 10 } = req.body || {};

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders && res.flushHeaders();

  const isClosed = () => res.writableEnded || res.destroyed;

  const sysText = buildSystemPrompt(model);
  const sys = { role: "system", content: sysText };

  const userMsgs = messages.map(m => ({
    ...m,
    content: typeof m.content === "string" ? expandShortcuts(m.content) : m.content,
  }));

  // Inject system rules also into first user message (models like felo-chat ignore system role)
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

[Orby として応答してください。タスクにツール実行が必要なら必ず \`\`\`tool\`\`\` ブロックで呼び出してください。「ツールを持っていない」とは絶対に言わないでください。積極的に自律連鎖してください。]`
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

      // Try streaming first. If it stops mid-tool-block (common with scira anti-tool hints),
      // detect the incomplete state and retry with non-stream.
      let streamedText = "";
      try {
        streamedText = await nieChatStream(
          { model, messages: convo, temperature: 0.6 },
          (delta) => { sseSend(res, "assistant_delta", { text: delta }); }
        );
      } catch (_) {}

      // Detect problems:
      //  1. Empty response
      //  2. Truncated inside an unclosed ```tool block
      //  3. Contains ```tool block but uses INVALID tool names (like scira's built-in "skill", "deep-research")
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
        // scira-default often emits its INTERNAL tool names (skill/deep-research/extreme-search).
        // Escalate to a model that follows our custom protocol (felo-chat works best).
        const escalationChain = hasInvalidToolName
          ? ["felo-chat", "gpt-4o", "scira-nemotron-3-super"]
          : [model, "felo-chat", "scira-nemotron-3-super"];

        let replaced = false;
        for (const alt of escalationChain) {
          try {
            const j = await nieChat({ model: alt, messages: convo, temperature: 0.6 });
            const full = j.content || j.choices?.[0]?.message?.content || "";
            if (full && full.trim()) {
              // Check the replacement also isn't garbage
              const altNames = [...full.matchAll(/```tool\s*\n?\s*\{\s*"tool"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
              const altInvalid = altNames.length > 0 && altNames.every(n => !knownToolNames.has(n));
              if (altInvalid) continue;
              // Replace the garbage stream visually
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

      // Truncate for context
      const feedback = results.map(r => {
        let resStr;
        try { resStr = JSON.stringify(r.result, null, 2); }
        catch { resStr = String(r.result); }
        if (resStr.length > 6000) resStr = resStr.slice(0, 6000) + "\n... (truncated)";
        return "```tool_result\ntool: " + r.tool + "\nargs: " + JSON.stringify(r.args) + "\nresult:\n" + resStr + "\n```";
      }).join("\n\n");

      // Autonomous next-step nudge
      const used = new Set(results.map(r => r.tool));
      const hasLoadSkill  = used.has("load_skill");
      const hasWebSearch  = used.has("web_search");
      const hasHtmlFetch  = used.has("html_fetch");
      const hasFileUpload = used.has("file_upload");

      let nudge = "";
      if (hasWebSearch && !hasHtmlFetch) {
        const searchResult = results.find(r => r.tool === "web_search")?.result;
        const urls = (searchResult?.results || []).slice(0, 3).map(r => r.url);
        nudge = `

[自律連鎖] 検索結果を受け取りました。ユーザーの質問に**深く**答えるため、次のラウンドで**必ず**上位1-3件のURLを html_fetch で並列取得してください。同じラウンドで複数の \`\`\`tool\`\`\` ブロックを並べれば並列実行されます。

推奨URL候補:
${urls.map((u, i) => `${i+1}. ${u}`).join("\n")}

例:
\`\`\`tool
{"tool":"html_fetch","args":{"url":"${urls[0] || "..."}"}}
\`\`\`
\`\`\`tool
{"tool":"html_fetch","args":{"url":"${urls[1] || "..."}"}}
\`\`\`

もし検索スニペットで既に十分な情報があると判断できるなら html_fetch をスキップして最終回答を出しても構いませんが、**基本は本文取得まで連鎖してください**。`;
      } else if (hasLoadSkill && !hasFileUpload) {
        nudge = `

[重要] load_skill は内部ガイドです。ユーザーへの応答に露出させないでください。
このラウンドでは、スキルを踏まえて実際のタスク(コード生成など)を実行し、完成物を file_upload でアップロードしてください。`;
      } else {
        nudge = `

[次のアクション] ツール結果を見てタスクが完了したか判断:
- 未完了 → 次のツールを呼び出して継続
- 完了 → \`\`\`tool\`\`\` ブロックなしで日本語の最終回答（ソースURLを引用しつつ）を出してください。`;
      }

      convo.push({ role: "user", content: feedback + nudge });

      if (round === max_rounds && !finalEmitted) {
        sseSend(res, "round", { round: round + 1, forced: true });
        try {
          convo.push({ role: "user", content: "[最大ラウンド到達。これ以上ツール呼び出しはせず、これまでの結果からユーザーへの最終回答を日本語で出してください。]" });
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
// File / model / health
// ============================================================================
app.get("/api/models", async (_req, res) => {
  try {
    const r = await fetch(`${NIE_BASE}/models`);
    res.json(await r.json());
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
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
  res.json({ ok: true, service: "orby", version: "3.0.0", tools: Object.keys(TOOLS), skills: Object.keys(SKILLS) });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Orby v3 running on http://localhost:${PORT}`));
}

module.exports = app;
