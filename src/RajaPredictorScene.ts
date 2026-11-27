import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import * as xb from 'xrblocks';
import {RANDOMNESS_DISCLAIMER, THEME_COLORS} from './constants.ts';
import {
  classifyBigSmall,
  computeAnalytics,
  filterHistoryRecords,
} from './services/analyticsService.ts';
import {
  downloadBlankFormatPdfTemplate,
  exportCsvReport,
  exportPdfReport,
} from './services/reportService.ts';
import {
  addRecordsWithDedupe,
  clearAllRecordsFromStore,
  deleteRecordFromStore,
  loadRecords,
  loadRules,
  saveRules,
  updateRecordInStore,
} from './services/storageService.ts';
import type {
  AnalyticsSnapshot,
  AppTab,
  GameRecord,
  GameRules,
  HistoryFilter,
} from './types.ts';
import {DomModalManager} from './ui/DomModalManager.ts';
import {AnalyticsChartTexture} from './visuals/ChartCanvas.ts';
import {SpatialDataStage} from './visuals/SpatialDataStage.ts';

const TABS: {id: AppTab; label: string; icon: string}[] = [
  {id: 'dashboard', label: 'Home', icon: 'dashboard'},
  {id: 'scanner', label: 'PDF Scan', icon: 'upload_file'},
  {id: 'bigsmall', label: 'Big/Small', icon: 'analytics'},
  {id: 'numbers', label: 'Numbers', icon: 'bar_chart'},
  {id: 'history', label: 'History', icon: 'history'},
  {id: 'reports', label: 'Reports', icon: 'description'},
];

export class RajaPredictorScene extends xb.Script {
  private records: GameRecord[] = [];
  private rules: GameRules = loadRules();
  private activeTab: AppTab = 'dashboard';
  private historyFilter: HistoryFilter = {
    query: '',
    category: 'ALL',
    numberFilter: 'ALL',
  };
  private analytics: AnalyticsSnapshot = computeAnalytics([], this.rules);
  private lastScanReport =
    'No PDF scanned yet. Upload one or more real PDF files from storage.';

  private modalManager!: DomModalManager;
  private stage3D!: SpatialDataStage;
  private mainChart!: AnalyticsChartTexture;
  private sideChart!: AnalyticsChartTexture;
  private envRenderTarget: THREE.WebGLRenderTarget | null = null;

  // Spatial UI references for retained updates
  private tabButtons = new Map<AppTab, xb.UIButton>();
  private overlayTabButtons = new Map<AppTab, xb.UIButton>();

  private rulesSubtitle!: xb.UIText;
  private statusBanner!: xb.UIText;

  // KPI cards
  private kpiTotalVal!: xb.UIText;
  private kpiBigVal!: xb.UIText;
  private kpiSmallVal!: xb.UIText;
  private kpiFilesVal!: xb.UIText;

  // Center dynamic content
  private centerSectionTitle!: xb.UIText;
  private centerBodyText!: xb.UIText;
  private centerSecondaryText!: xb.UIText;
  private centerActionRow!: xb.UIPanel;
  private actionBtnA!: xb.UIButton;
  private actionBtnB!: xb.UIButton;
  private actionBtnC!: xb.UIButton;

  // Left Wing Card (Big/Small & Statistical Honesty)
  private leftWarningBadge!: xb.UIText;
  private leftBigStat!: xb.UIText;
  private leftSmallStat!: xb.UIText;
  private leftStreakText!: xb.UIText;
  private leftEstimateText!: xb.UIText;

  // Right Wing Card (Number Analysis & Quick Actions)
  private rightMostFreq!: xb.UIText;
  private rightLeastFreq!: xb.UIText;
  private rightOddEven!: xb.UIText;
  private rightSummaryLine!: xb.UIText;

  // Dynamic action handlers for center CTA row
  private actionHandlerA: () => void = () => {};
  private actionHandlerB: () => void = () => {};
  private actionHandlerC: () => void = () => {};

  init(): void {
    // Load permanently saved records & rules (zero fabricated records)
    this.rules = loadRules();
    this.records = loadRecords();
    this.analytics = computeAnalytics(this.records, this.rules);

    this.setupLightingAndEnvironment();
    this.setup3DStage();
    this.setupModals();
    this.setupSpatialUI();
    this.refreshAllViews();
  }

  private setupLightingAndEnvironment(): void {
    // Cool navy/sky hemisphere fill + warm directional key + blue rim accent
    const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x0b142c, 2.2);
    this.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff5e6, 2.4);
    keyLight.position.set(2.2, 4.2, 2.5);
    this.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x3b82f6, 1.35);
    rimLight.position.set(-2.5, 2.2, -2.0);
    this.add(rimLight);

    // Procedural RoomEnvironment for crisp metallic/glass reflections
    try {
      const renderer = xb.core.renderer;
      const scene = xb.core.scene;
      if (renderer instanceof THREE.WebGLRenderer && scene) {
        const pmrem = new THREE.PMREMGenerator(renderer);
        this.envRenderTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
        scene.environment = this.envRenderTarget.texture;
        pmrem.dispose();
      }
    } catch (error) {
      console.warn('Could not initialize RoomEnvironment:', error);
    }
  }

  private setup3DStage(): void {
    this.stage3D = new SpatialDataStage();
    this.stage3D.position.set(0, 0.72, -1.16);
    this.add(this.stage3D);
  }

  private setupModals(): void {
    this.modalManager = new DomModalManager({
      getRecords: () => this.records,
      getRules: () => this.rules,
      onCommitCandidates: (incoming, meta) => {
        const res = addRecordsWithDedupe(this.records, incoming);
        this.records = res.records;
        this.lastScanReport = `Scanned ${meta.filesProcessed} PDF(s) (${meta.ocrPagesUsed} OCR page(s)): added ${res.added} unique record(s), skipped ${res.duplicatesSkipped} duplicate(s).`;
        this.setStatus(this.lastScanReport, '#34d399');
        this.refreshAllViews();
      },
      onAddSingleRecord: (record) => {
        const res = addRecordsWithDedupe(this.records, [record]);
        this.records = res.records;
        if (res.added > 0) {
          this.setStatus(
            `Saved record ${record.date} / Round ${record.round} (Result: ${record.result}).`,
            '#34d399'
          );
        } else {
          this.setStatus(
            `Duplicate skipped: ${record.date} / Round ${record.round} already exists.`,
            '#f59e0b'
          );
        }
        this.refreshAllViews();
      },
      onUpdateRecord: (updated) => {
        this.records = updateRecordInStore(this.records, updated);
        this.setStatus(
          `Updated record ${updated.date} / Round ${updated.round} -> ${updated.result}.`,
          '#60a5fa'
        );
        this.refreshAllViews();
      },
      onDeleteRecord: (recordId) => {
        this.records = deleteRecordFromStore(this.records, recordId);
        this.setStatus('Deleted record from permanent storage.', '#f59e0b');
        this.refreshAllViews();
      },
      onUpdateRules: (nextRules) => {
        this.rules = nextRules;
        saveRules(nextRules);
        this.setStatus(
          `Rules updated: Range ${nextRules.minNumber}–${nextRules.maxNumber}, Big >= ${nextRules.bigThreshold}.`,
          '#60a5fa'
        );
        this.refreshAllViews();
      },
      onUpdateHistoryFilter: (nextFilter) => {
        this.historyFilter = nextFilter;
        this.refreshAllViews();
      },
      getHistoryFilter: () => this.historyFilter,
      onNotify: (msg) => this.setStatus(msg, '#60a5fa'),
    });
  }

  private setupSpatialUI(): void {
    this.mainChart = new AnalyticsChartTexture(1024, 340);
    this.sideChart = new AnalyticsChartTexture(680, 290);

    const centerCard = this.buildCenterCard();
    centerCard.position.set(0, 1.54, -1.24);
    this.add(centerCard);

    const leftCard = this.buildLeftWingCard();
    leftCard.position.set(-0.78, 1.52, -1.08);
    leftCard.rotation.y = 0.28;
    this.add(leftCard);

    const rightCard = this.buildRightWingCard();
    rightCard.position.set(0.78, 1.52, -1.08);
    rightCard.rotation.y = -0.28;
    this.add(rightCard);

    const navOverlay = this.buildBottomOverlay();
    this.add(navOverlay);
  }

  private createKpiTile(
    label: string,
    accentColor: string
  ): {panel: xb.UIPanel; valueText: xb.UIText} {
    const valueText = new xb.UIText({
      text: '0',
      style: {
        fontSize: 26,
        fontWeight: 'bold',
        color: accentColor,
      },
    });
    const panel = new xb.UIPanel({
      style: {
        flexGrow: 1,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 10,
        gap: 4,
        backgroundColor: THEME_COLORS.bgPanel,
        borderColor: 'rgba(59, 130, 246, 0.26)',
        borderWidth: 1.5,
        borderRadius: 14,
      },
      children: [
        new xb.UIText({
          text: label,
          style: {
            fontSize: 13,
            color: THEME_COLORS.textMuted,
            textAlign: 'center',
          },
        }),
        valueText,
      ],
    });
    return {panel, valueText};
  }

  private buildCenterCard(): xb.UICard {
    this.rulesSubtitle = new xb.UIText({
      text: '',
      style: {fontSize: 14, color: THEME_COLORS.accentBlueBright},
    });

    const header = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingBottom: 6,
      },
      children: [
        new xb.UIPanel({
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          },
          children: [
            new xb.UIIcon({
              icon: 'insights',
              style: {width: 34, height: 34, color: THEME_COLORS.accentGreen},
            }),
            new xb.UIPanel({
              style: {flexDirection: 'column', gap: 2},
              children: [
                new xb.UIText({
                  text: 'RAJA AI PREDICTOR',
                  style: {
                    fontSize: 24,
                    fontWeight: 'bold',
                    color: THEME_COLORS.textPrimary,
                  },
                }),
                this.rulesSubtitle,
              ],
            }),
          ],
        }),
        new xb.UIButton({
          label: 'Upload PDF',
          icon: 'upload_file',
          style: {
            backgroundColor: THEME_COLORS.accentGreen,
            color: '#04120e',
            borderRadius: 14,
          },
          onClick: () => this.modalManager.openPdfFilePicker(),
        }),
      ],
    });

    // Tab Navigation Row
    const tabRow = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        gap: 6,
      },
      children: TABS.map((t) => {
        const btn = new xb.UIButton({
          label: t.label,
          icon: t.icon,
          style: {
            flexGrow: 1,
            fontSize: 13,
            borderRadius: 12,
            backgroundColor: THEME_COLORS.bgPanelSoft,
          },
          onClick: () => this.switchTab(t.id),
        });
        this.tabButtons.set(t.id, btn);
        return btn;
      }),
    });

    // KPI Row
    const totalTile = this.createKpiTile('TOTAL RECORDS', THEME_COLORS.textPrimary);
    const bigTile = this.createKpiTile('BIG RESULTS', THEME_COLORS.accentGreenBright);
    const smallTile = this.createKpiTile('SMALL RESULTS', THEME_COLORS.accentBlueBright);
    const filesTile = this.createKpiTile('PDF SOURCES', THEME_COLORS.accentCyan);
    this.kpiTotalVal = totalTile.valueText;
    this.kpiBigVal = bigTile.valueText;
    this.kpiSmallVal = smallTile.valueText;
    this.kpiFilesVal = filesTile.valueText;

    const kpiRow = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        gap: 10,
      },
      children: [totalTile.panel, bigTile.panel, smallTile.panel, filesTile.panel],
    });

    // Main High-DPI Statistical Chart
    const mainChartImage = new xb.UIImage({
      src: this.mainChart.texture,
      ariaLabel: 'Statistical analytics chart',
      pointerEvents: 'none',
      style: {
        width: '100%',
        height: 215,
        objectFit: 'contain',
        borderRadius: 16,
      },
    });

    // Dynamic Tab Details Box
    this.centerSectionTitle = new xb.UIText({
      text: 'HOME DASHBOARD',
      style: {
        fontSize: 16,
        fontWeight: 'bold',
        color: THEME_COLORS.accentBlueBright,
      },
    });

    this.centerBodyText = new xb.UIText({
      text: '',
      style: {
        width: '100%',
        fontSize: 14,
        lineHeight: 1.38,
        color: THEME_COLORS.textPrimary,
        whiteSpace: 'pre-line',
      },
    });

    this.centerSecondaryText = new xb.UIText({
      text: '',
      style: {
        width: '100%',
        fontSize: 13,
        lineHeight: 1.35,
        color: THEME_COLORS.textMuted,
        whiteSpace: 'pre-line',
      },
    });

    const detailsBox = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'column',
        gap: 6,
        padding: 12,
        backgroundColor: THEME_COLORS.bgPanel,
        borderColor: 'rgba(59, 130, 246, 0.25)',
        borderWidth: 1,
        borderRadius: 14,
      },
      children: [
        this.centerSectionTitle,
        this.centerBodyText,
        this.centerSecondaryText,
      ],
    });

    // Contextual Action Row
    this.actionBtnA = new xb.UIButton({
      label: 'Upload PDFs',
      icon: 'upload_file',
      style: {flexGrow: 1, borderRadius: 12, backgroundColor: THEME_COLORS.accentBlue},
      onClick: () => this.actionHandlerA(),
    });
    this.actionBtnB = new xb.UIButton({
      label: 'Manual Entry',
      icon: 'edit_note',
      style: {flexGrow: 1, borderRadius: 12, backgroundColor: THEME_COLORS.bgPanelSoft},
      onClick: () => this.actionHandlerB(),
    });
    this.actionBtnC = new xb.UIButton({
      label: 'Export PDF',
      icon: 'picture_as_pdf',
      style: {flexGrow: 1, borderRadius: 12, backgroundColor: THEME_COLORS.accentGreen},
      onClick: () => this.actionHandlerC(),
    });

    this.centerActionRow = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 10},
      children: [this.actionBtnA, this.actionBtnB, this.actionBtnC],
    });

    this.statusBanner = new xb.UIText({
      text: 'Ready. Upload real PDF result files or add records manually.',
      style: {
        width: '100%',
        fontSize: 13,
        color: THEME_COLORS.accentGreenBright,
        textAlign: 'center',
      },
    });

    const card = new xb.UICard({
      size: {width: 0.94, height: 'auto'},
      manipulation: true,
      edge: true,
      style: {
        flexDirection: 'column',
        gap: 10,
        padding: 18,
        backgroundColor: THEME_COLORS.bgDeep,
        borderColor: 'rgba(59, 130, 246, 0.42)',
        borderWidth: 2,
        borderRadius: 24,
      },
      children: [
        header,
        tabRow,
        kpiRow,
        mainChartImage,
        detailsBox,
        this.centerActionRow,
        this.statusBanner,
      ],
    });
    card.name = 'RAJA Primary Dashboard';
    return card;
  }

  private buildLeftWingCard(): xb.UICard {
    this.leftWarningBadge = new xb.UIText({
      text: 'INSUFFICIENT DATA WARNING',
      style: {
        width: '100%',
        fontSize: 14,
        fontWeight: 'bold',
        color: THEME_COLORS.accentAmber,
        textAlign: 'center',
      },
    });

    this.leftBigStat = new xb.UIText({
      text: 'BIG: 0 (0.0%)',
      style: {
        fontSize: 18,
        fontWeight: 'bold',
        color: THEME_COLORS.accentGreenBright,
      },
    });

    this.leftSmallStat = new xb.UIText({
      text: 'SMALL: 0 (0.0%)',
      style: {
        fontSize: 18,
        fontWeight: 'bold',
        color: THEME_COLORS.accentBlueBright,
      },
    });

    this.leftStreakText = new xb.UIText({
      text: '',
      style: {
        width: '100%',
        fontSize: 14,
        lineHeight: 1.4,
        color: THEME_COLORS.textSecondary,
        whiteSpace: 'pre-line',
      },
    });

    this.leftEstimateText = new xb.UIText({
      text: '',
      style: {
        width: '100%',
        fontSize: 13,
        lineHeight: 1.38,
        color: THEME_COLORS.textPrimary,
        whiteSpace: 'pre-line',
      },
    });

    const card = new xb.UICard({
      size: {width: 0.52, height: 'auto'},
      manipulation: true,
      edge: true,
      style: {
        flexDirection: 'column',
        gap: 12,
        padding: 18,
        backgroundColor: THEME_COLORS.bgNavy,
        borderColor: 'rgba(16, 185, 129, 0.42)',
        borderWidth: 2,
        borderRadius: 22,
      },
      children: [
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          },
          children: [
            new xb.UIIcon({
              icon: 'analytics',
              style: {width: 28, height: 28, color: THEME_COLORS.accentGreen},
            }),
            new xb.UIText({
              text: 'BIG / SMALL ANALYSIS',
              style: {fontSize: 20, fontWeight: 'bold', color: THEME_COLORS.textPrimary},
            }),
          ],
        }),
        new xb.UIPanel({
          style: {
            width: '100%',
            padding: 10,
            borderRadius: 12,
            backgroundColor: 'rgba(245, 158, 11, 0.14)',
            borderColor: 'rgba(245, 158, 11, 0.4)',
            borderWidth: 1,
          },
          children: [this.leftWarningBadge],
        }),
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'column',
            gap: 6,
            padding: 12,
            borderRadius: 14,
            backgroundColor: THEME_COLORS.bgPanel,
          },
          children: [this.leftBigStat, this.leftSmallStat, this.leftStreakText],
        }),
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'column',
            gap: 6,
            padding: 12,
            borderRadius: 14,
            backgroundColor: THEME_COLORS.bgPanel,
          },
          children: [
            new xb.UIText({
              text: 'STATISTICAL ESTIMATE (NOT A GUARANTEE)',
              style: {
                fontSize: 13,
                fontWeight: 'bold',
                color: THEME_COLORS.accentBlueBright,
              },
            }),
            this.leftEstimateText,
            new xb.UIText({
              text: RANDOMNESS_DISCLAIMER,
              style: {
                fontSize: 12,
                lineHeight: 1.35,
                color: THEME_COLORS.textMuted,
              },
            }),
          ],
        }),
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 8},
          children: [
            new xb.UIButton({
              label: 'Configure Rules',
              icon: 'tune',
              style: {flexGrow: 1, borderRadius: 12},
              onClick: () => this.modalManager.openRulesModal(),
            }),
            new xb.UIButton({
              label: 'Inspect Tab',
              icon: 'open_in_new',
              style: {flexGrow: 1, borderRadius: 12},
              onClick: () => this.switchTab('bigsmall'),
            }),
          ],
        }),
      ],
    });
    card.name = 'Big Small Analytics Card';
    return card;
  }

  private buildRightWingCard(): xb.UICard {
    this.rightMostFreq = new xb.UIText({
      text: 'Most Frequent: —',
      style: {
        fontSize: 16,
        fontWeight: 'bold',
        color: THEME_COLORS.accentGreenBright,
      },
    });
    this.rightLeastFreq = new xb.UIText({
      text: 'Least Frequent: —',
      style: {
        fontSize: 16,
        fontWeight: 'bold',
        color: THEME_COLORS.accentBlueBright,
      },
    });
    this.rightOddEven = new xb.UIText({
      text: 'Odd: 0 (0.0%)  •  Even: 0 (0.0%)',
      style: {fontSize: 14, color: THEME_COLORS.textSecondary},
    });
    this.rightSummaryLine = new xb.UIText({
      text: '',
      style: {
        width: '100%',
        fontSize: 13,
        lineHeight: 1.35,
        color: THEME_COLORS.textMuted,
        whiteSpace: 'pre-line',
      },
    });

    const sideChartImg = new xb.UIImage({
      src: this.sideChart.texture,
      ariaLabel: 'Number frequency distribution chart',
      pointerEvents: 'none',
      style: {
        width: '100%',
        height: 168,
        objectFit: 'contain',
        borderRadius: 14,
      },
    });

    const card = new xb.UICard({
      size: {width: 0.52, height: 'auto'},
      manipulation: true,
      edge: true,
      style: {
        flexDirection: 'column',
        gap: 12,
        padding: 18,
        backgroundColor: THEME_COLORS.bgNavy,
        borderColor: 'rgba(59, 130, 246, 0.42)',
        borderWidth: 2,
        borderRadius: 22,
      },
      children: [
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          },
          children: [
            new xb.UIIcon({
              icon: 'bar_chart',
              style: {width: 28, height: 28, color: THEME_COLORS.accentBlueBright},
            }),
            new xb.UIText({
              text: 'NUMBER ANALYSIS & REPORTS',
              style: {fontSize: 19, fontWeight: 'bold', color: THEME_COLORS.textPrimary},
            }),
          ],
        }),
        sideChartImg,
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'column',
            gap: 6,
            padding: 12,
            borderRadius: 14,
            backgroundColor: THEME_COLORS.bgPanel,
          },
          children: [
            this.rightMostFreq,
            this.rightLeastFreq,
            this.rightOddEven,
            this.rightSummaryLine,
          ],
        }),
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 8},
          children: [
            new xb.UIButton({
              label: 'Export PDF',
              icon: 'picture_as_pdf',
              style: {
                flexGrow: 1,
                borderRadius: 12,
                backgroundColor: THEME_COLORS.accentGreen,
                color: '#04120e',
              },
              onClick: () => this.handleExportPdf(),
            }),
            new xb.UIButton({
              label: 'Export CSV',
              icon: 'table_view',
              style: {
                flexGrow: 1,
                borderRadius: 12,
                backgroundColor: THEME_COLORS.accentBlue,
              },
              onClick: () => this.handleExportCsv(),
            }),
          ],
        }),
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 8},
          children: [
            new xb.UIButton({
              label: 'Search History',
              icon: 'search',
              style: {flexGrow: 1, borderRadius: 12},
              onClick: () => this.modalManager.openHistoryManager(),
            }),
            new xb.UIButton({
              label: 'Add Record',
              icon: 'add_circle',
              style: {flexGrow: 1, borderRadius: 12},
              onClick: () => this.modalManager.openRecordEditor(),
            }),
          ],
        }),
      ],
    });
    card.name = 'Number Analysis & Export Card';
    return card;
  }

  private buildBottomOverlay(): xb.UIOverlay {
    const navButtons = TABS.map((t) => {
      const btn = new xb.UIButton({
        label: t.label,
        icon: t.icon,
        style: {borderRadius: 12, fontSize: 13},
        onClick: () => this.switchTab(t.id),
      });
      this.overlayTabButtons.set(t.id, btn);
      return btn;
    });

    const overlay = new xb.UIOverlay({
      style: {
        width: 840,
        position: 'absolute',
        left: '50%',
        bottom: 20,
        transform: {translateX: '-50%'},
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 10,
        backgroundColor: 'rgba(7, 13, 29, 0.92)',
        borderColor: 'rgba(59, 130, 246, 0.4)',
        borderWidth: 1.5,
        borderRadius: 18,
      },
      children: [
        ...navButtons,
        new xb.UIButton({
          label: 'Upload PDF',
          icon: 'upload_file',
          style: {
            borderRadius: 12,
            backgroundColor: THEME_COLORS.accentGreen,
            color: '#04120e',
          },
          onClick: () => this.modalManager.openScannerHub(),
        }),
        new xb.UIExitButton(),
      ],
    });
    overlay.name = 'RAJA Bottom Navigation';
    return overlay;
  }

  private switchTab(tab: AppTab): void {
    this.activeTab = tab;
    this.refreshAllViews();
  }

  private setStatus(message: string, color: string): void {
    this.statusBanner.text = message;
    this.statusBanner.style.color = color;
  }

  private handleExportPdf(): void {
    if (this.records.length === 0) {
      this.setStatus(
        'No records to export yet. Upload PDF files or add records first.',
        THEME_COLORS.accentAmber
      );
      return;
    }
    const fileName = exportPdfReport(this.records, this.rules, this.analytics);
    this.setStatus(`Generated downloadable PDF report: ${fileName}`, '#34d399');
  }

  private handleExportCsv(): void {
    if (this.records.length === 0) {
      this.setStatus(
        'No records to export yet. Upload PDF files or add records first.',
        THEME_COLORS.accentAmber
      );
      return;
    }
    const fileName = exportCsvReport(this.records, this.rules);
    this.setStatus(`Exported CSV report: ${fileName}`, '#60a5fa');
  }

  private refreshAllViews(): void {
    this.analytics = computeAnalytics(this.records, this.rules);
    const a = this.analytics;

    // Highlight active tab buttons
    for (const tab of TABS) {
      const isActive = tab.id === this.activeTab;
      const centerBtn = this.tabButtons.get(tab.id);
      if (centerBtn) {
        centerBtn.style.backgroundColor = isActive
          ? THEME_COLORS.accentBlue
          : THEME_COLORS.bgPanelSoft;
      }
      const dockBtn = this.overlayTabButtons.get(tab.id);
      if (dockBtn) {
        dockBtn.style.backgroundColor = isActive
          ? THEME_COLORS.accentBlue
          : 'rgba(20, 34, 66, 0.72)';
      }
    }

    // Header & KPI values
    this.rulesSubtitle.text = `Rules: ${this.rules.minNumber}–${this.rules.maxNumber} • Big >= ${this.rules.bigThreshold} • Small < ${this.rules.bigThreshold}`;
    this.kpiTotalVal.text = String(a.totalRecords);
    this.kpiBigVal.text = `${a.bigCount} (${a.bigPct.toFixed(0)}%)`;
    this.kpiSmallVal.text = `${a.smallCount} (${a.smallPct.toFixed(0)}%)`;
    this.kpiFilesVal.text = String(a.uniqueFiles);

    // Update 3D Holographic Stage
    this.stage3D.syncData(a, this.rules);

    // Update Left Wing Card
    if (a.totalRecords === 0) {
      this.leftWarningBadge.text = `INSUFFICIENT DATA: 0 / ${this.rules.minSampleWarning} MIN RECORDS`;
      this.leftWarningBadge.style.color = THEME_COLORS.accentAmber;
    } else if (a.insufficientData) {
      this.leftWarningBadge.text = `INSUFFICIENT DATA WARNING: ${a.totalRecords} / ${this.rules.minSampleWarning} MIN RECORDS`;
      this.leftWarningBadge.style.color = THEME_COLORS.accentAmber;
    } else {
      this.leftWarningBadge.text = `SAMPLE SIZE OK (${a.totalRecords} RECORDS) • DESCRIPTIVE ONLY`;
      this.leftWarningBadge.style.color = THEME_COLORS.accentGreenBright;
    }

    this.leftBigStat.text = `BIG (>= ${this.rules.bigThreshold}): ${a.bigCount} (${a.bigPct.toFixed(1)}%)`;
    this.leftSmallStat.text = `SMALL (< ${this.rules.bigThreshold}): ${a.smallCount} (${a.smallPct.toFixed(1)}%)`;
    this.leftStreakText.text =
      `Current Streak: ${a.streaks.currentType} (${a.streaks.currentLength})\n` +
      `Longest Big: ${a.streaks.longestBig}  |  Longest Small: ${a.streaks.longestSmall}\n` +
      `Alternation Rate: ${(a.streaks.alternationRate * 100).toFixed(1)}%\n` +
      `Recent Pattern: ${a.recentPattern}`;
    this.leftEstimateText.text = a.estimateSummary;

    // Update Right Wing Card
    const mostLabel =
      a.mostFrequent.length > 0
        ? a.mostFrequent
            .map((f) => `${f.value} (${f.count}x)`)
            .slice(0, 3)
            .join(', ')
        : '—';
    const leastLabel =
      a.leastFrequent.length > 0
        ? a.leastFrequent
            .map((f) => `${f.value} (${f.count}x)`)
            .slice(0, 3)
            .join(', ')
        : '—';
    this.rightMostFreq.text = `Most Frequent: ${mostLabel}`;
    this.rightLeastFreq.text = `Least Frequent: ${leastLabel}`;
    this.rightOddEven.text = `Odd: ${a.oddCount} (${a.oddPct.toFixed(1)}%)  •  Even: ${a.evenCount} (${a.evenPct.toFixed(1)}%)`;
    this.rightSummaryLine.text =
      a.totalRecords > 0
        ? a.frequencies
            .map((f) => `${f.value}:${f.count}`)
            .join('  ')
        : 'Import real PDF records to populate frequency distribution.';

    this.sideChart.renderNumberDistribution(a, this.rules);

    // Update Center Tab View & Main Chart
    this.renderActiveCenterTab();
  }

  private renderActiveCenterTab(): void {
    const a = this.analytics;

    switch (this.activeTab) {
      case 'dashboard': {
        this.mainChart.renderDashboardOverview(a, this.rules);
        this.centerSectionTitle.text = 'HOME DASHBOARD — LATEST HISTORICAL RESULTS';
        if (a.latestRecords.length === 0) {
          this.centerBodyText.text =
            'No historical records imported yet.\nUpload PDF files from storage or add records manually. No fabricated results are ever shown.';
        } else {
          this.centerBodyText.text = a.latestRecords
            .slice(0, 5)
            .map((r) => {
              const cat = classifyBigSmall(r.result, this.rules);
              return `${r.date}  |  Round ${r.round}  |  Result: ${r.result} (${cat})  [${r.sourceFile}]`;
            })
            .join('\n');
        }
        this.centerSecondaryText.text = a.statisticalNote;
        this.configureActionButtons(
          'Upload PDFs',
          'upload_file',
          () => this.modalManager.openScannerHub(),
          'Add Record',
          'add_circle',
          () => this.modalManager.openRecordEditor(),
          'Export PDF Report',
          'picture_as_pdf',
          () => this.handleExportPdf()
        );
        break;
      }

      case 'scanner': {
        this.mainChart.renderDashboardOverview(a, this.rules);
        this.centerSectionTitle.text = 'PDF UPLOAD SCANNER (TEXT EXTRACTION + OCR)';
        this.centerBodyText.text =
          `${this.lastScanReport}\n` +
          `Supports uploading multiple PDF files at once, automatic Date / Round / Result extraction, OCR fallback for scanned PDFs, duplicate detection, and inline manual correction before saving.`;
        this.centerSecondaryText.text = `Stored permanently on device: ${this.records.length} record(s) across ${a.uniqueFiles} file(s).`;
        this.configureActionButtons(
          'Select PDF Files',
          'upload_file',
          () => this.modalManager.openPdfFilePicker(),
          'Open Scanner Hub',
          'document_scanner',
          () => this.modalManager.openScannerHub(),
          'Download Format PDF',
          'download',
          () => {
            const name = downloadBlankFormatPdfTemplate(this.rules);
            this.setStatus(`Downloaded format template: ${name}`, '#60a5fa');
          }
        );
        break;
      }

      case 'bigsmall': {
        this.mainChart.renderBigSmallAnalysis(a);
        this.centerSectionTitle.text = 'BIG / SMALL STATISTICAL ANALYSIS';
        this.centerBodyText.text =
          `Big (>= ${this.rules.bigThreshold}): ${a.bigCount} (${a.bigPct.toFixed(1)}%)   •   Small (< ${this.rules.bigThreshold}): ${a.smallCount} (${a.smallPct.toFixed(1)}%)\n` +
          `Current Streak: ${a.streaks.currentType} (${a.streaks.currentLength})  •  Max Big Streak: ${a.streaks.longestBig}  •  Max Small Streak: ${a.streaks.longestSmall}\n` +
          `Recent Sequence: ${a.recentPattern}`;
        this.centerSecondaryText.text = `${a.estimateSummary}\n${a.statisticalNote}`;
        this.configureActionButtons(
          'Edit Game Rules',
          'tune',
          () => this.modalManager.openRulesModal(),
          'Upload More PDFs',
          'upload_file',
          () => this.modalManager.openPdfFilePicker(),
          'Export PDF Report',
          'picture_as_pdf',
          () => this.handleExportPdf()
        );
        break;
      }

      case 'numbers': {
        this.mainChart.renderNumberDistribution(a, this.rules);
        this.centerSectionTitle.text = 'NUMBER FREQUENCY & PARITY BREAKDOWN';
        const rows = a.frequencies.map(
          (f) => `#${f.value}: ${f.count} (${f.percentage.toFixed(1)}%)`
        );
        const half = Math.ceil(rows.length / 2);
        this.centerBodyText.text =
          `${rows.slice(0, half).join('   ')}\n` +
          `${rows.slice(half).join('   ')}\n` +
          `Odd: ${a.oddCount} (${a.oddPct.toFixed(1)}%)   •   Even: ${a.evenCount} (${a.evenPct.toFixed(1)}%)`;
        this.centerSecondaryText.text =
          a.totalRecords > 0
            ? `Most Frequent: ${a.mostFrequent.map((f) => f.value).join(', ')}  |  Least Frequent: ${a.leastFrequent.map((f) => f.value).join(', ')}. Past frequencies do not guarantee future draws.`
            : 'No number data imported yet. Upload PDF files to inspect per-number frequencies.';
        this.configureActionButtons(
          'Edit Number Range',
          'tune',
          () => this.modalManager.openRulesModal(),
          'Filter in History',
          'filter_list',
          () => this.modalManager.openHistoryManager(),
          'Export CSV',
          'table_view',
          () => this.handleExportCsv()
        );
        break;
      }

      case 'history': {
        this.mainChart.renderDashboardOverview(a, this.rules);
        const filtered = filterHistoryRecords(
          this.records,
          this.historyFilter,
          this.rules
        );
        const activeFilterDesc = [
          this.historyFilter.query ? `Query "${this.historyFilter.query}"` : null,
          this.historyFilter.category !== 'ALL'
            ? `Class ${this.historyFilter.category}`
            : null,
          this.historyFilter.numberFilter !== 'ALL'
            ? `Num ${this.historyFilter.numberFilter}`
            : null,
        ]
          .filter(Boolean)
          .join(' • ');

        this.centerSectionTitle.text = `HISTORY LEDGER (${filtered.length} / ${this.records.length} SHOWN)`;
        if (filtered.length === 0) {
          this.centerBodyText.text =
            this.records.length === 0
              ? 'Permanent history is currently empty. Upload PDF files or add records manually.'
              : `No records match active filter (${activeFilterDesc}).`;
        } else {
          this.centerBodyText.text = filtered
            .slice(0, 6)
            .map((r) => {
              const cat = classifyBigSmall(r.result, this.rules);
              return `${r.date}  |  #${r.round}  |  Result ${r.result} (${cat})  |  ${r.sourceFile}`;
            })
            .join('\n');
        }
        this.centerSecondaryText.text = activeFilterDesc
          ? `Active filters: ${activeFilterDesc}`
          : 'Use Search & Filter to filter by Date, Round, Big, Small, or specific Number, or edit/delete entries.';
        this.configureActionButtons(
          'Search / Filter / Edit',
          'search',
          () => this.modalManager.openHistoryManager(),
          'Add Record',
          'add_circle',
          () => this.modalManager.openRecordEditor(),
          'Clear All History',
          'delete_sweep',
          () => {
            if (this.records.length === 0) {
              this.setStatus('History is already empty.', THEME_COLORS.textMuted);
              return;
            }
            this.records = clearAllRecordsFromStore();
            this.historyFilter = {query: '', category: 'ALL', numberFilter: 'ALL'};
            this.setStatus('Cleared all saved records from local storage.', '#f59e0b');
            this.refreshAllViews();
          }
        );
        break;
      }

      case 'reports': {
        this.mainChart.renderNumberDistribution(a, this.rules);
        this.centerSectionTitle.text = 'DOWNLOADABLE PDF & CSV REPORTS';
        this.centerBodyText.text =
          `Ready to export ${this.records.length} permanently stored record(s).\n` +
          `• PDF Report: Includes overview metrics, Big/Small & Odd/Even statistics, streak profile, number frequency table, randomness disclaimer, and historical ledger.\n` +
          `• CSV Report: Raw spreadsheet export with Date, Round, Result, Big/Small, Parity, and Source PDF columns.`;
        this.centerSecondaryText.text = RANDOMNESS_DISCLAIMER;
        this.configureActionButtons(
          'Download PDF Report',
          'picture_as_pdf',
          () => this.handleExportPdf(),
          'Export CSV Report',
          'table_view',
          () => this.handleExportCsv(),
          'Upload More PDFs',
          'upload_file',
          () => this.modalManager.openPdfFilePicker()
        );
        break;
      }
    }
  }

  private configureActionButtons(
    labelA: string,
    iconA: string,
    fnA: () => void,
    labelB: string,
    iconB: string,
    fnB: () => void,
    labelC: string,
    iconC: string,
    fnC: () => void
  ): void {
    this.actionBtnA.label = labelA;
    this.actionBtnA.icon = iconA;
    this.actionHandlerA = fnA;

    this.actionBtnB.label = labelB;
    this.actionBtnB.icon = iconB;
    this.actionHandlerB = fnB;

    this.actionBtnC.label = labelC;
    this.actionBtnC.icon = iconC;
    this.actionHandlerC = fnC;
  }

  update(): void {
    const delta = xb.getDeltaTime();
    this.stage3D?.animate(delta);
  }

  dispose(): void {
    this.modalManager?.dispose();
    this.stage3D?.dispose();
    this.mainChart?.dispose();
    this.sideChart?.dispose();
    this.envRenderTarget?.dispose();
  }
}
