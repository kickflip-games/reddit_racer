import { initTRPC, TRPCError } from '@trpc/server';
import {
  DailyChallengeError,
  type DailyChallengeView,
} from '../shared/daily-challenge';
import {
  parseRankedSubmission,
  RankedRaceError,
  type RankedSubmission,
  type StartRankedRaceResponse,
  type VerifiedRunResponse,
} from '../shared/ranked-race';

export type RpcContext = {
  getDailyChallenge: () => Promise<DailyChallengeView>;
  startRankedRace: () => Promise<StartRankedRaceResponse>;
  submitRun: (input: RankedSubmission) => Promise<VerifiedRunResponse>;
};

const t = initTRPC.context<RpcContext>().create({ isDev: false });

function noInput(value: unknown): undefined {
  if (value !== undefined)
    throw new Error('The originating post and account determine this request.');
  return undefined;
}

function publicRaceError(error: unknown): TRPCError {
  if (error instanceof RankedRaceError) {
    switch (error.kind) {
      case 'unauthenticated':
        return new TRPCError({ code: 'UNAUTHORIZED', message: error.message });
      case 'forbidden':
        return new TRPCError({ code: 'FORBIDDEN', message: error.message });
      case 'invalid':
        return new TRPCError({ code: 'BAD_REQUEST', message: error.message });
      case 'conflict':
        return new TRPCError({ code: 'CONFLICT', message: error.message });
      case 'rate-limited':
        return new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: error.message,
        });
      case 'archive':
      case 'expired':
      case 'unsupported':
      case 'integrity':
        return new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: error.message,
        });
      case 'unavailable':
        return new TRPCError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'Race verification is temporarily unavailable.',
        });
    }
  }
  if (
    error instanceof DailyChallengeError &&
    (error.kind === 'integrity' || error.kind === 'unsupported')
  )
    return new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'The stored race rules could not be verified.',
    });
  console.error('Ranked race request failed', error);
  return new TRPCError({
    code: 'SERVICE_UNAVAILABLE',
    message: 'Race verification is temporarily unavailable.',
  });
}

export const appRouter = t.router({
  dailyChallenge: t.procedure.input(noInput).query(async ({ ctx }) => {
    try {
      return await ctx.getDailyChallenge();
    } catch (error) {
      if (
        error instanceof DailyChallengeError &&
        (error.kind === 'integrity' || error.kind === 'unsupported')
      ) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'This stored circuit cannot be played with the available race rules. Please try again later.',
        });
      }
      console.error('Daily challenge request failed', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'The daily circuit is temporarily unavailable.',
      });
    }
  }),
  startRankedRace: t.procedure.input(noInput).mutation(async ({ ctx }) => {
    try {
      return await ctx.startRankedRace();
    } catch (error) {
      throw publicRaceError(error);
    }
  }),
  submitRun: t.procedure
    .input(parseRankedSubmission)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.submitRun(input);
      } catch (error) {
        throw publicRaceError(error);
      }
    }),
});

export type AppRouter = typeof appRouter;
