export function drivingHintText(practice: boolean, touch: boolean): string {
  const controls =
    'Automatic steering · Hold to go · Release before tight turns';
  return practice
    ? `${controls}\nPractice drift: ${touch ? 'two fingers' : 'hold Shift'}`
    : controls;
}

/** Brief, non-interactive reminder on the actual course, for every new attempt. */
export function initializeDrivingHint() {
  const hint = document.getElementById('driving-hint')!;
  const race = document.getElementById('race')!;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  function hide() {
    clearTimeout(timeout);
    hint.hidden = true;
    race.dataset.drivingHint = 'false';
    started = false;
    hint.dataset.moving = 'false';
  }
  hide();
  return {
    hide,
    show(practice: boolean, touch: boolean) {
      hide();
      hint.textContent = drivingHintText(practice, touch);
      hint.hidden = false;
      race.dataset.drivingHint = 'true';
    },
    beginDriving() {
      if (started || hint.hidden) return;
      started = true;
      // Give the player five seconds of actual driving, not two after countdown.
      hint.dataset.moving = 'true';
      timeout = setTimeout(hide, 5000);
    },
  };
}
