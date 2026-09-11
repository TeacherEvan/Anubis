# ANUBIS Recording Service — Implementation Plan

**Date:** 2026-09-11
**Repo:** TeacherEvan/Anubis
**Scope:** Recording service (microservice #2 of the Anubis Guardian platform)
**Status:** IN PROGRESS

---

## Context

The Anubis Guardian platform is a self-hosted surveillance system. The camera
discovery service (`anubis-guardian/services/camera-service/`) is implemented
and tested. The next logical microservice is the **Recording Service**, which
captures RTSP/HTTP camera streams and stores them as time-segmented MP4 files
on local disk.

The README checklist marks "Recording service implementation (no code on
disk)" as not-started. This plan implements it.

---

## Objectives

| ID | Objective | Requirement | Acceptance Criteria | Validation |
|----|-----------|-------------|---------------------|------------|
| OBJ-001 | Create `recording-service` package skeleton | REQ-REC-001 | `package.json` with `node --test` script, `index.js` exporting `recordStream`, `stopRecording`, `listRecordings`, `getRecording` | `npm test` passes export test |
| OBJ-002 | Implement `recordStream(camera, options)` | REQ-REC-002 | Accepts camera object `{ip, port, streamUrl, type}` + options `{duration, outputPath}`; spawns FFmpeg subprocess; returns `{recordingId, process, promise}`; resolves with `{recordingId, filePath, duration, size}` on completion or rejects on FFmpeg error | Unit test with mocked FFmpeg + integration test against a synthetic RTSP source |
| OBJ-003 | Implement `stopRecording(recordingId)` | REQ-REC-003 | Kills the FFmpeg subprocess gracefully (SIGTERM → SIGKILL after 3s); removes partial file if aborted; resolves `{recordingId, stoppedAt, partial}` | Unit test with mocked process |
| OBJ-004 | Implement `listRecordings(cameraIp, options)` | REQ-REC-004 | Scans output directory for MP4 files matching camera IP pattern; returns array sorted by start time descending; supports `limit` and `offset` pagination | Unit test with temp directory of fixture files |
| OBJ-005 | Implement `getRecording(recordingId)` | REQ-REC-005 | Returns single recording metadata object `{recordingId, cameraIp, filePath, startTime, duration, size}` or `null` if not found | Unit test |
| OBJ-006 | Implement storage management (rotation/cleanup) | REQ-REC-006 | `cleanupOldRecordings(cameraIp, maxAgeDays)` deletes recordings older than N days; `getStorageUsage(cameraIp)` returns `{totalBytes, fileCount, oldest, newest}` | Unit test with temp files |
| OBJ-007 | Add integration test with real FFmpeg | REQ-REC-007 | `recording-service.test.js` includes a test that runs actual FFmpeg against a generated test pattern (lavfi source) for <=2s, verifies MP4 output exists and is >0 bytes | `npm test` green |
| OBJ-008 | Wire Docker image to include recording-service | REQ-REC-008 | Dockerfile copies recording-service files; `docker build` succeeds; container runs `node index.js` | `docker build` exit 0 |
| OBJ-009 | Update README checklist | REQ-DOC-001 | README "Not Yet Started" -> recording service marked `[x]` with note | README diff |

---

## Non-Functional Requirements

- **NFR-001**: FFmpeg subprocess must be spawned with `stdio: 'ignore'` or piped to avoid blocking the event loop.
- **NFR-002**: Recording files named `{cameraIp}_{YYYYMMDD_HHMMSS}_{duration}s.mp4`.
- **NFR-003**: Output directory configurable via `OUTPUT_DIR` env var, default `./recordings`.
- **NFR-004**: Maximum 5 concurrent recordings per service instance.
- **NFR-005**: All paths validated to prevent directory traversal (`..` rejection).

---

## Assumptions

- FFmpeg 6.1+ is installed on the host (verified: `/usr/bin/ffmpeg`).
- Camera objects have the shape produced by `camera-service`:
  `{ip, port, streamUrl, type, brand, model}`.
- Recordings are stored on local disk (no cloud storage in this phase).
