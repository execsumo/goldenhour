import { CropState } from '../types';

/**
 * Canvas image operations, Blob in and Blob out.
 *
 * Every operation here used to run `img.src = 'data:...'` and finish with a
 * synchronous `canvas.toDataURL()`. On a 2×-scaled 2K image that last call is a
 * PNG encode of ~15M pixels on the main thread, once per variation. The pairing
 * used now — `createImageBitmap` to decode, `convertToBlob`/`toBlob` to encode —
 * moves both ends off the main thread, so no Web Worker is needed.
 */

/**
 * Draw a decoded bitmap at w×h and encode it.
 *
 * Prefers `OffscreenCanvas.convertToBlob`, which is unambiguously off-thread.
 * The `<canvas>` + `toBlob` fallback is off-thread in Blink but not guaranteed
 * elsewhere, and needs its backing store released explicitly afterwards.
 */
export async function renderToBlob(
  bitmap: ImageBitmap,
  w: number,
  h: number,
  type: string,
  quality?: number
): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to create canvas context');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.convertToBlob({ type, quality });
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to create canvas context');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  try {
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Canvas encode failed'))),
        type,
        quality
      );
    });
  } finally {
    // Drop the backing store rather than waiting for GC.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Scale an image up by `factor` using high-quality interpolation
 * (Lanczos-like in Chrome/Edge).
 */
export async function upscaleImage(blob: Blob, factor: number = 2): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    return await renderToBlob(bitmap, bitmap.width * factor, bitmap.height * factor, 'image/png');
  } finally {
    bitmap.close();
  }
}

/**
 * Crop the reference image to the visible region and downsample it to
 * `maxSize` on the longest side. The crop happens in the decoder, so the
 * discarded region is never rasterised.
 */
export async function cropReferenceImage(
  blob: Blob,
  crop: CropState | null,
  maxSize: number = 512
): Promise<Blob> {
  const source = crop
    ? await createImageBitmap(blob, crop.x, crop.y, crop.width, crop.height)
    : await createImageBitmap(blob);
  try {
    const longestSide = Math.max(source.width, source.height);
    const scale = longestSide > maxSize ? maxSize / longestSide : 1;
    const outW = Math.max(1, Math.round(source.width * scale));
    const outH = Math.max(1, Math.round(source.height * scale));
    return await renderToBlob(source, outW, outH, 'image/png');
  } finally {
    source.close();
  }
}

