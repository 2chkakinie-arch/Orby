// ============================================================================
// Orby v6 — Autonomous Coding Agent Backend
// ----------------------------------------------------------------------------
// Key improvements over v5:
//   1. Skills fully rewritten as domain-agnostic, production-grade playbooks
//      (no more Othello-only GAME-DEV, no more "Claude design is best" fluff).
//   2. Skills are STRICTLY opt-in: they are never auto-injected into the
//      system prompt. Only load_skill actually enables a skill for that
//      session, and skill content is delivered exclusively as a tool_result.
//   3. Large-output auto-routing: when the model is asked for a big artifact
//      (long code, full app, full report), the request is routed to
//      felo-chat / gpt-4o class models with enough output budget.
//   4. Streaming firehose control: while an assistant is emitting a huge code
//      artifact, deltas are throttled after a threshold so the browser chat
//      pane doesn't get flooded with hundreds of KB of text. The full text
//      is still captured server-side, and the artifact is delivered via
//      file_upload -> a single link.
//   5. Same 14 tools kept, forgiving parser kept, but tool_result feedback
//      no longer leaks skill names that could bait the model into loading
//      unrelated skills.
// ============================================================================

const express = require("express");
const cors    = require("cors");
const fetch   = require("node-fetch");
const path    = require("path");
const vm      = require("vm");
const crypto  = require("crypto");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

const NIE_BASE      = "https://nie-ai.vercel.app/api";
const DEFAULT_MODEL = "scira-gemini-3.1-flash-lite";

// Models that can safely emit very large outputs (long code, long reports).
// Ordered by preference for large-output escalation.
const LARGE_OUTPUT_MODELS = ["felo-chat", "gpt-4o", "scira-nemotron-3-super"];

// Runtime state (per-process; the frontend keeps conversation state).
const SHORTCUTS       = new Map(); // @alias -> content
const UPLOADED_FILES  = new Map(); // fileId -> { name, content, mime }
const ATTACHMENTS     = new Map(); // attachmentId -> { name, content, mime, size }
const MEMORY          = new Map(); // sessionless key/value memory

// ============================================================================
// SKILLS — v6 rewrite.
// ----------------------------------------------------------------------------
// Design rules for every skill below:
//   - Domain-general. NEVER pin the whole skill to a single example (the
//     v5 GAME-DEV skill was 90% Othello — that made every game feel like a
//     bad Othello clone). A skill must be applicable to the whole domain.
//   - "Why -> How -> What -> Checklist -> Anti-patterns" structure.
//   - Include at least one implementable code sketch or template so the
//     LLM has something to anchor to instead of hallucinating.
//   - No cheerleading. No "Claude's design is the best". Skills are
//     engineering references, not opinions.
// ============================================================================
const SKILLS = {

// ─────────────────────────────────────────────────────────────────────────────
"UI-SKILL": `# UI-SKILL — Interface Design Playbook (production grade)

## When to load
Load this when the user asks for a UI, a landing page, a dashboard, a form,
a chat interface, a design refresh, or any HTML/CSS/JS artifact where visual
quality matters. Do NOT load for pure backend / algorithm / data tasks.

## Non-negotiable principles
1. Reduce, do not decorate. Every element must earn its place.
2. Consistency > cleverness. Reuse spacing/color/typography tokens.
3. Accessible by default: color contrast >= 4.5:1 on body text, focus ring
   visible on every focusable element, hit targets >= 40x40 on touch.
4. Motion is feedback, not garnish. 120-220ms, cubic-bezier(.4,0,.2,1),
   only on state change (hover / active / enter / exit). Never on idle.
5. Dark theme first, but design the light theme too — do NOT ship a UI
   that breaks when prefers-color-scheme flips.

## Design tokens (use CSS custom properties)
Define these once at :root and never hard-code raw values in components.

  --bg-0 / --bg-1 / --bg-2 / --bg-3    Layered surface tones
  --text-1 / --text-2 / --text-3       Primary / secondary / tertiary text
  --border-1 / --border-2              Hairline / stronger divider
  --accent / --accent-weak / --accent-strong
  --danger / --warning / --success / --info
  --radius-sm (6-8) / --radius-md (10-12) / --radius-lg (14-16)
  --shadow-1 / --shadow-2 (soft, not black bars)
  --dur-fast (120ms) / --dur-med (180ms) / --dur-slow (260ms)
  --ease (cubic-bezier(.4,0,.2,1))
  Spacing scale (px): 4 8 12 16 20 24 32 40 56 72

## Typography
- System stack: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif.
- Type scale (px, 1.25 ratio, adjust for density):
  H1 32/700/-.02em   H2 24/650/-.015em   H3 18/600/-.01em
  Body 14.5/400/1.6  Small 12.5/500       Mono 12.5 ui-monospace
- Never use more than 3 weights in a single view.

## Color usage
- One accent hue at most. If the domain absolutely needs two, one must be
  a semantic pair (success + danger). Rainbow palettes are a smell.
- Text on colored backgrounds must be tested for AA contrast.
- Borders: rgba(255,255,255,.06) hairline, rgba(255,255,255,.12) divider,
  rgba(255,255,255,.20) emphasis. Mirror for light mode.

## Layout
- CSS Grid for page structure, Flex for row/column of components.
- Never position:absolute for layout — only for popovers/tooltips/toasts.
- Max reading measure ~72ch for prose, ~640-800px for chat, dashboards use
  a 12-col grid with 16-24px gutter.
- Respect safe-area-inset-* on mobile (notch / home indicator).

## Component patterns to reach for
- Button: solid | outline | ghost | icon. Loading state built in.
- Input: with prefix/suffix slot, error state, helper text.
- Card: subtle border + inner padding 16-20px, hover raises 1px + border tint.
- Toast: bottom-right on desktop, bottom on mobile, auto-dismiss 4-6s,
  actionable ones get an explicit close.
- Modal: overlay rgba(0,0,0,.55) + backdrop-filter blur(6px) + focus trap.
- Empty state: illustration OR icon + one-line reason + primary action.

## Micro-interaction recipe
- hover:    translateY(-1px), border color +1 step, no big shadow jump.
- active:   scale(.97-.99), remove translate.
- focus:    outline 0; box-shadow: 0 0 0 3px var(--accent) at ~30% alpha.
- appear:   opacity 0->1 + translateY(4px->0) over 180ms.
- CTA glow: 0 8px 24px accent at 22% alpha, only for the primary action.

## Quality checklist before shipping
[ ] Every interactive element has hover + active + focus + disabled state.
[ ] Keyboard traversal works (Tab / Shift-Tab / Enter / Escape / arrows).
[ ] Screen reader labels for icon-only buttons (aria-label).
[ ] 320px width still usable, 1440px doesn't feel empty.
[ ] No layout shift when data loads (reserve space, skeleton if needed).
[ ] Empty / loading / error states designed, not just the happy path.

## Anti-patterns (auto-reject)
- Multi-color gradients as page background.
- Centered card with no context and 800px of empty space around it.
- Buttons without hover feedback.
- Placeholder text used as label (accessibility regression).
- Custom scrollbars that hide overflow indication.
- Icons at 12px unlabeled — nobody knows what they do.`,

// ─────────────────────────────────────────────────────────────────────────────
"CODING-SKILL": `# CODING-SKILL — Production coding playbook

## When to load
For any request that produces non-trivial code (>100 lines, or touching
persistence / auth / async / concurrency / performance). Skip for
one-liners, quick snippets, or pseudo-code explanations.

## Core rules
1. Ship complete, runnable code. No "// TODO", no "// implement this",
   no ellipsis placeholders inside the artifact you deliver.
2. Handle the failure paths first: null / undefined / empty / oversize
   input / network error / permission denied / concurrent mutation.
3. Prefer standard library. Third-party deps require a real reason.
4. Names are self-documenting. Comments explain *why*, not *what*.
5. Small units. A function > ~50 logical lines is a design smell.

## Language defaults
- JavaScript/TypeScript: ES2022+, strict mode, no var, use ?. and ??,
  async/await over then-chains, top-level try/catch on entry points.
- Python: 3.11+, type hints on public APIs, f-strings, pathlib over os.path,
  contextlib for resources.
- Go: err != nil handled every time, context.Context threaded through I/O.
- Rust: no unwrap in library code; ? operator + typed errors (thiserror).

## Async / concurrency discipline
- Never fire and forget. Every promise/task is awaited or explicitly
  detached with a documented reason and error sink.
- Bound concurrency (Promise.all of thousands of fetches will DOS the peer;
  use a p-limit / semaphore pattern).
- On the browser: AbortController for every fetch tied to a component life.
- Cancellation propagates. If the caller aborts, downstream stops.

## Error handling
- Throw *specific* error types with context.
  class NotFoundError extends Error { constructor(k){ super("not found: "+k); this.code="NOT_FOUND"; } }
- At API boundaries: convert to structured error envelopes:
  { error: { code, message, retryable, cause } }
- Retry only idempotent operations. Exponential backoff + jitter.

## Testing (bare minimum before you claim "done")
- One happy-path test.
- One boundary test (empty, one, many, max).
- One failure test (bad input triggers the right error type).
- If you can't run the test in this environment, write it anyway and mark
  where the user should run it.

## Delivery form
- Small change: inline fenced code block.
- Full file / app / >150 lines: file_upload as an artifact and return the
  link. Do NOT paste 500 lines into chat — it destroys the UX and often
  gets truncated by the model.

## Anti-patterns to reject on sight
- Silent catch { } that swallows errors.
- Using == in JS or bare except: in Python.
- Deep nesting (>3 levels) instead of early return.
- Global mutable state accessed from many modules.
- Magic strings/numbers repeated more than twice — extract a constant.
- One function doing fetching + parsing + rendering + business logic.

## Pre-flight checklist
[ ] Mentally executed the happy path start-to-finish.
[ ] Mentally executed one failure path.
[ ] Considered concurrency (two calls at once — safe?).
[ ] Considered performance for the realistic input size.
[ ] Considered how someone reads this six months later.`,

// ─────────────────────────────────────────────────────────────────────────────
"GAME-DEV-SKILL": `# GAME-DEV-SKILL — Single-file HTML game playbook (domain-general)

## When to load
For any game request: board games (chess/othello/go/checkers/gomoku),
arcade (snake/tetris/breakout/pong/pacman), puzzles (2048/sudoku/minesweeper/
sokoban), platformers, shooters, card games. NOT for non-game UIs.

## Non-negotiable architecture
Every game must have these five concerns, kept SEPARATE:
  1. STATE       Immutable-style snapshot: board, entities, score, phase.
  2. INPUT       Keyboard + mouse + touch, all normalized to actions.
  3. LOGIC       Pure functions: (state, action) -> nextState.
  4. RENDER      (state) -> DOM/canvas. No logic here.
  5. LOOP        requestAnimationFrame with delta-time. Fixed timestep for
                 physics if the game has physics (accumulator pattern).

Never mix render into logic. Never mutate state inside render.

## Game loop template
    let last = performance.now(), acc = 0, STEP = 1000/60;
    function frame(now){
      acc += now - last; last = now;
      while (acc >= STEP) { state = step(state, STEP/1000); acc -= STEP; }
      render(state, acc/STEP); // interpolation factor
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

## Input handling
- Register key state on keydown/keyup, do NOT act inside the event.
  The loop reads the input snapshot each tick. This kills input lag AND
  double-fire bugs.
- Touch: pointerdown/pointermove/pointerup + preventDefault on the canvas.
- Mouse coord translation: rect = canvas.getBoundingClientRect();
  x = (e.clientX-rect.left)*canvas.width/rect.width;

## Rendering
- Canvas 2D is enough for most 2D games. Use CSS transforms only for UI.
- devicePixelRatio: canvas.width = cssW*dpr; canvas.height=cssH*dpr;
  ctx.scale(dpr,dpr); — otherwise everything is blurry on Retina.
- Never call getImageData in the hot path.
- Layer: background (static, drawn once to an offscreen canvas), entities,
  particles, UI overlay.

## AI for turn-based games
Board games need a real AI, not random moves.
  - Minimax with alpha-beta pruning for chess/othello/gomoku (depth 3-6
    depending on branching factor).
  - Iterative deepening + move ordering (killer move, MVV-LVA for chess,
    corner-first for othello) for practical strength.
  - Transposition table with Zobrist hashing when depth > 4.
  - Evaluation: material + mobility + positional table + game-phase weights.
  - Time budget per move, not fixed depth (return best-so-far on timeout).

Minimax template:
    function search(state, depth, a, b, maximizing){
      if (depth===0 || terminal(state)) return evaluate(state);
      const moves = order(legal(state));
      if (maximizing){
        let best = -Infinity;
        for (const m of moves){
          best = Math.max(best, search(apply(state,m), depth-1, a, b, false));
          a = Math.max(a, best);
          if (a >= b) break;
        }
        return best;
      } else {
        let best = Infinity;
        for (const m of moves){
          best = Math.min(best, search(apply(state,m), depth-1, a, b, true));
          b = Math.min(b, best);
          if (a >= b) break;
        }
        return best;
      }
    }

## Real-time game AI
- Snake / arcade opponents: BFS or A* on a grid.
- Platformer enemies: state machine (patrol / chase / attack / stunned).
- Pathfinding: A* with Manhattan heuristic on grids, Euclidean on open maps.

## Physics (for arcade / platformer)
- Fixed timestep (see loop above). Variable step -> tunneling bugs.
- AABB collision: axis-separated resolution; resolve X, then Y.
- Gravity ~ 1200 px/s^2, jump impulse ~ -450 px/s for a "feels right" jump.
- Coyote time (~80ms) and jump buffer (~120ms) massively improve feel.

## Universal UI a game must have
- Title screen (or instant start with hint overlay).
- Score / lives / timer / turn indicator, always visible.
- Pause (Space or Escape) with a semi-transparent overlay.
- Game over with final score + restart button.
- Difficulty selector when meaningful (turn-based, arcade with speed).
- Mobile controls: on-screen d-pad + action buttons, only shown on
  coarse pointer (@media (pointer:coarse)).

## Balance & feel checklist
[ ] The game is fun in the first 15 seconds (no long menu).
[ ] Player understands the controls without reading a manual.
[ ] Failure is legible ("you died because X"), not mysterious.
[ ] Difficulty ramps: session 1 winnable, session 10 still interesting.
[ ] Audio feedback exists (WebAudio: beep on action, thud on hit).
[ ] Colorblind-safe (do not rely on red vs green alone).

## Anti-patterns (auto-reject)
- Board game with random-move "AI".
- Physics inside the render loop with variable dt.
- Mutating state during rendering.
- No pause, no restart, no mobile controls.
- Under ~350 lines and no separation of concerns — that's a demo, not a game.`,

// ─────────────────────────────────────────────────────────────────────────────
"WEB-RESEARCH-SKILL": `# WEB-RESEARCH-SKILL — Evidence-based research playbook

## When to load
For any question that requires up-to-date facts, current events, product
comparisons, API/library docs, or claims that must be verifiable.
Skip for pure reasoning / math / coding tasks.

## Core loop
1. Formulate a precise query (include a year for time-sensitive topics).
2. web_search with 5-8 results.
3. Rank sources: official docs > primary sources > established outlets >
   Wikipedia > random blogs > SEO farms.
4. In ONE round, fire html_fetch in parallel on the top 2-4 URLs.
5. Cross-check at least two independent sources for any load-bearing claim.
6. Answer with inline citations [Source](URL).

## Source quality signals (positive)
- Official documentation (react.dev, python.org, kubernetes.io, IETF RFCs).
- Original announcements (company blog, GitHub release notes).
- Reputable outlets (Ars Technica, IEEE Spectrum, NYT/Reuters/BBC for news).
- Peer-reviewed papers (arxiv is preprint — flag as such).

## Source quality signals (negative — treat with suspicion)
- "Top 10 X in 2019" listicles with adsense-heavy layouts.
- Content that reads like it was generated by an LLM (vague, no dates,
  no author, hedged everywhere).
- Aggregators that just paraphrase the primary source with worse detail.
- Old dates on time-sensitive claims (LLMs regurgitate 2021 stats a lot).

## Handling conflicts
- Two sources disagree -> pull a third. If still split, present both with
  the disagreement flagged.
- Numbers differ -> prefer the primary source (company report, official
  API), timestamp the figure.

## Citation format
- Inline: "React 19 introduces Actions [React blog](https://react.dev/blog/...)."
- End of answer: "## Sources" list, deduplicated, with title.

## Anti-patterns
- Answering from memory when a search would resolve it.
- One search, no fetch — the snippet is not the article.
- Citing the search-results page instead of the actual article.
- Copy-pasting a paragraph from a source (paraphrase or quote-with-attribution).`,

// ─────────────────────────────────────────────────────────────────────────────
"PARALLEL-THINK-SKILL": `# PARALLEL-THINK-SKILL — Multi-model deliberation playbook

## When to load
For decisions with tradeoffs, not for factual lookups. Examples:
- "Which architecture: monolith vs microservices vs modular monolith?"
- "React vs Vue vs Svelte for this specific team?"
- "How should I structure this DB — 3NF or denormalize?"
- "Design an eviction policy for this cache."
Skip for questions with a single correct answer.

## How to use parallel_think effectively
- Frame ONE decision, not five. Multi-question prompts fragment answers.
- List the axes of comparison explicitly: performance, dev velocity,
  ecosystem, team skills, migration cost, operational load.
- Set a length limit (e.g. "answer in under 200 words") so responses stay
  comparable.
- Pick 3 diverse models: a reasoning-heavy one (nemotron / deepseek-r1),
  a general (gpt-4 / gpt-4o), and a fast contrarian (gemini/flash).

## Synthesis method
1. List each model's *conclusion* in one line.
2. Highlight where they *agree* — that's high-confidence signal.
3. Highlight where they *disagree* — that's the real design question,
   not a solved problem.
4. Do not average opinions. Weigh by the *quality of reasoning* offered.
5. Deliver YOUR final recommendation with the tradeoff acknowledged.

## Anti-patterns
- Using parallel_think for "what is the capital of France" — waste.
- Summing 3 answers into a bland consensus that hides the real conflict.
- Asking each model to just "write the code" — you'll get 3 incompatible
  code drafts. Use it to decide, then have one model implement.`,

// ─────────────────────────────────────────────────────────────────────────────
"IMAGE-SKILL": `# IMAGE-SKILL — Image generation prompt playbook

## When to load
When the user requests an image, illustration, poster, thumbnail, hero,
character portrait, or product mockup. Skip for text-only tasks.

## Prompt formula
  [SUBJECT] , [ACTION/POSE] , [SETTING] , [STYLE] , [LIGHTING] ,
  [CAMERA/COMPOSITION] , [MOOD] , [NEGATIVES via "no <thing>"]

Concrete example:
  "a lone lighthouse on a rocky cape, waves breaking on cliffs below,
   overcast dusk, oil-painting style with visible brushstrokes,
   soft rim light from the west, wide low-angle composition rule-of-thirds,
   somber and heroic mood, no text, no watermark"

## Style vocabulary (pick ONE family per image)
- Photoreal:  cinematic photorealism / editorial photography / 35mm film /
              medium-format portrait / documentary.
- Illustrated: watercolor / gouache / ink wash / children's-book / cel-shaded
              anime / retro comic halftone / vector flat.
- 3D-render:  octane render / unreal engine 5 / cinema 4d / blender cycles /
              claymation.
- Painterly:  oil on canvas / impressionist / art nouveau / ukiyo-e woodblock.

Mixing families ("photoreal watercolor anime") produces mush. Stop.

## Lighting vocabulary
- golden hour, blue hour, overcast, harsh midday, moonlight, candlelight,
  neon signage, volumetric god-rays, rim light, chiaroscuro, soft box.

## Camera / composition vocabulary
- wide establishing shot, close-up, over-the-shoulder, dutch angle,
  bird's-eye, worm's-eye, rule of thirds, symmetrical, negative space,
  leading lines, shallow depth of field (f/1.8), deep focus (f/16).

## Size defaults
- Portrait / phone wallpaper: 1024x1536 (2:3)
- Feed square: 1024x1024
- Landscape header: 1536x1024 (3:2)
- Cinematic hero: 2048x1024 (2:1) or 1792x1024 (7:4)

## Embedding in Markdown
  ![short alt text describing the image](image_url)

## Anti-patterns
- Style soup ("watercolor 3d photorealistic anime hyperrealistic").
- Overloading with 20 adjectives — pick 4-6 strong ones.
- Requesting text-in-image from a diffusion model that mangles typography;
  overlay text in HTML/CSS instead if it must be legible.
- Vague subject ("a beautiful thing") — models default to a generic bokeh.`,

// ─────────────────────────────────────────────────────────────────────────────
"REFACTOR-SKILL": `# REFACTOR-SKILL — Code refactoring playbook

## When to load
When the user asks to clean up, refactor, modernize, split, or "make this
better" on existing code. NOT for greenfield "write me an app" tasks.

## Method (never skip steps)
1. READ the whole file / module first (read_file). Do not refactor from a
   snippet — you'll miss cross-references.
2. INVENTORY problems by category (below). Write them down.
3. PRIORITIZE: correctness bugs > security > readability > style.
4. PROPOSE the plan in plain language BEFORE editing.
5. APPLY one atomic change at a time (edit_file or full rewrite via
   file_upload).
6. PRESERVE behavior. Refactor != feature change. If tests exist, run them
   after each step.

## Problem categories
- Naming:      cryptic (tmp, x, mgr), misleading, inconsistent casing.
- Size:        functions > 50 lines, files > 400 lines, classes > 300 lines.
- Duplication: same 4+ line block appearing 3+ times.
- Magic:       literal numbers/strings that need names.
- Nesting:     > 3 levels of if/for inside each other.
- Coupling:    module A reaches into module B's internals.
- Nullability: unchecked ?. chains, silent || 0 fallbacks hiding bugs.
- Error hygiene: catch { } swallow, generic throw "string".
- Async:       missing await, unhandled rejection, sequential where parallel.
- Perf:        O(n^2) where a Map/Set solves it, redundant re-renders.

## Named refactorings to reach for
- Extract Function        (big function -> small named steps)
- Extract Variable        (complex expression -> named intermediate)
- Inline Variable         (only used once, hurts readability)
- Introduce Parameter Object (>4 positional args -> single options obj)
- Replace Conditional with Polymorphism (giant switch on "type" -> map)
- Guard Clause / Early Return (flip nested if -> return early)
- Replace Magic Number with Constant
- Move Function (function used by module X sitting in module Y)

## Presenting the change
Show a compact BEFORE / AFTER of the *key* section, plus a 3-5 bullet
"why" list. Don't paste 500 lines of diff into chat — attach the full
new file via file_upload and link it.

## Anti-patterns
- Big-bang rewrite that changes behavior "while I was in there".
- Renaming things without updating all call sites.
- Refactor + feature + dependency-bump in one commit.
- Turning working imperative code into unreadable "clever" one-liners.`,

// ─────────────────────────────────────────────────────────────────────────────
"DEBUG-SKILL": `# DEBUG-SKILL — Systematic debugging playbook

## When to load
When there's a concrete failure: error message, wrong output, crash, hang,
or intermittent bug. NOT for "review my code" (that's REFACTOR-SKILL).

## Systematic method
1. REPRODUCE. Get to a minimal input that triggers the bug reliably.
   Use js_exec to isolate.
2. OBSERVE. What is the *actual* behavior vs what is the expected?
   Print the state right before failure.
3. HYPOTHESIZE. Write down 2-3 candidate causes. Rank by likelihood.
4. TEST each hypothesis with the smallest possible probe. Kill one
   hypothesis before moving on.
5. FIX the root cause, not the symptom. If the symptom is "undefined
   error at line 42", the fix is rarely "add a ?. at line 42".
6. VERIFY. Re-run the reproducer AND a broader test to catch regressions.
7. PREVENT. Add an assertion / test that would fail if this bug returned.

## Common bug patterns and their tells
- "Cannot read property X of undefined" -> the previous access returned
  null/undefined. Check the boundary (API response, missing key).
- "Maximum call stack" -> unbounded recursion, mutual recursion, or
  a getter that calls itself.
- Off-by-one -> triggered by inputs of size 0, 1, or exactly the boundary.
- Race condition -> only fails under load, or on slow network; two
  operations completing in the "wrong" order.
- Memory leak -> event listener attached in a loop and never removed,
  closures holding large arrays, timers not cleared.
- CORS / auth -> works in curl but fails in browser; check preflight,
  cookies, credentials mode.
- Timezone -> works on your laptop, fails in CI; always store UTC,
  format on display.
- Encoding -> Japanese/emoji breaks; check UTF-8 end-to-end and
  Content-Type charset.

## Reading a stack trace
- Top frame = where it threw, usually a symptom.
- The *interesting* frame is often 2-3 down: the caller that passed the
  bad data. That's the root cause site.

## Delivery
"Root cause: X. Why it happened: Y. Fix: Z. Test that would catch it: W."

## Anti-patterns
- "Try adding a try/catch" — swallowing the error is not fixing it.
- Changing 5 things at once and declaring victory when it works.
- Blaming the framework/library before ruling out your own code.
- Not writing down what you tried — you'll retry it in an hour.`,

// ─────────────────────────────────────────────────────────────────────────────
"API-DESIGN-SKILL": `# API-DESIGN-SKILL — HTTP/JSON API design playbook

## When to load
When the user asks to design or implement a REST/HTTP API, an SDK, or
inter-service contracts. Skip for pure client-side or CLI tasks.

## URI conventions (REST)
- Nouns, plural: /users, /orders, /invoices.
- IDs in path: /users/{id}. Filters in query: /users?role=admin&active=true.
- Nest one level to express ownership: /users/{id}/orders. Don't go deeper —
  use query filter instead.
- Actions that don't fit CRUD: /orders/{id}/cancel (POST). Keep sparingly.
- Versioning: /v1/... in URL. Change to /v2/... only for breaking changes.

## HTTP status codes (pick one, don't invent)
  200 OK            successful GET/PUT/PATCH with body
  201 Created       POST returning the new resource + Location header
  202 Accepted      async work queued
  204 No Content    DELETE / PUT with no body
  301/302/307       redirects (307 preserves method)
  400 Bad Request   malformed
  401 Unauthorized  missing/invalid auth
  403 Forbidden     authed but not allowed
  404 Not Found     resource does not exist for this caller
  409 Conflict      version conflict / unique constraint / state mismatch
  410 Gone          used-to-exist, permanently removed
  422 Unprocessable syntactically valid but semantically wrong (validation)
  429 Too Many      rate-limit hit. MUST include Retry-After.
  500 Internal      unexpected. Log with a correlation id.
  502/503/504       upstream failure / degraded / timeout.

## Response envelope
Success:  { "data": ... , "meta": { "page": 1, "total": 42 } }
Error:    { "error": { "code": "VALIDATION_ERROR",
                       "message": "email is required",
                       "field": "email",
                       "requestId": "..." } }
Codes are stable ENUMS (SCREAMING_SNAKE), messages are human-readable.
Never leak stack traces to clients.

## Auth
- Bearer JWT in Authorization header. Short-lived (15m) + refresh token
  in httpOnly cookie.
- API keys only for server-to-server; rotate quarterly.
- Never accept the token in a query string (logs, referer leaks).
- CORS: explicit allowlist, credentials:true only when needed.

## Pagination
- Cursor-based for large / mutating datasets: ?cursor=abc&limit=50 ->
  { data, meta: { nextCursor } }
- Offset-based only for admin UIs with small stable data.
- Always cap limit server-side (e.g. max 100).

## Idempotency
- All mutating requests support Idempotency-Key header. Server stores the
  response for 24h and replays it on retry with the same key.
- GET/PUT/DELETE are idempotent by definition. POST needs the header.

## Rate limiting
- Return X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset.
- On 429, Retry-After: <seconds> is mandatory.

## Documentation
- OpenAPI 3.1 spec is the source of truth. Generate clients + docs from it.
- Every endpoint has: summary, one full example request, one success
  response, at least one error response.

## Anti-patterns
- Verb-based URLs: /getUser, /createOrder, /doPayment.
- 200 OK with { success: false } in the body.
- Different error shapes on different endpoints.
- Batch endpoints without partial-failure reporting.
- Chatty APIs (client makes 10 round trips to render a page).`,

// ─────────────────────────────────────────────────────────────────────────────
"DATA-ANALYSIS-SKILL": `# DATA-ANALYSIS-SKILL — Data exploration playbook

## When to load
When the user provides data (CSV/JSON/table) or asks statistical /
comparative / trend questions about a dataset. Skip for coding-only tasks.

## Flow
1. LOAD.    read_file / extract_data. Peek at the first 5 rows and the
            last 5 rows.
2. PROFILE. rows, cols, dtypes, %-missing per column, cardinality of
            categoricals, min/max/mean/median/std of numerics.
3. CLEAN.   handle missing (drop | fill | flag), dedupe, fix types
            (dates as dates, not strings), trim whitespace.
4. ASK.     what question are we answering? Write it down.
5. COMPUTE. one metric at a time.
6. VISUALIZE (if the target renders it).
7. INTERPRET. Numbers alone are not insight. Explain the "so what".

## Quick JS recipes
CSV parse (well-formed input only — for real CSVs use a parser):
    const [head, ...rows] = csv.trim().split(/\\r?\\n/).map(l => l.split(","));

Numeric stats:
    const nums = xs.filter(Number.isFinite).sort((a,b)=>a-b);
    const n = nums.length;
    const mean = nums.reduce((a,b)=>a+b,0)/n;
    const median = n%2 ? nums[(n-1)/2] : (nums[n/2-1]+nums[n/2])/2;
    const variance = nums.reduce((a,b)=>a+(b-mean)**2,0)/n;
    const std = Math.sqrt(variance);
    const p = q => nums[Math.min(n-1, Math.floor(q*n))];

Group by:
    const groups = new Map();
    for (const r of rows) {
      const k = r[keyIdx];
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(Number(r[valIdx]));
    }

## Presenting results
- Lead with the ANSWER, not the method.
- Support the answer with at most 3-5 numbers.
- Show a table only when it earns its space (>=3 rows worth comparing).
- Format: thousands separators, aligned decimals, units always stated
  ("42 ms", "3.2 GB", "18%", not "42").

## Statistical honesty
- Sample vs population. Small sample -> confidence interval or don't
  claim significance.
- Correlation != causation. Say "associated with", not "causes".
- Don't compare percentages of tiny denominators ("100% of the 2
  customers who churned...").

## Anti-patterns
- Dumping every column's stat when the user asked one question.
- p-hacking (testing 20 things and reporting the one that shone).
- Averaging categorical codes.
- Comparing apples to oranges (different date ranges, different filters).`,

// ─────────────────────────────────────────────────────────────────────────────
"SYSTEM-DESIGN-SKILL": `# SYSTEM-DESIGN-SKILL — Distributed system design playbook

## When to load
"Design X" prompts at company scale: URL shortener, chat, feed, search,
payments, ride-hailing, streaming, notifications. Skip for library-level
design (that's an API / architecture question, not a system).

## Structured walkthrough (do the steps in this order)
1. CLARIFY functional requirements. Get 3-5 key features, not 30.
2. QUANTIFY non-functional requirements:
   DAU, QPS peak vs avg, read:write ratio, payload size, storage/year,
   latency SLO (p50 / p99), availability target (99.9% = 8.7h/yr down).
3. HIGH-LEVEL API. What are the 5 endpoints the client actually calls?
4. DATA MODEL. Entities, relationships, access patterns FIRST, schema
   second. Pick storage engine based on access pattern.
5. HIGH-LEVEL DIAGRAM. Client -> LB -> app tier -> cache -> DB, plus
   async pipeline for heavy work.
6. SCALE the bottleneck. Do NOT scale everything preemptively.
7. RELIABILITY. Redundancy, failover, backpressure, retries + idempotency,
   graceful degradation.
8. OBSERVABILITY. Logs (structured), metrics (RED/USE), traces
   (correlation id from edge).
9. TRADEOFFS. Explicitly. Every choice denies another one.

## Capacity math you should be fluent in
- 1 day = 86,400 s ~ 1e5. So 100M req/day ~ 1,150 QPS.
- Peak = 3-5x average for consumer, 1.5-2x for B2B.
- 1 KB * 1M rows = 1 GB. 1 KB * 1B rows = 1 TB. Plan indexes ~ 30% extra.
- Network: 100 Mbps ~ 12.5 MB/s. Disk SSD ~ 500 MB/s seq, ~ 50k IOPS random.
- Redis: ~ 100k ops/sec per node commodity, sub-ms latency.
- Postgres: ~ 10k QPS read-mostly single node, needs replicas past that.
- Kafka: millions of msg/s per cluster, ordering per-partition only.

## Storage decision tree
- Key/value, hot cache, low latency          -> Redis / Memcached
- Document, flexible schema, moderate scale  -> MongoDB / DynamoDB
- Relational, transactions, joins            -> Postgres / MySQL
- Time-series metrics                         -> Prometheus / InfluxDB
- Full-text search                            -> Elasticsearch / OpenSearch
- Wide-column, huge scale, ordered            -> Cassandra / ScyllaDB / Bigtable
- Blob (images, video)                        -> S3 + CDN
- Analytics OLAP                              -> ClickHouse / Snowflake / BigQuery

## Consistency patterns
- Strong consistency  -> paxos/raft, sync replication, higher latency.
- Read-your-writes    -> sticky sessions or read from primary for own writes.
- Eventual consistency -> async replication, cheaper, needs conflict resolution.
- Pick per feature. Login = strong. Feed = eventual.

## Caching patterns
- Cache-aside (lazy): app reads cache, on miss reads DB, populates cache.
- Read-through / write-through: cache proxies DB, always in sync but
  higher write latency.
- Write-behind: fast writes, risk of loss on cache crash.
- TTL + jitter to avoid stampede. Add a "singleflight" for cold key surges.

## Async work
- Anything > 100 ms user-perceived should be considered for async.
- Queues: SQS / Kafka / RabbitMQ. Use Kafka for ordered replay, SQS for
  simple work queues.
- Retry + dead-letter queue + poison-message quarantine.
- Idempotent consumers.

## Anti-patterns
- Microservices from day one.
- Global distributed transaction across 4 services.
- One giant table with 300 columns.
- Cache without invalidation strategy.
- Retrying non-idempotent POSTs.
- "We'll add observability later."`,

// ─────────────────────────────────────────────────────────────────────────────
"ALGORITHM-SKILL": `# ALGORITHM-SKILL — Algorithms & data structures playbook

## When to load
For interview-style / algorithmic problems, or when a naive solution is
too slow (e.g. n=1e6 with O(n^2)). Skip for CRUD / UI work.

## First-response checklist
1. Restate the problem in one sentence.
2. Note constraints: n range, value range, memory, online vs offline.
3. Compute the target complexity from constraints:
     n <= 20        : O(2^n) OK (bitmask DP, backtracking)
     n <= 100       : O(n^3) OK
     n <= 10,000    : O(n^2) OK
     n <= 1e6       : O(n log n) target
     n <= 1e9       : O(log n) / O(sqrt n) / math
4. Sketch a brute force -> derive the optimization.

## Structures cheat sheet
- Array               O(1) idx, O(n) insert-mid
- HashMap / Set       O(1) avg lookup
- BalancedBST/TreeMap O(log n) ordered ops
- Heap (priority q)   O(log n) push/pop, O(1) peek
- Deque               O(1) both ends
- Union-Find (DSU)    ~ O(α(n)) union/find with path compression + rank
- Segment tree / BIT  O(log n) range query + point update
- Trie                O(L) string prefix ops
- LRU (HashMap+DLL)   O(1) get/put

## Algorithms cheat sheet
- Sorting     : merge O(n log n) stable; quick avg O(n log n); heapsort worst.
- Selection   : quickselect avg O(n) for kth.
- Search      : binary search on sorted / monotonic predicate.
- Graph       : BFS shortest unweighted; Dijkstra non-neg weights O((V+E) log V);
                Bellman-Ford handles negatives O(VE); Floyd-Warshall O(V^3).
- MST         : Kruskal (DSU + sort edges), Prim (heap).
- Flow        : Dinic O(V^2 E); Hungarian for assignment.
- Strings     : KMP O(n+m); Z-algorithm; suffix array + LCP; rolling hash.
- DP families : knapsack, LIS, LCS, edit distance, matrix chain, digit DP,
                bitmask DP, tree DP.
- Geometry    : convex hull O(n log n) Graham/Andrew; sweep-line for
                intersections; cross product for orientation.

## Templates (idiomatic JS)

Binary search on predicate:
    function firstTrue(lo, hi, pred){
      while (lo < hi){ const m = (lo+hi)>>1; pred(m) ? hi=m : lo=m+1; }
      return lo;
    }

Union-Find:
    class DSU {
      constructor(n){ this.p=[...Array(n).keys()]; this.r=Array(n).fill(0); }
      find(x){ while (this.p[x]!==x){ this.p[x]=this.p[this.p[x]]; x=this.p[x]; } return x; }
      union(a,b){ a=this.find(a); b=this.find(b); if(a===b) return false;
        if(this.r[a]<this.r[b]) [a,b]=[b,a];
        this.p[b]=a; if(this.r[a]===this.r[b]) this.r[a]++; return true; }
    }

Min-heap (n log n) via sorted insert is fine for small n; for real use:
    class MinHeap {
      constructor(cmp=(a,b)=>a-b){ this.a=[]; this.cmp=cmp; }
      push(x){ this.a.push(x); this._up(this.a.length-1); }
      pop(){ const t=this.a[0], b=this.a.pop();
        if(this.a.length){ this.a[0]=b; this._down(0); } return t; }
      _up(i){ while(i){ const p=(i-1)>>1;
        if(this.cmp(this.a[i],this.a[p])<0){ [this.a[i],this.a[p]]=[this.a[p],this.a[i]]; i=p; } else break; } }
      _down(i){ const n=this.a.length; for(;;){
        let l=2*i+1, r=l+1, m=i;
        if(l<n && this.cmp(this.a[l],this.a[m])<0) m=l;
        if(r<n && this.cmp(this.a[r],this.a[m])<0) m=r;
        if(m===i) break; [this.a[i],this.a[m]]=[this.a[m],this.a[i]]; i=m; } }
    }

## Correctness discipline
- Prove or state loop invariants for tricky loops.
- Test explicitly: empty input, single element, all-same, sorted,
  reverse-sorted, max size.
- Watch for integer overflow when languages have fixed-width ints.

## Anti-patterns
- Copy-pasting a solution without understanding the invariant.
- O(n^2) when a HashMap collapses it to O(n).
- Recursion without base case check on the first call.
- Mutating input while iterating.`,

// ─────────────────────────────────────────────────────────────────────────────
"TESTING-SKILL": `# TESTING-SKILL — Testing strategy playbook

## When to load
When the user asks for tests, "how do I test X", coverage strategy, or
when delivering non-trivial code that deserves at least a smoke test.

## Test pyramid (rebalanced for modern apps)
- Unit tests (many, fast): pure functions, business logic.
- Integration tests (some): module boundaries, DB access, API handlers.
- E2E tests (few, slow): critical user journeys only (login, checkout).
- Contract tests (per external dependency): don't stub the API's *shape*
  from memory; pin it.

## AAA structure (every test)
    // Arrange
    const user = { id: 1, name: "Ada" };
    const store = new UserStore();
    // Act
    const result = store.upsert(user);
    // Assert
    expect(result.name).toBe("Ada");
    expect(store.size).toBe(1);

## What to test (priority)
1. Bugs you just fixed — regression test each one.
2. Business rules ("orders over $500 get free shipping").
3. Boundary conditions (0, 1, max, off-by-one candidates).
4. Error paths (bad input, missing dep, timeout, permission denied).
5. Concurrency (two updates racing, retry causing duplicate work).

## What NOT to test (waste)
- Framework code (React knows how to render <div>).
- Trivial getters/setters.
- Third-party library internals.
- Implementation details that will change (private method calls).

## Test doubles
- Stub: canned response for a query.
- Mock: verify an interaction happened (spy on the call).
- Fake: working alternative (in-memory DB instead of Postgres).
- Prefer FAKES for local dev; use STUBS at boundaries; use MOCKS sparingly
  because they couple tests to structure.

## Flaky test triage
- Time-dependent? Freeze the clock.
- Ordering-dependent? Sort or use Set semantics.
- Network-dependent? Mock at the network boundary (msw, nock).
- Concurrency-dependent? Serialize the resource or use a fixture.
- File-system-dependent? tmpdir per test, clean in afterEach.

## Lightweight assert (for js_exec):
    const results = [];
    function it(name, fn){
      try { fn(); results.push("PASS " + name); }
      catch (e) { results.push("FAIL " + name + " :: " + e.message); }
    }
    function eq(a, b){ if (JSON.stringify(a) !== JSON.stringify(b))
      throw new Error("expected " + JSON.stringify(b) + " got " + JSON.stringify(a)); }

## Anti-patterns
- One giant test that asserts 30 things.
- Testing multiple behaviors in one it() and stopping at the first failure.
- Assertions with no message on a boolean (expect(true).toBe(true)).
- Snapshot tests over rendered HTML that changes weekly — high churn, low signal.
- Tests that mutate shared state and depend on execution order.`,
};

// Public list of skill names (order stable, used in system prompt listing).
const SKILL_NAMES = Object.keys(SKILLS);

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
  const main    = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (article && article[1].length > 500) mainHtml = article[1];
  else if (main && main[1].length > 500)  mainHtml = main[1];
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
      error: (...a) => logs.push("[err] "  + a.map(String).join(" ")),
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

// Skill loader.
//
// This is the ONLY entry point that can inject skill content into the
// conversation. Skills are NEVER auto-loaded. The system prompt only lists
// skill *names* and one-line summaries; the actual playbook is delivered
// exclusively here.
//
// We also record which skills got loaded in this request via
// state.loadedSkills, so the large-output router can react precisely
// (instead of the v5 hack that regex-matched skill names inside tool_result
// text — which caused unrelated skills to trigger the router).
async function tool_load_skill(args, state) {
  const rawNames = args.name || args.skill || args.id || args.skill_id
                 || args.skill_ids || args.names || args.skills;
  const list = Array.isArray(rawNames) ? rawNames : (rawNames ? [rawNames] : []);
  if (list.length === 0) {
    return { ok: false, error: "No skill name provided", available: SKILL_NAMES };
  }
  const loaded = [];
  const notFound = [];
  for (const n of list) {
    const key = String(n).replace(/\.md$/i, "").toUpperCase().replace(/[_\s]/g, "-");
    const content = SKILLS[key];
    if (content) {
      loaded.push({ name: key, content });
      if (state && state.loadedSkills) state.loadedSkills.add(key);
    } else {
      notFound.push(String(n));
    }
  }
  if (loaded.length === 0) {
    return { ok: false, error: `Unknown skill(s): ${notFound.join(", ")}`, available: SKILL_NAMES };
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
        { role: "system", content: "You are answering a design/tradeoff question. Be a domain expert. Answer in Japanese, under 200 words, structured: (1) recommendation, (2) top reason, (3) main risk." },
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
    html: "text/html; charset=utf-8",  htm:  "text/html; charset=utf-8",
    js:   "text/javascript; charset=utf-8", ts: "text/typescript; charset=utf-8",
    css:  "text/css; charset=utf-8",   json: "application/json; charset=utf-8",
    md:   "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8",
    py:   "text/x-python; charset=utf-8", svg: "image/svg+xml",
    xml:  "application/xml",           csv:  "text/csv; charset=utf-8",
  })[ext] || "text/plain; charset=utf-8";
}

async function tool_file_upload(args) {
  const filename = args.filename || args.name || args.file_name || "output.txt";
  const content  = args.content ?? args.text ?? args.body ?? args.data ?? "";
  const mime     = args.mime || args.mime_type || args.content_type;
  const id       = crypto.randomBytes(8).toString("hex");
  const m        = mime || guessMime(filename);
  UPLOADED_FILES.set(id, { name: filename, content: String(content), mime: m });
  const bytes = Buffer.byteLength(String(content), "utf8");
  return {
    id, filename, mime: m,
    size:  bytes,
    lines: (String(content).match(/\n/g) || []).length + 1,
    language:     filename.split(".").pop() || "text",
    download_url: `/api/files/${id}`,
    preview_url:  `/api/files/${id}?inline=1`,
  };
}

async function tool_read_file(args) {
  const id        = args.attachment_id || args.id || args.file_id;
  const max_chars = Number(args.max_chars) || 30000;
  const start     = Math.max(0, Number(args.start) || 0);
  if (!id) return { ok: false, error: "attachment_id required" };
  const f = ATTACHMENTS.get(id) || UPLOADED_FILES.get(id);
  if (!f) return { ok: false, error: `Unknown file: ${id}` };
  const size = f.size ?? Buffer.byteLength(f.content, "utf8");
  const slice = f.content.slice(start, start + max_chars);
  return {
    ok: true, id, filename: f.name, mime: f.mime, size,
    total_chars:    f.content.length, start,
    returned_chars: slice.length,
    truncated:      f.content.length > start + max_chars,
    content:        slice,
  };
}

async function tool_edit_file(args) {
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
    lines:    (newContent.match(/\n/g) || []).length + 1,
    download_url: `/api/files/${id}`,
    preview_url:  `/api/files/${id}?inline=1`,
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
  const style = args.style || "bullets";
  const max_points = args.max_points || 5;
  if (!text.trim()) return { ok: false, error: "no text" };
  const prompt = style === "tldr"
    ? `以下の文章を、日本語1文（80字以内）で要約せよ:\n\n${text.slice(0, 8000)}`
    : style === "paragraph"
    ? `以下の文章を、日本語で3-5文の段落として要約せよ:\n\n${text.slice(0, 8000)}`
    : `以下の文章を、日本語の箇条書き${max_points}項目以内で要約せよ。各項目は1行:\n\n${text.slice(0, 8000)}`;
  try {
    const j = await nieChat({
      model: args.model || DEFAULT_MODEL,
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

// Tool registry. Each tool receives (args, state) — state gives the tool
// visibility into the current request lifecycle (e.g. which skills were
// loaded so far). Legacy tools that ignore state still work.
const TOOLS = {
  web_search:      { run: (a,s) => tool_web_search(a),      desc: "Web search (Bing RSS -> Wikipedia fallback)" },
  html_fetch:      { run: (a,s) => tool_html_fetch(a),      desc: "Fetch a URL and extract main text" },
  js_exec:         { run: (a,s) => tool_js_exec(a),         desc: "Run JavaScript in a sandbox" },
  load_skill:      { run: (a,s) => tool_load_skill(a, s),   desc: "Load one or more skills (opt-in, never auto)" },
  parallel_think:  { run: (a,s) => tool_parallel_think(a),  desc: "Ask multiple models in parallel and compare" },
  image_generate:  { run: (a,s) => tool_image_generate(a),  desc: "Generate an image via Pollinations" },
  file_upload:     { run: (a,s) => tool_file_upload(a),     desc: "Deliver a large artifact as a downloadable file" },
  read_file:       { run: (a,s) => tool_read_file(a),       desc: "Read an uploaded / generated file" },
  edit_file:       { run: (a,s) => tool_edit_file(a),       desc: "Edit a generated file (find/replace or full rewrite)" },
  extract_data:    { run: (a,s) => tool_extract_data(a),    desc: "Extract URLs / numbers / emails / JSON / CSV from text" },
  summarize:       { run: (a,s) => tool_summarize(a),       desc: "Summarize a long text (bullets / paragraph / tldr)" },
  memory_store:    { run: (a,s) => tool_memory_store(a),    desc: "Store a key/value in session memory" },
  memory_recall:   { run: (a,s) => tool_memory_recall(a),   desc: "Recall by key (or list keys)" },
  shorten_element: { run: (a,s) => tool_shorten_element(a), desc: "Shorten a huge text into an @alias reference" },
};

// Aliases the LLM might use by mistake.
const TOOL_ALIASES = {
  "search":       "web_search",  "google":       "web_search",   "web":          "web_search",   "bing":       "web_search",
  "fetch":        "html_fetch",  "get_page":     "html_fetch",   "fetch_url":    "html_fetch",   "curl":       "html_fetch",  "browse": "html_fetch",
  "exec":         "js_exec",     "eval":         "js_exec",      "run_js":       "js_exec",      "execute":    "js_exec",     "run_code": "js_exec", "python": "js_exec",
  "skill":        "load_skill",  "get_skill":    "load_skill",   "read_skill":   "load_skill",   "skills":     "load_skill",  "load":     "load_skill",
  "think":        "parallel_think", "multi_think":"parallel_think", "consult":   "parallel_think", "ask_multi":"parallel_think",
  "generate_image":"image_generate", "image":    "image_generate", "img":        "image_generate", "draw":     "image_generate", "make_image": "image_generate",
  "upload":       "file_upload", "save_file":    "file_upload",  "create_file": "file_upload",  "write":       "file_upload", "output_file":"file_upload",
  "read":         "read_file",   "open_file":    "read_file",    "load_file":   "read_file",    "cat":         "read_file",
  "edit":         "edit_file",   "update_file":  "edit_file",    "modify_file": "edit_file",    "patch_file":  "edit_file",
  "extract":      "extract_data","parse":        "extract_data",
  "summary":      "summarize",   "tldr":         "summarize",    "digest":      "summarize",
  "remember":     "memory_store","save":         "memory_store", "store":       "memory_store", "note":        "memory_store",
  "recall":       "memory_recall","get_memory":  "memory_recall","read_memory": "memory_recall",
  "shorten":      "shorten_element","alias":     "shorten_element",
};

// ============================================================================
// System prompt
// ----------------------------------------------------------------------------
// The v5 prompt listed skill *names inside a big markdown section*, together
// with usage advice like "for games load GAME-DEV-SKILL, CODING-SKILL and
// UI-SKILL". That was one of the sources of the "skills auto-load themselves"
// bug: the model saw the names in the prompt, echoed them in tool_result
// summaries, then the downstream router regex-matched those names and
// escalated to felo-chat even when the user only asked a small question.
//
// v6 prompt:
//   - Lists skills as *names with one-line summaries* only. No usage advice
//     that could bait the model into loading unrelated skills.
//   - Explicitly says: "Only load a skill when the user's task clearly
//     matches its When-to-load. Never load more than the task needs."
//   - Explicitly says: "For long artifacts (>= a full HTML app, >= 200 line
//     code file, >= long report), use file_upload. Don't paste it inline."
// ============================================================================
function buildSystemPrompt(mainModel, attachments) {
  const skillList = SKILL_NAMES.map(n => {
    const first = SKILLS[n].split("\n").find(l => l.startsWith("# "));
    const label = first ? first.replace(/^#\s*/, "").split(" — ").slice(1).join(" — ") : n;
    return `- **${n}** — ${label || "playbook"}`;
  }).join("\n");

  const attachSection = attachments && attachments.length > 0
    ? `

## Attached files (${attachments.length})
${attachments.map(a => `- id: **${a.id}** — "${a.name}" (${a.mime}, ${a.size} bytes)`).join("\n")}

If the user's question is about these files, read them first:
\`\`\`tool
{"tool":"read_file","args":{"attachment_id":"<id>"}}
\`\`\``
    : "";

  return `You are **Orby**, an autonomous coding agent. Main model: ${mainModel}.
Reply to the user in **Japanese**. Reasoning steps (tool calls) may be in English.

=====================================================================
CORE PRINCIPLES
=====================================================================
- Do the task fully. No placeholders, no "TODO", no "left as an exercise".
- Verify before you claim. If code, run it (js_exec). If a fact, look it up.
- Match effort to the task. A one-line question deserves a one-line answer.
  A "build me a full app" request deserves a real artifact via file_upload.
- Never fabricate a file link. A /api/files/<id> URL is only valid if
  file_upload returned it in a tool_result this session.

=====================================================================
TOOL CALL PROTOCOL
=====================================================================
Emit tool calls as fenced JSON blocks. One block = one tool call.
Multiple blocks in the same reply are executed in parallel.

\`\`\`tool
{"tool":"<name>","args":{...}}
\`\`\`

Available tools:
- web_search       {"query":"...","max_results":6}
- html_fetch       {"url":"..."}
- js_exec          {"code":"..."}
- load_skill       {"name":"SKILL-NAME"}  or  {"name":["A","B"]}
- parallel_think   {"prompt":"...","models":["...","..."]}   (models optional)
- image_generate   {"prompt":"...","width":1024,"height":1024}
- file_upload      {"filename":"x.html","content":"<full contents>"}
- read_file        {"attachment_id":"<id>"}   or {"id":"<id>"}
- edit_file        {"file_id":"<id>","find":"...","replace":"..."}
                   or {"file_id":"<id>","new_content":"..."}
- extract_data     {"text":"...","format":"urls|numbers|emails|json|csv"}
- summarize        {"text":"...","style":"bullets|paragraph|tldr"}
- memory_store     {"key":"...","value":"..."}
- memory_recall    {"key":"..."}   or {} to list keys
- shorten_element  {"name":"...","content":"..."}

=====================================================================
SKILLS (opt-in playbooks — DO NOT load unless the task truly matches)
=====================================================================
${skillList}

Rules for skills:
1. Skills are NOT loaded automatically. You must explicitly call load_skill.
2. Load ONLY the skills whose "When to load" section matches the user's
   current request. Loading unrelated skills is a defect.
3. For a simple question, load ZERO skills. Answer directly.
4. Skill content is for you, the assistant. Never paste a skill's raw text
   into the user-facing reply.

=====================================================================
LARGE-OUTPUT DISCIPLINE (important — avoids chat freezing on the user)
=====================================================================
If the final artifact is a large code file, a full single-page app, a long
report, or anything > ~200 lines / > ~8 KB:
- DELIVER IT VIA file_upload. Return only the link in the chat text.
- Do NOT paste the entire artifact into the assistant message. Streaming a
  huge blob back to the client makes the chat UI lag and often gets the
  reply truncated by the model.
- Short snippets stay inline in triple-backtick blocks as usual.

=====================================================================
OUTPUT STYLE (final answer)
=====================================================================
- Japanese, concise, no filler.
- If you produced a file: show a one-line description + the link
  \`[filename](/api/files/<id>)\`.
- If you searched: cite sources inline \`[Title](url)\`.
- End when the task is done. Do not keep looping tools when the answer is
  already sufficient.${attachSection}`;
}

// ============================================================================
// SSE + tool-call parser
// ============================================================================
function sseSend(res, event, data) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) {}
}

function parseToolCalls(text) {
  const calls = [];
  const found = new Set();

  const addCall = (raw, tool, args) => {
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
    let cleaned = raw
      .replace(/'/g, '"')
      .replace(/,(\s*[}\]])/g, "$1")
      .replace(/(\w+):/g, '"$1":')
      .replace(/""(\w+)""/g, '"$1"');
    try { return JSON.parse(cleaned); } catch (_) {}
    const jm2 = cleaned.match(/\{[\s\S]*\}/);
    if (jm2) { try { return JSON.parse(jm2[0]); } catch (_) {} }
    return null;
  };

  const extractFromParsed = (obj) => {
    if (!obj || typeof obj !== "object") return null;
    let tool = obj.tool || obj.name || obj.tool_name || obj.function || obj.action;
    let args = obj.args || obj.arguments || obj.parameters || obj.params || obj.input || obj;
    if (args === obj) {
      const { tool: _t, name: _n, ...rest } = obj;
      args = rest;
    }
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
    if (extracted && extracted.tool) addCall(raw, extracted.tool, extracted.args);
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
    if (extracted && extracted.tool) addCall(raw, extracted.tool, extracted.args);
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
    size:  Buffer.byteLength(String(content), "utf8"),
    lines: (String(content).match(/\n/g) || []).length + 1,
  });
});
app.delete("/api/upload/:id", (req, res) => { ATTACHMENTS.delete(req.params.id); res.json({ ok: true }); });

// ============================================================================
// /api/agent
// ----------------------------------------------------------------------------
// Design decisions in v6:
//
//  * PER-REQUEST STATE. Each request builds a `state` object that tools can
//    read/write. Right now the only field is `loadedSkills` (Set<string>) —
//    an authoritative record of which skills were opted-in via load_skill.
//    The large-output router reads this set (NOT regex on the transcript),
//    so a skill's *name* appearing anywhere in text does not trigger it.
//
//  * LARGE-OUTPUT ROUTING. If any of these is true, we route to a large-
//    output model:
//      - The user's *latest* message clearly asks for a big artifact
//        (explicit keywords + minimum length threshold).
//      - The session actually loaded a coding/game/algorithm/system skill.
//    Router order: current model -> felo-chat -> gpt-4o -> nemotron.
//
//  * STREAMING FLOOD CONTROL. During streaming, we count outbound chars.
//    Up to LIVE_STREAM_CHARS (default 4096) we forward every delta to the
//    client so the user sees progress. After that, we STOP forwarding
//    deltas — the full text is still captured server-side. We emit a single
//    `assistant_notice` so the UI can show "…generating a large artifact,
//    it will be delivered as a file when ready." When file_upload gets
//    called with the same content, the user sees only the link at the end.
// ============================================================================

const LIVE_STREAM_CHARS = 4096;   // hard cap on delta bytes forwarded to UI
const LARGE_TASK_HINTS  = /(実装|作って|作成|生成|書いて|フル|完全|完璧|全部|全て|一式|コード全体|full (app|code|implementation)|build (me )?an? (app|game|site)|complete (code|app|implementation)|entire (code|file)|write .*(app|game|website|code))/i;

// A skill is "large-output-inducing" if using it plausibly leads to a big
// artifact (long code, full app, long report). This decides the router.
const LARGE_OUTPUT_SKILLS = new Set([
  "CODING-SKILL", "GAME-DEV-SKILL", "ALGORITHM-SKILL",
  "SYSTEM-DESIGN-SKILL", "UI-SKILL", "REFACTOR-SKILL",
]);

app.post("/api/agent", async (req, res) => {
  const { messages = [], model = DEFAULT_MODEL, max_rounds = 12, attachments = [] } = req.body || {};

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders && res.flushHeaders();

  const isClosed = () => res.writableEnded || res.destroyed;

  const attachMeta = attachments
    .map(id => ATTACHMENTS.get(id)
      ? { id, name: ATTACHMENTS.get(id).name, mime: ATTACHMENTS.get(id).mime, size: ATTACHMENTS.get(id).size }
      : null)
    .filter(Boolean);

  const sysText = buildSystemPrompt(model, attachMeta);
  const sys = { role: "system", content: sysText };

  const userMsgs = messages.map(m => ({
    ...m,
    content: typeof m.content === "string" ? expandShortcuts(m.content) : m.content,
  }));

  // Belt-and-braces: some upstream endpoints ignore system role entirely,
  // so we prepend the system prompt into the first user message too.
  if (userMsgs.length > 0 && userMsgs[0].role === "user") {
    const originalFirst = userMsgs[0].content;
    userMsgs[0] = {
      role: "user",
      content:
`[system]
${sysText}
[/system]

──── user message ────
${originalFirst}
──── end ────`
    };
  }

  const convo = [sys, ...userMsgs];
  const state = { loadedSkills: new Set() };
  const latestUserText =
    [...messages].reverse().find(m => m.role === "user")?.content || "";

  let finalEmitted = false;

  // Decides which model to use for THIS round of generation.
  // Rationale: v5 escalated based on regex over tool_result text. That
  // triggered false positives (e.g. any tool_result that mentioned the
  // string "CODING-SKILL" would route to felo-chat even for tiny tasks).
  // v6 uses the authoritative Set + explicit user-intent classifier.
  const pickModelForRound = () => {
    const userAsksBig  = LARGE_TASK_HINTS.test(latestUserText);
    const hasBigSkill  = [...state.loadedSkills].some(s => LARGE_OUTPUT_SKILLS.has(s));
    const needsLarge   = userAsksBig || hasBigSkill;
    if (!needsLarge) return model;
    if (LARGE_OUTPUT_MODELS.includes(model)) return model;
    return LARGE_OUTPUT_MODELS[0]; // felo-chat
  };

  try {
    for (let round = 1; round <= max_rounds; round++) {
      if (isClosed()) break;
      sseSend(res, "round", { round });

      const effectiveModel = pickModelForRound();
      sseSend(res, "assistant_start", { round, model: effectiveModel });

      // Streaming flood control.
      // `forwarded` counts characters we have delivered to the client so
      // far this round. Beyond LIVE_STREAM_CHARS, we stop forwarding
      // deltas to the UI (but keep collecting the full text server-side).
      let forwarded = 0;
      let suppressed = false;
      let streamedText = "";
      const onDelta = (delta) => {
        streamedText += delta;
        if (isClosed()) return;
        if (suppressed) return;
        if (forwarded + delta.length <= LIVE_STREAM_CHARS) {
          sseSend(res, "assistant_delta", { text: delta });
          forwarded += delta.length;
        } else {
          // First-time suppression: forward the head of this delta so we
          // land right at LIVE_STREAM_CHARS, then send a one-off notice.
          const remain = Math.max(0, LIVE_STREAM_CHARS - forwarded);
          if (remain > 0) {
            sseSend(res, "assistant_delta", { text: delta.slice(0, remain) });
            forwarded += remain;
          }
          suppressed = true;
          sseSend(res, "assistant_notice", {
            reason: "large_output",
            message: "…大規模な出力を生成中です。完了後にファイルとして提供します。",
          });
        }
      };

      try {
        await nieChatStream(
          { model: effectiveModel, messages: convo, temperature: 0.6 },
          onDelta
        );
      } catch (_) { /* fall through to escalation below */ }

      // Detect malformed / truncated streaming output.
      const knownToolNames = new Set([...Object.keys(TOOLS), ...Object.keys(TOOL_ALIASES)]);
      const toolNameMatches = [...streamedText.matchAll(/```(?:tool|json)?\s*\n?\s*\{\s*"(?:tool|name|action)"\s*:\s*"([^"]+)"/g)]
        .map(m => m[1].toLowerCase());
      const hasInvalidToolName = toolNameMatches.length > 0 && toolNameMatches.every(n => !knownToolNames.has(n));
      const looksTruncated =
        !streamedText ||
        !streamedText.trim() ||
        (streamedText.match(/```tool/g) || []).length > (streamedText.match(/```tool[\s\S]*?```/g) || []).length ||
        streamedText.trim().endsWith('{"tool":"skill') ||
        hasInvalidToolName;

      let assistantText = streamedText;

      if (looksTruncated) {
        const escalationChain = hasInvalidToolName
          ? ["felo-chat", "gpt-4o", "scira-nemotron-3-super", "gpt-4"]
          : [effectiveModel, "felo-chat", "scira-nemotron-3-super"];
        for (const alt of escalationChain) {
          try {
            const j = await nieChat({ model: alt, messages: convo, temperature: 0.6 });
            const full = j.content || j.choices?.[0]?.message?.content || "";
            if (full && full.trim()) {
              const altNames = [...full.matchAll(/```(?:tool|json)?\s*\n?\s*\{\s*"(?:tool|name|action)"\s*:\s*"([^"]+)"/g)]
                .map(m => m[1].toLowerCase());
              const altInvalid = altNames.length > 0 && altNames.every(n => !knownToolNames.has(n));
              if (altInvalid) continue;
              // Reset the visible stream: only forward the head of the
              // replacement, keep the rest suppressed to protect the UI.
              sseSend(res, "assistant_reset", {});
              const head = full.slice(0, LIVE_STREAM_CHARS);
              sseSend(res, "assistant_delta", { text: head });
              if (full.length > LIVE_STREAM_CHARS) {
                sseSend(res, "assistant_notice", {
                  reason: "large_output",
                  message: "…大規模な出力を生成中です。完了後にファイルとして提供します。",
                });
              }
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
        // Detect hallucinated file links.
        const finalText  = stripToolBlocks(assistantText);
        const claimsFile = /\/api\/files\/[a-zA-Z0-9_.-]+/.test(finalText);
        const realIds    = new Set([...UPLOADED_FILES.keys()]);
        const referenced = [...finalText.matchAll(/\/api\/files\/([a-f0-9]{16})/g)].map(m => m[1]);
        const allRealRefs = referenced.length > 0 && referenced.every(id => realIds.has(id));

        if (claimsFile && !allRealRefs) {
          sseSend(res, "assistant_reset", {});
          sseSend(res, "assistant_delta", { text: "[修正中: 実際にファイルを作成します...]" });
          convo.push({
            role: "user",
            content: `You included a file link that was never produced by file_upload. Call file_upload for real, then reference the id it returns. Do not fabricate ids.`,
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
          // Pass `state` so tools like load_skill can update per-request
          // bookkeeping (loadedSkills) that the router relies on.
          const out = await TOOLS[c.tool].run(c.args || {}, state);
          const dt = Date.now() - t0;
          // Trim the visible result for very large outputs (skills, big
          // fetches). We only truncate for the SSE event — the full
          // result still goes into `convo` for the model.
          const uiResult = shrinkForUi(out);
          sseSend(res, "tool_result", { id: callId, tool: c.tool, args: c.args, result: uiResult, elapsed_ms: dt });
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
        if (resStr.length > 12000) resStr = resStr.slice(0, 12000) + "\n... (truncated)";
        return "```tool_result\ntool: " + r.tool + "\nargs: " + JSON.stringify(r.args) + "\nresult:\n" + resStr + "\n```";
      }).join("\n\n");

      // Nudges are now written to NOT mention specific skill names, so a
      // future tool_result won't accidentally bait the model into loading
      // an unrelated skill by pattern-matching text.
      const used = new Set(results.map(r => r.tool));
      let nudge = "";
      if (used.has("web_search") && !used.has("html_fetch")) {
        const sr   = results.find(r => r.tool === "web_search")?.result;
        const urls = (sr?.results || []).slice(0, 3).map(r => r.url);
        nudge = `

[chain] Search returned. To answer deeply, in the next round call html_fetch in PARALLEL for the top 1-3 relevant URLs.

Candidates:
${urls.map((u, i) => `${i+1}. ${u}`).join("\n")}

Multiple \`\`\`tool\`\`\` blocks in the same reply run in parallel.`;
      } else if (used.has("load_skill") && !used.has("file_upload")
                 && !used.has("web_search") && !used.has("html_fetch")
                 && !used.has("parallel_think")) {
        nudge = `

[chain] Skill loaded. Now produce the artifact the user asked for.
- If it is a large file / full app / long report: call file_upload with the FULL contents. Do not paste it inline in your reply — return only the link.
- If it is a short answer: just respond in Japanese with the code block or explanation, no more tools needed.
- Do not fabricate a /api/files/<id> link. The id must come from a real file_upload tool_result.`;
      } else {
        nudge = `

[next] If the task is done, reply in Japanese with the final answer (no tool blocks). If not, call the next tool.`;
      }

      convo.push({ role: "user", content: feedback + nudge });

      if (round === max_rounds && !finalEmitted) {
        sseSend(res, "round", { round: round + 1, forced: true });
        try {
          convo.push({ role: "user", content: "[Reached max rounds. Give the final answer in Japanese now, no more tools.]" });
          const j = await nieChat({ model, messages: convo, temperature: 0.4 });
          const finalText = stripToolBlocks(j.content || j.choices?.[0]?.message?.content || "");
          sseSend(res, "assistant_start", { round: round + 1 });
          const head = finalText.slice(0, LIVE_STREAM_CHARS);
          sseSend(res, "assistant_delta", { text: head });
          if (finalText.length > LIVE_STREAM_CHARS) {
            sseSend(res, "assistant_notice", {
              reason: "large_output",
              message: "…最終応答が大規模です。file_upload されたリンクを参照してください。",
            });
          }
          sseSend(res, "assistant_end", { round: round + 1 });
          sseSend(res, "final", { text: finalText });
          finalEmitted = true;
        } catch (_) { sseSend(res, "final", { text: "(max rounds reached)" }); }
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

// Shrinks a tool result for UI display without lying about the payload.
// Skills payload can be tens of KB; we only send the *names + a short
// preview* over SSE so the chat panel doesn't lag.
function shrinkForUi(result) {
  if (!result || typeof result !== "object") return result;
  // load_skill result — replace `content` with a preview.
  if (Array.isArray(result.skills)) {
    return {
      ...result,
      skills: result.skills.map(s => ({
        name: s.name,
        preview: (s.content || "").slice(0, 200) + ((s.content || "").length > 200 ? "…" : ""),
        chars: (s.content || "").length,
      })),
    };
  }
  // html_fetch — trim visible text.
  if (typeof result.text === "string" && result.text.length > 1500) {
    return { ...result, text: result.text.slice(0, 1500) + "…(truncated for UI)", ui_truncated: true };
  }
  // read_file — trim visible content.
  if (typeof result.content === "string" && result.content.length > 4000) {
    return { ...result, content: result.content.slice(0, 4000) + "…(truncated for UI)", ui_truncated: true };
  }
  // file_upload — return-as-is, small.
  return result;
}

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
    ok: true, service: "orby", version: "6.0.0",
    default_model:      DEFAULT_MODEL,
    large_output_models: LARGE_OUTPUT_MODELS,
    tools:  Object.keys(TOOLS),
    skills: SKILL_NAMES,
  });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Orby v6 running on http://localhost:${PORT}`));
}

module.exports = app;
