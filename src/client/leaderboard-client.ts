import { api } from './api';
import type { DailyChallenge } from '../shared/daily-challenge';
import {
  parseLeaderboardView,
  type LeaderboardRow,
  type LeaderboardView,
} from '../shared/leaderboard';
import type { VerifiedRunResponse } from '../shared/ranked-race';

export type LeaderboardController = {
  onAttemptStart: (attempt: { attemptId: number }) => void;
  onResults: (attempt: {
    attemptId: number;
    mode: 'practice' | 'ranked';
  }) => void;
  recordVerified: (attemptId: number, receipt: VerifiedRunResponse) => void;
};

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

function outcomeText(view: LeaderboardView): string {
  const outcome = view.outcome;
  if (!outcome) return '';
  if (outcome.previousBestTicks === null)
    return `This run set your first daily best: ${seconds(outcome.personalBestTicks)}.`;
  if (outcome.isPersonalBest)
    return `This run improved your daily best by ${seconds(outcome.improvementTicks ?? 0)} to ${seconds(outcome.personalBestTicks)}.`;
  return `This run kept your daily best at ${seconds(outcome.personalBestTicks)}.`;
}

/** Only post-bound board queries leave this controller. Session tokens stay in memory. */
export function createLeaderboardController(
  challenge: DailyChallenge
): LeaderboardController {
  const panel = element('leaderboard');
  const card = element('card');
  const status = element('leaderboard-status');
  const top = element('leaderboard-top');
  const nearby = element('leaderboard-nearby');
  const me = element('leaderboard-me');
  const outcome = element('leaderboard-outcome');
  const refreshElement = element('leaderboard-refresh');
  if (!(refreshElement instanceof HTMLButtonElement))
    throw new Error('Missing leaderboard refresh button');
  const refresh = refreshElement;
  element('leaderboard-day').textContent = `${challenge.day} · UTC`;
  let currentAttempt = 0;
  let showingResults = false;
  let receipt: VerifiedRunResponse | undefined;
  let request: AbortController | undefined;
  let requestVersion = 0;

  function clearRows(): void {
    fillRows(top, []);
    fillRows(nearby, []);
    top.hidden = true;
    nearby.hidden = true;
    me.textContent = '';
    outcome.textContent = '';
    outcome.hidden = true;
  }

  function render(view: LeaderboardView): void {
    clearRows();
    if (view.status === 'expired') {
      panel.dataset.state = 'expired';
      status.textContent = 'These daily standings are no longer retained.';
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
      me.textContent = `Your current best: ${seconds(view.me.finishTicks)} · #${view.me.rank}`;
      fillRows(nearby, view.nearby);
      nearby.hidden = !view.nearby.length;
    } else {
      me.textContent = 'You have no verified daily time yet.';
    }
    outcome.textContent = outcomeText(view);
    outcome.hidden = !outcome.textContent;
  }

  async function load(): Promise<void> {
    if (!showingResults) return;
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
    try {
      const value = await api.getLeaderboard.query(
        sessionId ? { sessionId } : {},
        { signal: controller.signal }
      );
      if (
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
        controller.signal.aborted ||
        version !== requestVersion ||
        attemptId !== currentAttempt ||
        !showingResults
      )
        return;
      panel.dataset.state = 'error';
      status.textContent = 'Daily standings are unavailable. Try refreshing.';
      clearRows();
    } finally {
      if (version === requestVersion) refresh.disabled = false;
    }
  }

  refresh.addEventListener('click', () => void load());
  return {
    onAttemptStart({ attemptId }) {
      request?.abort();
      requestVersion++;
      currentAttempt = attemptId;
      showingResults = false;
      receipt = undefined;
      panel.hidden = true;
      panel.dataset.state = 'idle';
      card.dataset.leaderboard = 'false';
      refresh.disabled = false;
      clearRows();
    },
    recordVerified(attemptId, verified) {
      if (attemptId === currentAttempt) receipt = verified;
    },
    onResults({ attemptId }) {
      if (attemptId !== currentAttempt) return;
      showingResults = true;
      panel.hidden = false;
      card.dataset.leaderboard = 'true';
      void load();
    },
  };
}
