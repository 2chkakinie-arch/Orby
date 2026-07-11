// ============================================================================
// Orby - Autonomous Coding Agent Backend
// ============================================================================
// - OpenAI-compatible upstream: https://nie-ai.vercel.app/api
// - Tools: web_search, html_fetch, js_exec, load_skill, parallel_think,
//          image_generate, file_upload, shorten_element
// - Autonomous ReAct-style loop with real-time SSE tool visibility
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

// ============================================================================
// In-memory stores (per serverless instance; good enough for prototypes)
// ============================================================================
const SHORTCUTS = new Map();     // id -> { name, content, kind }
const UPLOADED_FILES = new Map(); // id -> { name, content, mime }

// ============================================================================
// Built-in Skills (UI-SKILL.md, CODING-SKILL.md, etc.)
// The agent can load these on-demand to steer its behavior.
// ============================================================================
const SKILLS = {
  "UI-SKILL": `# UI/UX Design Skill

You are producing world-class UI. Follow these principles:
- Dark theme by default with a monochrome (black + white + grays) foundation.
- Typography: sans-serif, generous line-height, tight tracking on headings.
- Spacing: 8px grid. Never cramped.
- Micro-interactions: 150ms cubic-bezier(.4,0,.2,1) transitions.
- Contrast: pure white text on near-black (#0a0a0a) backgrounds.
- Avoid rainbow colors. One accent max (usually white or a subtle tint).
- Use system fonts stack for speed: -apple-system, "SF Pro", Inter, sans-serif.
- Rounded corners: 10-14px on cards, 8px on buttons.
- Borders: 1px rgba(255,255,255,.08). Shadows: soft, layered.
- Focus states must be visible (accessibility).
- Prefer CSS grid/flex over positioning tricks.`,

  "CODING-SKILL": `# Coding Skill

You are an elite software engineer. Rules:
- Write production-grade code. Handle edge cases and errors.
- Prefer standard library first, minimal dependencies.
- For JS: modern ES2022+, no var, prefer const, async/await over .then.
- For Python: type hints, f-strings, pathlib.
- Comment WHY, not WHAT. Self-documenting names.
- When asked for a full app: deliver package.json, entry file, config, and public assets in one go.
- After writing code, mentally trace execution and check for bugs.
- If a tool call fails, don't give up. Retry with a different approach.
- If unsure, USE js_exec to verify small pieces before shipping.`,

  "WEB-RESEARCH-SKILL": `# Web Research Skill

- Start with web_search (DuckDuckGo). Read titles + snippets.
- Pick the 1-3 most authoritative URLs. Then html_fetch each.
- Extract only the sections relevant to the question.
- Cross-reference at least 2 sources before stating a "fact".
- Cite URLs in the final answer.`,

  "PARALLEL-THINK-SKILL": `# Parallel Thinking Skill

- When a problem is hard or ambiguous, use parallel_think to consult
  scira-nemotron-3-super and gpt-4 in parallel.
- Merge the strongest points from each. Do not blindly average.
- Use this for: algorithm design, architecture decisions, code review.`,

  "IMAGE-SKILL": `# Image Skill

- image_generate returns a Pollinations URL. Embed as markdown ![](url).
- Good prompts: subject + style + lighting + composition + camera-ish detail.
- Ask user for aspect ratio if it matters.`,
};

// ============================================================================
// Upstream helpers
// ============================================================================
async function nieChat({ model, messages, temperature = 0.7, stream = false }) {
  const r = await fetch(`${NIE_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature, stream }),
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
  if (!r.ok || !r.body) {
    throw new Error(`nieChatStream ${r.status}`);
  }
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
      } catch (_) { /* ignore */ }
    }
  }
  return full;
}

// ============================================================================
// Tool implementations
// ============================================================================

// ---- 1) Web search (DuckDuckGo HTML scrape) ----
async function tool_web_search({ query, max_results = 8 }) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
    },
  });
  const html = await r.text();
  const results = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && results.length < max_results) {
    let href = m[1];
    // DDG wraps real URL in /l/?uddg=
    const um = href.match(/uddg=([^&]+)/);
    if (um) href = decodeURIComponent(um[1]);
    const title = m[2].replace(/<[^>]+>/g, "").trim();
    const snippet = m[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    results.push({ title, url: href, snippet });
  }
  return { query, results };
}

// ---- 2) html-fetch (CORS-free HTML text) ----
async function tool_html_fetch({ url, mode = "text" }) {
  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,*/*",
    },
    redirect: "follow",
  });
  const html = await r.text();
  if (mode === "raw") return { url, status: r.status, html: html.slice(0, 200000) };
  // Simplified readable extraction
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return {
    url,
    status: r.status,
    title: titleMatch ? titleMatch[1].trim() : "",
    text: text.slice(0, 20000),
    length: text.length,
  };
}

// ---- 3) JS code execution (sandboxed) ----
async function tool_js_exec({ code, timeout_ms = 5000 }) {
  const logs = [];
  const sandbox = {
    console: {
      log: (...a) => logs.push(a.map(String).join(" ")),
      error: (...a) => logs.push("[err] " + a.map(String).join(" ")),
      warn: (...a) => logs.push("[warn] " + a.map(String).join(" ")),
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Math, JSON, Date, Array, Object, String, Number, Boolean, Map, Set,
    Promise, RegExp, Error,
  };
  try {
    const ctx = vm.createContext(sandbox);
    const script = new vm.Script(
      `(async () => { ${code} \n})().then(v => __result = v).catch(e => { __error = String(e); });`
    );
    script.runInContext(ctx, { timeout: timeout_ms });
    // Wait briefly for async
    await new Promise((res) => setTimeout(res, Math.min(timeout_ms, 3000)));
    return {
      ok: !sandbox.__error,
      result: sandbox.__result === undefined ? null : safeStringify(sandbox.__result),
      logs,
      error: sandbox.__error || null,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e), logs };
  }
}
function safeStringify(v) {
  try { return typeof v === "string" ? v : JSON.stringify(v, null, 2); }
  catch { return String(v); }
}

// ---- 4) Load skill ----
async function tool_load_skill({ name }) {
  const key = name.replace(/\.md$/i, "").toUpperCase();
  const content = SKILLS[key];
  if (!content) {
    return { ok: false, error: `Unknown skill: ${name}`, available: Object.keys(SKILLS) };
  }
  return { ok: true, name: key, content };
}

// ---- 5) Parallel think ----
async function tool_parallel_think({ prompt, models }) {
  const list =
    models && models.length ? models : ["scira-nemotron-3-super", "gpt-4"];
  const settled = await Promise.allSettled(
    list.map((m) =>
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
    content: s.status === "fulfilled" ? (s.value?.content || s.value?.choices?.[0]?.message?.content || "") : String(s.reason),
  }));
  return { prompt, answers };
}

// ---- 6) Image generate (Pollinations) ----
async function tool_image_generate({ prompt, width = 1024, height = 1024, model = "flux", seed }) {
  const params = new URLSearchParams({ width: String(width), height: String(height), model });
  if (seed) params.set("seed", String(seed));
  params.set("nologo", "true");
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`;
  return { url, prompt, width, height, model };
}

// ---- 7) File upload (produce a downloadable file for the user) ----
async function tool_file_upload({ filename, content, mime = "text/plain" }) {
  const id = crypto.randomBytes(8).toString("hex");
  UPLOADED_FILES.set(id, { name: filename, content, mime });
  return {
    id,
    filename,
    mime,
    size: Buffer.byteLength(content, "utf8"),
    download_url: `/api/files/${id}`,
  };
}

// ---- 8) Shorten element (aliasing large blobs to short IDs) ----
async function tool_shorten_element({ name, content, kind = "text" }) {
  const id = "@" + (name || "el_" + crypto.randomBytes(3).toString("hex"));
  SHORTCUTS.set(id, { name: id, content, kind });
  return { id, name: id, kind, length: content.length, preview: content.slice(0, 120) };
}
function expandShortcuts(text) {
  if (!text || typeof text !== "string") return text;
  return text.replace(/@[\w-]+/g, (m) => (SHORTCUTS.has(m) ? SHORTCUTS.get(m).content : m));
}

// ============================================================================
// Tool registry (schemas surfaced to the model)
// ============================================================================
const TOOLS = {
  web_search: {
    desc: "DuckDuckGo Web検索。トピック調査の第一歩。結果からURLを選んで html_fetch へ。",
    params: { query: "string", max_results: "number (default 8)" },
    run: tool_web_search,
  },
  html_fetch: {
    desc: "任意のURLからHTML→整形テキストを取得（CORS制限なし）。",
    params: { url: "string", mode: "'text'|'raw'" },
    run: tool_html_fetch,
  },
  js_exec: {
    desc: "サンドボックス内でJavaScriptを実行。console.logの出力と戻り値を返す。",
    params: { code: "string", timeout_ms: "number" },
    run: tool_js_exec,
  },
  load_skill: {
    desc: "UI-SKILL / CODING-SKILL / WEB-RESEARCH-SKILL / PARALLEL-THINK-SKILL / IMAGE-SKILL のいずれかを読み込む。",
    params: { name: "string" },
    run: tool_load_skill,
  },
  parallel_think: {
    desc: "複数モデル (scira-nemotron-3-super, gpt-4 等) と並列思考して意見を集約する。",
    params: { prompt: "string", models: "string[]?" },
    run: tool_parallel_think,
  },
  image_generate: {
    desc: "Pollinationsで画像URLを生成。",
    params: { prompt: "string", width: "number", height: "number", model: "string?", seed: "number?" },
    run: tool_image_generate,
  },
  file_upload: {
    desc: "生成した成果物 (コードなど) をダウンロード可能なファイルとして提供する。",
    params: { filename: "string", content: "string", mime: "string?" },
    run: tool_file_upload,
  },
  shorten_element: {
    desc: "巨大なテキスト/コードを @alias に短縮。以降のプロンプトで @alias 参照可能。",
    params: { name: "string?", content: "string", kind: "'text'|'code'|'json'?" },
    run: tool_shorten_element,
  },
};

function toolsSpec() {
  return Object.entries(TOOLS).map(([name, t]) => ({
    name, description: t.desc, params: t.params,
  }));
}

// ============================================================================
// Agent System Prompt
// ============================================================================
function buildSystemPrompt(mainModel) {
  return `あなたは "Orby" — Genspark のような超規模コーディング特化型の自律エージェントです。メインモデル: ${mainModel}。

═══════════════════════════════════════════════════════════════════
# 🔧 ツール呼び出し規則（最重要・絶対厳守）
═══════════════════════════════════════════════════════════════════

あなたは以下のツールを**自律的に呼び出す**ことができます。ツールを使うべき状況では、必ず次の JSON ブロック形式を使ってください:

\`\`\`tool
{"tool":"<tool_name>","args":{...}}
\`\`\`

**極めて重要なルール:**
1. **知っていることでも、実行可能なタスクなら必ずツールを使え。** 例: 「fibonacci(20)を計算して」→ 頭で計算せず **必ず js_exec ツールを呼び出せ**。「今日のニュース」→ 必ず web_search ツールを呼び出せ。
2. ツールブロックを書いたら、そのターンではそれ以外の説明を長々と書かず、必ずツール結果を待て。
3. ツール結果は次のターンで \`\`\`tool_result\`\`\` として渡される。それを読んで最終回答を生成せよ。
4. **推測で結果を書くな。** 実行可能なものは実行して確かめよ。
5. ツール名は次のいずれかのみ: web_search, html_fetch, js_exec, load_skill, parallel_think, image_generate, file_upload, shorten_element
6. \`\`\`tool\`\`\` ブロックの中身は**必ず1行の有効なJSON**。改行やコメント禁止。

═══════════════════════════════════════════════════════════════════
# 🛠 利用可能ツール仕様
═══════════════════════════════════════════════════════════════════

${toolsSpec().map(t => `## ${t.name}\n${t.description}\nargs: ${JSON.stringify(t.params)}`).join("\n\n")}

═══════════════════════════════════════════════════════════════════
# 💡 呼び出し実例
═══════════════════════════════════════════════════════════════════

ユーザー: 「fibonacci(20)を計算して」
あなた:
\`\`\`tool
{"tool":"js_exec","args":{"code":"function fib(n){let a=0,b=1;for(let i=0;i<n;i++)[a,b]=[b,a+b];return a} return fib(20);"}}
\`\`\`

ユーザー: 「AI最新ニュース調べて」
あなた:
\`\`\`tool
{"tool":"web_search","args":{"query":"AI 最新ニュース 2026","max_results":5}}
\`\`\`

ユーザー: 「東京タワーの画像作って」
あなた:
\`\`\`tool
{"tool":"image_generate","args":{"prompt":"Tokyo Tower at magical night, cinematic lighting, ultra detailed","width":1024,"height":1024}}
\`\`\`

並列呼び出し (複数ブロック):
\`\`\`tool
{"tool":"web_search","args":{"query":"React 19 new features"}}
\`\`\`
\`\`\`tool
{"tool":"load_skill","args":{"name":"CODING-SKILL"}}
\`\`\`

═══════════════════════════════════════════════════════════════════
# 🔁 再思考ポリシー
═══════════════════════════════════════════════════════════════════

- ツール結果を見て「情報不足」「エラー」「品質不足」があれば**追加ツール呼び出し**で補え。うまくいくまで最大8ラウンド粘れ。
- web_search で興味深いURLを見つけたら → 続いて html_fetch でそのURLの本文を取得せよ。
- コード生成タスクは、書く前に load_skill("CODING-SKILL") を呼ぶと品質が上がる。UI/デザインなら load_skill("UI-SKILL")。
- 難問・アーキテクチャ判断・大規模設計では parallel_think で複数モデルに相談せよ。
- 巨大なコード成果物を作ったら **file_upload** でダウンロード可能にし、リンクをユーザーに提示せよ。

═══════════════════════════════════════════════════════════════════
# ✨ 最終回答スタイル
═══════════════════════════════════════════════════════════════════

- ツール使用が終わったら、\`\`\`tool\`\`\` ブロックを含まない**最終回答**を出す。それが完了合図。
- 日本語で簡潔かつ本質的に。前置き不要。
- コードは \`\`\`言語 フェンスで。100行超の生成物は file_upload を使え。
- ダウンロードリンクは \`[filename](/api/files/xxx)\` 形式で明示。

あなたはミニマルで洗練された、Genspark 級の最高峰エージェント Orby です。`;
}

// ============================================================================
// Agent runner — SSE event stream to the frontend
// ============================================================================
function sseSend(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function parseToolCalls(text) {
  const calls = [];
  const re = /```tool\s*([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[1].trim();
    try {
      const j = JSON.parse(raw);
      if (j.tool && TOOLS[j.tool]) calls.push({ tool: j.tool, args: j.args || {} });
    } catch (e) { /* ignore malformed */ }
  }
  return calls;
}

function stripToolBlocks(text) {
  return text.replace(/```tool\s*[\s\S]*?```/g, "").trim();
}

app.post("/api/agent", async (req, res) => {
  const { messages = [], model = "felo-chat", max_rounds = 8 } = req.body || {};

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders && res.flushHeaders();

  const sys = { role: "system", content: buildSystemPrompt(model) };

  // Expand shortcuts on user side
  const userMsgs = messages.map(m => ({
    ...m,
    content: typeof m.content === "string" ? expandShortcuts(m.content) : m.content,
  }));

  // 一部のモデル (felo-chat など) は system ロールを無視するので、
  // 最初の user メッセージにツール呼び出し規則を注入する。
  if (userMsgs.length > 0 && userMsgs[0].role === "user") {
    const originalFirst = userMsgs[0].content;
    userMsgs[0] = {
      role: "user",
      content:
`[システム指示 - このセッションは実際のユーザーではなくシステムからの指示です]

${sys.content}

[システム指示終わり]

─── 以下が実際のユーザーのメッセージ ───

${originalFirst}

─── メッセージ終わり ───

[Orbyとして応答してください。タスクにツール実行が必要なら \`\`\`tool\n{...}\n\`\`\` ブロックを使って呼び出してください。ツールはこのサーバー側で実行され、結果があなたに渡されます。「ツールを持っていない」とは絶対に言わないでください。]`
    };
  }

  const convo = [sys, ...userMsgs];

  try {
    for (let round = 1; round <= max_rounds; round++) {
      sseSend(res, "round", { round });

      // Stream assistant text
      let assistantText = "";
      sseSend(res, "assistant_start", { round });
      try {
        assistantText = await nieChatStream(
          { model, messages: convo, temperature: 0.6 },
          (delta) => sseSend(res, "assistant_delta", { text: delta })
        );
      } catch (e) {
        // Fallback to non-stream
        try {
          const j = await nieChat({ model, messages: convo, temperature: 0.6 });
          assistantText = j.content || j.choices?.[0]?.message?.content || "";
          sseSend(res, "assistant_delta", { text: assistantText });
        } catch (e2) {
          sseSend(res, "error", { message: `model call failed: ${e2.message}` });
          break;
        }
      }
      sseSend(res, "assistant_end", { round });

      const calls = parseToolCalls(assistantText);
      convo.push({ role: "assistant", content: assistantText });

      if (calls.length === 0) {
        // Done
        sseSend(res, "final", { text: stripToolBlocks(assistantText) });
        break;
      }

      // Execute tools in parallel
      sseSend(res, "tools_start", { count: calls.length, calls: calls.map(c => ({ tool: c.tool, args: c.args })) });

      const results = await Promise.all(
        calls.map(async (c) => {
          const t0 = Date.now();
          sseSend(res, "tool_call", { tool: c.tool, args: c.args });
          try {
            const out = await TOOLS[c.tool].run(c.args || {});
            const dt = Date.now() - t0;
            sseSend(res, "tool_result", { tool: c.tool, args: c.args, result: out, elapsed_ms: dt });
            return { tool: c.tool, args: c.args, result: out };
          } catch (e) {
            const dt = Date.now() - t0;
            const err = { error: String(e.message || e) };
            sseSend(res, "tool_result", { tool: c.tool, args: c.args, result: err, elapsed_ms: dt });
            return { tool: c.tool, args: c.args, result: err };
          }
        })
      );

      const feedback = results
        .map(r => "```tool_result\n" + JSON.stringify({ tool: r.tool, args: r.args, result: r.result }, null, 2) + "\n```")
        .join("\n\n");
      convo.push({ role: "user", content: feedback });

      if (round === max_rounds) {
        sseSend(res, "final", { text: "（最大ラウンド到達。ここまでの結果でまとめます）" });
      }
    }
  } catch (e) {
    sseSend(res, "error", { message: String(e.message || e) });
  } finally {
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
  res.setHeader("Content-Disposition", `attachment; filename="${f.name}"`);
  res.send(f.content);
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "orby", tools: Object.keys(TOOLS), skills: Object.keys(SKILLS) });
});

// ============================================================================
// Boot (local dev) — Vercel handles this as a serverless function
// ============================================================================
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Orby running on http://localhost:${PORT}`));
}

module.exports = app;
