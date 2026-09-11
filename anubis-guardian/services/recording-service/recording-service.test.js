'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-rec-test-'));
process.env.OUTPUT_DIR = TMP;
const mod = require(path.resolve(__dirname, 'index.js'));

const camera = { ip: '192.168.1.10', port: 554, streamUrl: 'rtsp://192.168.1.10:554/live', type: 'rtsp', brand: 'FNK', model: 'Cam' };

test('exports required functions', () => {
  assert.strictEqual(typeof mod.recordStream, 'function');
  assert.strictEqual(typeof mod.stopRecording, 'function');
  assert.strictEqual(typeof mod.listRecordings, 'function');
  assert.strictEqual(typeof mod.getRecording, 'function');
  assert.strictEqual(typeof mod.cleanupOldRecordings, 'function');
  assert.strictEqual(typeof mod.getStorageUsage, 'function');
});

test('listRecordings returns empty array when no recordings', () => {
  const result = mod.listRecordings(camera.ip);
  assert.strictEqual(Array.isArray(result), true);
  assert.strictEqual(result.length, 0);
});

test('getStorageUsage returns zero counts when empty', () => {
  const usage = mod.getStorageUsage(camera.ip);
  assert.strictEqual(usage.totalBytes, 0);
  assert.strictEqual(usage.fileCount, 0);
});

test('getRecording returns null for unknown id', () => {
  const result = mod.getRecording('nonexistent_id_12345');
  assert.strictEqual(result, null);
});

test('stopRecording rejects for unknown id', async () => {
  await assert.rejects(mod.stopRecording('unknown_id'), /Recording not found/);
});

test('recordStream rejects when output path escapes', async () => {
  await assert.rejects(
    mod.recordStream(camera, { duration: 1, outputPath: '../../etc' }),
    /escapes recording directory/
  );
});

test('recordStream rejects with bad camera shape', async () => {
  await assert.rejects(mod.recordStream(null, { duration: 1 }), /camera object required/);
});

test('getStorageUsage after cleanup returns zeros', () => {
  mod.cleanupOldRecordings(camera.ip, 365);
  const usage = mod.getStorageUsage(camera.ip);
  assert.strictEqual(usage.fileCount, 0);
});

test('recordStream rejects zero or negative duration', async () => {
  await assert.rejects(mod.recordStream(camera, { duration: 0 }), /duration must be a positive number/);
  await assert.rejects(mod.recordStream(camera, { duration: -5 }), /duration must be a positive number/);
  await assert.rejects(mod.recordStream(camera, { duration: 'abc' }), /duration must be a positive number/);
});

test('recordStream rejects NaN duration', async () => {
  await assert.rejects(mod.recordStream(camera, { duration: NaN }), /duration must be a positive number/);
});

// OBJ-007 / REQ-REC-007: integration test with real FFmpeg (lavfi test pattern)
test('recordStream captures a 1s lavfi test pattern to a real MP4', async () => {
  const srcCamera = { ip: '127.0.0.1', port: 9999, streamUrl: 'testsrc=duration=1:size=320x240:rate=10', type: 'lavfi' };
  const result = await mod.recordStream(srcCamera, { duration: 1, outputPath: TMP }).promise;
  assert.ok(result.filePath.endsWith('.mp4'), 'expected .mp4 extension');
  assert.ok(fs.existsSync(result.filePath), 'expected output file to exist');
  const stats = fs.statSync(result.filePath);
  assert.ok(stats.size > 0, 'expected non-empty file');
  assert.strictEqual(typeof result.recordingId, 'string');
  assert.strictEqual(result.cameraIp, '127.0.0.1');
  fs.unlinkSync(result.filePath);
}, { timeout: 15000 });
