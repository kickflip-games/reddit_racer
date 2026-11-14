import { expect, test } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready.ts';

for (const entry of ['/game.html', '/game.html?practice=1&seed=practice-1']) {
  for (const muted of [false, true]) {
    test(`production start ${entry} schedules countdown tones (saved mute ${muted})`, async ({
      page,
    }, info) => {
      await page.clock.install();
      await page.addInitScript((muted) => {
        localStorage.setItem(
          'reddit-racer:feedback-preferences:v1',
          JSON.stringify({ schemaVersion: 1, muted, motion: 'system' })
        );
        // Observe the real result oscillator; do not substitute the audio backend.
        const create = AudioContext.prototype.createOscillator;
        let count = 0;
        AudioContext.prototype.createOscillator = function () {
          const oscillator = create.call(this);
          count++;
          if (count === 3) {
            const set = oscillator.frequency.setValueAtTime.bind(
              oscillator.frequency
            );
            oscillator.frequency.setValueAtTime = (value, time) => {
              document.documentElement.dataset.tones = `${document.documentElement.dataset.tones ?? ''}${value},`;
              return set(value, time);
            };
          }
          return oscillator;
        };
      }, muted);
      await page.goto(entry);
      await waitForSceneAssets(page);
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
      if (info.project.name === 'mobile-chromium')
        await page.locator('#start-button').tap();
      else await page.locator('#start-button').click();
      await expect(page.locator('#race')).toHaveAttribute(
        'data-audio-state',
        muted ? 'muted' : 'running'
      );
      await page.clock.runFor(3300);
      await expect(page.locator('#race')).toHaveAttribute(
        'data-phase',
        'racing',
        { timeout: 15000 }
      );
      await expect(page.locator('#race')).toHaveAttribute(
        'data-audio-state',
        muted ? 'muted' : 'running'
      );
      expect(await page.locator('html').getAttribute('data-tones')).toBe(
        muted ? null : '440,440,440,880,'
      );
    });
  }
}
