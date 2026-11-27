import * as THREE from 'three';
import {THEME_COLORS} from '../constants.ts';
import type {AnalyticsSnapshot, GameRules} from '../types.ts';

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export class AnalyticsChartTexture {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;

  constructor(width = 1024, height = 380) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Could not initialize 2D chart canvas context.');
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
  }

  private clearBackground(title: string, subtitle?: string): void {
    const {ctx, canvas} = this;
    const {width, height} = canvas;

    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#070d1d');
    grad.addColorStop(1, '#0c1730');
    ctx.fillStyle = grad;
    drawRoundedRect(ctx, 0, 0, width, height, 24);
    ctx.fill();

    ctx.strokeStyle = 'rgba(59, 130, 246, 0.35)';
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, 1, 1, width - 2, height - 2, 24);
    ctx.stroke();

    ctx.fillStyle = THEME_COLORS.textPrimary;
    ctx.font = '700 26px "Google Sans", "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(title, 28, 22);

    if (subtitle) {
      ctx.fillStyle = THEME_COLORS.textMuted;
      ctx.font = '500 18px "Google Sans", "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(subtitle, width - 28, 26);
    }
  }

  private drawEmptyState(message: string): void {
    const {ctx, canvas} = this;
    ctx.fillStyle = 'rgba(30, 41, 59, 0.45)';
    drawRoundedRect(ctx, 28, 72, canvas.width - 56, canvas.height - 100, 16);
    ctx.fill();

    ctx.strokeStyle = 'rgba(59, 130, 246, 0.35)';
    ctx.setLineDash([8, 8]);
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, 28, 72, canvas.width - 56, canvas.height - 100, 16);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = THEME_COLORS.textSecondary;
    ctx.font = '600 22px "Google Sans", "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, canvas.width / 2, canvas.height / 2 + 10);

    ctx.fillStyle = THEME_COLORS.textMuted;
    ctx.font = '400 17px "Google Sans", "Segoe UI", Roboto, sans-serif';
    ctx.fillText(
      'Upload real PDF result sheets or add records manually — zero fabricated data.',
      canvas.width / 2,
      canvas.height / 2 + 44
    );
  }

  renderDashboardOverview(
    analytics: AnalyticsSnapshot,
    rules: GameRules
  ): void {
    this.clearBackground(
      'HISTORICAL DISTRIBUTION OVERVIEW',
      `Range ${rules.minNumber}–${rules.maxNumber} • Big >= ${rules.bigThreshold}`
    );

    if (analytics.totalRecords === 0) {
      this.drawEmptyState('Awaiting Imported PDF Records');
      this.texture.needsUpdate = true;
      return;
    }

    const {ctx, canvas} = this;
    const {width, height} = canvas;

    // Left: Big vs Small ratio bar
    const barX = 28;
    const barY = 74;
    const barW = width - 56;
    const barH = 34;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    drawRoundedRect(ctx, barX, barY, barW, barH, 12);
    ctx.fill();

    const bigW = Math.max(0, (analytics.bigPct / 100) * barW);
    if (bigW > 2) {
      const bigGrad = ctx.createLinearGradient(barX, 0, barX + bigW, 0);
      bigGrad.addColorStop(0, '#059669');
      bigGrad.addColorStop(1, '#10b981');
      ctx.fillStyle = bigGrad;
      drawRoundedRect(ctx, barX, barY, bigW, barH, 12);
      ctx.fill();
    }
    if (barW - bigW > 2) {
      const smallGrad = ctx.createLinearGradient(barX + bigW, 0, barX + barW, 0);
      smallGrad.addColorStop(0, '#2563eb');
      smallGrad.addColorStop(1, '#3b82f6');
      ctx.fillStyle = smallGrad;
      drawRoundedRect(ctx, barX + bigW, barY, barW - bigW, barH, 12);
      ctx.fill();
    }

    ctx.font = '700 18px "Google Sans", Roboto, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(
      `BIG ${analytics.bigPct.toFixed(1)}% (${analytics.bigCount})`,
      barX + 14,
      barY + barH / 2
    );
    ctx.textAlign = 'right';
    ctx.fillText(
      `SMALL ${analytics.smallPct.toFixed(1)}% (${analytics.smallCount})`,
      barX + barW - 14,
      barY + barH / 2
    );

    // Bottom: Number Frequency Bars
    this.drawFrequencyBars(
      analytics,
      28,
      132,
      width - 56,
      height - 156,
      true
    );

    this.texture.needsUpdate = true;
  }

  renderBigSmallAnalysis(analytics: AnalyticsSnapshot): void {
    this.clearBackground(
      'BIG / SMALL SHARE & STREAK PROFILE',
      `${analytics.totalRecords} records`
    );

    if (analytics.totalRecords === 0) {
      this.drawEmptyState('No Big / Small Records Imported');
      this.texture.needsUpdate = true;
      return;
    }

    const {ctx, canvas} = this;
    const cx = 195;
    const cy = canvas.height / 2 + 22;
    const outerR = 112;
    const innerR = 68;

    const bigAngle = (analytics.bigPct / 100) * Math.PI * 2;
    const startAngle = -Math.PI / 2;

    // Small Arc
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, startAngle + bigAngle, startAngle + Math.PI * 2);
    ctx.arc(
      cx,
      cy,
      innerR,
      startAngle + Math.PI * 2,
      startAngle + bigAngle,
      true
    );
    ctx.closePath();
    ctx.fillStyle = THEME_COLORS.accentBlue;
    ctx.fill();

    // Big Arc
    if (bigAngle > 0.001) {
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, startAngle, startAngle + bigAngle);
      ctx.arc(cx, cy, innerR, startAngle + bigAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = THEME_COLORS.accentGreen;
      ctx.fill();
    }

    ctx.fillStyle = THEME_COLORS.textPrimary;
    ctx.font = '700 28px "Google Sans", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(analytics.totalRecords), cx, cy - 10);
    ctx.fillStyle = THEME_COLORS.textMuted;
    ctx.font = '600 15px "Google Sans", Roboto, sans-serif';
    ctx.fillText('TOTAL', cx, cy + 16);

    // Right side: Streak & Pattern bars
    const rightX = 365;
    const rightW = canvas.width - rightX - 32;

    const metrics = [
      {
        label: 'Big Frequency',
        value: `${analytics.bigCount} (${analytics.bigPct.toFixed(1)}%)`,
        pct: analytics.bigPct / 100,
        color: THEME_COLORS.accentGreen,
      },
      {
        label: 'Small Frequency',
        value: `${analytics.smallCount} (${analytics.smallPct.toFixed(1)}%)`,
        pct: analytics.smallPct / 100,
        color: THEME_COLORS.accentBlue,
      },
      {
        label: 'Alternation Rate',
        value: `${(analytics.streaks.alternationRate * 100).toFixed(1)}%`,
        pct: analytics.streaks.alternationRate,
        color: THEME_COLORS.accentCyan,
      },
    ];

    metrics.forEach((m, i) => {
      const y = 84 + i * 74;
      ctx.fillStyle = THEME_COLORS.textSecondary;
      ctx.font = '600 18px "Google Sans", Roboto, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(m.label, rightX, y);

      ctx.fillStyle = THEME_COLORS.textPrimary;
      ctx.font = '700 18px "Google Sans", Roboto, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(m.value, rightX + rightW, y);

      ctx.fillStyle = 'rgba(30, 41, 59, 0.85)';
      drawRoundedRect(ctx, rightX, y + 28, rightW, 20, 10);
      ctx.fill();

      const fillW = Math.max(8, rightW * Math.min(1, Math.max(0, m.pct)));
      ctx.fillStyle = m.color;
      drawRoundedRect(ctx, rightX, y + 28, fillW, 20, 10);
      ctx.fill();
    });

    // Recent Pattern pills
    const patY = 308;
    ctx.fillStyle = THEME_COLORS.textMuted;
    ctx.font = '600 16px "Google Sans", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('RECENT:', rightX, patY + 14);

    const tokens =
      analytics.recentPattern === 'No data'
        ? []
        : analytics.recentPattern.split(' ');
    tokens.slice(-12).forEach((tok, idx) => {
      const px = rightX + 86 + idx * 42;
      ctx.fillStyle =
        tok === 'B' ? THEME_COLORS.accentGreen : THEME_COLORS.accentBlue;
      drawRoundedRect(ctx, px, patY, 34, 28, 8);
      ctx.fill();
      ctx.fillStyle = '#041019';
      ctx.font = '700 17px "Google Sans", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(tok, px + 17, patY + 14);
    });

    this.texture.needsUpdate = true;
  }

  renderNumberDistribution(
    analytics: AnalyticsSnapshot,
    rules: GameRules
  ): void {
    this.clearBackground(
      'NUMBER FREQUENCY & ODD/EVEN CHART',
      `Odd ${analytics.oddPct.toFixed(1)}% • Even ${analytics.evenPct.toFixed(1)}%`
    );

    if (analytics.totalRecords === 0) {
      this.drawEmptyState(`No Numbers Imported (Range ${rules.minNumber}–${rules.maxNumber})`);
      this.texture.needsUpdate = true;
      return;
    }

    this.drawFrequencyBars(
      analytics,
      28,
      78,
      this.canvas.width - 56,
      this.canvas.height - 104,
      true
    );
    this.texture.needsUpdate = true;
  }

  private drawFrequencyBars(
    analytics: AnalyticsSnapshot,
    x: number,
    y: number,
    w: number,
    h: number,
    showCounts: boolean
  ): void {
    const {ctx} = this;
    const freqs = analytics.frequencies;
    if (freqs.length === 0) return;

    const maxCount = Math.max(1, ...freqs.map((f) => f.count));
    const mostSet = new Set(analytics.mostFrequent.map((f) => f.value));
    const chartBottom = y + h - 34;
    const chartTop = y + 26;
    const usableH = Math.max(30, chartBottom - chartTop);

    // Subtle horizontal gridlines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    for (let step = 0; step <= 3; step++) {
      const gy = chartTop + (usableH * step) / 3;
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x + w, gy);
      ctx.stroke();
    }

    const gap = Math.max(6, Math.min(18, Math.floor(w / (freqs.length * 4))));
    const barW = Math.max(10, (w - gap * (freqs.length - 1)) / freqs.length);

    freqs.forEach((item, idx) => {
      const bx = x + idx * (barW + gap);
      const ratio = item.count / maxCount;
      const bh = Math.max(item.count > 0 ? 10 : 4, ratio * usableH);
      const by = chartBottom - bh;

      const isBig = item.category === 'BIG';
      const isTop = mostSet.has(item.value) && item.count > 0;

      const grad = ctx.createLinearGradient(bx, by, bx, chartBottom);
      if (isBig) {
        grad.addColorStop(0, isTop ? '#34d399' : '#10b981');
        grad.addColorStop(1, '#064e3b');
      } else {
        grad.addColorStop(0, isTop ? '#60a5fa' : '#3b82f6');
        grad.addColorStop(1, '#1e3a8a');
      }

      ctx.fillStyle = item.count > 0 ? grad : 'rgba(51, 65, 85, 0.45)';
      drawRoundedRect(ctx, bx, by, barW, bh, 8);
      ctx.fill();

      if (isTop) {
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 2;
        drawRoundedRect(ctx, bx, by, barW, bh, 8);
        ctx.stroke();
      }

      if (showCounts && freqs.length <= 24) {
        ctx.fillStyle =
          item.count > 0 ? THEME_COLORS.textPrimary : THEME_COLORS.textMuted;
        ctx.font = '700 16px "Google Sans", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(String(item.count), bx + barW / 2, by - 5);
      }

      // X-axis number label
      ctx.fillStyle = isBig
        ? THEME_COLORS.accentGreenBright
        : THEME_COLORS.accentBlueBright;
      ctx.font = '700 18px "Google Sans", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(String(item.value), bx + barW / 2, chartBottom + 8);
    });
  }

  dispose(): void {
    this.texture.dispose();
  }
}
