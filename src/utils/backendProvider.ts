import { BackendType, BackendFeature, GenerationSettings, ComfyProgress } from '../types';
import { getBackend, getApiKey, getComfyUIConfig } from './settings';
import { geminiGenerateImage } from './api';
import { comfyuiGenerateImage } from './comfyui';

export interface BackendGenerationResult {
  images: Blob[];
  failures?: string[];
  warnings?: string[];
  comfyVae?: string;
  seed?: number;
}

// ─── Feature Support ─────────────────────────────────────────────────────────

/** Features supported by each backend */
const BACKEND_FEATURES: Record<BackendType, Set<BackendFeature>> = {
  gemini: new Set(['clips', 'enhance', 'referenceImage', 'costEstimate', 'resolutionSelect', 'aspectRatioSelect']),
  comfyui: new Set(['clips', 'resolutionSelect', 'aspectRatioSelect', 'comfySettings', 'seed']),
};

/**
 * Check whether the given backend supports a specific feature.
 */
export function backendSupportsFeature(backend: BackendType, feature: BackendFeature): boolean {
  return BACKEND_FEATURES[backend]?.has(feature) ?? false;
}

// ─── Unified Generation Dispatcher ───────────────────────────────────────────

/**
 * Generate images using the currently active backend.
 * This is the single entry point that the rest of the app calls.
 */
export async function generateImageWithBackend(
  settings: GenerationSettings,
  signal?: AbortSignal,
  options?: { onProgress?: (p: ComfyProgress) => void }
): Promise<BackendGenerationResult> {
  const backend = settings.backend || getBackend();

  switch (backend) {
    case 'gemini': {
      const apiKey = getApiKey();
      if (!apiKey) {
        throw new Error('Please set your API key in Settings first');
      }
      return geminiGenerateImage(apiKey, settings, signal);
    }

    case 'comfyui': {
      const config = getComfyUIConfig();
      return comfyuiGenerateImage(config, settings, signal, options);
    }

    default:
      throw new Error(`Unknown backend: ${backend}`);
  }
}
