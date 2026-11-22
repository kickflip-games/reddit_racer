import type { Track } from '../shared/track';
import type { RaceState } from '../shared/race-rules';
import { findTrackCrossings } from '../shared/track-crossings';

type MapPoint = { x: number; y: number; s: number; drawn: number };
export type MinimapGeometry = {
  path: string;
  points: readonly MapPoint[];
  totalLength: number;
  drawnLength: number;
  bridges: { path: string; lowerS: number; upperS: number }[];
};
const size = 160;
const padding = 12;
const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));

/** One world-up projection of the stored centreline, including its closing segment. */
export function createMinimapGeometry(track: Track): MinimapGeometry {
  if (
    !Number.isFinite(track.totalLength) ||
    track.totalLength <= 0 ||
    !track.samples.length
  )
    throw new Error('Invalid minimap circuit');
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity,
    previousS = -1;
  for (const p of track.samples) {
    if (
      !Number.isFinite(p.x + p.z + p.s) ||
      p.s <= previousS ||
      p.s < 0 ||
      p.s >= track.totalLength
    )
      throw new Error('Invalid minimap sample');
    previousS = p.s;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const span = Math.max(maxX - minX, maxZ - minZ);
  const scale = span > 0 ? (size - padding * 2) / span : 1;
  const middleX = (minX + maxX) / 2,
    middleZ = (minZ + maxZ) / 2;
  const points: MapPoint[] = [];
  let drawn = 0;
  for (const p of track.samples) {
    const x = size / 2 + (p.x - middleX) * scale;
    const y = size / 2 + (p.z - middleZ) * scale;
    const previous = points.at(-1);
    if (previous) drawn += Math.hypot(x - previous.x, y - previous.y);
    points.push({ x, y, s: p.s, drawn });
  }
  const first = points[0],
    last = points.at(-1);
  if (!first || !last || first.s !== 0)
    throw new Error('Missing minimap start');
  drawn += Math.hypot(first.x - last.x, first.y - last.y);
  const path =
    points
      .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`)
      .join('') + 'Z';
  points.push({ ...first, s: track.totalLength, drawn });
  const geometry = {
    path,
    points,
    totalLength: track.totalLength,
    drawnLength: drawn,
    bridges: [],
  };
  const bridges = findTrackCrossings(track)
    .filter((c) => c.upperY - c.lowerY >= 3.5)
    .map((c) => ({
      lowerS: c.lowerS,
      upperS: c.upperS,
      path: Array.from({ length: 25 }, (_, i) => {
        const p = sampleMinimap(geometry, c.upperS - 12 + i);
        return `${i ? 'L' : 'M'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
      }).join(''),
    }));
  return { ...geometry, bridges };
}

/** Use simulation distance and the authoritative practice lap count, never a clock. */
export function sampleMinimap(
  geometry: MinimapGeometry,
  distance: number,
  completedLaps = 0
) {
  if (
    !Number.isFinite(distance) ||
    !Number.isSafeInteger(completedLaps) ||
    completedLaps < 0
  )
    throw new Error('Invalid minimap progress');
  const s = clamp(
    distance - completedLaps * geometry.totalLength,
    geometry.totalLength
  );
  let low = 0,
    high = geometry.points.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if ((geometry.points[middle]?.s ?? Infinity) <= s) low = middle;
    else high = middle;
  }
  const a = geometry.points[low],
    b = geometry.points[low + 1];
  if (!a || !b) throw new Error('Missing minimap segment');
  const blend = (s - a.s) / (b.s - a.s);
  return {
    x: a.x + (b.x - a.x) * blend,
    y: a.y + (b.y - a.y) * blend,
    completion: s / geometry.totalLength,
    // Account for the stored s metric/quantisation instead of assuming that SVG
    // path length or distance to the finish is the authoritative lap fraction.
    stroke:
      geometry.drawnLength > 0
        ? (a.drawn + (b.drawn - a.drawn) * blend) / geometry.drawnLength
        : 0,
  };
}

type MinimapFrame = {
  phase: RaceState['phase'];
  distance: number;
  completedLaps: number;
};
export function createCircuitMinimap(root: HTMLElement, track: Track) {
  const geometry = createMinimapGeometry(track);
  function element(id: string): Element {
    const result = root.querySelector(`#${id}`);
    if (!result) throw new Error(`Missing minimap element: ${id}`);
    return result;
  }
  const course = element('minimap-course'),
    halo = element('minimap-halo');
  const completed = element('minimap-completed'),
    player = element('minimap-player');
  const start = element('minimap-start'),
    progress = element('minimap-progress');
  const narration = element('minimap-narration');
  for (const p of [course, halo, completed]) p.setAttribute('d', geometry.path);
  const bridgeNodes = geometry.bridges.map((bridge) => {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', 'minimap-bridge');
    for (const [color, width] of [
      ['#292d32', '6.5'],
      ['#eee4cf', '2.5'],
      ['var(--accent)', '2.5'],
    ]) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', bridge.path);
      p.setAttribute('stroke', color!);
      p.setAttribute('stroke-width', width!);
      group.append(p);
    }
    const highlight = group.lastElementChild!;
    highlight.setAttribute('pathLength', '1');
    highlight.setAttribute('stroke-dasharray', '1');
    highlight.setAttribute('stroke-dashoffset', '1');
    player.parentElement?.insertBefore(group, player);
    return { group, highlight, upperS: bridge.upperS };
  });
  const first = geometry.points[0];
  if (!first) throw new Error('Missing minimap start');
  const next = geometry.points.find(
    (p) => Math.hypot(p.x - first.x, p.y - first.y) > 0.001
  );
  const dx = next ? next.x - first.x : 1,
    dy = next ? next.y - first.y : 0;
  const length = Math.hypot(dx, dy),
    nx = (-dy / length) * 5,
    ny = (dx / length) * 5;
  start.setAttribute(
    'd',
    `M${first.x - nx} ${first.y - ny}L${first.x + nx} ${first.y + ny}`
  );
  function attribute(node: Element, name: string, value: string) {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }
  const origin = { x: first.x, y: first.y };
  let lastPercent = -1,
    lastLap = -1,
    lastAnnouncement = '',
    disposed = false;
  function reset() {
    root.hidden = true;
    attribute(completed, 'stroke-dashoffset', '1');
    attribute(player, 'cx', origin.x.toFixed(2));
    attribute(player, 'cy', origin.y.toFixed(2));
    attribute(progress, 'aria-valuenow', '0');
    attribute(progress, 'aria-valuetext', '0% complete');
    if (narration.textContent) narration.textContent = '';
    lastPercent = -1;
    lastLap = -1;
    lastAnnouncement = '';
  }
  reset();
  return {
    update(frame: MinimapFrame) {
      if (disposed) return;
      if (
        frame.phase !== 'racing' ||
        !Number.isFinite(frame.distance) ||
        !Number.isSafeInteger(frame.completedLaps) ||
        frame.completedLaps < 0
      ) {
        if (!root.hidden || lastPercent !== -1) reset();
        return;
      }
      const position = sampleMinimap(
        geometry,
        frame.distance,
        frame.completedLaps
      );
      root.hidden = false;
      // Only small cached SVG attributes change per frame. The outline is
      // immutable; quantised, cached values avoid redundant DOM writes/layout reads.
      attribute(player, 'cx', position.x.toFixed(2));
      attribute(player, 'cy', position.y.toFixed(2));
      attribute(
        completed,
        'stroke-dashoffset',
        (1 - position.stroke).toFixed(5)
      );
      const percent = Math.floor(position.completion * 100);
      const lap = frame.completedLaps + 1;
      const s = position.completion * geometry.totalLength;
      const deck = geometry.bridges.some((c) => Math.abs(s - c.lowerS) < 18)
        ? 'underpass'
        : geometry.bridges.some((c) => Math.abs(s - c.upperS) < 18)
          ? 'bridge'
          : '';
      attribute(player, 'data-deck', deck);
      for (const bridge of bridgeNodes)
        attribute(
          bridge.highlight,
          'stroke-dashoffset',
          String(1 - Math.max(0, Math.min(1, (s - bridge.upperS + 12) / 24)))
        );
      if (percent !== lastPercent || lap !== lastLap) {
        attribute(progress, 'aria-valuenow', String(percent));
        attribute(
          progress,
          'aria-valuetext',
          `Lap ${lap}, ${percent}% complete${deck ? `, ${deck}` : ''}`
        );
        lastPercent = percent;
        lastLap = lap;
      }
      // Announce only ten-percent boundaries and lap changes, not every frame.
      const announcement = `${lap}:${Math.floor(percent / 10)}`;
      if (announcement !== lastAnnouncement) {
        narration.textContent = `Lap ${lap}, ${percent}% complete.`;
        lastAnnouncement = announcement;
      }
    },
    dispose() {
      if (disposed) return;
      reset();
      bridgeNodes.forEach((node) => node.group.remove());
      disposed = true;
    },
  };
}
