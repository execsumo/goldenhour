import { GenerationSettings, Resolution } from '../types';
import { IMAGE_MODEL, TEXT_MODEL, API_BASE_URL } from '../config';
import { base64ToBlob, blobToBase64 } from './blob';
import { retryDelayMs } from './batch';

// ─── Image Generation ────────────────────────────────────────────────────────

interface GeminiImageResponse {
  promptFeedback?: {
    blockReason?: string;
    blockReasonMessage?: string;
  };
  candidates?: {
    finishReason?: string;
    content?: {
      parts?: {
        inlineData?: {
          mimeType: string;
          data: string;
        };
        text?: string;
      }[];
    };
  }[];
  error?: {
    message: string;
    code: number;
  };
}

function getNoImageError(data: GeminiImageResponse): Error {
  const blockReason = data.promptFeedback?.blockReason;
  if (blockReason) {
    const detail = data.promptFeedback?.blockReasonMessage;
    return new Error(`Blocked by Gemini safety filter (${blockReason})${detail ? `: ${detail}` : ''}`);
  }

  const finishReason = data.candidates
    ?.map((candidate) => candidate.finishReason)
    .find((reason) => reason && ['SAFETY', 'PROHIBITED_CONTENT', 'IMAGE_SAFETY'].includes(reason));
  if (finishReason) {
    return new Error(`Blocked by Gemini safety filter (${finishReason})`);
  }

  const text = data.candidates
    ?.flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text?.trim())
    .find(Boolean);
  if (text) return new Error(`Gemini returned no image: ${text}`);

  return new Error('No image was generated in one of the batch requests.');
}

const GEMINI_REQUEST_TIMEOUT_MS = 180_000;

function createGeminiRequestSignal(userSignal?: AbortSignal): {
  signal?: AbortSignal;
  isTimeout: () => boolean;
  cleanup: () => void;
} {
  if (typeof AbortSignal.timeout === 'function') {
    const timeoutSignal = AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS);
    if (!userSignal) {
      return {
        signal: timeoutSignal,
        isTimeout: () => timeoutSignal.aborted,
        cleanup: () => {},
      };
    }
    if (typeof AbortSignal.any === 'function') {
      const signal = AbortSignal.any([userSignal, timeoutSignal]);
      return {
        signal,
        isTimeout: () => timeoutSignal.aborted,
        cleanup: () => {},
      };
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException('Gemini request timed out', 'TimeoutError'));
  }, GEMINI_REQUEST_TIMEOUT_MS);
  const onUserAbort = () => controller.abort(userSignal?.reason || new DOMException('Generation cancelled', 'AbortError'));
  if (userSignal?.aborted) onUserAbort();
  else userSignal?.addEventListener('abort', onUserAbort, { once: true });

  return {
    signal: controller.signal,
    isTimeout: () => controller.signal.reason?.name === 'TimeoutError',
    cleanup: () => {
      clearTimeout(timeoutId);
      userSignal?.removeEventListener('abort', onUserAbort);
    },
  };
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new DOMException('Generation cancelled', 'AbortError');
}

function abortableDelay(delay: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, delay));
  if (signal.aborted) return Promise.reject(abortError(signal));

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    const onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// Map internal resolution labels to the API's expected uppercase format
function buildImageSize(resolution: Resolution): string {
  const map: Record<Resolution, string> = {
    '512': '512px',
    '1k': '1K',
    '2k': '2K',
    '4k': '4K',
  };
  return map[resolution];
}

export async function geminiGenerateImage(
  apiKey: string,
  settings: GenerationSettings,
  userSignal?: AbortSignal
): Promise<{ images: Blob[]; failures?: string[] }> {
  const url = `${API_BASE_URL}/models/${IMAGE_MODEL}:generateContent`;

  // Build parts array
  const parts: any[] = [];

  // Add reference image if provided. Gemini is base64 on the wire in both
  // directions, so this encode is unavoidable -- but it happens once here rather
  // than once per parallel request below, and FileReader does it off-thread.
  if (settings.referenceImage) {
    parts.push({
      inlineData: {
        mimeType: settings.referenceImage.type || 'image/png',
        data: await blobToBase64(settings.referenceImage),
      },
    });
  }

  // Add prompt text
  parts.push({ text: settings.prompt });

  const requestBody: any = {
    contents: [
      {
        parts,
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: settings.aspectRatio,
        imageSize: buildImageSize(settings.resolution),
        // numberOfImages is not universally supported by this endpoint in this way,
        // so we will handle batching via parallel requests below.
      },
    },
  };

  const numToGen = settings.numberOfImages || 1;

  const requests = Array.from({ length: numToGen }).map(async () => {
    const requestControl = createGeminiRequestSignal(userSignal);
    const signal = requestControl.signal;
    let attempt = 0;
    try {
      while (true) {
        let response: Response;
        try {
          response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(requestBody),
            signal,
          });
        } catch (err) {
          if (signal?.aborted) {
            if (requestControl.isTimeout()) throw new Error('Gemini request timed out after 180 seconds');
            throw abortError(signal);
          }
          if (attempt < 3 && err instanceof TypeError) {
            await abortableDelay(retryDelayMs(attempt, null), signal);
            attempt++;
            continue;
          }
          throw err;
        }

        if (!response.ok) {
          if (attempt < 3 && (response.status === 429 || response.status === 503)) {
            const delay = retryDelayMs(attempt, response.headers.get('Retry-After'));
            await abortableDelay(delay, signal);
            attempt++;
            continue;
          }
          const errorData = await response.json().catch(() => null);
          const errMsg = errorData?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
          throw new Error(errMsg);
        }

        const data: GeminiImageResponse = await response.json();

        if (data.error) {
          throw new Error(data.error.message);
        }

        let imageBase64 = null;
        let mimeType = 'image/png';

        const candidates = data.candidates || [];
        for (const candidate of candidates) {
          const parts = candidate.content?.parts || [];
          for (const part of parts) {
            if (part.inlineData?.data) {
              imageBase64 = part.inlineData.data;
              if (part.inlineData.mimeType) {
                mimeType = part.inlineData.mimeType;
              }
              break;
            }
          }
          if (imageBase64) break;
        }

        if (!imageBase64) throw getNoImageError(data);

        return base64ToBlob(imageBase64, mimeType);
      }
    } catch (err) {
      if (signal?.aborted) {
        if (requestControl.isTimeout()) throw new Error('Gemini request timed out after 180 seconds');
        throw abortError(signal);
      }
      throw err;
    } finally {
      requestControl.cleanup();
    }
  });

  const results = await Promise.allSettled(requests);
  const generatedImages = results
    .filter((result): result is PromiseFulfilledResult<Blob> => result.status === 'fulfilled')
    .map((result) => result.value);
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason?.message || String(result.reason));

  if (generatedImages.length === 0) {
    throw new Error(failures[0] || 'Image generation failed');
  }

  return { images: generatedImages, ...(failures.length > 0 ? { failures } : {}) };
}

// ─── Magic Prompt Enhancement ────────────────────────────────────────────────

export async function enhancePrompt(apiKey: string, prompt: string): Promise<string> {
  const url = `${API_BASE_URL}/models/${TEXT_MODEL}:generateContent`;

  const systemInstruction = `You are an expert image prompt engineer. Your task is to take a brief, simple image description and expand it into a highly detailed, vivid, and visually rich prompt optimized for AI image generation.

Rules:
- Output ONLY the enhanced prompt text, nothing else
- Keep the core subject/concept from the original prompt
- Add details about: lighting, composition, style, mood, colors, textures, camera angle
- Keep it under 200 words
- Make it descriptive and cinematic
- Do not add quotation marks around the output`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 512,
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.error?.message || 'Failed to enhance prompt');
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('No enhanced prompt was generated');
  }

  return text.trim();
}
