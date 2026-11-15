import { api } from './api';
import type { DailyChallenge } from '../shared/daily-challenge';
import {
  parseStartRankedRaceResponse,
  parseVerifiedRunResponse,
  type StartRankedRaceResponse,
  type VerifiedRunResponse,
} from '../shared/ranked-race';
import type { GameSceneHooks, VerificationOutcome } from './game-scene';
import { withRequestDeadline } from './request-deadline';

export type AttemptPresentation = 'ready' | 'practice' | 'preparing' | 'ranked';

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('data' in error))
    return undefined;
  const data = error.data;
  if (typeof data !== 'object' || data === null || !('code' in data))
    return undefined;
  return typeof data.code === 'string' ? data.code : undefined;
}

function matchesCourse(
  session: StartRankedRaceResponse,
  challenge: DailyChallenge
): boolean {
  return (
    session.challengeId === challenge.id &&
    session.challengeHash === challenge.challengeHash &&
    session.trackHash === challenge.trackHash &&
    session.simulationVersion === challenge.simulationVersion &&
    session.handlingVersion === challenge.handlingVersion
  );
}

/** Authenticated session tokens remain private to this controller, never DOM or saved storage. */
export function createRankedRaceHooks(
  challenge: DailyChallenge,
  present: (mode: AttemptPresentation) => void,
  onVerified?: (attemptId: number, receipt: VerifiedRunResponse) => void,
  isPracticeOnly?: () => boolean
): GameSceneHooks {
  const sessions = new Map<number, StartRankedRaceResponse>();
  let currentAttempt = 0;
  return {
    async beforeStart({ attemptId, signal }) {
      currentAttempt = attemptId;
      if (isPracticeOnly?.()) {
        present('practice');
        return {
          kind: 'practice',
          message: 'Archived circuit. This attempt is unranked.',
        };
      }
      present('preparing');
      let value: unknown;
      try {
        value = await withRequestDeadline(
          (requestSignal) =>
            api.startRankedRace.mutate(undefined, { signal: requestSignal }),
          { signal }
        );
      } catch (error) {
        if (signal.aborted || attemptId !== currentAttempt)
          return { kind: 'blocked', message: 'Preparation cancelled.' };
        present('practice');
        const code = errorCode(error);
        const message =
          code === 'UNAUTHORIZED'
            ? 'Sign in to verify daily runs. This attempt is unranked.'
            : code === 'PRECONDITION_FAILED'
              ? 'Ranked racing is unavailable for this course. This attempt is unranked.'
              : code === 'TOO_MANY_REQUESTS'
                ? 'Verification is busy. This attempt is unranked.'
                : 'Verification is unavailable. This attempt is unranked.';
        return { kind: 'practice', message };
      }
      if (signal.aborted || attemptId !== currentAttempt)
        return { kind: 'blocked', message: 'Preparation cancelled.' };
      let session: StartRankedRaceResponse;
      try {
        session = parseStartRankedRaceResponse(value);
      } catch {
        present('practice');
        return {
          kind: 'blocked',
          message:
            'The race could not be checked. Reload the saved daily course.',
        };
      }
      if (!matchesCourse(session, challenge)) {
        present('practice');
        return {
          kind: 'blocked',
          message:
            'This race does not match the saved circuit. Reload before starting another run.',
        };
      }
      sessions.set(attemptId, session);
      present('ranked');
      return {
        kind: 'ranked',
        message: 'Daily race ready. Your time is checked after finishing.',
      };
    },
    async onFinish({
      attemptId,
      replay,
      finishTicks,
    }): Promise<VerificationOutcome> {
      const session = sessions.get(attemptId);
      if (!session)
        return {
          status: 'rejected',
          message: 'This attempt could not be checked. Try a new race.',
        };
      try {
        const value = await withRequestDeadline((signal) =>
          api.submitRun.mutate(
            { sessionId: session.sessionId, replay },
            { signal }
          )
        );
        let receipt: VerifiedRunResponse;
        try {
          receipt = parseVerifiedRunResponse(value);
        } catch {
          if (attemptId === currentAttempt) present('practice');
          return {
            status: 'rejected',
            message:
              'The verification response could not be checked. This time remains unverified.',
          };
        }
        if (
          receipt.sessionId !== session.sessionId ||
          receipt.challengeId !== challenge.id ||
          receipt.challengeHash !== challenge.challengeHash ||
          receipt.simulationHz !== challenge.simulationHz ||
          receipt.finishTicks !== finishTicks ||
          receipt.verifiedAtMs < session.serverNowMs ||
          receipt.verifiedAtMs >= session.expiresAtMs
        ) {
          if (attemptId === currentAttempt) present('practice');
          return {
            status: 'rejected',
            message:
              'The verification result does not match this attempt. This time remains unverified.',
          };
        }
        if (attemptId === currentAttempt) onVerified?.(attemptId, receipt);
        return {
          status: 'verified',
          message: 'Time verified.',
          finishTicks: receipt.finishTicks,
        };
      } catch (error) {
        if (attemptId === currentAttempt) present('practice');
        const code = errorCode(error);
        if (
          code &&
          ![
            'INTERNAL_SERVER_ERROR',
            'TIMEOUT',
            'SERVICE_UNAVAILABLE',
            'TOO_MANY_REQUESTS',
          ].includes(code)
        ) {
          return {
            status: 'rejected',
            message:
              code === 'NOT_FOUND' || code === 'PRECONDITION_FAILED'
                ? 'This attempt can no longer be checked. Try a new race.'
                : 'This run could not be accepted. Try a new attempt.',
          };
        }
        return {
          status: 'unavailable',
          message: 'Verification is unavailable. This time remains unverified.',
        };
      } finally {
        sessions.delete(attemptId);
      }
    },
    onAbandon({ attemptId }) {
      sessions.delete(attemptId);
      if (attemptId === currentAttempt) {
        currentAttempt = 0;
        present('practice');
      }
    },
  };
}
