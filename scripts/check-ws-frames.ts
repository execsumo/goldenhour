import assert from 'node:assert';
import { classifyBinaryFrame } from '../src/utils/comfyui';

function makeFrame(eventType: number, formatOrMetaLen: number, payloadLength: number): ArrayBuffer {
  const buf = new ArrayBuffer(8 + payloadLength);
  const view = new DataView(buf);
  view.setUint32(0, eventType, false);
  view.setUint32(4, formatOrMetaLen, false);
  const bytes = new Uint8Array(buf, 8);
  for (let i = 0; i < payloadLength; i++) {
    bytes[i] = (i + 1) % 256;
  }
  return buf;
}

// (a) type-1/JPEG frame while KSampler executing → preview
{
  const payloadLen = 64;
  const frame = makeFrame(1, 1, payloadLen);
  const result = classifyBinaryFrame(frame, 'KSampler');
  assert.strictEqual(result.kind, 'preview', 'Expected preview for KSampler executing');
  assert.ok(result.blob, 'Expected blob to be defined');
  assert.strictEqual(result.blob.type, 'image/jpeg', 'Expected MIME type image/jpeg');
  assert.strictEqual(result.blob.size, payloadLen, 'Expected blob size to match payload length');
}

// (b) type-1/PNG frame while SaveImageWebsocket executing → output with image/png blob of right byte length
{
  const payloadLen = 128;
  const frame = makeFrame(1, 2, payloadLen);
  const result = classifyBinaryFrame(frame, 'SaveImageWebsocket');
  assert.strictEqual(result.kind, 'output', 'Expected output for SaveImageWebsocket executing');
  assert.ok(result.blob, 'Expected blob to be defined');
  assert.strictEqual(result.blob.type, 'image/png', 'Expected MIME type image/png');
  assert.strictEqual(result.blob.size, payloadLen, 'Expected header to be stripped, matching payload size');
}

// (c) frame shorter than 8 bytes → ignore
{
  const shortBuf = new ArrayBuffer(7);
  const result = classifyBinaryFrame(shortBuf, 'SaveImageWebsocket');
  assert.strictEqual(result.kind, 'ignore', 'Expected frame shorter than 8 bytes to be ignored');

  const emptyBuf = new ArrayBuffer(0);
  const emptyResult = classifyBinaryFrame(emptyBuf, 'KSampler');
  assert.strictEqual(emptyResult.kind, 'ignore', 'Expected 0-byte frame to be ignored');
}

// (d) unknown event type → ignore
{
  const unknownFrame = makeFrame(999, 1, 32);
  const result = classifyBinaryFrame(unknownFrame, 'KSampler');
  assert.strictEqual(result.kind, 'ignore', 'Expected unknown event type to be ignored');

  const unknownOutputFrame = makeFrame(255, 2, 32);
  const resultOutput = classifyBinaryFrame(unknownOutputFrame, 'SaveImageWebsocket');
  assert.strictEqual(resultOutput.kind, 'ignore', 'Expected unknown event type to be ignored even for SaveImageWebsocket');
}

console.log('All WebSocket binary frame assertions passed.');
