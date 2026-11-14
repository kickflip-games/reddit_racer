import { generateCircuit } from '../shared/circuit-generator';
import { generateElevatedCircuit } from '../shared/elevated-generator';
const elevated =
  new URLSearchParams(window.location.search).get('elevated') === '1';
const previewCircuit = (seed: string) =>
  elevated ? generateElevatedCircuit(seed) : generateCircuit(seed);
import { SIMULATION_HZ } from '../shared/simulation';
import {
  hashTrack,
  roadPointAt,
  sampleTrack,
  type Track,
} from '../shared/track';

type GeneratedCircuit = ReturnType<typeof generateCircuit>;
type ValidatedCircuit = ReturnType<
  typeof import('../shared/circuit-quality').generateValidatedCircuit
>;
type QualityRun = NonNullable<ValidatedCircuit['quality']['metrics']>['hold'];
type Point = { x: number; z: number };
const svgNamespace = 'http://www.w3.org/2000/svg';
const maximumCourses = 300;
let batchRun = 0;
let selectedRun = 0;
let selectedSeed = '';
let selectedValidated = false;

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing workshop element: ${id}`);
  return found;
}
function input(id: string): HTMLInputElement {
  const found = element(id);
  if (!(found instanceof HTMLInputElement))
    throw new Error(`Missing input: ${id}`);
  return found;
}
function svg(id: string): SVGSVGElement {
  const found = document.getElementById(id);
  if (!(found instanceof SVGSVGElement))
    throw new Error(`Missing diagram: ${id}`);
  return found;
}
function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(svgNamespace, tag);
  for (const [name, value] of Object.entries(attributes))
    node.setAttribute(name, String(value));
  return node;
}
function labelSvg(
  parent: SVGElement,
  text: string,
  attributes: Record<string, string | number>
): void {
  const label = svgElement('text', attributes);
  label.textContent = text;
  parent.append(label);
}
function pathData(points: Point[], close = true): string {
  return (
    points
      .map(
        (point, index) =>
          `${index ? 'L' : 'M'}${point.x.toFixed(4)} ${point.z.toFixed(4)}`
      )
      .join(' ') + (close ? ' Z' : '')
  );
}
function edges(track: Track, shoulder = 0): { left: Point[]; right: Point[] } {
  const left: Point[] = [];
  const right: Point[] = [];
  for (const sample of track.samples) {
    const halfWidth = sample.width / 2 + shoulder;
    left.push({
      x: sample.x - sample.tz * halfWidth,
      z: sample.z + sample.tx * halfWidth,
    });
    right.push({
      x: sample.x + sample.tz * halfWidth,
      z: sample.z - sample.tx * halfWidth,
    });
  }
  return { left, right };
}

/** SVG uses the canonical strip edges; visual road tiles never determine the geometry. */
function renderMap(
  target: SVGSVGElement,
  track: Track,
  detailed: boolean
): void {
  const road = edges(track);
  const shoulder = edges(track, 0.8);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of [...shoulder.left, ...shoulder.right]) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  const span = Math.max(maxX - minX, maxZ - minZ);
  const margin = span * 0.09;
  target.setAttribute(
    'viewBox',
    `${minX - margin} ${minZ - margin} ${maxX - minX + margin * 2} ${maxZ - minZ + margin * 2}`
  );
  target.replaceChildren();
  const title = svgElement('title');
  title.textContent = `Circuit ${track.seed}, ${track.totalLength.toFixed(1)} metres`;
  target.append(title);
  target.append(
    svgElement('path', {
      d: `${pathData(shoulder.left)} ${pathData(shoulder.right)}`,
      fill: '#d3c09b',
      'fill-rule': 'evenodd',
    }),
    svgElement('path', {
      d: `${pathData(road.left)} ${pathData(road.right)}`,
      fill: '#293c3d',
      'fill-rule': 'evenodd',
      stroke: '#e5e5cb88',
      'stroke-width': 0.7,
      'vector-effect': 'non-scaling-stroke',
    }),
    svgElement('path', {
      d: pathData(track.samples),
      fill: 'none',
      stroke: '#8dffd6',
      'stroke-width': detailed ? 1.1 : 0.7,
      'stroke-dasharray': detailed ? '4 4' : '2 3',
      'vector-effect': 'non-scaling-stroke',
      opacity: 0.8,
    })
  );
  for (const [index, checkpoint] of track.checkpoints.entries()) {
    const frame = sampleTrack(track, checkpoint.s);
    if (detailed) {
      const left = roadPointAt(track, checkpoint.s, -frame.halfWidth);
      const right = roadPointAt(track, checkpoint.s, frame.halfWidth);
      target.append(
        svgElement('path', {
          d: pathData([left, right], false),
          stroke: '#6ce5ff',
          'stroke-width': 1.3,
          'vector-effect': 'non-scaling-stroke',
        })
      );
      labelSvg(target, String(index + 1), {
        x: frame.x + frame.nx * (frame.halfWidth + span * 0.035),
        y: frame.z + frame.nz * (frame.halfWidth + span * 0.035),
        fill: '#c7f5ff',
        'font-size': span * 0.027,
        'font-weight': 700,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
      });
    } else {
      target.append(
        svgElement('circle', {
          cx: frame.x,
          cy: frame.z,
          r: span * 0.008,
          fill: '#6ce5ff',
        })
      );
    }
  }
  const start = sampleTrack(track, track.startS);
  const startLeft = roadPointAt(track, track.startS, -start.halfWidth);
  const startRight = roadPointAt(track, track.startS, start.halfWidth);
  target.append(
    svgElement('path', {
      d: pathData([startLeft, startRight], false),
      stroke: '#ffbd59',
      'stroke-width': detailed ? 4 : 2.5,
      'vector-effect': 'non-scaling-stroke',
    })
  );
  if (detailed) {
    const arrow = sampleTrack(track, track.startS + 9);
    target.append(
      svgElement('path', {
        d: pathData([
          { x: arrow.x + arrow.tx * 2, z: arrow.z + arrow.tz * 2 },
          {
            x: arrow.x - arrow.tx * 1.5 + arrow.nx * 1.2,
            z: arrow.z - arrow.tz * 1.5 + arrow.nz * 1.2,
          },
          {
            x: arrow.x - arrow.tx * 1.5 - arrow.nx * 1.2,
            z: arrow.z - arrow.tz * 1.5 - arrow.nz * 1.2,
          },
        ]),
        fill: '#ffbd59',
      })
    );
  }
}

function renderCurvature(target: SVGSVGElement, track: Track): void {
  target.setAttribute('viewBox', '0 0 640 160');
  target.replaceChildren();
  const left = 56;
  const width = 566;
  const baseline = 72;
  let maximum = 0.001;
  for (const sample of track.samples)
    maximum = Math.max(maximum, Math.abs(sample.curvature));
  const points = [
    ...track.samples,
    { ...track.samples[0], s: track.totalLength },
  ].flatMap((sample) => {
    if (sample.curvature === undefined) return [];
    return [
      {
        x: left + (sample.s / track.totalLength) * width,
        z: baseline - (sample.curvature / maximum) * 52,
      },
    ];
  });
  for (let quarter = 0; quarter <= 4; quarter++) {
    const x = left + (width * quarter) / 4;
    target.append(
      svgElement('path', {
        d: `M${x} 16 L${x} 128`,
        stroke: '#c7e5d71a',
        'stroke-width': 1,
      })
    );
    labelSvg(target, `${Math.round((track.totalLength * quarter) / 4)} m`, {
      x,
      y: 148,
      fill: '#bad2c5',
      'font-size': 10,
      'text-anchor': quarter === 0 ? 'start' : quarter === 4 ? 'end' : 'middle',
    });
  }
  target.append(
    svgElement('path', {
      d: `M${left} ${baseline} L622 ${baseline}`,
      stroke: '#c7e5d74a',
      'stroke-width': 1,
    })
  );
  target.append(
    svgElement('path', {
      d: pathData(points, false),
      fill: 'none',
      stroke: '#ffbd59',
      'stroke-width': 2,
    })
  );
  labelSvg(target, `+${maximum.toFixed(3)}`, {
    x: 46,
    y: 23,
    fill: '#bad2c5',
    'font-size': 9,
    'text-anchor': 'end',
  });
  labelSvg(target, '0', {
    x: 46,
    y: baseline + 3,
    fill: '#bad2c5',
    'font-size': 9,
    'text-anchor': 'end',
  });
  labelSvg(target, `−${maximum.toFixed(3)}`, {
    x: 46,
    y: 126,
    fill: '#bad2c5',
    'font-size': 9,
    'text-anchor': 'end',
  });
}

function showError(error: unknown): void {
  const message = element('gallery-error');
  message.textContent =
    error instanceof Error
      ? error.message
      : 'The course could not be generated.';
  message.hidden = false;
}
function boundedCount(value: number): number {
  return Number.isInteger(value) && value >= 1 && value <= maximumCourses
    ? value
    : 100;
}
function updateQuery(seed: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('seed', seed);
  url.searchParams.set(
    'prefix',
    input('gallery-prefix').value.trim() || 'showcase'
  );
  url.searchParams.set(
    'count',
    String(boundedCount(input('gallery-count').valueAsNumber))
  );
  if (selectedValidated) url.searchParams.set('quality', '1');
  else url.searchParams.delete('quality');
  history.replaceState(null, '', url);
}
function addMetric(parent: HTMLElement, name: string, value: string): void {
  const group = document.createElement('div');
  group.className = 'metric';
  const term = document.createElement('dt');
  term.textContent = name;
  const description = document.createElement('dd');
  description.textContent = value;
  group.append(term, description);
  parent.append(group);
}
function renderDiagnostics(result: GeneratedCircuit): void {
  const { track, diagnostics } = result;
  const metrics = element('selected-metrics');
  metrics.replaceChildren();
  const widths = track.samples.map((sample) => sample.width);
  addMetric(metrics, 'Length', `${track.totalLength.toFixed(1)} m`);
  addMetric(
    metrics,
    'Road width',
    `${Math.min(...widths).toFixed(1)}–${Math.max(...widths).toFixed(1)} m`
  );
  addMetric(
    metrics,
    'Minimum radius',
    `${diagnostics.accepted.minRadius.toFixed(1)} m`
  );
  addMetric(
    metrics,
    'Reported clearance',
    `${diagnostics.accepted.minClearance.toFixed(1)} m`
  );
  addMetric(
    metrics,
    'Samples / gates',
    `${track.samples.length} / ${track.checkpoints.length}`
  );
  addMetric(metrics, 'Attempts', String(diagnostics.attempts));
  addMetric(metrics, 'Generator', track.generatorVersion);
  addMetric(metrics, 'Accepted candidate', diagnostics.accepted.candidateSeed);
  element('selected-motifs').textContent =
    diagnostics.accepted.motifs.join(' · ');
  element('selected-diagnostics').textContent = JSON.stringify(
    diagnostics,
    null,
    2
  );
  element('selected-status').textContent = diagnostics.fallbackUsed
    ? 'FALLBACK · PRELIMINARY'
    : 'GENERATED · PRELIMINARY';
}
function markSelection(): void {
  for (const card of element('track-gallery').querySelectorAll(
    'button[data-seed]'
  )) {
    card.setAttribute(
      'aria-pressed',
      String(card.getAttribute('data-seed') === selectedSeed)
    );
  }
}
function resetQuality(): void {
  selectedValidated = false;
  const verdict = element('quality-verdict');
  verdict.dataset.state = 'unchecked';
  verdict.textContent =
    'Driving quality is unchecked for this structural preview.';
  element('selected-status').dataset.quality = 'unchecked';
  element('check-quality').removeAttribute('disabled');
  element('quality-table').hidden = true;
  element('quality-metrics').replaceChildren();
  element('drive-selected').hidden = true;
  element('drive-selected').removeAttribute('href');
}

async function renderSelection(
  seed: string,
  result: GeneratedCircuit,
  run: number
): Promise<void> {
  selectedSeed = seed;
  input('gallery-seed').value = seed;
  element('selected-seed').textContent = seed;
  element('gallery-error').hidden = true;
  renderMap(svg('selected-track'), result.track, true);
  renderCurvature(svg('curvature-profile'), result.track);
  renderDiagnostics(result);
  markSelection();
  updateQuery(seed);
  element('selected-hash').textContent = 'Computing…';
  if (!globalThis.crypto?.subtle) {
    element('selected-hash').textContent = globalThis.isSecureContext
      ? 'Hash unavailable in this browser. Geometry inspection is still available.'
      : 'Hash unavailable over insecure HTTP; use localhost or HTTPS.';
    return;
  }
  try {
    const hash = await hashTrack(result.track);
    if (run === selectedRun) element('selected-hash').textContent = hash;
  } catch {
    if (run === selectedRun) {
      element('selected-hash').textContent =
        'Hash unavailable. Geometry inspection is still available.';
    }
  }
}

async function inspectSeed(rawSeed: string): Promise<void> {
  const run = ++selectedRun;
  resetQuality();
  try {
    const seed = rawSeed.trim();
    if (!seed || seed.length > 96)
      throw new Error('Enter a seed containing 1–96 characters.');
    await renderSelection(seed, previewCircuit(seed), run);
  } catch (error) {
    if (run === selectedRun) showError(error);
  }
}

function renderQualityMetrics(result: ValidatedCircuit): void {
  const metrics = result.quality.metrics;
  const body = element('quality-metrics');
  body.replaceChildren();
  element('quality-table').hidden = metrics === null;
  if (!metrics) return;
  const rows: { name: string; run: QualityRun }[] = [
    { name: 'Hold', run: metrics.hold },
    { name: 'Cautious', run: metrics.cautious },
    { name: 'Fast', run: metrics.fast },
  ];
  for (const strategy of rows) {
    const row = document.createElement('tr');
    for (const value of [
      strategy.name,
      strategy.run.seconds === null
        ? 'Incomplete'
        : `${strategy.run.seconds.toFixed(2)} s`,
      `${(strategy.run.offRoadTicks / SIMULATION_HZ).toFixed(2)} s`,
      String(strategy.run.meaningfulLifts),
    ]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
}

async function checkSelectedQuality(): Promise<void> {
  if (!selectedSeed) return;
  const seed = selectedSeed;
  const run = ++selectedRun;
  selectedValidated = false;
  const verdict = element('quality-verdict');
  verdict.dataset.state = 'checking';
  verdict.textContent =
    'Running bounded searches with the real shared race simulation…';
  element('check-quality').setAttribute('disabled', '');
  element('drive-selected').hidden = true;
  element('quality-table').hidden = true;
  try {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (run !== selectedRun) return;
    const result = generateElevatedCircuit(seed);
    if (run !== selectedRun) return;
    renderQualityMetrics(result);
    if (!result.quality.valid) {
      verdict.dataset.state = 'rejected';
      verdict.textContent = `Driving checks rejected this seed: ${result.quality.codes.join(', ')}.`;
      return;
    }
    selectedValidated = true;
    await renderSelection(seed, result, run);
    if (run !== selectedRun) return;
    const metrics = result.quality.metrics;
    const gain =
      metrics && typeof metrics.gainTicks === 'number'
        ? `${(metrics.gainTicks / SIMULATION_HZ).toFixed(2)} s faster than hold`
        : 'timing metrics available below';
    verdict.dataset.state = 'passed';
    verdict.textContent = `Automated simulation checks passed (${result.quality.version}); ${gain}.${result.diagnostics.fallbackUsed ? ' A prevalidated reserve course was used.' : ''}`;
    const selectedStatus = element('selected-status');
    selectedStatus.dataset.quality = 'passed';
    selectedStatus.textContent = result.diagnostics.fallbackUsed
      ? 'RESERVE · QUALITY CHECKED'
      : 'SIMULATION CHECKS PASSED';
    element('selected-diagnostics').textContent = JSON.stringify(
      { ...result.diagnostics, quality: result.quality },
      null,
      2
    );
    const link = element('drive-selected');
    const destination = new URL('/game.html', window.location.href);
    destination.searchParams.set('seed', seed);
    if (elevated) destination.searchParams.set('elevated', '1');
    link.setAttribute('href', destination.pathname + destination.search);
    link.hidden = false;
  } catch (error) {
    if (run === selectedRun) {
      verdict.dataset.state = 'rejected';
      verdict.textContent =
        error instanceof Error
          ? error.message
          : 'Driving checks could not accept a course for this seed.';
    }
  } finally {
    if (run === selectedRun)
      element('check-quality').removeAttribute('disabled');
  }
}

function createCard(seed: string, result: GeneratedCircuit): HTMLButtonElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'track-card';
  card.dataset.seed = seed;
  card.dataset.fallback = String(result.diagnostics.fallbackUsed);
  card.setAttribute('aria-pressed', String(seed === selectedSeed));
  const map = svgElement('svg', { 'aria-hidden': 'true' });
  renderMap(map, result.track, false);
  const name = document.createElement('strong');
  name.textContent = seed;
  name.title = seed;
  const detail = document.createElement('small');
  detail.textContent = `${result.track.totalLength.toFixed(0)} m · min radius ${result.diagnostics.accepted.minRadius.toFixed(1)} m`;
  const status = document.createElement('small');
  status.textContent = `${result.diagnostics.attempts} attempt(s) · ${result.diagnostics.fallbackUsed ? 'fallback' : 'generated'}`;
  card.append(map, name, detail, status);
  card.addEventListener('click', () => {
    void inspectSeed(seed);
  });
  return card;
}
async function generateGallery(): Promise<void> {
  const run = ++batchRun;
  const prefix = input('gallery-prefix').value.trim();
  const count = boundedCount(input('gallery-count').valueAsNumber);
  if (!prefix || prefix.length > 88) {
    showError(new Error('Enter a batch prefix containing 1–88 characters.'));
    return;
  }
  input('gallery-count').value = String(count);
  const grid = element('track-gallery');
  const status = element('gallery-status');
  grid.replaceChildren();
  status.dataset.state = 'generating';
  element('batch-title').textContent = `${count} possibilities.`;
  updateQuery(selectedSeed || input('gallery-seed').value);
  let fallbacks = 0;
  let errors = 0;
  let batchStarted = performance.now();
  for (let index = 0; index < count; index++) {
    if (run !== batchRun) return;
    const seed = `${prefix}-${index}`;
    try {
      const result = previewCircuit(seed);
      if (result.diagnostics.fallbackUsed) fallbacks++;
      grid.append(createCard(seed, result));
    } catch (error) {
      errors++;
      const failed = document.createElement('article');
      failed.className = 'track-card';
      failed.dataset.error = 'true';
      const name = document.createElement('strong');
      name.textContent = seed;
      const detail = document.createElement('small');
      detail.textContent =
        error instanceof Error ? error.message : 'Generation failed';
      failed.append(name, detail);
      grid.append(failed);
    }
    status.textContent = `Generated ${index + 1}/${count} · ${fallbacks} fallback · ${errors} errors`;
    if ((index + 1) % 4 === 0 || performance.now() - batchStarted >= 16) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      batchStarted = performance.now();
    }
  }
  if (run === batchRun) status.dataset.state = 'complete';
}

if (import.meta.env.DEV) {
  const query = new URLSearchParams(window.location.search);
  input('gallery-seed').value = query.get('seed') ?? 'showcase-0';
  input('gallery-prefix').value = query.get('prefix') ?? 'showcase';
  input('gallery-count').value = String(
    boundedCount(Number(query.get('count') ?? 100))
  );
  element('seed-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void inspectSeed(input('gallery-seed').value);
  });
  element('batch-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void generateGallery();
  });
  element('check-quality').addEventListener('click', () => {
    void checkSelectedQuality();
  });
  const initialSeed = input('gallery-seed').value;
  void inspectSeed(initialSeed).then(() => {
    if (query.get('quality') === '1' && selectedSeed === initialSeed.trim())
      void checkSelectedQuality();
  });
  void generateGallery();
} else {
  element('gallery-app').textContent =
    'The circuit workshop is available only in local development.';
}
