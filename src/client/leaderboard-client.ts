import { api } from './api';
import { verifiedLeaderLabel } from './verified-leader';
import type { DailyChallenge } from '../shared/daily-challenge';
import {
  parseLeaderboardView,
  type LeaderboardRow,
  type LeaderboardView,
} from '../shared/leaderboard';
import type { VerifiedRunResponse } from '../shared/ranked-race';
import { withRequestDeadline } from './request-deadline';

export type LeaderboardController = {
  dispose: () => void;
  onAttemptStart: (attempt: { attemptId: number }) => void;
  onResults: (attempt: {
    attemptId: number;
    mode: 'practice' | 'ranked';
  }) => void;
  recordVerified: (attemptId: number, receipt: VerifiedRunResponse) => void;
};

const panelOwners = new WeakMap<HTMLElement, symbol>();

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing leaderboard element: ${id}`);
  return found;
}

function seconds(ticks: number): string {
  return `${(ticks / 120).toFixed(3)}s`;
}

function fillRows(table: HTMLElement, rows: LeaderboardRow[]): void {
  const body = table.querySelector('tbody');
  if (!body) throw new Error('Missing leaderboard table body');
  body.replaceChildren();
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.dataset.self = String(row.isSelf);
    for (const text of [
      String(row.rank),
      `${row.username}${row.isSelf ? ' · you' : ''}`,
      seconds(row.finishTicks),
    ]) {
      const cell = document.createElement('td');
      cell.textContent = text;
      tr.append(cell);
    }
    body.append(tr);
  }
}

function outcomeText(
  view: LeaderboardView,
  receipt: VerifiedRunResponse | undefined
): string {
  const outcome = view.outcome;
  if (!outcome || !receipt) return '';
  if (outcome.previousBestTicks === null) return '';
  if (outcome.isPersonalBest)
    return `−${seconds(outcome.improvementTicks ?? 0)}`;
  const delta = receipt.finishTicks - outcome.previousBestTicks;
  return delta === 0 ? 'Tied best' : `+${seconds(delta)}`;
}

/** Only post-bound board queries leave this controller. Session tokens stay in memory. */
export function createLeaderboardController(
  challenge: DailyChallenge,
  onVerifiedLeader?: (attemptId: number) => void
): LeaderboardController {
  const panel = element('leaderboard');
  const card = element('card');
  const status = element('leaderboard-status');
  const top = element('leaderboard-top');
  const nearby = element('leaderboard-nearby');
  const me = element('leaderboard-me');
  const outcome = element('leaderboard-outcome');
  const summary = element('result-summary');
  document.getElementById('verified-leader')?.remove();
  const leaderBadge = document.createElement('p');
  leaderBadge.id = 'verified-leader';
  leaderBadge.hidden = true;
  summary.prepend(leaderBadge);
  let celebratedAttempt: number | undefined;
  const target = element('result-target');
  const detailsElement = element('leaderboard-details');
  if (!(detailsElement instanceof HTMLDetailsElement))
    throw new Error('Missing standings disclosure');
  const details = detailsElement;
  const refreshElement = element('leaderboard-refresh');
  if (!(refreshElement instanceof HTMLButtonElement))
    throw new Error('Missing leaderboard refresh button');
  const refresh = refreshElement;
  const owner = Symbol('leaderboard-controller');
  panelOwners.set(panel, owner);
  const listeners = new AbortController();
  let disposed = false;
  element('leaderboard-day').textContent = `${challenge.day} · UTC`;
  let currentAttempt = 0;
  let showingResults = false;
  let receipt: VerifiedRunResponse | undefined;
  let request: AbortController | undefined;
  let requestVersion = 0;
  let resultMode: 'practice' | 'ranked' = 'practice';

  function ownsPanel(): boolean {
    return panelOwners.get(panel) === owner;
  }
  function active(): boolean {
    return !disposed && ownsPanel();
  }

  function clearRows(): void {
    leaderBadge.hidden = true;
    leaderBadge.textContent = '';
    card.dataset.leader = 'false';
    fillRows(top, []);
    fillRows(nearby, []);
    top.hidden = true;
    nearby.hidden = true;
    me.textContent = '';
    outcome.textContent = '';
    outcome.hidden = true;
    target.textContent = '';
    target.hidden = true;
  }

  function unrankedExplanation(): string {
    return receipt
      ? 'Time verified · daily position unavailable.'
      : resultMode === 'practice'
        ? 'Practice time · not ranked.'
        : 'Time unverified · not ranked.';
  }

  function render(view: LeaderboardView): void {
    clearRows();
    if (view.status === 'expired') {
      panel.dataset.state = 'expired';
      status.textContent = 'These daily standings are no longer retained.';
      me.textContent = unrankedExplanation();
      return;
    }
    panel.dataset.state = view.top.length ? 'ready' : 'empty';
    status.textContent = view.top.length
      ? 'Fastest verified times for this circuit.'
      : 'No verified times yet for this circuit.';
    fillRows(top, view.top);
    top.hidden = !view.top.length;
    if (view.viewer === 'signed-out') {
      me.textContent = 'Sign in to save a daily best and see your position.';
    } else if (view.me) {
      me.textContent = `Best ${seconds(view.me.finishTicks)} · #${view.me.rank}`;
      const additional = view.nearby.filter(
        (row) =>
          !view.top.some(
            (topRow) =>
              topRow.username === row.username &&
              topRow.rank === row.rank &&
              topRow.finishTicks === row.finishTicks
          )
      );
      fillRows(nearby, additional);
      nearby.hidden = !additional.length;
      const faster = view.nearby
        .filter((row) => view.me && row.finishTicks < view.me.finishTicks)
        .at(-1);
      if (faster) {
        target.textContent = `Next target: ${faster.username} · ${seconds(faster.finishTicks)} (${seconds(view.me.finishTicks - faster.finishTicks)} ahead)`;
        target.hidden = false;
      }
    } else {
      me.textContent = 'You have no verified daily time yet.';
    }
    if (receipt && view.outcome) {
      card.dataset.best = String(view.outcome.isPersonalBest);
      const kicker = document.getElementById('card-kicker');
      if (kicker) kicker.textContent = 'Verified';
    }
    const leaderLabel = verifiedLeaderLabel(view, receipt);
    if (leaderLabel) {
      leaderBadge.textContent = leaderLabel;
      leaderBadge.hidden = false;
      card.dataset.leader = 'true';
      if (celebratedAttempt !== currentAttempt) {
        celebratedAttempt = currentAttempt;
        onVerifiedLeader?.(currentAttempt);
      }
    }
    outcome.textContent = outcomeText(view, receipt);
    outcome.hidden = !outcome.textContent;
  }

  async function load(): Promise<void> {
    if (!active() || !showingResults) return;
    request?.abort();
    const controller = new AbortController();
    request = controller;
    const version = ++requestVersion;
    const attemptId = currentAttempt;
    const sessionId = receipt?.sessionId;
    panel.dataset.state = 'loading';
    status.textContent = 'Loading daily standings…';
    refresh.disabled = true;
    clearRows();
    me.textContent = receipt
      ? 'Time verified · loading your daily position…'
      : unrankedExplanation();
    try {
      const value = await withRequestDeadline(
        (signal) =>
          api.getLeaderboard.query(sessionId ? { sessionId } : {}, { signal }),
        { signal: controller.signal }
      );
      if (
        !active() ||
        controller.signal.aborted ||
        version !== requestVersion ||
        attemptId !== currentAttempt ||
        !showingResults
      )
        return;
      const view = parseLeaderboardView(value);
      if (
        view.challengeId !== challenge.id ||
        view.challengeHash !== challenge.challengeHash ||
        view.day !== challenge.day ||
        view.simulationHz !== challenge.simulationHz ||
        (view.outcome !== null &&
          (view.outcome.sessionId !== sessionId ||
            receipt === undefined ||
            (view.outcome.isPersonalBest
              ? view.outcome.personalBestTicks !== receipt.finishTicks
              : view.outcome.personalBestTicks > receipt.finishTicks)))
      )
        throw new Error('Daily standings do not match this circuit.');
      render(view);
    } catch {
      if (
        !active() ||
        controller.signal.aborted ||
        version !== requestVersion ||
        attemptId !== currentAttempt ||
        !showingResults
      )
        return;
      panel.dataset.state = 'error';
      status.textContent = 'Daily standings are unavailable. Try refreshing.';
      clearRows();
      me.textContent = unrankedExplanation();
    } finally {
      if (active() && version === requestVersion) refresh.disabled = false;
    }
  }

  refresh.addEventListener('click', () => void load(), {
    signal: listeners.signal,
  });
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      requestVersion++;
      request?.abort();
      request = undefined;
      listeners.abort();
      currentAttempt = 0;
      showingResults = false;
      receipt = undefined;
      if (!ownsPanel()) return;
      panelOwners.delete(panel);
      panel.hidden = true;
      summary.hidden = true;
      details.open = false;
      panel.dataset.state = 'idle';
      card.dataset.leaderboard = 'false';
      refresh.disabled = false;
      status.textContent = '';
      clearRows();
    },
    onAttemptStart({ attemptId }) {
      if (!active()) return;
      request?.abort();
      requestVersion++;
      currentAttempt = attemptId;
      showingResults = false;
      receipt = undefined;
      panel.hidden = true;
      summary.hidden = true;
      details.open = false;
      panel.dataset.state = 'idle';
      card.dataset.leaderboard = 'false';
      refresh.disabled = false;
      clearRows();
    },
    recordVerified(attemptId, verified) {
      if (!active()) return;
      if (attemptId === currentAttempt) receipt = verified;
    },
    onResults({ attemptId, mode }) {
      if (!active()) return;
      if (attemptId !== currentAttempt) return;
      showingResults = true;
      resultMode = mode;
      panel.hidden = false;
      summary.hidden = false;
      card.dataset.leaderboard = 'true';
      void load();
    },
  };
}
