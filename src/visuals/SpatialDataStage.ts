import * as THREE from 'three';
import type {AnalyticsSnapshot, GameRules} from '../types.ts';

interface BarSlot {
  mesh: THREE.Mesh;
  cap: THREE.Mesh;
  targetHeight: number;
  currentHeight: number;
}

/**
 * Composite 3D Holographic Analytics Pedestal (multi-part PBR assembly)
 * displaying real-time 3D number frequency columns and Big/Small glass ratio towers.
 */
export class SpatialDataStage extends THREE.Group {
  private baseGroup: THREE.Group;
  private barGroup: THREE.Group;
  private orbitRing: THREE.Mesh;
  private bigFillMesh: THREE.Mesh;
  private smallFillMesh: THREE.Mesh;

  private bigTargetHeight = 0.02;
  private smallTargetHeight = 0.02;
  private bigCurrentHeight = 0.02;
  private smallCurrentHeight = 0.02;

  private bars: BarSlot[] = [];
  private disposableGeometries: THREE.BufferGeometry[] = [];
  private disposableMaterials: THREE.Material[] = [];

  private bigMat: THREE.MeshStandardMaterial;
  private smallMat: THREE.MeshStandardMaterial;
  private topHighlightMat: THREE.MeshStandardMaterial;
  private barCapMat: THREE.MeshStandardMaterial;
  private barGeo: THREE.BoxGeometry;
  private capGeo: THREE.BoxGeometry;

  constructor() {
    super();
    this.name = 'RAJA 3D Analytics Stage';
    this.baseGroup = new THREE.Group();
    this.barGroup = new THREE.Group();
    this.add(this.baseGroup, this.barGroup);

    // Shared bar materials
    this.bigMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x047857,
      emissiveIntensity: 0.45,
      roughness: 0.25,
      metalness: 0.35,
    });
    this.smallMat = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      emissive: 0x1d4ed8,
      emissiveIntensity: 0.45,
      roughness: 0.25,
      metalness: 0.35,
    });
    this.topHighlightMat = new THREE.MeshStandardMaterial({
      color: 0x34d399,
      emissive: 0x10b981,
      emissiveIntensity: 0.85,
      roughness: 0.15,
      metalness: 0.6,
    });
    this.barCapMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      emissive: 0x60a5fa,
      emissiveIntensity: 0.35,
      roughness: 0.15,
      metalness: 0.85,
    });

    this.barGeo = new THREE.BoxGeometry(1, 1, 1);
    this.capGeo = new THREE.BoxGeometry(1.06, 0.008, 1.06);
    this.disposableGeometries.push(this.barGeo, this.capGeo);
    this.disposableMaterials.push(
      this.bigMat,
      this.smallMat,
      this.topHighlightMat,
      this.barCapMat
    );

    // 1. Primary Plinth Base (multi-tier obsidian & brushed titanium)
    const obsidianMat = new THREE.MeshStandardMaterial({
      color: 0x070d1c,
      roughness: 0.52,
      metalness: 0.35,
    });
    const brushedNavyMat = new THREE.MeshStandardMaterial({
      color: 0x101d3a,
      roughness: 0.22,
      metalness: 0.82,
    });
    const cyanTrimMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.8,
      roughness: 0.2,
      metalness: 0.6,
    });
    const emeraldTrimMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x059669,
      emissiveIntensity: 0.85,
      roughness: 0.2,
      metalness: 0.6,
    });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x93c5fd,
      roughness: 0.1,
      metalness: 0.05,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      clearcoat: 1.0,
    });
    this.disposableMaterials.push(
      obsidianMat,
      brushedNavyMat,
      cyanTrimMat,
      emeraldTrimMat,
      glassMat
    );

    // Tier 1 wide foundation
    const tier1Geo = new THREE.CylinderGeometry(0.42, 0.46, 0.036, 48);
    const tier1 = new THREE.Mesh(tier1Geo, obsidianMat);
    tier1.position.y = 0.018;
    tier1.receiveShadow = true;

    // Tier 2 metallic deck
    const tier2Geo = new THREE.CylinderGeometry(0.37, 0.4, 0.024, 48);
    const tier2 = new THREE.Mesh(tier2Geo, brushedNavyMat);
    tier2.position.y = 0.048;
    tier2.receiveShadow = true;

    // Luminous trim ring around tier 2
    const rimGeo = new THREE.TorusGeometry(0.388, 0.005, 16, 64);
    const rimMesh = new THREE.Mesh(rimGeo, cyanTrimMat);
    rimMesh.rotation.x = Math.PI / 2;
    rimMesh.position.y = 0.058;

    // Central raised analytics deck
    const deckGeo = new THREE.BoxGeometry(0.48, 0.016, 0.16);
    const deckMesh = new THREE.Mesh(deckGeo, obsidianMat);
    deckMesh.position.set(0, 0.068, 0.02);

    // Grid accent strip on deck (polygonOffset to prevent Z-fighting)
    const deckTrimMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a8a,
      emissive: 0x1d4ed8,
      emissiveIntensity: 0.4,
      roughness: 0.35,
      metalness: 0.5,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.disposableMaterials.push(deckTrimMat);
    const deckAccentGeo = new THREE.PlaneGeometry(0.45, 0.13);
    const deckAccent = new THREE.Mesh(deckAccentGeo, deckTrimMat);
    deckAccent.rotation.x = -Math.PI / 2;
    deckAccent.position.set(0, 0.077, 0.02);

    // Orbiting fine telemetry ring
    const orbitGeo = new THREE.TorusGeometry(0.43, 0.0028, 12, 80);
    this.orbitRing = new THREE.Mesh(orbitGeo, emeraldTrimMat);
    this.orbitRing.rotation.x = Math.PI / 2;
    this.orbitRing.position.y = 0.09;

    // Flanking Glass Ratio Pillars (Left = BIG emerald, Right = SMALL blue)
    const collarGeo = new THREE.CylinderGeometry(0.055, 0.064, 0.022, 28);
    const glassShellGeo = new THREE.CylinderGeometry(0.046, 0.046, 0.28, 28, 1, true);
    const coreGeo = new THREE.CylinderGeometry(0.032, 0.032, 1, 24);
    const capRingGeo = new THREE.TorusGeometry(0.046, 0.004, 12, 32);

    // Left BIG Pillar
    const bigCollar = new THREE.Mesh(collarGeo, brushedNavyMat);
    bigCollar.position.set(-0.31, 0.071, -0.04);
    const bigShell = new THREE.Mesh(glassShellGeo, glassMat);
    bigShell.position.set(-0.31, 0.222, -0.04);
    bigShell.renderOrder = 3;
    const bigTopRing = new THREE.Mesh(capRingGeo, emeraldTrimMat);
    bigTopRing.rotation.x = Math.PI / 2;
    bigTopRing.position.set(-0.31, 0.362, -0.04);
    this.bigFillMesh = new THREE.Mesh(coreGeo, this.bigMat);
    this.bigFillMesh.position.set(-0.31, 0.092, -0.04);
    this.bigFillMesh.scale.set(1, 0.02, 1);

    // Right SMALL Pillar
    const smallCollar = new THREE.Mesh(collarGeo, brushedNavyMat);
    smallCollar.position.set(0.31, 0.071, -0.04);
    const smallShell = new THREE.Mesh(glassShellGeo, glassMat);
    smallShell.position.set(0.31, 0.222, -0.04);
    smallShell.renderOrder = 3;
    const smallTopRing = new THREE.Mesh(capRingGeo, cyanTrimMat);
    smallTopRing.rotation.x = Math.PI / 2;
    smallTopRing.position.set(0.31, 0.362, -0.04);
    this.smallFillMesh = new THREE.Mesh(coreGeo, this.smallMat);
    this.smallFillMesh.position.set(0.31, 0.092, -0.04);
    this.smallFillMesh.scale.set(1, 0.02, 1);

    this.disposableGeometries.push(
      tier1Geo,
      tier2Geo,
      rimGeo,
      deckGeo,
      deckAccentGeo,
      orbitGeo,
      collarGeo,
      glassShellGeo,
      coreGeo,
      capRingGeo
    );

    this.baseGroup.add(
      tier1,
      tier2,
      rimMesh,
      deckMesh,
      deckAccent,
      this.orbitRing,
      bigCollar,
      bigShell,
      bigTopRing,
      this.bigFillMesh,
      smallCollar,
      smallShell,
      smallTopRing,
      this.smallFillMesh
    );

    // Make decorative 3D stage non-blocking to spatial UI pointer rays
    this.xb = {pointerEvents: 'none'};
  }

  syncData(analytics: AnalyticsSnapshot, rules: GameRules): void {
    const freqs = analytics.frequencies;
    const count = freqs.length;

    // Rebuild bar meshes only if number range length changed
    if (this.bars.length !== count) {
      this.barGroup.clear();
      this.bars = [];

      const totalWidth = 0.42;
      const step = count > 0 ? totalWidth / count : 0.04;
      const barWidth = Math.min(0.028, step * 0.62);

      for (let i = 0; i < count; i++) {
        const isBig = freqs[i].category === 'BIG';
        const mesh = new THREE.Mesh(
          this.barGeo,
          isBig ? this.bigMat : this.smallMat
        );
        const cap = new THREE.Mesh(this.capGeo, this.barCapMat);

        const x = -totalWidth / 2 + step * (i + 0.5);
        mesh.position.set(x, 0.088, 0.02);
        mesh.scale.set(barWidth, 0.014, barWidth);

        cap.position.set(x, 0.098, 0.02);
        cap.scale.set(barWidth, 1, barWidth);

        this.barGroup.add(mesh, cap);
        this.bars.push({
          mesh,
          cap,
          targetHeight: 0.014,
          currentHeight: 0.014,
        });
      }
    }

    const maxFreq = Math.max(1, ...freqs.map((f) => f.count));
    const topSet = new Set(analytics.mostFrequent.map((f) => f.value));
    const maxBarHeight = 0.24;

    freqs.forEach((item, idx) => {
      const slot = this.bars[idx];
      if (!slot) return;
      const isBig = item.category === 'BIG';
      const isTop = analytics.totalRecords > 0 && topSet.has(item.value);
      slot.mesh.material = isTop
        ? this.topHighlightMat
        : isBig
          ? this.bigMat
          : this.smallMat;
      slot.targetHeight =
        analytics.totalRecords > 0
          ? 0.016 + (item.count / maxFreq) * maxBarHeight
          : 0.016;
    });

    // Update Big / Small glass tower fill heights
    const maxPillar = 0.25;
    this.bigTargetHeight =
      analytics.totalRecords > 0
        ? 0.02 + (analytics.bigPct / 100) * maxPillar
        : 0.02;
    this.smallTargetHeight =
      analytics.totalRecords > 0
        ? 0.02 + (analytics.smallPct / 100) * maxPillar
        : 0.02;

    // Keep unused rules referenced cleanly for future scaling if needed
    void rules;
  }

  animate(deltaTime: number): void {
    const dt = Math.min(deltaTime, 0.1);
    const lambda = 7.5;

    this.orbitRing.rotation.z += dt * 0.38;

    for (const slot of this.bars) {
      slot.currentHeight = THREE.MathUtils.damp(
        slot.currentHeight,
        slot.targetHeight,
        lambda,
        dt
      );
      slot.mesh.scale.y = slot.currentHeight;
      slot.mesh.position.y = 0.078 + slot.currentHeight / 2;
      slot.cap.position.y = 0.078 + slot.currentHeight + 0.005;
    }

    this.bigCurrentHeight = THREE.MathUtils.damp(
      this.bigCurrentHeight,
      this.bigTargetHeight,
      lambda,
      dt
    );
    this.bigFillMesh.scale.y = this.bigCurrentHeight;
    this.bigFillMesh.position.y = 0.082 + this.bigCurrentHeight / 2;

    this.smallCurrentHeight = THREE.MathUtils.damp(
      this.smallCurrentHeight,
      this.smallTargetHeight,
      lambda,
      dt
    );
    this.smallFillMesh.scale.y = this.smallCurrentHeight;
    this.smallFillMesh.position.y = 0.082 + this.smallCurrentHeight / 2;
  }

  dispose(): void {
    for (const geo of this.disposableGeometries) geo.dispose();
    for (const mat of this.disposableMaterials) mat.dispose();
    this.disposableGeometries = [];
    this.disposableMaterials = [];
  }
}
