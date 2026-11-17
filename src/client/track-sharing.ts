import { context, showShareSheet } from '@devvit/web/client';
import { createTrackShare } from '../shared/track-share';
import type { Track } from '../shared/track';

export function initializeTrackSharing() {
  const share = document.getElementById('share-track-button')!;
  const copy = document.getElementById('copy-seed-button')!;
  const status = document.getElementById('share-track-status')!;
  let current: { seed: string; track: Track } | undefined;
  let generation = 0;
  share.addEventListener('click', async () => {
    if (!current) return;
    const selected = current,
      version = generation;
    share.setAttribute('disabled', '');
    status.textContent = 'Preparing…';
    try {
      if (!context?.postId)
        throw new Error('Sharing is unavailable outside Reddit.');
      const payload = await createTrackShare(selected.seed, selected.track);
      if (version !== generation) return;
      await showShareSheet({
        title: 'Race this track',
        text: `Try seed ${selected.seed} in The Daily Lap.`,
        data: JSON.stringify(payload),
      });
      if (version === generation)
        status.textContent = 'No share options? Copy seed.';
    } catch {
      if (version === generation)
        status.textContent = 'Sharing unavailable. Copy seed instead.';
    } finally {
      if (version === generation && current) share.removeAttribute('disabled');
    }
  });
  copy.addEventListener('click', async () => {
    if (!current) return;
    const selected = current,
      version = generation;
    try {
      await navigator.clipboard.writeText(selected.seed);
      if (version === generation)
        status.textContent = `Copied: ${selected.seed}`;
    } catch {
      if (version === generation)
        status.textContent = `Copy manually: ${selected.seed}`;
    }
  });
  return {
    clear() {
      generation++;
      current = undefined;
      share.hidden = copy.hidden = true;
      status.textContent = '';
    },
    set(seed: string, track: Track) {
      generation++;
      current = { seed, track };
      share.hidden = copy.hidden = false;
      share.removeAttribute('disabled');
      status.textContent = '';
    },
  };
}
