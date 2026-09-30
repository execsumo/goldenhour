import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { Download, X, Clock, RotateCcw, ImageIcon, PanelRightOpen, PanelRightClose, ArrowUpFromLine, Loader2, Cloud, Monitor, Cog, Copy, Check } from 'lucide-react';
import { HistoryEntry, COMFYUI_SAMPLER_OPTIONS, REMIX_RESTORE_OPTIONS, RemixRestoreKey, RemixRestoreMask } from '../types';
import { getImageBlob, getUpscaledBlob, getReferenceBlob } from '../utils/storage';
import { getRemixRestore, setRemixRestore } from '../utils/settings';
import { backendSupportsFeature } from '../utils/backendProvider';
import { useObjectUrl } from '../hooks/useObjectUrl';
import JSZip from 'jszip';

interface HistoryDrawerProps {
  open: boolean;
  /** Thumbnails + metadata only. Full-size images are fetched per record. */
  history: HistoryEntry[];
  upscaleScale: number;
  onClose: () => void;
  onReusePrompt: (entry: HistoryEntry) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onUpscaleRecord: (recordId: string) => Promise<void>;
}

// ─── File System Access ──────────────────────────────────────────────────────
// Minimal local typings: the DOM lib in this TS version does not declare them.

interface FileSystemWritableLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableLike>;
}
interface FileSystemDirectoryHandleLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandleLike>;
}
type DirectoryPicker = (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandleLike>;

/** Stream a Blob straight to disk. The bytes never materialise on the JS heap. */
async function writeFileTo(
  dir: FileSystemDirectoryHandleLike,
  name: string,
  blob: Blob
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function getRecordScaleLabel(
  record: { upscaleScale?: number; upscaleMechanism?: string },
  fallbackScale: number = 2
): string {
  if (record.upscaleScale !== undefined) return `${record.upscaleScale}x`;
  const match = record.upscaleMechanism?.match(/(\d+)[×x]/i);
  if (match) return `${match[1]}x`;
  if (record.upscaleMechanism === 'Browser Canvas') return '2x';
  return `${fallbackScale}x`;
}

/** Upscalable if it has no upscaled copy yet and is small enough to be worth it. */
function canUpscaleEntry(entry: HistoryEntry): boolean {
  return !entry.hasUpscaled && ['512', '1k'].includes(entry.settings.resolution);
}

// ─── Row ─────────────────────────────────────────────────────────────────────

interface HistoryRowProps {
  record: HistoryEntry;
  upscaleScale: number;
  confirmDelete: boolean;
  onExpand: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * One thumbnail in the list, memoized.
 *
 * Every `setHistory` allocates a new array, and without this each of them
 * re-rendered every row even when a single entry changed. The memo only
 * holds if the callback props keep a stable identity -- see `handleDelete` and
 * `handleExpand` in the parent, both of which are `useCallback`s that read
 * mutable state through refs rather than closing over it.
 */
const HistoryRow = memo(function HistoryRow({
  record,
  upscaleScale,
  confirmDelete,
  onExpand,
  onDelete,
}: HistoryRowProps) {
  return (
    <div className="group relative">
      <div onClick={() => onExpand(record.id)} className="thumb-card">
        {record.thumbnailDataUrl ? (
          <img src={record.thumbnailDataUrl} alt="Generated" loading="lazy" />
        ) : (
          // A record migrated from a store that had lost its thumbnail.
          <div className="w-full h-full flex items-center justify-center"
               style={{ background: 'var(--bg-image-area)' }}>
            <ImageIcon size={16} strokeWidth={1.2} style={{ color: 'var(--text-muted)' }} />
          </div>
        )}
        {record.hasUpscaled && (
          <span className="badge-2k" style={{ fontSize: '8px', padding: '1px 4px' }}>
            {getRecordScaleLabel(record, upscaleScale)}
          </span>
        )}
        {/* Backend badge */}
        <span className="absolute bottom-1 left-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[8px] font-medium"
              style={{ background: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(4px)' }}>
          {record.backend === 'comfyui' ? <Monitor size={8} /> : <Cloud size={8} />}
          {record.backend === 'comfyui' ? 'Comfy' : 'Gemini'}
        </span>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(record.id);
        }}
        className={`absolute top-1.5 right-1.5 p-1 rounded-md transition-all ${
          confirmDelete ? 'bg-red-500/80 opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        style={!confirmDelete ? { background: 'rgba(0,0,0,0.5)' } : {}}
      >
        <X size={10} className="text-white" />
      </button>
    </div>
  );
});

export default function HistoryDrawer({
  open,
  history,
  upscaleScale,
  onClose,
  onReusePrompt,
  onDelete,
  onClearAll,
  onUpscaleRecord,
}: HistoryDrawerProps) {
  // The row the modal is showing. All of its metadata is already in `history`;
  // only the image payloads are fetched, and only for this one record.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedBlob, setExpandedBlob] = useState<Blob | null>(null);
  const [expandedRefBlob, setExpandedRefBlob] = useState<Blob | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [detailsVisible, setDetailsVisible] = useState(true);
  const [showUpscaled, setShowUpscaled] = useState(true);
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [copiedSeed, setCopiedSeed] = useState(false);

  // Which settings Remix restores. A global preference, not a per-record one:
  // unticking a row here sticks for every later Remix, and across launches.
  const [remixRestore, setRemixRestoreState] = useState<RemixRestoreMask>(() => getRemixRestore());
  const [remixOptionsOpen, setRemixOptionsOpen] = useState(false);

  const toggleRemixRestore = useCallback((key: RemixRestoreKey) => {
    setRemixRestoreState((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      setRemixRestore(next);
      return next;
    });
  }, []);

  const expandedEntry = expandedId ? history.find((r) => r.id === expandedId) ?? null : null;
  const hasUpscaled = !!expandedEntry?.hasUpscaled;
  // Remix always restores the backend, so the record's own backend decides which
  // checklist rows can do anything for it.
  const remixBackend = expandedEntry?.backend ?? expandedEntry?.settings.backend ?? 'gemini';
  const showingUpscaled = showUpscaled && hasUpscaled;

  // The image URLs are owned by hooks, not by these effects. Async code only
  // ever stores the Blob -- creating an object URL inside a callback that the
  // `cancelled` guard can skip would leak it.
  const expandedUrl = useObjectUrl(expandedBlob);
  const expandedRefUrl = useObjectUrl(expandedRefBlob);

  // Fetch just the payload being displayed.
  useEffect(() => {
    setCopiedSeed(false);
    if (!expandedId) {
      setExpandedBlob(null);
      return;
    }
    let cancelled = false;
    setExpandedBlob(null);
    const pending = showingUpscaled ? getUpscaledBlob(expandedId) : getImageBlob(expandedId);
    pending
      .then((blob) => { if (!cancelled) setExpandedBlob(blob); })
      .catch(() => { if (!cancelled) setExpandedBlob(null); });
    // Dropping the stale result matters when arrow keys walk the list faster
    // than IndexedDB returns.
    return () => { cancelled = true; };
  }, [expandedId, showingUpscaled, expandedEntry?.upscaleScale, expandedEntry?.upscaleMechanism]);

  useEffect(() => {
    if (!expandedId || !expandedEntry?.settings.hasReferenceImage) {
      setExpandedRefBlob(null);
      return;
    }
    let cancelled = false;
    getReferenceBlob(expandedId)
      .then((blob) => { if (!cancelled) setExpandedRefBlob(blob); })
      .catch(() => { if (!cancelled) setExpandedRefBlob(null); });
    return () => { cancelled = true; };
  }, [expandedId, expandedEntry?.settings.hasReferenceImage]);

  // Close if the open record is deleted out from under us.
  useEffect(() => {
    if (expandedId && !history.some((r) => r.id === expandedId)) setExpandedId(null);
  }, [history, expandedId]);

  // ─── Keyboard Navigation ────────────────────────────────────────────────

  const navigateHistory = useCallback((direction: 'next' | 'prev') => {
    if (!expandedId || history.length === 0) return;
    const currentIndex = history.findIndex((r) => r.id === expandedId);
    if (currentIndex === -1) return;

    let newIndex: number;
    if (direction === 'next') {
      newIndex = currentIndex - 1;
    } else {
      newIndex = currentIndex + 1;
    }

    if (newIndex >= 0 && newIndex < history.length) {
      setExpandedId(history[newIndex].id);
    }
  }, [expandedId, history]);

  useEffect(() => {
    if (!expandedId) return;

    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          setExpandedId(null);
          break;
        case 'ArrowUp':
        case 'ArrowRight':
          e.preventDefault();
          navigateHistory('next');
          break;
        case 'ArrowDown':
        case 'ArrowLeft':
          e.preventDefault();
          navigateHistory('prev');
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [expandedId, navigateHistory]);

  const handleDownloadAll = useCallback(async () => {
    if (history.length === 0) return;

    // The picker call must happen before the first `await` or the user
    // activation is already spent and it fails silently.
    let dir: FileSystemDirectoryHandleLike | null = null;
    const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
    if (picker) {
      try {
        dir = await picker.call(window, { mode: 'readwrite' });
      } catch {
        return; // cancelled
      }
    }

    setIsExporting(true);
    try {
      if (dir) {
        // One image resident at a time, at any history size. The zip path below
        // cannot do this: JSZip's generateAsync accumulates every chunk, concats
        // it into one Uint8Array and then copies that into a Blob, so its peak is
        // ~3x the archive regardless of what the inputs are.
        for (const entry of history) {
          const ts = entry.timestamp.replace(/[:.]/g, '-');
          const image = await getImageBlob(entry.id);
          if (image) await writeFileTo(dir, `goldenhour_${ts}.png`, image);

          if (entry.hasUpscaled) {
            const upscaled = await getUpscaledBlob(entry.id);
            if (upscaled) {
              const label = getRecordScaleLabel(entry, upscaleScale);
              await writeFileTo(dir, `goldenhour_${ts}_${label}.png`, upscaled);
            }
          }
        }
        return;
      }

      // Fallback for browsers without the File System Access API. Still holds
      // the whole archive in memory, so it can struggle on a large history.
      const zip = new JSZip();
      for (const entry of history) {
        const ts = entry.timestamp.replace(/[:.]/g, '-');
        const image = await getImageBlob(entry.id);
        if (image) zip.file(`goldenhour_${ts}.png`, image);

        if (entry.hasUpscaled) {
          const upscaled = await getUpscaledBlob(entry.id);
          if (upscaled) {
            const label = getRecordScaleLabel(entry, upscaleScale);
            zip.file(`goldenhour_${ts}_${label}.png`, upscaled);
          }
        }
      }
      // PNG is already compressed; deflating again costs time for nothing.
      const content = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `goldenhour_all_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      // Revoking synchronously can cancel a download Chromium has only just
      // started reading.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      console.error('Failed to export history:', e);
    } finally {
      setIsExporting(false);
    }
  }, [history, upscaleScale]);

  // Download-all from the header button. Depends on the memoized handler rather
  // than on `history`, so it stops re-subscribing on every history change.
  useEffect(() => {
    const handler = () => handleDownloadAll();
    window.addEventListener('downloadAllHistory', handler);
    return () => window.removeEventListener('downloadAllHistory', handler);
  }, [handleDownloadAll]);

  // `confirmDeleteId` is mirrored into a ref so `handleDelete` can stay
  // referentially stable -- HistoryRow is memoized and would re-render every row
  // on each keystroke of state otherwise.
  const confirmDeleteIdRef = useRef<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearConfirm = useCallback(() => {
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    confirmDeleteIdRef.current = null;
    setConfirmDeleteId(null);
  }, []);

  // The 3s timer used to outlive the component.
  useEffect(() => () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
  }, []);

  const handleDelete = useCallback((id: string) => {
    if (confirmDeleteIdRef.current === id) {
      clearConfirm();
      onDelete(id);
      return;
    }
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmDeleteIdRef.current = id;
    setConfirmDeleteId(id);
    confirmTimerRef.current = setTimeout(clearConfirm, 3000);
  }, [onDelete, clearConfirm]);

  const handleExpand = useCallback((id: string) => setExpandedId(id), []);

  const handleUpscaleFromDrawer = async () => {
    if (!expandedId) return;
    setIsUpscaling(true);
    try {
      await onUpscaleRecord(expandedId);
    } finally {
      setIsUpscaling(false);
    }
  };

  return (
    <>
      {/* Drawer */}
      <aside
        className={`shrink-0 flex flex-col transition-all duration-300 ease-in-out z-20 overflow-hidden ${
          open ? 'w-56' : 'w-0'
        }`}
        style={{
          background: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border-subtle)',
        }}
      >
        {/* Header */}
        <div className="px-4 py-3.5 flex items-center justify-between shrink-0"
             style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>History</span>
          {history.length > 0 && (
            <button
              onClick={handleDownloadAll}
              disabled={isExporting}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors disabled:opacity-50"
              style={{ color: 'var(--text-secondary)', background: 'var(--icon-btn-hover)' }}
            >
              <Download size={10} />
              {isExporting ? '...' : 'All'}
            </button>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-28 gap-2">
              <ImageIcon size={20} strokeWidth={1.2} style={{ color: 'var(--text-muted)' }} />
              <p className="text-[10px] text-center" style={{ color: 'var(--text-muted)' }}>No images yet</p>
            </div>
          ) : (
            history.map((record) => (
              <HistoryRow
                key={record.id}
                record={record}
                upscaleScale={upscaleScale}
                confirmDelete={confirmDeleteId === record.id}
                onExpand={handleExpand}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      </aside>

      {/* ── Expanded View Modal ────────────────────────────────────── */}
      {/* Fetching the full-size image from IndexedDB. Brief, but not instant on
          a large record, so the overlay opens immediately either way. */}
      {expandedEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3"
          style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' }}
          onClick={() => setExpandedId(null)}
        >
          <div
            className={`glass-modal rounded-2xl flex flex-col lg:flex-row overflow-hidden animate-fade-in transition-all duration-300 ${
              detailsVisible
                ? 'w-full max-w-7xl max-h-[96vh]'
                : (showingUpscaled ? 'w-fit max-w-[90vw] max-h-[98vh]' : 'w-fit max-w-6xl max-h-[96vh]')
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Image */}
            <div className={`lg:flex-1 min-w-0 min-h-0 overflow-hidden flex items-center justify-center relative transition-all duration-300 ${detailsVisible ? 'p-3' : 'p-1.5'}`}
                 style={{ background: 'var(--bg-image-area)' }}>
              {/* All the metadata is already in `history`, so the panel renders
                  instantly and only the image waits on IndexedDB. */}
              {expandedUrl ? (
                <img
                  src={expandedUrl}
                  alt="Generated"
                  className={`max-w-full object-contain transition-all duration-300 ${
                    detailsVisible
                      ? 'max-h-[92vh] rounded-lg'
                      : (showingUpscaled ? 'max-h-[96vh] rounded-xl' : 'max-h-[93vh] rounded-xl')
                  }`}
                />
              ) : (
                <div className="flex items-center justify-center w-full" style={{ minHeight: '50vh' }}>
                  <Loader2 size={28} className="animate-spin" style={{ color: '#d4a017' }} />
                </div>
              )}

              {/* Original / Upscaled toggle */}
              {expandedEntry.hasUpscaled && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                  <div className="upscale-toggle">
                    <button
                      className={`upscale-toggle-btn ${!showUpscaled ? 'active' : ''}`}
                      onClick={() => setShowUpscaled(false)}
                    >
                      Original
                    </button>
                    <button
                      className={`upscale-toggle-btn ${showUpscaled ? 'active' : ''}`}
                      onClick={() => setShowUpscaled(true)}
                    >
                      {getRecordScaleLabel(expandedEntry, upscaleScale)} Upscaled
                    </button>
                  </div>
                </div>
              )}

              {/* Contextual Upscale Button (when details are collapsed) */}
              {!detailsVisible && canUpscaleEntry(expandedEntry) && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                  <div className="upscale-toggle">
                    <button
                      onClick={handleUpscaleFromDrawer}
                      disabled={isUpscaling}
                      className="upscale-toggle-btn active flex items-center justify-center gap-1.5"
                    >
                      {isUpscaling ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <ArrowUpFromLine size={14} />
                      )}
                      <span>{isUpscaling ? 'Upscaling...' : `Upscale ${upscaleScale}x`}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Floating controls */}
              <div className="absolute top-4 right-4 flex items-center gap-1.5">
                <button
                  onClick={() => setDetailsVisible(!detailsVisible)}
                  className="icon-btn"
                  style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)' }}
                  title={detailsVisible ? 'Hide details' : 'Show details'}
                >
                  {detailsVisible ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
                </button>
                <button
                  onClick={() => setExpandedId(null)}
                  className="icon-btn"
                  style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)' }}
                  title="Close"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Collapsible Metadata Panel */}
            <div
              className="overflow-hidden transition-all duration-300 ease-in-out"
              style={{
                width: detailsVisible ? '300px' : '0px',
                minWidth: detailsVisible ? '300px' : '0px',
                borderLeft: detailsVisible ? '1px solid var(--border-subtle)' : 'none',
              }}
            >
              <div className="w-[300px] p-6 space-y-5 overflow-y-auto h-full">
                <div className="flex items-center justify-between">
                  <span className="section-title">Details</span>
                </div>

                <div>
                  <span className="label">Prompt</span>
                  <p className="text-[12px] leading-relaxed p-3 rounded-xl"
                     style={{ color: 'var(--text-primary)', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                    {expandedEntry.settings.prompt}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="label">Resolution</span>
                    <p className="text-[13px]" style={{ color: 'var(--text-primary)' }}>{expandedEntry.settings.resolution}</p>
                  </div>
                  <div>
                    <span className="label">Aspect</span>
                    <p className="text-[13px]" style={{ color: 'var(--text-primary)' }}>{expandedEntry.settings.aspectRatio}</p>
                  </div>
                  <div>
                    <span className="label">Backend</span>
                    <p className="text-[13px]" style={{ color: 'var(--text-primary)' }}>
                      {expandedEntry.backend === 'comfyui' ? 'ComfyUI' : 'Gemini (Cloud)'}
                    </p>
                  </div>
                  <div>
                    <span className="label">Reference</span>
                    <p className="text-[13px]" style={{ color: 'var(--text-primary)' }}>{expandedEntry.settings.hasReferenceImage ? 'Yes' : 'No'}</p>
                  </div>
                  {expandedEntry.backend === 'comfyui' && (
                    <>
                      <div>
                        <span className="label">Steps</span>
                        <p className="text-[13px]" style={{ color: 'var(--text-primary)' }}>{expandedEntry.settings.comfySteps}</p>
                      </div>
                      <div className="col-span-2">
                        <span className="label">Sampler</span>
                        <p className="text-[13px]" style={{ color: 'var(--text-primary)' }}>
                          {COMFYUI_SAMPLER_OPTIONS.find((o) => o.value === expandedEntry.settings.comfySampler)?.label || expandedEntry.settings.comfySampler}
                        </p>
                      </div>
                    </>
                  )}
                  {expandedEntry.hasUpscaled && (
                    <div className="col-span-2">
                      <span className="label">Upscale Method</span>
                      <p className="text-[13px]" style={{ color: 'var(--text-primary)' }}>
                        {expandedEntry.upscaleMechanism || 'Browser Canvas'}
                      </p>
                    </div>
                  )}
                  {expandedEntry.settings.seed !== undefined && (
                    <div className="col-span-2">
                      <span className="label">Seed</span>
                      <div className="flex items-center justify-between p-2 rounded-lg" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                        <span className="text-[12px] font-mono select-all" style={{ color: 'var(--text-primary)' }}>
                          {expandedEntry.settings.seed}
                        </span>
                        <button
                          onClick={() => {
                            if (expandedEntry.settings.seed !== undefined) {
                              navigator.clipboard.writeText(String(expandedEntry.settings.seed));
                              setCopiedSeed(true);
                              setTimeout(() => setCopiedSeed(false), 1500);
                            }
                          }}
                          className="icon-btn !p-1"
                          title="Copy seed"
                        >
                          {copiedSeed ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  <Clock size={11} />
                  {new Date(expandedEntry.timestamp).toLocaleString()}
                </div>

                {expandedRefUrl && (
                  <div>
                    <span className="label">Reference</span>
                    <img
                      src={expandedRefUrl}
                      alt="Reference"
                      className="w-20 h-20 object-cover rounded-xl"
                      style={{ border: '1px solid var(--border-subtle)' }}
                    />
                  </div>
                )}

                {/* Upscale button for records that can be upscaled */}
                {canUpscaleEntry(expandedEntry) && (
                  <button
                    onClick={handleUpscaleFromDrawer}
                    disabled={isUpscaling}
                    className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-[13px]"
                    style={{ background: 'linear-gradient(135deg, var(--accent2-badge-from), var(--accent2-badge-to))', border: 'none' }}
                  >
                    {isUpscaling ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        Upscaling...
                      </>
                    ) : (
                      <>
                        <ArrowUpFromLine size={13} />
                        Quick Upscale ({upscaleScale}x)
                      </>
                    )}
                  </button>
                )}

                {/* Upscaled status badge */}
                {expandedEntry.hasUpscaled && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px]"
                       style={{ background: 'var(--accent2-bg-subtle)', border: '1px solid var(--accent2-border-subtle)', color: 'var(--accent2-text)' }}>
                    <ArrowUpFromLine size={11} />
                    <span>{getRecordScaleLabel(expandedEntry, upscaleScale)} upscaled version available</span>
                  </div>
                )}

                {/* Remix, and the checklist of what it restores.
                    Rendered in flow rather than as an absolute popover: both
                    the details panel and its wrapper clip overflow, so an
                    anchored popover would be cut off at the panel edge. */}
                {remixOptionsOpen && (
                  <div
                    className="p-3 rounded-xl space-y-2"
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}
                  >
                    <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      Prompt and backend are always restored. Unticked settings keep
                      their current values. Applies to every Remix until changed.
                    </p>
                    <div className="space-y-1">
                      {REMIX_RESTORE_OPTIONS.map((opt) => {
                        const relevant = !opt.feature || backendSupportsFeature(remixBackend, opt.feature);
                        return (
                          <label
                            key={opt.key}
                            title={relevant ? undefined : `Not used by ${remixBackend === 'comfyui' ? 'ComfyUI' : 'Gemini'} images`}
                            className={`flex items-center gap-2 text-[12px] ${relevant ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}
                          >
                            <input
                              type="checkbox"
                              checked={remixRestore[opt.key]}
                              disabled={!relevant}
                              onChange={() => toggleRemixRestore(opt.key)}
                              className="accent-[#d4a017] w-3.5 h-3.5"
                            />
                            <span style={{ color: 'var(--text-primary)' }}>{opt.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      void onReusePrompt(expandedEntry);
                      setExpandedId(null);
                    }}
                    className="btn-primary flex-1 flex items-center justify-center gap-2 py-3 text-[13px]"
                  >
                    <RotateCcw size={13} />
                    Remix
                  </button>
                  <button
                    onClick={() => setRemixOptionsOpen((v) => !v)}
                    className="icon-btn shrink-0"
                    aria-expanded={remixOptionsOpen}
                    title="Choose which settings Remix restores"
                  >
                    <Cog size={15} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
