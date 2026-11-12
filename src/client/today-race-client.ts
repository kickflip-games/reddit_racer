import { navigateTo } from '@devvit/web/client';
import { api } from './api';
import { parseTodayRacePostView } from '../shared/today-race-post';
import { withRequestDeadline } from './request-deadline';

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing daily navigation element: ${id}`);
  return found;
}

/** An archived scene keeps its course; opening another Reddit post is an explicit action. */
export function createTodayRaceController(day: string): {
  updateArchived: (archived: boolean) => void;
} {
  const panel = element('today-race');
  const status = element('today-race-status');
  const openElement = element('today-race-button');
  const refreshElement = element('today-race-refresh');
  if (
    !(openElement instanceof HTMLButtonElement) ||
    !(refreshElement instanceof HTMLButtonElement)
  )
    throw new Error('Missing daily navigation actions');
  const open = openElement;
  const refresh = refreshElement;
  let archived = false;
  let target: string | undefined;
  let generation = 0;
  let request: AbortController | undefined;
  let readyExpiresAt: number | undefined;

  function expireReady(): boolean {
    if (readyExpiresAt === undefined || performance.now() < readyExpiresAt)
      return false;
    target = undefined;
    readyExpiresAt = undefined;
    open.hidden = true;
    refresh.hidden = false;
    panel.dataset.state = 'not-ready';
    status.textContent =
      'A new UTC day has begun. Check for today’s race, or keep practising here.';
    return true;
  }

  async function load(): Promise<void> {
    if (!archived) return;
    request?.abort();
    request = new AbortController();
    const controller = request;
    const version = ++generation;
    target = undefined;
    readyExpiresAt = undefined;
    const startedAt = performance.now();
    open.hidden = true;
    refresh.hidden = true;
    panel.dataset.state = 'loading';
    status.textContent = 'Checking today’s race…';
    try {
      const value = await withRequestDeadline(
        (signal) => api.todayRacePost.query(undefined, { signal }),
        { signal: controller.signal }
      );
      if (version !== generation || controller.signal.aborted) return;
      const view = parseTodayRacePostView(value);
      const remainingMs =
        view.nextResetAtMs -
        view.serverNowMs -
        Math.max(0, performance.now() - startedAt);
      if (
        view.status === 'ready' &&
        view.post &&
        view.currentDay > day &&
        remainingMs > 0
      ) {
        target = view.post.url;
        readyExpiresAt = performance.now() + remainingMs;
        panel.dataset.state = 'ready';
        status.textContent = `Today’s ${view.currentDay} UTC race is ready. This post keeps its original course.`;
        open.hidden = false;
      } else {
        panel.dataset.state = 'not-ready';
        status.textContent =
          remainingMs <= 0
            ? 'The UTC day changed while checking. Check again for today’s race.'
            : view.currentDay === day
              ? 'This is still today’s course. You can keep practising here.'
              : 'Today’s race is not ready yet. You can practise this course.';
        refresh.hidden = false;
      }
    } catch {
      if (version !== generation || controller.signal.aborted) return;
      panel.dataset.state = 'error';
      status.textContent =
        'Today’s race could not be checked. You can keep practising here.';
      refresh.hidden = false;
    }
  }

  refresh.addEventListener('click', () => void load());
  open.addEventListener('click', () => {
    if (expireReady()) return;
    if (target) navigateTo(target);
  });
  return {
    updateArchived(value) {
      if (value === archived) {
        if (archived) expireReady();
        return;
      }
      archived = value;
      panel.hidden = !archived;
      if (archived) void load();
      else {
        generation++;
        request?.abort();
        target = undefined;
      }
    },
  };
}
