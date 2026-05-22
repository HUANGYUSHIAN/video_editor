import { fetchFile } from '@ffmpeg/util';
import { editedDuration } from '../utils/segments.js';

/**
 * @param {{ start: number; end: number }[]} segments
 * @param {boolean} hasAudio
 */
export function buildFilterComplex(segments, hasAudio) {
  const n = segments.length;
  if (n === 0) throw new Error('沒有可輸出的片段');

  const vf = [];
  for (let i = 0; i < n; i++) {
    const { start, end } = segments[i];
    vf.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`);
    if (hasAudio) {
      vf.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`);
    }
  }

  if (n === 1) {
    return {
      complex: vf.join(';'),
      maps: hasAudio ? ['-map', '[v0]', '-map', '[a0]'] : ['-map', '[v0]'],
    };
  }

  let concatIn = '';
  for (let i = 0; i < n; i++) {
    concatIn += hasAudio ? `[v${i}][a${i}]` : `[v${i}]`;
  }
  if (hasAudio) {
    vf.push(`${concatIn}concat=n=${n}:v=1:a=1[outv][outa]`);
    return { complex: vf.join(';'), maps: ['-map', '[outv]', '-map', '[outa]'] };
  }
  vf.push(`${concatIn}concat=n=${n}:v=1:a=0[outv]`);
  return { complex: vf.join(';'), maps: ['-map', '[outv]'] };
}

/**
 * @param {{ start: number; end: number }[]} segments
 */
function normalizeSegments(segments) {
  return [...segments]
    .map((s) => ({
      start: Math.max(0, Number(s.start)),
      end: Math.max(0, Number(s.end)),
    }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
}

/**
 * Stream copy (-c copy) only cuts on keyframes. Short edits (e.g. ~2s) often fall
 * inside one GOP, so the removed range still appears in the exported file.
 */
export function needsFrameAccurateExport(sorted, sourceDuration = 0) {
  if (sorted.length > 1) return true;
  if (sorted.length === 1) {
    const s = sorted[0];
    if (s.start > 0.01) return true;
    if (sourceDuration > 0 && s.end < sourceDuration - 0.01) return true;
  }
  return false;
}

/**
 * @param {import('@ffmpeg/ffmpeg').FFmpeg} ffmpeg
 * @param {string} name
 */
async function safeDelete(ffmpeg, name) {
  await ffmpeg.deleteFile(name).catch(() => {});
}

/** @param {AbortSignal | undefined} s */
function execSig(s) {
  return s ? { signal: s } : {};
}

/**
 * 從 ffmpeg 統計行推算輸出時間進度（僅重編碼時較常出現）。
 * @param {string} message
 * @param {number} totalOutSec
 */
function parseTimeProgress(message, totalOutSec) {
  const m = message.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m || totalOutSec <= 0) return null;
  const sec = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
  return Math.min(1, Math.max(0, sec / totalOutSec));
}

/**
 * 串流複製：不重新編碼，只裁切與接回（同為 MP4 時通常極快）。
 * 起點可能落在最近關鍵幀（與專業「無重編碼裁切」行為一致）。
 *
 * @param {import('@ffmpeg/ffmpeg').FFmpeg} ffmpeg
 * @param {string} inputName
 * @param {{ start: number; end: number }[]} sorted
 * @param {string} outputName
 * @param {{ onProgress?: (p: number) => void; onLog?: (s: string) => void; signal?: AbortSignal }} [opts]
 */
async function exportWithStreamCopy(ffmpeg, inputName, sorted, outputName, opts = {}) {
  const { onProgress, onLog, signal } = opts;
  const n = sorted.length;

  if (n === 1) {
    const { start, end } = sorted[0];
    const dur = end - start;
    onProgress?.(0.05);
    onLog?.('使用串流複製（無重編碼）…');
    await ffmpeg.exec(
      [
        '-y',
        '-ss',
        String(start),
        '-i',
        inputName,
        '-t',
        String(dur),
        '-c',
        'copy',
        '-avoid_negative_ts',
        'make_zero',
        outputName,
      ],
      -1,
      execSig(signal),
    );
    onProgress?.(1);
    return;
  }

  const parts = [];
  for (let i = 0; i < n; i++) {
    const { start, end } = sorted[i];
    const dur = end - start;
    const part = `part${i}.mp4`;
    onProgress?.((i / n) * 0.85);
    onLog?.(`串流複製片段 ${i + 1}/${n}…`);
    await ffmpeg.exec(
      [
        '-y',
        '-ss',
        String(start),
        '-i',
        inputName,
        '-t',
        String(dur),
        '-c',
        'copy',
        '-avoid_negative_ts',
        'make_zero',
        part,
      ],
      -1,
      execSig(signal),
    );
    parts.push(part);
  }

  const listBody = parts.map((p) => `file '${p}'`).join('\n');
  await ffmpeg.writeFile('concat.txt', new TextEncoder().encode(listBody));
  onProgress?.(0.88);
  onLog?.('串接片段（無重編碼）…');
  await ffmpeg.exec(
    [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'concat.txt',
      '-c',
      'copy',
      '-fflags',
      '+genpts',
      outputName,
    ],
    -1,
    execSig(signal),
  );

  for (const p of parts) await safeDelete(ffmpeg, p);
  await safeDelete(ffmpeg, 'concat.txt');
  onProgress?.(1);
}

/**
 * @param {import('@ffmpeg/ffmpeg').FFmpeg} ffmpeg
 * @param {string} inputName
 * @param {{ start: number; end: number }[]} sorted
 * @param {string} outputName
 * @param {{ onProgress?: (p: number) => void; onLog?: (s: string) => void; signal?: AbortSignal }} [opts]
 */
async function execReencode(ffmpeg, inputName, sorted, outputName, opts = {}) {
  const { onProgress, onLog, signal } = opts;
  const totalOutSec = editedDuration(sorted);

  const logHandler = ({ message }) => {
    onLog?.(message);
    const p = parseTimeProgress(message, totalOutSec);
    if (p != null) onProgress?.(p);
  };
  ffmpeg.on('log', logHandler);

  const videoArgsH264 = ['-c:v', 'libx264', '-crf', '28', '-preset', 'ultrafast'];

  const run = async (hasAudio, vargs) => {
    const { complex, maps } = buildFilterComplex(sorted, hasAudio);
    const args = ['-y', '-i', inputName, '-filter_complex', complex, ...maps, ...vargs];
    if (hasAudio) args.push('-c:a', 'aac', '-b:a', '128k');
    args.push('-movflags', '+faststart', outputName);
    onLog?.(hasAudio ? '重編碼（含音訊）…' : '重編碼（僅影像）…');
    await ffmpeg.exec(args, -1, execSig(signal));
  };

  try {
    try {
      await run(true, videoArgsH264);
    } catch {
      await run(false, videoArgsH264);
    }
  } catch {
    await run(false, ['-c:v', 'mpeg4', '-q:v', '6']);
  } finally {
    ffmpeg.off('log', logHandler);
  }
  onProgress?.(1);
}

/**
 * @param {import('@ffmpeg/ffmpeg').FFmpeg} ffmpeg
 * @param {File} file
 * @param {{ start: number; end: number }[]} segments
 * @param {{ onProgress?: (p: number) => void; onLog?: (s: string) => void; signal?: AbortSignal }} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function exportSegmentsToMp4(ffmpeg, file, segments, opts = {}) {
  const rawExt = (file.name.split('.').pop() || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
  const inputName = `src.${rawExt}`;
  const outputName = 'out.mp4';
  const sourceDuration = Number(opts.sourceDuration) || 0;

  await ffmpeg.writeFile(inputName, await fetchFile(file));

  const sorted = normalizeSegments(segments);
  if (sorted.length === 0) {
    await safeDelete(ffmpeg, inputName);
    throw new Error('沒有有效的時間片段');
  }

  const wmvLike =
    /\.(wmv|asf)$/i.test(file.name) || /wmv|ms-asf/i.test(file.type || '');
  const frameAccurate = needsFrameAccurateExport(sorted, sourceDuration);

  try {
    if (wmvLike || frameAccurate) {
      if (frameAccurate && !wmvLike) {
        opts.onLog?.('使用精確裁切匯出（有刪除片段時無法僅串流複製）…');
      } else {
        opts.onLog?.('WMV/ASF 無法串流複製成 MP4，直接重編碼匯出…');
      }
      opts.onProgress?.(0);
      await execReencode(ffmpeg, inputName, sorted, outputName, opts);
    } else {
      try {
        await exportWithStreamCopy(ffmpeg, inputName, sorted, outputName, {
          onProgress: opts.onProgress,
          onLog: opts.onLog,
          signal: opts.signal,
        });
      } catch (e) {
        for (let i = 0; i < 32; i++) await safeDelete(ffmpeg, `part${i}.mp4`);
        await safeDelete(ffmpeg, 'concat.txt');
        await safeDelete(ffmpeg, outputName);
        const msg = e instanceof Error ? e.message : String(e);
        opts.onLog?.(`串流複製失敗，改為重編碼（WebAssembly 會很慢）：${msg}`);
        opts.onProgress?.(0);
        await execReencode(ffmpeg, inputName, sorted, outputName, opts);
      }
    }

    const out = await ffmpeg.readFile(outputName);
    const buf = out instanceof Uint8Array ? out : new Uint8Array(out);
    await safeDelete(ffmpeg, inputName);
    await safeDelete(ffmpeg, outputName);
    return buf;
  } catch (err) {
    await safeDelete(ffmpeg, inputName);
    await safeDelete(ffmpeg, outputName);
    for (let i = 0; i < 16; i++) await safeDelete(ffmpeg, `part${i}.mp4`);
    await safeDelete(ffmpeg, 'concat.txt');
    throw err;
  }
}
