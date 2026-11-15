import type { LeaderboardView } from '../shared/leaderboard';
import type { VerifiedRunResponse } from '../shared/ranked-race';

/** A present-tense daily lead, never an all-time or permanent record claim. */
export function verifiedLeaderLabel(
  view: LeaderboardView,
  receipt: VerifiedRunResponse | undefined
): string | null {
  if (
    !receipt ||
    view.status !== 'available' ||
    view.viewer !== 'signed-in' ||
    !view.outcome?.isPersonalBest ||
    view.outcome.sessionId !== receipt.sessionId ||
    view.challengeId !== receipt.challengeId ||
    view.challengeHash !== receipt.challengeHash ||
    view.me?.rank !== 1 ||
    !view.me.isSelf ||
    view.me.finishTicks !== receipt.finishTicks ||
    view.outcome.personalBestTicks !== receipt.finishTicks ||
    !view.top.some(
      (row) =>
        row.isSelf && row.rank === 1 && row.finishTicks === receipt.finishTicks
    )
  )
    return null;
  return view.top.some((row) => !row.isSelf && row.rank === 1)
    ? 'Joint daily leader!'
    : 'Daily leader!';
}
