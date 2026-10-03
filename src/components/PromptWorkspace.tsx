import { useState, useCallback, useRef } from 'react';
import Cropper from 'react-easy-crop';
import type { Area, Point } from 'react-easy-crop';
import {
  Play,
  RotateCcw,
  FilePlus,
  Sparkles,
  Upload,
  X,
  Loader2,
  Save,
  Trash2,
  ChevronDown,
  ChevronRight,
  Dice5,
  Lock,
} from 'lucide-react';
import {
  Resolution,
  AspectRatio,
  CropState,
  ClipCategory,
  Clip,
  BackendType,
  RESOLUTION_OPTIONS,
  ASPECT_RATIO_OPTIONS,
  COST_PER_IMAGE,
  ComfyUISampler,
  COMFYUI_SAMPLER_OPTIONS,
  PromptMode,
} from '../types';
import { getApiKey, getTemplates, addTemplate, deleteTemplate } from '../utils/settings';
import { enhancePrompt } from '../utils/api';
import { useObjectUrl } from '../hooks/useObjectUrl';
import { backendSupportsFeature } from '../utils/backendProvider';
import ClipDrawer from './ClipDrawer';
import { parsePromptList, MAX_BATCH_PROMPTS } from '../utils/batch';

interface PromptWorkspaceProps {
  prompt: string;
  onPromptChange: (v: string) => void;
  numberOfImages: number;
  onNumberOfImagesChange: (v: number) => void;
  resolution: Resolution;
  onResolutionChange: (v: Resolution) => void;
  aspectRatio: AspectRatio;
  onAspectRatioChange: (v: AspectRatio) => void;
  refImage: Blob | null;
  onRefImageChange: (v: Blob | null) => void;
  refCropArea: CropState | null;
  onRefCropChange: (v: CropState | null) => void;
  isGenerating: boolean;
  queueCount: number;
  hasGenerated: boolean;
  onGenerate: () => void;
  onRerun: () => void;
  onNew: () => void;
  showToast: (msg: string, type: 'error' | 'success' | 'info') => void;
  activeClipIds: Set<string>;
  onToggleClip: (clipId: string) => void;
  allClips: Record<ClipCategory, Clip[]>;
  onAddClip: (category: ClipCategory, label: string, modifier: string) => void;
  onRemoveClip: (category: ClipCategory, clipId: string) => void;
  autoUpscale: boolean;
  onAutoUpscaleChange: (v: boolean) => void;
  upscaleScale: number;
  onClearClips: () => void;
  activeBackend: BackendType;
  comfySteps: number;
  onComfyStepsChange: (v: number) => void;
  comfySampler: ComfyUISampler;
  onComfySamplerChange: (v: ComfyUISampler) => void;
  comfyLora: string | null;
  onComfyLoraChange: (v: string) => void;
  comfyLoraStrength: number;
  onComfyLoraStrengthChange: (v: number) => void;
  availableLoras: string[];
  comfyCfg: number;
  onComfyCfgChange: (v: number) => void;
  comfyDiffusionModel: string | null;
  onComfyDiffusionModelChange: (v: string) => void;
  comfyClipModel: string | null;
  onComfyClipModelChange: (v: string) => void;
  comfySeedMode: 'random' | 'fixed';
  onComfySeedModeChange: (v: 'random' | 'fixed') => void;
  comfySeed: number;
  onComfySeedChange: (v: number) => void;
  lastUsedSeed: number | null;
  availableDiffusionModels: string[];
  availableClipModels: string[];
  promptMode: PromptMode;
  onPromptModeChange: (v: PromptMode) => void;
  batchText: string;
  onBatchTextChange: (v: string) => void;
  onGenerateBatch: () => void;
}

export default function PromptWorkspace({
  prompt,
  onPromptChange,
  numberOfImages,
  onNumberOfImagesChange,
  resolution,
  onResolutionChange,
  aspectRatio,
  onAspectRatioChange,
  refImage,
  onRefImageChange,
  refCropArea,
  onRefCropChange,
  isGenerating,
  queueCount,
  hasGenerated,
  onGenerate,
  onRerun,
  onNew,
  showToast,
  activeClipIds,
  onToggleClip,
  allClips,
  onAddClip,
  onRemoveClip,
  autoUpscale,
  onAutoUpscaleChange,
  upscaleScale,
  onClearClips,
  activeBackend,
  comfySteps,
  onComfyStepsChange,
  comfySampler,
  onComfySamplerChange,
  comfyLora,
  onComfyLoraChange,
  comfyLoraStrength,
  onComfyLoraStrengthChange,
  availableLoras,
  comfyCfg,
  onComfyCfgChange,
  comfyDiffusionModel,
  onComfyDiffusionModelChange,
  comfyClipModel,
  onComfyClipModelChange,
  comfySeedMode,
  onComfySeedModeChange,
  comfySeed,
  onComfySeedChange,
  lastUsedSeed,
  availableDiffusionModels,
  availableClipModels,
  promptMode,
  onPromptModeChange,
  batchText,
  onBatchTextChange,
  onGenerateBatch,
}: PromptWorkspaceProps) {
  const [cropPos, setCropPos] = useState<Point>({ x: 0, y: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const [dragActive, setDragActive] = useState(false);
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [templates, setTemplates] = useState(getTemplates());
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(true);
  const [promptExpanded, setPromptExpanded] = useState(true);

  // Revoked only when the blob changes or this unmounts. Do not "optimize" this
  // to revoke on crop-complete: react-easy-crop loads the URL into its own
  // <img>, and pulling it mid-load breaks the cropper.
  const refImageUrl = useObjectUrl(refImage);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleGenerateClick = useCallback(() => {
    onGenerate();
    setTimeout(() => {
      textareaRef.current?.focus({ preventScroll: true });
    }, 50);
  }, [onGenerate]);

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showToast('Please upload an image file', 'error');
      return;
    }
    // A File is already a Blob -- no decode needed.
    onRefImageChange(file);
    onRefCropChange(null);
    setCropPos({ x: 0, y: 0 });
    setCropZoom(1);
  }, [onRefImageChange, onRefCropChange, showToast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleCropComplete = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    onRefCropChange({
      x: croppedAreaPixels.x,
      y: croppedAreaPixels.y,
      width: croppedAreaPixels.width,
      height: croppedAreaPixels.height,
    });
  }, [onRefCropChange]);

  const handleEnhance = useCallback(async () => {
    const apiKey = getApiKey();
    if (!apiKey) {
      showToast('Set your API key first', 'error');
      return;
    }
    if (!prompt.trim()) {
      showToast('Type a prompt first', 'error');
      return;
    }
    setIsEnhancing(true);
    try {
      const enhanced = await enhancePrompt(apiKey, prompt);
      onPromptChange(enhanced);
      showToast('Prompt enhanced!', 'success');
    } catch (err: any) {
      showToast(err.message || 'Enhancement failed', 'error');
    } finally {
      setIsEnhancing(false);
    }
  }, [prompt, onPromptChange, showToast]);

  const handleSaveTemplate = () => {
    if (!saveTemplateName.trim()) return;
    const updated = addTemplate(saveTemplateName.trim(), prompt);
    setTemplates(updated);
    setSaveTemplateName('');
    setShowSaveInput(false);
    showToast('Template saved', 'success');
  };

  const handleDeleteTemplate = (id: string) => {
    const updated = deleteTemplate(id);
    setTemplates(updated);
  };

  const handleLoadTemplate = (text: string) => {
    onPromptChange(text);
    setTemplateDropdownOpen(false);
  };



  const cost = COST_PER_IMAGE[resolution];
  const totalEstimatedCost = cost.cost * numberOfImages;
  const showCost = backendSupportsFeature(activeBackend, 'costEstimate');
  const showRefImage = backendSupportsFeature(activeBackend, 'referenceImage');
  const showEnhance = backendSupportsFeature(activeBackend, 'enhance');
  const showClips = backendSupportsFeature(activeBackend, 'clips');
  const showComfySettings = backendSupportsFeature(activeBackend, 'comfySettings');

  const quickUpscaleToggle = ['512', '1k', '2k'].includes(resolution) ? (
    <div className="flex items-center justify-between py-1">
      <span className="label" style={{ marginBottom: 0 }}>
        Quick Upscale ({upscaleScale}x)
      </span>
      <button
        onClick={() => onAutoUpscaleChange(!autoUpscale)}
        className={`toggle-switch ${autoUpscale ? 'toggle-on' : ''}`}
        title={autoUpscale ? 'Quick upscale enabled' : 'Quick upscale disabled'}
      >
        <span className="toggle-knob" />
      </button>
    </div>
  ) : null;

  const showSeed = backendSupportsFeature(activeBackend, 'seed');

  const seedControl = showSeed ? (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="label !mb-0">Seed</span>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-md"
          style={{
            color: comfySeedMode === 'fixed' ? 'var(--accent-primary, #d4a017)' : 'var(--text-secondary)',
            background: comfySeedMode === 'fixed' ? 'var(--accent-glow)' : 'var(--icon-btn-hover)',
            border: `1px solid ${comfySeedMode === 'fixed' ? 'var(--accent-primary, #d4a017)' : 'var(--border-subtle)'}`,
          }}
        >
          {comfySeedMode === 'fixed' ? 'FIXED SEED' : 'RANDOM SEED'}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {comfySeedMode === 'fixed' ? (
          <input
            type="number"
            min="0"
            max={Number.MAX_SAFE_INTEGER}
            value={comfySeed}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              onComfySeedChange(Number.isNaN(val) ? 0 : Math.max(0, Math.min(val, Number.MAX_SAFE_INTEGER)));
            }}
            className="input-field !text-[12px] !py-1.5 !px-2.5 !rounded-lg flex-1 min-w-0"
            style={{ background: 'var(--icon-btn-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-heading)' }}
          />
        ) : (
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            <input
              type="text"
              readOnly
              value={lastUsedSeed !== null && lastUsedSeed !== undefined ? lastUsedSeed : 'Random'}
              className="input-field !text-[12px] !py-1.5 !px-2.5 !rounded-lg flex-1 min-w-0 opacity-70 cursor-default"
              style={{ background: 'var(--icon-btn-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-heading)' }}
              title={lastUsedSeed !== null && lastUsedSeed !== undefined ? 'Last used seed' : 'A random seed will be generated'}
            />
            {lastUsedSeed !== null && lastUsedSeed !== undefined && (
              <button
                type="button"
                onClick={() => {
                  onComfySeedChange(lastUsedSeed);
                  onComfySeedModeChange('fixed');
                }}
                className="px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors shrink-0"
                style={{ background: 'var(--icon-btn-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-heading)' }}
                title="Use this seed in fixed mode"
              >
                Use
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            onComfySeedModeChange(comfySeedMode === 'fixed' ? 'random' : 'fixed');
          }}
          className="icon-btn !w-8 !h-8 shrink-0 rounded-lg flex items-center justify-center transition-colors"
          style={{
            background: comfySeedMode === 'fixed' ? 'var(--accent-glow)' : 'var(--icon-btn-hover)',
            border: `1px solid ${comfySeedMode === 'fixed' ? 'var(--accent-primary, #d4a017)' : 'var(--border-subtle)'}`,
          }}
          title={comfySeedMode === 'fixed' ? 'Fixed seed (click for random)' : 'Random seed (click for fixed)'}
          aria-label={comfySeedMode === 'fixed' ? 'Fixed seed selected; switch to random' : 'Random seed selected; switch to fixed'}
          aria-pressed={comfySeedMode === 'fixed'}
        >
          {comfySeedMode === 'fixed' ? (
            <Lock size={14} style={{ color: 'var(--accent-primary, #d4a017)' }} />
          ) : (
            <Dice5 size={14} style={{ color: 'var(--text-secondary)' }} />
          )}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-4">
      {/* ── Reference Image + Controls (side by side) ────────────────── */}
      <div className="clip-drawer">
        <div
          onClick={() => setSettingsExpanded(!settingsExpanded)}
          className="clip-drawer-toggle"
        >
          <div className="flex items-center gap-2">
            <ChevronRight
              size={14}
              className="clip-drawer-chevron"
              style={{ transform: settingsExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
            />
            <span className="section-title">Settings</span>
          </div>
        </div>

        <div
          className="clip-drawer-content"
          style={{
            maxHeight: settingsExpanded ? '3000px' : '0px',
            opacity: settingsExpanded ? 1 : 0,
            overflow: 'hidden',
          }}
        >
          <div className="flex flex-col lg:flex-row gap-5 px-5 pb-5 pt-0">
          {/* Left: Reference Image */}
          {showRefImage && (
          <div className="flex-1 min-w-0 flex flex-col">

            {refImage && refImageUrl ? (
              <div className="flex-1 flex flex-col gap-2">
                <div className="flex-1 rounded-xl overflow-hidden" style={{ position: 'relative', minHeight: '200px', border: '1px solid var(--border-subtle)' }}>
                  <Cropper
                    image={refImageUrl}
                    crop={cropPos}
                    zoom={cropZoom}
                    aspect={1}
                    onCropChange={setCropPos}
                    onZoomChange={setCropZoom}
                    onCropComplete={handleCropComplete}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Scroll to zoom · Drag to pan</span>
                  <button
                    onClick={() => { onRefImageChange(null); onRefCropChange(null); }}
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-heading)] hover:bg-[var(--icon-btn-hover)] rounded-lg transition-all"
                  >
                    <X size={10} />
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <div
                className={`dropzone flex-1 flex flex-col items-center justify-center text-center ${dragActive ? 'dropzone-active' : ''}`}
                style={{ minHeight: '200px' }}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
              >
                <div className="w-10 h-10 mb-3 rounded-xl flex items-center justify-center"
                     style={{ background: 'var(--icon-btn-hover)' }}>
                  <Upload size={18} style={{ color: 'var(--text-muted)' }} />
                </div>
                <p className="text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>Add an optional reference image</p>
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>Drag & drop or click</p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
                e.target.value = '';
              }}
              className="hidden"
            />
          </div>
          )}

          {/* Controls — grid layout when no ref image, narrow column when alongside ref image */}
          {showRefImage ? (
          <div className={`${showComfySettings ? 'w-[250px]' : 'w-[200px]'} shrink-0 flex flex-col justify-between transition-all duration-300`}>
            <div className="flex flex-col gap-y-4">
                <div>
                  <span className="label">Resolution</span>
                  <div className="seg-control flex-col">
                    {RESOLUTION_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => onResolutionChange(opt.value)}
                        className={resolution === opt.value ? 'seg-active' : ''}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {activeBackend !== 'comfyui' && quickUpscaleToggle}

                <div>
                  <span className="label">Aspect Ratio</span>
                  <div className="seg-control flex-col">
                    {ASPECT_RATIO_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => onAspectRatioChange(opt.value)}
                        className={aspectRatio === opt.value ? 'seg-active' : ''}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {activeBackend === 'comfyui' && quickUpscaleToggle}

                <div>
                  <span className="label">Variations</span>
                  <div className="seg-control">
                    {[1, 2, 4].map((num) => (
                      <button
                        key={num}
                        onClick={() => onNumberOfImagesChange(num)}
                        className={numberOfImages === num ? 'seg-active' : ''}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                </div>
              {showComfySettings && (
                <>
                  <div>
                    <span className="label">Steps</span>
                    <div className="seg-control flex">
                      <button
                        onClick={() => onComfyStepsChange(Math.max(8, comfySteps - 1))}
                        disabled={comfySteps <= 8}
                        aria-label="Decrease steps"
                      >
                        -
                      </button>
                      <div className="flex-1 flex items-center justify-center text-[13px] font-medium text-[var(--text-heading)]">
                        {comfySteps}
                      </div>
                      <button
                        onClick={() => onComfyStepsChange(Math.min(30, comfySteps + 1))}
                        disabled={comfySteps >= 30}
                        aria-label="Increase steps"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div>
                    <span className="label">Sampler</span>
                    <div className="flex flex-wrap gap-[6px]">
                      {COMFYUI_SAMPLER_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => onComfySamplerChange(opt.value)}
                          className={`clip-chip ${comfySampler === opt.value ? 'clip-chip-active' : ''}`}
                        >
                          {opt.label.replace(' & ', ' + ')}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="label">Diffusion Model</span>
                    <select
                      value={comfyDiffusionModel || 'none'}
                      onChange={(e) => onComfyDiffusionModelChange(e.target.value)}
                      className="input-field !text-[12px] !py-1.5 !px-2.5 !rounded-lg w-full"
                      style={{ background: 'var(--icon-btn-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-heading)' }}
                    >
                      {availableDiffusionModels.length === 0 ? (
                        <option value="none">No models found</option>
                      ) : (
                        availableDiffusionModels.map((modelName) => (
                          <option key={modelName} value={modelName}>
                            {modelName.split('\\').pop()?.split('/').pop()?.replace('.safetensors', '')}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                  {seedControl}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="label" style={{ marginBottom: 0 }}>CFG Scale</span>
                      <span className="text-[11px] font-mono text-[var(--text-secondary)]">{comfyCfg.toFixed(1)}</span>
                    </div>
                    <div className="flex items-center gap-3 pt-1">
                      <input
                        type="range"
                        min="1.0"
                        max="12.0"
                        step="0.5"
                        value={comfyCfg}
                        onChange={(e) => onComfyCfgChange(parseFloat(e.target.value))}
                        className="flex-1 accent-[#d4a017] cursor-pointer h-1.5 rounded-lg appearance-none"
                        style={{ background: 'rgba(128, 128, 128, 0.45)' }}
                      />
                    </div>
                  </div>
                  <div>
                    <span className="label">CLIP Model</span>
                    <select
                      value={comfyClipModel || 'none'}
                      onChange={(e) => onComfyClipModelChange(e.target.value)}
                      className="input-field !text-[12px] !py-1.5 !px-2.5 !rounded-lg w-full"
                      style={{ background: 'var(--icon-btn-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-heading)' }}
                    >
                      {availableClipModels.length === 0 ? (
                        <option value="none">No models found</option>
                      ) : (
                        availableClipModels.map((clipName) => (
                          <option key={clipName} value={clipName}>
                            {clipName.split('\\').pop()?.split('/').pop()?.replace('.safetensors', '')}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                  <div>
                    <span className="label">LoRA Model</span>
                    <select
                      value={comfyLora || 'none'}
                      onChange={(e) => onComfyLoraChange(e.target.value)}
                      className="input-field !text-[12px] !py-1.5 !px-2.5 !rounded-lg w-full"
                      style={{ background: 'var(--icon-btn-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-heading)' }}
                    >
                      <option value="none">None (Bypassed)</option>
                      {availableLoras.map((loraName) => (
                        <option key={loraName} value={loraName}>
                          {loraName.split('\\').pop()?.split('/').pop()?.replace('.safetensors', '')}
                        </option>
                      ))}
                    </select>
                  </div>
                  {comfyLora && comfyLora !== 'none' && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="label" style={{ marginBottom: 0 }}>LoRA Strength</span>
                        <span className="text-[11px] font-mono text-[var(--text-secondary)]">{comfyLoraStrength.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center gap-3 pt-1">
                        <input
                          type="range"
                          min="0.80"
                          max="1.20"
                          step="0.05"
                          value={comfyLoraStrength}
                          onChange={(e) => onComfyLoraStrengthChange(parseFloat(e.target.value))}
                          className="flex-1 accent-[#d4a017] cursor-pointer h-1.5 rounded-lg appearance-none"
                          style={{ background: 'rgba(128, 128, 128, 0.45)' }}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {showCost && (
              <div className="flex items-center gap-2 pt-3">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#d4a017', opacity: 0.6 }} />
                <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                  ~${totalEstimatedCost.toFixed(3)}
                </span>
              </div>
            )}
          </div>
          ) : (
          <div className="w-full flex flex-col gap-y-4 transition-all duration-300">
            <div className="settings-grid">
                <div>
                  <span className="label">Resolution</span>
                  <div className="seg-control flex-col">
                    {RESOLUTION_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => onResolutionChange(opt.value)}
                        className={resolution === opt.value ? 'seg-active' : ''}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="label">Aspect Ratio</span>
                  <div className="seg-control flex-col">
                    {ASPECT_RATIO_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => onAspectRatioChange(opt.value)}
                        className={aspectRatio === opt.value ? 'seg-active' : ''}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-y-4">
                  {activeBackend === 'comfyui' && quickUpscaleToggle}

                  <div>
                    <span className="label">Variations</span>
                    <div className="seg-control">
                      {[1, 2, 4].map((num) => (
                        <button
                          key={num}
                          onClick={() => onNumberOfImagesChange(num)}
                          className={numberOfImages === num ? 'seg-active' : ''}
                        >
                          {num}
                        </button>
                      ))}
                    </div>
                  </div>

                  {activeBackend !== 'comfyui' && quickUpscaleToggle}

                  {showComfySettings && (
                    <div>
                      <span className="label">Steps</span>
                      <div className="seg-control flex">
                        <button
                          onClick={() => onComfyStepsChange(Math.max(8, comfySteps - 1))}
                          disabled={comfySteps <= 8}
                          aria-label="Decrease steps"
                        >
                          -
                        </button>
                        <div className="flex-1 flex items-center justify-center text-[13px] font-medium text-[var(--text-heading)]">
                          {comfySteps}
                        </div>
                        <button
                          onClick={() => onComfyStepsChange(Math.min(30, comfySteps + 1))}
                          disabled={comfySteps >= 30}
                          aria-label="Increase steps"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )}
                </div>
            </div>

            {showComfySettings && (
              <>
                <div className="mb-4">
                  <span className="label">Sampler</span>
                  <div className="flex flex-wrap gap-[6px]">
                    {COMFYUI_SAMPLER_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => onComfySamplerChange(opt.value)}
                        className={`clip-chip ${comfySampler === opt.value ? 'clip-chip-active' : ''}`}
                      >
                        {opt.label.replace(' & ', ' + ')}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-grid">
                  <div>
                    <span className="label">Diffusion Model</span>
                    <select
                      value={comfyDiffusionModel || 'none'}
                      onChange={(e) => onComfyDiffusionModelChange(e.target.value)}
                      className="input-field !text-[12px] !py-1.5 !px-2.5 !rounded-lg w-full"
                      style={{ background: 'var(--icon-btn-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-heading)' }}
                    >
                      {availableDiffusionModels.length === 0 ? (
                        <option value="none">No models found</option>
                      ) : (
                        availableDiffusionModels.map((modelName) => (
                          <option key={modelName} value={modelName}>
                            {modelName.split('\\').pop()?.split('/').pop()?.replace('.safetensors', '')}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <span className="label">CLIP Model</span>
                    <select
                      value={comfyClipModel || 'none'}
                      onChange={(e) => onComfyClipModelChange(e.target.value)}
                      className="input-field !text-[12px] !py-1.5 !px-2.5 !rounded-lg w-full"
                      style={{ background: 'var(--icon-btn-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-heading)' }}
                    >
                      {availableClipModels.length === 0 ? (
                        <option value="none">No models found</option>
                      ) : (
                        availableClipModels.map((clipName) => (
                          <option key={clipName} value={clipName}>
                            {clipName.split('\\').pop()?.split('/').pop()?.replace('.safetensors', '')}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <span className="label">LoRA Model</span>
                    <select
                      value={comfyLora || 'none'}
                      onChange={(e) => onComfyLoraChange(e.target.value)}
                      className="input-field !text-[12px] !py-1.5 !px-2.5 !rounded-lg w-full"
                      style={{ background: 'var(--icon-btn-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-heading)' }}
                    >
                      <option value="none">None (Bypassed)</option>
                      {availableLoras.map((loraName) => (
                        <option key={loraName} value={loraName}>
                          {loraName.split('\\').pop()?.split('/').pop()?.replace('.safetensors', '')}
                        </option>
                      ))}
                    </select>
                  </div>

                  {seedControl}

                  {/* Row 2: CFG Scale slider and LoRA Strength slider */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="label" style={{ marginBottom: 0 }}>CFG Scale</span>
                      <span className="text-[11px] font-mono text-[var(--text-secondary)]">{comfyCfg.toFixed(1)}</span>
                    </div>
                    <div className="flex items-center gap-3 pt-2">
                      <input
                        type="range"
                        min="1.0"
                        max="12.0"
                        step="0.5"
                        value={comfyCfg}
                        onChange={(e) => onComfyCfgChange(parseFloat(e.target.value))}
                        className="flex-1 accent-[#d4a017] cursor-pointer h-1.5 rounded-lg appearance-none"
                        style={{ background: 'rgba(128, 128, 128, 0.45)' }}
                      />
                    </div>
                  </div>

                  {comfyLora && comfyLora !== 'none' ? (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="label" style={{ marginBottom: 0 }}>LoRA Strength</span>
                        <span className="text-[11px] font-mono text-[var(--text-secondary)]">{comfyLoraStrength.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center gap-3 pt-2">
                        <input
                          type="range"
                          min="0.80"
                          max="1.20"
                          step="0.05"
                          value={comfyLoraStrength}
                          onChange={(e) => onComfyLoraStrengthChange(parseFloat(e.target.value))}
                          className="flex-1 accent-[#d4a017] cursor-pointer h-1.5 rounded-lg appearance-none"
                          style={{ background: 'rgba(128, 128, 128, 0.45)' }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div /> /* Spacer for LoRA column when inactive */
                  )}
                </div>
              </>
            )}

            {showCost && (
              <div className="flex items-center gap-2 pt-3">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#d4a017', opacity: 0.6 }} />
                <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                  ~${totalEstimatedCost.toFixed(3)}
                </span>
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    </div>

      {/* ── Prompt ───────────────────────────────────────────────────── */}
      <div className="clip-drawer">
        <div
          onClick={() => setPromptExpanded(!promptExpanded)}
          className="clip-drawer-toggle"
        >
          <div className="flex items-center gap-2">
            <ChevronRight
              size={14}
              className="clip-drawer-chevron"
              style={{ transform: promptExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
            />
            <span className="section-title">Prompt</span>
            <div
              className={`seg-control flex ml-2 transition-opacity duration-200 ${promptExpanded ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
              style={{ transform: 'scale(0.85)', transformOrigin: 'left center' }}
              onClick={e => e.stopPropagation()}
            >
              <button
                onClick={() => onPromptModeChange('single')}
                className={promptMode === 'single' ? 'seg-active' : ''}
              >
                Single
              </button>
              <button
                onClick={() => onPromptModeChange('batch')}
                className={promptMode === 'batch' ? 'seg-active' : ''}
              >
                Batch
              </button>
            </div>
          </div>

          <div
            className={`flex items-center gap-0.5 transition-opacity duration-200 ${promptExpanded ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
            onClick={(e) => e.stopPropagation()}
          >
            {promptMode === 'single' && !!(prompt.trim() || activeClipIds.size > 0) && (
              <button
                onClick={() => {
                  onPromptChange('');
                  onClearClips();
                }}
                className="accent-btn"
                style={{ color: 'rgba(156, 163, 175, 0.6)' }}
                title="Clear prompt and reset clips"
              >
                <Trash2 size={11} />
                <span>Reset</span>
              </button>
            )}

            {promptMode === 'single' && showEnhance && !!prompt.trim() && (
              <button
                onClick={handleEnhance}
                disabled={isEnhancing}
                className="accent-btn"
                title="Enhance prompt with AI"
              >
                {isEnhancing ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Sparkles size={12} />
                )}
                <span>Enhance</span>
              </button>
            )}

            {promptMode === 'single' && (
              <div className="relative">
              <button
                onClick={() => {
                  setTemplateDropdownOpen(!templateDropdownOpen);
                  setTemplates(getTemplates());
                }}
                className="accent-btn"
                style={{ color: 'rgba(156, 163, 175, 0.6)' }}
              >
                <span>Templates</span>
                <ChevronDown size={11} />
              </button>

              {templateDropdownOpen && promptExpanded && (
                <div className="absolute right-0 top-full mt-2 w-72 glass-modal rounded-xl z-50 animate-fade-in overflow-hidden">
                  <div className="p-2 space-y-0.5 max-h-52 overflow-y-auto">
                    {templates.length === 0 ? (
                      <p className="text-[11px] text-gray-600 text-center py-4">No templates yet</p>
                    ) : (
                      templates.map((t) => (
                        <div key={t.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-white/[0.03] group transition-colors">
                          <button
                            onClick={() => handleLoadTemplate(t.prompt)}
                            className="flex-1 text-left text-[12px] text-gray-400 truncate hover:text-gray-200 transition-colors"
                          >
                            {t.name}
                          </button>
                          <button
                            onClick={() => handleDeleteTemplate(t.id)}
                            className="shrink-0 p-0.5 opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--text-heading)] transition-all"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="border-t border-white/[0.04] p-2">
                    {showSaveInput ? (
                      <div className="flex gap-1.5">
                        <input
                          value={saveTemplateName}
                          onChange={(e) => setSaveTemplateName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSaveTemplate()}
                          placeholder="Template name..."
                          className="input-field !py-1.5 !px-2.5 !text-[11px] !rounded-lg"
                          autoFocus
                        />
                        <button onClick={handleSaveTemplate}
                          className="px-3 py-1.5 text-[11px] font-semibold rounded-lg"
                          style={{ background: '#d4a017', color: '#0c0c14' }}>
                          Save
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowSaveInput(true)}
                        disabled={!prompt.trim()}
                        className="w-full flex items-center justify-center gap-1.5 py-2 text-[11px] text-gray-500 hover:text-gray-300 hover:bg-white/[0.03] rounded-lg transition-all disabled:opacity-30"
                      >
                        <Save size={11} />
                        Save current prompt
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            )}
          </div>
        </div>

        <div
          className="clip-drawer-content"
          style={{
            maxHeight: promptExpanded ? '800px' : '0px',
            opacity: promptExpanded ? 1 : 0,
            overflow: promptExpanded ? 'visible' : 'hidden', // Need visible so template dropdown renders
          }}
        >
          <div className="px-5 pb-5 pt-0">
            {promptMode === 'single' ? (
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => onPromptChange(e.target.value)}
                placeholder="Describe the image you want to generate..."
                rows={4}
                className="input-field"
              />
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-end">
                  <label className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-heading)] cursor-pointer transition-colors flex items-center gap-1">
                    <FilePlus size={11} />
                    Import .txt
                    <input
                      type="file"
                      accept=".txt,text/plain"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            const text = ev.target?.result as string;
                            onBatchTextChange(batchText ? batchText + '\n' + text : text);
                          };
                          reader.readAsText(file);
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
                <textarea
                  value={batchText}
                  onChange={(e) => onBatchTextChange(e.target.value)}
                  placeholder="One prompt per line…"
                  rows={8}
                  className="input-field"
                />
                {batchText && (() => {
                  const batchPromptCount = parsePromptList(batchText).length;
                  const batchTotalImages = batchPromptCount * numberOfImages;
                  const batchEstCost = activeBackend === 'gemini' ? batchTotalImages * (COST_PER_IMAGE[resolution]?.cost || 0) : 0;
                  return (
                    <div className={`text-[11px] ${batchPromptCount > MAX_BATCH_PROMPTS ? 'text-red-500' : 'text-[var(--text-secondary)]'}`}>
                      {batchPromptCount} prompts × {numberOfImages} images = {batchTotalImages} images
                      {activeBackend === 'gemini' && ` · est. $${batchEstCost.toFixed(3)}`}
                      {batchPromptCount > MAX_BATCH_PROMPTS && ` (max ${MAX_BATCH_PROMPTS})`}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Clip Drawer ─── (hidden for backends that don't support clips) */}
      {showClips && (
      <ClipDrawer
        activeClipIds={activeClipIds}
        onToggleClip={onToggleClip}
        allClips={allClips}
        onAddClip={onAddClip}
        onRemoveClip={onRemoveClip}
      />
      )}

      {/* ── Action Buttons ───────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2.5">
          <button
            onClick={promptMode === 'batch' ? onGenerateBatch : handleGenerateClick}
            disabled={promptMode === 'batch' ? (parsePromptList(batchText).length === 0 || parsePromptList(batchText).length > MAX_BATCH_PROMPTS) : !prompt.trim()}
            className="btn-primary flex-1 flex items-center justify-center gap-2.5 py-3.5 text-[13px] tracking-wide"
            title="Ctrl+Enter"
          >
            {isGenerating && promptMode !== 'batch' ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Play size={15} />
            )}
            {promptMode === 'batch'
              ? `Queue ${parsePromptList(batchText).length} prompt(s)`
              : isGenerating
                ? 'Queue Prompt'
                : 'Generate'}
          </button>

          {hasGenerated && (
            <>
              <button
                onClick={onRerun}
                disabled={isGenerating}
                className="btn-secondary flex items-center gap-2 px-5 py-3.5 text-[13px]"
              >
                <RotateCcw size={13} />
                Remix
              </button>
              <button
                onClick={onNew}
                disabled={isGenerating}
                className="btn-secondary flex items-center gap-2 px-5 py-3.5 text-[13px]"
              >
                <FilePlus size={13} />
                New
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
