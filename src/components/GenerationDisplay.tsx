import { useState } from 'react';
import { Download, Loader2, ImageIcon, ArrowUpFromLine } from 'lucide-react';
import { useObjectUrl } from '../hooks/useObjectUrl';
import { ComfyProgress } from '../types';

interface GenerationDisplayProps {
  images: Blob[];
  upscaledImages: (Blob | undefined)[];
  upscaleScales: (number | undefined)[];
  isGenerating: boolean;
  progress?: ComfyProgress | null;
  canUpscale: boolean;
  upscaleScale: number;
  onDownload: () => void;
  onUpscale: (index: number) => void;
}

interface ImageTileProps {
  blob: Blob;
  upscaledBlob: Blob | undefined;
  actualUpscaleScale: number | undefined;
  index: number;
  canUpscale: boolean;
  upscaleScale: number;
  isUpscaling: boolean;
  onUpscale: (index: number) => void;
}

/**
 * One grid cell.
 *
 * Split out so each image owns exactly one object URL through a single
 * `useObjectUrl` call. An array-shaped hook over the whole batch would have to
 * diff elements itself to know which URLs to revoke, and that bookkeeping is
 * precisely what leaks.
 */
function ImageTile({
  blob,
  upscaledBlob,
  actualUpscaleScale,
  index,
  canUpscale,
  upscaleScale,
  isUpscaling,
  onUpscale,
}: ImageTileProps) {
  const isUpscaled = !!upscaledBlob;
  // The URL follows whichever blob is on screen; swapping to the upscaled copy
  // revokes the original's URL through the hook's own cleanup.
  const url = useObjectUrl(upscaledBlob ?? blob);

  return (
    <div className="relative flex items-center justify-center rounded-lg overflow-hidden group">
      {url && (
        <img
          src={url}
          alt={`Generated variation ${index + 1}`}
          className="w-full h-full object-scale-down animate-fade-in"
        />
      )}

      {/* Dynamic Upscale badge */}
      {isUpscaled && <span className="badge-2k">{actualUpscaleScale ?? upscaleScale}x</span>}

      {/* Upscale button overlay */}
      {canUpscale && !isUpscaled && (
        <button onClick={() => onUpscale(index)} disabled={isUpscaling} className="upscale-btn">
          {isUpscaling ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <ArrowUpFromLine size={12} />
          )}
          <span>{isUpscaling ? 'Upscaling...' : `Upscale ${upscaleScale}x`}</span>
        </button>
      )}
    </div>
  );
}

function ComfyProgressView({ progress }: { progress: ComfyProgress }) {
  const previewUrl = useObjectUrl(progress.preview);

  let label = 'Generating...';
  let percent = 0;

  if (progress.phase === 'queued') {
    if (progress.queueRemaining !== undefined && progress.queueRemaining > 1) {
      label = `Queued — ${progress.queueRemaining - 1} ahead`;
    } else {
      label = 'Queued';
    }
    percent = 0;
  } else if (progress.phase === 'finishing') {
    label = 'Finishing...';
    percent = 100;
  } else if (progress.phase === 'running') {
    if (progress.step !== undefined && progress.maxSteps !== undefined && progress.maxSteps > 0) {
      percent = Math.round((progress.step / progress.maxSteps) * 100);
      const nodeName = progress.nodeClass || 'KSampler';
      label = `Sampling ${progress.step}/${progress.maxSteps} · ${nodeName}`;
    } else if (progress.nodeClass) {
      label = `Running · ${progress.nodeClass}`;
    }
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 w-full h-full p-4">
      {previewUrl ? (
        <div className="relative max-h-[70%] max-w-[85%] flex items-center justify-center rounded-lg overflow-hidden shadow-lg border border-[var(--border-subtle)]">
          <img
            src={previewUrl}
            alt="Latent preview"
            className="max-h-full max-w-full object-contain animate-fade-in"
          />
        </div>
      ) : (
        <div className="relative">
          <div
            className="w-12 h-12 rounded-full"
            style={{ border: '2px solid rgba(212, 160, 23, 0.15)' }}
          />
          <Loader2
            size={28}
            className="absolute inset-0 m-auto animate-spin"
            style={{ color: '#d4a017' }}
          />
        </div>
      )}

      <div className="flex flex-col items-center gap-2 w-64 max-w-[90%]">
        <div
          className="w-full h-1.5 rounded-full overflow-hidden"
          style={{ background: 'var(--icon-btn-hover)', border: '1px solid var(--border-subtle)' }}
        >
          <div
            className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full transition-all duration-200"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="text-[12px] font-medium tracking-wide text-center" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </span>
      </div>
    </div>
  );
}

export default function GenerationDisplay({
  images,
  upscaledImages,
  upscaleScales,
  isGenerating,
  progress,
  canUpscale,
  upscaleScale,
  onDownload,
  onUpscale,
}: GenerationDisplayProps) {
  const [upscalingIndex, setUpscalingIndex] = useState<number | null>(null);

  const handleUpscale = async (idx: number) => {
    setUpscalingIndex(idx);
    try {
      await onUpscale(idx);
    } finally {
      setUpscalingIndex(null);
    }
  };

  return (
    <div className="card p-5 h-full min-h-[300px] flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <span className="section-title">Output</span>
        {images.length > 0 && !isGenerating && (
          <button onClick={onDownload} className="accent-btn">
            <Download size={12} />
            <span>Download</span>
          </button>
        )}
      </div>

      <div className="flex-1 flex items-center justify-center rounded-xl overflow-hidden relative"
           style={{ background: 'var(--bg-image-area)', border: '1px solid var(--border-subtle)' }}>
        {isGenerating ? (
          progress ? (
            <ComfyProgressView progress={progress} />
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <div className="w-12 h-12 rounded-full"
                     style={{ border: '2px solid rgba(212, 160, 23, 0.15)' }} />
                <Loader2 size={28} className="absolute inset-0 m-auto animate-spin"
                         style={{ color: '#d4a017' }} />
              </div>
              <span className="text-[12px] tracking-wide" style={{ color: 'var(--text-secondary)' }}>Generating...</span>
            </div>
          )
        ) : images.length > 0 ? (
          <div className={`w-full h-full p-2 grid gap-2 ${
            images.length === 1 ? 'grid-cols-1' :
            images.length === 2 ? 'grid-cols-2 text-center' :
            'grid-cols-2 grid-rows-2'
          }`}>
            {images.map((blob, idx) => (
              <ImageTile
                key={idx}
                blob={blob}
                upscaledBlob={upscaledImages[idx]}
                actualUpscaleScale={upscaleScales[idx]}
                index={idx}
                canUpscale={canUpscale}
                upscaleScale={upscaleScale}
                isUpscaling={upscalingIndex === idx}
                onUpscale={handleUpscale}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                 style={{ background: 'var(--icon-btn-hover)', border: '1px solid var(--border-subtle)' }}>
              <ImageIcon size={28} strokeWidth={1.2} style={{ color: 'var(--text-muted)' }} />
            </div>
            <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>Your creation will appear here</p>
          </div>
        )}
      </div>
    </div>
  );
}
