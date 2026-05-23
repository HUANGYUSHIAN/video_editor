/** Target long-edge lengths (px); shorter side follows aspect ratio */
export const EXPORT_MAX_EDGE_PRESETS = [360, 480, 720, 1080, 1280];

/**
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 */
export function sourceMaxEdge(sourceWidth, sourceHeight) {
  const w = Math.round(Number(sourceWidth) || 0);
  const h = Math.round(Number(sourceHeight) || 0);
  return Math.max(w, h);
}

/**
 * Presets strictly below the source long edge (same long edge = use「原始」).
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 */
export function getAllowedExportMaxEdges(sourceWidth, sourceHeight) {
  const max = sourceMaxEdge(sourceWidth, sourceHeight);
  if (max <= 0) return [];
  return EXPORT_MAX_EDGE_PRESETS.filter((p) => p < max);
}

/**
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @param {number} targetMaxEdge
 */
export function computeScaledDimensions(sourceWidth, sourceHeight, targetMaxEdge) {
  const sw = Math.round(Number(sourceWidth) || 0);
  const sh = Math.round(Number(sourceHeight) || 0);
  const tgt = Math.round(Number(targetMaxEdge));
  const srcMax = Math.max(sw, sh);
  if (srcMax <= 0 || tgt <= 0 || tgt >= srcMax) return null;
  const scale = tgt / srcMax;
  let w = Math.round(sw * scale);
  let h = Math.round(sh * scale);
  if (w % 2 !== 0) w += 1;
  if (h % 2 !== 0) h += 1;
  return { width: w, height: h };
}

/**
 * @param {string | number | null | undefined} exportResolution 'original' or max-edge string
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 */
export function parseExportMaxEdge(exportResolution, sourceWidth, sourceHeight) {
  if (exportResolution === 'original' || exportResolution == null || exportResolution === '') {
    return null;
  }
  const edge = Math.round(Number(exportResolution));
  if (!Number.isFinite(edge) || edge <= 0) return null;
  const allowed = getAllowedExportMaxEdges(sourceWidth, sourceHeight);
  if (allowed.length > 0 && !allowed.includes(edge)) return null;
  if (allowed.length === 0) return null;
  return edge;
}

/**
 * @param {string | number | null | undefined} exportResolution
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 */
export function needsScaleExport(exportResolution, sourceWidth, sourceHeight) {
  return parseExportMaxEdge(exportResolution, sourceWidth, sourceHeight) != null;
}

/**
 * FFmpeg scale: long edge = targetMax, other dimension even (-2).
 * @param {number} targetMaxEdge
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 */
export function scaleFilterForMaxEdge(targetMaxEdge, sourceWidth, sourceHeight) {
  const tgt = Math.round(targetMaxEdge);
  const sw = Math.round(Number(sourceWidth) || 0);
  const sh = Math.round(Number(sourceHeight) || 0);
  if (sw <= 0 || sh <= 0) {
    return `scale=${tgt}:-2:flags=lanczos`;
  }
  if (sw >= sh) {
    return `scale=${tgt}:-2:flags=lanczos`;
  }
  return `scale=-2:${tgt}:flags=lanczos`;
}

/**
 * @param {number} targetMaxEdge
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 */
export function scaledDimensionsLabel(targetMaxEdge, sourceWidth, sourceHeight) {
  const dims = computeScaledDimensions(sourceWidth, sourceHeight, targetMaxEdge);
  if (!dims) return '';
  return `${dims.width}×${dims.height}`;
}

/**
 * Soft subtitles can be copied only when export is one full segment (no cuts).
 * @param {{ start: number; end: number }[]} sorted
 * @param {number} sourceDuration
 */
export function canPreserveSubtitleTracks(sorted, sourceDuration) {
  if (sorted.length !== 1) return false;
  const s = sorted[0];
  if (sourceDuration <= 0) return false;
  return s.start < 0.02 && s.end >= sourceDuration - 0.05;
}
