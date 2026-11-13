import { WebGLRenderer } from 'three';

// One context/renderer per iframe canvas. Recreating WebGLState on every track
// leaves its four internal fallback textures alive in the reused GL context.
const renderers = new WeakMap<HTMLCanvasElement, WebGLRenderer>();
export function getGameRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  const existing = renderers.get(canvas);
  if (existing) return existing;
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderers.set(canvas, renderer);
  const pagehide = (event: PageTransitionEvent): void => {
    if (event.persisted) return;
    renderer.dispose();
    renderers.delete(canvas);
    window.removeEventListener('pagehide', pagehide);
  };
  window.addEventListener('pagehide', pagehide);
  return renderer;
}
export function releaseGameScene(renderer: WebGLRenderer): void {
  renderer.renderLists.dispose();
  renderer.resetState();
}
