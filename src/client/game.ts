import { createOvalTrack } from '../shared/track-authoring';
import type { Track } from '../shared/track';
import { initializeGame } from './game-scene';
import {
  DailyCourseIntegrityError,
  fetchDailyChallenge,
  startDailyClock,
} from './daily-client';
import type { DailyChallengeView } from '../shared/daily-challenge';
import {
  createRankedRaceHooks,
  type AttemptPresentation,
} from './ranked-client';

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
  daily: DailyChallengeView | null;
  dailyUnavailable: boolean;
};

function referenceCourse(dailyUnavailable = false): LoadedCourse {
  return {
    track: createOvalTrack(),
    generated: false,
    seed: '',
    fallbackUsed: false,
    daily: null,
    dailyUnavailable,
  };
}

async function loadCourse(): Promise<LoadedCourse> {
  // Development selectors never control the production daily challenge.
  const query = import.meta.env.DEV
    ? new URLSearchParams(window.location.search)
    : null;
  if (!import.meta.env.DEV || query?.get('daily') === '1') {
    source.hidden = false;
    source.dataset.state = 'loading';
    source.textContent = 'LOADING THIS POST’S CIRCUIT';
    title.textContent = 'Preparing daily circuit…';
    copy.textContent = 'Loading the saved course for this Reddit post.';
    element('status').textContent = 'LOADING DAILY CIRCUIT';
    try {
      const daily = await fetchDailyChallenge();
      return {
        track: daily.challenge.track,
        generated: true,
        seed: '',
        fallbackUsed: false,
        daily,
        dailyUnavailable: false,
      };
    } catch (error) {
      if (error instanceof DailyCourseIntegrityError) throw error;
      // The substitute is always visibly identified as reference practice.
      return referenceCourse(true);
    }
  }
  const seed = query?.get('seed') ?? null;
  if (import.meta.env.DEV && seed !== null) {
    source.hidden = false;
    source.dataset.state = 'loading';
    source.textContent = `Checking local seed: ${seed}`;
    title.textContent = 'Preparing circuit…';
    copy.textContent = 'Checking the road and driving conditions.';
    element('status').textContent = 'PREPARING LOCAL CIRCUIT';
    if (!seed.length || seed.length > 96)
      throw new Error('Local circuit seeds must contain 1–96 characters.');
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
      daily: null,
      dailyUnavailable: false,
    };
  }
  return referenceCourse();
}

function resetLabel(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return [hours, minutes, seconds % 60]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

let dailyArchived = false;
let dailyDay = '';
let attemptPresentation: AttemptPresentation = 'practice';
function renderDailyMode(): void {
  element('mode-label').textContent =
    attemptPresentation === 'ranked'
      ? 'RANKED · DAILY'
      : dailyArchived
        ? 'ARCHIVE · UNRANKED'
        : 'DAILY · UNRANKED';
  element('track-note').textContent =
    attemptPresentation === 'ranked'
      ? dailyArchived
        ? `Current race keeps the ${dailyDay} circuit. New attempts use practice.`
        : `${dailyDay} daily race. Your time is checked after finishing.`
      : dailyArchived
        ? `This post keeps its ${dailyDay} circuit. Unranked practice.`
        : `Shared ${dailyDay} UTC circuit. Sign in to verify daily runs.`;
}
function showDailyCourse(view: DailyChallengeView): void {
  const challenge = view.challenge;
  race.dataset.challengeId = challenge.id;
  race.dataset.challengeHash = challenge.challengeHash;
  race.dataset.trackHash = challenge.trackHash;
  source.hidden = true;
  element('daily-details').hidden = false;
  element('daily-date').textContent = `${challenge.day} · UTC`;
  startDailyClock(view, (clock) => {
    dailyArchived = clock.archived;
    dailyDay = challenge.day;
    renderDailyMode();
    element('daily-reset').textContent = clock.archived
      ? attemptPresentation === 'ranked'
        ? 'Current race keeps this course'
        : 'Archived course · practice'
      : `UTC reset in ${resetLabel(clock.resetSeconds)}`;
  });
}

async function boot(): Promise<void> {
  const course = await loadCourse();
  const hooks = course.daily
    ? createRankedRaceHooks(course.daily.challenge, (mode) => {
        attemptPresentation = mode;
        renderDailyMode();
      })
    : {};
  initializeGame(course.track, { generated: course.generated, ...hooks });
  source.dataset.state = 'ready';
  source.dataset.fallback = String(course.fallbackUsed);
  if (course.daily) {
    showDailyCourse(course.daily);
  } else if (course.dailyUnavailable) {
    element('mode-label').textContent = 'REFERENCE · UNRANKED';
    source.hidden = false;
    source.textContent = 'DAILY SERVICE UNAVAILABLE';
    source.dataset.mode = 'reference-fallback';
    source.title =
      'The daily course could not be loaded. This is a separate, unranked reference course.';
    element('track-note').textContent =
      'Unranked reference practice. Reload to try loading this post’s daily circuit.';
  } else if (course.generated) {
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
  if (!course.generated && !course.dailyUnavailable)
    element('track-note').textContent =
      'Local reference practice. Procedural seeds are available in the circuit workshop.';
  title.textContent = course.dailyUnavailable
    ? 'Daily course unavailable.'
    : 'Find your rhythm.';
  copy.textContent = course.dailyUnavailable
    ? 'Try the reference course in unranked practice.'
    : 'Hold to go. Release to slow.';
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
