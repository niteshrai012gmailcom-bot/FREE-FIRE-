import {
  DEFAULT_GAME_RULES,
  STORAGE_RECORDS_KEY,
  STORAGE_RULES_KEY,
} from '../constants.ts';
import type {GameRecord, GameRules} from '../types.ts';

export function buildRecordKey(date: string, round: string): string {
  return `${date.trim().toLowerCase()}::${round.trim().toLowerCase()}`;
}

export function generateRecordId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `rec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function loadRecords(): GameRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_RECORDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is GameRecord =>
          typeof item === 'object' &&
          item !== null &&
          typeof item.id === 'string' &&
          typeof item.date === 'string' &&
          typeof item.round === 'string' &&
          typeof item.result === 'number' &&
          Number.isFinite(item.result)
      )
      .sort(sortRecordsDescending);
  } catch (error) {
    console.warn('Could not load saved records:', error);
    return [];
  }
}

export function saveRecords(records: GameRecord[]): void {
  try {
    const sorted = [...records].sort(sortRecordsDescending);
    localStorage.setItem(STORAGE_RECORDS_KEY, JSON.stringify(sorted));
  } catch (error) {
    console.error('Failed to persist records:', error);
  }
}

export function sortRecordsDescending(a: GameRecord, b: GameRecord): number {
  const dateCmp = b.date.localeCompare(a.date);
  if (dateCmp !== 0) return dateCmp;
  const roundCmp = b.round.localeCompare(a.round, undefined, {numeric: true});
  if (roundCmp !== 0) return roundCmp;
  return b.importedAt - a.importedAt;
}

export function sortRecordsChronological(a: GameRecord, b: GameRecord): number {
  return -sortRecordsDescending(a, b);
}

export function addRecordsWithDedupe(
  existing: GameRecord[],
  incoming: Omit<GameRecord, 'id' | 'importedAt'>[]
): {records: GameRecord[]; added: number; duplicatesSkipped: number} {
  const seen = new Set(existing.map((r) => buildRecordKey(r.date, r.round)));
  const now = Date.now();
  const next = [...existing];
  let added = 0;
  let duplicatesSkipped = 0;

  incoming.forEach((item, idx) => {
    const key = buildRecordKey(item.date, item.round);
    if (seen.has(key)) {
      duplicatesSkipped++;
      return;
    }
    seen.add(key);
    next.push({
      ...item,
      id: generateRecordId(),
      importedAt: now + idx,
    });
    added++;
  });

  next.sort(sortRecordsDescending);
  saveRecords(next);
  return {records: next, added, duplicatesSkipped};
}

export function updateRecordInStore(
  existing: GameRecord[],
  updated: GameRecord
): GameRecord[] {
  const next = existing
    .map((r) => (r.id === updated.id ? updated : r))
    .sort(sortRecordsDescending);
  saveRecords(next);
  return next;
}

export function deleteRecordFromStore(
  existing: GameRecord[],
  recordId: string
): GameRecord[] {
  const next = existing.filter((r) => r.id !== recordId);
  saveRecords(next);
  return next;
}

export function clearAllRecordsFromStore(): GameRecord[] {
  saveRecords([]);
  return [];
}

export function loadRules(): GameRules {
  try {
    const raw = localStorage.getItem(STORAGE_RULES_KEY);
    if (!raw) return {...DEFAULT_GAME_RULES};
    const parsed = JSON.parse(raw);
    const minNumber = Number.isInteger(parsed.minNumber)
      ? parsed.minNumber
      : DEFAULT_GAME_RULES.minNumber;
    const maxNumber =
      Number.isInteger(parsed.maxNumber) && parsed.maxNumber > minNumber
        ? parsed.maxNumber
        : Math.max(minNumber + 1, DEFAULT_GAME_RULES.maxNumber);
    const bigThreshold =
      Number.isInteger(parsed.bigThreshold) &&
      parsed.bigThreshold > minNumber &&
      parsed.bigThreshold <= maxNumber
        ? parsed.bigThreshold
        : Math.ceil((minNumber + maxNumber) / 2);
    const minSampleWarning =
      Number.isInteger(parsed.minSampleWarning) && parsed.minSampleWarning >= 3
        ? parsed.minSampleWarning
        : DEFAULT_GAME_RULES.minSampleWarning;
    return {minNumber, maxNumber, bigThreshold, minSampleWarning};
  } catch {
    return {...DEFAULT_GAME_RULES};
  }
}

export function saveRules(rules: GameRules): void {
  try {
    localStorage.setItem(STORAGE_RULES_KEY, JSON.stringify(rules));
  } catch (error) {
    console.error('Failed to persist rules:', error);
  }
}
