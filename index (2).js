// ============================================================================
// Orby v2 — Autonomous Coding Agent Backend
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
// Built-in Skills
// ============================================================================
const SKILLS = {
  "UI-SKILL": `# UI/UX Design Skill
- Dark theme, monochrome (black/white/gray) foundation.
- Typography: system-font stack, tight tracking on headings.
- 8px spacing grid. 150ms cubic-bezier(.4,0,.2,1) transitions.
- Borders: 1px rgba(255,255,255,.08). Rounded 10-14px.
- One accent color max. Avoid rainbow palettes.
- Prefer CSS grid/flex. Focus states must be visible.`,

  "CODING-SKILL": `# Coding Skill
- Production-grade code. Handle edge cases.
- Modern JS ES2022+ / Python 3.11+ with type hints.
- Self-documenting names. Comment WHY not WHAT.
- Deliver full apps in one go: entry file + config + assets.
- After writing code, mentally trace and check for bugs.
- Use js_exec to verify small pieces when unsure.
- For single-file HTML apps: inline CSS+JS, no external CDN dependencies unless required.`,

  "WEB-RESEARCH-SKILL": `# Web Research Skill
- web_search → pick 1-3 authoritative URLs → html_fetch each.
- Cross-reference at least 2 sources. Cite URLs in final answer.`,

  "PARALLEL-THINK-SKILL": `# Parallel Thinking Skill
- Use parallel_think for hard/ambiguous problems.
- Merge strongest points from each model. Don't blindly average.`,

  "IMAGE-SKILL": `# Image Skill
- image_generate returns a Pollinations URL. Embed as markdown ![](url).
- Good prompts: subject + style + lighting + composition + camera detail.`,

  "GAME-DEV-SKILL": `# Game Development Skill (Single-File HTML)
- Canvas 2D or DOM based. 60fps target.
- Game loop: requestAnimationFrame with delta-time.
- Separate state / update / render clearly.
- Input: keyboard + click + touch.
- For board games (Othello/Chess): 
  * Board as 2D array. Move validation function.
  * AI: minimax with alpha-beta pruning for small boards. Iterative deepening.
  * Evaluation: material + positional + mobility.
- UI: score display, restart, difficulty toggle.
- Zero external dependencies. Fully offline.`,
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
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`nieChat ${r.status}: ${text.slice(0, 200)}`);
  }
  return r.json();
}

async function nieChatStream({ model, messages, temperature = 0.7 }, onDelta, signal) {
  const r = await fetch(`${NIE_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature, stream: true }),
    signal,
  });
  if (!r.ok || !r.body) throw new Error(`nieChatStream ${r.status}`);
  const reader = r.body;
  let buf = "";
  let full = "";
  for await (const chunk of reader) {
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
        if (delta) {
          full += delta;
          onDelta && onDelta(delta);
        }
      } catch (_) {}
    }
  }
  return full;
}

// ============================================================================
// Tool: web_search — robust multi-source with Bing (u= redirect decode) + fallbacks
// ============================================================================
function decodeBingRedirect(url) {
  try {
    const m = url.match(/[?&]u=([^&]+)/);
    if (!m) return url;
    let payload = decodeURIComponent(m[1]);
    if (payload.startsWith("a1")) payload = payload.slice(2);
    // urlsafe base64 → base64
    payload = payload.replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4) payload += "=";
    const decoded = Buffer.from(payload, "base64").toString("utf8");
    return decoded.startsWith("http") ? decoded : url;
  } catch { return url; }
}

function decodeXmlEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'")
    .replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

// Bing search via RSS endpoint - reliable, no bot detection, structured XML
async function searchBing(query, max_results) {
  const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}&count=${Math.max(max_results, 10)}`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept": "application/rss+xml, application/xml, text/xml, */*",
      "Accept-Language": "en-US,en;q=0.9",
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
    if (!/^https?:\/\//.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({
      title: decodeXmlEntities(t[1]).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
      url,
      snippet: d ? decodeXmlEntities(d[1]).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "",
    });
  }
  return results;
}

async function searchWikipedia(query, max_results) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${max_results}&utf8=1`;
  const r = await fetch(url, { headers: { "User-Agent": "Orby/1.0" } });
  const j = await r.json();
  return (j.query?.search || []).map(s => ({
    title: s.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`,
    snippet: s.snippet.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"'),
  }));
}

async function tool_web_search({ query, max_results = 8 }) {
  const errors = [];
  try {
    const bing = await searchBing(query, max_results);
    if (bing.length > 0) return { query, source: "bing", results: bing };
    errors.push("bing: 0 results");
  } catch (e) { errors.push(`bing: ${e.message}`); }
  // Fallback: Wikipedia (always works)
  try {
    const wiki = await searchWikipedia(query, max_results);
    if (wiki.length > 0) return { query, source: "wikipedia", results: wiki, note: "Bing failed; using Wikipedia" };
  } catch (e) { errors.push(`wiki: ${e.message}`); }
  return { query, source: "none", results: [], errors };
}

// ============================================================================
// Tool: html_fetch
// ============================================================================
async function tool_html_fetch({ url, mode = "text", max_chars = 15000 }) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,*/*",
      "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
    },
    redirect: "follow",
  });
  const html = await r.text();
  if (mode === "raw") return { url, status: r.status, html: html.slice(0, 200000) };
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
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
// Tool: js_exec — VM sandbox with proper async support
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
    const wrapped = `
      (async () => {
        ${code}
      })().then(v => { globalThis.__result = v; globalThis.__done = true; })
          .catch(e => { globalThis.__error = e && e.stack ? e.stack : String(e); globalThis.__done = true; });
    `;
    const script = new vm.Script(wrapped, { timeout: timeout_ms });
    script.runInContext(ctx, { timeout: timeout_ms });
    // Wait for async completion
    const deadline = Date.now() + Math.min(timeout_ms, 8000);
    while (!ctx.__done && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 30));
    }
    if (!ctx.__done) return { ok: false, error: "timeout", logs };
    return {
      ok: !ctx.__error,
      result: ctx.__result === undefined ? null : safeStringify(ctx.__result),
      logs,
      error: ctx.__error || null,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e), logs };
  }
}
function safeStringify(v) {
  try {
    if (typeof v === "string") return v;
    return JSON.stringify(v, null, 2);
  } catch { return String(v); }
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
  const list = (models && models.length) ? models : ["scira-nemotron-3-super", "gpt-4"];
  const settled = await Promise.allSettled(
    list.map(m =>
      nieChat({
        model: m,
        messages: [
          { role: "system", content: "Answer concisely and expertly. Focus on insight." },
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
      : String(s.reason),
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
// Tool: file_upload
// ============================================================================
async function tool_file_upload({ filename, content, mime }) {
  const id = crypto.randomBytes(8).toString("hex");
  const guessMime = () => {
    const ext = (filename || "").split(".").pop().toLowerCase();
    return ({
      html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
      js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
      json: "application/json; charset=utf-8", md: "text/markdown; charset=utf-8",
      py: "text/x-python; charset=utf-8", txt: "text/plain; charset=utf-8",
      svg: "image/svg+xml", xml: "application/xml",
    })[ext] || "text/plain; charset=utf-8";
  };
  UPLOADED_FILES.set(id, { name: filename, content, mime: mime || guessMime() });
  return {
    id, filename,
    mime: mime || guessMime(),
    size: Buffer.byteLength(content, "utf8"),
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
  web_search: { desc: "Bing 経由の Web 検索 (フォールバック: Wikipedia)。トピック調査の第一歩。", params: { query: "string", max_results: "number (default 8)" }, run: tool_web_search },
  html_fetch: { desc: "任意のURLからHTML→整形テキストを取得（CORS制限なし）。", params: { url: "string", mode: "'text'|'raw'", max_chars: "number" }, run: tool_html_fetch },
  js_exec: { desc: "サンドボックス内でJavaScriptを実行。async対応、console.logキャプチャ、戻り値返却。", params: { code: "string", timeout_ms: "number" }, run: tool_js_exec },
  load_skill: { desc: "内蔵スキルを読み込む: UI-SKILL / CODING-SKILL / WEB-RESEARCH-SKILL / PARALLEL-THINK-SKILL / IMAGE-SKILL / GAME-DEV-SKILL", params: { name: "string" }, run: tool_load_skill },
  parallel_think: { desc: "複数モデルと並列思考して意見集約 (scira-nemotron-3-super, gpt-4, deepseek-r1 等)。", params: { prompt: "string", models: "string[]?" }, run: tool_parallel_think },
  image_generate: { desc: "Pollinationsで画像URLを生成 (無料・即時)。", params: { prompt: "string", width: "number", height: "number", model: "string?", seed: "number?" }, run: tool_image_generate },
  file_upload: { desc: "完成コード等をダウンロード可能なファイルとして提供 (HTMLはブラウザで直接開ける)。", params: { filename: "string", content: "string", mime: "string?" }, run: tool_file_upload },
  shorten_element: { desc: "巨大テキスト/コードを @alias に短縮。以降のプロンプトで参照可能。", params: { name: "string?", content: "string", kind: "'text'|'code'|'json'?" }, run: tool_shorten_element },
};

function toolsSpec() {
  return Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.desc, params: t.params }));
}

// ============================================================================
// System prompt
// ============================================================================
function buildSystemPrompt(mainModel) {
  return `あなたは "Orby" — Genspark 級の超規模コーディング特化型・自律エージェントです。メインモデル: ${mainModel}。

═══════════════════════════════════════════════════════════════════════
🔧 ツール呼び出し規則（最重要・絶対厳守）
═══════════════════════════════════════════════════════════════════════

ツールを使いたい時は、返答の中で必ず次の JSON ブロック形式で呼び出してください:

\`\`\`tool
{"tool":"<tool_name>","args":{...}}
\`\`\`

**極めて重要なルール:**

1. **知っていることでも、実行可能なタスクなら必ずツールを使え。** 例: 「fibonacci(20)を計算」→ 必ず js_exec を呼ぶ。「最新ニュース」→ 必ず web_search を呼ぶ。「オセロを作って」→ まず load_skill → 次のラウンドで実装コードを生成 → file_upload。

2. **ツール呼び出しブロックだけの返答は「作業中」であり「最終回答」ではない。** ツール結果を受け取ったら、必ず次のラウンドで作業を続行し、ユーザーの要求を完了させよ。

3. **load_skill を呼んだ後は、そのスキル内容だけで返答を終わらせるな。** スキルは前準備。読み込んだ次のラウンドで実際のタスク（コード生成など）を実行せよ。

4. **web_search が空配列 [] を返した / エラーの場合は、別のクエリで再試行するか、Wikipedia等別ソースで代替検索せよ。** 「検索できませんでした」と諦めるのは禁止。

5. ツール名は次のいずれかのみ: web_search, html_fetch, js_exec, load_skill, parallel_think, image_generate, file_upload, shorten_element

6. \`\`\`tool\`\`\` ブロック内は**1行の有効なJSON**にせよ（改行、コメント、末尾カンマ禁止）。文字列内の改行は \\n でエスケープ。

═══════════════════════════════════════════════════════════════════════
🛠 利用可能ツール仕様
═══════════════════════════════════════════════════════════════════════

${toolsSpec().map(t => `## ${t.name}\n${t.description}\nargs: ${JSON.stringify(t.params)}`).join("\n\n")}

═══════════════════════════════════════════════════════════════════════
💡 呼び出し実例
═══════════════════════════════════════════════════════════════════════

例1: 「fibonacci(20)を計算して」
\`\`\`tool
{"tool":"js_exec","args":{"code":"function fib(n){let a=0,b=1;for(let i=0;i<n;i++)[a,b]=[b,a+b];return a} return fib(20);"}}
\`\`\`

例2: 「AI最新ニュース調べて」
\`\`\`tool
{"tool":"web_search","args":{"query":"AI news 2026","max_results":5}}
\`\`\`

例3: 「index.html単体でAIオセロを作って」
ラウンド1 (スキルを読み込む):
\`\`\`tool
{"tool":"load_skill","args":{"name":"GAME-DEV-SKILL"}}
\`\`\`
ラウンド2 (スキルを踏まえてコードを実際に生成し file_upload する。スキルのテキストをユーザーに見せてはいけない):
\`\`\`tool
{"tool":"file_upload","args":{"filename":"othello.html","content":"<!DOCTYPE html>...（ミニマックスAI搭載の完成HTMLコード全文）..."}}
\`\`\`
ラウンド3 (最終回答):
「オセロを作りました。[othello.html](/api/files/xxx) からダウンロードできます。ミニマックスAIを実装し...」

**重要**: load_skill を呼んだ後のターンでは、スキルのテキストをそのままユーザーへの回答にしてはいけません。必ず実際のタスク（コード生成など）を実行してください。

例4: 「コードだけ短いなら直接フェンスでもOK」— 30行未満の小さなコードなら file_upload を使わずに直接 \`\`\`html フェンスで回答しても良い。100行超と見込まれるなら必ず file_upload。

═══════════════════════════════════════════════════════════════════════
🔁 再思考ポリシー
═══════════════════════════════════════════════════════════════════════

- ツール結果に情報不足/エラー/品質不足があれば追加ツール呼び出しで補え。最大10ラウンド。
- web_search でURL発見 → 続けて html_fetch でそのURLの本文取得。
- 大規模コード生成前は load_skill("CODING-SKILL") か "GAME-DEV-SKILL"。
- 難問なら parallel_think で複数モデル相談。
- **重要**: 「タスクが未完了なのに tool ブロックだけの返答」は避けよ。タスク完了までツール呼び出しを継続せよ。

═══════════════════════════════════════════════════════════════════════
✨ 最終回答スタイル
═══════════════════════════════════════════════════════════════════════

- ツール使用が全て終わったら、\`\`\`tool\`\`\` ブロックを含まない最終回答を日本語で出せ。それが完了合図。
- コードは \`\`\`言語 フェンスで囲め。50行超なら file_upload を使いダウンロードリンクを提示せよ。
- ダウンロードリンクは \`[filename](/api/files/xxx)\` 形式で明示。
- 前置き不要。実質から入れ。ミニマルで洗練された文体。`;
}

// ============================================================================
// SSE helpers
// ============================================================================
function sseSend(res, event, data) {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (_) {}
}

// Robust tool-call parser (handles stray whitespace, code fences, single-line JSON)
function parseToolCalls(text) {
  const calls = [];
  const re = /```tool\s*\n?([\s\S]*?)\n?```/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[1].trim();
    if (!raw) continue;
    // Try direct JSON parse; if fails, try to extract first {...}
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
// /api/agent — Autonomous ReAct loop with SSE
// ============================================================================
app.post("/api/agent", async (req, res) => {
  const { messages = [], model = "felo-chat", max_rounds = 10 } = req.body || {};

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders && res.flushHeaders();

  // Note: we intentionally don't listen to req.close because Express sometimes
  // fires it spuriously mid-SSE-stream (esp. after res.flushHeaders + first write).
  // Instead we detect real closure via res.writableEnded / res.destroyed inside the loop.
  const isClosed = () => res.writableEnded || res.destroyed;

  const sysText = buildSystemPrompt(model);
  const sys = { role: "system", content: sysText };

  const userMsgs = messages.map(m => ({
    ...m,
    content: typeof m.content === "string" ? expandShortcuts(m.content) : m.content,
  }));

  // Inject system rules into first user message (for models like felo-chat that ignore system role)
  if (userMsgs.length > 0 && userMsgs[0].role === "user") {
    const originalFirst = userMsgs[0].content;
    userMsgs[0] = {
      role: "user",
      content:
`[システム指示 — この節はシステムからの指示です]

${sysText}

[システム指示終わり]

─── 以下が実際のユーザーメッセージ ───

${originalFirst}

─── メッセージ終わり ───

[Orbyとして応答してください。タスクにツール実行が必要なら \`\`\`tool\\n{...}\\n\`\`\` ブロックで呼び出してください。ツールはサーバー側で実行され結果が渡されます。「ツールを持っていない」とは絶対に言わないでください。タスク完了までツール呼び出しを繰り返してください。]`
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
      let streamErr = null;
      try {
        assistantText = await nieChatStream(
          { model, messages: convo, temperature: 0.6 },
          (delta) => sseSend(res, "assistant_delta", { text: delta })
        );
      } catch (e) {
        streamErr = e;
      }
      // If stream produced no content, try non-stream fallback
      if (!assistantText || !assistantText.trim()) {
        try {
          const j = await nieChat({ model, messages: convo, temperature: 0.6 });
          assistantText = j.content || j.choices?.[0]?.message?.content || "";
          if (assistantText) sseSend(res, "assistant_delta", { text: assistantText });
        } catch (e2) {
          const errMsg = `round ${round} model failed: ${streamErr?.message || ""} / fallback: ${e2.message}`;
          console.error(errMsg);
          sseSend(res, "error", { message: errMsg });
          // Try again with a different model as last resort
          try {
            const j = await nieChat({ model: "scira-default", messages: convo, temperature: 0.4 });
            assistantText = j.content || j.choices?.[0]?.message?.content || "";
            if (assistantText) sseSend(res, "assistant_delta", { text: assistantText });
          } catch (e3) {
            sseSend(res, "error", { message: `all models failed: ${e3.message}` });
            break;
          }
        }
      }
      sseSend(res, "assistant_end", { round });

      const calls = parseToolCalls(assistantText);

      // If model returned empty text after tool round, try again with a stronger model
      if (!assistantText || !assistantText.trim()) {
        console.warn(`round ${round}: empty response, escalating to scira-default`);
        try {
          const j = await nieChat({ model: "scira-default", messages: convo, temperature: 0.5 });
          assistantText = j.content || j.choices?.[0]?.message?.content || "";
          if (assistantText) sseSend(res, "assistant_delta", { text: assistantText });
        } catch (e) {
          console.error("escalation failed:", e.message);
        }
      }
      const finalCalls = parseToolCalls(assistantText);
      convo.push({ role: "assistant", content: assistantText });

      if (finalCalls.length === 0) {
        // True final answer
        sseSend(res, "final", { text: stripToolBlocks(assistantText) });
        finalEmitted = true;
        break;
      }

      // Execute tools in parallel
      sseSend(res, "tools_start", { count: finalCalls.length });

      const results = await Promise.all(finalCalls.map(async (c) => {
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

      // Truncate large tool results going back into context (avoid blowing token limit)
      const feedback = results.map(r => {
        let resStr;
        try { resStr = JSON.stringify(r.result, null, 2); }
        catch { resStr = String(r.result); }
        if (resStr.length > 8000) resStr = resStr.slice(0, 8000) + "\n... (truncated for context)";
        return "```tool_result\n" + JSON.stringify({ tool: r.tool, args: r.args }, null, 2) + "\nresult:\n" + resStr + "\n```";
      }).join("\n\n");

      // Determine what the agent MUST do next based on which tools were just used
      const usedTools = new Set(results.map(r => r.tool));
      const hasLoadSkill = usedTools.has("load_skill");
      const hasWebSearch = usedTools.has("web_search");
      const hasHtmlFetch = usedTools.has("html_fetch");
      const hasFileUpload = usedTools.has("file_upload");

      let nextInstruction = "";
      if (hasLoadSkill && !hasFileUpload) {
        nextInstruction =
`

[重要] load_skill は内部ガイドです。ユーザーへの回答ではありません。
スキルの内容を読んだ上で、今すぐユーザーの元リクエスト (例: 「オセロを作って」) を実行してください。
実際のコード生成をこのターンで行い、完成したコードを file_upload ツールでアップロードしてください。
日本語の短い説明は file_upload のあとで。スキル内容をそのままユーザーに見せないでください。`;
      } else if (hasWebSearch && !hasHtmlFetch) {
        nextInstruction =
`

[ヒント] 検索結果を取得しました。もしユーザーの質問に回答するには詳細が必要なら、
上位 1-2 件の URL を html_fetch で取得して本文を読んでから回答してください。
検索スニペットだけで十分なら、そのまま日本語で要約して最終回答を出してください。`;
      } else {
        nextInstruction =
`

[次のアクション] ツール結果を見てタスクが完了したか判断してください:
- まだ完了していない → 次のツールを呼び出して作業を継続
- 完了した → \`\`\`tool\`\`\` ブロックなしで日本語の最終回答を出してください。`;
      }

      convo.push({ role: "user", content: feedback + nextInstruction });

      if (round === max_rounds && !finalEmitted) {
        // Force a final summarization turn
        sseSend(res, "round", { round: round + 1, forced: true });
        try {
          convo.push({ role: "user", content: "[最大ラウンドに到達しました。これ以上ツール呼び出しはせず、これまでの結果からユーザーへの最終回答を日本語で出してください。]" });
          const j = await nieChat({ model, messages: convo, temperature: 0.4 });
          const finalText = stripToolBlocks(j.content || j.choices?.[0]?.message?.content || "");
          sseSend(res, "assistant_start", { round: round + 1 });
          sseSend(res, "assistant_delta", { text: finalText });
          sseSend(res, "assistant_end", { round: round + 1 });
          sseSend(res, "final", { text: finalText });
          finalEmitted = true;
        } catch (e) {
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
// Helper endpoints
// ============================================================================
app.get("/api/models", async (_req, res) => {
  try {
    const r = await fetch(`${NIE_BASE}/models`);
    const j = await r.json();
    res.json(j);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.get("/api/files/:id", (req, res) => {
  const f = UPLOADED_FILES.get(req.params.id);
  if (!f) return res.status(404).send("not found");
  res.setHeader("Content-Type", f.mime);
  if (req.query.inline) {
    res.setHeader("Content-Disposition", `inline; filename="${f.name}"`);
  } else {
    res.setHeader("Content-Disposition", `attachment; filename="${f.name}"`);
  }
  res.send(f.content);
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "orby",
    version: "2.0.0",
    tools: Object.keys(TOOLS),
    skills: Object.keys(SKILLS),
  });
});

// ============================================================================
// Boot
// ============================================================================
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Orby v2 running on http://localhost:${PORT}`));
}

module.exports = app;
