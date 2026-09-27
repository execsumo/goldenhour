import { ComfyUIConfig, GenerationSettings, ComfyProgress } from '../types';
import { DEFAULT_WORKFLOW, resolveModelProfile } from '../config';

// ─── Helpers ─────────────────────────────────────────────────────────────────


function cleanHost(host: string): string {
  if (!host) return '127.0.0.1';
  const normalized = host.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (normalized.toLowerCase() === '::1') return '::1';
  if (normalized.startsWith('[') && normalized.includes(']')) {
    return normalized.slice(1, normalized.indexOf(']'));
  }
  return normalized.replace(/:.*$/, '');
}

function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

const proxyHost = cleanHost(import.meta.env?.VITE_COMFYUI_HOST || '127.0.0.1').toLowerCase();
const proxyPort = Number(import.meta.env?.VITE_COMFYUI_PORT) || 8188;

function isLoopbackHost(configHost: string): boolean {
  const host = cleanHost(configHost).toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function matchesProxyTarget(config: ComfyUIConfig): boolean {
  const host = cleanHost(config.host).toLowerCase();
  const port = Number(config.port) || 8188;
  // Any loopback alias reaches the same machine, so a saved "localhost" must not
  // lose the proxy just because the proxy target is spelled "127.0.0.1".
  return isLoopbackHost(host) && isLoopbackHost(proxyHost) && port === proxyPort;
}

/**
 * Returns the WebSocket URL for ComfyUI API requests.
 */
function getWebSocketUrl(config: ComfyUIConfig, clientId: string): string {
  if (matchesProxyTarget(config) && typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/comfyui-api/ws?clientId=${clientId}`;
  }
  const host = cleanHost(config.host) || '127.0.0.1';
  const port = Number(config.port) || 8188;
  return `ws://${formatHost(host)}:${port}/ws?clientId=${clientId}`;
}

/**
 * Classify incoming WebSocket binary frames from ComfyUI.
 *
 * Binary protocol format:
 * - Bytes 0..3: Event type as big-endian 32-bit unsigned integer.
 *   - Type 1 (PREVIEW_IMAGE):
 *     - Bytes 4..7: Image format (1 = JPEG, 2 = PNG).
 *     - Bytes 8..: Raw image data.
 *   - Type 4 (PREVIEW_IMAGE_WITH_METADATA):
 *     - Bytes 4..7: Metadata JSON length (N bytes).
 *     - Bytes 8..(8+N-1): JSON metadata string.
 *     - Bytes (8+N)..: Raw image data.
 *
 * Classification rules:
 * - 'ignore': frame < 8 bytes, unknown event type, or truncated payload.
 * - 'output': executingClass === 'SaveImageWebsocket'.
 * - 'preview': executingClass !== 'SaveImageWebsocket' (e.g. 'KSampler').
 */
export function classifyBinaryFrame(
  buf: ArrayBuffer,
  executingClass: string | null
): { kind: 'output' | 'preview' | 'ignore'; blob?: Blob } {
  if (buf.byteLength < 8) {
    return { kind: 'ignore' };
  }

  const view = new DataView(buf);
  const eventType = view.getUint32(0, false);

  let mimeType: string;
  let imageBytes: Uint8Array;

  if (eventType === 1) {
    // PREVIEW_IMAGE
    const imageFormat = view.getUint32(4, false);
    if (imageFormat === 1) {
      mimeType = 'image/jpeg';
    } else if (imageFormat === 2) {
      mimeType = 'image/png';
    } else {
      const sniff = new Uint8Array(buf, 8, Math.min(2, buf.byteLength - 8));
      mimeType = sniff.length >= 2 && sniff[0] === 0xff && sniff[1] === 0xd8 ? 'image/jpeg' : 'image/png';
    }
    imageBytes = new Uint8Array(buf, 8);
  } else if (eventType === 4) {
    // PREVIEW_IMAGE_WITH_METADATA
    const metaLength = view.getUint32(4, false);
    const headerLen = 8 + metaLength;
    if (buf.byteLength < headerLen) {
      return { kind: 'ignore' };
    }
    imageBytes = new Uint8Array(buf, headerLen);
    mimeType = imageBytes.length >= 2 && imageBytes[0] === 0xff && imageBytes[1] === 0xd8 ? 'image/jpeg' : 'image/png';
  } else {
    return { kind: 'ignore' };
  }

  const blob = new Blob([imageBytes as BlobPart], { type: mimeType });
  const kind = executingClass === 'SaveImageWebsocket' ? 'output' : 'preview';
  return { kind, blob };
}

/**
 * Execute a ComfyUI prompt workflow using SaveImageWebsocket and WebSocket binary streaming.
 *
 * The returned promise must settle on every possible outcome. If it does not, the
 * caller's queue loop parks forever and the whole UI stays pinned in its
 * "generating" state until something else times out.
 *
 * `idleTimeoutMs` is the watchdog: ComfyUI streams status/progress frames the whole
 * time it is working, even while our prompt waits behind someone else's job, so a
 * complete absence of traffic means the connection is dead. `maxWaitMs` is only a
 * last-resort ceiling -- it must not be tight enough to kill a legitimate queue wait.
 */
async function executeWorkflowViaWebSocket(
  config: ComfyUIConfig,
  workflow: Record<string, any>,
  {
    idleTimeoutMs = 120_000,
    maxWaitMs = 1_800_000,
    signal,
    onProgress,
  }: {
    idleTimeoutMs?: number;
    maxWaitMs?: number;
    signal?: AbortSignal;
    onProgress?: (p: ComfyProgress) => void;
  } = {}
): Promise<{ images: Blob[] }> {
  const baseUrl = getBaseUrl(config);

  const clientId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `goldenhour_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const wsUrl = getWebSocketUrl(config, clientId);

  return new Promise((resolve, reject) => {
    let ws: WebSocket | null = null;
    let isCompleted = false;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    let promptId: string | null = null;
    let cancelSent = false;
    // Only true once ComfyUI reports our prompt running. Older servers ignore
    // /interrupt's prompt_id and stop whatever is executing, so a prompt that is
    // still queued must only be deleted from the queue, never interrupted.
    let executionStarted = false;
    let currentlyExecutingNodeId: string | null = null;
    const startedAt = Date.now();
    let lastActivityAt = Date.now();
    const collectedImages: Blob[] = [];

    // Progress reporting and throttling:
    // Previews throttled at most ~4/s (>= 250ms), progress updates at most ~10/s (>= 100ms)
    let latestPreviewBlob: Blob | undefined;
    let emittedPreviewBlob: Blob | undefined;
    let lastPreviewEmitTime = 0;
    let lastProgressEmitTime = 0;
    let throttleTimer: ReturnType<typeof setTimeout> | null = null;

    const progressState: ComfyProgress = {
      phase: 'queued',
    };

    const scheduleEmit = (force = false) => {
      if (!onProgress || isCompleted) return;

      const now = Date.now();
      if (force) {
        if (throttleTimer) {
          clearTimeout(throttleTimer);
          throttleTimer = null;
        }
        if (latestPreviewBlob) {
          emittedPreviewBlob = latestPreviewBlob;
          lastPreviewEmitTime = now;
        }
        progressState.preview = emittedPreviewBlob;
        lastProgressEmitTime = now;
        onProgress({ ...progressState });
        return;
      }

      const progressDue = now - lastProgressEmitTime >= 100;
      const previewNeedsEmit = latestPreviewBlob !== emittedPreviewBlob;
      const previewDue = previewNeedsEmit && (now - lastPreviewEmitTime >= 250);

      if (progressDue || previewDue) {
        if (previewDue) {
          emittedPreviewBlob = latestPreviewBlob;
          lastPreviewEmitTime = now;
        }
        progressState.preview = emittedPreviewBlob;
        lastProgressEmitTime = now;
        onProgress({ ...progressState });
      }

      if (!throttleTimer) {
        const timeUntilProgress = Math.max(0, 100 - (Date.now() - lastProgressEmitTime));
        const timeUntilPreview = latestPreviewBlob !== emittedPreviewBlob
          ? Math.max(0, 250 - (Date.now() - lastPreviewEmitTime))
          : 0;
        const delay = Math.max(timeUntilProgress, timeUntilPreview);

        if (delay > 0) {
          throttleTimer = setTimeout(() => {
            throttleTimer = null;
            if (!isCompleted) {
              scheduleEmit();
            }
          }, delay);
        }
      }
    };

    // Emit initial queued state
    scheduleEmit(true);

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      if (watchdog) {
        clearInterval(watchdog);
        watchdog = null;
      }
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
          ws.close();
        } catch {}
        ws = null;
      }
    };

    // Every exit path goes through these two, so the promise can never be left pending.
    const settleOk = () => {
      if (isCompleted) return;
      isCompleted = true;
      progressState.phase = 'finishing';
      scheduleEmit(true);
      cleanup();
      if (collectedImages.length === 0) {
        reject(new Error('ComfyUI execution completed but no binary images were received over WebSocket'));
      } else {
        resolve({ images: collectedImages });
      }
    };

    const settleErr = (message: string, name?: string) => {
      if (isCompleted) return;
      isCompleted = true;
      cleanup();
      const error = new Error(message);
      if (name) error.name = name;
      reject(error);
    };

    const cancelServerPrompt = (id: string) => {
      if (cancelSent) return;
      cancelSent = true;
      const headers = { 'Content-Type': 'application/json' };
      // These endpoints vary a little between ComfyUI versions. Cancellation is
      // best effort; the browser promise must settle even if either request fails.
      fetch(`${baseUrl}/queue`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ delete: [id] }),
      }).catch(() => {});
      if (!executionStarted) return;
      fetch(`${baseUrl}/interrupt`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt_id: id }),
      }).catch(() => {});
    };

    const isOwnExecutionFrame = (raw: string, id: string) => {
      try {
        const msg = JSON.parse(raw);
        return msg.data?.prompt_id === id && ['execution_start', 'executing', 'progress'].includes(msg.type);
      } catch {
        return false;
      }
    };

    const onAbort = () => {
      if (promptId) cancelServerPrompt(promptId);
      settleErr('Generation cancelled', 'AbortError');
    };

    try {
      ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
    } catch (err: any) {
      return reject(new Error(`Failed to create WebSocket connection to ComfyUI: ${err.message}`));
    }

    watchdog = setInterval(() => {
      if (isCompleted) return;
      const now = Date.now();
      if (now - lastActivityAt > idleTimeoutMs) {
        settleErr(
          `ComfyUI stopped responding — no WebSocket activity for ${Math.round(idleTimeoutMs / 1000)}s`
        );
      } else if (now - startedAt > maxWaitMs) {
        settleErr(`ComfyUI WebSocket execution timed out after ${Math.round(maxWaitMs / 1000)}s`);
      }
    }, 5_000);

    ws.onerror = () => {
      // The error event carries no detail; onclose follows with the real reason when
      // the socket actually died. Only settle here if it does not.
      console.warn('ComfyUI WebSocket error');
    };

    ws.onclose = (event) => {
      if (isCompleted) return;
      // The socket dropped before we saw a completion signal. If images already
      // arrived, treat it as done rather than discarding a finished generation.
      if (collectedImages.length > 0) {
        settleOk();
      } else {
        settleErr(
          `ComfyUI WebSocket closed before the generation finished (code ${event.code}${
            event.reason ? `: ${event.reason}` : ''
          })`
        );
      }
    };

    // promptId is only known once the queue POST returns, but ComfyUI may finish
    // executing (and send its frames) before that. Text frames are therefore
    // buffered until the id arrives, then replayed.
    const pendingTextFrames: string[] = [];

    const handleTextFrame = (raw: string) => {
      if (isCompleted) return;
      try {
        const msg = JSON.parse(raw);
        if (msg.data?.prompt_id !== promptId) return;

        if (msg.type === 'executing') {
          currentlyExecutingNodeId = msg.data?.node ?? null;
          if (msg.data?.node === null) {
            progressState.phase = 'finishing';
            scheduleEmit(true);
          } else {
            progressState.phase = 'running';
            progressState.nodeId = String(msg.data.node);
            progressState.nodeClass = workflow[progressState.nodeId]?.class_type;
            scheduleEmit();
          }
        }

        if (msg.type === 'progress') {
          executionStarted = true;
          progressState.phase = 'running';
          progressState.step = msg.data.value;
          progressState.maxSteps = msg.data.max;
          progressState.nodeId = String(msg.data.node ?? '');
          progressState.nodeClass = workflow[progressState.nodeId]?.class_type;
          scheduleEmit();
        }

        if (msg.type === 'execution_start') {
          executionStarted = true;
          progressState.phase = 'running';
          scheduleEmit(true);
        }

        if (msg.type === 'execution_error') {
          const exceptionMsg = msg.data?.exception_message || 'Unknown execution error';
          settleErr(`ComfyUI execution failed: ${exceptionMsg}`);
          return;
        }

        if (msg.type === 'execution_interrupted') {
          settleErr('ComfyUI execution was interrupted');
          return;
        }

        // ComfyUI signals completion twice: `execution_success` first, then
        // `executing` with node:null. Accept whichever arrives -- relying on only
        // the second one means a single dropped frame hangs the promise forever.
        if (msg.type === 'execution_success' || (msg.type === 'executing' && msg.data?.node === null)) {
          progressState.phase = 'finishing';
          scheduleEmit(true);
          settleOk();
        }
      } catch {
        // Ignore non-JSON or status frames
      }
    };

    ws.onmessage = (event) => {
      lastActivityAt = Date.now();
      if (isCompleted) return;

      // 1. Binary frames containing image payload (from SaveImageWebsocket or sampler previews).
      // The clientId is unique to this socket, so every binary frame is ours.
      if (event.data instanceof ArrayBuffer) {
        try {
          const executingClass = currentlyExecutingNodeId
            ? workflow[currentlyExecutingNodeId]?.class_type ?? null
            : null;
          const { kind, blob } = classifyBinaryFrame(event.data, executingClass);
          if (kind === 'output' && blob) {
            collectedImages.push(blob);
          } else if (kind === 'preview' && blob) {
            latestPreviewBlob = blob;
            scheduleEmit();
          }
        } catch (imgErr) {
          console.error('Failed to parse WebSocket binary image:', imgErr);
        }
        return;
      }

      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          // Global status frame carries server queue remaining count
          if (msg.type === 'status') {
            const queueRemaining = msg.data?.status?.exec_info?.queue_remaining;
            if (typeof queueRemaining === 'number') {
              progressState.queueRemaining = queueRemaining;
              if (progressState.phase === 'queued') {
                scheduleEmit();
              }
            }
          }

          // Track executing node immediately (don't wait for promptId) because
          // clientId is unique per socket and binary frames can arrive before prompt POST returns.
          if (msg.type === 'executing') {
            currentlyExecutingNodeId = msg.data?.node ?? null;
          }
        } catch {
          // Ignore non-JSON
        }

        if (promptId === null) {
          pendingTextFrames.push(event.data);
        } else {
          handleTextFrame(event.data);
        }
      }
    };

    ws.onopen = async () => {
      try {
        const queueResponse = await fetch(`${baseUrl}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: workflow, client_id: clientId }),
        });

        if (!queueResponse.ok) {
          const errorData = await queueResponse.json().catch(() => null);
          throw new Error(errorData?.error || `ComfyUI queue failed: HTTP ${queueResponse.status}`);
        }

        const queueData = await queueResponse.json();

        if (!queueData.prompt_id) {
          throw new Error('ComfyUI did not return a prompt_id');
        }

        const receivedPromptId = queueData.prompt_id as string;
        promptId = receivedPromptId;
        if (signal?.aborted) {
          // Frames that arrived before the id are still buffered; they tell us
          // whether the prompt already started running.
          executionStarted ||= pendingTextFrames.some((raw) => isOwnExecutionFrame(raw, receivedPromptId));
          cancelServerPrompt(receivedPromptId);
          return;
        }

        for (const raw of pendingTextFrames) {
          if (isCompleted) break;
          handleTextFrame(raw);
        }
        pendingTextFrames.length = 0;
      } catch (err: any) {
        settleErr(err?.message || 'Failed to queue prompt with ComfyUI');
      }
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

/**
 * Returns the base URL for ComfyUI API requests.
 * Routes through Vite only when the configured loopback target matches the
 * proxy target. LAN hosts and other ports connect directly and require CORS.
 */
function getBaseUrl(config: ComfyUIConfig): string {
  if (matchesProxyTarget(config)) {
    return '/comfyui-api';
  }
  const host = cleanHost(config.host);
  const port = Number(config.port) || 8188;
  return `http://${formatHost(host)}:${port}`;
}

/**
 * Test whether the ComfyUI server is reachable.
 */
export async function testConnection(config: ComfyUIConfig): Promise<{ ok: boolean; message: string; rtxSupported: boolean }> {
  let rtxSupported = false;
  try {
    const baseUrl = getBaseUrl(config);
    const response = await fetch(`${baseUrl}/system_stats`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return { ok: false, message: `Server responded with HTTP ${response.status}`, rtxSupported: false };
    }
    const data = await response.json();

    // Check if the RTX Video Super Resolution custom node is available
    try {
      const nodeCheck = await fetch(`${baseUrl}/object_info/RTXVideoSuperResolution`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      if (nodeCheck.ok) {
        rtxSupported = true;
      }
    } catch {
      // Ignore errors (e.g. node not found, offline etc.), default to false
    }

    let msg = `Connected — ComfyUI v${data.system?.comfyui_version || 'unknown'}`;
    if (rtxSupported) {
      msg += ` (RTX VSR Node Loaded)`;
    } else {
      msg += ` (RTX VSR Node Missing)`;
    }

    return { ok: true, message: msg, rtxSupported };
  } catch (err: any) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return { ok: false, message: 'Connection timed out. Is ComfyUI running?', rtxSupported: false };
    }
    return { ok: false, message: err.message || 'Cannot reach ComfyUI', rtxSupported: false };
  }
}

/**
 * Parse a workflow JSON and find key node IDs by their class_type.
 * Supports multiple class types for fallbacks (e.g. KSampler vs KSamplerAdvanced)
 */
function findNodeByClass(workflow: Record<string, any>, classNames: string | string[]): string | null {
  const classes = Array.isArray(classNames) ? classNames : [classNames];
  for (const [id, node] of Object.entries(workflow)) {
    if (classes.includes(node.class_type)) return id;
  }
  return null;
}

/**
 * Inject prompt, resolution, and batch size into a workflow JSON template.
 * Converts any SaveImage or PreviewImage node to SaveImageWebsocket for direct WS streaming.
 * Returns a deep copy — does not mutate the original.
 */
function findUpstreamNode(
  workflow: Record<string, any>,
  connection: unknown,
  classNames: string | string[]
): string | null {
  if (!Array.isArray(connection) || typeof connection[0] !== 'string') return null;
  const classes = Array.isArray(classNames) ? classNames : [classNames];
  const queue = [connection[0] as string];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    const node = workflow[currentId];
    if (!node) continue;
    if (classes.includes(node.class_type)) return currentId;
    for (const value of Object.values(node.inputs ?? {})) {
      if (Array.isArray(value) && typeof value[0] === 'string') queue.push(value[0]);
    }
  }
  return null;
}

function clampSeed(seed: number): number {
  if (!Number.isFinite(seed) || seed < 0) return 0;
  return Math.min(Math.floor(seed), Number.MAX_SAFE_INTEGER);
}

function prepareWorkflowDetailed(
  workflowTemplate: Record<string, any>,
  settings: GenerationSettings,
  config?: ComfyUIConfig
): { workflow: Record<string, any>; warnings: string[]; usedVae?: string; seed?: number } {
  const workflow = JSON.parse(JSON.stringify(workflowTemplate));
  const warnings: string[] = [];

  // Convert all SaveImage and PreviewImage output nodes to SaveImageWebsocket
  for (const nodeId of Object.keys(workflow)) {
    const node = workflow[nodeId];
    if (node && (node.class_type === 'SaveImage' || node.class_type === 'PreviewImage')) {
      node.class_type = 'SaveImageWebsocket';
    }
  }

  const actualSeed = settings.comfySeedMode === 'fixed'
    ? clampSeed(settings.comfySeed ?? settings.seed ?? 0)
    : (settings.seed !== undefined && settings.comfySeedMode === undefined
      ? clampSeed(settings.seed)
      : Math.floor(Math.random() * 2 ** 32));

  // Find the primary sampler to use as the base for graph traversal
  const samplerClasses = ['KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'SamplerCustomAdvanced', 'KSampler (Efficient)'];
  const samplerId = findNodeByClass(workflow, samplerClasses);

  if (samplerId && workflow[samplerId]) {
    // 1. Seed injection based on sampler type
    const samplerClass = workflow[samplerId].class_type;
    if (samplerClass === 'KSamplerAdvanced' || samplerClass === 'SamplerCustom') {
      workflow[samplerId].inputs.noise_seed = actualSeed;
    } else if (samplerClass === 'SamplerCustomAdvanced') {
      const noiseNodeId = findUpstreamNode(workflow, workflow[samplerId].inputs?.noise, 'RandomNoise')
        || findNodeByClass(workflow, 'RandomNoise');
      if (noiseNodeId && workflow[noiseNodeId]?.inputs) {
        workflow[noiseNodeId].inputs.noise_seed = actualSeed;
      }
      if (workflow[samplerId].inputs?.noise_seed !== undefined) {
        workflow[samplerId].inputs.noise_seed = actualSeed;
      }
    } else {
      workflow[samplerId].inputs.seed = actualSeed;
    }

    // 2. Inject steps, sampler, scheduler, cfg
    if (settings.comfySteps !== undefined) {
      workflow[samplerId].inputs.steps = settings.comfySteps;
    }
    if (settings.comfyCfg !== undefined) {
      workflow[samplerId].inputs.cfg = settings.comfyCfg;
    }
    if (settings.comfySampler) {
      const [samplerName, schedulerName] = settings.comfySampler.split('|');
      if (samplerName && schedulerName) {
        workflow[samplerId].inputs.sampler_name = samplerName;
        workflow[samplerId].inputs.scheduler = schedulerName;
      }
    }

    // Trace from the sampler's positive input so custom graphs receive the prompt
    // at their connected encoder instead of an unrelated CLIPTextEncode node.
    const positiveInput = workflow[samplerId].inputs.positive;
    const foundPositiveNodeId = findUpstreamNode(workflow, positiveInput, 'CLIPTextEncode');
    if (foundPositiveNodeId && workflow[foundPositiveNodeId]?.inputs) {
      workflow[foundPositiveNodeId].inputs.text = settings.prompt;
    }
  } else {
    // Fallback if no KSampler found
    const randomNoiseId = findNodeByClass(workflow, 'RandomNoise');
    if (randomNoiseId && workflow[randomNoiseId]?.inputs) {
      workflow[randomNoiseId].inputs.noise_seed = actualSeed;
    }
    const fallbackPositiveId = findNodeByClass(workflow, 'CLIPTextEncode');
    if (fallbackPositiveId && workflow[fallbackPositiveId]) {
      workflow[fallbackPositiveId].inputs.text = settings.prompt;
    }
  }

  // Inject latent image dimensions
  const latentId = findNodeByClass(workflow, ['EmptyLatentImage', 'EmptySD3LatentImage']);
  if (latentId && workflow[latentId]) {
    const dims = aspectRatioToDimensions(settings.aspectRatio, settings.resolution);
    workflow[latentId].inputs.width = dims.width;
    workflow[latentId].inputs.height = dims.height;
    workflow[latentId].inputs.batch_size = settings.numberOfImages || 1;
  }

  const sampler = samplerId ? workflow[samplerId] : undefined;
  const modelLoaderId = sampler ? findUpstreamNode(workflow, sampler.inputs?.model, ['UNETLoader', 'CheckpointLoaderSimple']) : null;
  const positiveId = sampler ? findUpstreamNode(workflow, sampler.inputs?.positive, 'CLIPTextEncode') : null;
  const clipLoaderId = positiveId ? findUpstreamNode(workflow, workflow[positiveId].inputs?.clip, 'CLIPLoader') : null;
  const vaeDecodeId = Object.keys(workflow).find((id) =>
    workflow[id]?.class_type === 'VAEDecode' && workflow[id].inputs?.samples?.[0] === samplerId
  );
  const vaeLoaderId = vaeDecodeId
    ? findUpstreamNode(workflow, workflow[vaeDecodeId].inputs?.vae, 'VAELoader')
    : null;

  if (settings.comfyDiffusionModel && settings.comfyDiffusionModel !== 'none') {
    if (modelLoaderId && workflow[modelLoaderId].class_type === 'UNETLoader') {
      const modelLoader = workflow[modelLoaderId];
      modelLoader.inputs.unet_name = settings.comfyDiffusionModel;
    }
  }
  if (settings.comfyClipModel && settings.comfyClipModel !== 'none') {
    if (clipLoaderId) workflow[clipLoaderId].inputs.clip_name = settings.comfyClipModel;
  }

  const modelName = modelLoaderId && workflow[modelLoaderId].class_type === 'CheckpointLoaderSimple'
    ? workflow[modelLoaderId].inputs?.ckpt_name
    : settings.comfyDiffusionModel && settings.comfyDiffusionModel !== 'none'
    ? settings.comfyDiffusionModel
    : (modelLoaderId ? workflow[modelLoaderId].inputs?.unet_name ?? workflow[modelLoaderId].inputs?.ckpt_name : '');
  const profile = resolveModelProfile(modelName);
  if (profile?.clipType && clipLoaderId) workflow[clipLoaderId].inputs.type = profile.clipType;

  if (settings.comfyLora && settings.comfyLora !== 'none') {
    if (modelLoaderId && clipLoaderId) {
      const numericIds = Object.keys(workflow).filter((id) => /^\d+$/.test(id)).map(Number);
      let loraId = String(Math.max(-1, ...numericIds) + 1);
      while (workflow[loraId]) loraId = String(Number(loraId) + 1);
      workflow[loraId] = {
        class_type: 'LoraLoader',
        inputs: {
          lora_name: settings.comfyLora,
          strength_model: settings.comfyLoraStrength ?? 1.0,
          strength_clip: settings.comfyLoraStrength ?? 1.0,
          model: [modelLoaderId, 0],
          clip: [clipLoaderId, 0],
        },
      };
      for (const [nodeId, node] of Object.entries(workflow) as [string, any][]) {
        if (nodeId === loraId || !node?.inputs) continue;
        for (const [inputName, value] of Object.entries(node.inputs)) {
          if (!Array.isArray(value)) continue;
          if (value[0] === modelLoaderId && value[1] === 0) node.inputs[inputName] = [loraId, 0];
          else if (value[0] === clipLoaderId && value[1] === 0) node.inputs[inputName] = [loraId, 1];
        }
      }
    } else {
      warnings.push('LoRA was selected, but the workflow needs both a supported model loader and a CLIPLoader.');
    }
  }

  let usedVae: string | undefined;
  if (vaeLoaderId) {
    const explicitVae = settings.comfyVae && settings.comfyVae !== 'auto' ? settings.comfyVae : undefined;
    const autoVae = profile && settings.comfyAvailableVaes?.includes(profile.vae) ? profile.vae : undefined;
    if (explicitVae) {
      workflow[vaeLoaderId].inputs.vae_name = explicitVae;
    } else if (autoVae) {
      workflow[vaeLoaderId].inputs.vae_name = autoVae;
    }
    usedVae = workflow[vaeLoaderId].inputs?.vae_name;
  } else if (settings.comfyVae && settings.comfyVae !== 'auto') {
    warnings.push('VAE was selected, but this workflow has no VAELoader.');
  }

  return { workflow, warnings, usedVae, seed: actualSeed };
}

/** Exported for the development workflow injection check. */
export function prepareWorkflow(
  workflowTemplate: Record<string, any>,
  settings: GenerationSettings,
  config?: ComfyUIConfig
): Record<string, any> {
  return prepareWorkflowDetailed(workflowTemplate, settings, config).workflow;
}

/** Includes injection diagnostics for the development verification script. */
export function prepareWorkflowWithDetails(
  workflowTemplate: Record<string, any>,
  settings: GenerationSettings,
  config?: ComfyUIConfig
): { workflow: Record<string, any>; warnings: string[]; usedVae?: string; seed?: number } {
  return prepareWorkflowDetailed(workflowTemplate, settings, config);
}

/**
 * Map Golden Hour aspect ratio + resolution to precise pixel dimensions.
 */
function aspectRatioToDimensions(
  aspectRatio: string,
  resolution: string
): { width: number; height: number } {
  const base1kPresets: Record<string, [number, number]> = {
    '1:1': [1024, 1024],
    '9:16': [720, 1280],
    '16:9': [1280, 720],
    '2:3': [768, 1152],
    '3:2': [1152, 768],
  };

  const base512Presets: Record<string, [number, number]> = {
    '1:1': [512, 512],
    '9:16': [432, 768],
    '16:9': [768, 432],
    '2:3': [512, 768],
    '3:2': [768, 512],
  };

  let rw: number, rh: number;

  if (resolution === '512') {
    [rw, rh] = base512Presets[aspectRatio] || [512, 512];
  } else {
    [rw, rh] = base1kPresets[aspectRatio] || [1024, 1024];

    if (resolution === '2k') {
      rw *= 2;
      rh *= 2;
    } else if (resolution === '4k') {
      rw *= 4;
      rh *= 4;
    }
  }

  const width = Math.round(rw / 8) * 8;
  const height = Math.round(rh / 8) * 8;

  return { width, height };
}

// ─── Main Generation Flow ────────────────────────────────────────────────────

/**
 * Generate images via ComfyUI using SaveImageWebsocket over WebSocket binary stream.
 */
export async function comfyuiGenerateImage(
  config: ComfyUIConfig,
  settings: GenerationSettings,
  signal?: AbortSignal,
  options?: { onProgress?: (p: ComfyProgress) => void }
): Promise<{ images: Blob[]; warnings?: string[]; comfyVae?: string; seed?: number }> {
  let workflowTemplate = DEFAULT_WORKFLOW;
  if (config.workflowJson) {
    try {
      workflowTemplate = JSON.parse(config.workflowJson);
    } catch {
      throw new Error('Invalid ComfyUI workflow JSON in settings');
    }
  }

  const prepared = prepareWorkflowDetailed(workflowTemplate, settings, config);
  if (import.meta.env?.DEV) console.debug('Prepared ComfyUI workflow for WS streaming');
  const result = await executeWorkflowViaWebSocket(config, prepared.workflow, {
    idleTimeoutMs: 120_000,
    maxWaitMs: 1_800_000,
    signal,
    onProgress: options?.onProgress,
  });
  return { ...result, warnings: prepared.warnings, comfyVae: prepared.usedVae, seed: prepared.seed };
}

/**
 * Upload an image to ComfyUI.
 * Returns the uploaded filename as saved on the ComfyUI server.
 */
export async function comfyuiUploadImage(
  config: ComfyUIConfig,
  image: Blob,
  filename: string = 'rtx_upscale_input.png'
): Promise<string> {
  const baseUrl = getBaseUrl(config);

  const formData = new FormData();
  formData.append('image', image, filename);
  formData.append('overwrite', 'true');

  const response = await fetch(`${baseUrl}/upload/image`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`ComfyUI image upload failed (HTTP ${response.status}): ${errText}`);
  }

  const data = await response.json();
  if (!data.name) {
    throw new Error('ComfyUI did not return a filename for uploaded image');
  }

  return data.name;
}

/**
 * Call ComfyUI's /free endpoint to release cached GPU VRAM memory.
 */
export async function freeComfyMemory(config: ComfyUIConfig): Promise<void> {
  try {
    const baseUrl = getBaseUrl(config);
    await fetch(`${baseUrl}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: false, free_memory: true }),
    });
  } catch (err) {
    console.warn('Failed to call /free on ComfyUI:', err);
  }
}

/**
 * Fetch available VAE models from the local ComfyUI server.
 */
export async function comfyuiGetVaes(config: ComfyUIConfig): Promise<string[]> {
  try {
    const baseUrl = getBaseUrl(config);
    const response = await fetch(`${baseUrl}/object_info/VAELoader`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];
    const data = await response.json();
    const vaeNames = data.VAELoader?.input?.required?.vae_name?.[0];
    if (Array.isArray(vaeNames)) return vaeNames;
    return [];
  } catch {
    return [];
  }
}

/**
 * Upscale an image using NVIDIA RTX Video Super Resolution (VSR) via ComfyUI with SaveImageWebsocket streaming.
 */
export async function comfyuiUpscaleImageRTX(
  config: ComfyUIConfig,
  image: Blob,
  scale: number = 2
): Promise<Blob> {
  const clampedScale = Math.min(4, Math.max(1, Number.isFinite(scale) ? scale : 2));

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await freeComfyMemory(config);
      if (attempt > 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }

      const uploadFilename = `rtx_upscale_${Date.now()}.png`;
      const comfyFilename = await comfyuiUploadImage(config, image, uploadFilename);

      const rtxWorkflow: Record<string, any> = {
        "1": {
          "class_type": "LoadImage",
          "inputs": { "image": comfyFilename }
        },
        "2": {
          "class_type": "RTXVideoSuperResolution",
          "inputs": {
            "images": ["1", 0],
            "resize_type": "scale by multiplier",
            "resize_type.scale": clampedScale,
            "quality": "HIGH"
          }
        },
        "3": {
          "class_type": "SaveImageWebsocket",
          "inputs": {
            "images": ["2", 0]
          }
        }
      };

      const result = await executeWorkflowViaWebSocket(config, rtxWorkflow, {
        idleTimeoutMs: 30_000,
        maxWaitMs: 180_000,
      });
      if (result.images.length > 0) {
        return result.images[0];
      }

      throw new Error('ComfyUI RTX upscale produced no binary image output');
    } catch (err: any) {
      if (attempt === 1 && (err.message?.includes('-12') || err.message?.includes('NvVFX_Load'))) {
        console.warn('NvVFX_Load failed with code -12, attempting VRAM cleanup retry...');
        continue;
      }
      if (attempt === 2 || (!err.message?.includes('-12') && !err.message?.includes('NvVFX_Load'))) {
        throw err;
      }
    }
  }

  throw new Error('ComfyUI RTX upscale failed after retries');
}

/**
 * Fetch available LoRAs from the local ComfyUI server.
 */
export async function comfyuiGetLoras(config: ComfyUIConfig): Promise<string[]> {
  try {
    const baseUrl = getBaseUrl(config);
    const response = await fetch(`${baseUrl}/object_info/LoraLoader`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];
    const data = await response.json();
    const loraNames = data.LoraLoader?.input?.required?.lora_name?.[0];
    if (Array.isArray(loraNames)) {
      return loraNames;
    }
    return [];
  } catch (err) {
    console.error('Failed to fetch LoRAs from ComfyUI:', err);
    return [];
  }
}

/**
 * Fetch available Diffusion Models (UNET) from the local ComfyUI server.
 */
export async function comfyuiGetDiffusionModels(config: ComfyUIConfig): Promise<string[]> {
  try {
    const baseUrl = getBaseUrl(config);
    const response = await fetch(`${baseUrl}/object_info/UNETLoader`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];
    const data = await response.json();
    const modelNames = data.UNETLoader?.input?.required?.unet_name?.[0];
    if (Array.isArray(modelNames)) {
      return modelNames;
    }
    return [];
  } catch (err) {
    console.error('Failed to fetch UNET models from ComfyUI:', err);
    return [];
  }
}

/**
 * Fetch available CLIP Models (text encoders) from the local ComfyUI server.
 */
export async function comfyuiGetClipModels(config: ComfyUIConfig): Promise<string[]> {
  try {
    const baseUrl = getBaseUrl(config);
    const response = await fetch(`${baseUrl}/object_info/CLIPLoader`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];
    const data = await response.json();
    const clipNames = data.CLIPLoader?.input?.required?.clip_name?.[0];
    if (Array.isArray(clipNames)) {
      return clipNames;
    }
    return [];
  } catch (err) {
    console.error('Failed to fetch CLIP models from ComfyUI:', err);
    return [];
  }
}
