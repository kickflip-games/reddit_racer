export type RenderViewport = {
  /** Normalized CSS dimensions; camera and input coordinates remain in CSS pixels. */
  width: number;
  height: number;
  pixelRatio: number;
  drawable: boolean;
  backingWidth: number;
  backingHeight: number;
};
export type ResolutionQuery = {
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
};
export type ResolutionObserverPorts = {
  readDevicePixelRatio(): number;
  matchMedia(query: string): ResolutionQuery | null;
};
export type ResolutionObserver = {
  /** Resynchronize/rearm without notifying, including when called by a resize handler. */
  refresh(): void;
  dispose(): void;
};

function rawRatio(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/** Allocation-free ratio check for browsers that omit native resolution events. */
export function resolveRenderPixelRatio(dpr: number): number {
  return Math.min(rawRatio(dpr), 2);
}

function dimension(value: number): number {
  return Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER
    ? value
    : 0;
}

/** The existing DPR cap, with finite backing dimensions and no fake 1px canvas. */
export function resolveRenderViewport(
  width: number,
  height: number,
  dpr: number
): RenderViewport {
  const cssWidth = dimension(width);
  const cssHeight = dimension(height);
  const pixelRatio = resolveRenderPixelRatio(dpr);
  const backingWidth = Math.floor(cssWidth * pixelRatio);
  const backingHeight = Math.floor(cssHeight * pixelRatio);
  const drawable =
    backingWidth > 0 &&
    backingHeight > 0 &&
    Number.isSafeInteger(backingWidth) &&
    Number.isSafeInteger(backingHeight);
  return {
    width: cssWidth,
    height: cssHeight,
    pixelRatio,
    drawable,
    backingWidth: drawable ? backingWidth : 0,
    backingHeight: drawable ? backingHeight : 0,
  };
}

const browserPorts: ResolutionObserverPorts = {
  readDevicePixelRatio: () =>
    typeof window === 'undefined' ? 1 : window.devicePixelRatio,
  matchMedia: (query) =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? null
      : window.matchMedia(query),
};

/** One raw-resolution listener, independent of motion preferences and racing. */
export function createResolutionObserver(
  onChange: () => void,
  ports: ResolutionObserverPorts = browserPorts
): ResolutionObserver {
  let disposed = false;
  let pixelRatio = 1;
  let watchedRaw: number | undefined;
  let detach: (() => void) | undefined;
  let revision = 0;

  function arm(raw: number): void {
    if (watchedRaw === raw && detach) return;
    const removePrevious = detach;
    detach = undefined;
    watchedRaw = undefined;
    const currentRevision = ++revision;
    removePrevious?.();
    let query: ResolutionQuery | null;
    try {
      query = ports.matchMedia(`(resolution: ${raw}dppx)`);
    } catch {
      // Explicit resize/focus refreshes still work if media queries are unavailable.
      return;
    }
    if (!query) return;
    const changed = (): void => {
      if (disposed || revision !== currentRevision) return;
      const previousRatio = pixelRatio;
      refresh();
      // State and listener are already current before root's resize callback runs.
      if (!disposed && pixelRatio !== previousRatio) onChange();
    };
    watchedRaw = raw;
    const activeQuery = query;
    detach = () => activeQuery.removeEventListener('change', changed);
    activeQuery.addEventListener('change', changed);
  }

  function refresh(): void {
    if (disposed) return;
    let raw = 1;
    try {
      raw = rawRatio(ports.readDevicePixelRatio());
    } catch {
      // The renderer can continue at ratio 1 if the capability read fails.
    }
    pixelRatio = resolveRenderPixelRatio(raw);
    // Always watch the raw value: 3 -> 4 both cap to 2, but 4 -> 1.5 must fire.
    arm(raw);
  }

  refresh(); // Initial subscription only; no callback during construction.
  return {
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      revision++;
      detach?.();
      detach = undefined;
      watchedRaw = undefined;
    },
  };
}
