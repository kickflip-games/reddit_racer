import { readIncomingShare } from './share-handoff';
import { initializeTrackSharing } from './track-sharing';
import { parseTrackShare, verifySharedTrack } from '../shared/track-share';
import { courseWord } from '../shared/word-seed';
import type { Track } from '../shared/track';
import { initializeGame, type GameSceneController } from './game-scene';
import {
  generateWordPracticeCourse,
  generatePracticeCourse,
  generateRandomWordPracticeCourse,
} from './practice-course';
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
import { createLeaderboardController } from './leaderboard-client';
import { createTodayRaceController } from './today-race-client';
import { createDailyHistoryController } from './daily-history-client';

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
  ? 'Unranked'
  : 'Unranked';

type LoadedCourse = {
  track: Track;
  generated: boolean;
  seed: string;
  fallbackUsed: boolean;
  daily: DailyChallengeView | null;
  dailyUnavailable: boolean;
};

async function referenceCourse(
  dailyUnavailable = false
): Promise<LoadedCourse> {
  const course = await generatePracticeCourse('banana');
  return {
    track: course.track,
    generated: true,
    seed: course.seed,
    fallbackUsed: course.fallbackUsed,
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
    const { generateElevatedCircuit } =
      await import('../shared/elevated-generator');
    const result = generateElevatedCircuit(seed);
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
let attemptPresentation: AttemptPresentation = 'ready';
function renderDailyMode(): void {
  element('mode-label').textContent =
    attemptPresentation === 'ranked'
      ? 'Daily'
      : attemptPresentation === 'preparing'
        ? 'Loading'
        : dailyArchived
          ? 'Archive'
          : attemptPresentation === 'practice'
            ? 'Unranked'
            : 'Daily';
  element('start-label').textContent =
    attemptPresentation === 'preparing'
      ? 'Preparing…'
      : dailyArchived
        ? 'Start'
        : 'Race';
  element('retry-label').textContent =
    attemptPresentation === 'preparing'
      ? 'Preparing…'
      : dailyArchived
        ? 'Retry'
        : 'Retry';
  element('track-note').textContent = '';
}
function showDailyCourse(view: DailyChallengeView): () => void {
  const challenge = view.challenge;
  race.dataset.challengeId = challenge.id;
  race.dataset.challengeHash = challenge.challengeHash;
  race.dataset.trackHash = challenge.trackHash;
  source.hidden = true;
  element('challenge-heading').hidden = false;
  element('challenge-heading').textContent = challenge.day;
  element('daily-details').hidden = false;
  element('daily-date').textContent = `${challenge.day} · UTC`;
  const todayRace = createTodayRaceController(challenge.day);
  const stopClock = startDailyClock(view, (clock) => {
    dailyArchived = clock.archived;
    renderDailyMode();
    todayRace.updateArchived(clock.archived);
    element('daily-reset').textContent = clock.archived
      ? attemptPresentation === 'ranked'
        ? 'Current race keeps this course'
        : 'Archived course · unranked'
      : `UTC reset in ${resetLabel(clock.resetSeconds)}`;
  });
  return () => {
    stopClock();
    todayRace.dispose();
  };
}

const trackSharing = initializeTrackSharing();
type PlayMode = 'daily' | 'practice';
let scene: GameSceneController | undefined;
let cleanupDaily: (() => void) | undefined;
let cleanupLeaderboard: (() => void) | undefined;
let courseGeneration = 0;
let lastPracticeTrackHash: string | undefined;

function prepareCourse(mode: PlayMode): void {
  trackSharing.clear();
  scene?.dispose();
  scene = undefined;
  cleanupDaily?.();
  cleanupDaily = undefined;
  cleanupLeaderboard?.();
  cleanupLeaderboard = undefined;
  dailyArchived = false;
  attemptPresentation = 'ready';
  race.dataset.playMode = mode;
  race.dataset.phase = 'loading';
  race.dataset.preparing = 'false';
  delete race.dataset.challengeId;
  delete race.dataset.challengeHash;
  delete race.dataset.trackHash;
  delete race.dataset.practiceLaps;
  delete race.dataset.attemptMode;
  for (const id of [
    'error',
    'retry-button',
    'practice-last-lap',
    'daily-details',
    'leaderboard',
    'result-summary',
    'today-race',
    'race-countdown',
  ])
    element(id).hidden = true;
  const dialog = element('settings-dialog');
  if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
  const settings = element('race-settings');
  if (settings instanceof HTMLDetailsElement) settings.open = false;
  element('challenge-heading').hidden = true;
  element('card-kicker').textContent = '';
  element('card').dataset.best = 'false';
  element('card').dataset.result = 'false';
  element('finish-time').hidden = true;
  element('practice-result').hidden = true;
  element('card').hidden = false;
  element('card').scrollTop = 0;
  element('practice-button').hidden = mode === 'practice';
  element('word-course-open').hidden = mode !== 'practice';
  element('practice-settings').hidden = false;
  element('practice-seed').hidden = mode === 'daily';
  element('daily-mode-button').hidden = mode === 'daily';
  element('verification-status').hidden = true;
  element('verification-status').textContent = '';
  source.hidden = true;
  source.dataset.state = 'loading';
  delete source.dataset.seed;
  delete source.dataset.mode;
  source.removeAttribute('title');
  source.textContent = '';
  start.hidden = false;
  start.disabled = true;
  element('sound-toggle').toggleAttribute('disabled', true);
  element('next-practice-button').toggleAttribute('disabled', true);
  element('mode-label').textContent =
    mode !== 'daily'
      ? 'Other tracks'
      : import.meta.env.DEV
        ? 'Unranked'
        : 'Daily';
  element('start-label').textContent = 'Start';
  element('retry-label').textContent = mode !== 'daily' ? 'Resume' : 'Retry';
  title.textContent =
    mode !== 'daily' ? 'Preparing another track…' : 'Preparing circuit…';
  copy.textContent = 'Hold to go. Release to slow.';
}

async function boot(
  mode: PlayMode,
  seed?: string,
  wordRequest?: { input: string },
  shareRaw?: string
): Promise<void> {
  const focusWhenReady = courseGeneration > 0;
  const version = ++courseGeneration;
  prepareCourse(mode);
  try {
    if (mode !== 'daily') {
      const shared =
        shareRaw === undefined ? undefined : parseTrackShare(shareRaw);
      if (shared) wordRequest = { input: shared.seed };
      const course = wordRequest
        ? await generateWordPracticeCourse(wordRequest.input)
        : seed === undefined
          ? await generateRandomWordPracticeCourse(lastPracticeTrackHash)
          : import.meta.env.DEV
            ? await (
                await import('./legacy-practice-fixture')
              ).generateLegacyPracticeFixture(seed)
            : await generateWordPracticeCourse(seed);
      if (version !== courseGeneration) return;
      if (shared) await verifySharedTrack(shared, course.track);
      if (version !== courseGeneration) return;
      lastPracticeTrackHash = course.trackHash;
      scene = initializeGame(course.track, {
        generated: true,
        continuousPractice: true,
      });
      race.dataset.trackHash = course.trackHash;
      race.dataset.practiceLaps = '0';
      element('mode-label').textContent = 'Lap 1';
      element('start-label').textContent = 'Start';
      element('retry-label').textContent = 'Resume';
      const selectedWord = course.wordCourse ?? null;
      if (selectedWord) trackSharing.set(selectedWord.code, course.track);
      const practiceSeed = element('practice-seed');
      practiceSeed.dataset.seed = course.seed;
      practiceSeed.textContent = 'Unranked';
      const wordInput = element('course-word');
      if (wordInput instanceof HTMLInputElement)
        wordInput.value = selectedWord ? selectedWord.code : '';
      race.dataset.wordCode = selectedWord ? selectedWord.code : '';
      element('word-course-message').textContent = '';
      source.dataset.state = 'ready';
      source.dataset.fallback = String(course.fallbackUsed);
      source.dataset.seed = course.seed;
      source.textContent = course.fallbackUsed
        ? 'Validated reserve circuit'
        : '';
      source.hidden = !course.fallbackUsed;
      element('track-note').textContent = '';
      title.textContent = '';
      copy.textContent = 'Hold to go. Release to brake.';
      start.disabled = false;
      if (focusWhenReady)
        (title.textContent ? title : start).focus({ preventScroll: true });
      return;
    }
    const course = await loadCourse();
    if (version !== courseGeneration) return;
    const leaderboard = course.daily
      ? createLeaderboardController(course.daily.challenge, (attemptId) => {
          if (version === courseGeneration)
            scene?.celebrateVerifiedLeader(attemptId);
        })
      : null;
    cleanupLeaderboard = leaderboard?.dispose;
    const hooks = course.daily
      ? createRankedRaceHooks(
          course.daily.challenge,
          (mode) => {
            if (
              version !== courseGeneration ||
              race.dataset.playMode !== 'daily'
            )
              return;
            attemptPresentation = mode;
            renderDailyMode();
          },
          leaderboard?.recordVerified,
          () => dailyArchived
        )
      : {};
    scene = initializeGame(course.track, {
      generated: course.generated,
      ...hooks,
      ...(leaderboard
        ? {
            onAttemptStart: leaderboard.onAttemptStart,
            onResults: leaderboard.onResults,
          }
        : {}),
    });
    source.dataset.state = 'ready';
    source.dataset.fallback = String(course.fallbackUsed);
    if (course.daily) {
      cleanupDaily = showDailyCourse(course.daily);
    } else if (course.dailyUnavailable) {
      element('mode-label').textContent = 'Unranked';
      source.hidden = false;
      source.textContent = 'DAILY SERVICE UNAVAILABLE';
      source.dataset.mode = 'reference-fallback';
      source.title =
        'The daily course could not be loaded. This is a separate, unranked reference course.';
      element('track-note').textContent =
        'Unranked reference course. Reload to try loading this post’s daily circuit.';
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
    element('track-note').textContent = '';
    title.textContent = course.dailyUnavailable ? 'Daily unavailable' : '';
    copy.textContent = course.dailyUnavailable
      ? 'Unranked racing is available.'
      : 'Hold to go. Release to brake.';
    start.disabled = false;
    if (focusWhenReady)
      (title.textContent ? title : start).focus({ preventScroll: true });
  } catch (error: unknown) {
    if (version !== courseGeneration) return;
    race.dataset.phase = 'abandoned';
    source.dataset.state = 'rejected';
    source.hidden = false;
    source.textContent = 'CIRCUIT UNAVAILABLE';
    title.textContent =
      shareRaw === undefined
        ? 'Circuit unavailable.'
        : 'Shared track unavailable.';
    copy.textContent =
      shareRaw !== undefined
        ? 'Ask for a new share, or choose another seed.'
        : mode !== 'daily'
          ? 'Try Random track in Settings, or return to the daily race.'
          : 'The race could not start. Please reload and try again.';
    element('status').textContent = 'CIRCUIT UNAVAILABLE';
    const notice = element('error');
    notice.textContent =
      error instanceof Error
        ? error.message
        : 'The circuit could not be loaded.';
    notice.hidden = false;
    start.disabled = true;
    if (focusWhenReady)
      (title.textContent ? title : start).focus({ preventScroll: true });
  } finally {
    if (version === courseGeneration)
      element('next-practice-button').toggleAttribute('disabled', false);
  }
}

element('practice-button').addEventListener(
  'click',
  () => void boot('practice')
);
element('next-practice-button').addEventListener(
  'click',
  () => void boot('practice')
);
element('daily-mode-button').addEventListener(
  'click',
  () => void boot('daily')
);
element('word-course-open').addEventListener('click', () => {
  const summary = document.querySelector('#race-settings summary');
  if (summary instanceof HTMLElement) summary.click();
  const dialog = element('settings-dialog');
  if (!scene && dialog instanceof HTMLDialogElement && !dialog.open)
    dialog.showModal();
  element('course-word').focus();
});
element('settings-close').addEventListener('click', () => {
  if (scene) return;
  const dialog = element('settings-dialog');
  if (dialog instanceof HTMLDialogElement) dialog.close();
});
element('word-course-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = element('course-word');
  if (!(input instanceof HTMLInputElement)) return;
  try {
    const request = courseWord(input.value);
    void boot('practice', undefined, {
      input: request.word,
    });
  } catch (error) {
    element('word-course-message').textContent =
      error instanceof Error ? error.message : 'Invalid seed.';
    input.focus();
  }
});
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  courseGeneration++;
  scene?.dispose();
  cleanupDaily?.();
  cleanupLeaderboard?.();
});
const dailyHistory = createDailyHistoryController();
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) dailyHistory.dispose();
});
const query = new URLSearchParams(window.location.search);
const incomingShare = readIncomingShare();
if (incomingShare !== undefined) {
  void boot('practice', undefined, undefined, incomingShare);
} else {
  void boot(
    query.get('practice') === '1' ? 'practice' : 'daily',
    import.meta.env.DEV && query.get('practice') === '1'
      ? (query.get('seed') ?? undefined)
      : undefined,
    query.get('practice') === '1' &&
      (query.has('word') || query.has('courseSeed'))
      ? { input: query.get('courseSeed') ?? query.get('word') ?? '' }
      : undefined
  );
}
