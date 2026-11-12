/** Platform-independent preview state; authoritative fixed-step rules follow in #3. */
export type PreviewState = { distance: number; speed: number };

export const createPreviewState = (): PreviewState => ({
  distance: 0,
  speed: 0,
});
