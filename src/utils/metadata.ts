import { GenerationSettings, HistorySettings, IMAGE_MODEL, settingsHaveReference } from '../types';
import { blobToDataUrl } from './blob';
import { renderToBlob } from './image';

/**
 * Embeds metadata into a PNG file as tEXt chunks.
 * PNG text chunks are the standard way to store key-value metadata in PNG files.
 * 
 * PNG structure: 
 *   - 8-byte signature
 *   - Chunks: [4-byte length][4-byte type][data][4-byte CRC]
 *   - We insert tEXt chunks before the IEND chunk
 */

/** Built once. This used to be rebuilt inside crc32 on all 7-9 calls per download. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;

  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }

  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createTextChunk(keyword: string, value: string): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keywordBytes = encoder.encode(keyword);
  const nullByte = new Uint8Array([0]); // separator
  const valueBytes = encoder.encode(value);
  
  const chunkData = new Uint8Array(keywordBytes.length + 1 + valueBytes.length);
  chunkData.set(keywordBytes, 0);
  chunkData.set(nullByte, keywordBytes.length);
  chunkData.set(valueBytes, keywordBytes.length + 1);
  
  const chunkType = encoder.encode('tEXt');
  
  // Calculate CRC over type + data
  const crcInput = new Uint8Array(4 + chunkData.length);
  crcInput.set(chunkType, 0);
  crcInput.set(chunkData, 4);
  const crcValue = crc32(crcInput);
  
  // Build full chunk: length(4) + type(4) + data + crc(4)
  const fullChunk = new Uint8Array(4 + 4 + chunkData.length + 4);
  const view = new DataView(fullChunk.buffer);
  
  view.setUint32(0, chunkData.length, false); // big-endian length
  fullChunk.set(chunkType, 4);
  fullChunk.set(chunkData, 8);
  view.setUint32(8 + chunkData.length, crcValue, false); // big-endian CRC
  
  return fullChunk;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Byte offset of the IEND chunk, or -1 if this is not a PNG we understand. */
function findIendPos(pngData: Uint8Array): number {
  for (let i = 0; i < 8; i++) {
    if (pngData[i] !== PNG_SIGNATURE[i]) {
      console.warn('Not a valid PNG file, returning as-is');
      return -1;
    }
  }

  let pos = 8; // skip signature
  while (pos < pngData.length) {
    const view = new DataView(pngData.buffer, pngData.byteOffset + pos);
    const length = view.getUint32(0, false);
    const typeBytes = pngData.subarray(pos + 4, pos + 8);
    const type = String.fromCharCode(...typeBytes);

    if (type === 'IEND') return pos;

    pos += 12 + length; // 4 length + 4 type + data + 4 crc
  }

  console.warn('Could not find IEND chunk, returning as-is');
  return -1;
}

function buildMetadataChunks(
  settings: GenerationSettings | HistorySettings,
  timestamp: string
): Uint8Array<ArrayBuffer>[] {
  const chunks: Uint8Array<ArrayBuffer>[] = [
    createTextChunk('prompt', settings.prompt),
    createTextChunk('model', IMAGE_MODEL),
    createTextChunk('resolution', settings.resolution),
    createTextChunk('aspect_ratio', settings.aspectRatio),
    createTextChunk('reference_image_used', settingsHaveReference(settings) ? 'true' : 'false'),
    createTextChunk('timestamp', timestamp),
    createTextChunk('app', 'Golden Hour Image Generator'),
  ];

  if (settings.backend === 'comfyui') {
    if (settings.comfySteps !== undefined) {
      chunks.push(createTextChunk('comfy_steps', settings.comfySteps.toString()));
    }
    if (settings.comfySampler) {
      chunks.push(createTextChunk('comfy_sampler', settings.comfySampler));
    }
  }

  if (settings.seed !== undefined) {
    chunks.push(createTextChunk('seed', settings.seed.toString()));
  }

  return chunks;
}

/**
 * Insert the tEXt chunks and return a new PNG Blob.
 *
 * Assembles the output from `subarray` views, which are windows onto the source
 * rather than copies, so the only full-size copy is the one the Blob constructor
 * makes into the blob store — off the JS heap. The Uint8Array version this
 * replaces made three.
 */
export async function embedMetadataInPngBlob(
  blob: Blob,
  settings: GenerationSettings | HistorySettings,
  timestamp: string
): Promise<Blob> {
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(await blob.arrayBuffer());
  const iendPos = findIendPos(bytes);
  if (iendPos === -1) return blob;

  return new Blob(
    [bytes.subarray(0, iendPos), ...buildMetadataChunks(settings, timestamp), bytes.subarray(iendPos)],
    { type: 'image/png' }
  );
}

// ─── Thumbnails ──────────────────────────────────────────────────────────────

/** Decode, downscale to `maxSize` on the longest side, encode. Never upscales. */
async function encodeThumbnail(
  blob: Blob,
  maxSize: number,
  type: string,
  quality: number
): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(maxSize / bitmap.width, maxSize / bitmap.height, 1);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    if (type !== 'image/webp') return await renderToBlob(bitmap, w, h, type, quality);

    const webp = await renderToBlob(bitmap, w, h, 'image/webp', quality);
    // A browser without WebP encode silently hands back PNG, which is far larger
    // than the JPEG this replaces. Checking the result's type is the only
    // reliable probe.
    if (webp.type === 'image/webp') return webp;
    return await renderToBlob(bitmap, w, h, 'image/jpeg', 0.85);
  } finally {
    bitmap.close();
  }
}

/**
 * Thumbnail for a history row, as a full `data:` URL.
 *
 * These stay inline in the metadata record rather than becoming Blobs: object
 * URLs across a live 100-row list would need per-row revoke bookkeeping, and a
 * leaked one pins its Blob for the life of the document. At 256px WebP that is
 * roughly 20-30 KB a row, so the whole list still costs a few megabytes of state.
 *
 * Returning the full data URL (prefix included) keeps the format an
 * implementation detail — callers no longer hardcode the MIME type.
 */
export async function createThumbnailDataUrl(
  blob: Blob,
  maxSize: number = 256
): Promise<string> {
  return blobToDataUrl(await encodeThumbnail(blob, maxSize, 'image/webp', 0.85));
}

