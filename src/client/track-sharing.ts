import { context, showShareSheet } from '@devvit/web/client';
import { createTrackShare } from '../shared/track-share';
import type { Track } from '../shared/track';

export function initializeTrackSharing() {
  const share = document.getElementById('share-track-button')!;
  const copy = document.getElementById('copy-seed-button')!;
  const status = document.getElementById('share-track-status')!;
  const seedLabel = document.getElementById('share-track-seed')!;
  const help = document.getElementById('share-track-help')!;
  let current: { seed: string; track: Track } | undefined;
  let generation = 0;
  share.addEventListener('click', async () => {
    if (!current) return;
    const selected = current,
      version = generation;
    share.setAttribute('disabled', '');
    status.textContent = 'Preparing track share…';
    try {
      if (!context?.postId)
        throw new Error('Sharing is unavailable outside Reddit.');
      const payload = await createTrackShare(selected.seed, selected.track);
      if (version !== generation) return;
      await showShareSheet({
        title: 'Race this track',
        text: `Try seed ${selected.seed} in Reddit Racer.`,
        data: JSON.stringify(payload),
      });
      if (version === generation)
        status.textContent =
          'Reddit sharing requested. If no share options appeared, use Copy seed.';
    } catch {
      if (version === generation)
        status.textContent =
          'Sharing is unavailable here. Use Copy seed, then send it to a friend to load in this game version.';
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
        status.textContent = `Seed copied: ${selected.seed}. Paste it into Choose a seed in this game version.`;
    } catch {
      if (version === generation)
        status.textContent = `Copy this seed manually: ${selected.seed}`;
    }
  });
  return {
    clear() {
      generation++;
      current = undefined;
      share.hidden = copy.hidden = seedLabel.hidden = help.hidden = true;
      seedLabel.textContent = '';
      status.textContent = '';
    },
    set(seed: string, track: Track) {
      generation++;
      current = { seed, track };
      share.hidden = copy.hidden = seedLabel.hidden = help.hidden = false;
      seedLabel.textContent = `Current seed: ${seed}`;
      share.removeAttribute('disabled');
      status.textContent = '';
    },
  };
}
