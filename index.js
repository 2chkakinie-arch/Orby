// ============================================================================
// Orby v5 — Autonomous Coding Agent Backend (Production-grade)
// - Default model: scira-gemini-3.1-flash-lite
// - Forgiving tool-call parser (recovers from malformed JSON, wrong keys, aliases)
// - 13 world-class skills with deep implementation knowledge
// - 13 tools: web_search, html_fetch, js_exec, load_skill, parallel_think,
//             image_generate, file_upload, read_file, edit_file, extract_data,
//             summarize, memory_store, memory_recall
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
const MEMORY = new Map(); // simple key→value long-term memory

// ============================================================================
// SKILLS — 13 world-class skills with deep implementation knowledge
// ============================================================================
const SKILLS = {
  "UI-SKILL": `# UI/UX 設計スキル（世界水準）

## 基本原則
- 常にダークテーマを基本とし、単色（黒/白/グレー）+ 1色のシグネチャーアクセント
- 8pxグリッド、150ms cubic-bezier(.4,0,.2,1) トランジション
- ボーダー: 1px rgba(255,255,255,.08) / rgba(255,255,255,.14) / rgba(255,255,255,.22)
- 角丸: カード14px、ボタン10px、チップ8px
- タイポグラフィ: system-ui スタック、タイトルはtracking-tight（-.02em）

## カラーパレット（洗練された配色）
- 主色: #0a0a0a → #16161a → #22222e (階層的な暗さ)
- テキスト: #f5f5f6 (メイン) → #a1a1aa (2次) → #6b6b7a (3次)
- アクセント推奨: 紫系 #a78bfa→#7c3aed (Claude風) / 青系 #60a5fa→#2563eb (Genspark風) / 緑系 #4ade80→#16a34a (Vercel風)
- 意味色: 成功 #4ade80 / 警告 #fbbf24 / エラー #f87171 / 情報 #60a5fa

## マイクロインタラクション
- hover時: transform: translateY(-1px) + border-color 変化
- active時: transform: scale(.98)
- フォーカス: box-shadow: 0 0 0 3px アクセント色の 8% 透明版
- 送信ボタンなどのCTAには 0 6-8px 20px アクセント色の 25% でグロー

## レイアウト
- CSS Grid/Flex を優先。positioning tricks は避ける
- max-width 800px程度でchat類のリーダビリティ確保
- モバイル対応は 100dvh + viewport-fit=cover
- 固定要素の下に配置される要素には padding-bottom で clearance を絶対値で確保（重なりバグ根絶）

## タイポグラフィ階層
- H1: 34-36px / 700 / -.028em
- H2: 24-28px / 600 / -.02em
- H3: 18-20px / 600 / -.015em
- Body: 14.5px / 400 / line-height 1.65-1.72
- Caption: 11-12px / 500 / letter-spacing .05em uppercase (時々)
- Mono: 12-13px / ui-monospace

## 禁止事項
- 虹色的な多色使い / 派手なグラデ乱用
- ボーダーレスの単調フラット / 逆に線多すぎ
- 装飾的アニメーション（実用性のないもの）
- 全角記号の乱用`,

  "CODING-SKILL": `# コーディング・スキル（本気の実装）

## 絶対ルール
- **本番グレードのコードのみ**。手抜きコード・プレースホルダー・「// TODO」禁止
- エッジケース処理を最初に書く（null/undefined/空配列/例外）
- モダン ES2022+ / Python 3.11+ / TypeScript strict モード相当
- **自己文書化された命名**。コメントは「なぜ」を書き「何を」は書かない
- 依存最小主義。標準ライブラリ優先、外部CDN禁止（要求されない限り）

## 単一ファイル HTML アプリの作法
- 最低300行 / 8KB以上を目標。それ以下は「手抜き」と判定される
- 完全な CSS: リセット→変数→レイアウト→コンポーネント→ユーティリティ
- 完全な JS: state → view → logic → event bindings
- ダークテーマ + アクセント色 + 洗練された余白
- キーボード操作対応（Enter/Escape/矢印キー等）
- 読みやすい非同期パターン: async/await 優先、Promise chain は避ける
- エラーハンドリング: try/catch + ユーザーへの視覚フィードバック

## コード生成前チェックリスト
1. 完成したコードを頭の中で最初から最後まで実行し、バグを検出したか？
2. UIは実際に触って気持ちよいか？（アニメーション、フィードバック）
3. モバイル対応は？（タッチイベント、ビューポート）
4. 30行未満の "サンプル" ではなく、本物として動く物になっているか？
5. 大規模なら必ず file_upload で提供、チャットに丸ごと貼らない

## 品質基準（このどれかを満たさないなら再生成せよ）
- コードが動作する（js_exec で確認できるものは確認）
- 見た目が洗練されている（UI-SKILL 準拠）
- インタラクションが自然
- コメントが必要な箇所には配置されている`,

  "GAME-DEV-SKILL": `# ゲーム開発スキル（単一HTML）— 本物のゲームだけ作る

## 絶対要件
- **最低400行以上、10KB以上のコード**（オセロ・チェスなら500行以上）
- 60fps を維持する requestAnimationFrame + delta-time ループ
- 状態管理・更新・描画を明確に分離
- 入力: キーボード + マウス + タッチ すべて対応
- 完全オフライン、CDN禁止

## オセロ（リバーシ）実装の完全仕様
必須機能:
1. **8x8ボード**を Canvas または CSS Grid で描画
2. **有効手ハイライト**（現在の手番で置ける場所を薄い色で表示）
3. **駒返しアニメーション**（0.4秒程度でフリップ）
4. **α-β枝刈り付きミニマックス AI**
   - Easy: 深さ2
   - Normal: 深さ4 + 位置評価
   - Hard: 深さ6 + 反復深化 + 位置評価 + 着手可能数 + 石差の重み付き総合
5. **位置評価テーブル** (角:100, 角隣:-25, 辺:5, X-square:-40 等の重み)
6. **スコア表示** (黒/白の石数リアルタイム)
7. **難易度選択**（ドロップダウンかボタン）
8. **リセット/新しいゲームボタン**
9. **パス処理**（両者とも置けなくなるまで）
10. **ゲーム終了判定と勝敗表示**
11. **ヒント機能**（オプション）
12. **打った手の履歴表示**（オプション）
13. **手番インジケーター**

## デザイン品質
- **ボード**: 落ち着いた深緑 (#1a5f3f 等)、または木目調、間の線
- **駒**: グラデーション + 光沢 + 影 (放射グラデで立体感)
- **UI**: サイドパネルにスコア/難易度/リセット、下部にステータス
- **アニメ**: 駒配置時にスケール pop、返し時にフリップ、ホバー時にプレビュー

## 禁止コード例（絶対にこういう手抜きは出すな）
\`\`\`html
<!-- 悪い例: 100行以下、CSS 5行、AIロジックなし、駒返しなし -->
<style>body{background:#2c3e50}#board{display:grid...}</style>
<script>let board=Array(8).fill(0).map(()=>Array(8).fill(0));</script>
\`\`\`
これは AI オセロではなく「ボードを描画しただけの物体」。**絶対にこのレベルのコードを出すな**。

## 良い例のスケッチ
- CSS 60行以上（変数、リセット、レイアウト、アニメーション、レスポンシブ）
- JS 300行以上（状態、描画、有効手計算、駒返し、AI、UI更新、イベント）
- HTML 40行以上（複数のUI要素、コントロール、情報表示）`,

  "WEB-RESEARCH-SKILL": `# Web リサーチ・スキル

## 基本フロー
1. web_search でトピック検索（年号を含める：時事なら "2026" 等）
2. 結果から権威あるソース 1-3 件を選ぶ
3. **並列で** html_fetch × 複数（同一ラウンドで複数ブロック）
4. 2ソース以上でクロス検証
5. 引用付きで日本語回答

## 権威あるソースの見分け方
- 公式ドキュメント（〜.dev, 〜.org 等）
- 大手技術メディア (TechCrunch, Ars Technica, The Verge 等)
- 学術サイト (arxiv.org, papers, scholar)
- GitHub 公式リポジトリ
- Wikipedia (フォールバック)

避けるべき: SEO低品質サイト、広告だらけのブログ、生成AIが書いたっぽい内容

## 引用形式
- 本文中: 「〜という事実がある[[React公式](https://react.dev/blog/...)]」
- 末尾: **## 参考** セクションでリスト化

## 深掘り例
質問「React 19 の主要機能」
→ web_search "React 19 features"
→ html_fetch (react.dev/blog/react-19)
→ html_fetch (残り2件を並列取得)
→ 各記事から具体的な機能名・コード例を抽出
→ Actions, useOptimistic, Server Components 等を実例付き解説`,

  "PARALLEL-THINK-SKILL": `# 並列思考スキル

## 適用ケース
- **アーキテクチャ選定**: マイクロサービス vs モノリス
- **技術選定**: Rust vs Go, Vue vs React
- **設計上の判断**: DB 正規化度、キャッシュ戦略、認証方式
- **主観的判断**: どのUIパターンがユーザーフレンドリー？
- **難問**: アルゴリズム設計、複雑な最適化

## 使うモデル
- scira-nemotron-3-super (NVIDIA - 深い技術理解)
- gpt-4 (OpenAI - バランス)
- deepseek-r1 (推論特化)

## プロンプト設計
- 質問を明確に絞る（1つの争点にフォーカス）
- 「以下の観点で答えて」と観点を列挙: 性能、開発速度、エコシステム、学習コスト
- 200 words 以内と指定

## 統合の仕方
- 各モデルの**共通点**を抽出（強い信頼性）
- **相違点**を明示（意見が割れる = 難しい問題）
- 最鋭い理由付けを持つモデルを引用
- 単純な平均化はダメ（意見の質を評価せよ）`,

  "IMAGE-SKILL": `# 画像生成スキル

## プロンプト構成の公式
[主題] + [スタイル] + [ライティング] + [構図] + [カメラ的詳細] + [雰囲気]

例: "Tokyo Tower at magical dusk, cinematic realism, warm golden hour lighting with soft neon accents, low-angle wide composition, shallow depth of field 35mm, ethereal fantasy atmosphere"

## スタイル語彙
- Realism系: cinematic realism, photorealistic, film photography, editorial
- Illustration系: watercolor, ink wash, comic book, anime cel-shaded
- 3D系: octane render, unreal engine, cinema 4d, blender
- 芸術系: oil painting, art nouveau, cyberpunk aesthetic, minimal geometric

## ライティング語彙
- golden hour, blue hour, moonlight, neon glow, volumetric lighting, rim lighting, chiaroscuro

## サイズ選択
- SNS 縦: 1024x1536 (2:3)
- SNS 正方: 1024x1024
- 横長ワイド: 1536x1024 (3:2)
- ヒーロー画像: 2048x1024 (2:1)

## 埋め込み方
markdown で: ![説明](URL)
Pollinations の URL はそのまま使える`,

  "REFACTOR-SKILL": `# リファクタリング・スキル

## 段階
1. **読解**: read_file で対象コードを取得
2. **問題特定**: 
   - 命名の悪さ
   - 責務が肥大した関数（>50行）
   - 重複コード
   - マジックナンバー / マジックストリング
   - ネスト深すぎ (>3階層)
   - Optional Chaining/Null 処理漏れ
3. **改善案立案**: 各問題への具体的手法
4. **リファクタリング実施**: edit_file または file_upload で改良版

## 一般的な改善パターン
- **抽出**: 大関数 → 意図が明確な小関数群
- **命名**: get_x → getUserById, tmp → currentSelection
- **早期リターン**: else の入れ子を解消
- **定数化**: マジックナンバー → 名前付き定数
- **型付け**: JSDoc または TypeScript
- **エラー処理**: throw new SpecificError()

## 前後比較の提示
"変更前:" コードブロック → "変更後:" コードブロック → "変更理由:" 箇条書き`,

  "DEBUG-SKILL": `# デバッグ・スキル

## 系統的アプローチ
1. **再現**: エラーが出る最小コードを js_exec で試す
2. **仮説**: 何が起きているか3つ仮説を立てる
3. **検証**: 各仮説を js_exec で1つずつ検証
4. **修正**: 根本原因を修正（症状だけを消すな）
5. **回帰テスト**: 修正後にも js_exec で動作確認

## よくあるバグパターン
- **JS**: undefined プロパティアクセス、非同期の Promise 忘れ、this 束縛、比較 == vs ===
- **CSS**: box-sizing 忘れ、z-index の stacking context、flex/grid の overflow
- **HTML**: id 重複、iframe sandbox 属性、CORS
- **論理**: off-by-one、境界条件（0件、1件、最大件数）
- **タイミング**: レースコンディション、DOM ready 前アクセス

## エラーメッセージ読解
- Stack trace の最上段が発生源
- "Cannot read property 'x' of undefined" → 直前の値が null/undefined
- "Maximum call stack" → 無限再帰
- "SyntaxError" → 括弧・引用符の対応

## 修正前後の動作説明
「バグ原因: X。修正: Y。理由: Z。」の3点セットで報告`,

  "API-DESIGN-SKILL": `# API 設計スキル

## RESTful 原則
- 名詞ベースのURL（動詞は HTTP メソッドで）
- GET /users, POST /users, GET /users/:id, PUT /users/:id, DELETE /users/:id
- ネスト: /users/:id/posts (2階層まで)
- **バージョニング**: /v1/users, /v2/users

## HTTP ステータス
- 200 OK / 201 Created / 204 No Content
- 400 Bad Request / 401 Unauthorized / 403 Forbidden / 404 Not Found / 409 Conflict
- 422 Unprocessable Entity (validation)
- 429 Too Many Requests (rate limit)
- 500 Internal Server Error / 502 Bad Gateway / 503 Service Unavailable

## レスポンス形式
\`\`\`json
{ "data": {...}, "meta": {"page":1,"total":100}, "links": {"next":"..."} }
\`\`\`
エラー:
\`\`\`json
{ "error": {"code":"VALIDATION_ERROR","message":"...","field":"email"} }
\`\`\`

## 認証
- Bearer JWT が標準
- ヘッダー: Authorization: Bearer <token>
- Refresh token 分離

## ドキュメント
- OpenAPI 3.0 (Swagger) スキーマ
- リクエスト/レスポンス例を必ず添付`,

  "DATA-ANALYSIS-SKILL": `# データ分析スキル

## フロー
1. **確認**: read_file/extract_data でデータ取得、先頭数行を確認
2. **理解**: カラム数、行数、型、欠損値、範囲
3. **可視化**: js_exec で簡易統計（平均、中央値、標準偏差）
4. **解釈**: パターン、外れ値、傾向を発見
5. **報告**: 発見を優先度順に日本語で

## JSON/CSV 処理
\`\`\`js
// CSV parse (simple)
const rows = csv.trim().split('\\n').map(l => l.split(','));
const header = rows[0], data = rows.slice(1);

// 統計
const nums = data.map(r => Number(r[colIdx])).filter(n => !isNaN(n));
const avg = nums.reduce((a,b)=>a+b,0) / nums.length;
const sorted = [...nums].sort((a,b)=>a-b);
const median = sorted[Math.floor(sorted.length/2)];
\`\`\`

## 表示テクニック
- Markdown テーブルで結果まとめ
- 大きい数値はカンマ区切り、パーセントは％付き
- 発見は上位3-5個を強調
- 「なぜ」を含めて解釈（ただの数字提示ではダメ）`,

  "SYSTEM-DESIGN-SKILL": `# システム設計スキル

## 大規模設計フロー
1. **要件明確化**: 機能要件 + 非機能要件（負荷、可用性、レイテンシ）
2. **キャパシティ**: QPS、データ量、帯域幅の概算
3. **API 設計**: 主要エンドポイント
4. **データモデル**: スキーマ、インデックス、正規化度
5. **アーキテクチャ**: コンポーネント図、通信パターン
6. **スケーリング**: シャーディング、キャッシュ、CDN
7. **信頼性**: 冗長化、フェイルオーバー、モニタリング

## 定番パターン
- **キャッシュ**: Cache-aside, Write-through, Write-behind
- **キュー**: 非同期処理、バックプレッシャー、DLQ
- **ロードバランス**: L4 vs L7, sticky session
- **DB**: read replica, master-slave, master-master, sharding
- **CAP**: 3つのうち2つ選ぶ (CP or AP)

## 図解のASCII/mermaid
mermaid graph TD で書ける場合はそれで表現：
\`\`\`
graph TD
  Client --> LB[Load Balancer]
  LB --> API1[API Server 1]
  LB --> API2[API Server 2]
  API1 --> Cache[(Redis)]
  API1 --> DB[(PostgreSQL)]
\`\`\``,

  "ALGORITHM-SKILL": `# アルゴリズム・スキル

## よく必要になるアルゴリズムと実装
- **探索**: DFS/BFS, Binary Search, Dijkstra
- **ソート**: Quick/Merge/Heap, Topological
- **DP**: メモ化、Knapsack, LCS, Edit Distance
- **グラフ**: MST (Kruskal/Prim), Bellman-Ford, Union-Find
- **ゲームAI**: Minimax + α-β pruning, MCTS
- **文字列**: KMP, Rabin-Karp, Trie
- **数値**: GCD, Sieve, Modular arithmetic

## Minimax + α-β pruning 実装テンプレート (ゲームAI必須)
\`\`\`js
function minimax(state, depth, alpha, beta, maximizing) {
  if (depth === 0 || isTerminal(state)) return evaluate(state);
  const moves = generateMoves(state, maximizing ? PLAYER : OPPONENT);
  if (maximizing) {
    let value = -Infinity;
    for (const m of moves) {
      value = Math.max(value, minimax(applyMove(state, m), depth-1, alpha, beta, false));
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break; // β cutoff
    }
    return value;
  } else {
    let value = Infinity;
    for (const m of moves) {
      value = Math.min(value, minimax(applyMove(state, m), depth-1, alpha, beta, true));
      beta = Math.min(beta, value);
      if (alpha >= beta) break; // α cutoff
    }
    return value;
  }
}
// ムーブオーダリング（角優先など）で更に高速化
\`\`\`

## 計算量
- 実装前に必ず時間・空間計算量を評価
- N=10^6 なら O(N log N) まで、O(N^2) は 10^4 まで`,

  "TESTING-SKILL": `# テスト・スキル

## テスト戦略
- **ユニットテスト**: 純粋関数、コアロジック
- **統合テスト**: モジュール間の連携
- **E2Eテスト**: ユーザーフロー全体

## js_exec で軽量テスト
\`\`\`js
function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("OK: " + msg);
}
// テスト対象
function add(a,b) { return a+b; }
// テスト
assert(add(1,2) === 3, "add positives");
assert(add(-1,1) === 0, "add negative + positive");
assert(add(0,0) === 0, "add zeros");
\`\`\`

## テストケース設計
- 正常系: 想定通りの入力
- 境界: 0, 1, 最大値
- 異常系: null, undefined, 型違い, 空配列
- エラー: 例外が正しく投げられるか`,
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
// Tools
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
  const r = await fetch(url, { headers: { "User-Agent": "Orby/5.0" } });
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
    if (wiki.length > 0) return { query, source: "wikipedia", results: wiki, note: "Bing empty" };
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
    text: text.slice(0, max_chars),
    length: text.length, truncated: text.length > max_chars,
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
  // Robust: accept name, skill, id, skill_id, skill_ids, names
  const rawNames = args.name || args.skill || args.id || args.skill_id || args.skill_ids || args.names || args.skills;
  const list = Array.isArray(rawNames) ? rawNames : (rawNames ? [rawNames] : []);
  if (list.length === 0) {
    return { ok: false, error: "No skill name provided", available: Object.keys(SKILLS) };
  }
  const loaded = [];
  const notFound = [];
  for (const n of list) {
    const key = String(n).replace(/\.md$/i, "").toUpperCase().replace(/[_\s]/g, "-");
    const content = SKILLS[key];
    if (content) loaded.push({ name: key, content });
    else notFound.push(String(n));
  }
  if (loaded.length === 0) {
    return { ok: false, error: `Unknown skill(s): ${notFound.join(", ")}`, available: Object.keys(SKILLS) };
  }
  return {
    ok: true,
    loaded_count: loaded.length,
    skills: loaded,
    not_found: notFound.length ? notFound : undefined,
  };
}

async function tool_parallel_think({ prompt, models }) {
  const list = (models && models.length) ? models : ["scira-nemotron-3-super", "gpt-4", "deepseek-r1"];
  const settled = await Promise.allSettled(list.map(m =>
    nieChat({
      model: m,
      messages: [
        { role: "system", content: "簡潔かつ専門家として答える。要点重視、200 words 以内。" },
        { role: "user", content: prompt },
      ],
    })
  ));
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
  // Accept filename/name/file_name, content/text/body
  const filename = args.filename || args.name || args.file_name || "output.txt";
  const content = args.content ?? args.text ?? args.body ?? args.data ?? "";
  const mime = args.mime || args.mime_type || args.content_type;
  const id = crypto.randomBytes(8).toString("hex");
  const m = mime || guessMime(filename);
  UPLOADED_FILES.set(id, { name: filename, content: String(content), mime: m });
  const bytes = Buffer.byteLength(String(content), "utf8");
  return {
    id, filename, mime: m,
    size: bytes,
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
  // Edit an existing generated file (file_upload'd) with find/replace or full rewrite
  const id = args.file_id || args.id;
  if (!id) return { ok: false, error: "file_id required" };
  const f = UPLOADED_FILES.get(id);
  if (!f) return { ok: false, error: `Unknown file: ${id}` };
  let newContent;
  if (args.new_content != null) {
    newContent = String(args.new_content);
  } else if (args.find != null && args.replace != null) {
    const flags = args.replace_all === false ? "" : "g";
    try {
      const re = new RegExp(args.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      newContent = f.content.replace(re, String(args.replace));
    } catch (e) { return { ok: false, error: "invalid regex: " + e.message }; }
  } else {
    return { ok: false, error: "Provide new_content OR (find + replace)" };
  }
  UPLOADED_FILES.set(id, { ...f, content: newContent });
  return {
    ok: true, id, filename: f.name,
    old_size: Buffer.byteLength(f.content, "utf8"),
    new_size: Buffer.byteLength(newContent, "utf8"),
    lines: (newContent.match(/\n/g) || []).length + 1,
    download_url: `/api/files/${id}`,
    preview_url: `/api/files/${id}?inline=1`,
  };
}

async function tool_extract_data(args) {
  const text = args.text || args.content || "";
  const format = args.format || "json"; // json|csv|urls|numbers|emails
  const results = { format, extracted: [] };
  if (format === "urls") {
    results.extracted = [...new Set(text.match(/https?:\/\/[^\s"'<>()]+/g) || [])];
  } else if (format === "numbers") {
    results.extracted = (text.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  } else if (format === "emails") {
    results.extracted = [...new Set(text.match(/[\w.-]+@[\w.-]+\.\w+/gi) || [])];
  } else if (format === "json") {
    const matches = text.match(/\{[\s\S]*?\}|\[[\s\S]*?\]/g) || [];
    for (const m of matches) {
      try { results.extracted.push(JSON.parse(m)); } catch (_) {}
    }
  } else if (format === "csv") {
    const rows = text.trim().split(/\r?\n/).map(l => l.split(","));
    results.extracted = rows;
    results.header = rows[0];
    results.row_count = rows.length - 1;
  }
  results.count = Array.isArray(results.extracted) ? results.extracted.length : 0;
  return results;
}

async function tool_summarize(args) {
  const text = args.text || args.content || "";
  const style = args.style || "bullets"; // bullets|paragraph|tldr
  const max_points = args.max_points || 5;
  if (!text.trim()) return { ok: false, error: "no text" };
  // Use lightweight model for summarization
  const prompt = style === "tldr"
    ? `以下の文章を、日本語1文（80字以内）で要約せよ:\n\n${text.slice(0, 8000)}`
    : style === "paragraph"
    ? `以下の文章を、日本語で3-5文の段落として要約せよ:\n\n${text.slice(0, 8000)}`
    : `以下の文章を、日本語の箇条書き${max_points}項目以内で要約せよ。各項目は1行:\n\n${text.slice(0, 8000)}`;
  try {
    const j = await nieChat({
      model: args.model || "scira-gemini-3.1-flash-lite",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
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
  if (!key) {
    return { ok: true, keys: [...MEMORY.keys()] };
  }
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
// Tool registry
// ============================================================================
const TOOLS = {
  web_search:      { run: tool_web_search,      desc: "Bing RSS Web 検索 (Wikipedia フォールバック)" },
  html_fetch:      { run: tool_html_fetch,      desc: "URL 本文取得 (article/main 抽出)" },
  js_exec:         { run: tool_js_exec,         desc: "JS サンドボックス実行 (async 対応)" },
  load_skill:      { run: tool_load_skill,      desc: "スキル読み込み (単一 or 複数)" },
  parallel_think:  { run: tool_parallel_think,  desc: "複数モデル並列思考" },
  image_generate:  { run: tool_image_generate,  desc: "Pollinations 画像生成" },
  file_upload:     { run: tool_file_upload,     desc: "生成物をダウンロード可能ファイルとして提供" },
  read_file:       { run: tool_read_file,       desc: "添付/生成ファイルを読む" },
  edit_file:       { run: tool_edit_file,       desc: "生成済みファイルを編集 (find/replace or 全書換)" },
  extract_data:    { run: tool_extract_data,    desc: "テキストから URL/数値/メール/JSON/CSV 抽出" },
  summarize:       { run: tool_summarize,       desc: "テキスト要約 (bullets/paragraph/tldr)" },
  memory_store:    { run: tool_memory_store,    desc: "セッション内メモリに key/value 保存" },
  memory_recall:   { run: tool_memory_recall,   desc: "セッション内メモリから value 取得 (key省略で全key)" },
  shorten_element: { run: tool_shorten_element, desc: "巨大テキストを @alias に短縮" },
};

// Tool name aliases the model might use by mistake
const TOOL_ALIASES = {
  "search": "web_search", "google": "web_search", "web": "web_search", "bing": "web_search",
  "fetch": "html_fetch", "get_page": "html_fetch", "fetch_url": "html_fetch", "curl": "html_fetch", "browse": "html_fetch",
  "exec": "js_exec", "eval": "js_exec", "run_js": "js_exec", "execute": "js_exec", "run_code": "js_exec", "python": "js_exec",
  "skill": "load_skill", "get_skill": "load_skill", "read_skill": "load_skill", "skills": "load_skill", "load": "load_skill",
  "think": "parallel_think", "multi_think": "parallel_think", "consult": "parallel_think", "ask_multi": "parallel_think",
  "generate_image": "image_generate", "image": "image_generate", "img": "image_generate", "draw": "image_generate", "make_image": "image_generate",
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
// System prompt
// ============================================================================
function buildSystemPrompt(mainModel, attachments) {
  const attachSection = attachments && attachments.length > 0
    ? `

## 📎 ユーザーが添付したファイル (${attachments.length} 件)
${attachments.map(a => `- id: **${a.id}** — "${a.name}" (${a.mime}, ${a.size} bytes)`).join("\n")}

ユーザーの質問がファイルに関連する場合、必ず最初に read_file で内容を確認してください:
\`\`\`tool
{"tool":"read_file","args":{"attachment_id":"<id>"}}
\`\`\``
    : "";

  return `あなたは "Orby" — 世界最高水準の自律エージェント。メインモデル: ${mainModel}。**全ての応答は日本語で。**

═══════════════════════════════════════════════════════
🎯 本質
═══════════════════════════════════════════════════════

あなたは怠けない、妥協しない、諦めない。ユーザーは**世界最高品質**を求めており、あなたはそれ以下を絶対に出さない。

- **手抜きは犯罪**: 100行程度の中途半端なコードは絶対禁止
- **深掘り必須**: 検索したら interesting URL は必ず html_fetch まで連鎖
- **並列で考えろ**: 難問なら parallel_think で複数モデルに相談
- **検証**: js_exec で動作確認できるコードは必ず確認
- **完璧まで再試行**: 品質が足りなければ何度でもやり直せ

═══════════════════════════════════════════════════════
🔧 ツール呼び出しプロトコル
═══════════════════════════════════════════════════════

\`\`\`tool
{"tool":"<name>","args":{...}}
\`\`\`

**厳守事項**:
- 1ブロック=1ツール。複数並列は複数ブロックを並べる
- ツール名は以下のみ使用:
  - web_search / html_fetch / js_exec / load_skill / parallel_think
  - image_generate / file_upload / read_file / edit_file
  - extract_data / summarize / memory_store / memory_recall / shorten_element
- 引数キー名の慣例:
  - load_skill: {"name": "SKILL-NAME"} または {"name": ["SKILL-A", "SKILL-B"]} (複数)
  - file_upload: {"filename": "x.html", "content": "..."}
  - read_file: {"attachment_id": "..."}
  - web_search: {"query": "...", "max_results": 5}
  - html_fetch: {"url": "..."}
  - js_exec: {"code": "..."}
  - parallel_think: {"prompt": "...", "models": ["...", "..."] (省略可)}
  - image_generate: {"prompt": "...", "width": 1024, "height": 1024}

═══════════════════════════════════════════════════════
📚 利用可能な13スキル
═══════════════════════════════════════════════════════

- **UI-SKILL** — 世界水準の UI/UX 設計原則
- **CODING-SKILL** — 本番グレード実装の絶対ルール
- **GAME-DEV-SKILL** — ゲーム作成 (オセロ/チェス等の完全仕様)
- **WEB-RESEARCH-SKILL** — 深掘り Web リサーチ手法
- **PARALLEL-THINK-SKILL** — 並列思考の使いこなし
- **IMAGE-SKILL** — 画像生成プロンプト設計
- **REFACTOR-SKILL** — リファクタリング体系
- **DEBUG-SKILL** — 系統的デバッグ手法
- **API-DESIGN-SKILL** — RESTful API 設計原則
- **DATA-ANALYSIS-SKILL** — データ分析フロー
- **SYSTEM-DESIGN-SKILL** — 大規模システム設計
- **ALGORITHM-SKILL** — アルゴリズム実装テンプレート
- **TESTING-SKILL** — テスト戦略

═══════════════════════════════════════════════════════
🚀 タスク別必須フロー
═══════════════════════════════════════════════════════

【ゲーム/大規模アプリ作成】(オセロ・チェス・エディタ等)
1. load_skill: ["GAME-DEV-SKILL", "CODING-SKILL", "UI-SKILL"] を並列 or 単発複数
2. **絶対要件**: GAME-DEV-SKILL の完全仕様を全て満たすこと (オセロなら α-β枝刈り, 位置評価, 有効手表示, 難易度3段階, アニメーション等)
3. **最低400行以上のコード**を file_upload
4. コードが本当に動くか js_exec で主要ロジックを検証してもよい
5. 完成報告 + [filename](/api/files/xxx) リンク + 実装機能一覧

【Web リサーチ】
1. web_search
2. **並列で** html_fetch × 複数 URL
3. 引用付き日本語回答

【比較・意見・アーキテクチャ選定】
1. parallel_think (3モデル同時)
2. 必要なら web_search で裏取り
3. 統合した日本語回答

【添付ファイル分析】
1. read_file
2. 必要なら js_exec / extract_data / summarize
3. 分析結果を日本語で

═══════════════════════════════════════════════════════
⛔ 絶対禁止事項
═══════════════════════════════════════════════════════

- **手抜きゲーム/アプリ**: → 犯罪レベル。GAME-DEV-SKILL を読み返し、ユーザーの意図を読み取り全要件を実装せよ
- **タスクブロックだけで会話終了**: ツール結果を受けたら必ず次のアクションへ
- **スキル内容の露出**: load_skill 結果をユーザー返答に貼らない
- **推測での回答**: 事実確認できるなら web_search か js_exec で確認
- **単一モデル独断**: 難問なら積極的に parallel_think を必ず使う。
- **英語の混入**: 全応答日本語で

═══════════════════════════════════════════════════════
✨ 最終回答スタイル
═══════════════════════════════════════════════════════

- 日本語のみ、簡潔かつ本質的
- 生成物は [filename](/api/files/xxx) 形式でリンク
- コードは長ければ file_upload、短ければ \`\`\`言語 フェンス
- Web リサーチはソース URL を必ず引用
- **手抜き感 = 犯罪**${attachSection}`;
}

// ============================================================================
// SSE + Robust tool-call parser
// ============================================================================
function sseSend(res, event, data) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) {}
}

/**
 * Forgiving tool-call parser.
 * Handles:
 *  - Standard: ```tool\n{"tool":"x","args":{...}}\n```
 *  - Without fence: {"tool":"x","args":{...}} on its own line
 *  - Wrong key: {"name":"x", "args":{...}} → treat as tool name
 *  - Wrong key: {"tool":"x", "parameters":{...}} → use as args
 *  - Alias: {"tool":"search","args":...} → maps to web_search
 *  - Malformed JSON: try to extract balanced {...}
 *  - Wrapped: ```json\n{...}\n``` if it contains "tool" key
 *  - Skill names in args like {"skill_ids":[...]} → normalized to {name:[...]}
 */
function parseToolCalls(text) {
  const calls = [];
  const found = new Set();

  const addCall = (raw, tool, args) => {
    tool = String(tool || "").toLowerCase().replace(/[_\s]+/g, "_");
    // Resolve alias
    if (TOOL_ALIASES[tool]) tool = TOOL_ALIASES[tool];
    if (!TOOLS[tool]) return false;
    // Fingerprint to dedupe
    const fp = tool + JSON.stringify(args || {});
    if (found.has(fp)) return true;
    found.add(fp);
    calls.push({ tool, args: args || {} });
    return true;
  };

  const tryParseObj = (raw) => {
    // Attempt strict parse
    try { return JSON.parse(raw); } catch (_) {}
    // Extract first balanced { ... }
    const jm = raw.match(/\{[\s\S]*\}/);
    if (jm) { try { return JSON.parse(jm[0]); } catch (_) {} }
    // Try to sanitize common issues: single quotes, trailing commas
    let cleaned = raw
      .replace(/'/g, '"')
      .replace(/,(\s*[}\]])/g, "$1")
      .replace(/(\w+):/g, '"$1":')  // Bare keys → quoted
      .replace(/""(\w+)""/g, '"$1"'); // Undo double-quoting we might have introduced
    try { return JSON.parse(cleaned); } catch (_) {}
    const jm2 = cleaned.match(/\{[\s\S]*\}/);
    if (jm2) { try { return JSON.parse(jm2[0]); } catch (_) {} }
    return null;
  };

  const extractFromParsed = (obj) => {
    if (!obj || typeof obj !== "object") return null;
    // Standard shape: {tool, args}
    let tool = obj.tool || obj.name || obj.tool_name || obj.function || obj.action;
    let args = obj.args || obj.arguments || obj.parameters || obj.params || obj.input || obj;
    // If args is just the outer obj minus tool key, that's fine
    if (args === obj) {
      const { tool: _t, name: _n, ...rest } = obj;
      args = rest;
    }
    return { tool, args };
  };

  // 1. Standard ```tool ... ``` blocks
  const fenceRe = /```(?:tool|json)?\s*\n?([\s\S]*?)\n?```/g;
  let m;
  while ((m = fenceRe.exec(text))) {
    const raw = m[1].trim();
    if (!raw) continue;
    const obj = tryParseObj(raw);
    if (!obj) continue;
    const extracted = extractFromParsed(obj);
    if (extracted && extracted.tool) addCall(raw, extracted.tool, extracted.args);
  }

  // 2. Standalone JSON objects with "tool"/"name"/"action" key
  //    Use a state machine to find balanced { ... } starting with these keys
  const startRe = /\{\s*"(?:tool|name|action)"\s*:/g;
  let sm;
  while ((sm = startRe.exec(text))) {
    // Skip if inside a code fence we already handled
    const before = text.slice(Math.max(0, sm.index - 20), sm.index);
    if (before.endsWith("```tool\n") || before.endsWith("```json\n")) continue;
    // Find the matching closing brace by balanced counting
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
    if (extracted && extracted.tool) addCall(raw, extracted.tool, extracted.args);
  }

  return calls;
}

function stripToolBlocks(text) {
  let s = text.replace(/```(?:tool|json)\s*[\s\S]*?```/g, "");
  // Also strip standalone tool JSON objects (balanced brace matching)
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
  // Remove from back to front to keep indices valid
  for (const [a, b] of removeRanges.reverse()) s = s.slice(0, a) + s.slice(b);
  return s.trim();
}

// ============================================================================
// File / attachment endpoints
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
// /api/agent
// ============================================================================
// Models that support long outputs (>15KB) - used for large code generation
const LARGE_OUTPUT_MODELS = ["felo-chat", "scira-nemotron-3-super", "gpt-4o"];

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

[Orby として日本語で応答。ツール実行が必要なら \`\`\`tool\`\`\` ブロックで呼び出す。積極的に自律連鎖してください。手抜きは絶対禁止。]`
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

      // Detect if we need a large-output model this round.
      // Trigger: previous tool result contains a load_skill for CODING/GAME/UI/ALGORITHM
      // OR the user message asks to "make/create/build/implement/write" something substantial.
      const lastToolResults = convo.slice(-3).filter(m => typeof m.content === "string" && m.content.includes("```tool_result")).join("");
      const needsLargeOutput =
        /GAME-DEV-SKILL|CODING-SKILL|ALGORITHM-SKILL|SYSTEM-DESIGN-SKILL/i.test(lastToolResults) ||
        /作って|作って|実装|作成|書いて|コードを生成|make it|build|implement|create.*app/i.test(
          messages[messages.length - 1]?.content || ""
        );
      const effectiveModel = needsLargeOutput && !LARGE_OUTPUT_MODELS.includes(model)
        ? "felo-chat"  // switch to felo-chat which supports up to 21KB output
        : model;

      let streamedText = "";
      try {
        streamedText = await nieChatStream(
          { model: effectiveModel, messages: convo, temperature: 0.6 },
          (delta) => sseSend(res, "assistant_delta", { text: delta })
        );
      } catch (_) {}

      const knownToolNames = new Set([...Object.keys(TOOLS), ...Object.keys(TOOL_ALIASES)]);
      const toolNameMatches = [...streamedText.matchAll(/```(?:tool|json)?\s*\n?\s*\{\s*"(?:tool|name|action)"\s*:\s*"([^"]+)"/g)].map(m => m[1].toLowerCase());
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
          : [effectiveModel, "felo-chat", "scira-nemotron-3-super"];
        let replaced = false;
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
        // Detect fabricated file links (agent claims to have created a file but didn't call file_upload)
        const finalText = stripToolBlocks(assistantText);
        const claimsFile = /\/api\/files\/[a-zA-Z0-9_.-]+/.test(finalText);
        const hasRealUpload = /\/api\/files\/[a-f0-9]{16}/.test(finalText); // real IDs are 16 hex
        const realIds = new Set([...UPLOADED_FILES.keys()]);
        const referencedRealIds = [...finalText.matchAll(/\/api\/files\/([a-f0-9]{16})/g)].map(m => m[1]);
        const allRealRefs = referencedRealIds.length > 0 && referencedRealIds.every(id => realIds.has(id));

        if (claimsFile && !allRealRefs) {
          // Agent hallucinated a file link. Force re-attempt.
          sseSend(res, "assistant_reset", {});
          sseSend(res, "assistant_delta", { text: "[修正中: 実際にファイルを作成します...]" });
          convo.push({
            role: "user",
            content: `あなたの回答に架空のファイルリンクが含まれています。file_upload ツールを使っていないのにリンクを提示しています。

**今すぐ**:
1. 必ず file_upload ツールを呼び出してファイルを本当に作成してください:

\`\`\`tool
{"tool":"file_upload","args":{"filename":"...","content":"...(実際のコード全体)..."}}
\`\`\`

2. ツール呼び出しの結果から得た本物の URL (例: /api/files/xxxxxxxxxxxxxxxx) を提示してください。架空の ID ではなく。`
          });
          continue; // Skip final emission, continue loop
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

      const used = new Set(results.map(r => r.tool));
      let nudge = "";
      if (used.has("web_search") && !used.has("html_fetch")) {
        const sr = results.find(r => r.tool === "web_search")?.result;
        const urls = (sr?.results || []).slice(0, 3).map(r => r.url);
        nudge = `

[自律連鎖] 検索結果を受け取りました。深く答えるため、次のラウンドで必ず上位1-3件のURLを html_fetch で並列取得してください。

URL 候補:
${urls.map((u, i) => `${i+1}. ${u}`).join("\n")}

同ラウンドで複数の \`\`\`tool\`\`\` ブロックを並べれば並列実行されます。`;
      } else if (used.has("load_skill") && !used.has("file_upload") && !used.has("web_search") && !used.has("html_fetch") && !used.has("parallel_think")) {
        nudge = `

[重要｜絶対遵守] スキルを読み込みました。**今すぐ次の行動を取れ**:

1. スキルの全要件を満たすコードを生成し、**必ず file_upload ツールを実際に呼び出す**（回答でなく、ツール呼び出しで）：

\`\`\`tool
{"tool":"file_upload","args":{"filename":"xxx.html","content":"<!DOCTYPE html>...（実際のHTMLコード全体）..."}}
\`\`\`

2. **絶対禁止**: 「実装しました」と書いて file_upload を呼ばないこと。架空のリンク (例: [othello.html](/api/files/xxx)) を輔送してはいけない。リンクは file_upload ツールの結果からしか得られない。

3. 簡略化や省略などを絶対にせず、全て完璧な状態で実装すること。

今すぐのラウンドで実行してください。`;
      } else {
        nudge = `

[次のアクション] タスクが完了したか判断:
- 未完了 → 次のツールを呼び出して継続
- 完了 → ツールブロックなしで日本語の最終回答を出す`;
      }

      convo.push({ role: "user", content: feedback + nudge });

      if (round === max_rounds && !finalEmitted) {
        sseSend(res, "round", { round: round + 1, forced: true });
        try {
          convo.push({ role: "user", content: "[最大ラウンド到達。最終回答を日本語で出してください。]" });
          const j = await nieChat({ model, messages: convo, temperature: 0.4 });
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
// Other endpoints
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
    ok: true, service: "orby", version: "5.0.0",
    default_model: DEFAULT_MODEL,
    tools: Object.keys(TOOLS),
    skills: Object.keys(SKILLS),
  });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Orby v5 running on http://localhost:${PORT}`));
}

module.exports = app;
