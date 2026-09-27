import { DEFAULT_COMFYUI_CONFIG, DEFAULT_CLIPS, COST_PER_IMAGE, BATCH_COST_CONFIRM_THRESHOLD, IMAGE_MODEL, TEXT_MODEL, API_BASE_URL } from './config';
export { DEFAULT_COMFYUI_CONFIG, DEFAULT_CLIPS, COST_PER_IMAGE, BATCH_COST_CONFIRM_THRESHOLD, IMAGE_MODEL, TEXT_MODEL, API_BASE_URL };

// ─── Backend ─────────────────────────────────────────────────────────────────

export type BackendType = 'gemini' | 'comfyui';

export interface ComfyUIConfig {
  host: string;
  port: number;
  workflowJson: string | null;  // Stored API-format workflow JSON string
  workflowFileName?: string | null; // Stored filename of custom workflow
  rtxUpscale?: boolean;          // Nvidia RTX Super Resolution for local upscaling
  rtxUpscaleScale?: number;      // RTX VSR scale multiplier (1.0–4.0, node-enforced range)
}

/** Selectable RTX VSR scale multipliers. The node supports any float 1.0–4.0;
 *  these are the presets exposed in Settings. Quality is always locked to HIGH. */
export const RTX_SCALE_OPTIONS: { value: number; label: string }[] = [
  { value: 2, label: '2×' },
  { value: 3, label: '3×' },
  { value: 4, label: '4×' },
];

/** Features that can be gated per-backend */
export type BackendFeature = 'clips' | 'enhance' | 'referenceImage' | 'costEstimate' | 'resolutionSelect' | 'aspectRatioSelect' | 'comfySettings' | 'seed';

// ─── Resolution & Aspect Ratio ───────────────────────────────────────────────

export type Resolution = '512' | '1k' | '2k' | '4k';
export type AspectRatio = '1:1' | '9:16' | '16:9' | '3:2' | '2:3';

export const RESOLUTION_OPTIONS: { value: Resolution; label: string }[] = [
  { value: '512', label: '512px' },
  { value: '1k', label: '1K' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
];

export const ASPECT_RATIO_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: '1:1',  label: '1:1 Square' },
  { value: '9:16', label: '9:16 Portrait' },
  { value: '2:3',  label: '2:3 Portrait' },
  { value: '16:9', label: '16:9 Landscape' },
  { value: '3:2',  label: '3:2 Landscape' },
];

// ─── ComfyUI Specifics ───────────────────────────────────────────────────────

export type ComfyUISampler = 'dpmpp_sde|ddim_uniform' | 'euler_ancestral|ddim_uniform' | 'res_multistep|simple' | 'sa_solver_pece|sgm_uniform' | 'sa_solver|sgm_uniform' | 'euler|simple' | 'er_sde|simple';

export const COMFYUI_SAMPLER_OPTIONS: { value: ComfyUISampler; label: string; sampler: string; scheduler: string }[] = [
  { value: 'dpmpp_sde|ddim_uniform', label: 'DPM++ SDE & DDIM Uniform', sampler: 'dpmpp_sde', scheduler: 'ddim_uniform' },
  { value: 'euler_ancestral|ddim_uniform', label: 'Euler Ancestral & DDIM Uniform', sampler: 'euler_ancestral', scheduler: 'ddim_uniform' },
  { value: 'res_multistep|simple', label: 'Res Multistep & Simple', sampler: 'res_multistep', scheduler: 'simple' },
  { value: 'sa_solver_pece|sgm_uniform', label: 'SA Solver PECE & SGM Uniform', sampler: 'sa_solver_pece', scheduler: 'sgm_uniform' },
  { value: 'sa_solver|sgm_uniform', label: 'SA Solver & SGM Uniform', sampler: 'sa_solver', scheduler: 'sgm_uniform' },
  { value: 'euler|simple', label: 'Euler & Simple', sampler: 'euler', scheduler: 'simple' },
  { value: 'er_sde|simple', label: 'ER-SDE & Simple', sampler: 'er_sde', scheduler: 'simple' },
];

export interface ComfyProgress {
  phase: 'queued' | 'running' | 'finishing';
  queueRemaining?: number;
  step?: number;
  maxSteps?: number;
  nodeId?: string;
  nodeClass?: string;
  preview?: Blob;
}

// ─── Clip System ─────────────────────────────────────────────────────────────

export type ClipCategory = 'scene' | 'expression' | 'pose' | 'outfit' | 'lighting' | 'style' | 'framing' | 'atmosphere' | 'complexion';

export interface Clip {
  id: string;
  label: string;
  modifier: string;
  isBuiltIn?: boolean;
}

export const CLIP_CATEGORIES: { key: ClipCategory; label: string }[] = [
  { key: 'scene', label: 'Scene' },
  { key: 'expression', label: 'Expression' },
  { key: 'pose', label: 'Pose' },
  { key: 'outfit', label: 'Outfit' },
  { key: 'lighting', label: 'Lighting' },
  { key: 'style', label: 'Style' },
  { key: 'framing', label: 'Framing' },
  { key: 'atmosphere', label: 'Atmosphere' },
  { key: 'complexion', label: 'Complexion' },
];

// ─── Generation Data ─────────────────────────────────────────────────────────

export interface CropState {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GenerationSettings {
  prompt: string;
  batchId?: string;
  numberOfImages: number;
  resolution: Resolution;
  aspectRatio: AspectRatio;
  referenceImage: Blob | null;
  referenceCrop: CropState | null;
  autoUpscale?: boolean;
  clips?: Record<ClipCategory, Clip[]>;
  backend?: BackendType;
  comfyuiConfig?: ComfyUIConfig;
  comfySteps?: number;
  comfySampler?: ComfyUISampler;
  comfyLora?: string | null;
  comfyLoraStrength?: number;
  comfyCfg?: number;
  comfyDiffusionModel?: string | null;
  comfyClipModel?: string | null;
  comfyVae?: string;
  /** Runtime-only VAE inventory used to resolve the auto profile choice. */
  comfyAvailableVaes?: string[];
  comfySeedMode?: 'random' | 'fixed';
  comfySeed?: number;
  seed?: number;
}

/**
 * A generation in memory, assembled from several IndexedDB keys.
 *
 * Never persisted as-is — `saveGeneration` splits it: the metadata goes to
 * `${id}` as a `HistoryEntry`, and each payload to its own `img:` / `up:` /
 * `ref:` key. localforage only detects Blob values at the *top level* of a
 * stored value, so a Blob nested inside a record object would not round-trip.
 */
export interface GenerationRecord {
  id: string;
  timestamp: string;
  settings: GenerationSettings;
  image: Blob;
  thumbnailDataUrl: string;
  upscaled?: Blob;
  backend?: BackendType;
  upscaleMechanism?: string;
}

/** Settings with the reference image replaced by a presence flag. */
export type HistorySettings = Omit<GenerationSettings, 'referenceImage'> & {
  hasReferenceImage: boolean;
};

/**
 * What the history drawer needs to render a row — and also the exact value
 * stored under key `${id}`. After image payloads moved into their own keys the
 * two shapes became identical, so there is deliberately only one type.
 *
 * Carries no image payload. Originals, upscaled copies and reference images stay
 * in IndexedDB as Blobs and fetched on demand for the record being viewed,
 * upscaled or downloaded. Keeping full-size payloads out of React state avoids
 * excessive memory use as history grows.
 *
 * The thumbnail is the one exception, and it stays a `data:` URL on purpose:
 * object URLs across a live 100-row list would need per-row revoke bookkeeping,
 * and a leaked one pins its Blob for the life of the document. At 128px WebP a
 * row costs ~8 KB.
 */
export interface HistoryEntry {
  id: string;
  timestamp: string;
  settings: HistorySettings;
  /** Full data URL, prefix included, so callers never hardcode the MIME type. */
  thumbnailDataUrl: string;
  hasUpscaled: boolean;
  backend?: BackendType;
  upscaleMechanism?: string;
  /** Actual scale used, which may differ from the configured RTX scale after fallback. */
  upscaleScale?: number;
}

/** Works on either settings shape — the in-memory one or the stored one. */
export function settingsHaveReference(s: GenerationSettings | HistorySettings): boolean {
  return 'referenceImage' in s ? !!s.referenceImage : !!s.hasReferenceImage;
}

// ─── Remix ───────────────────────────────────────────────────────────────────

/**
 * Settings the history drawer's Remix can restore selectively.
 *
 * `prompt` and `backend` are deliberately absent: both are always restored.
 * The prompt carries the clip modifiers already, so clips need no entry either.
 * `comfyLora` covers the LoRA model *and* its strength — the strength alone is
 * meaningless without the model it applies to.
 */
export type RemixRestoreKey =
  | 'numberOfImages'
  | 'resolution'
  | 'aspectRatio'
  | 'referenceImage'
  | 'autoUpscale'
  | 'comfySteps'
  | 'comfySampler'
  | 'comfyCfg'
  | 'comfyDiffusionModel'
  | 'comfyClipModel'
  | 'comfyLora'
  | 'seed';

export type RemixRestoreMask = Record<RemixRestoreKey, boolean>;

/**
 * Rows of the Remix checklist, in display order. `feature` is the backend
 * capability the row depends on; rows whose feature the record's backend does
 * not support are shown disabled. Reusing `BackendFeature` here keeps the
 * greying rule tied to the same matrix the controls themselves are gated on.
 */
export const REMIX_RESTORE_OPTIONS: {
  key: RemixRestoreKey;
  label: string;
  feature?: BackendFeature;
}[] = [
  { key: 'numberOfImages', label: 'Image count' },
  { key: 'resolution', label: 'Resolution', feature: 'resolutionSelect' },
  { key: 'aspectRatio', label: 'Aspect ratio', feature: 'aspectRatioSelect' },
  { key: 'referenceImage', label: 'Reference image', feature: 'referenceImage' },
  { key: 'autoUpscale', label: 'Auto-upscale' },
  { key: 'comfySteps', label: 'Steps', feature: 'comfySettings' },
  { key: 'comfySampler', label: 'Sampler', feature: 'comfySettings' },
  { key: 'comfyCfg', label: 'CFG scale', feature: 'comfySettings' },
  { key: 'comfyDiffusionModel', label: 'Diffusion model', feature: 'comfySettings' },
  { key: 'comfyClipModel', label: 'CLIP model', feature: 'comfySettings' },
  { key: 'comfyLora', label: 'LoRA + strength', feature: 'comfySettings' },
  { key: 'seed', label: 'Seed', feature: 'seed' },
];

/** Everything on. Anything stored is merged over this, so a key added in a
 *  later version starts ticked instead of silently never restoring. */
export const DEFAULT_REMIX_RESTORE: RemixRestoreMask = REMIX_RESTORE_OPTIONS.reduce(
  (acc, opt) => { acc[opt.key] = true; return acc; },
  {} as RemixRestoreMask
);

// ─── Templates ───────────────────────────────────────────────────────────────

export interface PromptTemplate {
  id: string;
  name: string;
  prompt: string;
  isBuiltIn?: boolean;
}

// ─── Queue ───────────────────────────────────────────────────────────────────

export type QueueItemStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
export interface QueueItem {
  id: string;
  batchId?: string;
  settings: GenerationSettings;
  status: QueueItemStatus;
  progress?: number;
  error?: string;
  thumbnailDataUrl?: string; // first image of the result, when done
}
export type PromptMode = 'single' | 'batch';

// ─── Session State ───────────────────────────────────────────────────────────

export interface SessionStats {
  totalCost: number;
  imageCount: number;
}
