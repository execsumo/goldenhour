# Spec: Batch Prompts (Phase 1)

Status: ready for implementation · 2026-09-23

## 1. Objective

Let the user paste a list of prompts (one per line) and queue them all in one action, on either backend, with a visible queue they can prune, retry, and track — without changing how a single-prompt generation behaves.

## 2. Context

Golden Hour is a client-only React SPA (see [`architecture.md`](architecture.md)). "Backend" here means the in-browser job queue in `src/App.tsx`:

- `queueRef: useRef<GenerationSettings[]>` (App.tsx ~91) and `processQueue()` (~292) drain jobs strictly sequentially.
- `handleGenerate()` (~394) builds one `GenerationSettings` snapshot (crops the reference image), pushes it, calls `processQueue()`.
- The queue is invisible — the UI only gets `queueCount`.
- Gemini cannot queue: the Generate button is disabled while generating (`PromptWorkspace.tsx` ~918).
- Toggling a clip edits the prompt text directly (App.tsx ~882-907).
- `geminiGenerateImage` (`src/utils/api.ts`) has no retry on 429/503.
- `HistorySettings = Omit<GenerationSettings,'referenceImage'> & {...}` and `saveGeneration` spreads settings, so any new optional field on `GenerationSettings` is persisted automatically.

### Out of scope (Phase 2+, do NOT build)

- Aborting the in-flight job (AbortController / ComfyUI `/interrupt`).
- Filtering the history drawer by batch.
- Prompt variables (`A [subject] wearing [outfit]`).
- Persisting the queue or the batch text across reloads.

## 3. Design

### 3.1 Pure helpers — new file `src/utils/batch.ts`

Must contain **only `import type`** imports (no runtime imports) so it can be tested in isolation.

```ts
export const MAX_BATCH_PROMPTS = 100;

/** One prompt per line. Handles \r\n. Trims each line; drops blank lines. Keeps duplicates and order. */
export function parsePromptList(text: string): string[];

/**
 * Appends clip modifiers to a prompt as ", mod1, mod2".
 * Skips empty modifiers and any modifier already contained in the prompt (exact substring).
 * Returns the trimmed prompt unchanged when there is nothing to add.
 */
export function applyClipModifiers(prompt: string, modifiers: string[]): string;

/** promptCount * numberOfImages * costPerImage */
export function estimateBatchCost(promptCount: number, numberOfImages: number, costPerImage: number): number;

/**
 * Backoff for a retryable Gemini failure. attempt is 0-based.
 * If retryAfterHeader parses as a number of seconds >= 0, return that * 1000, capped at 60000.
 * Otherwise return 2000 * 2 ** attempt (2000, 4000, 8000...), capped at 60000.
 */
export function retryDelayMs(attempt: number, retryAfterHeader: string | null): number;
```

### 3.2 Types — `src/types.ts`

- Add `batchId?: string` to `GenerationSettings`.
- Add:
  ```ts
  export type QueueItemStatus = 'pending' | 'running' | 'done' | 'failed';
  export interface QueueItem {
    id: string;
    batchId?: string;
    settings: GenerationSettings;
    status: QueueItemStatus;
    error?: string;
    thumbnailDataUrl?: string; // first image of the result, when done
  }
  export type PromptMode = 'single' | 'batch';
  ```

### 3.3 Config — `src/config/defaults.ts`

- `BATCH_COST_CONFIRM_THRESHOLD = 1.0` (USD). Export it through the existing barrel/`types.ts` re-export pattern.

### 3.4 Queue engine — `src/App.tsx`

1. **Queue shape.** `queueRef` becomes `useRef<QueueItem[]>`, the worker's source of truth. Mirror it into React state (`queueItems`) after every mutation so the UI renders it. `queueCount` = number of `pending` items (keep the prop so existing UI keeps working, or derive it).
2. **`processQueue`** stays sequential. Instead of `shift()`, it picks the first `pending` item, marks it `running`, runs exactly the existing generation/save/upscale/cost logic, then marks it `done` (set `thumbnailDataUrl` from the first saved record) or `failed` (set `error`). Items stay in the list after finishing. Keep the `finally` reset of `isProcessingQueueRef`/`isGenerating`.
3. **Per-item failure** no longer toasts when the item belongs to a batch (has `batchId`); single-item failures still toast as today.
4. **Batch summary.** When the queue drains and at least one finished item in this drain had a `batchId`, show one toast: `"Batch finished: X done, Y failed"` (`'success'` if Y = 0, else `'error'`).
5. **Split `handleGenerate`:**
   - `buildBaseSettings(): Promise<GenerationSettings | null>` — everything current `handleGenerate` does except the prompt and the push: API-key check, migration check, settings snapshot, **reference image cropped once**. Returns null (after its own toast) on failure.
   - `enqueue(prompts: string[], batchId?: string)` — one `QueueItem` per prompt, `settings = { ...base, prompt, batchId }`, push, update state, call `processQueue()`.
   - Single mode: `handleGenerate()` = base + `enqueue([prompt])`, no batchId. `overrideSettings` path (Remix/Rerun) keeps working exactly as now.
   - Batch mode: `handleGenerateBatch()` = `parsePromptList(batchText)` → if 0 or > `MAX_BATCH_PROMPTS`, toast and return → map through `applyClipModifiers(p, activeModifiers)` where `activeModifiers` are the modifiers of `activeClipIds` looked up in `allClips` → if backend is Gemini and `estimateBatchCost(...)` > `BATCH_COST_CONFIRM_THRESHOLD`, `window.confirm("Queue N prompts (~$X.XX)?")` → `enqueue(prompts, 'batch-' + Date.now() + rand)`. Base settings' prompt is ignored.
6. **Mode state** lives in App: `promptMode: PromptMode` (default `'single'`) and `batchText: string`. Neither is persisted.
7. **Clips in batch mode:** `onToggleClip` still updates `activeClipIds`, but must **not** edit `prompt` text when `promptMode === 'batch'`. Single mode behaviour unchanged.
8. **Ctrl/Cmd+Enter** calls `handleGenerateBatch` in batch mode, `handleGenerate` in single mode.
9. **Queue actions:**
   - `removeQueueItem(id)` — only removes `pending` items.
   - `clearQueue()` — removes all `pending` items and all finished (`done`/`failed`) items; never touches the `running` item.
   - `retryFailed()` — for each `failed` item, append a new `pending` QueueItem (new id, same settings incl. batchId) and drop the failed original; then `processQueue()`.
10. **beforeunload:** while any item is `pending` or `running`, register a `beforeunload` handler that calls `preventDefault()` (and sets `returnValue = ''`). Remove it otherwise.

### 3.5 Gemini retry — `src/utils/api.ts`

In `geminiGenerateImage`, each per-image request retries on HTTP **429** or **503** up to **3 retries** (4 attempts total), sleeping `retryDelayMs(attempt, response.headers.get('Retry-After'))` between attempts. Other errors throw immediately as today. `enhancePrompt` is unchanged.

### 3.6 UI — `src/components/PromptWorkspace.tsx`

- New props: `promptMode`, `onPromptModeChange`, `batchText`, `onBatchTextChange`, `onGenerateBatch`, plus the queue props needed below (or pass them to the new component from App).
- **Mode switch** — a compact `Single | Batch` segmented control in the prompt section header, styled like existing controls.
- **Batch mode textarea** — replaces the single textarea (same `input-field` class, `rows={8}`), placeholder `"One prompt per line…"`. Templates/Enhance controls are hidden or disabled in batch mode (they operate on a single prompt).
- **Import .txt** — small button beside the textarea in batch mode; a hidden `<input type="file" accept=".txt,text/plain">` whose contents are **appended** to `batchText` (with a newline separator if needed).
- **Preview line** under the textarea: `N prompts × M images = K images`, plus ` · est. $X.XX` on Gemini (use `COST_PER_IMAGE[resolution].cost`). When N > `MAX_BATCH_PROMPTS`, show it in an error colour with `(max 100)`.
- **Generate button:**
  - Enabled on both backends while generating (queueing) — drop the Gemini-only disabled rule. Disabled only when there is nothing valid to queue (empty prompt in single mode; N = 0 or N > max in batch mode).
  - Label, batch mode: `Queue N prompt(s)`. Single mode: unchanged text except the Gemini `'Generating...'` label becomes `'Queue Prompt'` like ComfyUI.
- The existing ComfyUI-only "N prompts queued" banner is replaced by the queue panel below.

### 3.7 Queue panel — new `src/components/QueuePanel.tsx`

Rendered under the action buttons (both backends) whenever `queueItems.length > 0`.

- Header: `Queue · P pending · D done · F failed`, and buttons **Retry failed** (only if F > 0) and **Clear**.
- One row per item: status icon (pending = dot, running = `Loader2` spinning, done = 24px thumbnail or check, failed = `X` in red with `error` as `title`), prompt truncated to one line (full prompt in `title`), and a remove button on `pending` rows only.
- List scrolls internally past ~6 rows (`max-h` + `overflow-y-auto`). Match existing styling (lucide icons, `--text-secondary`, glass/amber accents).

## 4. Definition of Done

All must hold; the orchestrator re-runs every one independently.

1. `npm ci && npm run build` exits 0 (this runs `tsc -b`, i.e. strict typecheck).
2. `node .delegate/check-batch.mjs` exits 0 and prints `ALL OK` (it bundles `src/utils/batch.ts` with esbuild and asserts the §3.1 contracts).
3. `grep -E "^import [^t]|^import \{" src/utils/batch.ts` prints nothing (type-only imports).
4. `grep -n "batchId?: string" src/types.ts` matches; `grep -n "QueueItem" src/types.ts` matches.
5. `grep -n "BATCH_COST_CONFIRM_THRESHOLD" src/config/defaults.ts` matches.
6. `grep -n "Retry-After" src/utils/api.ts` matches.
7. `src/components/QueuePanel.tsx` exists and is imported by `App.tsx` or `PromptWorkspace.tsx`.
8. `git diff --stat master` touches only: `src/App.tsx`, `src/types.ts`, `src/config/defaults.ts`, `src/config/index.ts` (if needed), `src/utils/api.ts`, `src/utils/batch.ts`, `src/components/PromptWorkspace.tsx`, `src/components/QueuePanel.tsx`, `docs/architecture.md`. No `package.json` / lockfile changes; no new dependencies.
9. `docs/architecture.md` "Core data flow" section updated to describe the QueueItem queue, batch mode, and Gemini retry (short).
10. Behavioural (orchestrator checks by reading code): single-mode generation, Remix, Rerun, and Ctrl+Enter paths are unchanged in behaviour apart from Gemini now being able to queue.
