import { api } from './api';
import { withRequestDeadline } from './request-deadline';
import {
  parseDailyStandingsView,
  type DailyStandingsView,
} from '../shared/daily-standings';

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing daily history element: ${id}`);
  return found;
}
function button(id: string): HTMLButtonElement {
  const found = element(id);
  if (!(found instanceof HTMLButtonElement))
    throw new Error(`Missing button: ${id}`);
  return found;
}
function seconds(ticks: number): string {
  return `${(ticks / 120).toFixed(3)}s`;
}
function shiftDay(day: string, amount: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + amount * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Read-only, finite archive requests. Course selection and ranked admission never change. */
export function createDailyHistoryController(): { dispose(): void } {
  const foundDialog = element('daily-history-dialog');
  const foundDate = element('daily-history-date');
  if (
    !(foundDialog instanceof HTMLDialogElement) ||
    !(foundDate instanceof HTMLInputElement)
  )
    throw new Error('Missing history dialog');
  const dialog = foundDialog,
    date = foundDate;
  const open = button('daily-history-open'),
    close = button('daily-history-close');
  const more = button('daily-history-more'),
    retry = button('daily-history-retry');
  const back = button('daily-history-back');
  const status = element('daily-history-status');
  const rows = element('daily-history-rows'),
    podium = element('daily-history-podium');
  const table = element('daily-history-table'),
    ties = element('daily-history-ties');
  const provisional = element('daily-history-provisional');
  const listeners = new AbortController();
  let request: AbortController | undefined;
  let generation = 0,
    disposed = false;
  let current: DailyStandingsView | undefined;
  let currentOffset = 0;

  function bounds(view: DailyStandingsView): void {
    date.min = view.minDay;
    date.max = view.maxDay;
    date.value = view.day;
  }
  function busy(value: boolean): void {
    date.disabled = value;
    more.disabled = value;
    back.disabled = value;
  }
  function render(view: DailyStandingsView, offset: number): void {
    current = view;
    currentOffset = offset;
    bounds(view);
    rows.replaceChildren();
    podium.replaceChildren();
    ties.textContent = '';
    table.hidden = !view.rows.length;
    more.hidden = view.nextOffset === null;
    back.hidden = offset === 0;
    retry.hidden = view.status !== 'unavailable';
    provisional.hidden = !view.provisional;
    provisional.textContent =
      view.day === view.maxDay
        ? 'Live standings: verified finishes update throughout today.'
        : 'Provisional: in-flight verified finishes can still arrive after midnight UTC.';
    dialog.dataset.state = view.status;
    const messages = {
      available: `${view.day === view.maxDay ? 'Today · ' : ''}${view.day} UTC · verified community standings`,
      empty: `${view.day} UTC · no verified finishes were recorded.`,
      missing: `${view.day} UTC · no saved daily race is available.`,
      expired: `${view.day} UTC · these standings are no longer retained.`,
      unavailable: `${view.day} UTC · standings are temporarily unavailable.`,
    };
    status.textContent = messages[view.status];
    for (const row of view.rows) {
      const tr = document.createElement('tr');
      if (row.isSelf) tr.dataset.self = 'true';
      for (const value of [
        `#${row.rank}`,
        row.username + (row.isSelf ? ' (you)' : ''),
        seconds(row.finishTicks),
      ]) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(td);
      }
      rows.append(tr);
    }
    // A bounded podium preview never claims to list every tied racer.
    if (offset === 0) {
      for (const row of view.rows
        .filter((entry) => entry.rank <= 3)
        .slice(0, 3)) {
        const li = document.createElement('li');
        li.textContent = `#${row.rank} · ${row.username} · ${seconds(row.finishTicks)}`;
        podium.append(li);
      }
    }
    if (view.rows.length) {
      ties.textContent = `Showing racers ${offset + 1}–${offset + view.rows.length}. Equal times share a rank.${view.hasMore ? (view.nextOffset !== null ? ' More racers, including any continued ties, are on the next page.' : ' More racers exist beyond this archive’s browsing limit.') : ''}`;
      if (offset === 0 && view.rows.filter((row) => row.rank <= 3).length > 3)
        ties.textContent = `Podium preview; more tied podium racers appear in the standings below. ${ties.textContent}`;
    }
  }
  async function load(day?: string, offset = 0): Promise<void> {
    request?.abort();
    request = new AbortController();
    const controller = request,
      version = ++generation;
    {
      if (day) date.value = day;
      currentOffset = offset;
      busy(true);
      rows.replaceChildren();
      podium.replaceChildren();
      table.hidden = true;
      ties.textContent = '';
      more.hidden = true;
      back.hidden = true;
      retry.hidden = true;
      provisional.hidden = true;
      status.textContent = 'Loading verified standings…';
      dialog.dataset.state = 'loading';
    }
    try {
      const value = await withRequestDeadline(
        (signal) =>
          api.dailyStandings.query(
            { ...(day ? { day } : {}), offset },
            { signal }
          ),
        { signal: controller.signal }
      );
      if (disposed || version !== generation || controller.signal.aborted)
        return;
      const view = parseDailyStandingsView(value);
      if ((day && view.day !== day) || view.offset !== offset)
        throw new Error('Historical day mismatch');
      render(view, offset);
    } catch {
      if (disposed || version !== generation || controller.signal.aborted)
        return;
      {
        status.textContent =
          'Standings are temporarily unavailable. Please try again.';
        dialog.dataset.state = 'unavailable';
        retry.hidden = false;
      }
    } finally {
      if (!disposed && version === generation) busy(false);
    }
  }
  function moveDay(delta: number): void {
    if (date.disabled || !date.value) return;
    const day = shiftDay(date.value, delta);
    if (day >= date.min && day <= date.max) void load(day);
  }
  let swipe: { x: number; y: number } | undefined;
  dialog.addEventListener(
    'pointerdown',
    (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest('button, input, a')
      )
        return;
      swipe = { x: event.clientX, y: event.clientY };
    },
    { signal: listeners.signal }
  );
  dialog.addEventListener(
    'pointerup',
    (event) => {
      if (!swipe) return;
      const dx = event.clientX - swipe.x,
        dy = event.clientY - swipe.y;
      swipe = undefined;
      if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5)
        moveDay(dx < 0 ? -1 : 1);
    },
    { signal: listeners.signal }
  );
  dialog.addEventListener(
    'pointercancel',
    () => {
      swipe = undefined;
    },
    { signal: listeners.signal }
  );
  dialog.addEventListener(
    'keydown',
    (event) => {
      if (event.target instanceof Element && event.target.closest('input'))
        return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        moveDay(event.key === 'ArrowLeft' ? -1 : 1);
      }
    },
    { signal: listeners.signal }
  );
  function selected(): void {
    if (!date.reportValidity()) return;
    void load(date.value);
  }
  open.addEventListener(
    'click',
    () => {
      dialog.showModal();
      close.focus();
      void load();
    },
    { signal: listeners.signal }
  );
  close.addEventListener('click', () => dialog.close(), {
    signal: listeners.signal,
  });
  dialog.addEventListener(
    'close',
    () => {
      request?.abort();
      generation++;
      if (!disposed && !element('card').hidden) open.focus();
    },
    { signal: listeners.signal }
  );
  // Modal keys must never reach the game's one-button driving listener.
  dialog.addEventListener('keydown', (event) => event.stopPropagation(), {
    signal: listeners.signal,
  });
  dialog.addEventListener('pointerdown', (event) => event.stopPropagation(), {
    signal: listeners.signal,
  });
  element('daily-history-form').addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      selected();
    },
    { signal: listeners.signal }
  );
  date.addEventListener('change', selected, { signal: listeners.signal });
  more.addEventListener(
    'click',
    () => {
      if (current?.nextOffset !== null && current?.nextOffset !== undefined)
        void load(current.day, current.nextOffset);
    },
    { signal: listeners.signal }
  );
  back.addEventListener(
    'click',
    () => {
      if (current && currentOffset > 0)
        void load(current.day, currentOffset - 20);
    },
    { signal: listeners.signal }
  );
  retry.addEventListener(
    'click',
    () => void load(date.value || undefined, currentOffset),
    { signal: listeners.signal }
  );
  const observer = new MutationObserver(() => {
    if (element('card').hidden && dialog.open) dialog.close();
  });
  observer.observe(element('card'), {
    attributes: true,
    attributeFilter: ['hidden'],
  });
  return {
    dispose() {
      disposed = true;
      generation++;
      request?.abort();
      listeners.abort();
      observer.disconnect();
      if (dialog.open) dialog.close();
    },
  };
}
