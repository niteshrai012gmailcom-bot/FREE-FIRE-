import {jsPDF} from 'jspdf';
import {RANDOMNESS_DISCLAIMER} from '../constants.ts';
import type {AnalyticsSnapshot, GameRecord, GameRules} from '../types.ts';
import {classifyBigSmall, classifyParity} from './analyticsService.ts';

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function escapeCsvCell(value: string | number): string {
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportCsvReport(
  records: GameRecord[],
  rules: GameRules
): string {
  const header = ['Date', 'Round', 'Result', 'BigSmall', 'Parity', 'SourceFile'];
  const rows = records.map((r) => [
    escapeCsvCell(r.date),
    escapeCsvCell(r.round),
    escapeCsvCell(r.result),
    escapeCsvCell(classifyBigSmall(r.result, rules)),
    escapeCsvCell(classifyParity(r.result)),
    escapeCsvCell(r.sourceFile),
  ]);
  const csv = [header.join(','), ...rows.map((row) => row.join(','))].join('\n');
  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = `raja-ai-predictor-records-${stamp}.csv`;
  triggerBlobDownload(
    new Blob([csv], {type: 'text/csv;charset=utf-8;'}),
    fileName
  );
  return fileName;
}

export interface SummaryPdfOptions {
  autoDownload?: boolean;
  maxHistoryRows?: number;
}

export interface SummaryPdfResult {
  doc: jsPDF;
  fileName: string;
  blob: Blob;
}

function drawSplitRatioBar(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  leftLabel: string,
  leftPct: number,
  leftColor: [number, number, number],
  rightLabel: string,
  rightColor: [number, number, number]
): void {
  const clampedPct = Math.max(0, Math.min(100, leftPct));
  const leftW = (clampedPct / 100) * width;
  const rightW = width - leftW;

  doc.setFillColor(226, 232, 240);
  doc.roundedRect(x, y, width, height, 2, 2, 'F');

  if (leftW > 0.5) {
    doc.setFillColor(leftColor[0], leftColor[1], leftColor[2]);
    doc.roundedRect(x, y, leftW, height, 2, 2, 'F');
    if (rightW > 0.5 && leftW > 2) {
      doc.rect(x + leftW - 2, y, 2, height, 'F');
    }
  }

  if (rightW > 0.5) {
    doc.setFillColor(rightColor[0], rightColor[1], rightColor[2]);
    doc.roundedRect(x + leftW, y, rightW, height, 2, 2, 'F');
    if (leftW > 0.5 && rightW > 2) {
      doc.rect(x + leftW, y, 2, height, 'F');
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  const textY = y + height * 0.68;
  if (leftW >= 24) {
    doc.text(leftLabel, x + 3, textY);
  }
  if (rightW >= 24) {
    doc.text(rightLabel, x + width - 3, textY, {align: 'right'});
  }
}

function drawFrequencyBarChart(
  doc: jsPDF,
  analytics: AnalyticsSnapshot,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  // Dark-navy chart frame
  doc.setFillColor(10, 18, 38);
  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(0.35);
  doc.roundedRect(x, y, width, height, 3, 3, 'FD');

  // Chart Header & Legend
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(248, 250, 252);
  doc.text('Visual Frequency Count Distribution', x + 5, y + 6.5);

  // Legend badges (top-right)
  const legendY = y + 4.3;
  doc.setFillColor(16, 185, 129);
  doc.rect(x + width - 64, legendY, 3, 3, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(203, 213, 225);
  doc.text('Big', x + width - 59.5, legendY + 2.5);

  doc.setFillColor(59, 130, 246);
  doc.rect(x + width - 48, legendY, 3, 3, 'F');
  doc.text('Small', x + width - 43.5, legendY + 2.5);

  doc.setDrawColor(250, 204, 21);
  doc.setLineWidth(0.5);
  doc.rect(x + width - 29, legendY, 3, 3, 'S');
  doc.text('Most Freq.', x + width - 24.5, legendY + 2.5);

  const freqs = analytics.frequencies;
  if (freqs.length === 0) return;

  const plotLeft = x + 13;
  const plotRight = x + width - 5;
  const plotTop = y + 13;
  const plotBottom = y + height - 11;
  const plotW = plotRight - plotLeft;
  const plotH = Math.max(12, plotBottom - plotTop);

  const maxCount = Math.max(1, ...freqs.map((f) => f.count));
  const mostSet = new Set(analytics.mostFrequent.map((f) => f.value));

  // Horizontal gridlines & Y-axis ticks
  const gridSteps = 4;
  doc.setDrawColor(51, 65, 85);
  doc.setLineWidth(0.18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(148, 163, 184);

  for (let i = 0; i <= gridSteps; i++) {
    const gy = plotBottom - (plotH * i) / gridSteps;
    doc.line(plotLeft, gy, plotRight, gy);
    const tickVal = Math.round((maxCount * i) / gridSteps);
    doc.text(String(tickVal), plotLeft - 2, gy + 1.2, {align: 'right'});
  }

  // Frequency Bars
  const slotW = plotW / freqs.length;
  const gap = Math.min(2.6, slotW * 0.28);
  const barW = Math.max(2.2, slotW - gap);

  freqs.forEach((item, idx) => {
    const bx = plotLeft + idx * slotW + (slotW - barW) / 2;
    const ratio = analytics.totalRecords > 0 ? item.count / maxCount : 0;
    const bh = item.count > 0 ? Math.max(1.8, ratio * (plotH - 3.5)) : 0.8;
    const by = plotBottom - bh;

    const isBig = item.category === 'BIG';
    const isMost = analytics.totalRecords > 0 && mostSet.has(item.value);

    if (item.count === 0) {
      doc.setFillColor(51, 65, 85);
    } else if (isBig) {
      doc.setFillColor(16, 185, 129);
    } else {
      doc.setFillColor(59, 130, 246);
    }

    doc.roundedRect(bx, by, barW, bh, 0.8, 0.8, 'F');

    if (isMost) {
      doc.setDrawColor(250, 204, 21);
      doc.setLineWidth(0.55);
      doc.roundedRect(bx, by, barW, bh, 0.8, 0.8, 'S');
    }

    // Count above bar
    if (freqs.length <= 24) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(freqs.length <= 14 ? 7.2 : 6);
      doc.setTextColor(
        item.count > 0 ? 248 : 100,
        item.count > 0 ? 250 : 116,
        item.count > 0 ? 252 : 139
      );
      doc.text(String(item.count), bx + barW / 2, by - 1.2, {align: 'center'});
    }

    // Number label below axis
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(freqs.length <= 16 ? 7.5 : 6.2);
    if (isBig) {
      doc.setTextColor(52, 211, 153);
    } else {
      doc.setTextColor(96, 165, 250);
    }
    doc.text(String(item.value), bx + barW / 2, plotBottom + 4.5, {
      align: 'center',
    });
  });

  // Footer caption inside chart box
  const mostStr =
    analytics.mostFrequent.length > 0
      ? analytics.mostFrequent.map((f) => `${f.value} (${f.count}x)`).join(', ')
      : 'None';
  const leastStr =
    analytics.leastFrequent.length > 0
      ? analytics.leastFrequent.map((f) => `${f.value} (${f.count}x)`).join(', ')
      : 'None';

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Most Frequent: ${mostStr}   |   Least Frequent: ${leastStr}`,
    x + 5,
    y + height - 2.3
  );
}

function drawHistoryTableHeader(
  doc: jsPDF,
  y: number,
  pageWidth: number
): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setFillColor(15, 23, 42);
  doc.setTextColor(255, 255, 255);
  doc.rect(14, y - 4, pageWidth - 28, 6.5, 'F');
  doc.text('Date', 16, y);
  doc.text('Round', 46, y);
  doc.text('Result', 82, y);
  doc.text('Class', 102, y);
  doc.text('Parity', 120, y);
  doc.text('Source PDF', 138, y);
  return y + 6;
}

/**
 * Generates a summary PDF report directly from the historical records and
 * current analytical state, including visual frequency count charts,
 * Big/Small & Odd/Even proportion meters, streak badges, and data tables.
 */
export function generateSummaryPdfReport(
  records: GameRecord[],
  rules: GameRules,
  analytics: AnalyticsSnapshot,
  options: SummaryPdfOptions = {}
): SummaryPdfResult {
  const {autoDownload = true, maxHistoryRows = 200} = options;
  const doc = new jsPDF({orientation: 'portrait', unit: 'mm', format: 'a4'});
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - 28;

  // 1. Header Banner
  doc.setFillColor(11, 18, 36);
  doc.rect(0, 0, pageWidth, 34, 'F');
  doc.setFillColor(16, 185, 129);
  doc.rect(0, 33, pageWidth, 1.2, 'F');

  doc.setTextColor(16, 185, 129);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('RAJA AI PREDICTOR', 14, 14);

  doc.setTextColor(226, 232, 240);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(
    `Historical Analytical Summary Report  •  Generated ${new Date().toLocaleString()}`,
    14,
    21.5
  );

  doc.setTextColor(96, 165, 250);
  doc.setFontSize(8.8);
  doc.text(
    `Active Rules: Valid Range ${rules.minNumber}–${rules.maxNumber}  |  Big >= ${rules.bigThreshold}  |  Small < ${rules.bigThreshold}  |  Min Sample Warning: ${rules.minSampleWarning}`,
    14,
    28.5
  );

  let y = 41;

  // 2. KPI Summary Cards Row
  const kpiGap = 3.5;
  const kpiW = (contentWidth - kpiGap * 3) / 4;
  const kpis = [
    {
      label: 'TOTAL RECORDS',
      value: String(analytics.totalRecords),
      sub: `${analytics.uniqueFiles} source file(s)`,
      accent: [30, 64, 175] as [number, number, number],
    },
    {
      label: 'BIG RESULTS',
      value: `${analytics.bigCount}`,
      sub: `${analytics.bigPct.toFixed(1)}% share`,
      accent: [16, 185, 129] as [number, number, number],
    },
    {
      label: 'SMALL RESULTS',
      value: `${analytics.smallCount}`,
      sub: `${analytics.smallPct.toFixed(1)}% share`,
      accent: [59, 130, 246] as [number, number, number],
    },
    {
      label: 'CURRENT STREAK',
      value:
        analytics.streaks.currentType === 'NONE'
          ? 'NONE'
          : `${analytics.streaks.currentType} x${analytics.streaks.currentLength}`,
      sub: `Max B:${analytics.streaks.longestBig} / S:${analytics.streaks.longestSmall}`,
      accent: [14, 165, 233] as [number, number, number],
    },
  ];

  kpis.forEach((kpi, idx) => {
    const kx = 14 + idx * (kpiW + kpiGap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.roundedRect(kx, y, kpiW, 20, 2.2, 2.2, 'FD');

    doc.setFillColor(kpi.accent[0], kpi.accent[1], kpi.accent[2]);
    doc.rect(kx, y, kpiW, 1.8, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, kx + 3, y + 6.5);

    doc.setFontSize(12.5);
    doc.setTextColor(15, 23, 42);
    doc.text(kpi.value, kx + 3, y + 13.2);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.4);
    doc.setTextColor(71, 85, 105);
    doc.text(kpi.sub, kx + 3, y + 17.8);
  });

  y += 26;

  // 3. Visual Split Meters (Big/Small & Odd/Even) + Recent Sequence Badges
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('1. Visual Category & Parity Proportions', 14, y);
  y += 4.5;

  drawSplitRatioBar(
    doc,
    14,
    y,
    contentWidth,
    7.5,
    `BIG ${analytics.bigPct.toFixed(1)}% (${analytics.bigCount})`,
    analytics.totalRecords > 0 ? analytics.bigPct : 50,
    [16, 185, 129],
    `SMALL ${analytics.smallPct.toFixed(1)}% (${analytics.smallCount})`,
    [59, 130, 246]
  );
  y += 10;

  drawSplitRatioBar(
    doc,
    14,
    y,
    contentWidth,
    6.8,
    `ODD ${analytics.oddPct.toFixed(1)}% (${analytics.oddCount})`,
    analytics.totalRecords > 0 ? analytics.oddPct : 50,
    [14, 116, 144],
    `EVEN ${analytics.evenPct.toFixed(1)}% (${analytics.evenCount})`,
    [30, 64, 175]
  );
  y += 10.5;

  // Recent Pattern Pills
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(71, 85, 105);
  doc.text('Recent Sequence:', 14, y + 3.8);
  const tokens =
    analytics.recentPattern === 'No data'
      ? []
      : analytics.recentPattern.split(' ').slice(-14);
  if (tokens.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.text('No historical records available.', 43, y + 3.8);
  } else {
    tokens.forEach((tok, idx) => {
      const px = 43 + idx * 7.2;
      if (tok === 'B') doc.setFillColor(16, 185, 129);
      else doc.setFillColor(59, 130, 246);
      doc.roundedRect(px, y, 5.8, 5.2, 1.2, 1.2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(255, 255, 255);
      doc.text(tok, px + 2.9, y + 3.7, {align: 'center'});
    });
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Alternation: ${(analytics.streaks.alternationRate * 100).toFixed(1)}%`,
    pageWidth - 14,
    y + 3.8,
    {align: 'right'}
  );
  y += 10.5;

  // 4. Visual Number Frequency Bar Chart
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('2. Visual Frequency Count Summary', 14, y);
  y += 3.5;

  drawFrequencyBarChart(doc, analytics, 14, y, contentWidth, 58);
  y += 63;

  // 5. Statistical Estimate & Randomness Transparency Box
  const disclaimerText = `${analytics.estimateSummary} ${RANDOMNESS_DISCLAIMER}`;
  const wrappedNote = doc.splitTextToSize(disclaimerText, contentWidth - 8);
  const noteBoxH = Math.max(18, 9 + wrappedNote.length * 4.1);

  if (analytics.insufficientData) {
    doc.setFillColor(255, 251, 235);
    doc.setDrawColor(245, 158, 11);
  } else {
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(59, 130, 246);
  }
  doc.setLineWidth(0.35);
  doc.roundedRect(14, y, contentWidth, noteBoxH, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  if (analytics.insufficientData) {
    doc.setTextColor(180, 83, 9);
    doc.text(
      `Insufficient Data Warning (${analytics.totalRecords}/${rules.minSampleWarning} min) & Transparency Notice`,
      18,
      y + 5.5
    );
  } else {
    doc.setTextColor(30, 64, 175);
    doc.text(
      'Statistical Estimate & Randomness Transparency Notice',
      18,
      y + 5.5
    );
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  doc.text(wrappedNote, 18, y + 10.2);
  y += noteBoxH + 7;

  // 6. Number Frequency Breakdown Table with Inline Visual Frequency Bars
  if (y > 235) {
    doc.addPage();
    y = 18;
  }
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('3. Number Frequency Breakdown', 14, y);
  y += 6;

  doc.setFontSize(8.5);
  doc.setFillColor(15, 23, 42);
  doc.setTextColor(255, 255, 255);
  doc.rect(14, y - 4, contentWidth, 6.5, 'F');
  doc.text('Number', 17, y);
  doc.text('Category', 38, y);
  doc.text('Parity', 62, y);
  doc.text('Count', 84, y);
  doc.text('Share %', 104, y);
  doc.text('Visual Frequency', 128, y);
  y += 6;

  const maxFreqCount = Math.max(
    1,
    ...analytics.frequencies.map((item) => item.count)
  );
  const inlineBarMaxW = 62;

  doc.setFont('helvetica', 'normal');
  for (const freq of analytics.frequencies) {
    if (y > 276) {
      doc.addPage();
      y = 18;
    }
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'bold');
    doc.text(String(freq.value), 19, y);
    doc.setFont('helvetica', 'normal');

    if (freq.category === 'BIG') doc.setTextColor(5, 150, 105);
    else doc.setTextColor(37, 99, 235);
    doc.text(freq.category, 38, y);

    doc.setTextColor(51, 65, 85);
    doc.text(freq.parity, 62, y);
    doc.text(String(freq.count), 86, y);
    doc.text(`${freq.percentage.toFixed(1)}%`, 104, y);

    // Inline visual bar
    const barTrackY = y - 2.9;
    doc.setFillColor(226, 232, 240);
    doc.roundedRect(128, barTrackY, inlineBarMaxW, 3.2, 1, 1, 'F');
    if (freq.count > 0) {
      const fillW = Math.max(2, (freq.count / maxFreqCount) * inlineBarMaxW);
      if (freq.category === 'BIG') doc.setFillColor(16, 185, 129);
      else doc.setFillColor(59, 130, 246);
      doc.roundedRect(128, barTrackY, fillW, 3.2, 1, 1, 'F');
    }

    y += 5.4;
  }

  // 7. Historical Records Ledger
  y += 6;
  if (y > 245) {
    doc.addPage();
    y = 18;
  }
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`4. Historical Records Ledger (${records.length} total)`, 14, y);
  y += 6;

  y = drawHistoryTableHeader(doc, y, pageWidth);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  const rowsToRender = Math.min(records.length, maxHistoryRows);
  for (let i = 0; i < rowsToRender; i++) {
    const rec = records[i];
    if (y > 278) {
      doc.addPage();
      y = 18;
      y = drawHistoryTableHeader(doc, y, pageWidth);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.2);
    }
    if (i % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(14, y - 3.6, contentWidth, 4.9, 'F');
    }
    const cat = classifyBigSmall(rec.result, rules);
    const parity = classifyParity(rec.result);

    doc.setTextColor(30, 41, 59);
    doc.text(rec.date, 16, y);
    doc.text(rec.round.slice(0, 18), 46, y);
    doc.setFont('helvetica', 'bold');
    doc.text(String(rec.result), 84, y);
    doc.setFont('helvetica', 'normal');

    if (cat === 'BIG') doc.setTextColor(5, 150, 105);
    else doc.setTextColor(37, 99, 235);
    doc.text(cat, 102, y);

    doc.setTextColor(71, 85, 105);
    doc.text(parity, 120, y);
    doc.text(rec.sourceFile.slice(0, 28), 138, y);
    y += 5;
  }

  if (records.length > rowsToRender) {
    y += 3;
    if (y > 280) {
      doc.addPage();
      y = 18;
    }
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Showing latest ${rowsToRender} of ${records.length} records. Export CSV for the complete raw dataset.`,
      16,
      y
    );
  }

  // Page numbers footer on every page
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `RAJA AI PREDICTOR  •  Descriptive Historical Statistics Only  •  Page ${p} of ${totalPages}`,
      pageWidth / 2,
      pageHeight - 7,
      {align: 'center'}
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = `raja-ai-predictor-summary-${stamp}.pdf`;
  const blob = doc.output('blob');
  if (autoDownload) {
    doc.save(fileName);
  }
  return {doc, fileName, blob};
}

export function exportPdfReport(
  records: GameRecord[],
  rules: GameRules,
  analytics: AnalyticsSnapshot
): string {
  return generateSummaryPdfReport(records, rules, analytics, {
    autoDownload: true,
  }).fileName;
}

/**
 * Generates a downloadable blank/format-example PDF template on the user's device
 * only when explicitly requested by the user to test PDF upload parsing.
 * Does NOT insert any fabricated records into app state.
 */
export function downloadBlankFormatPdfTemplate(rules: GameRules): string {
  const doc = new jsPDF({orientation: 'portrait', unit: 'mm', format: 'a4'});
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('RAJA AI PREDICTOR — PDF Upload Format Template', 14, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(
    `Supported row format: YYYY-MM-DD   RoundID   Result (${rules.minNumber}-${rules.maxNumber})`,
    14,
    26
  );
  doc.text(
    'Replace or append your real historical rows in your own PDF exports:',
    14,
    33
  );
  doc.setFont('courier', 'normal');
  doc.setFontSize(10);
  doc.text('Date         Round        Result', 14, 44);
  doc.text('2026-11-26   2026112601   ' + String(rules.minNumber), 14, 52);
  doc.text('2026-11-26   2026112602   ' + String(rules.bigThreshold), 14, 59);
  doc.text('2026-11-26   2026112603   ' + String(rules.maxNumber), 14, 66);

  const fileName = 'raja-pdf-format-template.pdf';
  doc.save(fileName);
  return fileName;
}
