# Original Gemini Image Generation App Specification

> **Historical document:** This is the original, Gemini-only product brief. It predates the current dual-backend app and may not reflect implemented behavior or current requirements. Retained for historical context; do not treat as authoritative documentation.

Personal-use web app for generating images via the `gemini-3.1-flash-image-preview` model through Google's API. Designed to be vibe-coded as a single-page React app.

---

## Tech Stack

- **Framework:** React (Vite + Tailwind CSS) with a minimalist, polished default **Dark Mode**
- **Persistence:** IndexedDB for session history that survives page refresh
- **Image processing:** Canvas API for reference image crop/zoom and downsampling
- **Metadata:** EXIF/PNG chunk embedding (machine-readable, no visible watermark) — use an appropriate lightweight library
- **Zip export:** JSZip for client-side download-all packaging
- **No backend:** All API calls made client-side; API key stored locally

---

## 1. Settings Panel

- Accessed via a **gear icon** (persistent, always available in the UI)
- Contains **Google API Key** field (text input, masked by default with show/hide toggle)
- Contains a **Clear History** button to wipe all IndexedDB records and clear session state
- Key is stored in browser localStorage so it persists across sessions
- If no key is set when the user clicks Run, show a toast directing them to Settings

---

## 2. Prompt Workspace (Main View)

The central area of the app. All generation controls live here.

### 2.1 Reference Image (Optional for the User)

- **Drag-and-drop zone** (also click-to-upload) for a single reference character image
- Once uploaded, display the image in an interactive **crop/zoom viewer**:
  - User can zoom in/out (scroll wheel or pinch) and pan to frame the region they want
  - A visible crop boundary shows exactly what will be sent
- **On submit behavior:**
  - If the user has cropped/zoomed, extract the visible region at up to 512×512px
  - If the user has NOT cropped, send the full image as-is if it's ≤512px on its longest side; otherwise downsample to 512px on the longest side (preserve aspect ratio)
- A clear/remove button to discard the reference image
- The reference image (and its crop state) is stored as part of generation metadata for reuse

### 2.2 Generation Controls

Three selectors, displayed inline (horizontal row or compact grid):

| Control | Options | Default |
|---------|---------|---------|
| **Resolution** | 512px, 1K, 2K, 4K | 1K |
| **Aspect Ratio** | 1:1, 9:16, 16:9, 3:2, 2:3 | 1:1 |

Note: The API's aspect ratio options already encode orientation (9:16 = portrait, 16:9 = landscape), so a separate orientation selector is unnecessary. The UI labels can hint at this, e.g. "9:16 (portrait)" and "16:9 (landscape)" to keep it intuitive.

### 2.3 Cost Estimate

- Display an **estimated cost** below or beside the generation controls, updated live as the user changes resolution or aspect ratio
- Cost calculation uses the following fixed per-image pricing (based on $60 per 1M output tokens):

| Resolution | Tokens | Cost per Image |
|------------|--------|----------------|
| 512px | 747 | $0.045 |
| 1K | 1,120 | $0.067 |
| 2K | 1,680 | $0.101 |
| 4K | 2,520 | $0.151 |

- Cost is determined **by resolution only** — aspect ratio does not affect pricing
- If a reference image is included, note that input tokens are charged separately but at a negligible rate compared to output; the estimate should reflect output cost only, with an optional "(+ input tokens)" note
- The pricing table should be defined as a config constant at the top of the codebase so it's easy to update if Google changes pricing
- Format: e.g. "Estimated cost: ~$0.067"

### 2.4 Session Cost Counter

- Display a **running total of estimated cost** for the current session, positioned in the top bar or near the generation controls
- Uses the same per-image pricing table from Section 2.3 to accumulate cost
- Format: e.g. "Session: ~$0.32 (8 images)"
- Increments each time a generation completes successfully
- Also shows **total generation count** for the session
- Resets on page refresh (session-scoped, not persisted) — this is a quick-glance convenience, not an accounting tool
- Stored in React state, not IndexedDB

### 2.5 Prompt Input

- Freeform **multi-line text area** for entering the generation prompt
- No character limit enforced in the UI (let the API reject if needed)
- Placeholder text hinting at usage, e.g. "Describe the image you want to generate..."

### 2.6 Prompt Templates / Saved Favorites

- A **"Templates"** dropdown or button adjacent to the prompt text area
- Users can **save the current prompt as a template** (give it a name)
- Users can **load a saved template** into the prompt field (replaces current text, does not change other settings)
- Users can **delete saved templates**
- Templates are stored in **localStorage** (lightweight, just text + name)
- Templates save **only the prompt text** — not resolution/aspect/reference image (those are generation settings, not prompt templates)
- A few built-in starter templates can ship with the app as examples (deletable by the user)

### 2.7 Magic Prompt Enhancement (Optional Feature)

- A **"Sparkle" icon button** near the prompt input
- Uses a lightweight Gemini text-only API call (using the same API key) to expand a basic prompt into a highly detailed, descriptive image generation prompt
- User typing "a cyberpunk cat" and clicking the button replaces the text with something like "A highly detailed cinematic shot of a cybernetic feline stalking through a neon-lit, rain-slicked alleyway in a dystopian megalopolis, vibrant pink and cyan lighting, photorealistic..."
- Enhances user experience by helping construct better prompts for the image model

### 2.7 Action Buttons

Three distinct actions, visually grouped:

| Button | Behavior |
|--------|----------|
| **Run** | Sends the current prompt + settings + optional reference image to the API. Generates a new image. |
| **Re-run** | Re-sends the exact same request (same prompt, settings, reference image). No seed parameter — relies on model randomness for variation. |
| **New** | Resets all fields to defaults: clears prompt text, removes reference image, resets resolution to 1K and aspect ratio to 1:1. |

- **Re-run** and **Edit** are only visible/enabled after at least one generation has been made
- **Edit** is not a separate button — it's the implicit state after generation. The workspace retains all settings from the last run so the user can tweak and re-run. The distinction is: Run after editing = new generation with modified params; Re-run = identical params.
- **Keyboard shortcut:** `Cmd+Enter` (Mac) / `Ctrl+Enter` (Windows/Linux) triggers Run from anywhere in the workspace. The shortcut should be shown as a hint on the Run button tooltip.

---

## 3. Generation Display

- Located to the right of or below the prompt workspace (responsive layout)
- Shows the **most recently generated image** at a viewable size
- **Download button** positioned close to the image (top-right corner or directly below)
  - Downloads the image with embedded EXIF/PNG metadata (see Section 6)
  - Filename format: `nanobananav2_{timestamp}.png`

### 3.1 Loading State

When an API call is in progress:
- A **spinner/progress indicator** overlays the image display area
- A **"Generating..."** placeholder text is shown
- The **Run button is disabled** with a subtle loading state (e.g. spinner replaces button text)
- All three indicators are active simultaneously

### 3.2 Error Handling

- On API failure (bad key, rate limit, network error, model error):
  - Show a **toast notification** with the error message (auto-dismiss after ~5 seconds, or click to dismiss)
  - **Keep the last generated image visible** — do not clear the display area
  - Re-enable the Run button so the user can retry

---

## 4. History Drawer (Left Sidebar)

- **Collapsible left-side drawer** showing thumbnails of all previously generated images
- Thumbnails are displayed in reverse chronological order (newest at top)
- Each thumbnail shows a small preview of the generated image
- **Delete button** on each thumbnail (small X icon, top-right corner of the thumbnail)
  - Confirm before deleting: brief "Are you sure?" inline confirmation or undo toast (not a modal — keep it lightweight)
  - Removes the image from IndexedDB and the drawer immediately
- **Persistence:** All history is stored in **IndexedDB**, surviving page refreshes and browser restarts
- Scrollable if the list grows long

### 4.1 Expanded View (Click on Thumbnail)

- Clicking a thumbnail opens the image in a **fullscreen overlay/modal**
- The image is displayed as large as possible (centered, maintaining aspect ratio)
- **On hover or toggle:** A settings panel slides in or appears showing all generation metadata:
  - Prompt text
  - Resolution, aspect ratio
  - Model name (`gemini-3.1-flash-image-preview`)
  - Timestamp
  - Whether a reference image was used (and a small preview of it if so)
- **"Reuse Prompt" button** in the expanded view:
  - Closes the fullscreen overlay
  - Populates the prompt workspace with ALL settings from that historical generation:
    - Prompt text
    - Resolution, aspect ratio selections
    - The original reference image (and its crop state, if one was used)
  - The user can then edit any field and hit Run

### 4.2 Download All

- A **"Download All"** button in the drawer header (visible when history contains at least one image)
- Packages **all generated images** from IndexedDB into a single **.zip file** and triggers a browser download
- Each image in the zip retains its embedded metadata (see Section 6)
- Filename format for the zip: `nanobananav2_all_{date}.zip`
- Use a client-side zip library (e.g. JSZip) — no server needed
- Show a brief progress indicator if the zip takes time to build (many/large images)

### 4.3 Drawer Behavior

- Drawer can be toggled open/closed (hamburger icon or similar)
- On narrow screens, drawer overlays the content; on wide screens, it pushes content aside
- Empty state: "No images generated yet" message

---

## 5. API Integration

### 5.1 Request

- Endpoint: Google API using `gemini-3.1-flash-image-preview` model
- Authentication: User-provided Google API key from Settings
- Payload includes:
  - Prompt text
  - Resolution + aspect ratio (passed as enum values directly to the API)
  - Reference image (base64-encoded, if provided), cropped/downsampled per Section 2.1
- No explicit seed parameter — re-runs send the identical request

### 5.2 API Parameters

The API accepts resolution and aspect ratio as enum values directly — no pixel dimension calculation needed.

| Parameter | Accepted Values |
|-----------|----------------|
| **Resolution** | `512`, `1k`, `2k`, `4k` |
| **Aspect Ratio** | `1:1`, `9:16`, `16:9`, `3:2`, `2:3` |

The API handles pixel dimension mapping internally.

### 5.3 Response Format

- Images are returned as **base64-encoded strings** in a standard JSON response body
- Default MIME type: `image/png`
- Image data is located in the `inline_data` field of the response candidate parts
- On receipt: decode the base64 string, store the raw image data in IndexedDB (for history), and display via a blob URL or data URI
- Metadata embedding (Section 6) is applied at **download time**, not at storage time — this keeps IndexedDB writes fast and avoids re-encoding on every generation

---

## 6. Metadata Embedding

Every downloaded image includes machine-readable metadata embedded in EXIF (for JPEG) or PNG text chunks (for PNG). No visible watermark.

### Fields to embed:

- `prompt` — The full prompt text
- `model` — "gemini-3.1-flash-image-preview"
- `resolution` — The selected resolution label (e.g. "1k")
- `aspect_ratio` — The selected ratio (e.g. "2:3")
- `reference_image_used` — true/false
- `timestamp` — ISO 8601 generation timestamp
- `app` — "Nano Banana Image Generator"

---

## 7. Data Flow Summary

```
User enters prompt + settings + optional reference image
        ↓
Clicks Run (or Re-run)
        ↓
App validates API key exists → if not, toast to Settings
        ↓
Reference image processed (crop extraction, downsample to ≤512px)
        ↓
API call made with all parameters
        ↓
Loading state shown (spinner + placeholder + disabled button)
        ↓
On success:
  - Image displayed in generation area
  - Thumbnail added to history drawer (top)
  - Full generation data saved to IndexedDB
  - Workspace retains current settings (edit-and-rerun ready)
        ↓
On failure:
  - Toast notification with error
  - Previous image remains visible
  - Run button re-enabled
```

---

## 8. Export/Import Settings

- Ability to **Export all app data** (Templates, API Key, Settings, and optionally recent History) as a JSON backup file.
- Ability to **Import app data** to seamlessly transfer between devices or browsers.

---

## 8. Edge Cases & Notes

- **First launch:** No API key set, history drawer empty, prompt workspace in default state. Gear icon should have a subtle indicator (dot/badge) hinting that setup is needed.
- **IndexedDB storage limits:** For personal use this is unlikely to be an issue, but consider a "clear history" option in Settings as a safety valve.
- **Large reference images:** The 512px downsample cap is for token efficiency. The crop viewer should handle images of any input size gracefully.
- **Browser support:** Target modern Chrome/Firefox/Edge. No IE or Safari compatibility needed unless desired.
- **Offline:** The app is useless without API access, so no offline mode needed. IndexedDB history is still browsable offline.
- **Image format:** Default to PNG for lossless quality and easy metadata embedding. If the API returns a different format, convert before storing/displaying.
