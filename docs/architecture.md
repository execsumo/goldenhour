# Architecture

Golden Hour is a **client-only React SPA**. There is no backend of its own — it talks directly to either Google's Gemini API or a local ComfyUI server from the browser. This document maps the code so a new contributor can find their way quickly.

---

## High-level shape

```
┌─────────────────────────────────────────────────────────────┐
│  App.tsx  (single stateful container)                       │
│  - owns all React state (prompt, settings, history, session)│
│  - orchestrates generate / upscale / history flows          │
│                                                             │
│  ┌───────────────┬───────────────┬──────────────────────┐  │
│  │ PromptWorkspace│ GenerationDisplay │ HistoryDrawer     │  │
│  │ (inputs, clips)│ (current output)  │ (persisted list)  │  │
│  └───────────────┴───────────────┴──────────────────────┘  │
│  + SettingsModal, ClipDrawer, Toast                         │
└───────────────┬─────────────────────────────────────────────┘
                │ generateImageWithBackend(settings)
                ▼
        utils/backendProvider.ts   ← single dispatch point
                │
        ┌───────┴────────┐
        ▼                ▼
   utils/api.ts     utils/comfyui.ts
   (Gemini REST)    (ComfyUI REST + workflow injection)
```

The whole app is essentially one big stateful component (`App.tsx`) plus presentational children and a set of pure-ish utility modules. State is lifted to `App`; children receive props and callbacks.

---

## Module map

### Entry
- **`src/main.tsx`** — React root bootstrap.
- **`src/App.tsx`** — the application. Holds state, wires callbacks, runs the generate/upscale/history logic. Start here.
- **`src/index.css`** — Tailwind layers + CSS variables (theme tokens like `--text-secondary`).

### Configuration layer — `src/config/`
Centralized defaults and owner-tunable constants:
- **`endpoints.ts`** — API base URLs (`API_BASE_URL`), Gemini model names (`IMAGE_MODEL`, `TEXT_MODEL`), and default ComfyUI connection options (`DEFAULT_COMFYUI_HOST`, `DEFAULT_COMFYUI_PORT`) with optional `import.meta.env.VITE_*` overrides, plus operator presets (`PRESET_GEMINI_API_KEY` from `VITE_GEMINI_API_KEY`, `HAS_PRESET_COMFYUI`) that let guests generate without entering anything in Settings.
- **`workflows.ts`** — Default ComfyUI txt2img API workflow graph (`DEFAULT_WORKFLOW`).
- **`clips.ts`** — Default prompt modifier clips (`DEFAULT_CLIPS`).
- **`templates.ts`** — Built-in prompt templates (`DEFAULT_TEMPLATES`).
- **`defaults.ts`** — Default generation parameters (steps, sampler, CFG, resolution, aspect ratio, cost table, `DEFAULT_COMFYUI_CONFIG`).
- **`modelProfiles.ts`** — model-family matching and defaults for VAE, CLIP suggestions, steps, CFG, and sampler.
- **`index.ts`** — Unified export barrel.

### ComfyUI model profiles

`src/config/modelProfiles.ts` matches supported diffusion model families (currently Z-Image, Qwen-Image 2.1, Krea 2, and Anima) and supplies their VAE and suggested generation defaults. The matching VAE is selected automatically when available. Steps, CFG, sampler, and CLIP suggestions are seeded on first family selection; user edits are remembered per family in `localStorage`. A suggested CLIP filename is used only when that exact file is installed. Families requiring a dual-CLIP workflow are outside the current built-in workflow's scope.

### Types & data models — `src/types.ts`
Single source of truth for TypeScript interfaces and re-exported default constants:
- `BackendType`, `ComfyUIConfig`, `BackendFeature`.
- `Resolution` / `AspectRatio` and their option lists.
- ComfyUI sampler options, `RTX_SCALE_OPTIONS`, and `ComfyProgress`.
- The **Remix restore mask** (`RemixRestoreKey`, `RemixRestoreMask`, `REMIX_RESTORE_OPTIONS`, `DEFAULT_REMIX_RESTORE`) — which settings Remix puts back. See [Remix](#remix).
- The **Clip** system (`ClipCategory`, `Clip`).
- `GenerationSettings` (the request), `GenerationRecord` (a generation assembled in memory), `HistoryEntry` (a history row **and** the on-disk metadata shape — the two are the same type), `PromptTemplate`, `SessionStats`.
- Image payloads are `Blob`s throughout; base64 appears only at the Gemini network boundary.
- Re-exports `DEFAULT_COMFYUI_CONFIG`, `DEFAULT_CLIPS`, `COST_PER_IMAGE`, `IMAGE_MODEL`, `TEXT_MODEL`, `API_BASE_URL` from `src/config/`.


### Backend layer
- **`src/utils/backendProvider.ts`** — the abstraction seam. `generateImageWithBackend(settings)` dispatches to Gemini or ComfyUI. `backendSupportsFeature(backend, feature)` gates UI features per backend (e.g. Gemini has `enhance`/`referenceImage`; ComfyUI has `comfySettings`/`seed`). **Any new backend or per-backend capability change goes through this file.**
- **`src/utils/api.ts`** — Gemini REST client. `geminiGenerateImage()` (image generation) and `enhancePrompt()` (text-only prompt expansion).
- **`src/utils/comfyui.ts`** — ComfyUI client. Base-URL/proxy resolution, connection testing and RTX-node detection, asset discovery, image upload, workflow preparation (including model-family VAE selection and seed injection), WebSocket execution with binary image frames, progress reporting and abort/cancel handling, generation, and RTX upscaling.

### Persistence
- **`src/utils/settings.ts`** — all `localStorage`-backed preferences: API key, backend, resolution/aspect defaults, ComfyUI config and generation params (steps, sampler, CFG, LoRA, models, seed), per-family model-profile overrides, the Remix restore mask, prompt templates, clips, and the export/import bundle (`exportSettings` / `importSettings`).
- **`src/utils/storage.ts`** — IndexedDB (via `localforage`) history store, schema v2. Metadata and payloads are stored under **separate keys** so reading the history never touches image bytes:

  | Key | Value |
  |---|---|
  | `__index` | `string[]` of record ids, newest first |
  | `__migrated` / `__schemaVersion` | one-shot migration flags |
  | `${id}` | `HistoryEntry` — metadata + inline thumbnail data URL, **no Blobs** |
  | `img:` / `up:` / `ref:` + `${id}` | `Blob` payloads |

  `initStorage()` runs the legacy `nanoBanana` import and the v1→v2 conversion once; it is memoized and awaited by every other export, so nothing races it. `sweepOrphanBlobs()` reclaims payload keys orphaned by an interrupted delete. There is deliberately no "load all records" helper.

### Image & metadata
- **`src/utils/blob.ts`** — `base64ToBlob` / `blobToBase64` / `blobToDataUrl` / `downloadBlob`. A leaf module: storage, comfyui, api and metadata all use it.
- **`src/hooks/useObjectUrl.ts`** — owns exactly one object URL for a Blob, creating and revoking inside the same effect so the pair can never separate.
- **`src/utils/image.ts`** — Canvas helpers built on `createImageBitmap` + `OffscreenCanvas.convertToBlob` (both off the main thread): `cropReferenceImage` (crop + downsample to ≤512px), `upscaleImage` (browser-canvas fallback upscale), and the shared `renderToBlob`.
- **`src/utils/metadata.ts`** — `embedMetadataInPngBlob` (writes generation metadata into PNG `tEXt` chunks at download time, assembling the result from `subarray` views) and `createThumbnailDataUrl` (256px WebP, JPEG fallback).

### Components — `src/components/`
- **`SettingsModal.tsx`** — backend/API-key/ComfyUI config UI, connection test, RTX toggle + scale control, export/import, clear history.
- **`PromptWorkspace.tsx`** — prompt textarea, reference-image dropzone/cropper, resolution/aspect selectors, ComfyUI seed and model controls, action buttons, templates, and enhance controls.
- **`GenerationDisplay.tsx`** — current image(s), loading state, download, quick-upscale trigger.
- **`HistoryDrawer.tsx`** — persisted thumbnails, fullscreen view, Remix (+ its restore checklist), seed display/copy, delete, and download-all (folder picker where supported, with zip fallback).
- **`ClipDrawer.tsx`** — browse/toggle/manage clip modifiers.
- **`Toast.tsx`** — transient notifications.

---

## Core data flow: a generation & queueing

1. User edits the prompt/settings in `PromptWorkspace` (supports Single or Batch mode); state lives in `App`.
2. `App.handleGenerate` (or `App.handleGenerateBatch`) assembles a `GenerationSettings` object snapshot (prompt + active clips folded in, resolution, aspect, reference image/crop, backend, ComfyUI params, and seed mode/value).
3. The items are pushed to `queueRef.current` (as `QueueItem` objects with a `status`), and `App.processQueue()` is invoked:
   - The queue worker (`processQueue`) drains `pending` items strictly **sequentially**, processing one prompt at a time, marking them `running`, `done`, `failed`, or `cancelled`. The user can cancel the running generation or remove pending items.
4. For Gemini, `App` validates the API key exists. The reference image is cropped/downsampled via `cropReferenceImage`.
5. `generateImageWithBackend(settings)` dispatches to the active backend:
   - **Gemini** → `geminiGenerateImage()` → REST call. Per-image requests retry up to 3 times on HTTP 429/503. Base64 from `inline_data` is decoded to a `Blob` at the boundary.
   - **ComfyUI** → `comfyuiGenerateImage()` → injects workflow settings and a random or fixed seed, transforms output nodes to `SaveImageWebsocket`, queues the prompt, then streams image frames and progress over WebSocket. An abort signal can cancel the running prompt; latent previews are optional and require ComfyUI preview support.
6. On success `App` builds a `GenerationRecord` (image Blob + thumbnail + settings) and calls `saveGeneration`, which splits it across the payload and metadata keys and returns the `HistoryEntry` to prepend to history state. Session cost/count updates and `GenerationDisplay` renders the batch through object URLs.
7. On failure or cancellation, a `Toast` shows the outcome (or the `QueueItem` status/error is updated), and the queue processor continues to the next queued item (if any). Cancellation targets the running generation, not the remaining queued items.

Metadata is **not** embedded at storage time — only at **download time** (`embedMetadataInPngBlob`) to keep writes fast.

---

## Upscaling

`App.performUpscale(image: Blob)`:
- If backend is ComfyUI **and** `rtxUpscale` is enabled, call `comfyuiUpscaleImageRTX(config, image, scale)` where `scale` is `config.rtxUpscaleScale` (2/3/4). On any error, fall back to browser-canvas `upscaleImage`.
- Otherwise use the browser-canvas path directly.

### RTX VSR node contract (important)

`RTXVideoSuperResolution` is a **ComfyUI V3-schema node** whose `resize_type` is a **DynamicCombo**. The `scale` value is a *nested* input of the selected option, not a flat sibling. In the API prompt, nested dynamic inputs are keyed with the parent's dotted prefix, so the graph must send:

```jsonc
"inputs": {
  "images": ["1", 0],
  "resize_type": "scale by multiplier",
  "resize_type.scale": 2.0,   // NOT "scale": 2.0
  "quality": "HIGH"
}
```

ComfyUI's `build_nested_inputs` reassembles those flat, dotted keys into `{ resize_type: "scale by multiplier", scale: 2.0 }` before the node runs. Sending a bare `scale` is silently ignored and fails validation with *"Required input is missing: scale"*. `scale` is clamped to the node's supported `1.0–4.0` range; quality is fixed in code at `HIGH` (the node accepts `LOW`/`MEDIUM`/`HIGH`/`ULTRA` and is not exposed in the UI).

---

## Remix

`HistoryDrawer`'s **Remix** restores a past generation's settings into the workspace controls, then leaves the user to tweak and generate. `App.handleReusePrompt(entry)` does the work.

- **Always restored:** the prompt and the backend. Clips need no entry of their own — they are folded into the prompt at generate time, so restoring the prompt restores them.
- **Everything else is opt-out**, governed by the `RemixRestoreMask` behind the cog beside the button. The mask is a **global preference**, not a per-record one: unticking a row sticks for every later Remix and across launches (`getRemixRestore` / `setRemixRestore`). Unticked settings keep whatever the controls currently hold.
- Rows whose `BackendFeature` the record's backend does not support are shown **disabled** — reusing `backendSupportsFeature` rather than a second matrix. The stored mask is untouched by greying, since it is global.
- Stored masks are merged **key by key over an all-true default**, so a row added in a later version starts ticked instead of being silently suppressed by an older stored blob.
- `handleReusePrompt` applies every control **synchronously before its first `await`**. Restoring the backend schedules `fetchComfyAssets`, which reads the ComfyUI controls back out of `localStorage`; awaiting first would let it run against the pre-Remix values and undo the restore.
- Values the app can no longer honour — a sampler dropped from `COMFYUI_SAMPLER_OPTIONS`, a model or LoRA no longer on the ComfyUI host — are skipped and reported in one toast. Model lists are empty while the host is unreachable, so absence only counts as "gone" when a list actually exists.
- The seed is a Remix option; restoring a recorded seed switches ComfyUI to fixed-seed mode.
- `lastSettingsRef` is set to the **merged** result (current controls overwritten by what was actually restored), not to the record. The workspace's own Remix replays that ref, so an excluded setting cannot creep back in through it.

---

## ComfyUI networking

`getBaseUrl(config)` and `getWebSocketUrl(config, clientId)` in `comfyui.ts`:
- **Default target** (`127.0.0.1`/`localhost` : `8188`) → returns `/comfyui-api` (HTTP) and `/comfyui-api/ws` (WebSocket), which the Vite dev proxy forwards to ComfyUI (rewriting `origin` to sidestep CORS). See [`vite.config.ts`](vite.config.ts).
- **Non-default target** → direct `http://host:port` / `ws://host:port/ws`, which requires ComfyUI to run with `--enable-cors-header`.

The generation workflow (`prepareWorkflow`) automatically converts `SaveImage` and `PreviewImage` output nodes into `SaveImageWebsocket`. During execution, binary image frames and progress events are received over the WebSocket connection; optional latent previews depend on ComfyUI's preview-method configuration. Output images stream to the browser without writing generated files to the host server's output directory. Aborting a running request signals ComfyUI to cancel that prompt.

---

## Conventions & gotchas

- **State is centralized in `App.tsx`.** Prefer adding a `use…` setter + a `settings.ts` getter/setter pair for anything that should persist.
- **`getComfyUIConfig()` merges over `DEFAULT_COMFYUI_CONFIG`**, so adding a new config field with a default is backward-compatible with existing stored configs.
- **Feature gating** belongs in `backendProvider.ts`'s `BACKEND_FEATURES`, not scattered `if (backend === …)` checks in components.
- **`tsconfig.node.json`** is a composite project for `vite.config.ts`; it must **not** set `noEmit` and must **not** carry `allowImportingTsExtensions` (that pairing breaks `tsc -b`). It needs `@types/node` for the config's `path`/`__dirname` usage.
