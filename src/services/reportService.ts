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

export function exportPdfReport(
  records: GameRecord[],
  rules: GameRules,
  analytics: AnalyticsSnapshot
): string {
  const doc = new jsPDF({orientation: 'portrait', unit: 'mm', format: 'a4'});
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 16;

  // Header Banner
  doc.setFillColor(11, 18, 36);
  doc.rect(0, 0, pageWidth, 34, 'F');
  doc.setTextColor(16, 185, 129);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('RAJA AI PREDICTOR', 14, 15);
  doc.setTextColor(203, 213, 225);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(
    `Historical Statistical Analysis Report  •  Generated ${new Date().toLocaleString()}`,
    14,
    23
  );
  doc.setTextColor(96, 165, 250);
  doc.text(
    `Active Rules: Valid Range ${rules.minNumber}–${rules.maxNumber} | Big >= ${rules.bigThreshold} | Small < ${rules.bigThreshold}`,
    14,
    29
  );

  y = 42;

  // Summary Section
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('1. Overview Metrics', 14, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const summaryLines = [
    `Total Valid Records: ${analytics.totalRecords} (from ${analytics.uniqueFiles} PDF / source file(s))`,
    `Big Results: ${analytics.bigCount} (${analytics.bigPct.toFixed(1)}%)   |   Small Results: ${analytics.smallCount} (${analytics.smallPct.toFixed(1)}%)`,
    `Odd Numbers: ${analytics.oddCount} (${analytics.oddPct.toFixed(1)}%)   |   Even Numbers: ${analytics.evenCount} (${analytics.evenPct.toFixed(1)}%)`,
    `Current Streak: ${analytics.streaks.currentType} (${analytics.streaks.currentLength})   |   Longest Big: ${analytics.streaks.longestBig}   |   Longest Small: ${analytics.streaks.longestSmall}`,
    `Recent Sequence: ${analytics.recentPattern}`,
  ];
  for (const line of summaryLines) {
    doc.text(line, 14, y);
    y += 5.5;
  }

  y += 3;
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, pageWidth - 28, 22, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(30, 64, 175);
  doc.text('Statistical Estimate & Transparency Disclaimer', 17, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  const wrappedNote = doc.splitTextToSize(
    `${analytics.estimateSummary} ${RANDOMNESS_DISCLAIMER}`,
    pageWidth - 34
  );
  doc.text(wrappedNote, 17, y + 11.5);
  y += 28;

  // Number Frequency Table
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('2. Number Frequency Distribution', 14, y);
  y += 7;

  doc.setFontSize(9);
  doc.setFillColor(15, 23, 42);
  doc.setTextColor(255, 255, 255);
  doc.rect(14, y - 4, pageWidth - 28, 6.5, 'F');
  doc.text('Number', 18, y);
  doc.text('Category', 46, y);
  doc.text('Parity', 78, y);
  doc.text('Count', 110, y);
  doc.text('Share %', 140, y);
  y += 6;

  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'normal');
  for (const freq of analytics.frequencies) {
    if (y > 275) {
      doc.addPage();
      y = 18;
    }
    doc.text(String(freq.value), 18, y);
    doc.text(freq.category, 46, y);
    doc.text(freq.parity, 78, y);
    doc.text(String(freq.count), 110, y);
    doc.text(`${freq.percentage.toFixed(1)}%`, 140, y);
    y += 5.2;
  }

  // Historical Records Table
  y += 6;
  if (y > 245) {
    doc.addPage();
    y = 18;
  }
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`3. Historical Records (${records.length} total)`, 14, y);
  y += 7;

  doc.setFontSize(8.5);
  doc.setFillColor(15, 23, 42);
  doc.setTextColor(255, 255, 255);
  doc.rect(14, y - 4, pageWidth - 28, 6.5, 'F');
  doc.text('Date', 16, y);
  doc.text('Round', 46, y);
  doc.text('Result', 82, y);
  doc.text('Class', 102, y);
  doc.text('Source PDF', 124, y);
  y += 6;

  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'normal');
  const maxRows = Math.min(records.length, 200);
  for (let i = 0; i < maxRows; i++) {
    const rec = records[i];
    if (y > 280) {
      doc.addPage();
      y = 18;
    }
    doc.text(rec.date, 16, y);
    doc.text(rec.round.slice(0, 18), 46, y);
    doc.text(String(rec.result), 84, y);
    doc.text(classifyBigSmall(rec.result, rules), 102, y);
    doc.text(rec.sourceFile.slice(0, 34), 124, y);
    y += 5;
  }
  if (records.length > maxRows) {
    y += 3;
    doc.setFont('helvetica', 'italic');
    doc.text(
      `Showing latest ${maxRows} of ${records.length} records. Export CSV for full raw ledger.`,
      16,
      y
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = `raja-ai-predictor-report-${stamp}.pdf`;
  doc.save(fileName);
  return fileName;
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
