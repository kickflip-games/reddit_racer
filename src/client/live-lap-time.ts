import { SIMULATION_HZ } from '../shared/simulation';

/** Display completed tenths only; authoritative race ticks retain full precision. */
export function formatLiveLapTime(ticks: number): string {
  const tenths = Math.floor(ticks / (SIMULATION_HZ / 10));
  const seconds = String(Math.floor(tenths / 10)).padStart(2, '0');
  return `${seconds}.${tenths % 10}`;
}
