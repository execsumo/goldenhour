import { useState, useEffect, useCallback, useRef } from 'react';
import { Settings, PanelLeftOpen, PanelLeftClose, Sun, Moon, Download, Cloud, Monitor } from 'lucide-react';
import {
  Resolution,
  AspectRatio,
  BackendType,
  ClipCategory,
  Clip,
  GenerationSettings,
  GenerationRecord,
  HistoryEntry,
  SessionStats,
  COST_PER_IMAGE,
  BATCH_COST_CONFIRM_THRESHOLD,
  ComfyUISampler,
  COMFYUI_SAMPLER_OPTIONS,
  ComfyProgress,
  QueueItem,
  PromptMode,
  QueueItemStatus,
} from './types';
import { getApiKey, getBackend, setBackend, getResolution, setResolution, getAspectRatio, setAspectRatio, getAutoUpscale, setAutoUpscale, getClips, addClip as addClipToStorage, removeClip as removeClipFromStorage, getComfySteps, setComfySteps, getComfySampler, setComfySampler, getComfyUIConfig, getComfyLora, setComfyLora, getComfyLoraStrength, setComfyLoraStrength, getComfyCfg, setComfyCfg, getComfyDiffusionModel, setComfyDiffusionModel, getComfyClipModel, setComfyClipModel, getComfySeedMode, setComfySeedMode, getComfySeed, setComfySeed, clampSeed, getRemixRestore, getComfyModelProfileOverrides, setComfyModelProfileOverride } from './utils/settings';
import { resolveModelProfile } from './config';
import { generateImageWithBackend, backendSupportsFeature } from './utils/backendProvider';
import { initStorage, saveGeneration, setUpscaled, getAllHistoryEntries, getImageBlob, getReferenceBlob, deleteGeneration, clearAllGenerations, sweepOrphanBlobs, describeStorageError } from './utils/storage';
import { createThumbnailDataUrl, embedMetadataInPngBlob } from './utils/metadata';
import { cropReferenceImage, upscaleImage } from './utils/image';
import { downloadBlob } from './utils/blob';
import { comfyuiUpscaleImageRTX, comfyuiGetLoras, comfyuiGetDiffusionModels, comfyuiGetClipModels, comfyuiGetVaes } from './utils/comfyui';
import SettingsModal from './components/SettingsModal';
import PromptWorkspace from './components/PromptWorkspace';
import GenerationDisplay from './components/GenerationDisplay';
import HistoryDrawer from './components/HistoryDrawer';
import Toast from './components/Toast';
import QueuePanel from './components/QueuePanel';
import { parsePromptList, applyClipModifiers, estimateBatchCost, MAX_BATCH_PROMPTS } from './utils/batch';

function App() {
  // ─── State ──────────────────────────────────────────────────────────────
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [activeBackend, setActiveBackend] = useState<BackendType>(() => getBackend());
  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem('goldenHour_theme') || localStorage.getItem('nanoBanana_theme');
    return stored ? stored === 'dark' : true;
  });

  const [prompt, setPrompt] = useState('');
  const [numberOfImages, setNumberOfImages] = useState(1);
  const [resolution, setResolution_] = useState<Resolution>(() => getResolution() as Resolution);
  const [aspectRatio, setAspectRatio_] = useState<AspectRatio>(() => getAspectRatio() as AspectRatio);
  const [refImage, setRefImage] = useState<Blob | null>(null);
  const [refCropArea, setRefCropArea] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [comfyProgress, setComfyProgress] = useState<ComfyProgress | null>(null);
  const [currentImages, setCurrentImages] = useState<Blob[]>([]);
  const [currentUpscaledImages, setCurrentUpscaledImages] = useState<(Blob | undefined)[]>([]);
  const [currentUpscaleScales, setCurrentUpscaleScales] = useState<(number | undefined)[]>([]);
  // Record ids positionally aligned with currentImages, so the Output panel's
  // Upscale button can find its record without comparing base64 strings.
  const [currentRecordIds, setCurrentRecordIds] = useState<string[]>([]);
  const [currentSettings, setCurrentSettings] = useState<GenerationSettings | null>(null);
  const [canUpscale, setCanUpscale] = useState(false);
  const [autoUpscale, setAutoUpscale_] = useState(() => getAutoUpscale());

  const [comfySteps, setComfySteps_] = useState(() => getComfySteps());
  const [comfySampler, setComfySampler_] = useState<ComfyUISampler>(() => getComfySampler());
  const [comfyLora, setComfyLora_] = useState(() => getComfyLora());
  const [comfyLoraStrength, setComfyLoraStrength_] = useState(() => getComfyLoraStrength());
  const [comfyCfg, setComfyCfg_] = useState(() => getComfyCfg());
  const [comfyDiffusionModel, setComfyDiffusionModel_] = useState(() => getComfyDiffusionModel());
  // Tracks which ModelProfile family is active so steps/cfg/sampler edits get
  // remembered per family (see applyModelProfileDefaults below).
  const activeProfileIdRef = useRef<string | null>(resolveModelProfile(getComfyDiffusionModel())?.id ?? null);
  const [comfyClipModel, setComfyClipModel_] = useState(() => getComfyClipModel());
  const [comfySeedMode, setComfySeedMode_] = useState<'random' | 'fixed'>(() => getComfySeedMode());
  const [comfySeed, setComfySeed_] = useState<number>(() => getComfySeed());
  const [lastUsedSeed, setLastUsedSeed] = useState<number | null>(null);
  // Held in state rather than read per render. getComfyUIConfig() is a
  // localStorage read plus a JSON.parse, and this used to sit in the render body
  // where it ran on every single render of App. Refreshed when Settings closes,
  // which is the only place the config is written.
  const [comfyConfig, setComfyConfig] = useState(() => getComfyUIConfig());
  const [availableLoras, setAvailableLoras] = useState<string[]>([]);
  const [availableDiffusionModels, setAvailableDiffusionModels] = useState<string[]>([]);
  const [availableClipModels, setAvailableClipModels] = useState<string[]>([]);
  const [availableVaes, setAvailableVaes] = useState<string[]>([]);

  // Metadata + thumbnails only. Full-size images stay in IndexedDB and are
  // fetched per record on demand -- see HistoryEntry in types.ts.
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // Non-null only while the one-shot base64 -> Blob conversion is running.
  const [migration, setMigration] = useState<{ done: number; total: number } | null>(null);
  const [session, setSession] = useState<SessionStats>({ totalCost: 0, imageCount: 0 });

  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'error' | 'success' | 'info'>('info');
  const [toastVisible, setToastVisible] = useState(false);

  // Clip system
  const [activeClipIds, setActiveClipIds] = useState<Set<string>>(new Set());
  const [allClips, setAllClips] = useState<Record<ClipCategory, Clip[]>>(() => getClips());

  const lastSettingsRef = useRef<GenerationSettings | null>(null);
  const hasGenerated = useRef(false);
  const queueRef = useRef<QueueItem[]>([]);
  const isProcessingQueueRef = useRef(false);
  const runningAbortControllerRef = useRef<AbortController | null>(null);
  const [queueCount, setQueueCount] = useState(0);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);

  const [promptMode, setPromptMode] = useState<PromptMode>('single');
  const [batchText, setBatchText] = useState('');

  // beforeunload protection
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasActive = queueRef.current.some(i => i.status === 'pending' || i.status === 'running');
      if (hasActive) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // sync state with queueRef changes
  const syncQueue = useCallback(() => {
    setQueueItems([...queueRef.current]);
    setQueueCount(queueRef.current.filter(i => i.status === 'pending').length);
  }, []);

  useEffect(() => {
    setHasApiKey(!!getApiKey());
    loadHistory();
    // Apply initial theme
    if (darkMode) {
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
    }
  }, []);

  // Resolves the model family for `modelName`, then either restores that
  // family's remembered steps/cfg/sampler/CLIP model (if it's been selected
  // before in this browser) or seeds them from the family's defaults on
  // first use. Either way, the seed/restored values are written back so
  // later edits via handleComfy{Steps,Cfg,Sampler,ClipModel}Change have
  // something to merge into.
  const applyModelProfileDefaults = useCallback((modelName: string, installedClipModels: string[] = []) => {
    const profile = resolveModelProfile(modelName);
    activeProfileIdRef.current = profile?.id ?? null;
    if (!profile) return;

    const overrides = getComfyModelProfileOverrides();
    // Only seed the family's suggested CLIP file when it's actually
    // installed -- unlike VAE, multiple quantizations of the same encoder
    // are commonly installed side by side, so this is a suggestion, not a
    // forced pick.
    const seedClipModel = profile.defaultClipModel
      && (installedClipModels.length === 0 || installedClipModels.includes(profile.defaultClipModel))
      ? profile.defaultClipModel
      : undefined;
    const values = overrides[profile.id] ?? {
      steps: profile.defaultSteps,
      cfg: profile.defaultCfg,
      sampler: profile.defaultSampler,
      clipModel: seedClipModel,
    };
    setComfyModelProfileOverride(profile.id, values);

    if (values.steps !== undefined) {
      setComfySteps_(values.steps);
      setComfySteps(values.steps);
    }
    if (values.cfg !== undefined) {
      setComfyCfg_(values.cfg);
      setComfyCfg(values.cfg);
    }
    if (values.sampler !== undefined) {
      setComfySampler_(values.sampler);
      setComfySampler(values.sampler);
    }
    if (values.clipModel !== undefined
      && (installedClipModels.length === 0 || installedClipModels.includes(values.clipModel))) {
      setComfyClipModel_(values.clipModel);
      setComfyClipModel(values.clipModel);
    }
  }, []);

  const fetchComfyAssets = useCallback(async () => {
    const config = getComfyUIConfig();
    try {
      const [loras, diffModels, clipModels, vaes] = await Promise.all([
        comfyuiGetLoras(config),
        comfyuiGetDiffusionModels(config),
        comfyuiGetClipModels(config),
        comfyuiGetVaes(config),
      ]);

      if (vaes.length > 0) {
        // Not user-selectable -- kept only so generation requests can tell the
        // backend which VAEs are installed, for ModelProfile auto-selection.
        setAvailableVaes(vaes);
      }

      if (clipModels.length > 0) {
        setAvailableClipModels(clipModels);
        const storedClip = getComfyClipModel();
        let nextClip = storedClip;
        if (storedClip === 'none' || !clipModels.includes(storedClip)) {
          if (clipModels.includes('qwen_3_4b.safetensors')) {
            nextClip = 'qwen_3_4b.safetensors';
          } else {
            nextClip = clipModels[0];
          }
        }
        if (nextClip !== storedClip) {
          setComfyClipModel_(nextClip);
          setComfyClipModel(nextClip);
        }
      }

      if (diffModels.length > 0) {
        setAvailableDiffusionModels(diffModels);
        const storedDiff = getComfyDiffusionModel();
        let nextDiff = storedDiff;
        if (storedDiff === 'none' || !diffModels.includes(storedDiff)) {
          if (diffModels.includes('z_image_turbo_bf16.safetensors')) {
            nextDiff = 'z_image_turbo_bf16.safetensors';
          } else {
            nextDiff = diffModels[0];
          }
        }
        if (nextDiff !== storedDiff) {
          setComfyDiffusionModel_(nextDiff);
          setComfyDiffusionModel(nextDiff);
        }
        // Runs after the CLIP fallback above so a family-specific default
        // (if installed) wins over the generic qwen_3_4b.safetensors pick.
        applyModelProfileDefaults(nextDiff, clipModels);
      }

      if (loras.length > 0) {
        setAvailableLoras(loras);
      }
    } catch (err) {
      console.error('Failed to fetch ComfyUI assets:', err);
    }
  }, [applyModelProfileDefaults]);

  useEffect(() => {
    if (activeBackend === 'comfyui') {
      fetchComfyAssets();
    }
  }, [activeBackend, fetchComfyAssets]);

  const handleAutoUpscaleChange = useCallback((v: boolean) => {
    setAutoUpscale_(v);
    setAutoUpscale(v);
  }, []);

  const toggleTheme = useCallback(() => {
    setDarkMode((prev) => {
      const next = !prev;
      localStorage.setItem('goldenHour_theme', next ? 'dark' : 'light');
      if (next) {
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.add('light');
      }
      return next;
    });
  }, []);

  const handleResolutionChange = useCallback((v: Resolution) => {
    setResolution_(v);
    setResolution(v);
  }, []);

  const handleAspectRatioChange = useCallback((v: AspectRatio) => {
    setAspectRatio_(v);
    setAspectRatio(v);
  }, []);

  const handleComfyStepsChange = useCallback((v: number) => {
    setComfySteps_(v);
    setComfySteps(v);
    if (activeProfileIdRef.current) setComfyModelProfileOverride(activeProfileIdRef.current, { steps: v });
  }, []);

  const handleComfySamplerChange = useCallback((v: ComfyUISampler) => {
    setComfySampler_(v);
    setComfySampler(v);
    if (activeProfileIdRef.current) setComfyModelProfileOverride(activeProfileIdRef.current, { sampler: v });
  }, []);

  const handleComfyLoraChange = useCallback((v: string) => {
    setComfyLora_(v);
    setComfyLora(v);
  }, []);

  const handleComfyLoraStrengthChange = useCallback((v: number) => {
    setComfyLoraStrength_(v);
    setComfyLoraStrength(v);
  }, []);

  const handleComfyCfgChange = useCallback((v: number) => {
    setComfyCfg_(v);
    setComfyCfg(v);
    if (activeProfileIdRef.current) setComfyModelProfileOverride(activeProfileIdRef.current, { cfg: v });
  }, []);

  const handleComfyDiffusionModelChange = useCallback((v: string) => {
    setComfyDiffusionModel_(v);
    setComfyDiffusionModel(v);
    applyModelProfileDefaults(v, availableClipModels);
  }, [applyModelProfileDefaults, availableClipModels]);

  const handleComfyClipModelChange = useCallback((v: string) => {
    setComfyClipModel_(v);
    setComfyClipModel(v);
    if (activeProfileIdRef.current) setComfyModelProfileOverride(activeProfileIdRef.current, { clipModel: v });
  }, []);

  const handleComfySeedModeChange = useCallback((v: 'random' | 'fixed') => {
    setComfySeedMode_(v);
    setComfySeedMode(v);
  }, []);

  const handleComfySeedChange = useCallback((v: number) => {
    const clamped = clampSeed(v);
    setComfySeed_(clamped);
    setComfySeed(clamped);
  }, []);

  const loadHistory = async () => {
    // initStorage runs the legacy import and the one-shot Blob migration, and is
    // memoized -- every other storage call awaits the same promise, so nothing
    // can race it.
    const result = await initStorage((done, total) => setMigration({ done, total }));
    setMigration(null);

    if (result.status === 'completed' && result.converted > 0) {
      if (result.dropped > 0) {
        showToast(
          `History upgraded: ${result.converted} records, ${result.dropped} unreadable and removed`,
          'info'
        );
      } else {
        showToast(`History upgraded (${result.converted} records)`, 'success');
      }
    } else if (result.status === 'aborted') {
      showToast(
        `History upgrade paused (${result.reason}). ${result.converted} done — it resumes next launch.`,
        'error'
      );
    }

    const entries = await getAllHistoryEntries();
    setHistory(entries);
    const latestWithSeed = entries.find((e) => e.settings?.seed !== undefined);
    if (latestWithSeed?.settings?.seed !== undefined) {
      setLastUsedSeed(latestWithSeed.settings.seed);
    }
    // Reclaim payload keys left behind by an interrupted delete. Best effort.
    sweepOrphanBlobs().catch(() => {});
  };

  const showToast = useCallback((message: string, type: 'error' | 'success' | 'info' = 'info') => {
    setToastMessage(message);
    setToastType(type);
    setToastVisible(true);
  }, []);

  // Stable identity matters here: Toast's auto-dismiss effect depends on
  // onDismiss, so an inline arrow restarted the 5s timer on every App render and
  // the toast could hang around indefinitely.
  const hideToast = useCallback(() => setToastVisible(false), []);

  const handleBackendChange = useCallback((b: BackendType) => {
    setActiveBackend(b);
    setBackend(b);
  }, []);

  // Declared before the callbacks that list it as a dependency -- a `const` read
  // in a dep array is evaluated during render, not deferred like the body.
  const upscaleScale = (activeBackend === 'comfyui' && comfyConfig.rtxUpscale)
    ? (comfyConfig.rtxUpscaleScale ?? 2)
    : 2;

  const performUpscale = useCallback(async (image: Blob): Promise<{ blob: Blob; mechanism: string; scale: number } | null> => {
    if (activeBackend === 'comfyui' && comfyConfig.rtxUpscale) {
      try {
        const scale = comfyConfig.rtxUpscaleScale ?? 2;
        showToast(`Upscaling ${scale}× with NVIDIA RTX Video Super Resolution (VSR)...`, 'info');
        const upscaled = await comfyuiUpscaleImageRTX(comfyConfig, image, scale);
        return { blob: upscaled, mechanism: `NVIDIA RTX VSR (${scale}×)`, scale };
      } catch (err: any) {
        showToast(`RTX VSR Failed: ${err.message || err}. Falling back to browser scaling.`, 'error');
      }
    }
    // Fallback to browser canvas
    const upscaled = await upscaleImage(image, 2);
    return upscaled ? { blob: upscaled, mechanism: 'Browser Canvas', scale: 2 } : null;
  }, [activeBackend, comfyConfig, showToast]);

  const processQueue = useCallback(async () => {
    if (isProcessingQueueRef.current) return;
    isProcessingQueueRef.current = true;
    setIsGenerating(true);

    let drainBatchIds = new Set<string>();
    let drainFailed = 0;
    let drainDone = 0;
    let drainImageFailures = 0;
    let drainFirstImageFailure = '';

    try {
      while (true) {
        const itemIndex = queueRef.current.findIndex(i => i.status === 'pending');
        if (itemIndex === -1) break;

        const item = queueRef.current[itemIndex];
        item.status = 'running';
        const controller = new AbortController();
        runningAbortControllerRef.current = controller;
        syncQueue();

        const settings = item.settings;
        lastSettingsRef.current = settings;

        const onProgress = (p: ComfyProgress) => {
          setComfyProgress(p);
          let percent: number | undefined;
          if (p.phase === 'queued') {
            percent = 0;
          } else if (p.phase === 'finishing') {
            percent = 100;
          } else if (p.step !== undefined && p.maxSteps !== undefined && p.maxSteps > 0) {
            percent = Math.round((p.step / p.maxSteps) * 100);
          }
          item.progress = percent;
          syncQueue();
        };

        try {
          const result = await generateImageWithBackend(settings, controller.signal, { onProgress });
          if (runningAbortControllerRef.current === controller) runningAbortControllerRef.current = null;
          setComfyProgress(null);
          item.progress = undefined;

          const savedSettings: GenerationSettings = { ...settings };
          if (result.comfyVae !== undefined) savedSettings.comfyVae = result.comfyVae;
          else if (settings.backend === 'comfyui') delete savedSettings.comfyVae;
          delete savedSettings.comfyAvailableVaes;
          if (result.seed !== undefined) {
            savedSettings.seed = result.seed;
            setLastUsedSeed(result.seed);
          }
          lastSettingsRef.current = savedSettings;

          const newRecords: GenerationRecord[] = [];
          const newImages: Blob[] = [];

          for (const image of result.images) {
            const record: GenerationRecord = {
              id: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              timestamp: new Date().toISOString(),
              settings: savedSettings,
              image,
              thumbnailDataUrl: await createThumbnailDataUrl(image),
              backend: settings.backend,
            };
            newRecords.push(record);
            newImages.push(image);
          }

          // A successful generation stays visible even when the browser cannot
          // persist one of its records (for example, after storage quota is full).
          const newEntries: HistoryEntry[] = [];
          const savedRecordIds = new Array(newRecords.length).fill('');
          for (let i = 0; i < newRecords.length; i++) {
            try {
              newEntries.push(await saveGeneration(newRecords[i]));
              savedRecordIds[i] = newRecords[i].id;
            } catch (saveErr) {
              showToast(`Couldn't save to history: ${describeStorageError(saveErr)}`, 'error');
            }
          }

          setCurrentImages(newImages);
          setCurrentRecordIds(savedRecordIds);
          setCurrentSettings(savedSettings);
          const isUpscalable = ['512', '1k', '2k'].includes(settings.resolution);
          setCanUpscale(isUpscalable);
          // Newest-first for the drawer. Reverse a copy -- reversing newEntries in
          // place mutates the array about to be spread.
          const historyOrder = [...newEntries].reverse();
          setHistory((prev) => [...historyOrder, ...prev]);
          hasGenerated.current = true;

          item.status = 'done';
          item.thumbnailDataUrl = newRecords[0]?.thumbnailDataUrl;
          if (item.batchId) {
            drainDone++;
            drainBatchIds.add(item.batchId);
          }
          syncQueue();

          // Stopping a multi-image Gemini run keeps whatever already finished; the
          // requests the user cancelled are not failures worth reporting.
          if (controller.signal.aborted) {
            showToast(`Stopped — kept ${result.images.length}/${settings.numberOfImages}`, 'info');
          } else if (result.failures?.length) {
            if (item.batchId) {
              drainImageFailures += result.failures.length;
              drainFirstImageFailure ||= result.failures[0];
            } else {
              showToast(
                `Generated ${result.images.length}/${settings.numberOfImages} — ${result.failures.length} failed: ${result.failures[0]}`,
                'error'
              );
            }
          }
          // Auto-upscale if enabled and resolution qualifies
          // Always run as a separate step after generation (not in-graph)
          if (autoUpscale && isUpscalable) {
            const upscaledResults: (Blob | undefined)[] = [];
            const upscaleScales: (number | undefined)[] = [];
            const updatedEntries = new Map<string, HistoryEntry>();

            for (let i = 0; i < newImages.length; i++) {
              try {
                const upscaledObj = await performUpscale(newImages[i]);
                upscaledResults.push(upscaledObj?.blob);
                upscaleScales.push(upscaledObj?.scale);

                if (upscaledObj && savedRecordIds[i]) {
                  // Persist the upscaled version to the record
                  const entry = await setUpscaled(savedRecordIds[i], upscaledObj.blob, upscaledObj.mechanism, upscaledObj.scale);
                  if (entry) updatedEntries.set(entry.id, entry);
                }
              } catch (upscaleErr: any) {
                console.error('Auto-upscale failed for image', i, upscaleErr);
                upscaledResults.push(undefined);
                upscaleScales.push(undefined);
              }
            }
            // One update for the whole batch. This used to fire a separate
            // update per image, making the drawer flicker and drop records
            // because React would batch the state updates and only see the
            // last one.
            if (updatedEntries.size > 0) {
              setHistory((prev) => prev.map((r) => updatedEntries.get(r.id) ?? r));
            }
            setCurrentUpscaledImages(upscaledResults);
            setCurrentUpscaleScales(upscaleScales);
          } else {
            setCurrentUpscaledImages(new Array(newImages.length).fill(undefined));
            setCurrentUpscaleScales(new Array(newImages.length).fill(undefined));
          }
          if (result.warnings?.length) showToast(result.warnings.join(' '), 'info');

          // Only track cost for Gemini backend (ComfyUI is free/local)
          if (settings.backend === 'gemini') {
            const resKey = settings.resolution as Resolution;
            const cost = (COST_PER_IMAGE[resKey]?.cost || 0) * result.images.length;
            setSession((prev) => ({
              totalCost: prev.totalCost + cost,
              imageCount: prev.imageCount + result.images.length,
            }));
          } else {
            setSession((prev) => ({
              ...prev,
              imageCount: prev.imageCount + result.images.length,
            }));
          }
        } catch (err: any) {
          if (runningAbortControllerRef.current === controller) runningAbortControllerRef.current = null;
          setComfyProgress(null);
          item.progress = undefined;
          const cancelled = controller.signal.aborted || err?.name === 'AbortError';
          item.status = cancelled ? 'cancelled' : 'failed';
          item.error = cancelled ? undefined : (err.message || 'Generation failed');
          if (item.batchId && !cancelled) {
            drainFailed++;
            drainBatchIds.add(item.batchId);
          }
          syncQueue();

          if (!cancelled && !item.batchId) {
            showToast(err.message || 'Generation failed', 'error');
          }
        }
      }
    } finally {
      if (drainBatchIds.size > 0) {
        if (drainFailed === 0 && drainImageFailures === 0) {
          showToast(`Batch finished: ${drainDone} done, 0 failed`, 'success');
        } else {
          const failureCount = drainFailed + drainImageFailures;
          const detail = drainFirstImageFailure ? `: ${drainFirstImageFailure}` : '';
          showToast(`Batch finished: ${drainDone} done, ${failureCount} failed${detail}`, 'error');
        }
      }

      // Must run on every path. Leaving these set pins the UI in its generating
      // state forever, preventing the user from trying again.
      setComfyProgress(null);
      isProcessingQueueRef.current = false;
      setIsGenerating(false);
      setQueueCount(0);
    }
  }, [autoUpscale, performUpscale, showToast, syncQueue]);

  const buildBaseSettings = useCallback(async (): Promise<GenerationSettings | null> => {
    // Safe to click -- every storage call awaits the migration -- but a 10 MB
    // payload chokes IndexedDB if written mid-migration. Better to pause the button.
    if (migration) {
      showToast('History upgrade in progress — one moment', 'info');
      return null;
    }
    // Only require API key for Gemini backend
    if (activeBackend === 'gemini') {
      const apiKey = getApiKey();
      if (!apiKey) {
        showToast('Please set your API key in Settings first', 'error');
        setSettingsOpen(true);
        return null;
      }
    }
    const base: GenerationSettings = {
      prompt: '',
      numberOfImages,
      resolution,
      aspectRatio,
      referenceImage: null,
      referenceCrop: refCropArea,
      autoUpscale,
      backend: activeBackend,
      comfySteps,
      comfySampler,
      comfyLora,
      comfyLoraStrength,
      comfyCfg,
      comfyDiffusionModel,
      comfyClipModel,
      comfyAvailableVaes: availableVaes,
      comfySeedMode,
      comfySeed,
    };
    if (refImage) {
      try {
        base.referenceImage = await cropReferenceImage(refImage, refCropArea);
      } catch (e) {
        showToast('Failed to process reference image', 'error');
        return null;
      }
    }
    return base;
  }, [migration, activeBackend, numberOfImages, resolution, aspectRatio, refImage, refCropArea, autoUpscale, comfySteps, comfySampler, comfyLora, comfyLoraStrength, comfyCfg, comfyDiffusionModel, comfyClipModel, availableVaes, comfySeedMode, comfySeed, showToast]);

  const enqueue = useCallback((prompts: string[], baseSettings: GenerationSettings, batchId?: string) => {
    prompts.forEach((p) => {
      queueRef.current.push({
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        batchId,
        settings: { ...baseSettings, prompt: p, batchId },
        status: 'pending'
      });
    });
    syncQueue();
    processQueue();
  }, [syncQueue, processQueue]);

  const handleGenerate = useCallback(async (overrideSettings?: GenerationSettings) => {
    if (overrideSettings) {
      if (migration) {
        showToast('History upgrade in progress — one moment', 'info');
        return;
      }
      const settings = { ...overrideSettings };
      if (!settings.backend) settings.backend = activeBackend;
      queueRef.current.push({
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        settings,
        status: 'pending'
      });
      syncQueue();
      processQueue();
      return;
    }

    if (!prompt.trim()) {
      showToast('Please enter a prompt', 'error');
      return;
    }

    const base = await buildBaseSettings();
    if (!base) return;

    enqueue([prompt], base);
  }, [migration, activeBackend, prompt, buildBaseSettings, enqueue, showToast, syncQueue, processQueue]);

  const handleGenerateBatch = useCallback(async () => {
    const prompts = parsePromptList(batchText);
    if (prompts.length === 0) {
      showToast('Please enter at least one prompt', 'error');
      return;
    }
    if (prompts.length > MAX_BATCH_PROMPTS) {
      showToast(`Too many prompts (max ${MAX_BATCH_PROMPTS})`, 'error');
      return;
    }

    const activeModifiers = Array.from(activeClipIds).map(id => {
      for (const cat of Object.values(allClips)) {
        const c = cat.find(x => x.id === id);
        if (c) return c.modifier;
      }
      return '';
    }).filter(Boolean);

    const modifiedPrompts = prompts.map(p => applyClipModifiers(p, activeModifiers));

    if (activeBackend === 'gemini') {
      const resKey = resolution as Resolution;
      const costPerImage = COST_PER_IMAGE[resKey]?.cost || 0;
      const cost = estimateBatchCost(modifiedPrompts.length, numberOfImages, costPerImage);

      if (cost > BATCH_COST_CONFIRM_THRESHOLD) {
        if (!window.confirm(`Queue ${modifiedPrompts.length} prompts (~$${cost.toFixed(2)})?`)) {
          return;
        }
      }
    }

    const base = await buildBaseSettings();
    if (!base) return;

    enqueue(modifiedPrompts, base, `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  }, [batchText, activeClipIds, allClips, activeBackend, resolution, numberOfImages, buildBaseSettings, enqueue, showToast]);

  const removeQueueItem = useCallback((id: string) => {
    queueRef.current = queueRef.current.filter(i => i.id !== id || i.status !== 'pending');
    syncQueue();
  }, [syncQueue]);

  const clearQueue = useCallback(() => {
    queueRef.current = queueRef.current.filter(i => i.status === 'running');
    syncQueue();
  }, [syncQueue]);

  const cancelRunning = useCallback(() => {
    runningAbortControllerRef.current?.abort();
  }, []);

  const retryFailed = useCallback(() => {
    const failedItems = queueRef.current.filter(i => i.status === 'failed');
    if (failedItems.length === 0) return;

    queueRef.current = queueRef.current.filter(i => i.status !== 'failed');

    failedItems.forEach(item => {
      queueRef.current.push({
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        batchId: item.batchId,
        settings: { ...item.settings },
        status: 'pending'
      });
    });

    syncQueue();
    processQueue();
  }, [syncQueue, processQueue]);

  const handleRerun = useCallback(() => {
    if (lastSettingsRef.current) handleGenerate(lastSettingsRef.current);
  }, [handleGenerate]);

  const handleNew = useCallback(() => {
    setPrompt('');
    setNumberOfImages(1);
    setResolution_('512');
    setResolution('512');
    setAspectRatio_('9:16');
    setAspectRatio('9:16');
    setRefImage(null);
    setRefCropArea(null);
    setCurrentImages([]);
    setCurrentUpscaledImages([]);
    setCurrentUpscaleScales([]);
    setCurrentRecordIds([]);
    setCurrentSettings(null);
    setCanUpscale(false);
    setActiveClipIds(new Set());
  }, []);

  const handleUpscale = useCallback(async (index: number) => {
    const source = currentImages[index];
    if (!source) return;
    const upscaledObj = await performUpscale(source);
    if (!upscaledObj) return;

    // Update local display state
    setCurrentUpscaledImages((prev) => {
      const next = [...prev];
      next[index] = upscaledObj.blob;
      return next;
    });
    setCurrentUpscaleScales((prev) => {
      const next = [...prev];
      next[index] = upscaledObj.scale;
      return next;
    });

    // Persist to the matching record. Matched by id -- history carries no image
    // payload to compare against, and comparing multi-megabyte strings was never
    // a good idea anyway.
    const recordId = currentRecordIds[index];
    if (!recordId) return;
    const entry = await setUpscaled(recordId, upscaledObj.blob, upscaledObj.mechanism, upscaledObj.scale);
    if (entry) setHistory((prev) => prev.map((r) => (r.id === entry.id ? entry : r)));
  }, [currentImages, currentRecordIds, performUpscale]);

  const handleUpscaleRecord = useCallback(async (recordId: string) => {
    const source = await getImageBlob(recordId);
    if (!source) return;
    const upscaledObj = await performUpscale(source);
    if (!upscaledObj) return;

    const entry = await setUpscaled(recordId, upscaledObj.blob, upscaledObj.mechanism, upscaledObj.scale);
    if (entry) setHistory((prev) => prev.map((r) => (r.id === recordId ? entry : r)));
  }, [performUpscale]);

  const handleReusePrompt = useCallback(async (entry: HistoryEntry) => {
    // Read at click time rather than held in state: the checklist lives in the
    // drawer and persists itself, so this always sees the current mask.
    const restore = getRemixRestore();
    const s = entry.settings;
    // Values the record names but the app can no longer honour -- a LoRA since
    // deleted from the ComfyUI host, say. Collected and reported once.
    const dropped: string[] = [];

    // Everything below the reference image is synchronous on purpose. Switching
    // backend schedules fetchComfyAssets, which reads the ComfyUI controls back
    // out of localStorage; awaiting first would let it run against the old
    // values and undo the restore.
    setPrompt(s.prompt);

    // Always restored, and first: it decides which controls are even live.
    const recordBackend = entry.backend ?? s.backend;
    if (recordBackend && recordBackend !== activeBackend) handleBackendChange(recordBackend);

    // What the controls will hold once this returns: the current values,
    // overwritten by each setting the mask actually restored. The workspace's
    // Remix replays this ref, so an unticked setting must not creep back in
    // through it after the user has deliberately excluded it.
    const applied: GenerationSettings = {
      prompt: s.prompt,
      numberOfImages,
      resolution,
      aspectRatio,
      referenceImage: null,
      referenceCrop: refCropArea,
      autoUpscale,
      backend: recordBackend ?? activeBackend,
      comfySteps,
      comfySampler,
      comfyLora,
      comfyLoraStrength,
      comfyCfg,
      comfyDiffusionModel,
      comfyClipModel,
      comfySeedMode,
      comfySeed,
    };

    if (restore.numberOfImages) {
      setNumberOfImages(s.numberOfImages || 1);
      applied.numberOfImages = s.numberOfImages || 1;
    }
    // These handlers update React state *and* persist. Calling the bare storage
    // setters here only wrote localStorage, so Remix left the controls unchanged.
    if (restore.resolution) {
      handleResolutionChange(s.resolution);
      applied.resolution = s.resolution;
    }
    if (restore.aspectRatio) {
      handleAspectRatioChange(s.aspectRatio);
      applied.aspectRatio = s.aspectRatio;
    }
    if (restore.autoUpscale && s.autoUpscale !== undefined) {
      handleAutoUpscaleChange(s.autoUpscale);
      applied.autoUpscale = s.autoUpscale;
    }

    // Model lists come from the ComfyUI host and are empty while it is
    // unreachable -- absence only means "gone" when we actually have a list.
    //
    // Restored before steps/cfg/sampler/CLIP model below: switching models
    // re-applies that family's remembered settings, and we want the explicit
    // values from this history entry to win (and become the new remembered
    // values for the family) rather than get clobbered by it.
    if (restore.comfyDiffusionModel && s.comfyDiffusionModel) {
      if (availableDiffusionModels.length === 0 || availableDiffusionModels.includes(s.comfyDiffusionModel)) {
        handleComfyDiffusionModelChange(s.comfyDiffusionModel);
        applied.comfyDiffusionModel = s.comfyDiffusionModel;
      } else {
        dropped.push('diffusion model');
      }
    }

    if (restore.comfySteps && s.comfySteps !== undefined) {
      handleComfyStepsChange(s.comfySteps);
      applied.comfySteps = s.comfySteps;
    }
    if (restore.comfyCfg && s.comfyCfg !== undefined) {
      handleComfyCfgChange(s.comfyCfg);
      applied.comfyCfg = s.comfyCfg;
    }

    // The sampler renders as chips keyed on the exact enum value, so a value
    // dropped from COMFYUI_SAMPLER_OPTIONS would light none of them.
    if (restore.comfySampler && s.comfySampler) {
      if (COMFYUI_SAMPLER_OPTIONS.some((o) => o.value === s.comfySampler)) {
        handleComfySamplerChange(s.comfySampler);
        applied.comfySampler = s.comfySampler;
      } else {
        dropped.push('sampler');
      }
    }
    if (restore.comfyClipModel && s.comfyClipModel) {
      if (availableClipModels.length === 0 || availableClipModels.includes(s.comfyClipModel)) {
        handleComfyClipModelChange(s.comfyClipModel);
        applied.comfyClipModel = s.comfyClipModel;
      } else {
        dropped.push('CLIP model');
      }
    }
    if (restore.comfyLora && s.comfyLora !== undefined) {
      const lora = s.comfyLora ?? 'none';
      if (lora === 'none' || availableLoras.length === 0 || availableLoras.includes(lora)) {
        handleComfyLoraChange(lora);
        applied.comfyLora = lora;
        if (s.comfyLoraStrength !== undefined) {
          handleComfyLoraStrengthChange(s.comfyLoraStrength);
          applied.comfyLoraStrength = s.comfyLoraStrength;
        }
      } else {
        dropped.push('LoRA');
      }
    }

    if (restore.seed && s.seed !== undefined) {
      handleComfySeedModeChange('fixed');
      handleComfySeedChange(s.seed);
      applied.comfySeedMode = 'fixed';
      applied.comfySeed = s.seed;
      applied.seed = s.seed;
    }

    if (restore.referenceImage) {
      if (s.hasReferenceImage) {
        const reference = await getReferenceBlob(entry.id);
        if (reference) {
          setRefImage(reference);
          setRefCropArea(s.referenceCrop);
          applied.referenceImage = reference;
          applied.referenceCrop = s.referenceCrop;
        } else {
          dropped.push('reference image');
        }
      } else {
        // The record had none, so neither should the workspace. Untick the row
        // to keep whatever is currently loaded.
        setRefImage(null);
        setRefCropArea(null);
      }
    } else if (refImage) {
      // Excluded, so the loaded reference stays -- but `applied` feeds a
      // regeneration, and that path always wants the cropped copy.
      try {
        applied.referenceImage = await cropReferenceImage(refImage, refCropArea);
      } catch {
        applied.referenceImage = null;
      }
    }

    // `hasReferenceImage` belongs to the stored shape and never reaches
    // `applied` -- it would round-trip into the next saved record.
    lastSettingsRef.current = applied;
    hasGenerated.current = true;

    if (dropped.length > 0) {
      showToast(`Remixed, but couldn't restore: ${dropped.join(', ')}`, 'info');
    }
  }, [
    activeBackend,
    numberOfImages,
    resolution,
    aspectRatio,
    refImage,
    refCropArea,
    autoUpscale,
    comfySteps,
    comfySampler,
    comfyLora,
    comfyLoraStrength,
    comfyCfg,
    comfyDiffusionModel,
    comfyClipModel,
    comfySeedMode,
    comfySeed,
    availableLoras,
    availableDiffusionModels,
    availableClipModels,
    handleBackendChange,
    handleResolutionChange,
    handleAspectRatioChange,
    handleAutoUpscaleChange,
    handleComfyStepsChange,
    handleComfySamplerChange,
    handleComfyCfgChange,
    handleComfyLoraChange,
    handleComfyLoraStrengthChange,
    handleComfyDiffusionModelChange,
    handleComfyClipModelChange,
    handleComfySeedModeChange,
    handleComfySeedChange,
    showToast,
  ]);

  const handleDownload = useCallback(async () => {
    if (currentImages.length === 0 || !currentSettings) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Download every original and its upscaled copy. No base64 anywhere on this
    // path now -- it used to decode, copy, re-encode and decode again per image.
    try {
      const multiple = currentImages.length > 1;
      let downloads = 0;
      for (let i = 0; i < currentImages.length; i++) {
        const sequence = multiple ? `_${i + 1}` : '';
        const withMetadata = await embedMetadataInPngBlob(
          currentImages[i],
          currentSettings,
          new Date().toISOString()
        );
        if (downloads > 0) await new Promise((resolve) => setTimeout(resolve, 150));
        downloadBlob(withMetadata, `goldenhour_${timestamp}${sequence}.png`);
        downloads++;

        if (currentUpscaledImages[i]) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          downloadBlob(currentUpscaledImages[i]!, `goldenhour_${timestamp}${sequence}_${currentUpscaleScales[i] ?? upscaleScale}x.png`);
          downloads++;
        }
      }
    } catch (e) {
      showToast('Failed to prepare the download', 'error');
      return;
    }
  }, [currentImages, currentUpscaledImages, currentUpscaleScales, currentSettings, upscaleScale, showToast]);

  const handleDeleteHistory = useCallback(async (id: string) => {
    await deleteGeneration(id);
    setHistory((prev) => prev.filter((r) => r.id !== id));
    showToast('Image deleted', 'info');
  }, [showToast]);

  const handleClearHistory = useCallback(async () => {
    await clearAllGenerations();
    setHistory([]);
    setCurrentImages([]);
    setCurrentUpscaledImages([]);
    setCurrentUpscaleScales([]);
    setCurrentRecordIds([]);
    setCurrentSettings(null);
    setCanUpscale(false);
    hasGenerated.current = false;
    showToast('History cleared', 'info');
  }, [showToast]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (promptMode === 'batch') {
          handleGenerateBatch();
        } else {
          handleGenerate();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleGenerate, handleGenerateBatch, promptMode]);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* ── Top Bar ──────────────────────────────────────────────────── */}
      <header className="glass h-[52px] flex items-center justify-between px-5 shrink-0 z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDrawerOpen(!drawerOpen)}
            className="icon-btn"
            title="Toggle history"
          >
            {drawerOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </button>

          <div className="flex items-baseline gap-1.5">
            <span className="text-[15px] font-bold tracking-tight bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
              Golden Hour
            </span>
            <span className="text-[11px] font-medium text-amber-500/70 tracking-wide">v2</span>
          </div>

          {/* Backend indicator */}
          <div className="flex items-center gap-1.5 text-[10px] font-medium tracking-wider px-2.5 py-1 rounded-full"
               style={{ color: 'var(--text-secondary)', background: 'var(--icon-btn-hover)', border: '1px solid var(--border-subtle)' }}>
            {activeBackend === 'gemini' ? <Cloud size={11} /> : <Monitor size={11} />}
            {activeBackend === 'gemini' ? 'Gemini' : 'ComfyUI'}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {migration && (
            <div className="text-[11px] font-mono tracking-wider px-3 py-1 rounded-full"
                 style={{ color: 'var(--text-secondary)', background: 'var(--icon-btn-hover)', border: '1px solid var(--border-subtle)' }}>
              Upgrading history… {migration.done}/{migration.total}
            </div>
          )}

          {session.imageCount > 0 && (
            <div className="text-[11px] font-mono tracking-wider px-3 py-1 rounded-full"
                 style={{ color: 'var(--text-secondary)', background: 'var(--icon-btn-hover)', border: '1px solid var(--border-subtle)' }}>
              ${session.totalCost.toFixed(3)} · {session.imageCount} img{session.imageCount !== 1 ? 's' : ''}
            </div>
          )}

          {history.length > 0 && (
            <button
              onClick={() => {
                const event = new CustomEvent('downloadAllHistory');
                window.dispatchEvent(event);
              }}
              className="icon-btn"
              title="Download all images"
            >
              <Download size={16} />
            </button>
          )}

          <button
            onClick={toggleTheme}
            className="icon-btn"
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          <button
            onClick={() => {
              setSettingsOpen(true);
              setHasApiKey(!!getApiKey());
            }}
            className="icon-btn relative"
            title="Settings"
          >
            <Settings size={17} />
            {!hasApiKey && (
              <span className="absolute top-1 right-1 w-[7px] h-[7px] rounded-full animate-pulse-soft"
                    style={{ background: '#d4a017' }} />
            )}
          </button>
        </div>
      </header>

      {/* ── Main Content ─────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <HistoryDrawer
          open={drawerOpen}
          history={history}
          upscaleScale={upscaleScale}
          onClose={() => setDrawerOpen(false)}
          onReusePrompt={handleReusePrompt}
          onDelete={handleDeleteHistory}
          onClearAll={handleClearHistory}
          onUpscaleRecord={handleUpscaleRecord}
        />

        <main className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          <div className="lg:w-[46%] xl:w-[44%] p-5 pb-2.5 lg:pr-2.5 lg:pb-5 overflow-y-auto">
            <PromptWorkspace
              prompt={prompt}
              onPromptChange={setPrompt}
              numberOfImages={numberOfImages}
              onNumberOfImagesChange={setNumberOfImages}
              resolution={resolution}
              onResolutionChange={handleResolutionChange}
              aspectRatio={aspectRatio}
              onAspectRatioChange={handleAspectRatioChange}
              refImage={refImage}
              onRefImageChange={setRefImage}
              refCropArea={refCropArea}
              onRefCropChange={setRefCropArea}
              isGenerating={isGenerating}
              queueCount={queueCount}
              hasGenerated={hasGenerated.current}
              onGenerate={() => handleGenerate()}
              onRerun={handleRerun}
              onNew={handleNew}
              showToast={showToast}
              activeClipIds={activeClipIds}
              onToggleClip={(clipId) => {
                // Find the clip to get its modifier
                let clipModifier = '';
                for (const clips of Object.values(allClips)) {
                  const found = clips.find((c) => c.id === clipId);
                  if (found) { clipModifier = found.modifier; break; }
                }
                setActiveClipIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(clipId)) {
                    // Deactivate: remove modifier from prompt
                    next.delete(clipId);
                    if (clipModifier && promptMode === 'single') {
                      const withComma = `, ${clipModifier}`;
                      const withCommaLeading = `${clipModifier}, `;
                      if (prompt.includes(withComma)) {
                        setPrompt(prompt.replace(withComma, ''));
                      } else if (prompt.includes(withCommaLeading)) {
                        setPrompt(prompt.replace(withCommaLeading, ''));
                      } else {
                        setPrompt(prompt.replace(clipModifier, '').trim());
                      }
                    }
                  } else {
                    // Activate: append modifier to prompt
                    next.add(clipId);
                    if (clipModifier && promptMode === 'single') {
                      setPrompt(prompt.trim() ? `${prompt.trim()}, ${clipModifier}` : clipModifier);
                    }
                  }
                  return next;
                });
              }}
              allClips={allClips}
              onAddClip={(category, label, modifier) => {
                const updated = addClipToStorage(category, label, modifier);
                setAllClips(updated);
              }}
              onRemoveClip={(category, clipId) => {
                // If the clip being removed was active, also remove its modifier from prompt
                let clipModifier = '';
                const clips = allClips[category];
                if (clips) {
                  const found = clips.find((c) => c.id === clipId);
                  if (found) clipModifier = found.modifier;
                }
                const wasActive = activeClipIds.has(clipId);
                const updated = removeClipFromStorage(category, clipId);
                setAllClips(updated);
                setActiveClipIds((prev) => {
                  const next = new Set(prev);
                  next.delete(clipId);
                  return next;
                });
                if (wasActive && clipModifier && promptMode === 'single') {
                  const withComma = `, ${clipModifier}`;
                  const withCommaLeading = `${clipModifier}, `;
                  if (prompt.includes(withComma)) {
                    setPrompt(prompt.replace(withComma, ''));
                  } else if (prompt.includes(withCommaLeading)) {
                    setPrompt(prompt.replace(withCommaLeading, ''));
                  } else {
                    setPrompt(prompt.replace(clipModifier, '').trim());
                  }
                }
              }}
              autoUpscale={autoUpscale}
              onAutoUpscaleChange={handleAutoUpscaleChange}
              upscaleScale={upscaleScale}
              onClearClips={() => setActiveClipIds(new Set())}
              activeBackend={activeBackend}
              comfySteps={comfySteps}
              onComfyStepsChange={handleComfyStepsChange}
              comfySampler={comfySampler}
              onComfySamplerChange={handleComfySamplerChange}
              comfyLora={comfyLora}
              onComfyLoraChange={handleComfyLoraChange}
              comfyLoraStrength={comfyLoraStrength}
              onComfyLoraStrengthChange={handleComfyLoraStrengthChange}
              availableLoras={availableLoras}
              comfyCfg={comfyCfg}
              onComfyCfgChange={handleComfyCfgChange}
              comfyDiffusionModel={comfyDiffusionModel}
              onComfyDiffusionModelChange={handleComfyDiffusionModelChange}
              comfyClipModel={comfyClipModel}
              onComfyClipModelChange={handleComfyClipModelChange}
              comfySeedMode={comfySeedMode}
              onComfySeedModeChange={handleComfySeedModeChange}
              comfySeed={comfySeed}
              onComfySeedChange={handleComfySeedChange}
              lastUsedSeed={lastUsedSeed}
              availableDiffusionModels={availableDiffusionModels}
              availableClipModels={availableClipModels}
              promptMode={promptMode}
              onPromptModeChange={setPromptMode}
              batchText={batchText}
              onBatchTextChange={setBatchText}
              onGenerateBatch={handleGenerateBatch}
            />
            <QueuePanel queueItems={queueItems} onRemoveItem={removeQueueItem} onClearQueue={clearQueue} onRetryFailed={retryFailed} onCancelRunning={cancelRunning} />
          </div>

          <div className="lg:flex-1 p-5 pt-2.5 lg:pl-2.5 lg:pt-5 overflow-y-auto">
            <GenerationDisplay
              images={currentImages}
              upscaledImages={currentUpscaledImages}
              upscaleScales={currentUpscaleScales}
              isGenerating={isGenerating}
              progress={activeBackend === 'comfyui' ? comfyProgress : null}
              canUpscale={canUpscale}
              upscaleScale={upscaleScale}
              onDownload={handleDownload}
              onUpscale={handleUpscale}
            />
          </div>
        </main>
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          setHasApiKey(!!getApiKey());
          setComfyConfig(getComfyUIConfig());
        }}
        onClearHistory={handleClearHistory}
        activeBackend={activeBackend}
        onBackendChange={handleBackendChange}
      />

      <Toast
        message={toastMessage}
        type={toastType}
        visible={toastVisible}
        onDismiss={hideToast}
      />
    </div>
  );
}

export default App;
