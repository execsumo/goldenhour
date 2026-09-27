import { useState, useEffect, useRef } from 'react';
import { X, Eye, EyeOff, Trash2, Download, Upload, Wifi, WifiOff, Cloud, Monitor } from 'lucide-react';
import { getApiKey, setApiKey, exportSettings, importSettings, getComfyUIConfig, setComfyUIConfig } from '../utils/settings';
import { testConnection } from '../utils/comfyui';
import { BackendType, ComfyUIConfig, RTX_SCALE_OPTIONS } from '../types';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onClearHistory: () => void;
  activeBackend: BackendType;
  onBackendChange: (b: BackendType) => void;
}

export default function SettingsModal({ open, onClose, onClearHistory, activeBackend, onBackendChange }: SettingsModalProps) {
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workflowInputRef = useRef<HTMLInputElement>(null);

  // ComfyUI config state
  const [comfyHost, setComfyHost] = useState('127.0.0.1');
  const [comfyPort, setComfyPort] = useState('8188');
  const [comfyStatus, setComfyStatus] = useState<'idle' | 'testing' | 'connected' | 'error'>('idle');
  const [comfyStatusMessage, setComfyStatusMessage] = useState('');
  const [hasWorkflow, setHasWorkflow] = useState(false);
  const [rtxUpscale, setRtxUpscale] = useState(false);
  const [rtxUpscaleScale, setRtxUpscaleScale] = useState(2);
  const [rtxDetected, setRtxDetected] = useState<boolean | null>(null);
  const [workflowFileName, setWorkflowFileName] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setKey(getApiKey());
      setConfirmClear(false);
      const cfg = getComfyUIConfig();
      setComfyHost(cfg.host);
      setComfyPort(cfg.port.toString());
      setHasWorkflow(!!cfg.workflowJson);
      setWorkflowFileName(cfg.workflowFileName || null);
      setRtxUpscale(!!cfg.rtxUpscale);
      setRtxUpscaleScale(cfg.rtxUpscaleScale ?? 2);
      setRtxDetected(cfg.rtxUpscale ? true : null);
      setComfyStatus('idle');
      setComfyStatusMessage('');
    }
  }, [open]);

  const handleSave = () => {
    setApiKey(key.trim());

    // Also save ComfyUI config
    const cfg = getComfyUIConfig();
    cfg.host = comfyHost.trim() || '127.0.0.1';
    cfg.port = parseInt(comfyPort, 10) || 8188;
    cfg.rtxUpscale = rtxUpscale;
    cfg.rtxUpscaleScale = rtxUpscaleScale;
    setComfyUIConfig(cfg);

    onClose();
  };

  const handleTestConnection = async () => {
    setComfyStatus('testing');
    setComfyStatusMessage('Testing...');
    const config: ComfyUIConfig = {
      host: comfyHost.trim() || '127.0.0.1',
      port: parseInt(comfyPort, 10) || 8188,
      workflowJson: null,
    };
    const result = await testConnection(config);
    setComfyStatus(result.ok ? 'connected' : 'error');
    setComfyStatusMessage(result.message);
    if (result.ok) {
      setRtxDetected(result.rtxSupported);
      if (!result.rtxSupported) {
        setRtxUpscale(false);
      }
    } else {
      setRtxDetected(false);
      setRtxUpscale(false);
    }
  };

  const handleWorkflowUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string);
        const cfg = getComfyUIConfig();
        cfg.workflowJson = JSON.stringify(json);
        cfg.workflowFileName = file.name;
        setComfyUIConfig(cfg);
        setHasWorkflow(true);
        setWorkflowFileName(file.name);
        setComfyStatusMessage('Workflow loaded');
      } catch {
        setComfyStatusMessage('Invalid workflow JSON');
      }
    };
    reader.readAsText(file);
    // Reset so the same file can be re-selected
    e.target.value = '';
  };

  const handleClearWorkflow = () => {
    const cfg = getComfyUIConfig();
    cfg.workflowJson = null;
    cfg.workflowFileName = null;
    setComfyUIConfig(cfg);
    setHasWorkflow(false);
    setWorkflowFileName(null);
    setComfyStatusMessage('Using default workflow');
  };

  const handleExport = () => {
    const data = exportSettings();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `golden-hour-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        importSettings(data);
        setKey(getApiKey());
        window.location.reload();
      } catch {
        alert('Invalid settings file');
      }
    };
    reader.readAsText(file);
  };

  const handleClearHistory = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    onClearHistory();
    setConfirmClear(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
         style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
         onClick={onClose}>
      <div className="glass-modal rounded-2xl w-full max-w-md mx-4 p-6 animate-fade-in overflow-y-auto"
           style={{ maxHeight: '90vh' }}
           onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Settings</h2>
          <button onClick={onClose} className="icon-btn">
            <X size={16} />
          </button>
        </div>

        {/* ── Backend Toggle ─────────────────────────────────────────── */}
        <span className="label">Image Backend</span>
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => onBackendChange('gemini')}
            className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-[12px] font-medium transition-all ${
              activeBackend === 'gemini'
                ? 'bg-[#d4a017]/15 border border-[#d4a017]/30 text-[#d4a017]'
                : 'btn-secondary'
            }`}
          >
            <Cloud size={14} />
            Gemini (Cloud)
          </button>
          <button
            onClick={() => onBackendChange('comfyui')}
            className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-[12px] font-medium transition-all ${
              activeBackend === 'comfyui'
                ? 'bg-[#d4a017]/15 border border-[#d4a017]/30 text-[#d4a017]'
                : 'btn-secondary'
            }`}
          >
            <Monitor size={14} />
            ComfyUI (Local)
          </button>
        </div>

        {/* ── Gemini Settings ────────────────────────────────────────── */}
        {activeBackend === 'gemini' && (
          <>
            <span className="label">Google API Key</span>
            <div className="relative mb-5">
              <input
                type={showKey ? 'text' : 'password'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Enter your Gemini API key..."
                className="input-field !pr-10"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 icon-btn !p-1.5"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </>
        )}

        {/* ── ComfyUI Settings ───────────────────────────────────────── */}
        {activeBackend === 'comfyui' && (
          <>
            <div className="flex gap-2 mb-3">
              <div className="flex-1">
                <span className="label">Host</span>
                <input
                  type="text"
                  value={comfyHost}
                  onChange={(e) => setComfyHost(e.target.value)}
                  placeholder="127.0.0.1"
                  className="input-field"
                />
              </div>
              <div className="w-24">
                <span className="label">Port</span>
                <input
                  type="text"
                  value={comfyPort}
                  onChange={(e) => setComfyPort(e.target.value)}
                  placeholder="8188"
                  className="input-field"
                />
              </div>
            </div>

            {/* RTX VSR Toggle */}
            <div className={`flex items-start gap-2.5 mb-4 p-3 rounded-xl border transition-all ${
              rtxDetected
                ? 'bg-white/[0.02] border-white/[0.04] hover:bg-white/[0.04]'
                : 'bg-white/[0.01] border-white/[0.01] opacity-50'
            }`}>
              <input
                id="rtxUpscaleToggle"
                type="checkbox"
                disabled={!rtxDetected}
                checked={rtxUpscale && !!rtxDetected}
                onChange={(e) => setRtxUpscale(e.target.checked)}
                className={`mt-1 rounded border-gray-600 focus:ring-[#d4a017]/30 bg-transparent w-4 h-4 text-amber-500 ${
                  rtxDetected ? 'text-[#d4a017] cursor-pointer' : 'text-gray-500 cursor-not-allowed'
                }`}
              />
              <label htmlFor="rtxUpscaleToggle" className={`flex flex-col select-none ${rtxDetected ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                  NVIDIA RTX Video Super Resolution (VSR)
                </span>
                <span className="text-[10px] text-[var(--text-secondary)] opacity-70 mt-0.5 leading-relaxed">
                  {rtxDetected === null 
                    ? 'Please run "Test Connection" to check if local ComfyUI RTX VSR node is available.' 
                    : rtxDetected 
                      ? 'Accelerates upscaling via RTX Tensor Cores. (Node detected!)' 
                      : 'Accelerates upscaling via RTX Tensor Cores. (RTX node not found in your ComfyUI installation).'
                  }
                </span>
              </label>
            </div>

            {/* RTX VSR Scale */}
            {(() => {
              const rtxActive = rtxUpscale && !!rtxDetected;
              return (
                <div className={`flex items-center justify-between gap-2.5 mb-4 px-3 py-2.5 rounded-xl border transition-all ${
                  rtxActive
                    ? 'bg-white/[0.02] border-white/[0.04]'
                    : 'bg-white/[0.01] border-white/[0.01] opacity-50'
                }`}>
                  <div className="flex flex-col select-none">
                    <span className="text-[12px] font-medium text-[var(--text-secondary)]">Upscale factor</span>
                    <span className="text-[10px] text-[var(--text-secondary)] opacity-70 mt-0.5 leading-relaxed">
                      Higher factors take longer &amp; use more VRAM. Quality is locked to HIGH.
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {RTX_SCALE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={!rtxActive}
                        onClick={() => setRtxUpscaleScale(opt.value)}
                        className={`px-2.5 py-1 rounded-lg text-[12px] font-medium transition-all ${
                          rtxUpscaleScale === opt.value
                            ? 'bg-[#d4a017]/20 text-[#d4a017] border border-[#d4a017]/40'
                            : 'bg-white/[0.03] text-[var(--text-secondary)] border border-white/[0.04] hover:bg-white/[0.06]'
                        } ${rtxActive ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Test Connection */}
            <button
              onClick={handleTestConnection}
              disabled={comfyStatus === 'testing'}
              className="btn-secondary w-full flex items-center justify-center gap-2 py-2.5 text-[12px] mb-2"
            >
              {comfyStatus === 'testing' ? (
                <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full" />
              ) : comfyStatus === 'connected' ? (
                <Wifi size={13} className="text-green-400" />
              ) : comfyStatus === 'error' ? (
                <WifiOff size={13} className="text-red-400" />
              ) : (
                <Wifi size={13} />
              )}
              {comfyStatus === 'testing' ? 'Testing...' : 'Test Connection'}
            </button>

            {comfyStatusMessage && (
              <p className={`text-[11px] mb-3 px-1 ${
                comfyStatus === 'connected' ? 'text-green-400' :
                comfyStatus === 'error' ? 'text-red-400' :
                'text-[var(--text-secondary)]'
              }`}>
                {comfyStatusMessage}
              </p>
            )}

            {/* Workflow */}
            <div className="flex gap-2 mb-5">
              <button
                onClick={() => workflowInputRef.current?.click()}
                className="btn-secondary flex-1 flex items-center justify-center gap-2 py-2.5 text-[12px]"
              >
                <Upload size={13} />
                {hasWorkflow ? 'Replace Workflow' : 'Upload Workflow'}
              </button>
              {hasWorkflow && (
                <button
                  onClick={handleClearWorkflow}
                  className="btn-secondary flex items-center justify-center gap-2 py-2.5 px-3 text-[12px]"
                  title="Reset to default workflow"
                >
                  <X size={13} />
                </button>
              )}
              <input ref={workflowInputRef} type="file" accept=".json" onChange={handleWorkflowUpload} className="hidden" />
            </div>

            {hasWorkflow ? (
              <p className="text-[11px] text-[var(--text-secondary)] mb-4 px-1">
                Using custom workflow {workflowFileName ? `(${workflowFileName})` : ''}
              </p>
            ) : (
              <p className="text-[11px] text-[var(--text-secondary)] mb-4 px-1">Using default Z-Image-Turbo workflow</p>
            )}
          </>
        )}

        <button onClick={handleSave} className="btn-primary w-full py-2.5 text-[13px] mb-6">
          Save
        </button>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }} className="pt-5 space-y-3">

          {/* Import/Export */}
          <div className="flex gap-2">
            <button onClick={handleExport} className="btn-secondary flex-1 flex items-center justify-center gap-2 py-2.5 text-[12px]">
              <Download size={13} />
              Export
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="btn-secondary flex-1 flex items-center justify-center gap-2 py-2.5 text-[12px]">
              <Upload size={13} />
              Import
            </button>
            <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} className="hidden" />
          </div>

          {/* Clear History */}
          <button
            onClick={handleClearHistory}
            className={`w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-[12px] transition-all ${
              confirmClear
                ? 'bg-red-500/15 border border-red-500/20 text-red-400'
                : 'btn-secondary'
            }`}
          >
            <Trash2 size={13} />
            {confirmClear ? 'Click again to confirm' : 'Clear History'}
          </button>
        </div>
      </div>
    </div>
  );
}
