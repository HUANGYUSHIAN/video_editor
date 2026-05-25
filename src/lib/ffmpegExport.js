import { fetchFile } from '@ffmpeg/util';
import {
  canPreserveSubtitleTracks,
  computeScaledDimensions,
  needsScaleExport,
  parseExportMaxEdge,
  scaleFilterForMaxEdge,
  scaledDimensionsLabel,
} from './resolution.js';
import { volumeGainFromPercent } from './volume.js';
import { editedDuration } from '../utils/segments.js';

/**
 * @param {{ start: number; end: number }[]} segments
 * @param {boolean} hasAudio
 * @param {number} [volumeGain] linear multiplier (e.g. 2 for 200%)
 * @param {string | null} [scaleFilter] ffmpeg scale filter (long-edge downscale)
 */
export function buildFilterComplex(segments, hasAudio, volumeGain = 1, scaleFilter = null) {
  const n = segments.length;
  if (n === 0) throw new Error('沒有可輸出的片段');

  const vol =
    volumeGain === 1 ? '' : `,volume=${volumeGain === 0 ? '0' : volumeGain}`;
  const scale = scaleFilter || null;

  const vf = [];
  for (let i = 0; i < n; i++) {
    const { start, end } = segments[i];
    if (scale && n === 1) {
      vf.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v0t]`);
      vf.push(`[v0t]${scale}[v0]`);
    } else {
      vf.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`);
    }
    if (hasAudio) {
      vf.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS${vol}[a${i}]`);
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
    if (scale) {
      vf.push(`${concatIn}concat=n=${n}:v=1:a=1[outvt][outa]`);
      vf.push(`[outvt]${scale}[outv]`);
      return { complex: vf.join(';'), maps: ['-map', '[outv]', '-map', '[outa]'] };
    }
    vf.push(`${concatIn}concat=n=${n}:v=1:a=1[outv][outa]`);
    return { complex: vf.join(';'), maps: ['-map', '[outv]', '-map', '[outa]'] };
  }
  if (scale) {
    vf.push(`${concatIn}concat=n=${n}:v=1:a=0[outvt]`);
    vf.push(`[outvt]${scale}[outv]`);
    return { complex: vf.join(';'), maps: ['-map', '[outv]'] };
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
 * @param {boolean} preserveSubs
 */
function streamCopyMaps(preserveSubs) {
  if (preserveSubs) {
    return ['-map', '0:v', '-map', '0:a?', '-map', '0:s?', '-c', 'copy', '-c:s', 'copy'];
  }
  return ['-c', 'copy'];
}

/**
 * @param {import('@ffmpeg/ffmpeg').FFmpeg} ffmpeg
 * @param {string} inputName
 * @param {{ start: number; end: number }[]} sorted
 * @param {string} outputName
 * @param {{ onProgress?: (p: number) => void; onLog?: (s: string) => void; signal?: AbortSignal; sourceDuration?: number }} [opts]
 */
async function exportWithStreamCopy(ffmpeg, inputName, sorted, outputName, opts = {}) {
  const { onProgress, onLog, signal } = opts;
  const n = sorted.length;
  const preserveSubs = canPreserveSubtitleTracks(sorted, opts.sourceDuration ?? 0);
  const copyTail = streamCopyMaps(preserveSubs);

  if (n === 1) {
    const { start, end } = sorted[0];
    const dur = end - start;
    onProgress?.(0.05);
    onLog?.(
      preserveSubs
        ? '使用串流複製（無重編碼，保留字幕軌）…'
        : '使用串流複製（無重編碼）…',
    );
    await ffmpeg.exec(
      [
        '-y',
        '-ss',
        String(start),
        '-i',
        inputName,
        '-t',
        String(dur),
        ...copyTail,
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
  onLog?.('串接片段（無重編碼；多段匯出不含字幕軌）…');
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
 * @param {{ onProgress?: (p: number) => void; onLog?: (s: string) => void; signal?: AbortSignal; sourceDuration?: number; volumePercent?: number; volumeGain?: number; scaleFilter?: string | null; outputMaxEdge?: number | null; sourceVideoWidth?: number; sourceVideoHeight?: number }} [opts]
 */
async function execReencode(ffmpeg, inputName, sorted, outputName, opts = {}) {
  const { onProgress, onLog, signal } = opts;
  const totalOutSec = editedDuration(sorted);
  const volumeGain =
    typeof opts.volumeGain === 'number' ? opts.volumeGain : volumeGainFromPercent(opts.volumePercent ?? 100);
  const scaleFilter = opts.scaleFilter ?? null;
  const outputMaxEdge = opts.outputMaxEdge ?? null;
  const preserveSubs =
    canPreserveSubtitleTracks(sorted, opts.sourceDuration ?? 0) && !scaleFilter;

  const logHandler = ({ message }) => {
    onLog?.(message);
    const p = parseTimeProgress(message, totalOutSec);
    if (p != null) onProgress?.(p);
  };
  ffmpeg.on('log', logHandler);

  const videoArgsH264 = ['-c:v', 'libx264', '-crf', '28', '-preset', 'ultrafast'];

  const run = async (hasAudio, vargs) => {
    const { complex, maps } = buildFilterComplex(sorted, hasAudio, volumeGain, scaleFilter);
    const args = ['-y', '-i', inputName, '-filter_complex', complex, ...maps];
    if (preserveSubs) {
      args.push('-map', '0:s?', '-c:s', 'copy');
    }
    args.push(...vargs);
    if (hasAudio) args.push('-c:a', 'aac', '-b:a', '128k');
    args.push('-movflags', '+faststart', outputName);
    if (outputMaxEdge && scaleFilter) {
      const label = scaledDimensionsLabel(
        outputMaxEdge,
        opts.sourceVideoWidth ?? 0,
        opts.sourceVideoHeight ?? 0,
      );
      onLog?.(`重編碼（長邊 ${outputMaxEdge}px → ${label || '縮放'}）…`);
    } else if (preserveSubs) {
      onLog?.('重編碼（含音訊，保留字幕軌）…');
    } else if (hasAudio) {
      onLog?.('重編碼（含音訊）…');
    } else {
      onLog?.('重編碼（僅影像）…');
    }
    if (!preserveSubs && sorted.length > 1) {
      onLog?.('已裁切多段：內嵌字幕軌無法對齊，已略過字幕。');
    } else if (!preserveSubs && scaleFilter) {
      onLog?.('縮放輸出：內嵌字幕軌未保留（軟字幕請用燒錄或外部字幕）。');
    }
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
 * @param {{ onProgress?: (p: number) => void; onLog?: (s: string) => void; signal?: AbortSignal; sourceDuration?: number; sourceVideoWidth?: number; sourceVideoHeight?: number; exportResolution?: string; volumePercent?: number }} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function exportSegmentsToMp4(ffmpeg, file, segments, opts = {}) {
  const rawExt = (file.name.split('.').pop() || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
  const inputName = `src.${rawExt}`;
  const outputName = 'out.mp4';
  const sourceDuration = Number(opts.sourceDuration) || 0;
  const sourceVideoWidth = Number(opts.sourceVideoWidth) || 0;
  const sourceVideoHeight = Number(opts.sourceVideoHeight) || 0;
  const outputMaxEdge = parseExportMaxEdge(
    opts.exportResolution,
    sourceVideoWidth,
    sourceVideoHeight,
  );
  const scaleFilter =
    outputMaxEdge != null
      ? scaleFilterForMaxEdge(outputMaxEdge, sourceVideoWidth, sourceVideoHeight)
      : null;

  await ffmpeg.writeFile(inputName, await fetchFile(file));

  const sorted = normalizeSegments(segments);
  if (sorted.length === 0) {
    await safeDelete(ffmpeg, inputName);
    throw new Error('沒有有效的時間片段');
  }

  const wmvLike =
    /\.(wmv|asf)$/i.test(file.name) || /wmv|ms-asf/i.test(file.type || '');
  const volumeGain = volumeGainFromPercent(opts.volumePercent ?? 100);
  const needsVolume = volumeGain !== 1;
  const needsScale = needsScaleExport(
    opts.exportResolution,
    sourceVideoWidth,
    sourceVideoHeight,
  );

  const reencodeOpts = {
    ...opts,
    volumeGain,
    scaleFilter,
    outputMaxEdge,
    sourceDuration,
    sourceVideoWidth,
    sourceVideoHeight,
  };

  try {
    if (wmvLike || needsVolume || needsScale) {
      if (needsScale && !wmvLike && !needsVolume) {
        const dims = computeScaledDimensions(
          sourceVideoWidth,
          sourceVideoHeight,
          outputMaxEdge,
        );
        const sizeText = dims ? `${dims.width}×${dims.height}` : '縮放';
        opts.onLog?.(`長邊縮至 ${outputMaxEdge}px（${sizeText}）並匯出…`);
      } else if (needsVolume && !wmvLike) {
        opts.onLog?.('套用音量調整，使用重編碼匯出…');
      } else {
        opts.onLog?.('WMV/ASF 無法串流複製成 MP4，直接重編碼匯出…');
      }
      opts.onProgress?.(0);
      await execReencode(ffmpeg, inputName, sorted, outputName, reencodeOpts);
    } else {
      try {
        await exportWithStreamCopy(ffmpeg, inputName, sorted, outputName, {
          onProgress: opts.onProgress,
          onLog: opts.onLog,
          signal: opts.signal,
          sourceDuration,
        });
      } catch (e) {
        for (let i = 0; i < 32; i++) await safeDelete(ffmpeg, `part${i}.mp4`);
        await safeDelete(ffmpeg, 'concat.txt');
        await safeDelete(ffmpeg, outputName);
        const msg = e instanceof Error ? e.message : String(e);
        opts.onLog?.(`串流複製失敗，改為重編碼（WebAssembly 會很慢）：${msg}`);
        opts.onProgress?.(0);
        await execReencode(ffmpeg, inputName, sorted, outputName, reencodeOpts);
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
