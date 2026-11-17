/** Brief, non-interactive reminder on the actual course, for every new attempt. */
export function initializeDrivingHint() {
  const hint = document.getElementById('driving-hint')!;
  const race = document.getElementById('race')!;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  function hide() {
    clearTimeout(timeout);
    hint.hidden = true;
    race.dataset.drivingHint = 'false';
  }
  hide();
  return {
    hide,
    show() {
      hide();
      hint.hidden = false;
      // Restart the short fade for retries, too.
      hint.style.animation = 'none';
      void hint.offsetWidth;
      hint.style.animation = '';
      race.dataset.drivingHint = 'true';
      timeout = setTimeout(hide, 5000);
    },
  };
}
