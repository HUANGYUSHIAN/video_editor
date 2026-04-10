/** @typedef {{ start: number; end: number }} Segment */

/**
 * @param {Segment[]} segments
 */
export function editedDuration(segments) {
  return segments.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
}

/**
 * @param {Segment[]} segments
 * @param {number} t edited timeline seconds [0, editedDuration]
 */
export function editedToSource(segments, t) {
  let acc = 0;
  for (const seg of segments) {
    const len = Math.max(0, seg.end - seg.start);
    if (len === 0) continue;
    if (t < acc + len) {
      return seg.start + (t - acc);
    }
    acc += len;
  }
  if (segments.length === 0) return 0;
  const last = segments[segments.length - 1];
  return last.end;
}

/**
 * Map absolute source time to edited timeline position.
 * @param {Segment[]} segments
 * @param {number} sourceTime
 */
export function sourceToEdited(segments, sourceTime) {
  let acc = 0;
  for (const seg of segments) {
    const len = Math.max(0, seg.end - seg.start);
    if (len === 0) continue;
    if (sourceTime <= seg.start) return acc;
    if (sourceTime < seg.end) {
      return acc + (sourceTime - seg.start);
    }
    acc += len;
  }
  return acc;
}

/**
 * Clamp source time to lie on some kept segment (nearest boundary).
 * @param {Segment[]} segments
 * @param {number} sourceTime
 * @param {number} videoDuration
 */
export function clampSourceToKept(segments, sourceTime, videoDuration) {
  const t = Math.min(Math.max(0, sourceTime), Math.max(0, videoDuration));
  for (const seg of segments) {
    if (t >= seg.start && t <= seg.end) return t;
  }
  let best = 0;
  let bestDist = Infinity;
  for (const seg of segments) {
    for (const edge of [seg.start, seg.end]) {
      const d = Math.abs(t - edge);
      if (d < bestDist) {
        bestDist = d;
        best = edge;
      }
    }
  }
  return best;
}

/**
 * Remove [rs, re] from each segment (source timeline).
 * @param {Segment[]} segments
 * @param {number} rs
 * @param {number} re
 * @returns {Segment[]}
 */
export function subtractInterval(segments, rs, re) {
  const out = [];
  for (const seg of segments) {
    const s = seg.start;
    const e = seg.end;
    if (re <= s || rs >= e) {
      out.push({ start: s, end: e });
      continue;
    }
    if (rs <= s && re >= e) {
      continue;
    }
    if (rs > s && re < e) {
      out.push({ start: s, end: rs });
      out.push({ start: re, end: e });
      continue;
    }
    if (rs <= s && re < e) {
      out.push({ start: re, end: e });
      continue;
    }
    if (rs > s && re >= e) {
      out.push({ start: s, end: rs });
      continue;
    }
  }
  return mergeAdjacent(out.filter((x) => x.end > x.start));
}

function mergeAdjacent(segs) {
  if (segs.length === 0) return [];
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  const merged = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.start <= prev.end + 1e-6) {
      prev.end = Math.max(prev.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}
