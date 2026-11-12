import { createOvalTrack } from '../shared/track-authoring';
import type { Track } from '../shared/track';
import { initializeGame } from './game-scene';

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing game element: ${id}`);
  return found;
}

const startElement = element('start-button');
if (!(startElement instanceof HTMLButtonElement))
  throw new Error('Missing Start button');
const start = startElement;
const race = element('race');
const source = element('track-source');
const title = element('card-title');
const copy = element('card-copy');
start.disabled = true;
element('mode-label').textContent = import.meta.env.DEV
  ? 'LOCAL · UNRANKED'
  : 'PRACTICE · UNRANKED';

type LoadedCourse = {
  track: Track;
  generated: boolean;
  seed: string;
  fallbackUsed: boolean;
};

async function loadCourse(): Promise<LoadedCourse> {
  // Local query controls are removed from the production bundle.
  const seed = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get('seed')
    : null;
  if (import.meta.env.DEV && seed !== null) {
    source.hidden = false;
    source.dataset.state = 'loading';
    source.textContent = `Checking local seed: ${seed}`;
    title.textContent = 'Preparing circuit…';
    copy.textContent = 'Checking the road and driving conditions.';
    element('status').textContent = 'PREPARING LOCAL CIRCUIT';
    if (!seed.length || seed.length > 96)
      throw new Error('Local circuit seeds must contain 1–96 characters.');
    // Let the loading UI paint before selected-only synchronous quality work.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const { generateValidatedCircuit } =
      await import('../shared/circuit-quality');
    const result = generateValidatedCircuit(seed);
    if (!result.quality.valid)
      throw new Error(
        'This seed failed the driving checks. Select another seed in the circuit workshop.'
      );
    return {
      track: result.track,
      generated: true,
      seed,
      fallbackUsed: result.diagnostics.fallbackUsed,
    };
  }
  return {
    track: createOvalTrack(),
    generated: false,
    seed: '',
    fallbackUsed: false,
  };
}

async function boot(): Promise<void> {
  const course = await loadCourse();
  initializeGame(course.track, { generated: course.generated });
  source.dataset.state = 'ready';
  source.dataset.fallback = String(course.fallbackUsed);
  if (course.generated) {
    source.hidden = false;
    source.dataset.seed = course.seed;
    source.textContent = course.fallbackUsed
      ? `RESERVE · ${course.seed}`
      : `SEED · ${course.seed}`;
    source.title = course.fallbackUsed
      ? `A prevalidated reserve course is loaded for requested seed ${course.seed}. Local and unranked.`
      : `Automated driving checks passed for seed ${course.seed}. Local and unranked.`;
    element('track-note').textContent = course.fallbackUsed
      ? `Prevalidated reserve used for ${course.seed}. Retries keep this course.`
      : `Local procedural seed ${course.seed}. Retries keep this course.`;
  }
  title.textContent = 'Find your rhythm.';
  copy.textContent = 'Hold to go. Release to slow.';
  start.disabled = false;
}

void boot().catch((error: unknown) => {
  race.dataset.phase = 'abandoned';
  source.dataset.state = 'rejected';
  source.hidden = false;
  source.textContent = 'CIRCUIT UNAVAILABLE';
  title.textContent = 'Circuit unavailable.';
  copy.textContent = 'The race could not start. Please reload and try again.';
  element('status').textContent = 'CIRCUIT UNAVAILABLE';
  const notice = element('error');
  notice.textContent =
    error instanceof Error ? error.message : 'The circuit could not be loaded.';
  notice.hidden = false;
  start.disabled = true;
});
