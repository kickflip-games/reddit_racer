import { navigateTo } from '@devvit/web/client';
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
  const previous = button('daily-history-previous'),
    next = button('daily-history-next');
  const more = button('daily-history-more'),
    post = button('daily-history-post'),
    retry = button('daily-history-retry');
  const go = button('daily-history-go');
  const back = button('daily-history-back');
  const status = element('daily-history-status'),
    preview = element('daily-history-preview-status');
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
  let previewView: DailyStandingsView | undefined;

  function bounds(view: DailyStandingsView): void {
    date.min = view.minDay;
    date.max = view.maxDay;
    date.value = view.day;
    previous.disabled = view.day <= view.minDay;
    next.disabled = view.day >= view.maxDay;
  }
  function busy(value: boolean): void {
    go.disabled = value;
    date.disabled = value;
    more.disabled = value;
    back.disabled = value;
    if (value) {
      previous.disabled = true;
      next.disabled = true;
    } else if (date.min && date.max) {
      previous.disabled = date.value <= date.min;
      next.disabled = date.value >= date.max;
    }
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
    post.hidden = view.postUrl === null;
    retry.hidden = view.status !== 'unavailable';
    provisional.hidden = !view.provisional;
    dialog.dataset.state = view.status;
    const messages = {
      available: `${view.day} UTC · verified community standings`,
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
  async function load(
    day?: string,
    offset = 0,
    initial = false
  ): Promise<void> {
    request?.abort();
    request = new AbortController();
    const controller = request,
      version = ++generation;
    if (!initial) {
      if (day) date.value = day;
      currentOffset = offset;
      busy(true);
      rows.replaceChildren();
      podium.replaceChildren();
      table.hidden = true;
      ties.textContent = '';
      more.hidden = true;
      back.hidden = true;
      post.hidden = true;
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
      if (initial) {
        previewView = view;
        if (view.status === 'available' && view.rows[0]) {
          const first = view.rows[0];
          preview.textContent = `${view.day} UTC · ${view.rows[1]?.rank === 1 ? 'Tied lead: ' : ''}${first.username} · ${seconds(first.finishTicks)}${view.rows[1]?.rank === 1 || view.nextOffset !== null ? ' · view all standings' : ''}${view.provisional ? ' · provisional' : ''}`;
        } else if (view.status === 'empty')
          preview.textContent = 'No verified finishes yesterday.';
        else preview.textContent = '';
      } else render(view, offset);
    } catch {
      if (disposed || version !== generation || controller.signal.aborted)
        return;
      if (!initial) {
        status.textContent =
          'Standings are temporarily unavailable. Please try again.';
        dialog.dataset.state = 'unavailable';
        retry.hidden = false;
      }
    } finally {
      if (!disposed && version === generation && !initial) busy(false);
    }
  }
  function selected(): void {
    if (!date.reportValidity()) return;
    void load(date.value);
  }
  open.addEventListener(
    'click',
    () => {
      dialog.showModal();
      close.focus();
      if (previewView) render(previewView, 0);
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
  previous.addEventListener(
    'click',
    () => {
      if (date.value && date.value > date.min)
        void load(shiftDay(date.value, -1));
    },
    { signal: listeners.signal }
  );
  next.addEventListener(
    'click',
    () => {
      if (date.value && date.value < date.max)
        void load(shiftDay(date.value, 1));
    },
    { signal: listeners.signal }
  );
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
  post.addEventListener(
    'click',
    () => {
      if (current?.postUrl) navigateTo(current.postUrl);
    },
    { signal: listeners.signal }
  );
  const observer = new MutationObserver(() => {
    if (element('card').hidden && dialog.open) dialog.close();
  });
  observer.observe(element('card'), {
    attributes: true,
    attributeFilter: ['hidden'],
  });
  void load(undefined, 0, true);
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
