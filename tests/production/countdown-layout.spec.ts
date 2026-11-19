import { expect, test } from '@playwright/test';

for (const { width, hostWidth } of [
  { width: 280, hostWidth: 280 },
  { width: 320, hostWidth: 320 },
  { width: 360, hostWidth: 360 },
  { width: 960, hostWidth: 960 },
  { width: 360, hostWidth: 960 },
]) {
  test(`real launch glyphs fit their box at ${width}px inside a ${hostWidth}px host`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: hostWidth, height: 720 });
    await page.clock.install();
    await page.route('**/api/trpc/**', (route) =>
      route.fulfill({
        status: 503,
        json: { error: 'standalone production layout test' },
      })
    );
    await page.goto('/game.html?practice=1&word=banana');
    await expect(page.locator('#race')).toHaveAttribute(
      'data-car-load',
      'ready'
    );
    if (width !== hostWidth) {
      // Reproduce an embedded game narrower than its host, without changing the overlay.
      await page.addStyleTag({ content: `#race { width: ${width}px; }` });
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    }
    if (width < 320) {
      // The game deliberately requires 320px. Do not bypass that player-facing gate.
      await expect(page.locator('#race')).toHaveAttribute(
        'data-viewport-usable',
        'false'
      );
      await expect(page.locator('#viewport-message')).toBeVisible();
      await page.screenshot({ path: info.outputPath('unsupported-280px.png') });
      return;
    }
    await expect(page.locator('#start-button')).toBeEnabled();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.locator('#start-button').click();
    const countdown = page.locator('#race-countdown');
    await expect(countdown).toHaveText('3');
    const numeral = await countdown.evaluate((el) => ({
      fontSize: getComputedStyle(el).fontSize,
      width: el.getBoundingClientRect().width,
    }));
    expect(numeral).toEqual({ fontSize: '76px', width: 110 });
    await page.clock.runFor(3100);
    await expect(countdown).toHaveText('GO!');
    const frames = await countdown.evaluate((el) => {
      const animations = el.getAnimations();
      for (const animation of animations) animation.pause();
      const points = animations.length
        ? Array.from({ length: 41 }, (_, i) => i / 40)
        : [0];
      return points.map((progress) => {
        for (const animation of animations) {
          const duration = animation.effect?.getComputedTiming().activeDuration;
          if (typeof duration === 'number' && Number.isFinite(duration))
            animation.currentTime = Math.max(0, duration * progress - 0.001);
        }
        const style = getComputedStyle(el),
          box = el.getBoundingClientRect(),
          root = document.getElementById('race')!.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        const context = document.createElement('canvas').getContext('2d')!;
        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        context.letterSpacing =
          style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
        const metrics = context.measureText(el.textContent ?? '');
        const scaleX = box.width / el.clientWidth;
        const scaleY =
          text.height /
          (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent);
        const stroke = parseFloat(style.webkitTextStrokeWidth) || 0;
        let leftShadow = 0,
          rightShadow = 0,
          topShadow = 0,
          bottomShadow = 0;
        if (style.textShadow !== 'none') {
          for (const shadow of style.textShadow
            .replace(/rgba?\([^)]*\)/g, '')
            .split(',')) {
            const values = [...shadow.matchAll(/(-?[\d.]+)px/g)].map((value) =>
              Number(value[1])
            );
            const [x = 0, y = 0, blur = 0] = values;
            leftShadow = Math.max(leftShadow, blur - x);
            rightShadow = Math.max(rightShadow, blur + x);
            topShadow = Math.max(topShadow, blur - y);
            bottomShadow = Math.max(bottomShadow, blur + y);
          }
        }
        const baseline = text.top + metrics.fontBoundingBoxAscent * scaleY;
        const ink = {
          left:
            text.left -
            (metrics.actualBoundingBoxLeft + stroke / 2 + leftShadow) * scaleX,
          right:
            text.left +
            (metrics.actualBoundingBoxRight + stroke / 2 + rightShadow) *
              scaleX,
          top:
            baseline -
            (metrics.actualBoundingBoxAscent + stroke / 2 + topShadow) * scaleY,
          bottom:
            baseline +
            (metrics.actualBoundingBoxDescent + stroke / 2 + bottomShadow) *
              scaleY,
        };
        return {
          progress,
          box: {
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
            width: box.width,
          },
          root: { left: root.left, right: root.right, width: root.width },
          ink,
          scaleX,
          fontSize: style.fontSize,
          fontFamily: style.fontFamily,
          letterSpacing: style.letterSpacing,
          textStroke: style.webkitTextStrokeWidth,
          textShadow: style.textShadow,
          animation: style.animationName,
          textAdvance: metrics.width,
          contentWidth:
            el.clientWidth -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight),
        };
      });
    });
    await info.attach('actual-glyph-layout', {
      body: JSON.stringify({ width, hostWidth, numeral, frames }, null, 2),
      contentType: 'application/json',
    });
    await page.screenshot({ path: info.outputPath('actual-go-overlay.png') });
    for (const frame of frames) {
      expect(
        frame.ink.left,
        'GO ink needs left breathing room inside its own box'
      ).toBeGreaterThanOrEqual(frame.box.left + 8);
      expect(
        frame.ink.right,
        'GO ink needs right breathing room inside its own box'
      ).toBeLessThanOrEqual(frame.box.right - 8);
      expect(frame.ink.top).toBeGreaterThanOrEqual(frame.box.top + 8);
      expect(frame.ink.bottom).toBeLessThanOrEqual(frame.box.bottom - 8);
      expect(
        Math.abs(
          (frame.ink.left +
            frame.ink.right -
            frame.box.left -
            frame.box.right) /
            2
        )
      ).toBeLessThan(4);
      expect(
        Math.abs(
          (frame.box.left +
            frame.box.right -
            frame.root.left -
            frame.root.right) /
            2
        )
      ).toBeLessThan(1);
      expect(frame.box.left).toBeGreaterThanOrEqual(frame.root.left + 12);
      expect(frame.box.right).toBeLessThanOrEqual(frame.root.right - 12);
    }
  });
}
