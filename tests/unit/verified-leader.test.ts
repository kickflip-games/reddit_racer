import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifiedLeaderLabel } from '../../src/client/verified-leader.ts';
import type { LeaderboardView } from '../../src/shared/leaderboard.ts';
import type { VerifiedRunResponse } from '../../src/shared/ranked-race.ts';
const receipt: VerifiedRunResponse = {
  sessionId: 'session',
  challengeId: 'challenge',
  challengeHash: 'hash',
  finishTicks: 1200,
  simulationHz: 120,
  finishTimeMs: 10000,
  verifiedAtMs: 1,
};
function board(): LeaderboardView {
  const me = { username: 'me', isSelf: true, rank: 1, finishTicks: 1200 };
  return {
    challengeId: 'challenge',
    challengeHash: 'hash',
    day: '2026-11-15',
    simulationHz: 120,
    serverNowMs: 2,
    retainedUntilMs: 3,
    status: 'available',
    viewer: 'signed-in',
    top: [me],
    me,
    nearby: [me],
    outcome: {
      sessionId: 'session',
      previousBestTicks: 1300,
      personalBestTicks: 1200,
      isPersonalBest: true,
      improvementTicks: 100,
    },
  };
}
void test('celebrates only this verified daily leading run, with accurate tie wording', () => {
  const view = board();
  assert.equal(verifiedLeaderLabel(view, receipt), 'Daily leader!');
  view.top.push({
    username: 'other',
    isSelf: false,
    rank: 1,
    finishTicks: 1200,
  });
  assert.equal(verifiedLeaderLabel(view, receipt), 'Joint daily leader!');
  assert.equal(verifiedLeaderLabel(view, undefined), null);
  assert.equal(
    verifiedLeaderLabel(view, { ...receipt, sessionId: 'older' }),
    null
  );
  assert.equal(
    verifiedLeaderLabel(view, { ...receipt, challengeHash: 'other' }),
    null
  );
});
void test('does not confuse an earlier or other-device best with this finish', () => {
  for (const mutate of [
    (v: LeaderboardView) => {
      if (v.me) v.me.finishTicks = 1100;
    },
    (v: LeaderboardView) => {
      if (v.me) v.me.rank = 2;
    },
    (v: LeaderboardView) => {
      if (v.outcome) v.outcome.isPersonalBest = false;
    },
    (v: LeaderboardView) => {
      v.status = 'expired';
    },
    (v: LeaderboardView) => {
      v.top = [];
    },
    (v: LeaderboardView) => {
      v.viewer = 'signed-out';
    },
  ]) {
    const view = board();
    mutate(view);
    assert.equal(verifiedLeaderLabel(view, receipt), null);
  }
});
