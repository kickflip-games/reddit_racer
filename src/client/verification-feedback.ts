/** Safe public explanations. Never render arbitrary server error text. */
export function submissionFailureMessage(code: string): string {
  switch (code) {
    case 'UNAUTHORIZED':
      return 'Sign in again, then start a new race. This time was not saved.';
    case 'FORBIDDEN':
      return 'This attempt no longer matches your account or race. Reopen the race and try again.';
    case 'CONFLICT':
      return 'This race session already has a different result. Start a new attempt.';
    case 'NOT_FOUND':
    case 'PRECONDITION_FAILED':
      return 'This attempt is no longer valid. Reopen the race and try again.';
    case 'BAD_REQUEST':
      return 'The server could not verify this race replay, so this time was not saved. Please retry.';
    default:
      return 'The server did not accept this time. Please start a new attempt.';
  }
}
