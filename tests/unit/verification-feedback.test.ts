import assert from 'node:assert/strict';
import { test } from 'node:test';
import { submissionFailureMessage } from '../../src/client/verification-feedback';

test('verification failures distinguish replay, authentication and session problems', () => {
  assert.match(submissionFailureMessage('BAD_REQUEST'), /replay.*not saved/);
  assert.match(submissionFailureMessage('UNAUTHORIZED'), /Sign in again/);
  assert.match(submissionFailureMessage('FORBIDDEN'), /account or race/);
  assert.match(submissionFailureMessage('CONFLICT'), /different result/);
  assert.match(
    submissionFailureMessage('PRECONDITION_FAILED'),
    /no longer valid/
  );
  assert.match(submissionFailureMessage('NOT_FOUND'), /no longer valid/);
});
test('unknown errors cannot inject server data into visible feedback', () => {
  assert.equal(
    submissionFailureMessage('secret arbitrary server text'),
    'The server did not accept this time. Please start a new attempt.'
  );
});
