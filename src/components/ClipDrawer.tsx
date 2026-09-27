import { useState, useRef, useEffect } from 'react';
import { ChevronRight, Plus, X, Check } from 'lucide-react';
import { ClipCategory, Clip, CLIP_CATEGORIES } from '../types';

interface ClipDrawerProps {
  activeClipIds: Set<string>;
  onToggleClip: (clipId: string) => void;
  allClips: Record<ClipCategory, Clip[]>;
  onAddClip: (category: ClipCategory, label: string, modifier: string) => void;
  onRemoveClip: (category: ClipCategory, clipId: string) => void;
}

export default function ClipDrawer({
  activeClipIds,
  onToggleClip,
  allClips,
  onAddClip,
  onRemoveClip,
}: ClipDrawerProps) {
  const [expanded, setExpanded] = useState(false);
  const [addingCategory, setAddingCategory] = useState<ClipCategory | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newModifier, setNewModifier] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);

  const activeCount = activeClipIds.size;

  useEffect(() => {
    if (addingCategory && labelInputRef.current) {
      labelInputRef.current.focus();
    }
  }, [addingCategory]);

  const handleSubmitClip = () => {
    if (!addingCategory || !newLabel.trim() || !newModifier.trim()) return;
    onAddClip(addingCategory, newLabel.trim(), newModifier.trim());
    setNewLabel('');
    setNewModifier('');
    setAddingCategory(null);
  };

  const handleCancelAdd = () => {
    setNewLabel('');
    setNewModifier('');
    setAddingCategory(null);
  };

  return (
    <div className="clip-drawer">
      {/* ── Toggle Bar ──────────────────────────────────────────────── */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="clip-drawer-toggle"
      >
        <div className="flex items-center gap-2">
          <ChevronRight
            size={14}
            className="clip-drawer-chevron"
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          />
          <span className="section-title">Clips</span>
        </div>
      </button>

      {/* ── Expandable Content ──────────────────────────────────────── */}
      <div
        ref={contentRef}
        className="clip-drawer-content"
        style={{
          maxHeight: expanded ? `${(CLIP_CATEGORIES.length * 58) + 100}px` : '0px',
          opacity: expanded ? 1 : 0,
        }}
      >
        <div className="clip-drawer-inner">
          {CLIP_CATEGORIES.map(({ key, label }) => (
            <div key={key} className="clip-row">
              <span className="clip-row-label">{label}</span>

              <div className="clip-row-chips">
                {allClips[key]?.map((clip) => (
                  <div key={clip.id} className="clip-chip-wrapper group">
                    <button
                      onClick={() => onToggleClip(clip.id)}
                      className={`clip-chip ${activeClipIds.has(clip.id) ? 'clip-chip-active' : ''}`}
                      title={clip.modifier}
                    >
                      {clip.label}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveClip(key, clip.id);
                      }}
                      className="clip-chip-remove"
                      title="Remove clip"
                    >
                      <X size={8} />
                    </button>
                  </div>
                ))}

                {/* Add button or inline form */}
                {addingCategory === key ? (
                  <div className="clip-add-form">
                    <input
                      ref={labelInputRef}
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      placeholder="Name"
                      className="clip-add-input clip-add-input-name"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSubmitClip();
                        if (e.key === 'Escape') handleCancelAdd();
                      }}
                    />
                    <input
                      value={newModifier}
                      onChange={(e) => setNewModifier(e.target.value)}
                      placeholder="Modifier text..."
                      className="clip-add-input clip-add-input-mod"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSubmitClip();
                        if (e.key === 'Escape') handleCancelAdd();
                      }}
                    />
                    <button
                      onClick={handleSubmitClip}
                      disabled={!newLabel.trim() || !newModifier.trim()}
                      className="clip-add-confirm"
                      title="Save clip"
                    >
                      <Check size={11} />
                    </button>
                    <button
                      onClick={handleCancelAdd}
                      className="clip-add-cancel"
                      title="Cancel"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingCategory(key)}
                    className="clip-add-btn"
                    title={`Add ${label.toLowerCase()} clip`}
                  >
                    <Plus size={11} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
