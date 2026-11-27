import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {createWorker} from 'tesseract.js';
import type {
  GameRecord,
  GameRules,
  ParsedCandidate,
  PdfScanProgress,
  PdfScanResult,
} from '../types.ts';
import {buildRecordKey} from './storageService.ts';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfTextItemLike {
  str?: string;
  transform?: number[];
}

function normalizeDate(raw: string): string {
  const trimmed = raw.trim();
  // YYYY-MM-DD or YYYY/MM/DD
  let m = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  // DD-MM-YYYY or DD/MM/YYYY
  m = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const first = Number(m[1]);
    const second = Number(m[2]);
    // If first > 12 it is definitely DD/MM/YYYY; default DD/MM/YYYY for international sheets
    if (first > 12 || second <= 12) {
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return trimmed;
}

function parseLinesToCandidates(
  lines: string[],
  fileName: string,
  rules: GameRules,
  existingKeys: Set<string>,
  batchKeys: Set<string>,
  ocrExtracted: boolean
): ParsedCandidate[] {
  const candidates: ParsedCandidate[] = [];
  const todayFallback = new Date().toISOString().slice(0, 10);
  let activeDate = todayFallback;
  let seqCounter = 1;

  const dateRegex = /(\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{4}\b)/;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line || line.length < 3) continue;

    // Skip obvious header lines
    if (
      /^(date|round|period|draw|result|number|big|small|raja|summary|total|page\s+\d)/i.test(
        line
      ) &&
      !/\d/.test(line.replace(/page\s+\d+/i, ''))
    ) {
      continue;
    }

    const dateMatch = line.match(dateRegex);
    let workingLine = line;
    let lineDate = activeDate;
    if (dateMatch) {
      lineDate = normalizeDate(dateMatch[1]);
      activeDate = lineDate;
      workingLine = workingLine.replace(dateMatch[1], ' ').trim();
    }

    // Strategy 1: Explicit labelled fields: Round/Period/Draw + Result/Number
    const explicitRound = workingLine.match(
      /(?:round|period|draw|issue|no\.?|id|#)\s*[:\-]?\s*([A-Za-z0-9_-]{2,24})/i
    );
    const explicitResult = workingLine.match(
      /(?:result|number|num|val|outcome|win)\s*[:\-]?\s*(-?\d+)/i
    );

    let roundStr: string | null = null;
    let resultNum: number | null = null;

    if (explicitRound && explicitResult) {
      roundStr = explicitRound[1];
      const val = Number(explicitResult[1]);
      if (Number.isInteger(val) && val >= rules.minNumber && val <= rules.maxNumber) {
        resultNum = val;
      }
    }

    // Strategy 2: Tabular/delimited row: <round/period> <result> [Big/Small] [Odd/Even]
    if (roundStr === null || resultNum === null) {
      const cleaned = workingLine
        .replace(/\b(big|small|odd|even|green|red|violet|blue)\b/gi, ' ')
        .replace(/[|,;\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const tokens = cleaned.split(' ').filter(Boolean);
      if (tokens.length >= 2) {
        // Look for a valid result integer (preferring the last valid number token)
        let resIdx = -1;
        for (let i = tokens.length - 1; i >= 1; i--) {
          if (/^-?\d+$/.test(tokens[i])) {
            const val = Number(tokens[i]);
            if (
              Number.isInteger(val) &&
              val >= rules.minNumber &&
              val <= rules.maxNumber
            ) {
              resIdx = i;
              resultNum = val;
              break;
            }
          }
        }
        if (resIdx >= 1) {
          // Pick round token prior to result (prefer alphanumeric/long number token)
          const roundCandidates = tokens.slice(0, resIdx);
          const bestRound =
            roundCandidates.find((t) => /\d/.test(t) && t.length >= 2) ??
            roundCandidates[roundCandidates.length - 1];
          if (bestRound && /[A-Za-z0-9]/.test(bestRound)) {
            roundStr = bestRound.replace(/^#/, '');
          }
        }
      }
    }

    // Strategy 3: Standalone date + single result on line (auto-increment round within date)
    if ((roundStr === null || resultNum === null) && dateMatch) {
      const nums = workingLine.match(/\b\d+\b/g);
      if (nums && nums.length === 1) {
        const val = Number(nums[0]);
        if (val >= rules.minNumber && val <= rules.maxNumber) {
          roundStr = `R-${String(seqCounter).padStart(3, '0')}`;
          resultNum = val;
        }
      }
    }

    if (roundStr && resultNum !== null) {
      const key = buildRecordKey(lineDate, roundStr);
      const isDuplicate = existingKeys.has(key) || batchKeys.has(key);
      batchKeys.add(key);

      candidates.push({
        tempId: `cand_${Date.now()}_${seqCounter}_${Math.random().toString(36).slice(2, 7)}`,
        date: lineDate,
        round: roundStr,
        result: resultNum,
        sourceFile: fileName,
        isDuplicate,
        ocrExtracted,
        rawLine: line,
      });
      seqCounter++;
    }
  }

  return candidates;
}

function reconstructLinesFromTextContent(items: PdfTextItemLike[]): string[] {
  const positioned: {text: string; x: number; y: number}[] = [];
  for (const item of items) {
    const text = (item.str ?? '').trim();
    if (!text) continue;
    const transform = item.transform ?? [1, 0, 0, 1, 0, 0];
    positioned.push({
      text,
      x: transform[4] ?? 0,
      y: transform[5] ?? 0,
    });
  }

  // Sort top-to-bottom (descending Y in PDF coordinate space), then left-to-right
  positioned.sort((a, b) => {
    if (Math.abs(b.y - a.y) > 4) return b.y - a.y;
    return a.x - b.x;
  });

  const rows: {y: number; parts: {x: number; text: string}[]}[] = [];
  for (const item of positioned) {
    const existingRow = rows.find((row) => Math.abs(row.y - item.y) <= 4.5);
    if (existingRow) {
      existingRow.parts.push({x: item.x, text: item.text});
    } else {
      rows.push({y: item.y, parts: [{x: item.x, text: item.text}]});
    }
  }

  return rows.map((row) =>
    row.parts
      .sort((a, b) => a.x - b.x)
      .map((p) => p.text)
      .join(' ')
  );
}

async function runOcrOnPdfPage(
  page: pdfjsLib.PDFPageProxy
): Promise<string[]> {
  const viewport = page.getViewport({scale: 2.0});
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  await page.render({
    canvasContext: ctx,
    viewport,
    canvas,
  }).promise;

  const worker = await createWorker('eng');
  try {
    const {
      data: {text},
    } = await worker.recognize(canvas);
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } finally {
    await worker.terminate();
  }
}

export async function scanPdfFiles(
  files: File[],
  rules: GameRules,
  existingRecords: GameRecord[],
  onProgress?: (progress: PdfScanProgress) => void
): Promise<PdfScanResult> {
  const existingKeys = new Set(
    existingRecords.map((r) => buildRecordKey(r.date, r.round))
  );
  const batchKeys = new Set<string>();
  const allCandidates: ParsedCandidate[] = [];
  const warnings: string[] = [];
  let ocrPagesUsed = 0;

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex];
    onProgress?.({
      fileIndex,
      totalFiles: files.length,
      fileName: file.name,
      stage: 'reading',
      detail: `Reading PDF ${fileIndex + 1}/${files.length}: ${file.name}`,
    });

    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({data: arrayBuffer});
      const pdfDoc = await loadingTask.promise;
      let fileMatches = 0;

      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const extractedLines = reconstructLinesFromTextContent(
          textContent.items as PdfTextItemLike[]
        );

        const joinedLen = extractedLines.join('').trim().length;
        let usedOcr = false;
        let pageLines = extractedLines;

        // If selectable text is absent or too sparse, fall back to Tesseract OCR
        if (joinedLen < 12) {
          onProgress?.({
            fileIndex,
            totalFiles: files.length,
            fileName: file.name,
            stage: 'ocr',
            detail: `Running OCR on ${file.name} (page ${pageNum}/${pdfDoc.numPages})...`,
          });
          try {
            pageLines = await runOcrOnPdfPage(page);
            usedOcr = true;
            ocrPagesUsed++;
          } catch (ocrErr) {
            warnings.push(
              `${file.name} p.${pageNum}: OCR fallback could not run (${ocrErr instanceof Error ? ocrErr.message : 'unknown error'}).`
            );
          }
        }

        onProgress?.({
          fileIndex,
          totalFiles: files.length,
          fileName: file.name,
          stage: 'parsing',
          detail: `Parsing page ${pageNum}/${pdfDoc.numPages} of ${file.name}...`,
        });

        const parsed = parseLinesToCandidates(
          pageLines,
          file.name,
          rules,
          existingKeys,
          batchKeys,
          usedOcr
        );
        allCandidates.push(...parsed);
        fileMatches += parsed.length;
      }

      if (fileMatches === 0) {
        warnings.push(
          `${file.name}: No matching date/round/result rows found for rule range ${rules.minNumber}–${rules.maxNumber}. You can add or correct entries manually.`
        );
      }
    } catch (error) {
      warnings.push(
        `${file.name}: Failed to read PDF (${error instanceof Error ? error.message : String(error)}).`
      );
    }
  }

  onProgress?.({
    fileIndex: files.length,
    totalFiles: files.length,
    fileName: '',
    stage: 'done',
    detail: `Scanned ${files.length} PDF file(s): ${allCandidates.length} row(s) detected.`,
  });

  return {
    filesProcessed: files.length,
    candidates: allCandidates,
    ocrPagesUsed,
    warnings,
  };
}
