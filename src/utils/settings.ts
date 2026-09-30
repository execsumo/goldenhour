import { PromptTemplate, Clip, ClipCategory, Resolution, AspectRatio, BackendType, ComfyUIConfig, ComfyUISampler, RemixRestoreMask, REMIX_RESTORE_OPTIONS, DEFAULT_REMIX_RESTORE } from '../types';
import {
  DEFAULT_COMFYUI_CONFIG,
  DEFAULT_CLIPS,
  DEFAULT_TEMPLATES,
  DEFAULT_COMFY_STEPS,
  DEFAULT_COMFY_SAMPLER,
  DEFAULT_COMFY_LORA,
  DEFAULT_COMFY_LORA_STRENGTH,
  DEFAULT_COMFY_CFG,
  DEFAULT_COMFY_DIFFUSION_MODEL,
  DEFAULT_COMFY_CLIP_MODEL,
  DEFAULT_COMFY_VAE,
  DEFAULT_COMFY_SEED_MODE,
  DEFAULT_COMFY_SEED,
  DEFAULT_RESOLUTION,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_AUTO_UPSCALE,
  PRESET_GEMINI_API_KEY,
  HAS_PRESET_COMFYUI,
} from '../config';

const API_KEY_KEY = 'goldenHour_apiKey';
const TEMPLATES_KEY = 'goldenHour_templates';
const RESOLUTION_KEY = 'goldenHour_resolution';
const ASPECT_RATIO_KEY = 'goldenHour_aspectRatio';
const CLIPS_KEY = 'goldenHour_clips';
const BACKEND_KEY = 'goldenHour_backend';
const COMFYUI_CONFIG_KEY = 'goldenHour_comfyuiConfig';
const COMFYUI_STEPS_KEY = 'goldenHour_comfyuiSteps';
const COMFYUI_SAMPLER_KEY = 'goldenHour_comfyuiSampler';
const COMFYUI_LORA_KEY = 'goldenHour_comfyuiLora';
const COMFYUI_LORA_STRENGTH_KEY = 'goldenHour_comfyuiLoraStrength';
const COMFYUI_CFG_KEY = 'goldenHour_comfyuiCfg';
const COMFYUI_DIFFUSION_MODEL_KEY = 'goldenHour_comfyuiDiffusionModel';
const COMFYUI_CLIP_MODEL_KEY = 'goldenHour_comfyuiClipModel';
const COMFYUI_VAE_KEY = 'goldenHour_comfyuiVae';
const COMFYUI_SEED_MODE_KEY = 'goldenHour_comfyuiSeedMode';
const COMFYUI_SEED_KEY = 'goldenHour_comfyuiSeed';
const COMFYUI_MODEL_PROFILE_OVERRIDES_KEY = 'goldenHour_comfyModelProfileOverrides';
const REMIX_RESTORE_KEY = 'goldenHour_remixRestore';

function getItem(key: string): string | null {
  return localStorage.getItem(key) ?? localStorage.getItem(key.replace('goldenHour_', 'nanoBanana_'));
}

// ─── API Key ─────────────────────────────────────────────────────────────────

/** The key in effect: the user's own if they entered one, else the preset. */
export function getApiKey(): string {
  return getStoredApiKey() || PRESET_GEMINI_API_KEY;
}

/** Only the key the user entered, excluding any preset from `.env`. */
export function getStoredApiKey(): string {
  return getItem(API_KEY_KEY) || '';
}

export function hasPresetApiKey(): boolean {
  return !!PRESET_GEMINI_API_KEY;
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_KEY, key);
}

// ─── Backend ─────────────────────────────────────────────────────────────────

export function getBackend(): BackendType {
  const stored = getItem(BACKEND_KEY) as BackendType | null;
  if (stored) return stored;
  // With only ComfyUI preconfigured, start guests on the backend that works.
  return HAS_PRESET_COMFYUI && !PRESET_GEMINI_API_KEY ? 'comfyui' : 'gemini';
}

export function setBackend(value: BackendType): void {
  localStorage.setItem(BACKEND_KEY, value);
}

export function getComfyUIConfig(): ComfyUIConfig {
  const stored = getItem(COMFYUI_CONFIG_KEY);
  if (stored) {
    try {
      return { ...DEFAULT_COMFYUI_CONFIG, ...JSON.parse(stored) };
    } catch {
      return { ...DEFAULT_COMFYUI_CONFIG };
    }
  }
  return { ...DEFAULT_COMFYUI_CONFIG };
}

export function setComfyUIConfig(config: ComfyUIConfig): void {
  localStorage.setItem(COMFYUI_CONFIG_KEY, JSON.stringify(config));
}

// ─── ComfyUI Generation Settings ──────────────────────────────────────────────

export function getComfySteps(): number {
  const stored = getItem(COMFYUI_STEPS_KEY);
  return stored ? parseInt(stored, 10) : DEFAULT_COMFY_STEPS;
}

export function setComfySteps(value: number): void {
  localStorage.setItem(COMFYUI_STEPS_KEY, value.toString());
}

export function getComfySampler(): ComfyUISampler {
  return (getItem(COMFYUI_SAMPLER_KEY) as ComfyUISampler) || DEFAULT_COMFY_SAMPLER;
}

export function setComfySampler(value: ComfyUISampler): void {
  localStorage.setItem(COMFYUI_SAMPLER_KEY, value);
}

// ─── Per-model-family sampler overrides ───────────────────────────────────────
// Seeded from ModelProfile.defaultSteps/defaultCfg/defaultSampler/
// defaultClipModel the first time a family is selected, then kept in sync
// with whatever the user edits while that family is active -- so switching
// back to it later restores the user's last values instead of re-applying
// the family defaults.

export interface ComfyModelProfileOverride {
  steps?: number;
  cfg?: number;
  sampler?: ComfyUISampler;
  clipModel?: string;
}

export function getComfyModelProfileOverrides(): Record<string, ComfyModelProfileOverride> {
  const stored = getItem(COMFYUI_MODEL_PROFILE_OVERRIDES_KEY);
  if (!stored) return {};
  try {
    return JSON.parse(stored);
  } catch {
    return {};
  }
}

export function setComfyModelProfileOverride(profileId: string, override: ComfyModelProfileOverride): void {
  const all = getComfyModelProfileOverrides();
  all[profileId] = { ...all[profileId], ...override };
  localStorage.setItem(COMFYUI_MODEL_PROFILE_OVERRIDES_KEY, JSON.stringify(all));
}

export function getComfyLora(): string {
  return getItem(COMFYUI_LORA_KEY) || DEFAULT_COMFY_LORA;
}

export function setComfyLora(value: string): void {
  localStorage.setItem(COMFYUI_LORA_KEY, value);
}

export function getComfyLoraStrength(): number {
  const stored = getItem(COMFYUI_LORA_STRENGTH_KEY);
  return stored ? parseFloat(stored) : DEFAULT_COMFY_LORA_STRENGTH;
}

export function setComfyLoraStrength(value: number): void {
  localStorage.setItem(COMFYUI_LORA_STRENGTH_KEY, value.toString());
}

export function getComfyCfg(): number {
  const stored = getItem(COMFYUI_CFG_KEY);
  return stored ? parseFloat(stored) : DEFAULT_COMFY_CFG;
}

export function setComfyCfg(value: number): void {
  localStorage.setItem(COMFYUI_CFG_KEY, value.toString());
}

export function getComfyDiffusionModel(): string {
  return getItem(COMFYUI_DIFFUSION_MODEL_KEY) || DEFAULT_COMFY_DIFFUSION_MODEL;
}

export function setComfyDiffusionModel(value: string): void {
  localStorage.setItem(COMFYUI_DIFFUSION_MODEL_KEY, value);
}

export function getComfyClipModel(): string {
  return getItem(COMFYUI_CLIP_MODEL_KEY) || DEFAULT_COMFY_CLIP_MODEL;
}

export function setComfyClipModel(value: string): void {
  localStorage.setItem(COMFYUI_CLIP_MODEL_KEY, value);
}

export function getComfyVae(): string {
  return getItem(COMFYUI_VAE_KEY) || DEFAULT_COMFY_VAE;
}

export function setComfyVae(value: string): void {
  localStorage.setItem(COMFYUI_VAE_KEY, value);
}

export function clampSeed(seed: number): number {
  if (!Number.isFinite(seed) || seed < 0) return 0;
  return Math.min(Math.floor(seed), Number.MAX_SAFE_INTEGER);
}

export function getComfySeedMode(): 'random' | 'fixed' {
  const stored = getItem(COMFYUI_SEED_MODE_KEY);
  return stored === 'fixed' ? 'fixed' : DEFAULT_COMFY_SEED_MODE;
}

export function setComfySeedMode(value: 'random' | 'fixed'): void {
  localStorage.setItem(COMFYUI_SEED_MODE_KEY, value);
}

export function getComfySeed(): number {
  const stored = getItem(COMFYUI_SEED_KEY);
  if (stored === null) return DEFAULT_COMFY_SEED;
  return clampSeed(Number(stored));
}

export function setComfySeed(value: number): void {
  localStorage.setItem(COMFYUI_SEED_KEY, clampSeed(value).toString());
}

// ─── Remix Restore Mask ──────────────────────────────────────────────────────

/**
 * Which settings the drawer's Remix restores. One global preference, not a
 * per-record one: unticking a row sticks across records and across launches.
 *
 * Read key by key over the all-true default rather than spread wholesale, so a
 * stored blob written by an older build cannot suppress a row added later, and
 * a hand-edited non-boolean cannot land in the mask.
 */
export function getRemixRestore(): RemixRestoreMask {
  const stored = getItem(REMIX_RESTORE_KEY);
  if (!stored) return { ...DEFAULT_REMIX_RESTORE };
  try {
    const parsed = JSON.parse(stored) as Partial<Record<string, unknown>>;
    const merged = { ...DEFAULT_REMIX_RESTORE };
    for (const { key } of REMIX_RESTORE_OPTIONS) {
      if (typeof parsed[key] === 'boolean') merged[key] = parsed[key] as boolean;
    }
    return merged;
  } catch {
    return { ...DEFAULT_REMIX_RESTORE };
  }
}

export function setRemixRestore(mask: RemixRestoreMask): void {
  localStorage.setItem(REMIX_RESTORE_KEY, JSON.stringify(mask));
}

// ─── Resolution & Aspect Ratio Persistence ───────────────────────────────────

export function getResolution(): Resolution {
  return (getItem(RESOLUTION_KEY) as Resolution) || DEFAULT_RESOLUTION;
}

export function setResolution(value: Resolution): void {
  localStorage.setItem(RESOLUTION_KEY, value);
}

export function getAspectRatio(): AspectRatio {
  return (getItem(ASPECT_RATIO_KEY) as AspectRatio) || DEFAULT_ASPECT_RATIO;
}

export function setAspectRatio(value: AspectRatio): void {
  localStorage.setItem(ASPECT_RATIO_KEY, value);
}

// ─── Auto-Upscale Persistence ────────────────────────────────────────────────

const AUTO_UPSCALE_KEY = 'goldenHour_autoUpscale';

export function getAutoUpscale(): boolean {
  const stored = getItem(AUTO_UPSCALE_KEY);
  return stored === null ? DEFAULT_AUTO_UPSCALE : stored === 'true';
}


export function setAutoUpscale(value: boolean): void {
  localStorage.setItem(AUTO_UPSCALE_KEY, value.toString());
}

// ─── Templates ───────────────────────────────────────────────────────────────

export function getTemplates(): PromptTemplate[] {
  const stored = getItem(TEMPLATES_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return [...DEFAULT_TEMPLATES];
    }
  }
  return [...DEFAULT_TEMPLATES];
}

export function saveTemplates(templates: PromptTemplate[]): void {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
}

export function addTemplate(name: string, prompt: string): PromptTemplate[] {
  const templates = getTemplates();
  const newTemplate: PromptTemplate = {
    id: `tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    prompt,
  };
  templates.unshift(newTemplate);
  saveTemplates(templates);
  return templates;
}

export function deleteTemplate(id: string): PromptTemplate[] {
  const templates = getTemplates().filter((t) => t.id !== id);
  saveTemplates(templates);
  return templates;
}

// ─── Clips ───────────────────────────────────────────────────────────────────

function deepCloneClips(clips: Record<ClipCategory, Clip[]>): Record<ClipCategory, Clip[]> {
  const result = {} as Record<ClipCategory, Clip[]>;
  for (const key of Object.keys(clips) as ClipCategory[]) {
    result[key] = clips[key].map((c) => ({ ...c }));
  }
  return result;
}

export function getClips(): Record<ClipCategory, Clip[]> {
  const stored = getItem(CLIPS_KEY);
  const defaults = deepCloneClips(DEFAULT_CLIPS);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      let didBackfill = false;
      // Backfill missing or empty categories from defaults
      for (const key of Object.keys(defaults) as ClipCategory[]) {
        if (!parsed[key] || !Array.isArray(parsed[key]) || parsed[key].length === 0) {
          parsed[key] = defaults[key];
          didBackfill = true;
        }
      }
      if (didBackfill) {
        saveClips(parsed);
      }
      return parsed;
    } catch {
      saveClips(defaults);
      return defaults;
    }
  }
  saveClips(defaults);
  return defaults;
}

export function saveClips(clips: Record<ClipCategory, Clip[]>): void {
  localStorage.setItem(CLIPS_KEY, JSON.stringify(clips));
}

export function addClip(category: ClipCategory, label: string, modifier: string): Record<ClipCategory, Clip[]> {
  const clips = getClips();
  const newClip: Clip = {
    id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label,
    modifier,
  };
  clips[category].push(newClip);
  saveClips(clips);
  return clips;
}

export function removeClip(category: ClipCategory, clipId: string): Record<ClipCategory, Clip[]> {
  const clips = getClips();
  clips[category] = clips[category].filter((c) => c.id !== clipId);
  saveClips(clips);
  return clips;
}

// ─── Export / Import ─────────────────────────────────────────────────────────

export interface AppExportData {
  version: 1;
  apiKey: string;
  templates: PromptTemplate[];
  resolution?: Resolution;
  aspectRatio?: AspectRatio;
  autoUpscale?: boolean;
  clips?: Record<ClipCategory, Clip[]>;
  backend?: BackendType;
  comfyuiConfig?: ComfyUIConfig;
  comfySteps?: number;
  comfySampler?: import('../types').ComfyUISampler;
  comfyLora?: string;
  comfyLoraStrength?: number;
  comfyCfg?: number;
  comfyDiffusionModel?: string;
  comfyClipModel?: string;
  comfyVae?: string;
  comfySeedMode?: 'random' | 'fixed';
  comfySeed?: number;
}

export function exportSettings(): AppExportData {
  return {
    version: 1,
    apiKey: getStoredApiKey(),
    templates: getTemplates(),
    resolution: getResolution(),
    aspectRatio: getAspectRatio(),
    autoUpscale: getAutoUpscale(),
    clips: getClips(),
    backend: getBackend(),
    comfyuiConfig: getComfyUIConfig(),
    comfySteps: getComfySteps(),
    comfySampler: getComfySampler(),
    comfyLora: getComfyLora(),
    comfyLoraStrength: getComfyLoraStrength(),
    comfyCfg: getComfyCfg(),
    comfyDiffusionModel: getComfyDiffusionModel(),
    comfyClipModel: getComfyClipModel(),
    comfyVae: getComfyVae(),
    comfySeedMode: getComfySeedMode(),
    comfySeed: getComfySeed(),
  };
}

export function importSettings(data: AppExportData): void {
  if (data.version !== 1) throw new Error('Unsupported export version');
  if (data.apiKey !== undefined) setApiKey(data.apiKey);
  if (data.templates) saveTemplates(data.templates);
  if (data.resolution) setResolution(data.resolution);
  if (data.aspectRatio) setAspectRatio(data.aspectRatio);
  if (data.autoUpscale !== undefined) setAutoUpscale(data.autoUpscale);
  if (data.clips) saveClips(data.clips);
  if (data.backend) setBackend(data.backend);
  if (data.comfyuiConfig) setComfyUIConfig(data.comfyuiConfig);
  if (data.comfySteps !== undefined) setComfySteps(data.comfySteps);
  if (data.comfySampler) setComfySampler(data.comfySampler);
  if (data.comfyLora !== undefined) setComfyLora(data.comfyLora);
  if (data.comfyLoraStrength !== undefined) setComfyLoraStrength(data.comfyLoraStrength);
  if (data.comfyCfg !== undefined) setComfyCfg(data.comfyCfg);
  if (data.comfyDiffusionModel !== undefined) setComfyDiffusionModel(data.comfyDiffusionModel);
  if (data.comfyClipModel !== undefined) setComfyClipModel(data.comfyClipModel);
  if (data.comfyVae !== undefined) setComfyVae(data.comfyVae);
  if (data.comfySeedMode !== undefined) setComfySeedMode(data.comfySeedMode);
  if (data.comfySeed !== undefined) setComfySeed(data.comfySeed);
}
