import { ComfyUISampler } from '../types';

/**
 * User-editable model-family defaults for the built-in single-CLIP workflow.
 * Families that need DualCLIPLoader (such as Flux) are outside its scope.
 *
 * defaultSteps/defaultCfg/defaultSampler/defaultClipModel seed those settings
 * the first time a model from this family is selected; after that, whatever
 * the user last set for the family persists (see comfyModelProfileOverrides
 * in utils/settings.ts) and these are no longer consulted for it.
 *
 * defaultClipModel is a *suggestion*, unlike vae (which is always applied):
 * families are usually built around one text-encoder architecture, but
 * multiple quantizations of it (fp8/int8/bf16, different parameter counts)
 * are commonly installed side by side for a VRAM/quality tradeoff, so this
 * only applies when the exact filename is present -- otherwise the CLIP
 * Model dropdown is left for the user to pick from what's installed.
 */
export interface ModelProfile {
  id: string;
  label: string;
  match: RegExp;
  vae: string;
  clipType?: string;
  defaultSteps?: number;
  defaultCfg?: number;
  defaultSampler?: ComfyUISampler;
  defaultClipModel?: string;
}

export const MODEL_PROFILES: ModelProfile[] = [
  {
    id: 'z-image',
    label: 'Z-Image',
    match: /z[-_]?image/i,
    vae: 'ae.safetensors',
    clipType: 'lumina2',
    defaultSteps: 8,
    defaultCfg: 1,
    defaultSampler: 'res_multistep|simple',
    defaultClipModel: 'qwen_3_4b.safetensors',
  },
  {
    id: 'qwen-image-2.1',
    label: 'Qwen-Image 2.1',
    match: /qwen[-_]?image[-_]?2\.1/i,
    vae: 'qwen_image_2.1_vae_bf16.safetensors',
    clipType: 'qwen_image',
    defaultSteps: 25,
    defaultCfg: 1,
    defaultSampler: 'euler|simple',
    defaultClipModel: 'qwen3vl_8b_int8_convrot.safetensors',
  },
  {
    id: 'krea2',
    label: 'Krea 2',
    match: /krea[-_]?2/i,
    vae: 'qwen_image_vae.safetensors',
    clipType: 'krea2',
    defaultSteps: 8,
    defaultCfg: 1,
    defaultSampler: 'euler|simple',
    defaultClipModel: 'qwen3vl_4b_fp8_scaled.safetensors',
  },
  {
    id: 'anima',
    label: 'Anima',
    match: /anima/i,
    vae: 'qwen_image_vae.safetensors',
    clipType: 'stable_diffusion',
    defaultSteps: 30,
    defaultCfg: 4,
    defaultSampler: 'er_sde|simple',
    defaultClipModel: 'qwen_3_06b_base.safetensors',
  },
  // Example for another family once its loader names are confirmed:
  // { id: 'qwen-image', label: 'Qwen-Image', match: /qwen[-_]?image/i,
  //   vae: 'qwen_image_vae.safetensors', clipType: 'qwen_image' },
];

export function resolveModelProfile(unetName: string | null | undefined): ModelProfile | undefined {
  if (!unetName) return undefined;
  return MODEL_PROFILES.find((profile) => profile.match.test(unetName));
}
