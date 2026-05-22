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
 * Concatenate two MP4s: full file 1 then full file 2. Canvas = max(w1,w2) x max(h1,h2);
 * each video is only padded (centered), not scaled.
 *
 * @param {import('@ffmpeg/ffmpeg').FFmpeg} ffmpeg
 * @param {File} fileA
 * @param {File} fileB
 * @param {{ width: number; height: number }} canvas
 * @param {{ onProgress?: (p: number) => void; onLog?: (s: string) => void; signal?: AbortSignal }} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function mergeTwoMp4CenterPad(ffmpeg, fileA, fileB, canvas, opts = {}) {
  const { onProgress, onLog, signal } = opts;
  const W = Math.max(1, Math.round(canvas.width));
  const H = Math.max(1, Math.round(canvas.height));
  const in0 = 'merge_in0.mp4';
  const in1 = 'merge_in1.mp4';
  const outName = 'merge_out.mp4';

  await ffmpeg.writeFile(in0, await fetchFile(fileA));
  await ffmpeg.writeFile(in1, await fetchFile(fileB));
  onProgress?.(0.05);

  const pad = `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p,setsar=1`;

  const runWithAudio = async () => {
    const fc = `[0:v]${pad}[v0];[1:v]${pad}[v1];[0:a]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a0];[1:a]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]`;
    onLog?.('Merging with audio…');
    await ffmpeg.exec(
      [
        '-y',
        '-i',
        in0,
        '-i',
        in1,
        '-filter_complex',
        fc,
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
    const fc = `[0:v]${pad}[v0];[1:v]${pad}[v1];[v0][v1]concat=n=2:v=1:a=0[outv]`;
    onLog?.('Merging video only (no usable audio on one or both inputs)…');
    await ffmpeg.exec(
      [
        '-y',
        '-i',
        in0,
        '-i',
        in1,
        '-filter_complex',
        fc,
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
    onProgress?.(0.35);
    await runVideoOnly();
  }

  onProgress?.(0.95);
  const out = await ffmpeg.readFile(outName);
  const buf = out instanceof Uint8Array ? out : new Uint8Array(out);

  await safeDelete(ffmpeg, in0);
  await safeDelete(ffmpeg, in1);
  await safeDelete(ffmpeg, outName);

  onProgress?.(1);
  return buf;
}
