export const nowMs = (): number => Date.now();
export const nowIso = (): string => new Date().toISOString();
export const isoFromMs = (ms: number): string => new Date(ms).toISOString();
export const addSeconds = (ms: number, s: number): number => ms + s * 1000;
