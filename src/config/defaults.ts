import { ComfyUIConfig, Resolution, AspectRatio, ComfyUISampler } from '../types';
import { DEFAULT_COMFYUI_HOST, DEFAULT_COMFYUI_PORT } from './endpoints';

export const DEFAULT_COMFYUI_CONFIG: ComfyUIConfig = {
  host: DEFAULT_COMFYUI_HOST,
  port: DEFAULT_COMFYUI_PORT,
  workflowJson: null,
  workflowFileName: null,
  rtxUpscale: false,
  rtxUpscaleScale: 2,
};

export const DEFAULT_COMFY_STEPS = 8;
export const DEFAULT_COMFY_SAMPLER: ComfyUISampler = 'res_multistep|simple';
export const DEFAULT_COMFY_LORA = 'none';
export const DEFAULT_COMFY_LORA_STRENGTH = 1.0;
export const DEFAULT_COMFY_CFG = 1.0;
export const DEFAULT_COMFY_DIFFUSION_MODEL = 'none';
export const DEFAULT_COMFY_CLIP_MODEL = 'none';
export const DEFAULT_COMFY_VAE = 'auto';
export const DEFAULT_COMFY_SEED_MODE: 'random' | 'fixed' = 'random';
export const DEFAULT_COMFY_SEED = 0;

export const DEFAULT_RESOLUTION: Resolution = '512';
export const DEFAULT_ASPECT_RATIO: AspectRatio = '9:16';
export const DEFAULT_AUTO_UPSCALE = false;

export const COST_PER_IMAGE: Record<Resolution, { tokens: number; cost: number }> = {
  '512': { tokens: 747, cost: 0.045 },
  '1k':  { tokens: 1120, cost: 0.067 },
  '2k':  { tokens: 1680, cost: 0.101 },
  '4k':  { tokens: 2520, cost: 0.151 },
};

export const BATCH_COST_CONFIRM_THRESHOLD = 1.0;
