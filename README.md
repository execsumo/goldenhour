# 🌅 Golden Hour

A personal, single-page image-generation studio that runs entirely in the browser. It drives **two interchangeable backends** from one UI:

- **Gemini (cloud)** — Google's `gemini-3.1-flash-image-preview` model via your own API key.
- **ComfyUI (local)** — a locally running ComfyUI instance with zero-disk-write WebSocket image streaming (`SaveImageWebsocket`), including optional **NVIDIA RTX Video Super Resolution (VSR)** hardware upscaling.

There is no server component. All API calls are made client-side, your API key stays in `localStorage`, and generated images live in your browser's IndexedDB.

---

## Features

- **Dual backend** with a one-click toggle; the UI enables/disables features per backend.
- **ComfyUI Sequential Prompt Queuing** — submit prompts to a queue while a generation is running; executes strictly one by one to avoid GPU contention. Running generations can be cancelled without interrupting queued prompts.
- **Prompt workspace** with multi-line prompt, reference-image crop/zoom, resolution and aspect-ratio selectors.
- **Clip system** — curated, categorized prompt modifiers (scene, lighting, pose, style, …) you can toggle into the prompt.
- **Prompt templates** — save/load/delete reusable prompt text.
- **Magic enhance** (Gemini) — expand a terse prompt into a detailed one via a text-only model call.
- **Live cost estimate + session counter** (Gemini pricing table).
- **History drawer** — thumbnails persisted in IndexedDB, fullscreen view, per-item delete, download-all as a zip.
- **Remix** — restore a past generation's settings into the controls, including a recorded ComfyUI seed when enabled. Prompt and backend always come back; the cog beside the button picks which of the rest do. That choice sticks until you change it.
- **ComfyUI seed control** — choose random or fixed seeds, reuse the last seed, and view/copy seeds from history. Seeds are saved with generation metadata and embedded in downloaded PNGs.
- **ComfyUI model-family profiles** — automatically choose compatible VAE settings and suggest family-specific steps, CFG, sampler, and CLIP defaults for supported models (Z-Image, Qwen-Image 2.1, Krea 2, and Anima). Your per-family adjustments are remembered; CLIP suggestions are applied only when the matching file is installed.
- **Live ComfyUI progress** — show sampling progress, the active node and queue position, with optional latent previews.
- **Quick Upscale** — RTX VSR when available (selectable **2×/3×/4×**, quality locked to HIGH), with automatic fallback to browser-canvas scaling.
- **Metadata embedding** — prompt/model/settings written into PNG text chunks at download time.
- **Export/Import** — back up API key, settings, templates, and clips as JSON.

---

## Tech stack

| Concern | Choice |
|---|---|
| Framework | React 19 + TypeScript |
| Build/dev | Vite 6 |
| Styling | Tailwind CSS 3 (dark-mode default) |
| Icons | lucide-react |
| History persistence | IndexedDB via `localforage` |
| Light persistence | `localStorage` (key, settings, templates, clips) |
| Zip export | JSZip |
| Reference cropping | `react-easy-crop` + Canvas API |

---

## Getting started

### Prerequisites
- Node.js 18+ and npm.
- For the Gemini backend: a Google Generative Language API key.
- For the ComfyUI backend: a running ComfyUI server (default `127.0.0.1:8188`). RTX upscaling additionally requires the **NVIDIA RTX Nodes** custom node pack (`RTXVideoSuperResolution`) on an RTX GPU.

### Install & run
```bash
npm install
npm run dev      # start Vite dev server at http://127.0.0.1:5173
```

### Build
```bash
npm run build    # tsc -b && vite build  →  dist/
npm run preview  # serve the production build locally
```

---

## Configuration

Open **Settings** (gear icon) in the app:

- **Backend** — Gemini or ComfyUI.
- **Gemini** — paste your API key (masked, stored in `localStorage`), or leave it blank to use a key preset via `VITE_GEMINI_API_KEY`.
- **ComfyUI** — host/port, **Test Connection** (also probes for the RTX VSR node), optional custom API-format workflow upload, and — when RTX is detected — the **Upscale factor** control (2×/3×/4×). Seed and model-family controls are available in the generation workspace.

### Environment variables & default configurations

Application defaults (API base URLs, Gemini model names, default clips, built-in templates, ComfyUI host/port defaults, and txt2img workflow graphs) are centralized in [`src/config/`](src/config/).

To override default configurations without modifying source code, copy [`.env.example`](.env.example) to `.env` and set any desired `VITE_*` environment variables:

```bash
# Example .env overrides
VITE_GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview
VITE_COMFYUI_HOST=127.0.0.1
VITE_COMFYUI_PORT=8188
```

Vite reads `.env` only at startup and compiles the values into the bundle, so changes don't hot-reload: restart `npm run dev` / `npm run preview` after editing `.env`, and re-run `npm run build` for a deployed `dist/`.

#### Preconfiguring for guests

Set `VITE_GEMINI_API_KEY` and/or `VITE_COMFYUI_HOST` / `VITE_COMFYUI_PORT` so people using your instance can generate without entering anything in Settings. Values a user enters in Settings still override the presets. If only ComfyUI is preset, ComfyUI becomes the default backend.

> **Warning:** `VITE_*` variables are compiled into the client bundle. A preset `VITE_GEMINI_API_KEY` is visible to anyone who can load the app, so only use it on instances you trust everyone with access to.

### ComfyUI connection & CORS

When the configured ComfyUI target matches the proxy host/port (any loopback alias counts as a match for a loopback proxy target), the Vite dev or preview server proxies requests through `/comfyui-api` (see [`vite.config.ts`](vite.config.ts)) to avoid CORS issues. The proxy target defaults to `127.0.0.1:8188` and can be set with `VITE_COMFYUI_HOST` and `VITE_COMFYUI_PORT`; the Settings host and port must match those values for the proxy to be used. A remote host set via `VITE_COMFYUI_HOST` is proxied too. Any other host or port connects directly, so ComfyUI must be started with `--enable-cors-header` for those connections.

### Live Previews & Progress

Live latent previews in the Output panel require ComfyUI to be started with a preview method enabled, such as `--preview-method auto` (or `taesd` for fast, lightweight decoding). Progress tracking (sampling step count, currently executing node, and queue position) works out of the box regardless of the preview method setting.

---

## Documentation

- **[Architecture](docs/architecture.md)** — module map, data flow, backend abstraction, storage model, and configuration.
- **[Roadmap](docs/roadmap.md)** — remaining features worth considering.


---

## Notes

- This is a **personal-use** app: no auth, no backend, no multi-user considerations.
- The API key is stored in plaintext in `localStorage` — do not use on a shared machine.
- Targets modern Chromium/Firefox. Offline generation is impossible (needs the backend), but history remains browsable offline.
