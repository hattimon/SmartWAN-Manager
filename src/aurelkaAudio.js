export const AURELKA_MEOW_DECISIVE = 'aurelka-meow-decisive.mp3';
export const AURELKA_MEOW_GENTLE = 'aurelka-meow-gentle.mp3';
export const AURELKA_MEOW_FILES = Object.freeze([
  AURELKA_MEOW_DECISIVE,
  AURELKA_MEOW_GENTLE,
]);

export function selectAurelkaMeowFile(failedWanCount, randomValue = Math.random()) {
  const failures = Number.isFinite(Number(failedWanCount))
    ? Math.max(0, Math.trunc(Number(failedWanCount)))
    : 0;

  if (failures >= 2) return AURELKA_MEOW_DECISIVE;
  if (failures === 1) {
    return Number(randomValue) < 0.5
      ? AURELKA_MEOW_DECISIVE
      : AURELKA_MEOW_GENTLE;
  }
  return AURELKA_MEOW_GENTLE;
}
