// ============================================================================
// Orby v6 — Universal Autonomous Agent (Genspark-class)
// ============================================================================
// Design principles:
// - Universal: works excellently for ANY task, not specialized to games/code
// - Intelligent routing: picks the right model for each subtask based on
//   measured performance characteristics (speed / output size / reasoning depth)
// - Autonomous reasoning: parallel_think as first step for complex tasks,
//   proper tool chaining, self-verification
// - Robust: forgiving tool parser, hallucination detection, error recovery
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

const SHORTCUTS = new Map();
const UPLOADED_FILES = new Map();
const ATTACHMENTS = new Map();
const MEMORY = new Map();

// ============================================================================
// Model routing table (measured performance)
// ============================================================================
const MODEL_PROFILE = {
  "scira-gemini-3.1-flash-lite": { speed: "fast",   size: "medium", depth: "shallow", strength: "多言語・ツール従順・軽量タスク" },
  "gpt-4o-mini":                  { speed: "fast",   size: "medium", depth: "shallow", strength: "簡潔な要約・短い返答" },
  "gpt-4o":                       { speed: "medium", size: "medium", depth: "medium",  strength: "バランス型・一般タスク" },
  "deepseek-r1":                  { speed: "medium", size: "medium", depth: "deep",    strength: "論理推論・数学・アルゴリズム" },
  "gpt-4":                        { speed: "slow",   size: "large",  depth: "deep",    strength: "深い分析・長文生成・多面的検討" },
  "felo-chat":                    { speed: "medium", size: "xlarge", depth: "medium",  strength: "超長文出力 (最大21KB) ・大規模コード" },
  "scira-nemotron-3-super":       { speed: "slow",   size: "large",  depth: "deep",    strength: "技術判断・アーキテクチャ選定" },
  "scira-default":                { speed: "medium", size: "medium", depth: "medium",  strength: "汎用フォールバック" },
};

// Routing rules by task category
function pickModelFor(category) {
  const table = {
    "chat":             "scira-gemini-3.1-flash-lite",
    "quick":            "scira-gemini-3.1-flash-lite",
    "research":         "scira-gemini-3.1-flash-lite",
    "summary":          "gpt-4o-mini",
    "general":          "gpt-4o",
    "reasoning":        "deepseek-r1",
    "analysis":         "gpt-4",
    "code_large":       "felo-chat",
    "architecture":     "scira-nemotron-3-super",
    "creative_writing": "gpt-4",
  };
  return table[category] || DEFAULT_MODEL;
}

// ============================================================================
// SKILLS — 13 universal skills (no task-specific hardcoded examples)
// ============================================================================
const SKILLS = {
  "UI-SKILL": `# UI/UX デザインの原則

## 基本
- 一貫した視覚言語 (色・フォント・余白のシステム化)
- ヒエラルキーを持たせる (サイズ・色・配置で重要度を表現)
- 認知負荷の最小化 (1画面1メインアクション)
- フィードバック即座に (hover/click/load状態)

## モダンダークテーマ
- ベース: #08-0f (階層的な暗さ)
- ボーダー: rgba(255,255,255,.06-.14) で境界を控えめに
- テキスト: 高コントラスト (#f5f5f6) → セカンダリ (#a1a1aa) → ミュート (#6b6b7a)
- アクセント色は1つ選ぶ (紫/青/緑/オレンジ等)

## タイポグラフィ
- system-ui スタック優先
- ヒエラルキー: 34-36px → 24-28px → 18-20px → 14.5px
- letter-spacing: 見出しは -.02em (詰める)
- line-height: 本文 1.6-1.72、見出し 1.2-1.3

## スペーシング
- 8px グリッド
- コンポーネント内: 8-16px、コンポーネント間: 20-32px
- 固定要素の下には padding-bottom で clearance 確保

## インタラクション
- 全 hover に .12-.18s トランジション
- click時は scale(.98) 等でフィードバック
- focus-visible な状態でアウトライン

## レイアウト
- Grid/Flex を優先、position:absolute は最小限
- max-width でリーダビリティ確保 (本文 700-800px)
- モバイル: 100dvh, viewport-fit=cover`,

  "CODING-SKILL": `# コーディング品質基準

## 全言語共通
- **完全性**: プレースホルダー/TODO/省略なしで動く完成品を書く
- **エラー処理**: エッジケース (null/空/巨大/異常入力) を最初に考える
- **命名**: 意図が読める。tmp/data/foo は禁止
- **コメント**: 「なぜ」を書く。「何を」は名前で表現する
- **依存最小**: 標準ライブラリ優先。外部依存は目的が明確な時のみ

## JavaScript / TypeScript
- ES2022+ (const/let、async/await、optional chaining、nullish coalescing)
- Promise を Chain せず await で
- 型付けは JSDoc または TS strict

## Python
- 3.11+ の型ヒント (typing/PEP604 union)
- f-string、pathlib、dataclass
- context manager (with)

## HTML/CSS
- セマンティックHTML (header/main/nav/article/section)
- CSS 変数で色/サイズを一元管理
- モバイルファースト

## 生成物の品質チェック
1. コードは実際に動くか (js_exec で試せるものは試せ)
2. 見た目/挙動が要求水準か (単なる骨組みではない)
3. エッジケースを網羅しているか
4. **要求されたスケールに合致しているか** (簡易ツールに対しては簡潔に、本格アプリには本格的に)`,

  "WEB-RESEARCH-SKILL": `# Web リサーチの手法

## 標準フロー
1. web_search でクエリ投入 (時事なら年号を含める)
2. 結果から権威あるソース 2-3 件を選ぶ
3. 選んだ URL を **同一ラウンドで並列** html_fetch
4. 情報を統合し、ソース URL を引用しながら日本語で回答

## 権威判定
- 公式ドキュメント、公式ブログ (.dev/.org/.gov)
- 大手技術メディア (TechCrunch, The Verge, Ars Technica 等)
- 学術/GitHub 公式リポジトリ
- Wikipedia (基礎知識のみ)

避ける: SEOスパム、生成AIコンテンツ、広告過多

## 情報統合
- 2ソース以上でクロス検証
- 相違点があればそれも明示
- 主観と事実を区別

## 引用形式
本文中で [ソース名](URL) を挟むか、末尾に ## 参考 セクション`,

  "PARALLEL-THINK-SKILL": `# 並列思考の使いこなし

## 適用ケース
- **アーキテクチャ選定** (マイクロサービスか、モノリスか)
- **技術スタック比較** (どのフレームワークか)
- **設計判断** (どのデータモデルか)
- **主観的評価** (どのアプローチがよいか)
- **難問** (最適化・アルゴリズム設計)
- **タスク開始時の全体戦略立案** ← Orby は常にここから始めることを推奨

## 使うモデル
モデルは目的で選ぶ:
- **deepseek-r1**: 論理推論・数学
- **gpt-4**: 深い分析・多面的検討
- **scira-nemotron-3-super**: 技術判断
- **gpt-4o**: バランス
- **felo-chat**: 詳細説明

## プロンプト設計
- 1つの争点にフォーカス
- 観点を列挙 (性能、開発速度、保守性、コスト等)
- 200 words 以内と明示

## 統合
- 共通点 = 信頼性高
- 相違点 = 難しい問題、両論明示
- 最鋭い理由付けを引用`,

  "IMAGE-SKILL": `# 画像生成プロンプト

## 構造
[主題] + [スタイル] + [ライティング] + [構図] + [質感/雰囲気]

## スタイル語彙
- Photo系: cinematic realism, photorealistic, film photography
- 絵画系: watercolor, oil painting, ink wash
- 3D系: octane render, unreal engine, blender
- Illustration: anime, comic book, minimalist geometric

## ライティング
- golden hour, blue hour, moonlight, neon glow, volumetric lighting, rim lighting

## サイズ
- SNS縦 1024x1536 (2:3)
- 正方 1024x1024
- 横長 1536x1024
- ヒーロー 2048x1024`,

  "TASK-DECOMPOSITION-SKILL": `# タスク分解スキル

## 大原則
複雑タスクは必ず分解してから実行する。

## 分解手順
1. **ゴール定義**: 完了状態を明確に (何が成果物か)
2. **サブタスク列挙**: 独立した実行単位に分ける
3. **依存関係**: 順序と並列可能性を洗い出す
4. **各サブタスクにツール割当**: どのツールで実行するか
5. **統合手順**: 全サブタスク結果をどう組み合わせるか

## 並列化の判断
- 依存なし → 同一ラウンドで並列実行 (複数 tool ブロック)
- 依存あり → 順次ラウンド

## 例: 「AとBを比較する記事を書いて」
- サブタスク1: A について web_search + html_fetch
- サブタスク2: B について web_search + html_fetch (並列)
- サブタスク3: parallel_think で観点整理
- サブタスク4: 統合して記事化 file_upload`,

  "DEBUG-SKILL": `# デバッグ手法

## 系統的アプローチ
1. **再現**: エラーが出る最小コードを js_exec で試す
2. **観察**: エラーメッセージ・Stack trace・実際の出力を確認
3. **仮説**: 原因の候補を3つ挙げる
4. **検証**: 各仮説を js_exec や read_file で確認
5. **修正**: 根本原因を修正 (症状だけ消すな)
6. **回帰確認**: 修正後に動作を確認

## よくあるバグパターン
- 型不一致 (undefined/null アクセス、比較 == vs ===)
- 非同期 (Promise 忘れ、await 忘れ)
- スコープ (this、closure、hoisting)
- 境界値 (0件、1件、最大件数、負数)
- タイミング (DOM ready 前アクセス、レース)

## 報告
「原因: X。修正: Y。理由: Z。」の3点セット`,

  "REFACTOR-SKILL": `# リファクタリング原則

## 対象コードの評価軸
- 命名の明快さ
- 関数の単一責務性
- 重複の有無
- ネスト深度 (>3階層は要注意)
- 依存関係の明示性

## 一般的手法
- **抽出**: 大関数 → 意図明確な小関数群
- **命名改善**: get_x → getUserById
- **早期リターン**: else 入れ子を解消
- **定数化**: マジックナンバーに名前を
- **不変化**: mutation を最小限に

## 手順
1. read_file で対象取得
2. 問題を箇条書きで列挙
3. 改善案を提示
4. edit_file または新規 file_upload で改良版
5. 変更理由を説明`,

  "DATA-ANALYSIS-SKILL": `# データ分析フロー

## ステップ
1. **確認**: read_file/extract_data でデータ取得
2. **理解**: 行数・列数・型・欠損値・範囲
3. **分析**: js_exec で統計 (平均/中央値/分散/相関)
4. **発見**: パターン・外れ値・傾向を抽出
5. **報告**: 発見を優先度順に日本語で

## JS での CSV/JSON 処理
- CSV: split('\\n') → split(',')、ヘッダー行を分離
- 型変換: Number(), 判定 isNaN
- 統計: reduce, sort でパーセンタイル

## 結果提示
- Markdown 表で数値サマリー
- 発見 3-5 個を強調
- 「なぜそう見えるか」の解釈まで含める`,

  "API-DESIGN-SKILL": `# API 設計

## RESTful 原則
- 名詞ベース URL
- 動詞は HTTP メソッドで (GET/POST/PUT/PATCH/DELETE)
- バージョニング: /v1/...
- ネスト: 2階層まで

## HTTP ステータス
- 2xx: 成功
- 4xx: クライアントエラー
- 5xx: サーバーエラー

## レスポンス形式
data / meta / links / error の統一

## 認証
- Bearer JWT が標準
- Refresh token 分離`,

  "SYSTEM-DESIGN-SKILL": `# システム設計

## フロー
1. 要件明確化 (機能 + 非機能)
2. キャパシティ試算 (QPS/データ量/帯域)
3. API 設計
4. データモデル
5. アーキテクチャ図
6. スケーリング戦略
7. 信頼性 (冗長化・監視)

## パターン
- キャッシュ (Cache-aside 等)
- キュー (非同期・DLQ)
- ロードバランス (L4/L7)
- DB (replica/shard)
- CAP 定理`,

  "ALGORITHM-SKILL": `# アルゴリズム実装ライブラリ

## 探索
- BFS/DFS: グラフ・木の探索
- Binary Search: 単調な区間
- Dijkstra: 重み付き最短経路

## ソート・順序
- Quick/Merge: 汎用 O(N log N)
- Topological Sort: 依存順序

## DP
- メモ化 (再帰 + キャッシュ)
- Tabulation (反復)
- 典型: Knapsack, LCS, Edit Distance

## ゲームAI (要求されたら)
- Minimax + α-β 枝刈り
- 反復深化、ムーブオーダリング
- 位置評価 + 着手可能数 + 材料

## 計算量チェック
- N=10^6 まで: O(N log N)
- N=10^4 まで: O(N^2)
- N=100 まで: O(N^3)`,

  "TESTING-SKILL": `# テスト戦略

## 種類
- Unit: 純粋関数・コアロジック
- Integration: モジュール連携
- E2E: ユーザーフロー

## js_exec でのアサーション
- assert(cond, msg) パターン
- 正常系 + 境界 + 異常系

## カバーすべきケース
- 期待通りの入力
- 境界: 0, 1, 最大
- 異常: null, 型違い, 空配列
- 例外が投げられるか`,
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
// TOOLS
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
      "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
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
  const r = await fetch(url, { headers: { "User-Agent": "Orby/6.0" } });
  const j = await r.json();
  return (j.query?.search || []).map(s => ({
    title: s.title,
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`,
    snippet: s.snippet.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"'),
  }));
}

async function tool_web_search({ query, max_results = 6 }) {
  try {
    const bing = await searchBing(query, max_results);
    if (bing.length > 0) return { query, source: "bing", results: bing };
  } catch (_) {}
  try {
    const isJa = /[\u3040-\u30ff\u4e00-\u9fff]/.test(query);
    const wiki = await searchWikipedia(query, max_results, isJa ? "ja" : "en");
    if (wiki.length > 0) return { query, source: "wikipedia", results: wiki };
  } catch (_) {}
  return { query, source: "none", results: [] };
}

async function tool_html_fetch({ url, mode = "text", max_chars = 12000 }) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,*/*",
      "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
    },
    redirect: "follow", timeout: 20000,
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
    .replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "").replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
  return {
    url, status: r.status,
    title: titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "",
    text: text.slice(0, max_chars), length: text.length,
    truncated: text.length > max_chars,
  };
}

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
      logs, error: ctx.__error || null,
    };
  } catch (e) { return { ok: false, error: String(e.message || e), logs }; }
}

async function tool_load_skill(args) {
  const rawNames = args.name || args.skill || args.id || args.skill_id || args.skill_ids || args.names || args.skills;
  const list = Array.isArray(rawNames) ? rawNames : (rawNames ? [rawNames] : []);
  if (list.length === 0) return { ok: false, error: "No skill name provided", available: Object.keys(SKILLS) };
  const loaded = [], notFound = [];
  for (const n of list) {
    const key = String(n).replace(/\.md$/i, "").toUpperCase().replace(/[_\s]/g, "-");
    if (SKILLS[key]) loaded.push({ name: key, content: SKILLS[key] });
    else notFound.push(String(n));
  }
  if (loaded.length === 0) return { ok: false, error: `Unknown skill(s): ${notFound.join(", ")}`, available: Object.keys(SKILLS) };
  return { ok: true, loaded_count: loaded.length, skills: loaded, not_found: notFound.length ? notFound : undefined };
}

async function tool_parallel_think(args) {
  // Accept flexible arg names
  const prompt = args.prompt || args.question || args.query || args.text || "";
  const list = (Array.isArray(args.models) && args.models.length) ? args.models
             : ["deepseek-r1", "gpt-4", "scira-nemotron-3-super"];
  if (!prompt) return { ok: false, error: "prompt required" };

  const settled = await Promise.allSettled(list.map(m =>
    nieChat({
      model: m,
      messages: [
        { role: "system", content: "簡潔かつ専門家として日本語で回答。要点重視、300字以内。" },
        { role: "user", content: prompt },
      ],
    })
  ));
  return {
    ok: true, prompt, models_used: list,
    answers: settled.map((s, i) => ({
      model: list[i],
      profile: MODEL_PROFILE[list[i]]?.strength || "",
      ok: s.status === "fulfilled",
      content: s.status === "fulfilled"
        ? (s.value?.content || s.value?.choices?.[0]?.message?.content || "")
        : String(s.reason).slice(0, 200),
    })),
  };
}

async function tool_image_generate({ prompt, width = 1024, height = 1024, model = "flux", seed }) {
  const params = new URLSearchParams({ width: String(width), height: String(height), model, nologo: "true" });
  if (seed) params.set("seed", String(seed));
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`;
  return { url, prompt, width, height, model };
}

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

async function tool_file_upload(args) {
  const filename = args.filename || args.name || args.file_name || "output.txt";
  const content  = args.content ?? args.text ?? args.body ?? args.data ?? "";
  const mime     = args.mime || args.mime_type || args.content_type;
  const id = crypto.randomBytes(8).toString("hex");
  const m = mime || guessMime(filename);
  UPLOADED_FILES.set(id, { name: filename, content: String(content), mime: m });
  return {
    id, filename, mime: m,
    size: Buffer.byteLength(String(content), "utf8"),
    lines: (String(content).match(/\n/g) || []).length + 1,
    language: filename.split(".").pop() || "text",
    download_url: `/api/files/${id}`,
    preview_url: `/api/files/${id}?inline=1`,
  };
}

async function tool_read_file(args) {
  const id = args.attachment_id || args.id || args.file_id;
  const max_chars = Number(args.max_chars) || 30000;
  const start = Math.max(0, Number(args.start) || 0);
  if (!id) return { ok: false, error: "attachment_id required" };
  const f = ATTACHMENTS.get(id) || UPLOADED_FILES.get(id);
  if (!f) return { ok: false, error: `Unknown file: ${id}` };
  const size = f.size ?? Buffer.byteLength(f.content, "utf8");
  const slice = f.content.slice(start, start + max_chars);
  return {
    ok: true, id, filename: f.name, mime: f.mime, size,
    total_chars: f.content.length, start,
    returned_chars: slice.length,
    truncated: f.content.length > start + max_chars,
    content: slice,
  };
}

async function tool_edit_file(args) {
  const id = args.file_id || args.id;
  if (!id) return { ok: false, error: "file_id required" };
  const f = UPLOADED_FILES.get(id);
  if (!f) return { ok: false, error: `Unknown file: ${id}` };
  let newContent;
  if (args.new_content != null) newContent = String(args.new_content);
  else if (args.find != null && args.replace != null) {
    const flags = args.replace_all === false ? "" : "g";
    try {
      const re = new RegExp(args.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      newContent = f.content.replace(re, String(args.replace));
    } catch (e) { return { ok: false, error: "invalid regex: " + e.message }; }
  } else return { ok: false, error: "Provide new_content OR (find + replace)" };
  UPLOADED_FILES.set(id, { ...f, content: newContent });
  return {
    ok: true, id, filename: f.name,
    old_size: Buffer.byteLength(f.content, "utf8"),
    new_size: Buffer.byteLength(newContent, "utf8"),
    lines: (newContent.match(/\n/g) || []).length + 1,
    download_url: `/api/files/${id}`, preview_url: `/api/files/${id}?inline=1`,
  };
}

async function tool_extract_data(args) {
  const text = args.text || args.content || "";
  const format = args.format || "json";
  const results = { format, extracted: [] };
  if (format === "urls") {
    results.extracted = [...new Set(text.match(/https?:\/\/[^\s"'<>()]+/g) || [])];
  } else if (format === "numbers") {
    results.extracted = (text.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  } else if (format === "emails") {
    results.extracted = [...new Set(text.match(/[\w.-]+@[\w.-]+\.\w+/gi) || [])];
  } else if (format === "json") {
    const matches = text.match(/\{[\s\S]*?\}|\[[\s\S]*?\]/g) || [];
    for (const m of matches) { try { results.extracted.push(JSON.parse(m)); } catch (_) {} }
  } else if (format === "csv") {
    const rows = text.trim().split(/\r?\n/).map(l => l.split(","));
    results.extracted = rows; results.header = rows[0]; results.row_count = rows.length - 1;
  }
  results.count = Array.isArray(results.extracted) ? results.extracted.length : 0;
  return results;
}

async function tool_summarize(args) {
  const text = args.text || args.content || "";
  const style = args.style || "bullets";
  const max_points = args.max_points || 5;
  if (!text.trim()) return { ok: false, error: "no text" };
  const prompt = style === "tldr"
    ? `以下の文章を、日本語1文（80字以内）で要約せよ:\n\n${text.slice(0, 8000)}`
    : style === "paragraph"
    ? `以下の文章を、日本語で3-5文の段落として要約せよ:\n\n${text.slice(0, 8000)}`
    : `以下の文章を、日本語の箇条書き${max_points}項目以内で要約せよ:\n\n${text.slice(0, 8000)}`;
  try {
    const j = await nieChat({
      model: args.model || pickModelFor("summary"),
      messages: [{ role: "user", content: prompt }], temperature: 0.3,
    });
    const summary = j.content || j.choices?.[0]?.message?.content || "";
    return { ok: true, style, summary, source_chars: text.length };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

async function tool_memory_store({ key, value }) {
  if (!key) return { ok: false, error: "key required" };
  MEMORY.set(String(key), String(value));
  return { ok: true, key, stored: true, size: MEMORY.size };
}
async function tool_memory_recall({ key }) {
  if (!key) return { ok: true, keys: [...MEMORY.keys()] };
  const v = MEMORY.get(String(key));
  if (v === undefined) return { ok: false, error: `no memory for key: ${key}` };
  return { ok: true, key, value: v };
}

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
// Tool registry & aliases
// ============================================================================
const TOOLS = {
  web_search:      { run: tool_web_search },
  html_fetch:      { run: tool_html_fetch },
  js_exec:         { run: tool_js_exec },
  load_skill:      { run: tool_load_skill },
  parallel_think:  { run: tool_parallel_think },
  image_generate:  { run: tool_image_generate },
  file_upload:     { run: tool_file_upload },
  read_file:       { run: tool_read_file },
  edit_file:       { run: tool_edit_file },
  extract_data:    { run: tool_extract_data },
  summarize:       { run: tool_summarize },
  memory_store:    { run: tool_memory_store },
  memory_recall:   { run: tool_memory_recall },
  shorten_element: { run: tool_shorten_element },
};

const TOOL_ALIASES = {
  "search": "web_search", "google": "web_search", "web": "web_search", "bing": "web_search",
  "fetch": "html_fetch", "get_page": "html_fetch", "fetch_url": "html_fetch", "curl": "html_fetch", "browse": "html_fetch",
  "exec": "js_exec", "eval": "js_exec", "run_js": "js_exec", "execute": "js_exec", "run_code": "js_exec", "python": "js_exec",
  "skill": "load_skill", "get_skill": "load_skill", "read_skill": "load_skill", "skills": "load_skill", "load": "load_skill",
  "think": "parallel_think", "multi_think": "parallel_think", "consult": "parallel_think", "ask_multi": "parallel_think",
  "generate_image": "image_generate", "image": "image_generate", "img": "image_generate", "draw": "image_generate",
  "upload": "file_upload", "save_file": "file_upload", "create_file": "file_upload", "write": "file_upload", "output_file": "file_upload",
  "read": "read_file", "open_file": "read_file", "load_file": "read_file", "cat": "read_file",
  "edit": "edit_file", "update_file": "edit_file", "modify_file": "edit_file", "patch_file": "edit_file",
  "extract": "extract_data", "parse": "extract_data",
  "summary": "summarize", "tldr": "summarize", "digest": "summarize",
  "remember": "memory_store", "save": "memory_store", "store": "memory_store", "note": "memory_store",
  "recall": "memory_recall", "get_memory": "memory_recall", "read_memory": "memory_recall",
  "shorten": "shorten_element", "alias": "shorten_element",
};

// ============================================================================
// System prompt — universal, task-agnostic
// ============================================================================
function buildSystemPrompt(mainModel, attachments) {
  const attachSection = attachments && attachments.length > 0
    ? `

## 📎 添付ファイル (${attachments.length} 件)
${attachments.map(a => `- id: **${a.id}** — "${a.name}" (${a.mime}, ${a.size} bytes)`).join("\n")}

ファイル内容は read_file で読める。ユーザーの質問がファイルに関連するなら最初に読む。`
    : "";

  return `あなたは "Orby" — 汎用最強の自律型 AI エージェント。**すべての応答は日本語で。**

═══════════════════════════════════════════════════════════════
🎯 あなたの本質
═══════════════════════════════════════════════════════════════

あなたは Genspark を超える性能を目指す、あらゆるタスクに最適解を導くエージェント。

- **タスクの本質を理解する**: ユーザーが本当に求めているものを見極める
- **適切な深さで対応する**: 簡単な質問には簡潔に、複雑なタスクには徹底的に
- **道具の使い方を知る**: 各ツールを適材適所で活用
- **推論を惜しまない**: 難しい判断は parallel_think で複数モデルの知恵を借りる
- **検証を怠らない**: 事実は web_search、動作は js_exec で確認

═══════════════════════════════════════════════════════════════
🧠 タスクの進め方（フレームワーク）
═══════════════════════════════════════════════════════════════

**Step 1: タスクの複雑度を判定する**

- **軽量**: 挨拶、簡単な質問、雑談、既知の事実確認
  → ツール不要または最小限。直接答える
- **中量**: 情報収集、要約、単純な計算、簡易コード
  → 1-2ツールで完結。web_search / js_exec / image_generate 等
- **重量**: 複雑な実装、深い分析、比較検討、大規模タスク
  → 最初に parallel_think で戦略を立てる → 分解 → 実行 → 統合

**Step 2: 重量タスクなら parallel_think で戦略立案**

複雑なタスクを始める前に、以下のような prompt で複数モデルに相談:

\`\`\`tool
{"tool":"parallel_think","args":{"prompt":"「〇〇を作って」というタスクをどう進めるべきか。必要な設計判断、要素、実装ステップを整理して。","models":["deepseek-r1","gpt-4","scira-nemotron-3-super"]}}
\`\`\`

その回答を統合してから、実装ラウンドに進む。

**Step 3: 必要ならスキル読み込み**

汎用スキルが13個ある:
- UI-SKILL, CODING-SKILL, WEB-RESEARCH-SKILL, PARALLEL-THINK-SKILL, IMAGE-SKILL
- TASK-DECOMPOSITION-SKILL, DEBUG-SKILL, REFACTOR-SKILL, DATA-ANALYSIS-SKILL
- API-DESIGN-SKILL, SYSTEM-DESIGN-SKILL, ALGORITHM-SKILL, TESTING-SKILL

タスクに合わせて 1-3 個を読み込む (**単一のツール呼び出しに配列で指定可能**)。ただしこれは強制ではない。既に何を書けばいいか明確なら省略してよい。

**Step 4: 実装/実行**

- コード生成: file_upload
- 情報収集: web_search → html_fetch (並列可)
- 動作確認: js_exec
- 画像: image_generate
- ファイル解析: read_file + extract_data / summarize / js_exec

**Step 5: 検証と最終回答**

- 事実確認できるものは確認
- 生成物のリンクを示す
- 参考にしたソース URL を引用

═══════════════════════════════════════════════════════════════
🔧 ツール呼び出しプロトコル
═══════════════════════════════════════════════════════════════

\`\`\`tool
{"tool":"<name>","args":{...}}
\`\`\`

- 1ブロック=1ツール、複数並列は複数ブロックを並べる
- JSON は 1行推奨、文字列内改行は \\n でエスケープ
- 利用可能ツール (14個):
  - **web_search** {query, max_results}
  - **html_fetch** {url}
  - **js_exec** {code}
  - **load_skill** {name: string | string[]}
  - **parallel_think** {prompt, models: string[]}
  - **image_generate** {prompt, width, height}
  - **file_upload** {filename, content}
  - **read_file** {attachment_id}
  - **edit_file** {file_id, new_content | (find, replace)}
  - **extract_data** {text, format: 'urls'|'numbers'|'emails'|'json'|'csv'}
  - **summarize** {text, style: 'bullets'|'paragraph'|'tldr'}
  - **memory_store** {key, value}
  - **memory_recall** {key?}
  - **shorten_element** {name?, content}

═══════════════════════════════════════════════════════════════
💡 判断のガイドライン (タスクに縛られない汎用性)
═══════════════════════════════════════════════════════════════

あなたは以下のような様々なタスクを、それぞれに最適な方法で対応します:

- **雑談/挨拶** → ツール不要、そのまま日本語で答える
- **知識質問** → 事実確認が必要なら web_search、既知なら直答
- **意見/比較** → parallel_think で複数意見を集約
- **リサーチ** → web_search → html_fetch → 統合
- **計算/検証** → js_exec
- **画像生成** → image_generate
- **コード作成** → 規模に応じて短ければ直接返答、長ければ file_upload
- **文章作成** → 適切なモデル (バックエンドが自動選択) で本文生成
- **ファイル分析** → read_file → 分析ツール → 結果
- **難問** → parallel_think で戦略 → 実行 → 検証

**過剰なツール使用は避ける**: 「こんにちは」に対して parallel_think は不要。判断は「そのツールが本当に必要か」で決める。

═══════════════════════════════════════════════════════════════
⛔ 禁止事項
═══════════════════════════════════════════════════════════════

- **虚偽の実装宣言**: file_upload を呼ばずに「作りました」と言い、架空リンクを出す
- **推測での回答**: 事実確認できることを推測で答える
- **スキルの露出**: load_skill の内容をユーザーへの返答に貼る
- **タスク特化の思い込み**: 「オセロを作って」と言われた時に、ツールがオセロ専用に振る舞う（ゲーム用のスキルは汎用的な "GAME特有の技法" ではなく "アルゴリズム" として存在する）
- **英語の混入**: 日本語での応答を維持

═══════════════════════════════════════════════════════════════
✨ 最終回答のスタイル
═══════════════════════════════════════════════════════════════

- ツール使用が終わったら \`\`\`tool\`\`\` ブロック無しの日本語で回答
- 前置き最小限、本質から入る
- 生成物リンクは [filename](/api/files/xxx) 形式
- Web リサーチは必ずソース URL 引用
- 見た目より内容を重視するが、Markdown で構造化 (見出し・箇条書き・表)${attachSection}`;
}

// ============================================================================
// SSE + Forgiving parser
// ============================================================================
function sseSend(res, event, data) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) {}
}

function parseToolCalls(text) {
  const calls = [];
  const found = new Set();

  const addCall = (tool, args) => {
    tool = String(tool || "").toLowerCase().replace(/[_\s]+/g, "_");
    if (TOOL_ALIASES[tool]) tool = TOOL_ALIASES[tool];
    if (!TOOLS[tool]) return false;
    const fp = tool + JSON.stringify(args || {});
    if (found.has(fp)) return true;
    found.add(fp);
    calls.push({ tool, args: args || {} });
    return true;
  };

  const tryParseObj = (raw) => {
    try { return JSON.parse(raw); } catch (_) {}
    const jm = raw.match(/\{[\s\S]*\}/);
    if (jm) { try { return JSON.parse(jm[0]); } catch (_) {} }
    return null;
  };

  const extractFromParsed = (obj) => {
    if (!obj || typeof obj !== "object") return null;
    let tool = obj.tool || obj.name || obj.tool_name || obj.function || obj.action;
    let args = obj.args || obj.arguments || obj.parameters || obj.params || obj.input || obj;
    if (args === obj) { const { tool: _t, name: _n, ...rest } = obj; args = rest; }
    return { tool, args };
  };

  const fenceRe = /```(?:tool|json)?\s*\n?([\s\S]*?)\n?```/g;
  let m;
  while ((m = fenceRe.exec(text))) {
    const raw = m[1].trim();
    if (!raw) continue;
    const obj = tryParseObj(raw);
    if (!obj) continue;
    const extracted = extractFromParsed(obj);
    if (extracted && extracted.tool) addCall(extracted.tool, extracted.args);
  }

  const startRe = /\{\s*"(?:tool|name|action)"\s*:/g;
  let sm;
  while ((sm = startRe.exec(text))) {
    const before = text.slice(Math.max(0, sm.index - 20), sm.index);
    if (before.endsWith("```tool\n") || before.endsWith("```json\n")) continue;
    let depth = 0, end = -1, inString = false, escape = false;
    for (let i = sm.index; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) continue;
    const raw = text.slice(sm.index, end + 1);
    const obj = tryParseObj(raw);
    if (!obj) continue;
    const extracted = extractFromParsed(obj);
    if (extracted && extracted.tool) addCall(extracted.tool, extracted.args);
  }
  return calls;
}

function stripToolBlocks(text) {
  let s = text.replace(/```(?:tool|json)\s*[\s\S]*?```/g, "");
  const startRe = /\{\s*"(?:tool|name|action)"\s*:/g;
  const removeRanges = [];
  let sm;
  while ((sm = startRe.exec(s))) {
    let depth = 0, end = -1, inString = false, escape = false;
    for (let i = sm.index; i < s.length; i++) {
      const ch = s[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end > 0) removeRanges.push([sm.index, end + 1]);
  }
  for (const [a, b] of removeRanges.reverse()) s = s.slice(0, a) + s.slice(b);
  return s.trim();
}

// ============================================================================
// Task complexity classifier & model routing
// ============================================================================
function classifyTask(userMessage, conversationContext) {
  const msg = String(userMessage || "");
  const ctx = String(conversationContext || "");

  // 0. Trivial / greetings / very short → chat (fast model, no over-engineering)
  if (msg.trim().length < 15 && !/(?:作って|make|build|create|write|implement|実装|書いて|分析)/i.test(msg)) {
    return "chat";
  }

  // 1. Research / info-seeking → keep default (fast) model
  // These words indicate the user wants information, not code
  const infoSeeking = /(?:について|とは|教えて|何|なに|どう|なぜ|いつ|誰|最新|最近|ニュース|情報|調べて|検索|what is|tell me|latest|news|explain)/i;
  if (infoSeeking.test(msg) && !/(?:作って|実装|書いて|コード|生成して|make|build|write|create.*(?:code|app|html))/i.test(msg)) {
    return "chat"; // Research handled with default model + tool chain
  }

  // 2. Large code generation — must be explicit "make/build/write"
  // "作って" alone doesn't qualify; must combine with an artifact keyword
  const codeCreateVerbs = /(?:作って|作成して|実装して|書いて|生成して|コード化|make|build|create|write|implement|generate)/i;
  const codeArtifacts = /(?:アプリ|サイト|ページ|ゲーム|ツール|エディタ|エディター|ダッシュボード|コード|html|css|javascript|プログラム|スクリプト|component|app|website|tool|game|editor|dashboard|program|script)/i;
  if (codeCreateVerbs.test(msg) && codeArtifacts.test(msg)) return "code_large";
  if (/index\.html|単体で|single.*file|full.*app/i.test(msg)) return "code_large";

  // 3. Reasoning / comparison
  if (/(?:比較|どちらが|どれが|選定|意思決定|判断|vs\.?|versus|choose.*between)/i.test(msg)) return "reasoning";

  // 4. Analysis (depth requested)
  if (/(?:分析|解析|徹底的|comprehensive|analyze in depth|deep.*analysis)/i.test(msg)) return "analysis";

  // 5. Summary
  if (/(?:要約|まとめて|tldr|3行で|一行で|summarize)/i.test(msg)) return "summary";

  // Context signals — if we've already loaded coding skills and asked for file_upload
  if (/CODING-SKILL|GAME-DEV-SKILL|SYSTEM-DESIGN-SKILL/i.test(ctx) && /file_upload/i.test(ctx)) return "code_large";

  return "chat";
}

// ============================================================================
// User upload endpoints
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
app.delete("/api/upload/:id", (req, res) => { ATTACHMENTS.delete(req.params.id); res.json({ ok: true }); });

// ============================================================================
// /api/agent — the main endpoint
// ============================================================================
app.post("/api/agent", async (req, res) => {
  const { messages = [], model = DEFAULT_MODEL, max_rounds = 12, attachments = [] } = req.body || {};

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders && res.flushHeaders();

  const isClosed = () => res.writableEnded || res.destroyed;

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

[Orby として日本語で応答。タスクの複雑度に応じて適切にツールを使い分ける。単純な質問なら直接答え、複雑なタスクなら parallel_think で戦略を立ててから実行。]`
    };
  }

  const convo = [sys, ...userMsgs];
  const originalUserMsg = messages[messages.length - 1]?.content || "";
  let finalEmitted = false;

  try {
    for (let round = 1; round <= max_rounds; round++) {
      if (isClosed()) break;
      sseSend(res, "round", { round });

      // Classify task and route model
      const contextSoFar = convo.slice(-4).map(m => typeof m.content === "string" ? m.content : "").join("\n");
      const category = classifyTask(originalUserMsg, contextSoFar);

      // Model selection strategy:
      // - code_large / analysis: always route to specialized model (even round 1) because
      //   default model can't output enough bytes for these tasks
      // - Other categories on round 1: respect user's model choice
      // - Round 2+: route by category dynamically
      let effectiveModel;
      if (category === "code_large" || category === "analysis") {
        effectiveModel = pickModelFor(category);
      } else if (round === 1) {
        effectiveModel = model;
      } else {
        effectiveModel = pickModelFor(category);
      }

      sseSend(res, "assistant_start", { round, model_used: effectiveModel, category });

      let streamedText = "";
      try {
        streamedText = await nieChatStream(
          { model: effectiveModel, messages: convo, temperature: 0.6 },
          (delta) => sseSend(res, "assistant_delta", { text: delta })
        );
      } catch (_) {}

      // Detect problems
      const knownToolNames = new Set([...Object.keys(TOOLS), ...Object.keys(TOOL_ALIASES)]);
      const toolNameMatches = [...streamedText.matchAll(/```(?:tool|json)?\s*\n?\s*\{\s*"(?:tool|name|action)"\s*:\s*"([^"]+)"/g)].map(m => m[1].toLowerCase());
      const hasInvalidToolName = toolNameMatches.length > 0 && toolNameMatches.every(n => !knownToolNames.has(n));
      const looksTruncated =
        !streamedText || !streamedText.trim() ||
        (streamedText.match(/```tool/g) || []).length > (streamedText.match(/```tool[\s\S]*?```/g) || []).length ||
        hasInvalidToolName;

      let assistantText = streamedText;
      if (looksTruncated) {
        const escalationChain = hasInvalidToolName
          ? ["felo-chat", "gpt-4o", "scira-nemotron-3-super"]
          : [effectiveModel, "felo-chat", "scira-nemotron-3-super"];
        for (const alt of escalationChain) {
          try {
            const j = await nieChat({ model: alt, messages: convo, temperature: 0.6 });
            const full = j.content || j.choices?.[0]?.message?.content || "";
            if (full && full.trim()) {
              const altNames = [...full.matchAll(/```(?:tool|json)?\s*\n?\s*\{\s*"(?:tool|name|action)"\s*:\s*"([^"]+)"/g)].map(m => m[1].toLowerCase());
              const altInvalid = altNames.length > 0 && altNames.every(n => !knownToolNames.has(n));
              if (altInvalid) continue;
              sseSend(res, "assistant_reset", {});
              sseSend(res, "assistant_delta", { text: full });
              assistantText = full;
              break;
            }
          } catch (_) {}
        }
      }

      sseSend(res, "assistant_end", { round });

      const calls = parseToolCalls(assistantText);
      convo.push({ role: "assistant", content: assistantText || " " });

      if (calls.length === 0) {
        // Detect hallucinated file links
        const finalText = stripToolBlocks(assistantText);
        const claimsFile = /\/api\/files\/[a-zA-Z0-9_.-]+/.test(finalText);
        const realIds = new Set([...UPLOADED_FILES.keys()]);
        const referencedRealIds = [...finalText.matchAll(/\/api\/files\/([a-f0-9]{16})/g)].map(m => m[1]);
        const allRealRefs = referencedRealIds.length > 0 && referencedRealIds.every(id => realIds.has(id));

        if (claimsFile && !allRealRefs) {
          sseSend(res, "assistant_reset", {});
          sseSend(res, "assistant_delta", { text: "[修正中: 実際にファイルを作成します...]" });
          convo.push({
            role: "user",
            content: `架空のファイルリンクが含まれています。file_upload ツールを実際に呼び出してファイルを作成してください:\n\n\`\`\`tool\n{"tool":"file_upload","args":{"filename":"...","content":"...(実コード)..."}}\n\`\`\`\n\nツール結果から得た本物の URL のみ使用してください。`
          });
          continue;
        }

        sseSend(res, "final", { text: finalText });
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
        try { resStr = JSON.stringify(r.result, null, 2); } catch { resStr = String(r.result); }
        if (resStr.length > 8000) resStr = resStr.slice(0, 8000) + "\n... (truncated)";
        return "```tool_result\ntool: " + r.tool + "\nargs: " + JSON.stringify(r.args) + "\nresult:\n" + resStr + "\n```";
      }).join("\n\n");

      // Determine next step nudge based on tool results
      const used = new Set(results.map(r => r.tool));
      let nudge = "";

      if (used.has("web_search") && !used.has("html_fetch")) {
        const sr = results.find(r => r.tool === "web_search")?.result;
        const urls = (sr?.results || []).slice(0, 3).map(r => r.url);
        nudge = `

[次のステップ] 検索結果から重要な URL を並列で html_fetch すると回答が深くなります。同一ラウンドで複数の \`\`\`tool\`\`\` ブロックを並べれば並列実行されます。

URL 候補:
${urls.map((u, i) => `${i+1}. ${u}`).join("\n")}

ただし、検索スニペットで既に十分な情報があるなら html_fetch をスキップして最終回答へ。`;
      } else if (used.has("parallel_think") && !used.has("file_upload") && !used.has("web_search")) {
        nudge = `

[次のステップ] 複数モデルの意見を得ました。これらを統合してタスクを実行してください:
- コード生成なら file_upload
- 情報が足りなければ web_search
- 十分なら最終回答を日本語で`;
      } else if (used.has("load_skill") && !used.has("file_upload") && !used.has("parallel_think")) {
        nudge = `

[次のステップ] スキル内容を参考にタスクを実行してください。コード生成なら file_upload を呼び出し、実際にファイルを作成する。スキル内容自体はユーザーに露出しないで。`;
      } else {
        nudge = `

[次のステップ] タスクが完了したなら日本語で最終回答を。まだ必要な作業があるなら次のツールを呼び出す。`;
      }

      convo.push({ role: "user", content: feedback + nudge });

      if (round === max_rounds && !finalEmitted) {
        sseSend(res, "round", { round: round + 1, forced: true });
        try {
          convo.push({ role: "user", content: "[最大ラウンド到達。最終回答を日本語で。]" });
          const j = await nieChat({ model: pickModelFor("chat"), messages: convo, temperature: 0.4 });
          const finalText = stripToolBlocks(j.content || j.choices?.[0]?.message?.content || "");
          sseSend(res, "assistant_start", { round: round + 1 });
          sseSend(res, "assistant_delta", { text: finalText });
          sseSend(res, "assistant_end", { round: round + 1 });
          sseSend(res, "final", { text: finalText });
          finalEmitted = true;
        } catch (_) { sseSend(res, "final", { text: "（最大ラウンド到達）" }); }
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
// Endpoints
// ============================================================================
app.get("/api/upstream-models", async (_req, res) => {
  try {
    const r = await fetch(`${NIE_BASE}/models`);
    const j = await r.json();
    const seen = new Set(); const models = [];
    for (const m of (j.data || [])) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      models.push({ id: m.id, provider: m.provider || m.owned_by, description: m.description });
    }
    res.json({ models });
  } catch (e) { res.status(502).json({ error: String(e.message || e), models: [] }); }
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
  res.json({
    ok: true, service: "orby", version: "6.0.0",
    default_model: DEFAULT_MODEL,
    tools: Object.keys(TOOLS), skills: Object.keys(SKILLS),
    model_profiles: MODEL_PROFILE,
  });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Orby v6 running on http://localhost:${PORT}`));
}
module.exports = app;
