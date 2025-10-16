import assert from 'node:assert/strict';
import test from 'node:test';

import { computeExportBaseSize } from '../src/exportSizing.mjs';

test('prefers video export dimensions over preview frame size', () => {
  const size = computeExportBaseSize({
    sourceKind: 'video',
    videoSource: { exportWidth: 1280, exportHeight: 720 },
    lastResult: {
      type: 'video',
      frames: [{ outputWidth: 360, outputHeight: 202 }]
    },
    sourceWidth: 360,
    sourceHeight: 202,
    lastSize: { width: 360, height: 202 }
  });
  assert.deepEqual(size, { width: 1280, height: 720 });
});

test('uses image result dimensions when available', () => {
  const size = computeExportBaseSize({
    sourceKind: 'image',
    lastResult: {
      type: 'image',
      frame: { outputWidth: 512, outputHeight: 384 }
    },
    sourceWidth: 400,
    sourceHeight: 300
  });
  assert.deepEqual(size, { width: 512, height: 384 });
});

test('falls back to source size then default when needed', () => {
  const fromSource = computeExportBaseSize({
    sourceKind: 'image',
    sourceWidth: 640,
    sourceHeight: 480
  });
  assert.deepEqual(fromSource, { width: 640, height: 480 });

  const fallback = computeExportBaseSize({});
  assert.deepEqual(fallback, { width: 1024, height: 1024 });
});
