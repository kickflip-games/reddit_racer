/** Coaching follows real simulation speed, never a timer or pretend car. */
export type TutorialSample = {
  held: boolean;
  speed: number;
  racing: boolean;
  interrupted: boolean;
};
export function initializeTutorial(onOpen: () => void, onClose: () => void) {
  const overlay = document.getElementById('tutorial-overlay')!;
  const progress = document.getElementById('tutorial-progress')!;
  const hint = document.getElementById('tutorial-hint')!;
  const finish = document.getElementById('tutorial-finish')!;
  const resume = document.getElementById('tutorial-resume')!;
  resume.addEventListener('click', () => {
    step = 0;
    render();
    document.getElementById('retry-button')!.click();
    document.getElementById('race-canvas')!.focus();
  });
  let active = false;
  let step = 0;
  const prompts = [
    'Hold to accelerate',
    'Release to brake',
    'Hold again to drive on',
    'You’ve got it',
  ];
  const hints = [
    'Touch the course or hold Space',
    'Watch the car slow down',
    'The car steers for you',
    'Release early for corners. Keep practising or return to the race.',
  ];
  function render() {
    overlay.dataset.step = String(step);
    progress.textContent = prompts[step]!;
    hint.textContent = hints[step]!;
    finish.hidden = step !== 3;
  }
  function close() {
    if (!active) return;
    active = false;
    overlay.hidden = true;
    onClose();
  }
  document.getElementById('tutorial-open')!.addEventListener('click', () => {
    if (active) return;
    active = true;
    step = 0;
    render();
    overlay.hidden = false;
    onOpen();
  });
  document.getElementById('tutorial-close')!.addEventListener('click', close);
  finish.addEventListener('click', close);
  window.addEventListener('keydown', (event) => {
    if (active && event.code === 'Escape') close();
  });
  return {
    reset() {
      step = 0;
      render();
    },
    sample(sample: TutorialSample) {
      if (!active) return;
      resume.hidden = !sample.interrupted;
      if (!sample.racing) return;
      if (
        (step === 0 && sample.held && sample.speed >= 8) ||
        (step === 1 && !sample.held && sample.speed <= 4) ||
        (step === 2 && sample.held && sample.speed >= 8)
      ) {
        step++;
        render();
        if (step === 3) {
          try {
            localStorage.setItem('reddit-racer:controls-learned:v2', 'yes');
          } catch {
            /* Optional persistence. */
          }
        }
      }
    },
  };
}
