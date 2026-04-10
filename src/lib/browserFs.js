/**
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} fileName
 * @param {Uint8Array} data
 * @param {{ signal?: AbortSignal; chunkSize?: number }} [opts]
 */
export async function writeFileToDirectory(dirHandle, fileName, data, opts = {}) {
  const fh = await dirHandle.getFileHandle(fileName, { create: true });
  const w = await fh.createWritable();
  try {
    await writeUint8ArrayChunked(w, data, opts);
    await w.close();
  } catch (e) {
    try {
      await w.abort();
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/**
 * @param {Uint8Array} data
 * @param {string} suggestedName
 * @param {{ signal?: AbortSignal; chunkSize?: number }} [opts]
 */
export async function saveWithFilePicker(data, suggestedName, opts = {}) {
  const h = await window.showSaveFilePicker({
    suggestedName,
    types: [
      {
        description: 'MP4 影片',
        accept: { 'video/mp4': ['.mp4'] },
      },
    ],
  });
  const w = await h.createWritable();
  try {
    await writeUint8ArrayChunked(w, data, opts);
    await w.close();
  } catch (e) {
    try {
      await w.abort();
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/**
 * @param {FileSystemWritableFileStream} writable
 * @param {Uint8Array} data
 * @param {{ signal?: AbortSignal; chunkSize?: number }} [opts]
 */
export async function writeUint8ArrayChunked(writable, data, opts = {}) {
  const chunkSize = opts.chunkSize ?? 2 * 1024 * 1024;
  const signal = opts.signal;
  for (let i = 0; i < data.length; i += chunkSize) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    await writable.write(data.subarray(i, Math.min(i + chunkSize, data.length)));
  }
}

/**
 * @param {Uint8Array} data
 * @param {string} fileName
 */
export function triggerDownload(data, fileName) {
  const blob = new Blob([data], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.click();
  URL.revokeObjectURL(url);
}

export function supportsDirectoryPicker() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function supportsSaveFilePicker() {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

/**
 * @param {File} file
 */
export function suggestedMp4Name(file) {
  const base = file.name.replace(/\.[^.]+$/i, '');
  return `${base || 'output'}.mp4`;
}

/**
 * @param {File} file
 */
export function isMp4Extension(file) {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return ext === 'mp4';
}
