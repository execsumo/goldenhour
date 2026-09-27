import { QueueItem } from '../types';
import { Loader2, X, Circle, Check, Ban, Square } from 'lucide-react';

interface QueuePanelProps {
  queueItems: QueueItem[];
  onRemoveItem: (id: string) => void;
  onClearQueue: () => void;
  onRetryFailed: () => void;
  onCancelRunning: () => void;
}

export default function QueuePanel({ queueItems, onRemoveItem, onClearQueue, onRetryFailed, onCancelRunning }: QueuePanelProps) {
  if (queueItems.length === 0) return null;

  const pending = queueItems.filter(i => i.status === 'pending').length;
  const done = queueItems.filter(i => i.status === 'done').length;
  const failed = queueItems.filter(i => i.status === 'failed').length;
  const cancelled = queueItems.filter(i => i.status === 'cancelled').length;

  const summary = [
    { count: pending, label: 'pending' },
    { count: done, label: 'done' },
    { count: failed, label: 'failed' },
    { count: cancelled, label: 'cancelled' },
  ].filter((s) => s.count > 0);

  return (
    <div className="glass p-4 rounded-xl flex flex-col gap-3">
      <div className="flex items-center justify-between text-[13px]">
        <div className="font-medium text-[var(--text-heading)]">
          Queue{summary.map((s) => ` · ${s.count} ${s.label}`).join('')}
        </div>
        <div className="flex gap-3">
          {failed > 0 && (
            <button
              onClick={onRetryFailed}
              className="text-amber-400 hover:text-amber-300 transition-colors"
            >
              Retry failed
            </button>
          )}
          <button
            onClick={onClearQueue}
            className="text-[var(--text-secondary)] hover:text-[var(--text-heading)] transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="max-h-[240px] overflow-y-auto flex flex-col gap-2">
        {queueItems.map(item => (
          <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg bg-black/20 text-[13px] group">
            <div className="shrink-0 flex items-center justify-center w-6 h-6">
              {item.status === 'pending' && <Circle className="w-4 h-4 text-[var(--text-secondary)]" />}
              {item.status === 'running' && <Loader2 className="w-4 h-4 text-[#d4a017] animate-spin" />}
              {item.status === 'done' && (
                item.thumbnailDataUrl ? (
                  <img src={item.thumbnailDataUrl} alt="Done" className="w-6 h-6 object-cover rounded" />
                ) : (
                  <Check className="w-4 h-4 text-emerald-500" />
                )
              )}
              {item.status === 'failed' && (
                <span title={item.error}><X className="w-4 h-4 text-red-500" /></span>
              )}
              {item.status === 'cancelled' && <Ban className="w-4 h-4 text-[var(--text-secondary)]" />}
            </div>

            <div className="flex-1 truncate text-[var(--text-secondary)]" title={item.settings.prompt}>
              {item.settings.prompt}
            </div>

            {item.status === 'running' && item.progress !== undefined && (
              <span className="text-[11px] font-mono font-medium text-amber-400 shrink-0">
                {item.progress}%
              </span>
            )}

            {item.status === 'pending' && (
              <button
                onClick={() => onRemoveItem(item.id)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-[var(--text-heading)] transition-all text-[var(--text-secondary)]"
                title="Remove from queue"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            {item.status === 'running' && (
              <button
                onClick={onCancelRunning}
                className="flex items-center gap-1 rounded px-2 py-1 text-red-400 hover:text-red-300 transition-colors"
                title="Stop this generation"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Stop</span>
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
