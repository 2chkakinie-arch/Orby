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
  "UI-SKILL": `# UI/UX 設計スキル ─ 世界水準の実装可能ガイド

## 前提: このスキルを読んだ時点で守るべきこと
UI を作る際、あなたは「見栄えの良いランディングを 1 枚生成する人」ではなく、「ユーザーが 5 分触っても違和感を感じないプロダクト」を作る人になる。
装飾よりも「情報階層」「触感」「一貫性」の 3 点で判断せよ。

## 決定木: どのテイストか最初に決める
1. **ダーク+ネオン系** (開発者向け, AI 系, 音楽/映像制作): 背景 #0a0a0f〜#141420, アクセントは1色のみ (紫/シアン/緑のいずれか)
2. **ライト+ソフト系** (一般消費者, 教育, ヘルスケア): 背景 #fafafa/#ffffff, テキスト #0f172a, 影は 0 1px 2px rgba(0,0,0,.06) + 0 8px 24px rgba(0,0,0,.04)
3. **エディトリアル系** (ブログ, ニュース, ドキュメント): 白背景, 黒テキスト, セリフ見出し (Georgia/新聞明朝), 本文サンセリフ, max-width 680px
4. **ブランド強め** (エンタメ, ゲーム, 食品): 大胆な単色ベース + 補色の差し色, 大きな写真, オーバーサイズタイポ

判断基準: ユーザーの依頼に「開発者/ダッシュボード/AI」→ 1, 「アプリ/サービス」→ 2, 「読み物/記事」→ 3, 「LP/キャンペーン」→ 4。迷ったら 2。

## 数値の絶対値 (これを守れば必ず整う)
- **間隔スケール** (8px base): 4, 8, 12, 16, 24, 32, 48, 64, 96 px。それ以外の値は使うな
- **角丸**: 6px (chip/tag), 10px (button/input), 14px (card), 20px (modal), 9999px (pill)
- **ボーダー**: 1px solid で、色は透明度で階層化 (rgba(base, .06/.10/.16/.22))
- **影 (ライト)**: sm=0 1px 2px rgba(0,0,0,.06), md=0 4px 12px rgba(0,0,0,.08), lg=0 12px 32px rgba(0,0,0,.10)
- **影 (ダーク)**: 影の代わりに 1px の内側ハイライト inset 0 1px 0 rgba(255,255,255,.06) を使う
- **アニメ時間**: 120ms (hover), 180ms (state change), 240ms (page/modal), 400ms (large emphasis)
- **イージング**: cubic-bezier(.2, .8, .2, 1) を全部に使え。linear/ease-in-out 禁止

## タイポグラフィ (厳守)
- font-family: -apple-system, "SF Pro Text", "Inter", "Helvetica Neue", "Hiragino Sans", "Noto Sans JP", sans-serif
- **サイズスケール**: 12 / 13 / 14 / 16 / 18 / 20 / 24 / 30 / 36 / 48 / 60 px
- **行間**: 見出し 1.2, 本文 1.6, キャプション 1.5
- **字送り**: 見出し -0.02em, 本文 0, キャプション +0.02em uppercase
- **ウェイト**: 400 (body), 500 (labels/subhead), 600 (h2/h3), 700 (h1 のみ)
- 日本語のみのテキストでは -0.01em に留める (詰めすぎ厳禁)

## 情報階層のルール
- 1画面に「主要CTA」は必ず 1 つ。2 つ以上なら残りは secondary スタイル (無地/ボーダーのみ) にせよ
- 見出しレベルは 3 段階まで (h1 → h2 → h3)。それ以上必要なら情報を分割する
- 隣接要素間の余白は「関連が強いほど狭く」の原則: 内部 8-12px, セクション間 32-48px
- **F パターンと Z パターン**: LP は Z (視線が対角), ダッシュボードは F (左上→下)

## インタラクションの必須ディテール
- **ホバー**: opacity/背景変化のみ。位置は動かすな (動くなら translateY(-1px) 1回きり, active で戻す)
- **アクティブ**: transform: scale(.97) + 明度 -5%
- **フォーカス**: outline は必ず可視化。box-shadow: 0 0 0 3px アクセント色15% で対応
- **フィードバック**: ボタン押下から 100ms 以内に何か変化させる (スピナー / disabled / ラベル変化)
- **ローディング**: 200ms 未満なら何も出すな, 200-1000ms はスケルトン, それ以上ならプログレス表示
- **エラー表示**: 入力フィールドの直下, 赤ボーダー + アイコン + 具体的な修正指示 (「メールアドレスは 〜@〜 の形式」等)

## 禁止事項 (これをやったら再生成)
- 3色以上の派手なグラデーション (Instagram のロゴみたいなの)
- 装飾のためだけの絵文字を UI に散りばめる
- カーソルが指マークにならないクリック要素
- コントラスト比 4.5:1 を切るテキスト
- テキストが画像に直接乗っていて背景で読めない
- モバイルで横スクロールが発生する
- font-size < 14px の本文
- 「クリックしてください」等の冗長な指示テキスト

## セルフチェック (提出前に全部 yes になるまで直せ)
1. スマホ幅 375px で開いてレイアウトが崩れないか?
2. キーボードだけで全操作できるか? (Tab で移動, Enter で送信)
3. ダーク/ライト切り替えなしでも十分読めるコントラストか?
4. 主要 CTA を 1 秒以内に発見できるか?
5. hover/active/focus/disabled の 4 状態が全ボタンで定義されているか?
6. エラー時にユーザーが「次に何をすればいいか」わかるか?`,

  "CODING-SKILL": `# コーディング・スキル ─ 本番グレードの実装原則

## 出力する前に自問すること
1. これは「動作するデモ」ではなく「明日から本番運用できる」水準か?
2. 想定外の入力 (null, 空文字, 極大値, 権限なし) で全部落ちずに動くか?
3. コードを読んだ他の開発者が 5 分で構造を理解できるか?
4. 修正依頼が来たとき、どこを触ればいいか自明か?
5. **今から書くコードを頭の中で最初から最後まで走らせてみて、明らかなバグが 0 か?**

上記のいずれかが No なら、書き始める前に設計を練り直せ。

## 単一ファイル HTML アプリの品質基準
- **最低 400 行**、CSS 100 行以上、JS 200 行以上。これ未満は「未完成」扱い
- **HTML 構造化**: header / main / footer, 意味のあるタグ (nav, article, section, aside) を使う
- **CSS**: 
  - :root で CSS カスタムプロパティに全色/間隔/影を定義
  - リセット (box-sizing: border-box; margin: 0) を最初に書く
  - モバイルファースト, @media (min-width: 640px), (min-width: 1024px)
  - CSS Grid と Flexbox のみで組む (position: absolute は overlay/tooltip のみ)
- **JS**:
  - state / view / controller を明確に分ける (単純な MVC で十分)
  - const/let のみ, var 禁止
  - async/await 使用, Promise.then のチェーンは避ける
  - イベントリスナは addEventListener で登録し, cleanup を意識する
  - localStorage を使う場合は try/catch で囲む (プライベートブラウジング対策)

## エラーハンドリングの標準形
\`\`\`js
async function fetchData(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(\`HTTP \${res.status}: \${res.statusText}\`);
    const data = await res.json();
    if (!data || typeof data !== 'object') throw new Error('Invalid response shape');
    return { ok: true, data };
  } catch (err) {
    console.error('[fetchData]', err);
    return { ok: false, error: err.message || String(err) };
  }
}
\`\`\`
- 例外は握りつぶすな。必ず「ユーザーに何を見せるか」まで決めろ
- try 内は「失敗しうる操作のみ」を囲む。全部囲むと原因が特定できなくなる

## 命名規則
- **関数**: 動詞から始める (getUserById, calculateTotal, isValidEmail)
- **変数**: 名詞または形容詞+名詞 (currentUser, isLoading, itemCount)
- **定数**: SCREAMING_SNAKE_CASE (MAX_RETRIES, API_BASE_URL)
- **boolean**: is/has/can/should から始める
- **配列**: 複数形 (users, items)。userList のような冗長な命名は避ける
- 一時変数の \`tmp\`, \`data\`, \`result\` は禁止。何を持っているか具体的に書く

## パフォーマンス
- ループ内で DOM を触るな。DocumentFragment に集めてから 1 度で append
- Big-O を意識する: 二重ループが O(N²) になっていないか?
- 大きな配列の filter().map().reduce() チェーンは 1 パス for に統合を検討
- debounce/throttle: 入力欄 250ms, スクロール 100ms, resize 200ms が目安
- 画像は loading="lazy" + width/height 属性 (CLS 対策) を必ずつける

## 依存の扱い
- **CDN**: ユーザーが明示要求しない限り原則禁止。単一ファイル完結を守れ
- 例外: Three.js, Chart.js 等、自作すると膨大になるもののみ許可
- 使う場合は integrity="sha384-..." つきで, バージョン固定
- polyfill は書くな (モダンブラウザ前提)

## コメント
- コメントは「なぜこう書いたか」のみ書く。「何をしているか」はコード自身に語らせろ
- \`// バグ回避: Safari では〜\` や \`// 仕様: 深夜 0 時跨ぎを許容する\` は良いコメント
- \`// i を 1 増やす\` は悪いコメント (書くな)

## 提出前セルフチェック
1. 全ての入力欄に validation (空/長すぎ/形式違い) はあるか?
2. Loading / Empty / Error / Success の 4 状態が UI に表現されているか?
3. F12 コンソールを開いて警告/エラーが 0 か?
4. ページリロードしても状態が消えないなら, localStorage に保存されているか?
5. **300 行未満なら, ほぼ確実に何か手を抜いている。もう一度読み直せ**`,

  "GAME-DEV-SKILL": `# ゲーム開発スキル (単一 HTML) ─ 遊べるゲームだけを作る

## 大前提
「ゲーム作って」と言われたら, あなたは 5 分で飽きない・ちゃんと勝敗がつく・入力が気持ちいい ゲームを作る。
ボードを描画しただけ / スコアが動くだけ / AI がランダム打ちだけ の物は「ゲームではない」。

## 共通の絶対要件 (全ジャンル共通, 一つでも欠けたら不合格)
1. **最低 500 行以上**の単一 HTML
2. **60fps ゲームループ**: requestAnimationFrame + delta time で fps 独立化
3. **3 状態**: title (メニュー) / playing / gameover の遷移を明示的にコード化
4. **入力**: キーボード (WASD/矢印/Enter/Space) + マウス + タッチ (pointerdown/move/up 統一) の 3 経路対応
5. **スコア/進捗表示**: ゲーム中は常時可視, ゲーム終了時は最終値をハイライト
6. **リスタート**: R キーまたはボタンで即座に再開できる
7. **難易度 or 進行**: Easy/Normal/Hard 選択 か レベル/波が進むに従い難化 のどちらか
8. **サウンド代替**: 操作にビジュアルフィードバック (パーティクル/フラッシュ/揺れ) を必ず付ける
9. **勝利/敗北条件**: 明確に判定してモーダルで結果表示
10. **モバイル対応**: viewport meta + タッチ操作の代替 UI (仮想パッド/タップゾーン)

## ジャンル別の追加必須仕様

### ボードゲーム系 (オセロ/リバーシ, チェス, 将棋, 五目, 囲碁)
- **合法手ハイライト**: 現在の手番で置ける場所を薄色で表示
- **AI**: minimax + alpha-beta pruning 必須。深さ Easy=2, Normal=4, Hard=6
- **評価関数**: 
  - オセロ: 位置重み (角=100, 角隣=-25, 辺=5, X-square=-40) + 着手可能数 + 石差
  - チェス: 駒価値 (P=100, N=320, B=330, R=500, Q=900, K=20000) + 位置ボーナステーブル
  - 五目: 連続数評価 (2=10, 3=100, 4=1000, 5=∞), 相手ブロック優先
- **駒アニメ**: 配置時にスケール pop, 変化時にフリップ or フェード (200-400ms)
- **手番インジケータ**: 常に「今どちらの番か」が視覚的にわかる
- **パス処理**: 打つ手がない場合の自動パス + 通知
- **手の履歴**: 棋譜的に左サイドに表示 (オプション)

### アクション/シューティング系 (弾幕, パズドラ風落ち物, ジャンプアクション)
- **物理**: 重力/摩擦/反発を明示的にコード化 (velocity + acceleration)
- **衝突判定**: AABB か円判定を関数化, 二重ループ回避のため空間分割 (grid) を検討
- **敵**: 最低 3 種類, 挙動パターンを分ける (直進/追尾/波状)
- **パーティクル**: 破壊/被弾/取得で必ずパーティクル (50個程度) を撒く
- **画面揺れ**: ダメージ時に 4-6px, 100ms の shake
- **難易度上昇**: 時間 or スコアに応じて敵の速度/数/パターンが増加

### パズル系 (テトリス, 数独, スライドパズル, マッチ 3)
- **ヒント**: 詰み判定 + ヒント表示機能
- **アンドゥ/リドゥ**: 最低 3 手戻せる
- **タイマー**: 経過時間表示, ベストスコアを localStorage 保存
- **アニメ**: 消去/移動を必ずアニメーション (transform + transition, 150-300ms)

### RPG/シミュレーション系 (ローグライク, ターン制バトル)
- **マップ**: procedural generation (BSP か cellular automaton) で毎回変化
- **戦闘**: HP/攻撃/防御/命中/回避 の最低 5 パラメータ
- **成長**: レベルアップ, スキル獲得, アイテム
- **セーブ**: localStorage で進捗保存

## 描画の実装方針
- **Canvas 2D** を第一選択 (200 要素以上動くなら)
- **CSS/DOM** はボード系 (静的マス目) のみ
- **WebGL/Three.js** は 3D 要求時のみ (CDN 使用可)
- Canvas 使用時は devicePixelRatio 対応 (Retina で滲まない)

## 見た目の最低ライン
- 単色 or 2 色のグラデ背景 + ネオン風グロー (box-shadow で光らせる)
- フォント: ゲーム内 UI は 'Press Start 2P' 風または太い sans-serif
- 色設計: ゲームプレイ色 (プレイヤー/敵/背景) は色相を 60° 以上離す
- ボード系は木目 or 深緑 (#1a5f3f) の落ち着いた背景

## 絶対にやってはいけない手抜きパターン
- HTML 100 行以下, CSS 20 行以下 で提出 → 論外
- AI が Math.random() で手を選ぶだけ → AI ではない
- スコアだけ動くがゲームオーバーがない → ゲームではない
- キーボードのみ対応でモバイル不可 → 不完全
- リロードで進捗が消える (パズル系) → 保存必須
- 「ゲーム開始」ボタンを押したら即プレイエリアに遷移するだけ → title 画面の意味なし

## 提出前セルフチェック
1. 本当に 5 分プレイして飽きないか? 自分で遊んでみて答えろ
2. 難易度 Hard で AI に勝てるか, 勝てないくらい強いか?
3. リロード後もスコアは保持されているか?
4. スマホで触って快適か?
5. コード行数は 500 を超えているか?`,

  "WEB-RESEARCH-SKILL": `# Web リサーチ・スキル ─ 深掘りと事実検証の実践

## 基本フロー (全リサーチで必ずこの順)
1. **意図理解**: ユーザーは「概要」を欲しいのか「最新情報」か「比較」か「実装方法」か特定
2. **クエリ設計**: 
   - 時事: 年号を必ず含める (最新なら今の年, 履歴なら該当年)
   - 技術: バージョン番号を含める ("React 19", "Node 22")
   - 概念: 英語で検索 (日本語より 10 倍情報量が多い)
3. **並列検索**: web_search を 2-3 クエリで並列実行 (同義語/別視点)
4. **結果選別**: 権威スコアで並び替え (下記参照)
5. **並列取得**: 上位 3-5 件を html_fetch で並列取得
6. **クロス検証**: 最低 2 ソースで一致する情報のみ「事実」として提示
7. **引用付き回答**: 全ての主張に出典 URL を紐づけて日本語回答

## 権威スコア (URL を見て 0-10 で採点)
- 10: 公式ドキュメント (react.dev, nodejs.org, developer.mozilla.org)
- 9: 政府/学術 (.gov, .edu, arxiv.org, papers)
- 8: 大手技術メディア (ars-technica, thevrge, wired, techcrunch), 大手新聞社
- 7: GitHub 公式リポジトリ, RFC, W3C
- 6: 業界人ブログ (著者が業界著名人)
- 5: Wikipedia (裏取り必須)
- 4: Stack Overflow (accepted answer のみ)
- 3: Medium/Zenn/Qiita の技術記事 (書き手を確認)
- 1: SEO ブログ, まとめサイト, AI 生成記事
- 0: 使うな

**7 以上のソース 2 つ以上で一致** → 事実として扱う
**5-6 のソースのみ** → 「〜と報じられている」等トーンを弱める
**5 未満のみ** → 一次ソースを再検索, 見つからなければ「確認できず」と明記

## 検索クエリのテクニック
- 完全一致検索: "exact phrase"
- 除外: -clickbait -site:pinterest.com
- サイト指定: site:react.dev
- ファイル指定: filetype:pdf
- 期間指定: after:2025-01-01
- 比較質問: "X vs Y" "X or Y" "difference between X and Y"

## html_fetch した後の処理
1. ノイズ除去: 広告, ナビ, フッターの文言は無視
2. 見出し + 最初の段落を優先的に読む
3. 数値 (統計, バージョン, 日付) は原文からそのまま引用
4. コード例があれば言語構文を確認して整形して引用
5. 情報が薄ければ, その記事から更にリンクを辿る (2 段まで)

## 引用の書き方
本文中: 「React 19 では Actions が導入された ([React 公式](https://react.dev/blog/2024/12/05/react-19))」
末尾に必ず:
\`\`\`
## 参考
- [記事タイトル](URL) ─ 発行元, 日付
- [記事タイトル](URL) ─ 発行元, 日付
\`\`\`

## リサーチ回答の構成テンプレート
1. **結論** (1-3 行, 質問への直接回答)
2. **詳細** (箇条書き or 見出し付き段落)
3. **参考リンク** (最低 3 件)

## やってはいけないこと
- 1 ソースだけで断定
- 「〜らしい」「〜と思われる」で逃げる (裏取りするか, 確認不能と明記)
- 検索結果のスニペットだけで回答 (必ず html_fetch する)
- 古い情報 (3 年以上前) を最新として扱う
- 記憶ベースで回答 (知識カットオフ後の話は絶対に検索)`,

  "PARALLEL-THINK-SKILL": `# 並列思考スキル ─ 複数モデルによる合議

## いつ使うか (判断基準)
以下のいずれかに該当したら parallel_think を必ず使え:
- **技術選定**: A vs B vs C の選択で長期的影響が大きい
- **アーキテクチャ**: マイクロサービス化, DB 選定, フレームワーク選定
- **難問**: 単純解が見つからない, 制約が複雑, トレードオフが多い
- **意見が割れる話題**: 正解が1つでない (プログラミング言語論争, 設計哲学)
- **重要な判断**: 誤ると手戻りが大きい

使わなくてよいケース: 事実確認 (web_search), 単純な実装 (直接書く), 明らかに答えが 1 つ

## モデル選択 (組み合わせ推奨)
- **scira-nemotron-3-super**: NVIDIA 系, 技術深堀り, ハードウェア/GPU に強い
- **gpt-4o / gpt-4**: バランス型, 一般常識と実装のバランス
- **deepseek-r1**: 推論特化, 数学/アルゴリズムに強い
- **claude-sonnet 系**: 文章と設計思想に強い

**組み合わせ原則**: 特性が異なる 3 モデルを選ぶ (同じ会社/系統は避ける)。
デフォルト推奨: [scira-nemotron-3-super, gpt-4o, deepseek-r1]

## プロンプト設計のコツ
- **1 プロンプト = 1 問い**. 複数質問を混ぜるな
- **観点を指定**: 「性能, 開発速度, エコシステム, 学習コスト の 4 観点で比較して」
- **文字数指定**: 「200 words 以内で要点のみ」
- **立場を求める**: 「あなたの推奨は? 理由も」
- **具体例を要求**: 「実際のプロダクション事例を 1 つ挙げて」

良い例:
「Rust vs Go: 高並行 API サーバー (10万 req/sec) を構築する場合, どちらを選ぶ? 性能/開発速度/エコシステム/採用の観点で比較し, 最後にあなたの推奨を明記. 200 words 以内.」

悪い例:
「Rust と Go どっちがいい?」 (曖昧すぎ, 用途不明)

## 統合方法 (回答をどう合成するか)
1. **共通点抽出**: 全モデルが同意した点 → 信頼度高い事実として提示
2. **相違点特定**: 意見が割れた点 → 「モデル A は X, モデル B は Y」と両論併記
3. **理由の質評価**: 
   - 具体例/データ付き → 高評価
   - 一般論のみ → 低評価
4. **統合結論**: 相違点はユーザーの状況次第, その場合の判断基準を提示

## 統合回答のテンプレート
\`\`\`
## 結論
[全モデルが一致した推奨 or 「状況次第」明示]

## 各モデルの見解
### Model A (nemotron)
[要約 + 主張]
### Model B (gpt-4o)
[要約 + 主張]
### Model C (deepseek-r1)
[要約 + 主張]

## 共通点
- [全員一致した事実]

## 相違点
- [X について A は 〜, B は 〜]

## 推奨判断
- あなたの状況が [条件1] なら → A の見解
- [条件2] なら → B の見解
\`\`\`

## 禁止事項
- 単純平均化 ("平均的にこう言っています")
- 1 モデルだけ引用して他を無視
- 全モデル同じ答え = 「これが正解」で終わらせる (それでも根拠を吟味)`,

  "IMAGE-SKILL": `# 画像生成スキル ─ プロンプト設計と埋め込み

## プロンプト構成の必須要素 (順番厳守)
[主題] → [スタイル] → [ライティング] → [構図/カメラ] → [質感/雰囲気] → [ネガティブ要素]

例: 
"A young Japanese architect standing in a minimalist Tokyo office, cinematic realism, soft afternoon window light with subtle rim lighting, medium shot from waist up shallow depth of field, 50mm lens f/1.8, warm neutral tones, editorial magazine aesthetic, no text no logo"

## スタイル語彙 (目的別に選ぶ)
### フォトリアル系
- cinematic realism, photorealistic, editorial photography, film photography, documentary style, National Geographic aesthetic
### イラスト系
- watercolor illustration, ink wash painting, comic book style, anime cel-shaded, ghibli-inspired, minimal line art, flat vector illustration
### 3D 系
- octane render, unreal engine 5, cinema 4d, blender cycles, isometric 3d, low-poly aesthetic
### 芸術系
- oil painting, art nouveau, cyberpunk aesthetic, brutalist, bauhaus, ukiyo-e woodblock print
### プロダクト/UI 系
- product photography on seamless background, dribbble style ui mockup, 3d clay render, floating iso perspective

## ライティング語彙 (雰囲気を決める最強変数)
- **時間帯**: golden hour, blue hour, harsh midday, moonlight, dawn twilight
- **性質**: soft diffused light, hard directional light, volumetric god rays, neon glow, chiaroscuro (強烈なコントラスト)
- **方向**: rim lighting (背面光), backlit, side-lit, top-down, three-point studio lighting
- **色温度**: warm 3000K, neutral 5500K, cool 7500K

## 構図/カメラ語彙
- **ショット**: extreme close-up, close-up, medium shot, wide shot, establishing shot
- **アングル**: eye-level, low angle, high angle, birds-eye view, dutch angle
- **レンズ**: 24mm wide, 35mm standard, 50mm portrait, 85mm compressed, 135mm telephoto
- **F値**: shallow depth of field f/1.4 (背景ボケ強), deep focus f/8 (全体シャープ)
- **構図**: rule of thirds, centered symmetry, leading lines, negative space

## サイズ選択 (用途別)
- 正方 SNS (Instagram): 1024×1024
- 縦長 SNS (TikTok/Reels/Story): 1024×1536 (2:3)
- 横長 (Twitter header/blog): 1536×1024 (3:2)
- ワイドヒーロー (LP hero): 2048×1024 (2:1) or 1920×1080
- スマホ壁紙: 1080×1920 (9:16)
- サムネイル (YouTube): 1280×720

## ネガティブ要素 (必ずプロンプト末尾に追加)
"no text, no watermark, no logo, no signature, no ugly hands, no distorted anatomy, no low quality"

## 埋め込みルール
生成後は必ず Markdown で埋め込む:
\`\`\`
![説明的な alt テキスト](image_url)
\`\`\`
- alt テキストには絶対に「画像」と書くな (スクリーンリーダーで冗長になる)
- 用途に応じて幅指定 (HTML なら width="600")

## 品質を落とす禁止事項
- 「beautiful, amazing, wonderful」等の主観的形容詞乱用 (無意味)
- 矛盾する指示 (realistic + cartoon 等)
- 100 語超えの長すぎるプロンプト (要素が薄まる)
- 顔の細部指定なし で人物依頼 (「confident expression」等を必ず入れる)

## 生成後の確認
1. 主題が意図通り描画されているか
2. テキストが混入していないか (画像内テキストは高確率で壊れる)
3. 手/指/顔が崩壊していないか
4. ライティングが指定通りか

崩壊していたら prompt を調整して再生成 (最大 2 回まで)`,

  "REFACTOR-SKILL": `# リファクタリング・スキル ─ 動作を変えず品質を上げる

## リファクタリングの絶対ルール
- **動作は変えない**: 入力に対する出力/副作用が完全に一致
- **一度に一つの変更**: 命名 + 抽出 + 型付け を混ぜるな。1 コミット 1 目的
- **テストがあれば先に流す**: リファクタ前 pass, 後も pass を確認
- **テストがなければ書いてからやる**: 主要な公開関数だけでもテスト書く

## 段階
### 1. 読解フェーズ
- read_file で対象コード全体取得
- 「このコードが何を実現したいか」を 1 行で言語化
- 呼び出し関係を頭の中でグラフ化 (公開関数 → 内部関数)

### 2. 問題特定 (優先度順)
1. **バグ**: null/undefined 未処理, 例外未捕捉, 境界条件バグ → 最優先
2. **セキュリティ**: XSS, SQL injection, 秘密鍵ハードコード → バグ級
3. **命名**: 意味不明な名前 (tmp, data, res, foo, bar, x, y) → 高優先
4. **責務肥大**: 関数が 50 行超, 1 関数で複数のことをしている → 高優先
5. **重複**: 3 箇所以上に同じロジック → 中優先
6. **深いネスト**: if/for が 3 段以上 → 中優先
7. **マジックナンバー**: 24, 60, 1024 等が裸で埋め込まれている → 中優先
8. **コメント欠如 or 過剰**: 「なぜ」がないコメント, or 冗長なコメント → 低優先

### 3. リファクタリング手法 (問題別)

**Extract Function**: 大関数を意図明確な小関数へ
\`\`\`js
// Before
function checkout(cart) {
  let total = 0;
  for (const item of cart.items) total += item.price * item.qty;
  const tax = total * 0.1;
  const shipping = total > 5000 ? 0 : 500;
  return total + tax + shipping;
}
// After
function calcSubtotal(items) { return items.reduce((s, i) => s + i.price * i.qty, 0); }
function calcTax(subtotal) { return subtotal * 0.1; }
function calcShipping(subtotal) { return subtotal > 5000 ? 0 : 500; }
function checkout(cart) {
  const subtotal = calcSubtotal(cart.items);
  return subtotal + calcTax(subtotal) + calcShipping(subtotal);
}
\`\`\`

**Rename**: 意図が読み取れる名前に
- get → fetch (非同期の場合), retrieve, load を使い分け
- 略語禁止: usr → user, cfg → config, tmp → 具体名

**Early Return**: else の入れ子解消
\`\`\`js
// Before
function foo(x) {
  if (x) { if (x > 0) { return x * 2; } else { return 0; } } else { return -1; }
}
// After
function foo(x) {
  if (!x) return -1;
  if (x <= 0) return 0;
  return x * 2;
}
\`\`\`

**Guard Clause**: 前提条件を先頭に
\`\`\`js
function transfer(from, to, amount) {
  if (!from || !to) throw new Error('accounts required');
  if (amount <= 0) throw new Error('amount must be positive');
  if (from.balance < amount) throw new Error('insufficient funds');
  // ...本処理
}
\`\`\`

**定数化**: マジックナンバー撲滅
\`\`\`js
// Before: if (age >= 20) { ... }
// After:  const LEGAL_ADULT_AGE = 20; if (age >= LEGAL_ADULT_AGE) { ... }
\`\`\`

**Replace Conditional with Polymorphism**: 大きな switch/if 連鎖をオブジェクトマップへ
\`\`\`js
// Before: switch (type) { case 'a': ...; case 'b': ...; }
// After:  const handlers = { a: () => ..., b: () => ... }; handlers[type]();
\`\`\`

### 4. 提示形式
必ず変更前後を並べて理由を書く:
\`\`\`
## 変更点 1: [概要]
### 変更前
[コード]
### 変更後
[コード]
### 理由
- [問題]
- [解決]
- [副次効果]
\`\`\`

## 禁止事項
- 動作を変える「ついでの改善」を混ぜる (それはリファクタでなく新機能)
- パフォーマンスを理由に可読性を落とす (計測してからやれ)
- コメントを全削除 (残すべきコメントもある)
- 一度に 500 行以上変える (レビュー不可能になる)`,

  "DEBUG-SKILL": `# デバッグ・スキル ─ 系統的な原因究明

## 基本方針
バグは「症状」であり「原因」ではない。症状を消すだけの修正は再発する。
必ず根本原因まで辿ってから修正せよ。

## デバッグの 5 段階
### 1. 再現 (Reproduce)
- **再現できないバグは修正できない**。まず 100% 再現する最小手順を確立
- 環境を記録: ブラウザ, OS, データ状態, 入力値
- 最小再現コード (MRE, Minimal Reproducible Example) を js_exec で作成

### 2. 分離 (Isolate)
- バグの発生範囲を絞る: 二分探索的にコードをコメントアウト
- ログ挿入: console.log('[point A]', variable) を要所に配置
- スタックトレースの最上段を確認 (発生源はそこ)

### 3. 仮説 (Hypothesize)
最低 3 つ仮説を立てる (1 つに絞るとバイアスで見誤る):
- 仮説 A: [原因の可能性]
- 仮説 B: [別の可能性]
- 仮説 C: [3 つ目]
検証容易なものから順に潰す

### 4. 検証 (Verify)
- 各仮説を js_exec で 1 つずつ試す
- 「そうだと思う」で終わらせず、実際にコードで確かめる
- 検証結果を記録 (どれが true でどれが false か)

### 5. 修正 (Fix)
- 根本原因への対処コードを書く
- 「symptoms を消すだけ」の修正は禁止 (例: try/catch で例外を握りつぶす等)
- 修正後, MRE を再度 js_exec で流して回帰確認
- 関連コードも同じバグを持っていないか grep で確認

## よくあるバグパターンと対処

### JavaScript
- \`Cannot read property 'x' of undefined\` → 直前で optional chaining (?.) または early return
- \`is not a function\` → import 忘れ, typo, this の束縛失敗
- \`Maximum call stack size exceeded\` → 無限再帰, 終了条件が間違い
- \`Unexpected token\` → 括弧/引用符の対応, JSON parse エラー
- \`Promise not awaited\` → await 忘れ, .then() チェーン中断
- 比較で \`==\` を使う → 常に \`===\` に統一
- \`this\` が undefined → アロー関数化 or bind

### CSS
- レイアウト崩れ → box-sizing: border-box が全体に効いていない
- z-index が効かない → stacking context (position が指定されていない祖先)
- flex/grid の overflow → min-width: 0 を子要素に
- スクロールが 2 重発生 → html/body の overflow を確認
- モバイルで表示崩れ → viewport meta タグ確認

### HTML
- id 重複 → 全ページで id は 1 つのみ
- iframe が空 → sandbox 属性の許可不足, X-Frame-Options
- CORS エラー → サーバ側 Access-Control-Allow-Origin, credentials 設定

### ロジック
- **Off-by-one**: for (let i = 0; i < n; i++) と i <= n の誤用
- **境界条件**: 0 件, 1 件, 最大件数のテスト忘れ
- **タイミング**: DOM ready 前アクセス, race condition
- **状態の共有**: グローバル変数, mutable な引数の書き換え

## エラーメッセージの読み方
- Stack trace: **最上段が発生源**, 下段は呼び出し元
- 行番号: source map があれば正確, なければ minified コードの位置
- 変数名: エラーメッセージに含まれる変数名から場所を特定

## 提出形式
バグ報告と修正は必ず 3 点セットで:
\`\`\`
## バグ原因
[根本原因を 1-2 文で]

## 修正内容
[コード diff or 修正後コード]

## なぜこれで直るか
[技術的理由 + 副次効果 (性能/可読性等) の説明]
\`\`\`

## 禁止事項
- 「動いたからヨシ」で終わる (なぜ動くようになったか説明できないなら未理解)
- try/catch で全てを握りつぶす (原因隠蔽)
- console.log を残したまま提出
- 「原因は謎だが直った」で報告 (原因追究を諦めない)`,

  "API-DESIGN-SKILL": `# API 設計スキル ─ 使いやすく壊れにくい RESTful API

## 設計の順序 (必ずこの順で)
1. **リソース洗い出し**: 名詞ベース (User, Post, Comment, Order)
2. **アクション定義**: 各リソースに CRUD + 特殊操作
3. **URL 設計**: 名詞ベース, 階層は 2 段まで
4. **HTTP メソッド割当**: GET/POST/PUT/PATCH/DELETE
5. **ステータスコード設計**: 成功/失敗/エッジケース全網羅
6. **レスポンス形式統一**: 成功時とエラー時の shape 決定
7. **認証/認可**: 誰が何にアクセスできるか
8. **バージョニング**: /v1/ 前提で開始
9. **レート制限**: エンドポイント/ユーザー単位
10. **ドキュメント化**: OpenAPI (Swagger) スキーマ生成

## URL 設計の原則
- **名詞複数形**: /users (× /user, × /getUsers, × /user-list)
- **リソース ID**: /users/{id} (整数 or UUID, /users/123)
- **サブリソース**: /users/{id}/posts (2 段まで, 3 段以上は別 URL に分割)
- **フィルタ**: /users?status=active&role=admin (クエリパラメータ)
- **ソート**: /users?sort=-created_at (- で降順)
- **ページング**: /users?page=2&per_page=20 or ?cursor=xxx&limit=20
- **アクション例外**: 動詞 URL は極力避けるが, どうしても必要なら /users/{id}/activate 等
- **ケバブケース**: /user-preferences (× /userPreferences, × /user_preferences)

## HTTP メソッドの使い分け
| Method | 用途 | 冪等性 | Body |
|--------|------|--------|------|
| GET | 取得 | Yes | No |
| POST | 作成 or 特殊アクション | No | Yes |
| PUT | 全置換 | Yes | Yes |
| PATCH | 部分更新 | No | Yes |
| DELETE | 削除 | Yes | Optional |

## ステータスコード (完全網羅)
### 成功系
- 200 OK: 通常成功
- 201 Created: 作成成功 (Location ヘッダに新リソース URL)
- 202 Accepted: 非同期処理受付
- 204 No Content: 成功だがボディなし (DELETE 等)

### クライアントエラー
- 400 Bad Request: 一般的な不正リクエスト
- 401 Unauthorized: 未認証 (トークンなし/期限切れ)
- 403 Forbidden: 認証済みだが権限なし
- 404 Not Found: リソース不在
- 405 Method Not Allowed: メソッド非対応
- 409 Conflict: 状態競合 (重複作成等)
- 410 Gone: リソース永久削除済み
- 422 Unprocessable Entity: バリデーションエラー
- 429 Too Many Requests: レート制限

### サーバエラー
- 500 Internal Server Error: 想定外エラー
- 502 Bad Gateway: 上流エラー
- 503 Service Unavailable: メンテナンス/過負荷
- 504 Gateway Timeout: 上流タイムアウト

## レスポンス形式 (統一)
### 成功時
\`\`\`json
{
  "data": { "id": 123, "name": "Alice", "created_at": "2026-01-15T10:00:00Z" },
  "meta": { "request_id": "req_abc123" }
}
\`\`\`
### リスト
\`\`\`json
{
  "data": [ {...}, {...} ],
  "meta": { "page": 1, "per_page": 20, "total": 138 },
  "links": { "next": "/users?page=2", "prev": null }
}
\`\`\`
### エラー
\`\`\`json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email format is invalid",
    "field": "email",
    "details": [ { "field": "email", "reason": "invalid_format" } ]
  }
}
\`\`\`

## 認証
- **Bearer Token (JWT)** が標準: \`Authorization: Bearer <token>\`
- Access Token 短命 (15 分) + Refresh Token 長命 (30 日)
- Refresh Token は httpOnly Cookie で送る (XSS 対策)
- API Key は独自ヘッダ: \`X-API-Key: <key>\`

## セキュリティ必須
- HTTPS 必須 (HTTP redirect)
- CORS: 明示的な origin whitelist (\`*\` 禁止 for authenticated endpoints)
- Rate limit: IP 単位 + ユーザー単位, 429 で Retry-After ヘッダ
- Input validation: 全てのパラメータを型/長さ/形式で検証
- SQL Injection: ORM か prepared statement 必須, 文字列連結禁止
- 秘密情報: レスポンスに含めない (password, api_key 等をログにも出さない)

## バージョニング
- URL 埋込: /v1/users, /v2/users (推奨)
- ヘッダ: Accept: application/vnd.myapi.v1+json (代替)
- Query: /users?version=1 (非推奨)
- Deprecation ヘッダ: \`Deprecation: Sun, 30 Jun 2027 00:00:00 GMT\`

## ドキュメント (OpenAPI 3.1)
- 全エンドポイントに request/response の例を書く
- エラーレスポンスも例示
- 認証方法を securitySchemes で定義
- 変更履歴を CHANGELOG に記載

## 禁止事項
- URL に動詞 (/getUser, /createOrder)
- GET に body を含める
- 秘密情報を URL に (?password=xxx)
- エラーで 200 を返す (成功時のみ 2xx)
- レスポンス shape がエンドポイントごとに違う (統一せよ)`,

  "DATA-ANALYSIS-SKILL": `# データ分析スキル ─ 発見と示唆を導く

## 分析の 5 段階
### 1. 目的定義
- ユーザーは何を知りたいのか? (探索 / 検証 / 予測 / 報告)
- 判断につながる粒度はどこか?
- 想定される結論の形は?

### 2. データ理解
- read_file / extract_data で取得
- **必須確認項目**:
  - 行数, 列数
  - 各列の型 (数値/カテゴリ/日時/テキスト)
  - 欠損値の数と割合
  - 数値列の範囲 (min, max, mean, median, std)
  - カテゴリ列のユニーク値数と分布
  - 重複行の有無
- 先頭 5 行と末尾 5 行を目視 (異常値/フォーマット確認)

### 3. 前処理
- **欠損値**: 削除 or 埋める (数値=中央値, カテゴリ=最頻値, 時系列=前値)
- **外れ値**: IQR (Q1 - 1.5*IQR, Q3 + 1.5*IQR) の外側を確認, 妥当性判断
- **型変換**: 日付文字列 → Date, 数値文字列 → Number
- **正規化**: スケール差の大きい列は必要に応じて標準化

### 4. 分析
- **記述統計**: mean, median, mode, std, quartile
- **分布**: ヒストグラム的な集計 (10 ビン)
- **相関**: 2 変数間の傾向 (Pearson 相関係数)
- **グループ集計**: category 別の統計値比較
- **時系列**: 月/週/日単位の推移, 前年同月比
- **セグメント比較**: 上位 vs 下位, A vs B

### 5. 解釈と提示
- 発見を優先度順に 3-5 個
- **数字だけ提示は禁止**: 必ず「これは何を意味するか」を書く
- グラフで示せる場合は ASCII/mermaid で可視化
- 予期しないパターンには「仮説」として提示 (断定しない)

## JS 実装テンプレート
### CSV パース (シンプル)
\`\`\`js
function parseCSV(text) {
  const lines = text.trim().split(/\\r?\\n/);
  const header = lines[0].split(',').map(s => s.trim());
  return lines.slice(1).map(line => {
    const values = line.split(',');
    return Object.fromEntries(header.map((h, i) => [h, values[i]?.trim()]));
  });
}
\`\`\`

### 数値統計
\`\`\`js
function stats(nums) {
  const clean = nums.filter(n => Number.isFinite(n));
  if (!clean.length) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const sum = clean.reduce((a, b) => a + b, 0);
  const mean = sum / clean.length;
  const variance = clean.reduce((s, x) => s + (x - mean) ** 2, 0) / clean.length;
  return {
    n: clean.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    median: sorted[Math.floor(sorted.length / 2)],
    std: Math.sqrt(variance),
    q1: sorted[Math.floor(sorted.length * 0.25)],
    q3: sorted[Math.floor(sorted.length * 0.75)],
  };
}
\`\`\`

### グループ集計
\`\`\`js
function groupBy(rows, key, aggKey) {
  const groups = {};
  for (const row of rows) {
    const k = row[key];
    if (!groups[k]) groups[k] = [];
    groups[k].push(Number(row[aggKey]));
  }
  return Object.entries(groups).map(([k, vs]) => ({
    key: k,
    count: vs.length,
    ...stats(vs),
  }));
}
\`\`\`

### 相関係数
\`\`\`js
function correlation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}
\`\`\`

## 提示形式
\`\`\`
## サマリ
[3 行以内で結論]

## 主要な発見
### 1. [発見のタイトル]
[数値 + 意味 + 示唆]
### 2. [...]
### 3. [...]

## データ概要
| 項目 | 値 |
|------|------|
| 行数 | 12,847 |
| 期間 | 2025-01-01 〜 2025-12-31 |
| 欠損率 | 2.3% (email 列のみ) |

## 詳細分析
[必要に応じて表/グラフ]

## 推奨アクション (任意)
- [発見から導かれる次の一手]
\`\`\`

## 禁止事項
- 数字を並べただけで解釈なし
- 「なんとなく増えている」等の曖昧表現 (%変化を出せ)
- 外れ値を勝手に除外して報告 (除外は明示)
- 母数を書かずに割合だけ (500 人中 30% と 5 人中 30% は違う)
- 相関を因果と混同`,

  "SYSTEM-DESIGN-SKILL": `# システム設計スキル ─ スケール可能な設計を導く

## 設計インタビューのフレームワーク (7 ステップ)
### 1. 要件明確化 (5-10 分相当)
- **機能要件**: 何ができるか (箇条書き 3-7 項目)
- **非機能要件**:
  - 想定 DAU / MAU
  - QPS (read : write の比率)
  - データ量 (総量, 日次増加)
  - レイテンシ SLA (p50, p95, p99)
  - 可用性 (99.9% = 8.76h/年 停止, 99.99% = 52.6min/年)
  - Consistency 要求 (Strong vs Eventual)

### 2. キャパシティ試算 (必ず数字で)
- QPS: DAU × 平均操作数 / (86400 × 0.2)  ※ 20% がピーク時間帯に集中と仮定
- Storage: 行サイズ × 行数 × 3 (レプリカ) × 2 (インデックス等)
- 帯域幅: QPS × 平均レスポンスサイズ
- 例: 100万 DAU, 1人 100 ops/日 → 100M ops/日 → ピーク 5,700 QPS

### 3. API 設計
- 主要 3-7 エンドポイント
- リクエスト/レスポンス shape
- 認証方式

### 4. データモデル
- 主要エンティティ 3-5 個
- リレーション (1-N, N-M)
- インデックス設計 (よく WHERE/ORDER BY される列)
- パーティショニング/シャーディング戦略

### 5. アーキテクチャ図
mermaid で描く:
\`\`\`mermaid
graph TD
  Client[Client] --> CDN[CDN CloudFront]
  CDN --> LB[Load Balancer]
  LB --> API1[API Server]
  LB --> API2[API Server]
  API1 --> Cache[(Redis Cluster)]
  API1 --> DB[(PostgreSQL Primary)]
  DB --> Replica[(Read Replica x3)]
  API1 --> Queue[SQS/Kafka]
  Queue --> Worker[Background Worker]
  Worker --> S3[(Object Storage)]
\`\`\`

### 6. スケーリング戦略
- **垂直**: サーバー強化 (簡単だが上限あり)
- **水平**: サーバー数増 (LB 必須)
- **DB**: read replica → sharding → NoSQL 検討
- **Cache**: L1 (CDN) / L2 (Redis) / L3 (application cache)
- **非同期化**: 重い処理は Queue 経由でバックグラウンド

### 7. 信頼性・運用
- 冗長化: マルチ AZ, マルチ リージョン
- フェイルオーバー: DB primary 障害時の自動昇格
- モニタリング: メトリクス (RED: Rate/Errors/Duration) + ログ + トレース
- アラート: SLA 違反しそうな時点で通知
- Chaos Engineering: 定期的に部分障害を故意発生

## 定番パターン

### キャッシュ戦略
- **Cache-aside** (最も汎用): アプリが cache miss 時に DB 読み込み
- **Write-through**: 書き込み時にキャッシュも更新
- **Write-behind**: 書き込みは即キャッシュ, DB は非同期
- **Refresh-ahead**: TTL 切れ前に先回りで更新

### キューパターン
- **単純ワーカー**: SQS + Consumer
- **Pub/Sub**: Kafka topic + 複数 subscriber
- **バックプレッシャー**: consumer 遅延時に producer 減速
- **DLQ (Dead Letter Queue)**: 失敗メッセージを別 queue に隔離
- **冪等性**: 同じメッセージが 2 回来ても大丈夫にする (message_id で dedupe)

### ロードバランス
- **L4 (TCP)**: 高速, セッションアフィニティ不可
- **L7 (HTTP)**: パス/ヘッダで振り分け可能
- **Sticky Session**: 同一ユーザー同一サーバー (状態持つ場合)
- **アルゴリズム**: Round Robin, Least Connection, IP Hash

### DB スケーリング
1. **Read Replica**: 読みだけ複製 (書きは primary)
2. **Vertical Partition**: 列を別テーブルに分ける
3. **Horizontal Sharding**: 行を key で分ける (user_id % N)
4. **NoSQL 移行**: key-value (DynamoDB), document (MongoDB), column-family (Cassandra)

### CAP 定理
- **CA**: 単一マスター RDB (パーティション耐性なし)
- **CP**: MongoDB, HBase (可用性犠牲)
- **AP**: Cassandra, DynamoDB (整合性は eventual)
- **選択基準**: 銀行=CP, SNS=AP, 内部管理系=CA

### CDN 活用
- 静的アセット (画像/CSS/JS)
- 動画配信
- Edge computing (Lambda@Edge, Cloudflare Workers)
- キャッシュ制御: Cache-Control, ETag

## トレードオフの明示
設計提案時は必ず対立軸を書く:
- Consistency vs Availability (CAP)
- Latency vs Throughput
- Cost vs Performance
- Complexity vs Flexibility
- Development speed vs Long-term maintainability

## 提示形式
\`\`\`
## 問題設定
[機能/非機能要件のサマリ]

## キャパシティ試算
- DAU: XX万 → QPS peak: XX
- Storage: XX TB/年

## API 設計
[主要エンドポイント一覧]

## データモデル
[主要テーブル + リレーション]

## アーキテクチャ
[mermaid 図]

## スケーリング
[段階的成長時の対応]

## 信頼性
[SLA, フェイルオーバー, 監視]

## 選定理由と代替案
- 選定: PostgreSQL (理由: ...)
- 代替: MySQL (使わなかった理由: ...)
\`\`\`

## 禁止事項
- 数字なしの設計 (必ず概算する)
- 「マイクロサービス」を万能薬扱い (単純問題ならモノリスで十分)
- 最新技術を無条件推薦 (トレードオフを説明)
- SPoF (Single Point of Failure) の見落とし`,

  "ALGORITHM-SKILL": `# アルゴリズム・スキル ─ 正しく高速に実装する

## 実装前の必須ステップ
1. **問題定義**: 入力 → 出力を 1 行で書く
2. **制約確認**: N の範囲, 値の範囲, 時間制限
3. **計算量目安**: 
   - N ≤ 20: 指数 O(2^N)
   - N ≤ 500: O(N^3)
   - N ≤ 5000: O(N^2)
   - N ≤ 10^6: O(N log N)
   - N ≤ 10^8: O(N)
   - N > 10^8: O(log N) or O(1)
4. **アルゴリズム選定**: 制約から逆算して選ぶ
5. **エッジケース列挙**: 0 要素, 1 要素, 重複, 境界値

## カテゴリ別 実装テンプレート

### 探索: Binary Search
\`\`\`js
function binarySearch(arr, target) {
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] === target) return mid;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
// lower_bound (target 以上の最初のインデックス)
function lowerBound(arr, target) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
\`\`\`

### 探索: DFS / BFS
\`\`\`js
// DFS 再帰
function dfs(graph, start, visited = new Set()) {
  if (visited.has(start)) return;
  visited.add(start);
  for (const next of graph[start] || []) dfs(graph, next, visited);
  return visited;
}
// BFS iterative
function bfs(graph, start) {
  const visited = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const node = queue.shift(); // 大きい graph なら deque 実装推奨
    for (const next of graph[node] || []) {
      if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
  return visited;
}
\`\`\`

### 最短路: Dijkstra (優先度キュー版)
\`\`\`js
class MinHeap {
  constructor() { this.data = []; }
  push(x) { this.data.push(x); this._up(this.data.length - 1); }
  pop() {
    const top = this.data[0], last = this.data.pop();
    if (this.data.length) { this.data[0] = last; this._down(0); }
    return top;
  }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p][0] <= this.data[i][0]) break;
      [this.data[i], this.data[p]] = [this.data[p], this.data[i]]; i = p;
    }
  }
  _down(i) {
    const n = this.data.length;
    while (true) {
      const l = 2 * i + 1, r = l + 1;
      let smallest = i;
      if (l < n && this.data[l][0] < this.data[smallest][0]) smallest = l;
      if (r < n && this.data[r][0] < this.data[smallest][0]) smallest = r;
      if (smallest === i) break;
      [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]]; i = smallest;
    }
  }
  get size() { return this.data.length; }
}
function dijkstra(graph, start, N) {
  const dist = Array(N).fill(Infinity); dist[start] = 0;
  const heap = new MinHeap(); heap.push([0, start]);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > dist[u]) continue;
    for (const [v, w] of graph[u] || []) {
      if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; heap.push([dist[v], v]); }
    }
  }
  return dist;
}
\`\`\`

### DP: 動的計画法テンプレート
\`\`\`js
// メモ化 (top-down)
function fibMemo(n, memo = {}) {
  if (n < 2) return n;
  if (memo[n] !== undefined) return memo[n];
  return memo[n] = fibMemo(n - 1, memo) + fibMemo(n - 2, memo);
}
// 表 (bottom-up), Knapsack 0/1
function knapsack(weights, values, capacity) {
  const n = weights.length;
  const dp = Array.from({length: n+1}, () => Array(capacity+1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let w = 0; w <= capacity; w++) {
      dp[i][w] = dp[i-1][w];
      if (w >= weights[i-1]) {
        dp[i][w] = Math.max(dp[i][w], dp[i-1][w - weights[i-1]] + values[i-1]);
      }
    }
  }
  return dp[n][capacity];
}
\`\`\`

### Union-Find (Disjoint Set)
\`\`\`js
class UnionFind {
  constructor(n) {
    this.parent = Array.from({length: n}, (_, i) => i);
    this.rank = Array(n).fill(0);
  }
  find(x) {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }
  union(x, y) {
    const px = this.find(x), py = this.find(y);
    if (px === py) return false;
    if (this.rank[px] < this.rank[py]) this.parent[px] = py;
    else if (this.rank[px] > this.rank[py]) this.parent[py] = px;
    else { this.parent[py] = px; this.rank[px]++; }
    return true;
  }
}
\`\`\`

### ゲーム AI: Minimax + Alpha-Beta
\`\`\`js
function minimax(state, depth, alpha, beta, maximizing) {
  if (depth === 0 || isTerminal(state)) return evaluate(state);
  const moves = generateMoves(state, maximizing ? PLAYER : OPPONENT);
  // Move ordering (角優先など) で剪定効率 up
  moves.sort((a, b) => movePriority(b) - movePriority(a));
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
\`\`\`

### 文字列: KMP (パターン検索)
\`\`\`js
function kmpTable(pattern) {
  const table = [0];
  let prefix = 0;
  for (let i = 1; i < pattern.length; i++) {
    while (prefix > 0 && pattern[i] !== pattern[prefix]) prefix = table[prefix - 1];
    if (pattern[i] === pattern[prefix]) prefix++;
    table.push(prefix);
  }
  return table;
}
function kmpSearch(text, pattern) {
  const table = kmpTable(pattern);
  const results = [];
  let j = 0;
  for (let i = 0; i < text.length; i++) {
    while (j > 0 && text[i] !== pattern[j]) j = table[j - 1];
    if (text[i] === pattern[j]) j++;
    if (j === pattern.length) { results.push(i - j + 1); j = table[j - 1]; }
  }
  return results;
}
\`\`\`

### 数論: GCD, 素数篩
\`\`\`js
function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
function lcm(a, b) { return a * b / gcd(a, b); }
function sieve(n) {
  const isPrime = Array(n + 1).fill(true);
  isPrime[0] = isPrime[1] = false;
  for (let i = 2; i * i <= n; i++) {
    if (isPrime[i]) for (let j = i * i; j <= n; j += i) isPrime[j] = false;
  }
  return isPrime.map((v, i) => v ? i : -1).filter(x => x > 0);
}
\`\`\`

## 実装時の注意
- **整数オーバーフロー**: JS の Number は 2^53 まで安全, 超えるなら BigInt
- **浮動小数点比較**: === でなく Math.abs(a - b) < 1e-9
- **配列コピー**: [...arr] は shallow, deep なら structuredClone(arr)
- **再帰スタック**: 深さ 10^4 超えると stack overflow, iterative へ変換
- **Off-by-one**: 半開区間 [l, r) を意識する

## 提出前セルフチェック
1. 制約 (N の上限) で TLE しないか, 計算量を再確認
2. エッジケース (空配列, 単一要素, 全同値, 最大値) が pass するか
3. 変数名が「アルゴリズム由来」で読み手にも通じるか
4. 再帰の終了条件が明確か
5. テストコードを 3 パターン以上書いて確認`,

  "TESTING-SKILL": `# テスト・スキル ─ 信頼できるソフトウェアの土台

## テスト戦略の全体像 (テストピラミッド)
- **Unit (70%)**: 純粋関数, 個別モジュール, 高速, 大量
- **Integration (20%)**: モジュール間, DB/API 連携, 中速
- **E2E (10%)**: ユーザーフロー全体, 遅い, 少数
- **Static (常時)**: TypeScript, ESLint, 型検査

新規機能を書いたら, まず Unit を厚く, Integration を要所, E2E は主要フローのみ。

## テストケース設計の原則
### 3 象限法
- **正常系**: 想定通りの入力 (happy path)
- **境界値**: 0, 1, 最大, 最小, 境界の前後
- **異常系**: null, undefined, 型違い, 空, 権限違反

### AAA パターン
\`\`\`js
test('should calculate total with tax', () => {
  // Arrange
  const items = [{ price: 100, qty: 2 }, { price: 50, qty: 1 }];
  const taxRate = 0.1;
  // Act
  const total = calcTotal(items, taxRate);
  // Assert
  expect(total).toBe(275);
});
\`\`\`

### 1 テスト 1 検証
- 1 つの test() には 1 つの主張のみ
- 複数の側面をテストしたければテストを分ける
- 失敗時にどこが壊れたか一目瞭然にする

## js_exec で軽量テストを書く
\`\`\`js
// シンプルアサーション
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); throw new Error(msg); }
  console.log('PASS:', msg);
}
function assertEqual(actual, expected, msg) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) {
    console.error('FAIL:', msg, '\\nExpected:', expected, '\\nActual:', actual);
    throw new Error(msg);
  }
  console.log('PASS:', msg);
}
function assertThrows(fn, msg) {
  try { fn(); console.error('FAIL:', msg, '(no throw)'); throw new Error(msg); }
  catch { console.log('PASS:', msg); }
}

// テスト対象
function divide(a, b) {
  if (b === 0) throw new Error('divide by zero');
  return a / b;
}

// テスト
assertEqual(divide(10, 2), 5, 'basic division');
assertEqual(divide(-10, 2), -5, 'negative dividend');
assertEqual(divide(0, 5), 0, 'zero dividend');
assertThrows(() => divide(1, 0), 'zero divisor throws');
console.log('All tests passed');
\`\`\`

## テストダブル (モック等)
- **Stub**: 決まった値を返す (依存を制御)
- **Mock**: 呼び出し記録を検証 (spy behavior)
- **Fake**: 簡易実装 (in-memory DB 等)
- **Spy**: 実際の関数を呼びつつ記録

Jest 例:
\`\`\`js
const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: () => ({ id: 1 }) });
global.fetch = fetchMock;
await getUser(1);
expect(fetchMock).toHaveBeenCalledWith('/api/users/1');
\`\`\`

## テストが書きにくいコードの特徴 (=リファクタ候補)
- 深い依存関係 (5 つ以上のモジュールに依存)
- グローバル状態への依存 (Date.now, Math.random 直接呼び出し)
- 副作用が多い (DB 書き込み, ファイル IO を関数内で直接)
- コンストラクタが重い (DI で外部から注入せよ)
- 隠れた状態 (private field を触りたい = 設計悪い)

## カバレッジの解釈
- 80% 前後を目標に (100% は費用対効果悪い)
- **Line coverage** より **Branch coverage** を重視 (if/else の全枝)
- 高カバレッジ = 良テストではない (質を確認)
- 「テストを書いた」ことに満足せず, 「バグを見つけられるか」で評価

## E2E テストの原則
- **ユーザー視点で書く**: 「ログインしてカートに商品を入れて決済する」
- **選択子は堅牢に**: data-testid 属性, aria-label で選ぶ (CSS class 選択は脆い)
- **待機は明示的に**: sleep(1000) 禁止, waitFor(element visible)
- **独立性**: テスト間で状態を共有しない (beforeEach で初期化)
- **並列化を意識**: 同じ user アカウントを複数テストで使わない

## パフォーマンステスト
- **ベンチマーク**: 実行時間の測定 (console.time / performance.now)
- **プロファイル**: どの関数が遅いか特定 (Chrome DevTools Performance タブ)
- **負荷テスト**: 大量並行アクセス (k6, Locust)
- **メモリリーク**: 長時間実行してメモリ増加傾向確認

## 提出前セルフチェック
1. **正常系/境界/異常系** の 3 種類が揃っているか
2. テスト名が「何をテストしているか」明確か (should_XX_when_YY 形式推奨)
3. 各テストは独立して単体でも動くか
4. モックを使いすぎて実装詳細に依存していないか
5. テストがコードの仕様書になっているか (テストを読めば挙動がわかる)

## 禁止事項
- テストなしでリリース ("後で書く" は永久にやらない)
- console.log を assert 代わりにする (自動チェックにならない)
- try/catch で全部握りつぶすテスト
- テストの中にランダム性 (Math.random) を入れる (再現性欠如)
- 実装をコピペしただけの意味ないテスト`,
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
