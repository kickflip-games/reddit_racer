import { initTRPC, TRPCError } from '@trpc/server';
import {
  DailyChallengeError,
  type DailyChallengeView,
} from '../shared/daily-challenge';

export type RpcContext = {
  getDailyChallenge: () => Promise<DailyChallengeView>;
};

const t = initTRPC.context<RpcContext>().create({ isDev: false });

export const appRouter = t.router({
  dailyChallenge: t.procedure
    .input((value: unknown) => {
      if (value !== undefined)
        throw new Error('The originating post determines the daily challenge.');
      return undefined;
    })
    .query(async ({ ctx }) => {
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
});

export type AppRouter = typeof appRouter;
