import { rememberShareForExpansion } from './share-handoff';
import { context, requestExpandedMode } from '@devvit/web/client';

const start = document.getElementById('start-button');
const status = document.getElementById('splash-status');
const date = document.getElementById('splash-date');
function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}
// Post metadata is a small server-created hint; the expanded view loads the saved course.
const postData = context?.postData;
if (postData && validDay(postData.challengeDay) && date) {
  date.textContent = `${postData.challengeDay} · UTC CIRCUIT`;
  date.hidden = false;
}
start?.addEventListener('click', (event) => {
  if (import.meta.env.DEV) {
    if (status)
      status.textContent = 'Open /game.html for local unranked practice.';
    return;
  }
  try {
    rememberShareForExpansion();
    requestExpandedMode(event, 'game');
  } catch (error) {
    if (status)
      status.textContent =
        error instanceof Error ? error.message : 'Shared track unavailable.';
  }
});
