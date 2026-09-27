import assert from 'node:assert/strict';
import { DEFAULT_WORKFLOW } from '../src/config/workflows';
import { prepareWorkflow, prepareWorkflowWithDetails } from '../src/utils/comfyui';
import type { GenerationSettings } from '../src/types';

function settings(overrides: Partial<GenerationSettings> = {}): GenerationSettings {
  return {
    prompt: 'verification prompt',
    numberOfImages: 1,
    resolution: '1k',
    aspectRatio: '1:1',
    referenceImage: null,
    referenceCrop: null,
    comfyVae: 'auto',
    ...overrides,
  };
}

{
  const graph = prepareWorkflow(DEFAULT_WORKFLOW, settings({
    comfyDiffusionModel: 'z_image_turbo_bf16.safetensors',
    comfyAvailableVaes: ['ae.safetensors'],
  }));
  assert.equal(graph['29'].inputs.vae_name, 'ae.safetensors');
  assert.equal(graph['30'].inputs.type, 'lumina2');
}

{
  const graph = prepareWorkflow(DEFAULT_WORKFLOW, settings({ comfyVae: 'other_vae.safetensors' }));
  assert.equal(graph['29'].inputs.vae_name, 'other_vae.safetensors');
}

{
  const custom = {
    '1': { class_type: 'KSampler', inputs: { model: ['50', 0], positive: ['28', 0] } },
    '28': { class_type: 'CLIPTextEncode', inputs: { text: 'untouched before prompt injection', clip: ['60', 0] } },
    '41': { class_type: 'Note', inputs: { text: 'existing node must survive' } },
    '50': { class_type: 'UNETLoader', inputs: { unet_name: 'custom.safetensors' } },
    '60': { class_type: 'CLIPLoader', inputs: { clip_name: 'clip.safetensors', type: 'stable_diffusion' } },
    '70': { class_type: 'AnotherConsumer', inputs: { model: ['50', 0], clip: ['60', 0] } },
  };
  const original41 = structuredClone(custom['41']);
  const graph = prepareWorkflow(custom, settings({ comfyLora: 'style.safetensors' }));
  const [loraId, lora] = Object.entries(graph).find(([, node]) => node.class_type === 'LoraLoader')!;
  assert.equal(graph['28'].class_type, 'CLIPTextEncode');
  assert.equal(graph['41'].class_type, original41.class_type);
  assert.deepEqual(graph['41'], original41);
  assert.ok(Number(loraId) > 70);
  assert.deepEqual(lora.inputs.model, ['50', 0]);
  assert.deepEqual(lora.inputs.clip, ['60', 0]);
  assert.deepEqual(graph['1'].inputs.model, [loraId, 0]);
  assert.deepEqual(graph['28'].inputs.clip, [loraId, 1]);
  assert.deepEqual(graph['70'].inputs.model, [loraId, 0]);
  assert.deepEqual(graph['70'].inputs.clip, [loraId, 1]);
}

{
  const custom = {
    '1': { class_type: 'KSampler', inputs: { model: ['10', 0], positive: ['20', 0] } },
    '10': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'bundle.safetensors' } },
    '20': { class_type: 'CLIPTextEncode', inputs: { text: 'old', clip: ['10', 1] } },
    '30': { class_type: 'VAEDecode', inputs: { samples: ['1', 0], vae: ['10', 2] } },
  };
  const checkpointBefore = structuredClone(custom['10']);
  const { workflow, warnings } = prepareWorkflowWithDetails(custom, settings({ comfyVae: 'explicit.safetensors' }));
  assert.ok(warnings.some((warning) => warning.includes('no VAELoader')));
  assert.deepEqual(workflow['10'], checkpointBefore);
  assert.equal(workflow['10'].inputs.vae_name, undefined);
}

{
  const custom = {
    '1': { class_type: 'KSampler', inputs: { model: ['10', 0], positive: ['20', 0] } },
    '10': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'z_image_checkpoint.safetensors' } },
    '20': { class_type: 'CLIPTextEncode', inputs: { text: 'old', clip: ['10', 1] } },
  };
  const originalCheckpoint = structuredClone(custom['10']);
  const { workflow, warnings } = prepareWorkflowWithDetails(custom, settings({
    comfyDiffusionModel: 'z_image_turbo_bf16.safetensors',
  }));
  assert.deepEqual(workflow['10'], originalCheckpoint);
  assert.equal(workflow['10'].inputs.ckpt_name, 'z_image_checkpoint.safetensors');
  assert.deepEqual(warnings, []);
}

{
  const custom = {
    '1': { class_type: 'KSampler', inputs: { model: ['10', 0], positive: ['20', 0] } },
    '10': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'bundle.safetensors' } },
    '20': { class_type: 'CLIPTextEncode', inputs: { text: 'old', clip: ['10', 1] } },
  };
  const { warnings } = prepareWorkflowWithDetails(custom, settings({ comfyVae: 'auto' }));
  assert.deepEqual(warnings, []);
}

// ─── Seed Assertions ────────────────────────────────────────────────────────

{
  const graph = prepareWorkflow(DEFAULT_WORKFLOW, settings({
    comfySeedMode: 'fixed',
    comfySeed: 1234567,
  }));
  assert.equal(graph['3'].inputs.seed, 1234567);
}

{
  const custom = {
    '1': { class_type: 'KSamplerAdvanced', inputs: { noise_seed: 0 } },
  };
  const graph = prepareWorkflow(custom, settings({
    comfySeedMode: 'fixed',
    comfySeed: 7654321,
  }));
  assert.equal(graph['1'].inputs.noise_seed, 7654321);
}

{
  const custom = {
    '1': { class_type: 'SamplerCustom', inputs: { noise_seed: 0 } },
  };
  const graph = prepareWorkflow(custom, settings({
    comfySeedMode: 'fixed',
    comfySeed: 111222,
  }));
  assert.equal(graph['1'].inputs.noise_seed, 111222);
}

{
  const custom = {
    '1': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['2', 0] } },
    '2': { class_type: 'RandomNoise', inputs: { noise_seed: 0 } },
  };
  const graph = prepareWorkflow(custom, settings({
    comfySeedMode: 'fixed',
    comfySeed: 999888,
  }));
  assert.equal(graph['2'].inputs.noise_seed, 999888);
}

{
  const { workflow, seed } = prepareWorkflowWithDetails(DEFAULT_WORKFLOW, settings({
    comfySeedMode: 'random',
  }));
  assert.equal(typeof seed, 'number');
  assert.equal(workflow['3'].inputs.seed, seed);
}

console.log('prepareWorkflow checks passed');
