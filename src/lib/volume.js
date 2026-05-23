/** @param {number} percent 0–200 integer */
export function normalizeVolumePercent(percent) {
  const n = Math.round(Number(percent));
  if (!Number.isFinite(n)) return 100;
  return Math.min(200, Math.max(0, n));
}

/** Linear gain: original × (percent / 100). */
export function volumeGainFromPercent(percent) {
  return normalizeVolumePercent(percent) / 100;
}

export function needsVolumeExport(percent) {
  return normalizeVolumePercent(percent) !== 100;
}
