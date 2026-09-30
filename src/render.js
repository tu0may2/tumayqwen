// Отрисовка: процедурные текстуры пород, мягкий свет, объёмная вода, частицы.
import { W, H, TILE, MATS, BUILDINGS, GAS_CAP, RESOURCES, LAYER } from './world.js';
import { LIQ_FULL } from './fluid.js';
import { PLANTS } from './plants.js';
import { TextureSet } from './textures.js';
import { MACHINE_ART, unplugged } from './machine-art.js';
import { makeRNG, makeNoise2D, fbm } from './util.js';

const hash = (x, y) => {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
};

// цвета ресурсов для кусков на полу
const RES_COLOR = {
  dirt: ['#7a5334', '#4d3220'], stone: ['#9aa0a8', '#5f666e'], coal: ['#3c3c42', '#1d1d21'],
  copper: ['#c87a3c', '#8a4f22'], ice: ['#bfe6f5', '#7fc0d6'], algae: ['#6fa554', '#436b38'],
  slime: ['#86a955', '#55703a'], pdirt: ['#6c6c3c', '#414127'],
  food: ['#cfa14e', '#8c6a28'], meal: ['#e0b45c', '#9c7128'],
};

function makeBuffer(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  return c;
}

export class Renderer {
  constructor(canvas, world) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.cam = { x: world.start.x * TILE, y: world.start.y * TILE, z: 1.6 };
    this.overlay = 'none';
    this.tex = new TextureSet();
    this.shade = this.makeShadeMap();     // крупные пятна освещённости породы
    this.particles = [];
    this.chunks = new Map();          // кеш кусков ландшафта: рисуем только изменившиеся
    this.chunkScale = 2;
    this.last = performance.now();
    this.t = 0;

    // буферы «на тайл» — их растягивание даёт мягкие градиенты газа и света
    this.gasBuf = makeBuffer(W, H);
    this.gasCtx = this.gasBuf.getContext('2d');
    this.lightBuf = makeBuffer(W, H);
    this.lightCtx = this.lightBuf.getContext('2d');

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Низкочастотная карта оттенков: породa не выглядит одинаковой на всю пещеру. */
  makeShadeMap() {
    const n = makeNoise2D(makeRNG(0x51ade));
    const map = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) map[y * W + x] = (fbm(n, x * 0.09, y * 0.09, 3) - 0.5) * 2;
    }
    return map;
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.c.width = Math.floor(this.c.clientWidth * dpr);
    this.c.height = Math.floor(this.c.clientHeight * dpr);
    this.dpr = dpr;
  }

  screenToTile(sx, sy) {
    const z = this.cam.z * this.dpr;
    const wx = (sx * this.dpr - this.c.width / 2) / z + this.cam.x;
    const wy = (sy * this.dpr - this.c.height / 2) / z + this.cam.y;
    return { x: Math.floor(wx / TILE), y: Math.floor(wy / TILE) };
  }

  // ------------------------------------------------------------------ кадр
  draw(game) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;

    const { ctx } = this;
    const z = this.cam.z * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05090d';
    ctx.fillRect(0, 0, this.c.width, this.c.height);
    ctx.save();
    ctx.translate(this.c.width / 2, this.c.height / 2);
    ctx.scale(z, z);
    ctx.translate(-this.cam.x, -this.cam.y);

    const halfW = this.c.width / 2 / z, halfH = this.c.height / 2 / z;
    const x0 = Math.max(0, Math.floor((this.cam.x - halfW) / TILE) - 1);
    const x1 = Math.min(W - 1, Math.ceil((this.cam.x + halfW) / TILE) + 1);
    const y0 = Math.max(0, Math.floor((this.cam.y - halfH) / TILE) - 1);
    const y1 = Math.min(H - 1, Math.ceil((this.cam.y + halfH) / TILE) + 1);
    const view = { x0, x1, y0, y1 };

    this.drawSpace(ctx, view, game);
    this.drawTerrain(ctx, view);
    this.drawLiquid(ctx, view);
    if (this.overlay !== 'gas') this.drawGasClouds(ctx, view);
    this.drawConduits(ctx, view);
    this.drawBuildings(ctx, view);
    this.drawItems(ctx, view);
    this.drawOrders(ctx, view);
    this.drawCritters(ctx, game);
    this.drawPawns(ctx, game);
    this.drawUnderwater(ctx, view);
    this.updateParticles(ctx, game, dt, view);
    if (this.overlay === 'none') this.drawLighting(ctx, view, game);
    if (this.overlay !== 'none') this.drawOverlay(ctx, view, game);
    this.drawCursor(ctx, game);
    ctx.restore();
    this.drawVignette(ctx);
  }

  // ------------------------------------------------------- космос над поверхностью
  drawSpace(ctx, { x0, x1, y0, y1 }, game) {
    const w = this.world;
    const night = game.cycleT > 0.75;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const px = x * TILE, py = y * TILE;
        const bm = w.back[i];
        if (!bm) {
          const k = Math.min(1, y / 18);
          const c = night ? [9, 13, 34] : [18, 46, 76];
          ctx.fillStyle = `rgb(${(c[0] * (1 - k) + 5 * k) | 0},${(c[1] * (1 - k) + 12 * k) | 0},${(c[2] * (1 - k) + 20 * k) | 0})`;
          ctx.fillRect(px, py, TILE, TILE);
          const h = hash(x, y);
          if (h > 0.93 && y < 12) {
            const tw = 0.55 + 0.45 * Math.sin(this.t * 1.7 + h * 40);
            ctx.fillStyle = `rgba(255,255,255,${(0.2 + h * 0.5) * tw})`;
            ctx.fillRect(px + h * 12, py + (h * 91 % 12), 1.5, 1.5);
          }
        }
      }
    }
  }

  /** Ландшафт кешируется кусками 16×16 тайлов: за кадр — десяток блитов вместо тысяч. */
  drawTerrain(ctx, { x0, x1, y0, y1 }) {
    const w = this.world;
    for (const key of w.dirtyChunks) {
      const ch = this.chunks.get(key);
      if (ch) ch.dirty = true;
    }
    w.dirtyChunks.clear();

    const used = new Set();
    for (let cy = y0 >> 4; cy <= y1 >> 4; cy++) {
      for (let cx = x0 >> 4; cx <= x1 >> 4; cx++) {
        if (cx < 0 || cy < 0 || cx > (W >> 4) || cy > (H >> 4)) continue;
        const key = (cy << 8) | cx;
        used.add(key);
        let ch = this.chunks.get(key);
        if (!ch) {
          const px = 16 * TILE * this.chunkScale;
          ch = { canvas: makeBuffer(px, px), dirty: true };
          ch.ctx = ch.canvas.getContext('2d');
          this.chunks.set(key, ch);
        }
        if (ch.dirty) { this.paintChunk(ch, cx, cy); ch.dirty = false; }
        ctx.drawImage(ch.canvas, cx * 16 * TILE, cy * 16 * TILE, 16 * TILE, 16 * TILE);
      }
    }
    // держим в памяти только куски рядом с экраном
    if (this.chunks.size > used.size + 12) {
      for (const key of [...this.chunks.keys()]) if (!used.has(key)) this.chunks.delete(key);
    }
  }

  /** Перерисовать один кусок ландшафта: задняя стена, порода, кромки, мох, трещины. */
  paintChunk(ch, cx, cy) {
    const w = this.world;
    const g = ch.ctx;
    const S = this.chunkScale;
    g.setTransform(S, 0, 0, S, 0, 0);
    g.clearRect(0, 0, 16 * TILE, 16 * TILE);
    const bx = cx * 16, by = cy * 16;
    for (let ty = 0; ty < 16; ty++) {
      for (let tx = 0; tx < 16; tx++) {
        const x = bx + tx, y = by + ty;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        const px = tx * TILE, py = ty * TILE;
        const m = w.mat[i];

        if (!m) {
          const bm = w.back[i];
          if (!bm) continue;                       // космос рисуется отдельно
          const hb = hash(x + 11, y + 5);
          const tex = this.tex.back(bm, (hb * 8) | 0);
          if (tex) g.drawImage(tex, px, py, TILE, TILE);
          const jit = this.shade[i] * 0.06 + (hb - 0.5) * 0.03;
          g.fillStyle = jit > 0 ? `rgba(210,232,255,${jit})` : `rgba(2,8,14,${-jit})`;
          g.fillRect(px, py, TILE, TILE);
          let ao = 0;
          if (w.mat[i - 1]) ao += 1;
          if (w.mat[i + 1]) ao += 1;
          if (w.mat[i - W]) ao += 1.4;
          if (w.mat[i + W]) ao += 0.6;
          if (ao > 0) {
            g.fillStyle = `rgba(3,8,14,${Math.min(0.32, ao * 0.06)})`;
            g.fillRect(px, py, TILE, TILE);
          }
          continue;
        }

        const h = hash(x, y);
        const tex = this.tex.tile(m, (h * 8) | 0);
        if (tex) g.drawImage(tex, px, py, TILE, TILE);
        else { g.fillStyle = MATS[m].color; g.fillRect(px, py, TILE, TILE); }

        const up = !w.mat[i - W], down = !w.mat[i + W];
        const left = !w.mat[i - 1], right = !w.mat[i + 1];
        const buried = !up && !down && !left && !right;
        const tone = this.shade[i] * 0.07 + (h - 0.5) * 0.03 - (buried ? 0.06 : 0);
        if (Math.abs(tone) > 0.01) {
          g.fillStyle = tone > 0 ? `rgba(255,246,228,${tone})` : `rgba(4,10,16,${-tone})`;
          g.fillRect(px, py, TILE, TILE);
        }

        const E = this.tex.edges;
        if (up) g.drawImage(E.top, px, py, TILE, TILE);
        if (down) g.drawImage(E.bottom, px, py, TILE, TILE);
        if (left) g.drawImage(E.left, px, py, TILE, TILE);
        if (right) g.drawImage(E.right, px, py, TILE, TILE);

        const corner = (a, b, ox, oy, sx, sy) => {
          if (!a || !b) return;
          g.fillStyle = 'rgba(6,12,18,.55)';
          g.beginPath();
          g.moveTo(ox, oy);
          g.lineTo(ox + sx * 3.2, oy);
          g.quadraticCurveTo(ox, oy, ox, oy + sy * 3.2);
          g.closePath();
          g.fill();
        };
        corner(up, left, px, py, 1, 1);
        corner(up, right, px + TILE, py, -1, 1);
        corner(down, left, px, py + TILE, 1, -1);
        corner(down, right, px + TILE, py + TILE, -1, -1);

        if (up && (m === 1 || m === 7 || m === 9)) this.moss(g, px, py, x, y, m);

        const dp = w.digProg[i];
        if (dp > 0) this.drawCracks(g, px, py, Math.min(1, dp / 10), hash(x + 3, y + 5));
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Пучки мха на верхней кромке грунта — оживляют силуэт пещеры. */
  moss(ctx, px, py, x, y, m) {
    const base = m === 9 ? '#7fae52' : m === 7 ? '#6fa554' : '#5f8d43';
    ctx.strokeStyle = base;
    ctx.lineWidth = 0.9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const h = hash(x * 7 + k, y * 13);
      if (h < 0.45) continue;
      const bx = px + 2 + k * 3.6 + h * 1.5;
      const len = 1.6 + h * 2.6;
      ctx.moveTo(bx, py + 0.5);
      ctx.lineTo(bx + (h - 0.5) * 1.6, py - len);
    }
    ctx.stroke();
  }

  drawCracks(ctx, px, py, k, seed) {
    ctx.save();
    ctx.strokeStyle = `rgba(20,12,8,${0.35 + k * 0.5})`;
    ctx.lineWidth = 0.7 + k;
    ctx.beginPath();
    const cx = px + TILE / 2, cy = py + TILE / 2;
    const arms = 3 + Math.floor(k * 3);
    for (let a = 0; a < arms; a++) {
      const ang = (a / arms) * Math.PI * 2 + seed * 6;
      const len = (TILE / 2) * (0.35 + k * 0.7);
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len * 0.85);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ----------------------------------------------------------------- вода
  drawLiquid(ctx, { x0, x1, y0, y1 }) {
    const w = this.world;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const m = w.water[i];
        if (m < 1 || w.mat[i]) continue;
        const f = Math.min(1, m / LIQ_FULL);
        const open = w.water[i - W] < 1 && !w.mat[i - W];
        const wave = open ? Math.sin(this.t * 1.6 + x * 0.7) * 0.7 : 0;
        const hgt = Math.max(1.5, f * TILE);
        const px = x * TILE, py = y * TILE + TILE - hgt + wave;
        const dirty = w.pwater[i] > 0.4;
        const hot = w.temp[i] > 60;

        ctx.fillStyle = dirty ? 'rgba(96,112,58,.88)' : hot ? 'rgba(84,144,196,.86)' : 'rgba(42,104,176,.86)';
        ctx.fillRect(px, py, TILE, hgt + 1);
        // толща воды темнее у дна — объём без градиента на каждый тайл
        ctx.fillStyle = 'rgba(6,26,54,.28)';
        ctx.fillRect(px, py + hgt * 0.55, TILE, hgt * 0.45 + 1);

        if (open) {
          // блик и пена по поверхности
          ctx.fillStyle = dirty ? 'rgba(196,214,130,.65)' : 'rgba(190,230,255,.7)';
          ctx.fillRect(px, py, TILE, 1.5);
          ctx.fillStyle = 'rgba(255,255,255,.18)';
          ctx.fillRect(px + 2 + Math.sin(this.t * 2 + x) * 2, py + 2, 4, 1);
        }
      }
    }
  }

  /** Поверх всего — тон воды: то, что под водой, выглядит погружённым. */
  drawUnderwater(ctx, { x0, x1, y0, y1 }) {
    const w = this.world;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const m = w.water[i];
        if (m < 60 || w.mat[i]) continue;
        const f = Math.min(1, m / LIQ_FULL);
        const dirty = w.pwater[i] > 0.4;
        ctx.fillStyle = dirty
          ? `rgba(104,120,60,${0.18 + f * 0.3})`
          : `rgba(46,110,180,${0.16 + f * 0.28})`;
        const hgt = Math.max(2, f * TILE);
        ctx.fillRect(x * TILE, y * TILE + TILE - hgt, TILE, hgt);
        // каустика у поверхности
        if (f > 0.25 && w.water[i - W] < 60) {
          ctx.fillStyle = 'rgba(190,235,255,.22)';
          const ph = this.t * 1.8 + x * 0.9;
          ctx.fillRect(x * TILE + 2 + Math.sin(ph) * 3, y * TILE + TILE - hgt + 1.5, 3.5, 1);
          ctx.fillRect(x * TILE + 9 + Math.sin(ph + 1.7) * 2.5, y * TILE + TILE - hgt + 3, 2.5, 0.8);
        }
      }
    }
  }

  /** Виньетка рисуется из заранее готового слоя — градиент на каждый кадр слишком дорог. */
  drawVignette(ctx) {
    const { width: cw, height: ch } = this.c;
    if (!this.vignette || this.vignette.width !== cw || this.vignette.height !== ch) {
      this.vignette = makeBuffer(cw, ch);
      const v = this.vignette.getContext('2d');
      const g = v.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.38, cw / 2, ch / 2, Math.max(cw, ch) * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,.38)');
      v.fillStyle = g;
      v.fillRect(0, 0, cw, ch);
    }
    ctx.drawImage(this.vignette, 0, 0);
  }

  // ------------------------------------------------ газы мягкими облаками
  drawGasClouds(ctx, { x0, x1, y0, y1 }) {
    const w = this.world;
    const g = this.gasCtx;
    g.clearRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    let any = false;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (w.mat[i]) continue;
        const o2 = w.o2[i], co2 = w.co2[i], st = w.steam[i], h2 = w.h2[i];
        const total = o2 + co2 + st + h2;
        if (total < 0.03) continue;
        // цвет — смесь газов, прозрачность — давление
        const r = (o2 * 120 + co2 * 108 + st * 232 + h2 * 198) / total;
        const gg = (o2 * 196 + co2 * 104 + st * 238 + h2 * 158) / total;
        const b = (o2 * 232 + co2 * 98 + st * 244 + h2 * 234) / total;
        const heavy = (co2 + st + h2) / total;
        const a = Math.min(0.42, (total / GAS_CAP) * (0.13 + heavy * 0.3));
        g.fillStyle = `rgba(${r | 0},${gg | 0},${b | 0},${a})`;
        g.fillRect(x, y, 1, 1);
        any = true;
      }
    }
    if (!any) return;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    // лёгкий дрейф: облака газа не стоят как приклеенные
    const dx = Math.sin(this.t * 0.35) * 1.6, dy = Math.cos(this.t * 0.27) * 1.1;
    ctx.drawImage(this.gasBuf, x0, y0, x1 - x0 + 1, y1 - y0 + 1,
      x0 * TILE + dx, y0 * TILE + dy, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE);
    ctx.restore();
  }

  // --------------------------------------------------------------- освещение
  drawLighting(ctx, { x0, x1, y0, y1 }, game) {
    const w = this.world;
    const l = this.lightCtx;
    const night = game.cycleT > 0.75;
    l.clearRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const lit = Math.min(1, w.light[i]);
        // ночью фон глуше и холоднее — лампы становятся заметны
        const k = (night ? 0.46 : 0.68) + lit * (night ? 0.3 : 0.36);
        const warm = night ? 0.78 : 0.88 + lit * 0.16;
        const cool = night ? 1.2 : 1.06 - lit * 0.08;
        const rr = Math.min(255, 255 * k * warm);
        const gg = Math.min(255, 255 * k * (night ? 0.86 : 0.95));
        const bb = Math.min(255, 255 * k * cool);
        l.fillStyle = `rgb(${rr | 0},${gg | 0},${bb | 0})`;
        l.fillRect(x, y, 1, 1);
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.lightBuf, x0, y0, x1 - x0 + 1, y1 - y0 + 1,
      x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE);

    // тёплое сияние ламп и работающих машин
    ctx.globalCompositeOperation = 'lighter';
    for (const [, st] of w.bdata) {
      if (!st.built || st.x < x0 - 6 || st.x > x1 + 6 || st.y < y0 - 6 || st.y > y1 + 6) continue;
      const lamp = st.def.light && st.powered;
      const hot = st.def.uses === 'coal' && st.burning;
      if (!lamp && !hot) continue;
      const cx = st.x * TILE + TILE / 2, cy = st.y * TILE + TILE / 2;
      const r = lamp ? st.def.light * TILE * 0.8 : TILE * 2;
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, lamp ? 'rgba(255,214,140,.22)' : 'rgba(255,140,60,.2)');
      grd.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  // --------------------------------------------------------------- частицы
  spawn(p) { if (this.particles.length < 900) this.particles.push(p); }

  updateParticles(ctx, game, dt, view) {
    const w = this.world;
    // события от игры: пыль при добыче, брызги
    if (game.fx && game.fx.length) {
      for (const e of game.fx) {
        for (let n = 0; n < (e.big ? 14 : 5); n++) {
          this.spawn({
            x: e.x * TILE + TILE / 2 + (Math.random() - 0.5) * TILE,
            y: e.y * TILE + TILE / 2 + (Math.random() - 0.5) * TILE,
            vx: (Math.random() - 0.5) * 18, vy: -Math.random() * 16,
            life: 0.5 + Math.random() * 0.6, max: 1.1,
            color: e.color || '#c8b49a', size: 0.8 + Math.random() * 1.4, grav: 42,
          });
        }
      }
      game.fx.length = 0;
    }
    // пузырьки в воде и пылинки в освещённом воздухе
    if (Math.random() < dt * 22) {
      const x = view.x0 + Math.floor(Math.random() * (view.x1 - view.x0 + 1));
      const y = view.y0 + Math.floor(Math.random() * (view.y1 - view.y0 + 1));
      const i = y * W + x;
      if (!w.mat[i] && w.water[i] > 200) {
        this.spawn({
          x: x * TILE + Math.random() * TILE, y: y * TILE + TILE,
          vx: (Math.random() - 0.5) * 3, vy: -8 - Math.random() * 8,
          life: 1 + Math.random(), max: 2, color: 'rgba(200,235,255,.75)',
          size: 0.6 + Math.random(), grav: 0,
        });
      } else if (!w.mat[i] && w.light[i] > 0.5) {
        this.spawn({
          x: x * TILE + Math.random() * TILE, y: y * TILE + Math.random() * TILE,
          vx: (Math.random() - 0.5) * 4, vy: -1 - Math.random() * 3,
          life: 1.5 + Math.random(), max: 2.6, color: 'rgba(255,240,200,.5)',
          size: 0.5, grav: -1,
        });
      }
    }

    for (let k = this.particles.length - 1; k >= 0; k--) {
      const p = this.particles[k];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(k, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.grav || 0) * dt;
      const a = Math.max(0, Math.min(1, p.life / (p.max || 1)));
      ctx.fillStyle = p.color.startsWith('rgba') ? p.color : p.color;
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------- трубы и провода
  drawConduits(ctx, { x0, x1, y0, y1 }) {
    const w = this.world;
    const styles = { power: ['#d8b25a', 2], liquid: ['#4d9ad6', 3.2], gas: ['#b98ad8', 3.2], auto: ['#7ed957', 1.6] };
    for (const kind of ['liquid', 'gas', 'power', 'auto']) {
      const arr = w.cond[kind];
      const [color, width] = styles[kind];
      const off = kind === 'power' ? -4 : kind === 'liquid' ? 0 : kind === 'gas' ? 4 : 6;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * W + x;
          if (!arr[i]) continue;
          const st = w.bdata.get(i * 8 + LAYER[kind]);
          const built = st && st.built;
          const cx = x * TILE + TILE / 2, cy = y * TILE + TILE / 2 + off;
          const links = [];
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (arr[(y + dy) * W + (x + dx)]) links.push([dx, dy]);
          }
          ctx.globalAlpha = built ? 1 : 0.35;
          // тень трубы, затем сама труба и блик — получается объём
          for (const pass of [0, 1, 2]) {
            ctx.strokeStyle = pass === 0 ? 'rgba(0,0,0,.45)' : pass === 1 ? color : 'rgba(255,255,255,.35)';
            ctx.lineWidth = pass === 0 ? width + 1.4 : pass === 1 ? width : width * 0.35;
            ctx.lineCap = 'round';
            ctx.beginPath();
            const yo = pass === 2 ? -width * 0.22 : 0;
            if (!links.length) { ctx.moveTo(cx - 3, cy + yo); ctx.lineTo(cx + 3, cy + yo); }
            for (const [dx, dy] of links) {
              ctx.moveTo(cx, cy + yo);
              ctx.lineTo(cx + dx * TILE / 2, cy + dy * TILE / 2 + yo);
            }
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  // ------------------------------------------------------------- постройки
  drawBuildings(ctx, { x0, x1, y0, y1 }) {
    const w = this.world;
    for (const [, st] of w.bdata) {
      const x = st.x, y = st.y;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (st.def.conduit) continue;
      const px = x * TILE, py = y * TILE, def = st.def;
      if (!st.built) {
        ctx.strokeStyle = 'rgba(90,220,235,.85)';
        ctx.setLineDash([3, 3]); ctx.lineWidth = 1.2;
        ctx.strokeRect(px + 1.5, py + 1.5, TILE - 3, TILE - 3);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(70,200,220,.14)';
        ctx.fillRect(px + 1.5, py + 1.5, TILE - 3, TILE - 3);
        const frac = st.prog / def.work;
        if (frac > 0) { ctx.fillStyle = 'rgba(255,180,60,.6)'; ctx.fillRect(px + 2, py + TILE - 4, (TILE - 4) * frac, 2); }
        ctx.globalAlpha = 0.5;
        this.icon(ctx, def, px, py, st);
        ctx.globalAlpha = 1;
        continue;
      }
      if (st.remove) { ctx.fillStyle = 'rgba(255,80,70,.25)'; ctx.fillRect(px, py, TILE, TILE); }
      this.icon(ctx, def, px, py, st);
    }
  }

  icon(ctx, def, px, py, st) {
    if (def.key === 'tile') {
      // кирпичная кладка со смещением рядов
      const tex = this.tex.tile(2, ((px + py) / TILE) & 3);
      if (tex) ctx.drawImage(tex, px, py, TILE, TILE);
      ctx.fillStyle = 'rgba(255,240,215,.18)'; ctx.fillRect(px, py, TILE, 2);
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(px, py + TILE - 2, TILE, 2);
      ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 1;
      const row = ((py / TILE) | 0) % 2;
      ctx.beginPath();
      ctx.moveTo(px, py + TILE / 2); ctx.lineTo(px + TILE, py + TILE / 2);
      ctx.moveTo(px + (row ? TILE / 2 : 0), py); ctx.lineTo(px + (row ? TILE / 2 : 0), py + TILE / 2);
      ctx.moveTo(px + (row ? 0 : TILE / 2), py + TILE / 2); ctx.lineTo(px + (row ? 0 : TILE / 2), py + TILE);
      ctx.stroke();
      return;
    }
    if (def.key === 'ladder') {
      ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px + 4.6, py); ctx.lineTo(px + 4.6, py + TILE);
      ctx.moveTo(px + TILE - 3.4, py); ctx.lineTo(px + TILE - 3.4, py + TILE);
      ctx.stroke();
      ctx.strokeStyle = '#caa06a'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + 4, py); ctx.lineTo(px + 4, py + TILE);
      ctx.moveTo(px + TILE - 4, py); ctx.lineTo(px + TILE - 4, py + TILE);
      for (let k = 3; k < TILE; k += 5) { ctx.moveTo(px + 4, py + k); ctx.lineTo(px + TILE - 4, py + k); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,230,190,.45)'; ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(px + 3.3, py); ctx.lineTo(px + 3.3, py + TILE);
      ctx.stroke();
      return;
    }
    if (def.key === 'door') {
      ctx.fillStyle = '#6a7784';
      roundRect(ctx, px + 1, py + 1, TILE - 2, TILE - 2, 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(px + 2, py + 2, TILE - 4, 2);
      ctx.fillStyle = '#48535e'; ctx.fillRect(px + TILE / 2 - 1, py + 2, 2, TILE - 4);
      return;
    }

    const unpowered = def.power < 0 && st.powered === false;
    const art = MACHINE_ART[def.key];
    if (art) {
      ctx.save();
      ctx.translate(px, py);
      art(ctx, st, this.t);
      if (st.noNet) unplugged(ctx);
      ctx.restore();
    } else {
      // запасной вариант для построек без собственного рисунка
      const g = ctx.createLinearGradient(0, py, 0, py + TILE);
      g.addColorStop(0, unpowered ? '#4b3f4d' : '#456a76');
      g.addColorStop(1, unpowered ? '#2c242f' : '#243d47');
      ctx.fillStyle = g;
      roundRect(ctx, px + 1, py + 2, TILE - 2, TILE - 3, 3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.font = `${TILE - 6}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(def.icon, px + TILE / 2, py + TILE / 2 + 1);
    }

    if (def.farm && st.planted) this.plant(ctx, px, py, st);
    if (unpowered) {
      ctx.fillStyle = '#ff6b5e';
      ctx.beginPath(); ctx.arc(px + TILE - 3, py + 3, 1.8, 0, 7); ctx.fill();
    } else if (def.power < 0 && st.powered) {
      ctx.fillStyle = '#7ed957';
      ctx.beginPath(); ctx.arc(px + TILE - 3, py + 3, 1.6, 0, 7); ctx.fill();
    }
  }

  /** Растение на грядке: стебель, листья, плод; вянущее — жухлое и с меткой. */
  plant(ctx, px, py, st) {
    const gr = Math.min(1, st.growth);
    const h = 2 + gr * (TILE - 7);
    const sway = Math.sin(this.t * 1.1 + px * 0.3) * (0.6 + gr);
    const cx = px + TILE / 2, base = py + TILE - 6;
    const green = st.wilt ? '#8a8b4a' : '#63b148';
    ctx.strokeStyle = green; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, base);
    ctx.quadraticCurveTo(cx + sway * 0.5, base - h * 0.6, cx + sway, base - h);
    ctx.stroke();
    ctx.fillStyle = green;
    const leaves = 1 + Math.floor(gr * 3);
    for (let i = 0; i < leaves; i++) {
      const t = (i + 1) / (leaves + 1);
      const lx = cx + sway * t * 0.8, ly = base - h * t;
      const dir = i % 2 ? 1 : -1;
      ctx.beginPath();
      ctx.ellipse(lx + dir * 2.2, ly, 2.4, 1.1, dir * 0.5, 0, 7);
      ctx.fill();
    }
    if (gr >= 1) {
      const fruit = PLANTS[st.plant]?.yield === 'food' ? '#ffd35c' : '#e0764a';
      ctx.fillStyle = fruit;
      ctx.beginPath(); ctx.arc(cx + sway, base - h, 2.2, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.beginPath(); ctx.arc(cx + sway - 0.7, base - h - 0.7, 0.7, 0, 7); ctx.fill();
    }
    if (st.wilt) {
      ctx.fillStyle = '#ff6b5e';
      ctx.beginPath(); ctx.arc(px + 3, py + 3, 1.6, 0, 7); ctx.fill();
    }
  }

  // ------------------------------------------------------- ресурсы на полу
  drawItems(ctx, { x0, x1, y0, y1 }) {
    const w = this.world;
    for (const [i, pile] of w.items) {
      const x = i % W, y = (i / W) | 0;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      let k = 0;
      for (const [res, amt] of Object.entries(pile)) {
        if (amt < 0.2) continue;
        const px = x * TILE + 4 + (k % 2) * 7, py = y * TILE + TILE - 4 - ((k / 2) | 0) * 6;
        this.chunk(ctx, res, px, py, 1 + Math.min(1, amt / 40));
        k++;
        if (k > 3) break;
      }
    }
  }

  /** Кусок породы/ресурса: тень, тело, блик. */
  chunk(ctx, res, px, py, scale) {
    const [c1, c2] = RES_COLOR[res] || ['#9aa0a8', '#5f666e'];
    const r = 2.4 * scale;
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(px, py + 1.2, r * 1.15, r * 0.45, 0, 0, 7); ctx.fill();
    const g = ctx.createLinearGradient(0, py - r, 0, py + r);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(px - r, py);
    ctx.lineTo(px - r * 0.5, py - r);
    ctx.lineTo(px + r * 0.6, py - r * 0.85);
    ctx.lineTo(px + r, py + r * 0.2);
    ctx.lineTo(px, py + r * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath();
    ctx.ellipse(px - r * 0.25, py - r * 0.45, r * 0.32, r * 0.18, -0.5, 0, 7);
    ctx.fill();
  }

  // --------------------------------------------------------------- приказы
  drawOrders(ctx, { x0, x1, y0, y1 }) {
    const w = this.world;
    ctx.lineWidth = 1.4;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (!w.dig[i] || !w.mat[i]) continue;
        const p = x * TILE, q = y * TILE;
        ctx.strokeStyle = 'rgba(0,0,0,.45)';
        ctx.beginPath();
        ctx.moveTo(p + 3.6, q + 3.6); ctx.lineTo(p + TILE - 2.6, q + TILE - 2.6);
        ctx.moveTo(p + TILE - 2.6, q + 3.6); ctx.lineTo(p + 3.6, q + TILE - 2.6);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,196,80,.95)';
        ctx.beginPath();
        ctx.moveTo(p + 3, q + 3); ctx.lineTo(p + TILE - 3, q + TILE - 3);
        ctx.moveTo(p + TILE - 3, q + 3); ctx.lineTo(p + 3, q + TILE - 3);
        ctx.stroke();
      }
    }
  }

  // ------------------------------------------------------------- живность
  drawCritters(ctx, game) {
    for (const c of game.critters || []) {
      const px = c.px * TILE + TILE / 2, py = c.py * TILE + TILE - 3;
      ctx.save();
      ctx.translate(px, py);
      ctx.fillStyle = 'rgba(0,0,0,.32)';
      ctx.beginPath(); ctx.ellipse(0, 3, 5.5, 1.9, 0, 0, 7); ctx.fill();
      const body = ctx.createLinearGradient(0, -8, 0, 2);
      body.addColorStop(0, shadeHex(c.def.color, 1.25));
      body.addColorStop(1, shadeHex(c.def.color, 0.75));
      ctx.fillStyle = body;
      if (c.sp === 'hatch') {
        roundRect(ctx, -6, -6, 12, 8, 3.4); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.8; ctx.stroke();
        ctx.fillStyle = '#2c2119';
        ctx.fillRect(-4 * c.dir, -4, 1.4, 1.4);
        ctx.fillRect(-6, 1.5, 2, 2); ctx.fillRect(4, 1.5, 2, 2);
        ctx.fillStyle = 'rgba(255,255,255,.25)';
        ctx.fillRect(-4, -5.2, 7, 1.2);
      } else if (c.sp === 'puft') {
        const bob = Math.sin(this.t * 2 + c.id) * 1.2;
        ctx.beginPath(); ctx.arc(0, -4 + bob, 5, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.45)';
        ctx.beginPath(); ctx.arc(-1.7, -5.6 + bob, 1.5, 0, 7); ctx.fill();
        ctx.fillStyle = '#2b2233';
        ctx.beginPath(); ctx.arc(1.4, -4.4 + bob, 0.9, 0, 7); ctx.fill();
      } else {
        const swim = Math.sin(this.t * 6 + c.id) * 0.8;
        ctx.beginPath(); ctx.ellipse(0, -3 + swim, 5.5, 3, 0, 0, 7); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(5 * c.dir, -3 + swim); ctx.lineTo(8 * c.dir, -5.5 + swim); ctx.lineTo(8 * c.dir, -0.5 + swim);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#1d2b33';
        ctx.beginPath(); ctx.arc(-2 * c.dir, -3.6 + swim, 0.8, 0, 7); ctx.fill();
      }
      if (c.hunted) {
        ctx.strokeStyle = '#ff6b5e'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, -3, 8, 0, 7); ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ------------------------------------------------------------ дупликанты
  drawPawns(ctx, game) {
    for (const p of game.pawns) {
      const px = p.px * TILE + TILE / 2, py = p.py * TILE + TILE;
      const moving = p.plan.length && p.plan[0].go;
      const walk = moving ? Math.sin(p.anim) : 0;
      const breathe = Math.sin(this.t * 2 + p.id) * 0.25;
      const asleep = p.task === 'sleep';
      ctx.save();
      ctx.translate(px, py);
      ctx.fillStyle = 'rgba(0,0,0,.32)';
      ctx.beginPath(); ctx.ellipse(0, 0, 6.2, 2.2, 0, 0, 7); ctx.fill();
      ctx.scale(p.facing, 1);

      ctx.strokeStyle = '#243c45'; ctx.lineWidth = 1.9; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-1.5, -5); ctx.lineTo(-1.5 + walk * 2.2, -0.4);
      ctx.moveTo(1.5, -5); ctx.lineTo(1.5 - walk * 2.2, -0.4);
      ctx.stroke();

      const body = ctx.createLinearGradient(-4.5, -12, 4.5, -4);
      body.addColorStop(0, shadeHSL(p.color, 1.18));
      body.addColorStop(1, shadeHSL(p.color, 0.78));
      ctx.fillStyle = body;
      roundRect(ctx, -4.5, -12 + breathe, 9, 8, 3.2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 0.8; ctx.stroke();

      ctx.strokeStyle = shadeHSL(p.color, 0.95); ctx.lineWidth = 1.9;
      ctx.beginPath();
      ctx.moveTo(-4, -10 + breathe); ctx.lineTo(-6 - walk, -6 + breathe);
      ctx.moveTo(4, -10 + breathe); ctx.lineTo(6 + walk, -6 + breathe);
      ctx.stroke();

      const head = ctx.createRadialGradient(-1.5, -18, 0.5, 0, -16.5, 6);
      head.addColorStop(0, '#f2fbfb');
      head.addColorStop(1, '#bcd8da');
      ctx.fillStyle = head;
      ctx.beginPath(); ctx.arc(0, -16.5 + breathe, 5.2, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 0.8; ctx.stroke();

      const blink = (Math.sin(this.t * 1.3 + p.id * 2) > 0.985) ? 0.15 : 1;
      ctx.fillStyle = '#12262c';
      if (asleep || blink < 1) {
        ctx.fillRect(-3, -17 + breathe, 2.4, 0.9);
        ctx.fillRect(0.6, -17 + breathe, 2.4, 0.9);
      } else {
        ctx.beginPath();
        ctx.arc(-1.8, -17 + breathe, 1.15, 0, 7);
        ctx.arc(1.8, -17 + breathe, 1.15, 0, 7);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.75)';
        ctx.beginPath(); ctx.arc(-2.2, -17.4 + breathe, 0.4, 0, 7); ctx.fill();
      }
      ctx.strokeStyle = shadeHSL(p.color, 1.1); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-1, -21.2 + breathe); ctx.lineTo(1.5, -23.4 + breathe); ctx.stroke();
      // инструмент в руках: кирка на копке, молоток на стройке
      const working = p.task === 'dig' || p.task === 'build' || p.task === 'deconstruct';
      if (working && !asleep) {
        const swing = Math.sin(this.t * 9) * 0.9 - 0.4;
        ctx.save();
        ctx.translate(5.5, -8 + breathe);
        ctx.rotate(swing);
        ctx.strokeStyle = '#8a6a44'; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(7, -1.5); ctx.stroke();
        ctx.strokeStyle = '#c3ccd4'; ctx.lineWidth = 1.6;
        ctx.beginPath();
        if (p.task === 'dig') { ctx.moveTo(5.5, -3.5); ctx.quadraticCurveTo(8.5, -1.2, 6, 1.4); }
        else { ctx.moveTo(6, -3.2); ctx.lineTo(9, -3.2); ctx.lineTo(9, 0); ctx.lineTo(6, 0); }
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();

      if (p.carry) this.chunk(ctx, p.carry.res, px + p.facing * 7, py - 9, 1.2);
      if (p.suitO2 > 0) {
        ctx.strokeStyle = 'rgba(150,220,255,.5)'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(px, py - 16.5, 6.4, 0, 7); ctx.stroke();
      }

      const icons = [];
      if (p.oxygen < 45) icons.push('😵');
      if (p.calories < 1200) icons.push('🍗');
      if (p.stress > 80) icons.push('💢');
      if (p.sick) icons.push('🤒');
      if (asleep) icons.push('💤');
      if (icons.length) {
        ctx.font = '8px serif'; ctx.textAlign = 'center';
        ctx.fillText(icons.join(''), px, py - 26);
      }
      if (game.selected === p) {
        ctx.strokeStyle = '#ffb43d'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(px, py, 9, 3.2, 0, 0, 7); ctx.stroke();
      }
      ctx.font = '5.5px "Trebuchet MS"'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(8,16,20,.75)';
      ctx.fillText(p.name.split(' ')[0], px + 0.4, py + 7.4);
      ctx.fillStyle = 'rgba(223,243,244,.92)';
      ctx.fillText(p.name.split(' ')[0], px, py + 7);
    }
  }

  // --------------------------------------------------------------- режимы
  drawOverlay(ctx, { x0, x1, y0, y1 }, game) {
    const w = this.world;
    ctx.fillStyle = 'rgba(4,10,14,.55)';
    ctx.fillRect(x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const px = x * TILE, py = y * TILE;
        if (this.overlay === 'gas') {
          if (w.mat[i]) continue;
          if (w.water[i] > 20) {
            ctx.fillStyle = `rgba(40,110,190,${Math.min(0.9, 0.3 + w.water[i] / LIQ_FULL * 0.6)})`;
            ctx.fillRect(px, py, TILE, TILE); continue;
          }
          const gases = [[w.o2[i], '90,190,235'], [w.co2[i], '150,150,160'], [w.steam[i], '235,240,245'], [w.h2[i], '200,160,235']];
          gases.sort((a, b) => b[0] - a[0]);
          if (gases[0][0] < 0.01) continue;
          ctx.fillStyle = `rgba(${gases[0][1]},${Math.min(0.85, gases[0][0] / GAS_CAP)})`;
          ctx.fillRect(px, py, TILE, TILE);
        } else if (this.overlay === 'germs') {
          const gm = w.germs[i];
          if (gm < 1) continue;
          ctx.fillStyle = `rgba(150,220,80,${Math.min(0.75, gm / 300)})`;
          ctx.fillRect(px, py, TILE, TILE);
        } else if (this.overlay === 'light') {
          ctx.fillStyle = `rgba(255,230,140,${w.light[i] * 0.7})`;
          ctx.fillRect(px, py, TILE, TILE);
        } else if (this.overlay === 'temp') {
          const t = w.temp[i];
          const k = Math.max(0, Math.min(1, (t + 20) / 80));
          ctx.fillStyle = `rgba(${(k * 255) | 0},${(90 - k * 60) | 0},${((1 - k) * 235) | 0},.6)`;
          ctx.fillRect(px, py, TILE, TILE);
        }
      }
    }
    if (this.overlay === 'rooms') {
      let n = 0;
      for (const room of game.rooms) {
        const hue = (n++ * 67) % 360;
        ctx.fillStyle = `hsla(${hue},70%,55%,.35)`;
        for (const i of room.tiles) {
          const x = (i % W) * TILE, y = ((i / W) | 0) * TILE;
          ctx.fillRect(x, y, TILE, TILE);
        }
        const first = room.buildings[0];
        if (first) {
          ctx.fillStyle = '#fff'; ctx.font = '6px "Trebuchet MS"'; ctx.textAlign = 'center';
          ctx.fillText(room.name, first.x * TILE + TILE / 2, first.y * TILE - 3);
        }
      }
    }
    if (this.overlay === 'power') {
      for (const [, st] of w.bdata) {
        if (!st.built) continue;
        const x = st.x * TILE, y = st.y * TILE;
        const p = st.def.power || 0;
        if (!p && !st.def.storeJ) continue;
        ctx.fillStyle = p > 0 ? 'rgba(126,217,87,.6)' : st.powered ? 'rgba(255,180,61,.55)' : 'rgba(255,80,70,.6)';
        ctx.fillRect(x, y, TILE, TILE);
      }
    }
  }

  drawCursor(ctx, game) {
    const t = game.hover;
    if (!t || !this.world.inside(t.x, t.y)) return;
    const sel = game.drag;
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    if (sel) {
      const ax = Math.min(sel.x, t.x), ay = Math.min(sel.y, t.y);
      const bx = Math.max(sel.x, t.x), by = Math.max(sel.y, t.y);
      ctx.fillStyle = 'rgba(255,180,60,.18)';
      ctx.fillRect(ax * TILE, ay * TILE, (bx - ax + 1) * TILE, (by - ay + 1) * TILE);
      ctx.strokeRect(ax * TILE + .5, ay * TILE + .5, (bx - ax + 1) * TILE - 1, (by - ay + 1) * TILE - 1);
    } else {
      ctx.strokeRect(t.x * TILE + .5, t.y * TILE + .5, TILE - 1, TILE - 1);
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Осветлить/затемнить hex-цвет. */
function shadeHex(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * k);
  const g = Math.min(255, ((n >> 8) & 255) * k);
  const b = Math.min(255, (n & 255) * k);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/** То же для hsl(...) — цвета дупликантов задаются в HSL. */
function shadeHSL(hsl, k) {
  const m = /hsl\((\d+),\s*([\d.]+)%,\s*([\d.]+)%\)/.exec(hsl);
  if (!m) return hsl;
  const l = Math.max(8, Math.min(92, +m[3] * k));
  return `hsl(${m[1]},${m[2]}%,${l}%)`;
}
