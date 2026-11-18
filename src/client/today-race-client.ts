import { navigateTo } from '@devvit/web/client';
import { api } from './api';
import { parseTodayRacePostView } from '../shared/today-race-post';
import { withRequestDeadline } from './request-deadline';

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing daily navigation element: ${id}`);
  return found;
}

const panelOwners = new WeakMap<HTMLElement, symbol>();

/** An archived scene keeps its course; opening another Reddit post is an explicit action. */
export function createTodayRaceController(day: string): {
  updateArchived: (archived: boolean) => void;
  dispose: () => void;
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
  const owner = Symbol('today-race-controller');
  panelOwners.set(panel, owner);
  const listeners = new AbortController();
  let disposed = false;
  let archived = false;
  let target: string | undefined;
  let generation = 0;
  let request: AbortController | undefined;
  let readyExpiresAt: number | undefined;

  function ownsPanel(): boolean {
    return panelOwners.get(panel) === owner;
  }
  function active(): boolean {
    return !disposed && ownsPanel();
  }

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
    if (!active() || !archived) return;
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
      if (!active() || version !== generation || controller.signal.aborted)
        return;
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
        // The action already explains the ready state; reserve status for problems.
        status.textContent = '';
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
      if (!active() || version !== generation || controller.signal.aborted)
        return;
      panel.dataset.state = 'error';
      status.textContent =
        'Today’s race could not be checked. You can keep practising here.';
      refresh.hidden = false;
    }
  }

  refresh.addEventListener('click', () => void load(), {
    signal: listeners.signal,
  });
  open.addEventListener(
    'click',
    () => {
      if (!active()) return;
      if (expireReady()) return;
      if (target) navigateTo(target);
    },
    { signal: listeners.signal }
  );
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      request?.abort();
      request = undefined;
      listeners.abort();
      archived = false;
      target = undefined;
      readyExpiresAt = undefined;
      if (!ownsPanel()) return;
      panelOwners.delete(panel);
      panel.hidden = true;
      panel.dataset.state = 'idle';
      open.hidden = true;
      refresh.hidden = true;
      status.textContent = '';
    },
    updateArchived(value) {
      if (!active()) return;
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
