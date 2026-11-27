export type AppTab =
  | 'dashboard'
  | 'scanner'
  | 'bigsmall'
  | 'numbers'
  | 'history'
  | 'reports';

export interface GameRecord {
  id: string;
  date: string; // YYYY-MM-DD or normalized date string
  round: string;
  result: number;
  sourceFile: string;
  importedAt: number;
  ocrExtracted?: boolean;
}

export interface GameRules {
  minNumber: number;
  maxNumber: number;
  bigThreshold: number; // result >= bigThreshold => BIG, else SMALL
  minSampleWarning: number;
}

export interface ParsedCandidate {
  tempId: string;
  date: string;
  round: string;
  result: number;
  sourceFile: string;
  isDuplicate: boolean;
  ocrExtracted: boolean;
  rawLine: string;
}

export interface PdfScanProgress {
  fileIndex: number;
  totalFiles: number;
  fileName: string;
  stage: 'reading' | 'ocr' | 'parsing' | 'done';
  detail: string;
}

export interface PdfScanResult {
  filesProcessed: number;
  candidates: ParsedCandidate[];
  ocrPagesUsed: number;
  warnings: string[];
}

export interface NumberFrequencyItem {
  value: number;
  count: number;
  percentage: number;
  category: 'BIG' | 'SMALL';
  parity: 'ODD' | 'EVEN';
}

export interface StreakInfo {
  currentType: 'BIG' | 'SMALL' | 'NONE';
  currentLength: number;
  longestBig: number;
  longestSmall: number;
  alternationRate: number; // 0..1
}

export interface AnalyticsSnapshot {
  totalRecords: number;
  uniqueFiles: number;
  bigCount: number;
  smallCount: number;
  bigPct: number;
  smallPct: number;
  oddCount: number;
  evenCount: number;
  oddPct: number;
  evenPct: number;
  frequencies: NumberFrequencyItem[];
  mostFrequent: NumberFrequencyItem[];
  leastFrequent: NumberFrequencyItem[];
  streaks: StreakInfo;
  recentPattern: string;
  latestRecords: GameRecord[];
  insufficientData: boolean;
  statisticalNote: string;
  estimateSummary: string;
}

export interface HistoryFilter {
  query: string;
  category: 'ALL' | 'BIG' | 'SMALL';
  numberFilter: number | 'ALL';
}
