import { fetchFile } from '@ffmpeg/util';

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
 * Concatenate MP4s in order. Canvas = max(w) x max(h); each clip is pad-centered, not scaled.
 *
 * @param {import('@ffmpeg/ffmpeg').FFmpeg} ffmpeg
 * @param {File[]} files at least 2
 * @param {{ width: number; height: number }} canvas
 * @param {{ onProgress?: (p: number) => void; onLog?: (s: string) => void; signal?: AbortSignal }} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function mergeManyMp4CenterPad(ffmpeg, files, canvas, opts = {}) {
  const { onProgress, onLog, signal } = opts;
  const n = files.length;
  if (n < 2) throw new Error('At least 2 videos are required to merge');

  const W = Math.max(1, Math.round(canvas.width));
  const H = Math.max(1, Math.round(canvas.height));
  const pad = `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p,setsar=1`;
  const outName = 'merge_out.mp4';
  const inNames = [];

  for (let i = 0; i < n; i++) {
    const name = `merge_in${i}.mp4`;
    onLog?.(`Loading clip ${i + 1}/${n}…`);
    onProgress?.(0.02 + (i / n) * 0.28);
    await ffmpeg.writeFile(name, await fetchFile(files[i]));
    inNames.push(name);
  }

  const buildFc = (withAudio) => {
    const vf = [];
    for (let i = 0; i < n; i++) {
      vf.push(`[${i}:v]${pad}[v${i}]`);
      if (withAudio) {
        vf.push(
          `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`,
        );
      }
    }
    let concatIn = '';
    for (let i = 0; i < n; i++) {
      concatIn += withAudio ? `[v${i}][a${i}]` : `[v${i}]`;
    }
    if (withAudio) {
      vf.push(`${concatIn}concat=n=${n}:v=1:a=1[outv][outa]`);
    } else {
      vf.push(`${concatIn}concat=n=${n}:v=1:a=0[outv]`);
    }
    return vf.join(';');
  };

  const inputArgs = files.flatMap((_, i) => ['-i', `merge_in${i}.mp4`]);

  const runWithAudio = async () => {
    onLog?.(`Merging ${n} clips with audio…`);
    onProgress?.(0.35);
    await ffmpeg.exec(
      [
        '-y',
        ...inputArgs,
        '-filter_complex',
        buildFc(true),
        '-map',
        '[outv]',
        '-map',
        '[outa]',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '18',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        outName,
      ],
      -1,
      execSig(signal),
    );
  };

  const runVideoOnly = async () => {
    await safeDelete(ffmpeg, outName);
    onLog?.('Merging video only (no usable audio on one or more inputs)…');
    onProgress?.(0.4);
    await ffmpeg.exec(
      [
        '-y',
        ...inputArgs,
        '-filter_complex',
        buildFc(false),
        '-map',
        '[outv]',
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '18',
        '-movflags',
        '+faststart',
        outName,
      ],
      -1,
      execSig(signal),
    );
  };

  try {
    await runWithAudio();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    onLog?.(`Audio merge failed, retrying video-only: ${msg}`);
    await runVideoOnly();
  }

  onProgress?.(0.95);
  const out = await ffmpeg.readFile(outName);
  const buf = out instanceof Uint8Array ? out : new Uint8Array(out);

  for (const name of inNames) await safeDelete(ffmpeg, name);
  await safeDelete(ffmpeg, outName);

  onProgress?.(1);
  return buf;
}

/** @deprecated Use mergeManyMp4CenterPad */
export async function mergeTwoMp4CenterPad(ffmpeg, fileA, fileB, canvas, opts = {}) {
  return mergeManyMp4CenterPad(ffmpeg, [fileA, fileB], canvas, opts);
}
