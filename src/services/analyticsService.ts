import {RANDOMNESS_DISCLAIMER} from '../constants.ts';
import type {
  AnalyticsSnapshot,
  GameRecord,
  GameRules,
  HistoryFilter,
  NumberFrequencyItem,
} from '../types.ts';
import {
  sortRecordsChronological,
  sortRecordsDescending,
} from './storageService.ts';

export function classifyBigSmall(
  value: number,
  rules: GameRules
): 'BIG' | 'SMALL' {
  return value >= rules.bigThreshold ? 'BIG' : 'SMALL';
}

export function classifyParity(value: number): 'ODD' | 'EVEN' {
  return Math.abs(value) % 2 === 1 ? 'ODD' : 'EVEN';
}

export function computeAnalytics(
  records: GameRecord[],
  rules: GameRules
): AnalyticsSnapshot {
  const validRecords = records.filter(
    (r) => r.result >= rules.minNumber && r.result <= rules.maxNumber
  );
  const totalRecords = validRecords.length;
  const uniqueFiles = new Set(
    records.map((r) => r.sourceFile).filter((f) => Boolean(f))
  ).size;

  const chrono = [...validRecords].sort(sortRecordsChronological);
  const descending = [...validRecords].sort(sortRecordsDescending);

  let bigCount = 0;
  let smallCount = 0;
  let oddCount = 0;
  let evenCount = 0;

  const countsByValue = new Map<number, number>();
  for (let n = rules.minNumber; n <= rules.maxNumber; n++) {
    countsByValue.set(n, 0);
  }

  let longestBig = 0;
  let longestSmall = 0;
  let runningType: 'BIG' | 'SMALL' | 'NONE' = 'NONE';
  let runningLen = 0;
  let alternations = 0;
  const sequenceTokens: string[] = [];

  for (const record of chrono) {
    const category = classifyBigSmall(record.result, rules);
    const parity = classifyParity(record.result);

    if (category === 'BIG') bigCount++;
    else smallCount++;

    if (parity === 'ODD') oddCount++;
    else evenCount++;

    countsByValue.set(
      record.result,
      (countsByValue.get(record.result) ?? 0) + 1
    );

    if (runningType === category) {
      runningLen++;
    } else {
      if (runningType !== 'NONE') alternations++;
      runningType = category;
      runningLen = 1;
    }

    if (category === 'BIG' && runningLen > longestBig) longestBig = runningLen;
    if (category === 'SMALL' && runningLen > longestSmall)
      longestSmall = runningLen;

    sequenceTokens.push(category === 'BIG' ? 'B' : 'S');
  }

  const bigPct = totalRecords > 0 ? (bigCount / totalRecords) * 100 : 0;
  const smallPct = totalRecords > 0 ? (smallCount / totalRecords) * 100 : 0;
  const oddPct = totalRecords > 0 ? (oddCount / totalRecords) * 100 : 0;
  const evenPct = totalRecords > 0 ? (evenCount / totalRecords) * 100 : 0;

  const frequencies: NumberFrequencyItem[] = [];
  for (let n = rules.minNumber; n <= rules.maxNumber; n++) {
    const count = countsByValue.get(n) ?? 0;
    frequencies.push({
      value: n,
      count,
      percentage: totalRecords > 0 ? (count / totalRecords) * 100 : 0,
      category: classifyBigSmall(n, rules),
      parity: classifyParity(n),
    });
  }

  let mostFrequent: NumberFrequencyItem[] = [];
  let leastFrequent: NumberFrequencyItem[] = [];
  if (totalRecords > 0 && frequencies.length > 0) {
    const maxCount = Math.max(...frequencies.map((f) => f.count));
    const minCount = Math.min(...frequencies.map((f) => f.count));
    mostFrequent = frequencies.filter((f) => f.count === maxCount);
    leastFrequent = frequencies.filter((f) => f.count === minCount);
  }

  const alternationRate =
    chrono.length > 1 ? alternations / (chrono.length - 1) : 0;
  const recentPattern =
    sequenceTokens.length > 0 ? sequenceTokens.slice(-14).join(' ') : 'No data';

  const insufficientData = totalRecords < rules.minSampleWarning;

  const rangeSpan = rules.maxNumber - rules.minNumber + 1;
  const theoreticalBigCount = Math.max(
    0,
    rules.maxNumber - rules.bigThreshold + 1
  );
  const theoreticalBigPct =
    rangeSpan > 0 ? (theoreticalBigCount / rangeSpan) * 100 : 50;
  const theoreticalSmallPct = 100 - theoreticalBigPct;

  let estimateSummary: string;
  let statisticalNote: string;

  if (totalRecords === 0) {
    estimateSummary =
      'No imported PDF or manual records yet. Upload PDF files to calculate empirical statistics.';
    statisticalNote = `Insufficient data (0 / ${rules.minSampleWarning} minimum recommended records). ${RANDOMNESS_DISCLAIMER}`;
  } else if (insufficientData) {
    estimateSummary = `Observed share: Big ${bigPct.toFixed(1)}% vs Small ${smallPct.toFixed(1)}% (Theoretical baseline: ${theoreticalBigPct.toFixed(1)}% / ${theoreticalSmallPct.toFixed(1)}%). Sample too small for reliable variance reading.`;
    statisticalNote = `Insufficient data warning: Only ${totalRecords} of ${rules.minSampleWarning} minimum records loaded. Small samples show high random noise. ${RANDOMNESS_DISCLAIMER}`;
  } else {
    const diff = Math.abs(bigPct - theoreticalBigPct);
    const balanceLabel =
      diff <= 4
        ? 'closely aligned with uniform expectation'
        : bigPct > theoreticalBigPct
          ? `empirically leaning Big by +${(bigPct - theoreticalBigPct).toFixed(1)}%`
          : `empirically leaning Small by +${(smallPct - theoreticalSmallPct).toFixed(1)}%`;
    estimateSummary = `Empirical share: Big ${bigPct.toFixed(1)}% / Small ${smallPct.toFixed(1)}% (${balanceLabel}; baseline ${theoreticalBigPct.toFixed(1)}% / ${theoreticalSmallPct.toFixed(1)}%). Not a prediction of future draws.`;
    statisticalNote = RANDOMNESS_DISCLAIMER;
  }

  return {
    totalRecords,
    uniqueFiles,
    bigCount,
    smallCount,
    bigPct,
    smallPct,
    oddCount,
    evenCount,
    oddPct,
    evenPct,
    frequencies,
    mostFrequent,
    leastFrequent,
    streaks: {
      currentType: runningType,
      currentLength: runningLen,
      longestBig,
      longestSmall,
      alternationRate,
    },
    recentPattern,
    latestRecords: descending.slice(0, 8),
    insufficientData,
    statisticalNote,
    estimateSummary,
  };
}

export function filterHistoryRecords(
  records: GameRecord[],
  filter: HistoryFilter,
  rules: GameRules
): GameRecord[] {
  const query = filter.query.trim().toLowerCase();
  return records.filter((record) => {
    if (filter.category !== 'ALL') {
      const cat = classifyBigSmall(record.result, rules);
      if (cat !== filter.category) return false;
    }
    if (filter.numberFilter !== 'ALL' && record.result !== filter.numberFilter) {
      return false;
    }
    if (query) {
      const haystack =
        `${record.date} ${record.round} ${record.result} ${record.sourceFile}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}
