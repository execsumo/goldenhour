/**
 * API Endpoints & Model Configurations
 * 
 * Values can be customized via environment variables in `.env` (prefixed with `VITE_`).
 * If environment variables are omitted, standard default endpoints and models are used.
 */

export const API_BASE_URL: string =
  (import.meta as any).env?.VITE_GEMINI_API_BASE_URL ||
  'https://generativelanguage.googleapis.com/v1beta';

export const IMAGE_MODEL: string =
  (import.meta as any).env?.VITE_GEMINI_IMAGE_MODEL ||
  'gemini-3.1-flash-image-preview';

export const TEXT_MODEL: string =
  (import.meta as any).env?.VITE_GEMINI_TEXT_MODEL ||
  'gemini-3-flash-preview';

export const DEFAULT_COMFYUI_HOST: string =
  (import.meta as any).env?.VITE_COMFYUI_HOST ||
  '127.0.0.1';

export const DEFAULT_COMFYUI_PORT: number =
  Number((import.meta as any).env?.VITE_COMFYUI_PORT) || 8188;

/**
 * Operator-supplied presets. When set, guests can generate without entering
 * anything in Settings; a value they do enter still takes precedence.
 *
 * NOTE: VITE_* values are compiled into the client bundle, so a preset Gemini
 * key is readable by anyone who can load the app.
 */
export const PRESET_GEMINI_API_KEY: string =
  (import.meta as any).env?.VITE_GEMINI_API_KEY || '';

export const HAS_PRESET_COMFYUI: boolean =
  !!(import.meta as any).env?.VITE_COMFYUI_HOST;
