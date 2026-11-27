import {RANDOMNESS_DISCLAIMER} from '../constants.ts';
import {
  classifyBigSmall,
  filterHistoryRecords,
} from '../services/analyticsService.ts';
import {scanPdfFiles} from '../services/pdfScannerService.ts';
import {downloadBlankFormatPdfTemplate} from '../services/reportService.ts';
import type {
  GameRecord,
  GameRules,
  HistoryFilter,
  ParsedCandidate,
} from '../types.ts';

export interface ModalCallbacks {
  getRecords: () => GameRecord[];
  getRules: () => GameRules;
  onCommitCandidates: (
    records: Omit<GameRecord, 'id' | 'importedAt'>[],
    meta: {filesProcessed: number; ocrPagesUsed: number}
  ) => void;
  onAddSingleRecord: (record: Omit<GameRecord, 'id' | 'importedAt'>) => void;
  onUpdateRecord: (record: GameRecord) => void;
  onDeleteRecord: (recordId: string) => void;
  onUpdateRules: (rules: GameRules) => void;
  onUpdateHistoryFilter: (filter: HistoryFilter) => void;
  getHistoryFilter: () => HistoryFilter;
  onNotify: (message: string) => void;
}

/**
 * Native 2D DOM modal companion for OS file picking (multi-PDF upload),
 * OCR progress feedback, inline manual record correction, full keyboard search/filter,
 * and configurable game rule editing.
 */
export class DomModalManager {
  private callbacks: ModalCallbacks;
  private fileInput: HTMLInputElement;
  private backdrop: HTMLDivElement;
  private modalBox: HTMLDivElement;
  private scanCandidates: ParsedCandidate[] = [];
  private scanMeta = {filesProcessed: 0, ocrPagesUsed: 0};
  private scanWarnings: string[] = [];

  constructor(callbacks: ModalCallbacks) {
    this.callbacks = callbacks;

    // Hidden multi-PDF file input
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'application/pdf,.pdf';
    this.fileInput.multiple = true;
    this.fileInput.style.display = 'none';
    this.fileInput.addEventListener('change', () => {
      const files = this.fileInput.files ? Array.from(this.fileInput.files) : [];
      this.fileInput.value = '';
      if (files.length > 0) {
        void this.handleSelectedPdfFiles(files);
      }
    });
    document.body.appendChild(this.fileInput);

    // Modal overlay container
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'raja-modal-backdrop';
    this.backdrop.style.display = 'none';
    this.backdrop.addEventListener('click', (event) => {
      if (event.target === this.backdrop) this.close();
    });

    this.modalBox = document.createElement('div');
    this.modalBox.className = 'raja-modal-box';
    this.backdrop.appendChild(this.modalBox);
    document.body.appendChild(this.backdrop);
  }

  openPdfFilePicker(): void {
    this.fileInput.click();
  }

  openScannerHub(): void {
    const rules = this.callbacks.getRules();
    this.showModal('PDF Upload Scanner & Manual Correction', (body) => {
      const intro = document.createElement('p');
      intro.className = 'raja-muted';
      intro.textContent = `Upload one or more PDF files from storage. Text is extracted automatically with OCR fallback for scanned pages, then parsed for Date, Round, and Result (${rules.minNumber}–${rules.maxNumber}). Duplicates are flagged automatically.`;
      body.appendChild(intro);

      const dropZone = document.createElement('div');
      dropZone.className = 'raja-dropzone';
      dropZone.innerHTML =
        '<div class="raja-drop-title">Select PDF Files from Storage</div><div class="raja-drop-sub">Supports multi-file upload • PDF text extraction + OCR fallback • Duplicate check</div>';
      dropZone.addEventListener('click', () => this.openPdfFilePicker());
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('active');
      });
      dropZone.addEventListener('dragleave', () =>
        dropZone.classList.remove('active')
      );
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('active');
        const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
          f.name.toLowerCase().endsWith('.pdf')
        );
        if (files.length > 0) void this.handleSelectedPdfFiles(files);
      });
      body.appendChild(dropZone);

      const actions = document.createElement('div');
      actions.className = 'raja-btn-row';

      const uploadBtn = this.makeButton('Choose PDF File(s)', 'primary', () =>
        this.openPdfFilePicker()
      );
      const manualBtn = this.makeButton('Add Single Record Manually', 'secondary', () =>
        this.openRecordEditor()
      );
      const templateBtn = this.makeButton(
        'Download Format Template PDF',
        'ghost',
        () => {
          const fileName = downloadBlankFormatPdfTemplate(rules);
          this.callbacks.onNotify(
            `Downloaded ${fileName}. Upload it or your own PDFs to test scanning.`
          );
        }
      );

      actions.append(uploadBtn, manualBtn, templateBtn);
      body.appendChild(actions);
    });
  }

  private async handleSelectedPdfFiles(files: File[]): Promise<void> {
    this.showModal('Scanning PDF Files...', (body) => {
      const status = document.createElement('div');
      status.id = 'raja-scan-status';
      status.className = 'raja-scan-progress';
      status.textContent = `Preparing ${files.length} PDF file(s)...`;
      body.appendChild(status);
    });

    const rules = this.callbacks.getRules();
    const existing = this.callbacks.getRecords();
    const result = await scanPdfFiles(files, rules, existing, (progress) => {
      const el = document.getElementById('raja-scan-status');
      if (el) el.textContent = progress.detail;
    });

    this.scanCandidates = result.candidates;
    this.scanMeta = {
      filesProcessed: result.filesProcessed,
      ocrPagesUsed: result.ocrPagesUsed,
    };
    this.scanWarnings = result.warnings;
    this.renderScanReviewModal();
  }

  private renderScanReviewModal(): void {
    const rules = this.callbacks.getRules();
    const uniqueCount = this.scanCandidates.filter((c) => !c.isDuplicate).length;
    const dupCount = this.scanCandidates.length - uniqueCount;

    this.showModal('Review & Correct Extracted PDF Records', (body) => {
      const stats = document.createElement('div');
      stats.className = 'raja-summary-strip';
      stats.textContent = `Files: ${this.scanMeta.filesProcessed}  •  Detected: ${this.scanCandidates.length}  •  New Unique: ${uniqueCount}  •  Duplicates Flagged: ${dupCount}  •  OCR Pages: ${this.scanMeta.ocrPagesUsed}`;
      body.appendChild(stats);

      if (this.scanWarnings.length > 0) {
        const warnBox = document.createElement('div');
        warnBox.className = 'raja-warn-box';
        warnBox.textContent = this.scanWarnings.join(' | ');
        body.appendChild(warnBox);
      }

      if (this.scanCandidates.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'raja-muted';
        empty.textContent =
          'No structured rows matched automatically. You can add rows manually below or upload another PDF.';
        body.appendChild(empty);
      } else {
        const tableWrap = document.createElement('div');
        tableWrap.className = 'raja-table-wrap';
        const table = document.createElement('table');
        table.className = 'raja-table';
        table.innerHTML =
          '<thead><tr><th>Date</th><th>Round</th><th>Result</th><th>Status</th><th>Action</th></tr></thead>';
        const tbody = document.createElement('tbody');

        this.scanCandidates.forEach((cand) => {
          const tr = document.createElement('tr');
          if (cand.isDuplicate) tr.classList.add('is-dup');

          const dateTd = document.createElement('td');
          const dateIn = document.createElement('input');
          dateIn.type = 'text';
          dateIn.value = cand.date;
          dateIn.className = 'raja-input-sm';
          dateIn.addEventListener('change', () => {
            cand.date = dateIn.value.trim();
          });
          dateTd.appendChild(dateIn);

          const roundTd = document.createElement('td');
          const roundIn = document.createElement('input');
          roundIn.type = 'text';
          roundIn.value = cand.round;
          roundIn.className = 'raja-input-sm';
          roundIn.addEventListener('change', () => {
            cand.round = roundIn.value.trim();
          });
          roundTd.appendChild(roundIn);

          const resTd = document.createElement('td');
          const resIn = document.createElement('input');
          resIn.type = 'number';
          resIn.min = String(rules.minNumber);
          resIn.max = String(rules.maxNumber);
          resIn.value = String(cand.result);
          resIn.className = 'raja-input-num';
          resIn.addEventListener('change', () => {
            const v = Number(resIn.value);
            if (Number.isInteger(v)) cand.result = v;
          });
          resTd.appendChild(resIn);

          const statusTd = document.createElement('td');
          statusTd.textContent = cand.isDuplicate
            ? 'Duplicate'
            : cand.ocrExtracted
              ? 'New (OCR)'
              : 'New';
          statusTd.className = cand.isDuplicate ? 'tag-warn' : 'tag-ok';

          const actTd = document.createElement('td');
          const delBtn = this.makeButton('Remove', 'danger', () => {
            this.scanCandidates = this.scanCandidates.filter(
              (c) => c.tempId !== cand.tempId
            );
            this.renderScanReviewModal();
          });
          actTd.appendChild(delBtn);

          tr.append(dateTd, roundTd, resTd, statusTd, actTd);
          tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        tableWrap.appendChild(table);
        body.appendChild(tableWrap);
      }

      const actions = document.createElement('div');
      actions.className = 'raja-btn-row';

      const commitBtn = this.makeButton(
        `Save ${uniqueCount} Unique Record(s)`,
        'primary',
        () => {
          const valid = this.scanCandidates.filter(
            (c) =>
              c.date.trim() &&
              c.round.trim() &&
              Number.isInteger(c.result) &&
              c.result >= rules.minNumber &&
              c.result <= rules.maxNumber
          );
          this.callbacks.onCommitCandidates(
            valid.map((c) => ({
              date: c.date.trim(),
              round: c.round.trim(),
              result: c.result,
              sourceFile: c.sourceFile,
              ocrExtracted: c.ocrExtracted,
            })),
            this.scanMeta
          );
          this.close();
        }
      );
      if (uniqueCount === 0 && this.scanCandidates.length === 0) {
        commitBtn.disabled = true;
      }

      const addRowBtn = this.makeButton('+ Add Row Manually', 'secondary', () => {
        this.scanCandidates.push({
          tempId: `manual_${Date.now()}`,
          date: new Date().toISOString().slice(0, 10),
          round: `R-${this.scanCandidates.length + 1}`,
          result: rules.minNumber,
          sourceFile: 'Manual Entry',
          isDuplicate: false,
          ocrExtracted: false,
          rawLine: '',
        });
        this.renderScanReviewModal();
      });

      const morePdfBtn = this.makeButton('Upload More PDFs', 'ghost', () =>
        this.openPdfFilePicker()
      );

      actions.append(commitBtn, addRowBtn, morePdfBtn);
      body.appendChild(actions);
    });
  }

  openRecordEditor(existing?: GameRecord): void {
    const rules = this.callbacks.getRules();
    const title = existing
      ? 'Manual Record Correction'
      : 'Add Historical Record Manually';

    this.showModal(title, (body) => {
      const form = document.createElement('form');
      form.className = 'raja-form';

      const dateInput = this.makeLabeledInput(
        form,
        'Date (YYYY-MM-DD)',
        'date',
        existing?.date ?? new Date().toISOString().slice(0, 10)
      );
      const roundInput = this.makeLabeledInput(
        form,
        'Round Number / ID',
        'text',
        existing?.round ?? ''
      );
      roundInput.placeholder = 'e.g. 2026112601';

      const resultInput = this.makeLabeledInput(
        form,
        `Result Number (${rules.minNumber}–${rules.maxNumber})`,
        'number',
        existing ? String(existing.result) : String(rules.minNumber)
      );
      resultInput.min = String(rules.minNumber);
      resultInput.max = String(rules.maxNumber);
      resultInput.step = '1';

      const sourceInput = this.makeLabeledInput(
        form,
        'Source Label / PDF Name',
        'text',
        existing?.sourceFile ?? 'Manual Entry'
      );

      const errEl = document.createElement('div');
      errEl.className = 'raja-error';
      form.appendChild(errEl);

      const actions = document.createElement('div');
      actions.className = 'raja-btn-row';
      const saveBtn = this.makeButton(
        existing ? 'Save Correction' : 'Save Record',
        'primary',
        () => {}
      );
      saveBtn.type = 'submit';

      const cancelBtn = this.makeButton('Cancel', 'ghost', () => this.close());
      actions.append(saveBtn, cancelBtn);
      form.appendChild(actions);

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const date = dateInput.value.trim();
        const round = roundInput.value.trim();
        const result = Number(resultInput.value);
        const sourceFile = sourceInput.value.trim() || 'Manual Entry';

        if (!date || !round) {
          errEl.textContent = 'Date and Round ID are required.';
          return;
        }
        if (
          !Number.isInteger(result) ||
          result < rules.minNumber ||
          result > rules.maxNumber
        ) {
          errEl.textContent = `Result must be an integer between ${rules.minNumber} and ${rules.maxNumber}.`;
          return;
        }

        if (existing) {
          this.callbacks.onUpdateRecord({
            ...existing,
            date,
            round,
            result,
            sourceFile,
          });
        } else {
          this.callbacks.onAddSingleRecord({
            date,
            round,
            result,
            sourceFile,
          });
        }
        this.close();
      });

      body.appendChild(form);
    });
  }

  openHistoryManager(): void {
    const render = () => {
      const rules = this.callbacks.getRules();
      const filter = {...this.callbacks.getHistoryFilter()};
      const allRecords = this.callbacks.getRecords();
      const filtered = filterHistoryRecords(allRecords, filter, rules);

      this.showModal(
        `Historical Records (${filtered.length} / ${allRecords.length})`,
        (body) => {
          const bar = document.createElement('div');
          bar.className = 'raja-filter-bar';

          const searchIn = document.createElement('input');
          searchIn.type = 'text';
          searchIn.className = 'raja-input';
          searchIn.placeholder = 'Search by date (YYYY-MM-DD), round, or file...';
          searchIn.value = filter.query;
          searchIn.addEventListener('input', () => {
            this.callbacks.onUpdateHistoryFilter({
              ...this.callbacks.getHistoryFilter(),
              query: searchIn.value,
            });
            render();
          });

          const catSel = document.createElement('select');
          catSel.className = 'raja-select';
          (['ALL', 'BIG', 'SMALL'] as const).forEach((opt) => {
            const o = document.createElement('option');
            o.value = opt;
            o.textContent = opt === 'ALL' ? 'All Classes' : opt;
            o.selected = filter.category === opt;
            catSel.appendChild(o);
          });
          catSel.addEventListener('change', () => {
            this.callbacks.onUpdateHistoryFilter({
              ...this.callbacks.getHistoryFilter(),
              category: catSel.value as HistoryFilter['category'],
            });
            render();
          });

          const numSel = document.createElement('select');
          numSel.className = 'raja-select';
          const allNumOpt = document.createElement('option');
          allNumOpt.value = 'ALL';
          allNumOpt.textContent = 'All Numbers';
          allNumOpt.selected = filter.numberFilter === 'ALL';
          numSel.appendChild(allNumOpt);
          for (let n = rules.minNumber; n <= rules.maxNumber; n++) {
            const o = document.createElement('option');
            o.value = String(n);
            o.textContent = `Number ${n}`;
            o.selected = filter.numberFilter === n;
            numSel.appendChild(o);
          }
          numSel.addEventListener('change', () => {
            this.callbacks.onUpdateHistoryFilter({
              ...this.callbacks.getHistoryFilter(),
              numberFilter:
                numSel.value === 'ALL' ? 'ALL' : Number(numSel.value),
            });
            render();
          });

          bar.append(searchIn, catSel, numSel);
          body.appendChild(bar);

          if (filtered.length === 0) {
            const p = document.createElement('p');
            p.className = 'raja-muted';
            p.textContent =
              allRecords.length === 0
                ? 'No saved records yet. Upload PDF files or add records manually.'
                : 'No records match your current search/filter criteria.';
            body.appendChild(p);
          } else {
            const tableWrap = document.createElement('div');
            tableWrap.className = 'raja-table-wrap';
            const table = document.createElement('table');
            table.className = 'raja-table';
            table.innerHTML =
              '<thead><tr><th>Date</th><th>Round</th><th>Result</th><th>Class</th><th>Source</th><th>Actions</th></tr></thead>';
            const tbody = document.createElement('tbody');

            for (const rec of filtered.slice(0, 120)) {
              const tr = document.createElement('tr');
              const cat = classifyBigSmall(rec.result, rules);
              tr.innerHTML = `<td>${this.escapeHtml(rec.date)}</td><td>${this.escapeHtml(rec.round)}</td><td><strong>${rec.result}</strong></td><td class="${cat === 'BIG' ? 'tag-ok' : 'tag-blue'}">${cat}</td><td>${this.escapeHtml(rec.sourceFile)}</td>`;

              const actTd = document.createElement('td');
              actTd.className = 'raja-inline-actions';
              const editBtn = this.makeButton('Edit', 'secondary', () =>
                this.openRecordEditor(rec)
              );
              const delBtn = this.makeButton('Delete', 'danger', () => {
                this.callbacks.onDeleteRecord(rec.id);
                render();
              });
              actTd.append(editBtn, delBtn);
              tr.appendChild(actTd);
              tbody.appendChild(tr);
            }
            table.appendChild(tbody);
            tableWrap.appendChild(table);
            body.appendChild(tableWrap);
          }

          const footer = document.createElement('div');
          footer.className = 'raja-btn-row';
          footer.append(
            this.makeButton('+ Add Record', 'primary', () =>
              this.openRecordEditor()
            ),
            this.makeButton('Clear Filters', 'ghost', () => {
              this.callbacks.onUpdateHistoryFilter({
                query: '',
                category: 'ALL',
                numberFilter: 'ALL',
              });
              render();
            }),
            this.makeButton('Done', 'secondary', () => this.close())
          );
          body.appendChild(footer);
        }
      );
    };

    render();
  }

  openRulesModal(): void {
    const rules = this.callbacks.getRules();
    this.showModal('Configurable Game Rules', (body) => {
      const form = document.createElement('form');
      form.className = 'raja-form';

      const minIn = this.makeLabeledInput(
        form,
        'Minimum Valid Number',
        'number',
        String(rules.minNumber)
      );
      const maxIn = this.makeLabeledInput(
        form,
        'Maximum Valid Number',
        'number',
        String(rules.maxNumber)
      );
      const threshIn = this.makeLabeledInput(
        form,
        'Big Threshold (Result >= Threshold is BIG)',
        'number',
        String(rules.bigThreshold)
      );
      const sampleIn = this.makeLabeledInput(
        form,
        'Insufficient Data Warning Threshold (min records)',
        'number',
        String(rules.minSampleWarning)
      );

      const note = document.createElement('p');
      note.className = 'raja-muted';
      note.textContent = RANDOMNESS_DISCLAIMER;
      form.appendChild(note);

      const errEl = document.createElement('div');
      errEl.className = 'raja-error';
      form.appendChild(errEl);

      const actions = document.createElement('div');
      actions.className = 'raja-btn-row';
      const saveBtn = this.makeButton('Apply Rules', 'primary', () => {});
      saveBtn.type = 'submit';
      const preset09 = this.makeButton('Preset 0–9 (Big >= 5)', 'secondary', () => {
        minIn.value = '0';
        maxIn.value = '9';
        threshIn.value = '5';
        sampleIn.value = '10';
      });
      const preset110 = this.makeButton('Preset 1–10 (Big >= 6)', 'ghost', () => {
        minIn.value = '1';
        maxIn.value = '10';
        threshIn.value = '6';
        sampleIn.value = '10';
      });
      actions.append(saveBtn, preset09, preset110);
      form.appendChild(actions);

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const minNumber = Number(minIn.value);
        const maxNumber = Number(maxIn.value);
        const bigThreshold = Number(threshIn.value);
        const minSampleWarning = Number(sampleIn.value);

        if (
          !Number.isInteger(minNumber) ||
          !Number.isInteger(maxNumber) ||
          maxNumber <= minNumber ||
          maxNumber - minNumber > 36
        ) {
          errEl.textContent =
            'Enter a valid integer range (max > min, span up to 36).';
          return;
        }
        if (
          !Number.isInteger(bigThreshold) ||
          bigThreshold <= minNumber ||
          bigThreshold > maxNumber
        ) {
          errEl.textContent = `Big threshold must be between ${minNumber + 1} and ${maxNumber}.`;
          return;
        }
        if (!Number.isInteger(minSampleWarning) || minSampleWarning < 3) {
          errEl.textContent = 'Minimum sample warning must be at least 3.';
          return;
        }

        this.callbacks.onUpdateRules({
          minNumber,
          maxNumber,
          bigThreshold,
          minSampleWarning,
        });
        this.close();
      });

      body.appendChild(form);
    });
  }

  private showModal(
    title: string,
    buildBody: (body: HTMLDivElement) => void
  ): void {
    this.modalBox.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'raja-modal-header';
    const h2 = document.createElement('h2');
    h2.textContent = title;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'raja-close-btn';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.close());
    header.append(h2, closeBtn);

    const body = document.createElement('div');
    body.className = 'raja-modal-body';
    buildBody(body);

    this.modalBox.append(header, body);
    this.backdrop.style.display = 'flex';
  }

  close(): void {
    this.backdrop.style.display = 'none';
  }

  private makeButton(
    label: string,
    variant: 'primary' | 'secondary' | 'danger' | 'ghost',
    onClick: () => void
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `raja-btn raja-btn-${variant}`;
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private makeLabeledInput(
    parent: HTMLElement,
    label: string,
    type: string,
    initialValue: string
  ): HTMLInputElement {
    const wrap = document.createElement('label');
    wrap.className = 'raja-field';
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = type;
    input.value = initialValue;
    input.className = 'raja-input';
    wrap.append(span, input);
    parent.appendChild(wrap);
    return input;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  dispose(): void {
    this.fileInput.remove();
    this.backdrop.remove();
  }
}
