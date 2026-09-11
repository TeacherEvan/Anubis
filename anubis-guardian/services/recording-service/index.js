'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(os.tmpdir(), 'anubis-recordings');
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_RECORDINGS, 10) || 5;
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

const activeRecordings = new Map();

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

function sanitizeIp(ip) {
  return String(ip).replace(/[^0-9.]/g, '');
}

function buildRecordingFilename(cameraIp, duration) {
  const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 15);
  const safe = sanitizeIp(cameraIp);
  return `${safe}_${ts}_${duration}s.mp4`;
}

function buildFfmpegArgs(camera, outputPath, duration) {
  const inputUrl = camera.streamUrl || `rtsp://${camera.ip}:${camera.port}/live`;
  const args = ['-y'];
  if (camera.type === 'lavfi') {
    args.push('-f', 'lavfi', '-i', inputUrl);
  } else {
    args.push('-rtsp_transport', 'tcp');
    args.push('-i', inputUrl);
  }
  args.push('-t', String(duration));
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', '-f', 'mp4', outputPath);
  return args;
}

function recordStream(camera, options = {}) {
  if (!camera || typeof camera !== 'object') return Promise.reject(new Error('camera object required'));
  const { duration = 60, outputPath = OUTPUT_DIR } = options;
  if (activeRecordings.size >= MAX_CONCURRENT) {
    return Promise.reject(new Error(`Max concurrent recordings (${MAX_CONCURRENT}) reached`));
  }
  ensureOutputDir();
  const filename = buildRecordingFilename(camera.ip, duration);
  const fullPath = path.resolve(outputPath, filename);
  if (fullPath !== path.resolve(OUTPUT_DIR) && !fullPath.startsWith(path.resolve(OUTPUT_DIR) + path.sep)) {
    return Promise.reject(new Error('Output path escapes recording directory'));
  }
  const recordingId = `${sanitizeIp(camera.ip)}_${Date.now()}`;
  const args = buildFfmpegArgs(camera, fullPath, duration);
  const proc = spawn(FFMPEG_PATH, args, { stdio: 'ignore' });
  const promise = new Promise((resolve, reject) => {
    let settled = false;
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      activeRecordings.delete(recordingId);
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
    proc.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      activeRecordings.delete(recordingId);
      if (code === 0) {
        try {
          const stats = fs.statSync(fullPath);
          resolve({
            recordingId,
            filePath: fullPath,
            duration,
            size: stats.size,
            cameraIp: camera.ip
          });
        } catch (e) {
          reject(new Error(`Recording file missing after success: ${e.message}`));
        }
      } else {
        try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch (_) {}
        reject(new Error(`FFmpeg exited with code ${code}, signal ${signal}`));
      }
    });
  });
  activeRecordings.set(recordingId, { proc, camera, fullPath, promise });
  return { recordingId, process: proc, promise };
}

function stopRecording(recordingId) {
  const entry = activeRecordings.get(recordingId);
  if (!entry) return Promise.reject(new Error(`Recording not found: ${recordingId}`));
  return new Promise((resolve) => {
    const { proc, fullPath } = entry;
    let killed = false;
    const timer = setTimeout(() => {
      if (!killed) { killed = true; try { proc.kill('SIGKILL'); } catch (_) {} }
    }, 3000);
    proc.kill('SIGTERM');
    proc.on('close', () => {
      clearTimeout(timer);
      activeRecordings.delete(recordingId);
      const partial = fs.existsSync(fullPath);
      try { if (partial) fs.unlinkSync(fullPath); } catch (_) {}
      resolve({ recordingId, stoppedAt: new Date().toISOString(), partial });
    });
  });
}

function listRecordings(cameraIp, options = {}) {
  const { limit = 50, offset = 0 } = options;
  ensureOutputDir();
  const safe = sanitizeIp(cameraIp);
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith(safe) && f.endsWith('.mp4'))
    .map(f => {
      const fp = path.join(OUTPUT_DIR, f);
      const stats = fs.statSync(fp);
      return { filename: f, filePath: fp, size: stats.size, mtime: stats.mtime };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(offset, offset + limit);
  return files;
}

function getRecording(recordingId) {
  ensureOutputDir();
  const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.mp4'));
  for (const f of files) {
    if (f.includes(recordingId) || recordingId === f) {
      const fp = path.join(OUTPUT_DIR, f);
      const stats = fs.statSync(fp);
      return { recordingId, filename: f, filePath: fp, size: stats.size, mtime: stats.mtime };
    }
  }
  return null;
}

function cleanupOldRecordings(cameraIp, maxAgeDays) {
  ensureOutputDir();
  const safe = sanitizeIp(cameraIp);
  const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
  let deleted = 0;
  const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.startsWith(safe) && f.endsWith('.mp4'));
  for (const f of files) {
    const fp = path.join(OUTPUT_DIR, f);
    const stats = fs.statSync(fp);
    if (stats.mtime.getTime() < cutoff) {
      fs.unlinkSync(fp);
      deleted++;
    }
  }
  return { deleted, cameraIp: safe };
}

function getStorageUsage(cameraIp) {
  ensureOutputDir();
  const safe = sanitizeIp(cameraIp);
  const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.startsWith(safe) && f.endsWith('.mp4'));
  let totalBytes = 0;
  let oldest = null;
  let newest = null;
  for (const f of files) {
    const fp = path.join(OUTPUT_DIR, f);
    const stats = fs.statSync(fp);
    totalBytes += stats.size;
    if (!oldest || stats.mtime < oldest) oldest = stats.mtime;
    if (!newest || stats.mtime > newest) newest = stats.mtime;
  }
  return { totalBytes, fileCount: files.length, oldest, newest };
}

module.exports = {
  recordStream,
  stopRecording,
  listRecordings,
  getRecording,
  cleanupOldRecordings,
  getStorageUsage
};
