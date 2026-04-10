import classWorkerURL from '@ffmpeg/ffmpeg/worker?url';

const CORE_VER = '0.12.10';
const BASE = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VER}/dist/esm`;

/** @type {import('@ffmpeg/ffmpeg').FFmpeg | null} */
let instance = null;
/** @type {Promise<import('@ffmpeg/ffmpeg').FFmpeg> | null} */
let loading = null;

export function resetFfmpegAfterTerminate() {
  instance = null;
  loading = null;
}

export async function terminateActiveFfmpeg() {
  if (instance) {
    try {
      instance.terminate();
    } catch {
      /* ignore */
    }
    resetFfmpegAfterTerminate();
  }
}

/**
 * @param {{ onLog?: (msg: string) => void }} [opts]
 */
export function loadFfmpeg(opts = {}) {
  const { onLog } = opts;
  if (instance) return Promise.resolve(instance);
  if (loading) return loading;

  const run = async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { toBlobURL } = await import('@ffmpeg/util');

    const ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => onLog?.(message));

    await ffmpeg.load({
      classWorkerURL,
      coreURL: await toBlobURL(`${BASE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${BASE}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    instance = ffmpeg;
    return ffmpeg;
  };

  loading = run().catch((e) => {
    loading = null;
    throw e;
  });

  return loading;
}
