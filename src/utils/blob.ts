/**
 * base64 ⇄ Blob conversions, plus Blob download.
 *
 * Images are `Blob`s everywhere in this app; base64 survives only at the Gemini
 * network boundary, which is base64 on the wire in both directions. Every
 * conversion here hands the work to the browser (data-URL fetch, FileReader)
 * rather than looping over bytes on the main thread — the chunked
 * `String.fromCharCode` + `btoa` pattern this replaces cost ~900 iterations and
 * two full-size intermediate strings per image.
 *
 * A leaf module on purpose: storage, comfyui, api and metadata all import it,
 * and putting it in `image.ts` (which is canvas-oriented) would create a cycle.
 */

/** Read a Blob as a full `data:<type>;base64,...` URL. */
function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

/**
 * base64 (no `data:` prefix) → Blob.
 *
 * Rejects on malformed base64, which is what lets the storage migration tell a
 * genuinely unreadable record apart from an environmental failure.
 */
export async function base64ToBlob(base64: string, mimeType = 'image/png'): Promise<Blob> {
  try {
    // The browser's own decoder, off the main thread.
    const res = await fetch(`data:${mimeType};base64,${base64}`);
    return await res.blob();
  } catch {
    // Some engines refuse very large data: URLs. Fall back to the manual decode
    // and let a genuine decode failure propagate.
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  }
}

/** Blob → base64, without the `data:` prefix. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await readAsDataUrl(blob);
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? '' : dataUrl.slice(comma + 1);
}

/** Blob → full `data:` URL. Used for thumbnails, which stay inline by design. */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  return readAsDataUrl(blob);
}

/** Save a Blob to disk via a synthetic anchor click. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoking synchronously can cancel a download the browser has only just
  // started reading. Give it a generous window.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
