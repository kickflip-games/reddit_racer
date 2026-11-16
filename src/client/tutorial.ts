/** An isolated input rehearsal: never starts, resets or submits a race. */
export function initializeTutorial(): void {
  const dialogElement = document.getElementById('tutorial-dialog');
  const openElement = document.getElementById('tutorial-open');
  const padElement = document.getElementById('tutorial-pad');
  const closeElement = document.getElementById('tutorial-close');
  const replayElement = document.getElementById('tutorial-replay');
  const progressElement = document.getElementById('tutorial-progress');
  if (
    !(dialogElement instanceof HTMLDialogElement) ||
    !(openElement instanceof HTMLButtonElement) ||
    !(padElement instanceof HTMLButtonElement) ||
    !(closeElement instanceof HTMLButtonElement) ||
    !(replayElement instanceof HTMLButtonElement) ||
    !progressElement
  )
    throw new Error('Missing tutorial controls');

  const dialog = dialogElement;
  const open = openElement;
  const pad = padElement;
  const close = closeElement;
  const replay = replayElement;
  const progress = progressElement;

  const key = 'reddit-racer:controls-learned:v1';
  try {
    if (localStorage.getItem(key) === 'yes') open.textContent = 'How to play';
  } catch {
    // Learning the controls still works when storage is unavailable.
  }
  let phase: 'hold' | 'release' | 'done' = 'hold';
  let pointer: number | undefined;
  let keyboard = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const held = (): boolean => pointer !== undefined || keyboard;

  function cancelHold(): void {
    clearTimeout(timer);
    timer = undefined;
    const previous = pointer;
    pointer = undefined;
    keyboard = false;
    if (previous !== undefined && pad.hasPointerCapture(previous))
      pad.releasePointerCapture(previous);
  }
  function reset(): void {
    cancelHold();
    phase = 'hold';
    dialog.dataset.step = phase;
    progress.textContent = '1 / 2 · Press and hold to accelerate.';
    pad.textContent = 'Hold here or hold Space';
    pad.disabled = false;
    replay.hidden = true;
    close.textContent = 'Skip for now';
  }
  function accelerate(): void {
    if (phase !== 'hold' || timer !== undefined) return;
    pad.textContent = 'Accelerating… keep holding';
    dialog.dataset.step = 'accelerating';
    timer = setTimeout(() => {
      timer = undefined;
      if (!dialog.open || !held()) return;
      phase = 'release';
      dialog.dataset.step = phase;
      progress.textContent = '2 / 2 · Now release to brake.';
      pad.textContent = 'Release to brake';
    }, 600);
  }
  function brake(): void {
    if (held()) return;
    if (phase !== 'release') {
      if (phase === 'hold') reset();
      return;
    }
    phase = 'done';
    dialog.dataset.step = phase;
    progress.textContent =
      'Ready! Release early for corners, then hold again on the way out.';
    pad.textContent = 'Braking ✓';
    // Keep focus on the pad, so a held key cannot activate a different control.
    replay.hidden = false;
    close.textContent = 'Back to race';
    open.textContent = 'How to play';
    try {
      localStorage.setItem(key, 'yes');
    } catch {
      // Completion does not depend on persistent storage.
    }
  }
  open.addEventListener('click', () => {
    reset();
    dialog.showModal();
    pad.focus();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    reset();
    open.focus({ preventScroll: true });
  });
  replay.addEventListener('click', () => {
    reset();
    pad.focus();
  });
  pad.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || pointer !== undefined || phase === 'done') return;
    event.preventDefault();
    pad.focus();
    pointer = event.pointerId;
    pad.setPointerCapture(pointer);
    accelerate();
  });
  pad.addEventListener('pointerup', (event) => {
    if (event.pointerId !== pointer) return;
    const previous = pointer;
    pointer = undefined;
    if (pad.hasPointerCapture(previous)) pad.releasePointerCapture(previous);
    brake();
  });
  // An interrupted gesture isn't successful braking. Start the exercise again.
  for (const type of ['pointercancel', 'lostpointercapture']) {
    pad.addEventListener(type, () => {
      if (pointer !== undefined) reset();
    });
  }
  pad.addEventListener('contextmenu', (event) => event.preventDefault());
  pad.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' && event.code !== 'Enter') return;
    event.preventDefault();
    if (phase === 'done' || event.repeat) return;
    keyboard = true;
    accelerate();
  });
  pad.addEventListener('keyup', (event) => {
    if (event.code !== 'Space' && event.code !== 'Enter') return;
    event.preventDefault();
    keyboard = false;
    brake();
  });
  pad.addEventListener('blur', () => {
    if (dialog.open && held()) reset();
  });
  window.addEventListener('blur', () => {
    if (dialog.open && phase !== 'done') reset();
  });
  document.addEventListener('visibilitychange', () => {
    if (dialog.open && document.hidden && phase !== 'done') reset();
  });
}
