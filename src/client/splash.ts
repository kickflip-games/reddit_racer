import { requestExpandedMode } from '@devvit/web/client';

const start = document.getElementById('start-button');
const status = document.getElementById('splash-status');
start?.addEventListener('click', (event) => {
  if (import.meta.env.DEV) {
    if (status)
      status.textContent = 'Open /game.html for local unranked practice.';
    return;
  }
  requestExpandedMode(event, 'game');
});
