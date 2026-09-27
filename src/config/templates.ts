import { PromptTemplate } from '../types';

/**
 * Built-In Prompt Templates
 */
export const DEFAULT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'builtin-1',
    name: 'Character Portrait',
    prompt: 'A highly detailed character portrait, soft studio lighting, shallow depth of field, photorealistic quality',
    isBuiltIn: true,
  },
  {
    id: 'builtin-2',
    name: 'Fantasy Landscape',
    prompt: 'A breathtaking fantasy landscape with towering mountains, crystal clear lakes, dramatic sunset, volumetric lighting, matte painting style',
    isBuiltIn: true,
  },
  {
    id: 'builtin-3',
    name: 'Product Shot',
    prompt: 'Professional product photography, clean white background, soft shadows, studio lighting, commercial quality',
    isBuiltIn: true,
  },
];
