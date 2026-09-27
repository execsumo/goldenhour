import { useEffect, useState } from 'react';

/**
 * Own exactly one object URL for a Blob, for as long as it is rendered.
 *
 * Creation and revocation both happen inside the effect, so they are provably
 * paired. The obvious alternative — `useMemo(() => URL.createObjectURL(blob))`
 * with a separate cleanup effect — has a real hole: React may discard a memo
 * result and recompute without the paired effect ever running, leaking the URL
 * it threw away. Leaked object URLs pin their Blobs for the life of the
 * document, which is the same failure class the base64→Blob work exists to
 * eliminate.
 *
 * Returns `null` on the first render after a blob change. Render the `<img>`
 * only when it is non-null — never `src={url ?? ''}`, which fires a load error.
 *
 * There is deliberately no array variant. An array prop's identity changes every
 * render, so a `useObjectUrls(blobs[])` would need internal per-element diffing,
 * and that bookkeeping is exactly what goes wrong. Render one component per
 * image and call this once inside it.
 */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [blob]);

  return url;
}
