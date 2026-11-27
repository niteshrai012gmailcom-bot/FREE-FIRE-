import type {GameRules} from './types.ts';

export const STORAGE_RECORDS_KEY = 'raja_ai_predictor_records_v1';
export const STORAGE_RULES_KEY = 'raja_ai_predictor_rules_v1';

export const DEFAULT_GAME_RULES: GameRules = {
  minNumber: 0,
  maxNumber: 9,
  bigThreshold: 5,
  minSampleWarning: 10,
};

export const THEME_COLORS = {
  bgDeep: '#050811',
  bgNavy: '#0b1224',
  bgCard: '#0e172e',
  bgPanel: 'rgba(15, 25, 48, 0.88)',
  bgPanelSoft: 'rgba(20, 34, 66, 0.72)',
  borderSubtle: 'rgba(59, 130, 246, 0.28)',
  accentGreen: '#10b981',
  accentGreenBright: '#34d399',
  accentBlue: '#3b82f6',
  accentBlueBright: '#60a5fa',
  accentCyan: '#22d3ee',
  accentAmber: '#f59e0b',
  accentRed: '#f43f5e',
  textPrimary: '#f8fafc',
  textSecondary: '#cbd5e1',
  textMuted: '#94a3b8',
} as const;

export const RANDOMNESS_DISCLAIMER =
  'Statistical notice: Random game outcomes are independent events and cannot reliably be predicted from historical records. All metrics shown are descriptive statistics only—never guaranteed results or income.';
