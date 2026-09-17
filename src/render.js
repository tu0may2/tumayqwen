// Отрисовка в духе Oxygen Not Included: мягкие тайлы, цветные газы, мультяшные дупликанты.
import { W, H, TILE, MATS, BUILDINGS, GAS_CAP, RESOURCES } from './world.js';
import { LIQ_FULL } from './fluid.js';
import { PLANTS } from './plants.js';
import { LAYER } from './world.js';

const hash = (x, y) => {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
};

export class Renderer {
  constructor(canvas, world) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.cam = { x: world.start.x * TILE, y: world.start.y * TILE, z: 1.6 };
    this.overlay = 'none';
    this.resize();
    window.addEventListener('resize', () => this.resize());
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

  draw(game) {
    const { ctx, world } = this;
    const z = this.cam.z * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#060c10';
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

    this.drawSky(ctx, x0, x1, y0, y1, game);
    this.drawGas(ctx, x0, x1, y0, y1);
    this.drawLiquid(ctx, x0, x1, y0, y1, game);
    this.drawTiles(ctx, x0, x1, y0, y1);
    this.drawConduits(ctx, x0, x1, y0, y1);
    this.drawBuildings(ctx, x0, x1, y0, y1);
    this.drawCritters(ctx, game);
    this.drawItems(ctx, x0, x1, y0, y1);
    this.drawOrders(ctx, x0, x1, y0, y1);
    this.drawPawns(ctx, game);
    this.drawLight(ctx, x0, x1, y0, y1);
    if (this.overlay !== 'none') this.drawOverlay(ctx, x0, x1, y0, y1, game);
    this.drawCursor(ctx, game);
    ctx.restore();
  }

  /** Фон: космос там, где нет породы вообще, и «задняя стена» биома в выкопанном. */
  drawSky(ctx, x0, x1, y0, y1, game) {
    const w = this.world;
    const night = game.cycleT > 0.75;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const px = x * TILE, py = y * TILE;
        const bm = w.back[i];
        if (!bm) {
          const k = Math.min(1, y / 16);
          const c = night ? [10, 16, 40] : [20, 52, 84];
          ctx.fillStyle = `rgb(${(c[0] * (1 - k) + 6 * k) | 0},${(c[1] * (1 - k) + 14 * k) | 0},${(c[2] * (1 - k) + 22 * k) | 0})`;
          ctx.fillRect(px, py, TILE, TILE);
          const h = hash(x, y);
          if (h > 0.93 && y < 12) {
            ctx.fillStyle = `rgba(255,255,255,${0.25 + h * 0.5})`;
            ctx.fillRect(px + h * 12, py + (h * 91 % 12), 1.4, 1.4);
          }
          continue;
        }
        const def = MATS[bm];
        const h = hash(x + 7, y - 3);
        ctx.fillStyle = shade(h > 0.5 ? def.color2 : def.color, 0.34);
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = 'rgba(0,0,0,.18)';
        ctx.fillRect(px, py, TILE, 1.5);
      }
    }
  }

  drawTiles(ctx, x0, x1, y0, y1) {
    const w = this.world;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const m = w.mat[i];
        if (!m) continue;
        const def = MATS[m];
        const h = hash(x, y);
        ctx.fillStyle = h > 0.5 ? def.color : def.color2;
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        // «зерно» породы
        ctx.fillStyle = `rgba(0,0,0,${0.06 + h * 0.10})`;
        ctx.fillRect(x * TILE + (h * 10 | 0), y * TILE + (h * 13 % TILE | 0), 3, 2);
        // подсветка кромки на границе с пустотой
        if (!w.mat[(y - 1) * W + x]) {
          ctx.fillStyle = 'rgba(255,255,255,.16)';
          ctx.fillRect(x * TILE, y * TILE, TILE, 2.2);
        }
        if (!w.mat[i - 1]) { ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(x * TILE, y * TILE, 1.6, TILE); }
        if (!w.mat[(y + 1) * W + x]) { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x * TILE, y * TILE + TILE - 2, TILE, 2); }
        // обводка по границе с пустотой — «блочный» силуэт как в ONI
        if (!w.mat[i - 1] || !w.mat[i + 1] || !w.mat[i - W] || !w.mat[i + W]) {
          ctx.strokeStyle = 'rgba(0,0,0,.32)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x * TILE + .5, y * TILE + .5, TILE - 1, TILE - 1);
        }
        const dp = w.digProg[i];
        if (dp > 0) {
          ctx.strokeStyle = `rgba(255,180,60,${0.25 + dp / 20})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(x * TILE + 3, y * TILE + 3 + dp); ctx.lineTo(x * TILE + TILE - 3, y * TILE + TILE - 4);
          ctx.stroke();
        }
      }
    }
  }

  drawGas(ctx, x0, x1, y0, y1) {
    const w = this.world;
    if (this.overlay === 'gas') return;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (w.mat[i]) continue;
        const o = w.o2[i], c = w.co2[i], st = w.steam[i], h = w.h2[i];
        if (o + c + st + h < 0.02) continue;
        const px = x * TILE, py = y * TILE;
        if (o > 0.02) { ctx.fillStyle = `rgba(120,200,235,${Math.min(0.16, (o / GAS_CAP) * 0.13)})`; ctx.fillRect(px, py, TILE, TILE); }
        if (c > 0.05) { ctx.fillStyle = `rgba(105,100,95,${Math.min(0.42, (c / GAS_CAP) * 0.38)})`; ctx.fillRect(px, py, TILE, TILE); }
        if (st > 0.02) { ctx.fillStyle = `rgba(232,240,245,${Math.min(0.6, st * 0.5)})`; ctx.fillRect(px, py, TILE, TILE); }
        if (h > 0.02) { ctx.fillStyle = `rgba(200,160,235,${Math.min(0.5, h * 0.6)})`; ctx.fillRect(px, py, TILE, TILE); }
      }
    }
  }

  /** Жидкость рисуем уровнем заполнения тайла — видно поверхность и глубину. */
  drawLiquid(ctx, x0, x1, y0, y1, game) {
    const w = this.world;
    const t = game.time;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const m = w.water[i];
        if (m < 1 || w.mat[i]) continue;
        const f = Math.min(1, m / LIQ_FULL);
        const hgt = Math.max(1.5, f * TILE);
        const px = x * TILE, py = y * TILE + TILE - hgt;
        const dirty = w.pwater[i] > 0.4;
        const hot = w.temp[i] > 60;
        ctx.fillStyle = dirty ? 'rgba(112,128,70,.78)' : hot ? 'rgba(90,150,200,.75)' : 'rgba(58,124,196,.72)';
        ctx.fillRect(px, py, TILE, hgt);
        // блик поверхности с лёгкой волной
        if (f < 0.98 && w.water[i - W] < 1) {
          const wave = Math.sin(t * 2 + x * 0.8) * 0.8;
          ctx.fillStyle = dirty ? 'rgba(180,200,120,.55)' : 'rgba(170,220,255,.55)';
          ctx.fillRect(px, py + wave, TILE, 1.4);
        }
      }
    }
  }

  /** Провода и трубы — тонкими линиями, соединяются с соседями. */
  drawConduits(ctx, x0, x1, y0, y1) {
    const w = this.world;
    const styles = { power: ['#d8b25a', 2], liquid: ['#4d9ad6', 3.2], gas: ['#b98ad8', 3.2], auto: ['#7ed957', 1.6] };
    for (const kind of ['liquid', 'gas', 'power', 'auto']) {
      const arr = w.cond[kind];
      const [color, width] = styles[kind];
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
      const off = kind === 'power' ? -4 : kind === 'liquid' ? 0 : kind === 'gas' ? 4 : 6;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * W + x;
          if (!arr[i]) continue;
          const st = w.bdata.get(i * 8 + LAYER[kind]);
          ctx.globalAlpha = st && st.built ? 1 : 0.35;
          const cx = x * TILE + TILE / 2, cy = y * TILE + TILE / 2 + off;
          ctx.beginPath();
          let linked = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = (y + dy) * W + (x + dx);
            if (!arr[n]) continue;
            linked = true;
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + dx * TILE / 2, cy + dy * TILE / 2);
          }
          if (!linked) { ctx.moveTo(cx - 3, cy); ctx.lineTo(cx + 3, cy); }
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  drawCritters(ctx, game) {
    for (const c of game.critters || []) {
      const px = c.px * TILE + TILE / 2, py = c.py * TILE + TILE - 3;
      ctx.save();
      ctx.translate(px, py);
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.beginPath(); ctx.ellipse(0, 3, 5, 1.8, 0, 0, 7); ctx.fill();
      ctx.fillStyle = c.def.color;
      if (c.sp === 'hatch') {
        roundRect(ctx, -6, -6, 12, 8, 3.4); ctx.fill();
        ctx.fillStyle = '#2c2119';
        ctx.fillRect(-4 * c.dir, -4, 1.4, 1.4);
        ctx.fillRect(-6, 1.5, 2, 2); ctx.fillRect(4, 1.5, 2, 2);
      } else if (c.sp === 'puft') {
        ctx.beginPath(); ctx.arc(0, -4, 5, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.5)';
        ctx.beginPath(); ctx.arc(-1.6, -5.4, 1.4, 0, 7); ctx.fill();
      } else {
        ctx.beginPath();
        ctx.ellipse(0, -3, 5.5, 3, 0, 0, 7); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(5 * c.dir, -3); ctx.lineTo(8 * c.dir, -5.5); ctx.lineTo(8 * c.dir, -0.5); ctx.closePath(); ctx.fill();
      }
      if (c.hunted) {
        ctx.strokeStyle = '#ff6b5e'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, -3, 8, 0, 7); ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawBuildings(ctx, x0, x1, y0, y1) {
    const w = this.world;
    for (const [i, st] of w.bdata) {
      const x = i % W, y = (i / W) | 0;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const px = x * TILE, py = y * TILE, def = st.def;
      if (!st.built) {
        ctx.strokeStyle = 'rgba(90,220,235,.85)';
        ctx.setLineDash([3, 3]); ctx.lineWidth = 1.2;
        ctx.strokeRect(px + 1.5, py + 1.5, TILE - 3, TILE - 3);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(70,200,220,.16)';
        ctx.fillRect(px + 1.5, py + 1.5, TILE - 3, TILE - 3);
        const frac = st.prog / def.work;
        if (frac > 0) { ctx.fillStyle = 'rgba(255,180,60,.5)'; ctx.fillRect(px + 2, py + TILE - 4, (TILE - 4) * frac, 2); }
        ctx.globalAlpha = 0.55;
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
      ctx.fillStyle = '#8a7f74'; ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(px, py, TILE, 2);
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.strokeRect(px + .5, py + .5, TILE - 1, TILE - 1);
      return;
    }
    if (def.key === 'ladder') {
      ctx.strokeStyle = '#c8a06a'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + 4, py); ctx.lineTo(px + 4, py + TILE);
      ctx.moveTo(px + TILE - 4, py); ctx.lineTo(px + TILE - 4, py + TILE);
      for (let k = 3; k < TILE; k += 5) { ctx.moveTo(px + 4, py + k); ctx.lineTo(px + TILE - 4, py + k); }
      ctx.stroke();
      return;
    }
    // корпус устройства
    ctx.fillStyle = st.powered === false && def.power < 0 ? '#5a4550' : '#3c5b66';
    roundRect(ctx, px + 1, py + 2, TILE - 2, TILE - 3, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.font = `${TILE - 5}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(def.icon, px + TILE / 2, py + TILE / 2 + 1);
    if (def.farm && st.planted && st.plant) {
      ctx.font = `${TILE - 6}px serif`;
      ctx.fillText(PLANTS[st.plant]?.icon || '🌱', px + TILE / 2, py + TILE / 2 - 4);
      if (st.wilt) {
        ctx.fillStyle = '#ff6b5e';
        ctx.beginPath(); ctx.arc(px + 3, py + 3, 1.8, 0, 7); ctx.fill();
      }
    }
    if (def.farm && st.planted) {
      const g = Math.min(1, st.growth);
      ctx.strokeStyle = '#8ada6a'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(px + TILE / 2, py + TILE - 2);
      ctx.lineTo(px + TILE / 2, py + TILE - 2 - g * (TILE - 5));
      ctx.stroke();
      if (g >= 1) { ctx.fillStyle = '#ffd35c'; ctx.beginPath(); ctx.arc(px + TILE / 2, py + 3, 2.4, 0, 7); ctx.fill(); }
    }
    if (def.power < 0 && st.powered === false) {
      ctx.fillStyle = '#ff6b5e'; ctx.beginPath(); ctx.arc(px + TILE - 3, py + 3, 1.8, 0, 7); ctx.fill();
    }
  }

  drawItems(ctx, x0, x1, y0, y1) {
    const w = this.world;
    ctx.font = '9px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [i, pile] of w.items) {
      const x = i % W, y = (i / W) | 0;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      let k = 0;
      for (const [res, amt] of Object.entries(pile)) {
        if (amt < 0.2) continue;
        const px = x * TILE + 4 + (k % 2) * 7, py = y * TILE + TILE - 5 - ((k / 2) | 0) * 6;
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.beginPath(); ctx.ellipse(px, py + 2, 4.5, 2, 0, 0, 7); ctx.fill();
        ctx.fillText(RESOURCES[res]?.icon || '•', px, py - 1);
        k++;
      }
    }
  }

  drawOrders(ctx, x0, x1, y0, y1) {
    const w = this.world;
    ctx.lineWidth = 1.4;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (!w.dig[i] || !w.mat[i]) continue;
        ctx.strokeStyle = 'rgba(255,190,70,.9)';
        const p = x * TILE, q = y * TILE;
        ctx.beginPath();
        ctx.moveTo(p + 3, q + 3); ctx.lineTo(p + TILE - 3, q + TILE - 3);
        ctx.moveTo(p + TILE - 3, q + 3); ctx.lineTo(p + 3, q + TILE - 3);
        ctx.stroke();
      }
    }
  }

  drawPawns(ctx, game) {
    for (const p of game.pawns) {
      const px = p.px * TILE + TILE / 2, py = p.py * TILE + TILE;
      const walk = p.plan.length && p.plan[0].go ? Math.sin(p.anim) : 0;
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(p.facing, 1);
      // тень
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath(); ctx.ellipse(0, 0, 6, 2.2, 0, 0, 7); ctx.fill();
      // ноги
      ctx.strokeStyle = '#2d4750'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-1.5, -5); ctx.lineTo(-1.5 + walk * 2, -0.5);
      ctx.moveTo(1.5, -5); ctx.lineTo(1.5 - walk * 2, -0.5);
      ctx.stroke();
      // тело
      ctx.fillStyle = p.color;
      roundRect(ctx, -4.5, -12, 9, 8, 3.2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 0.8; ctx.stroke();
      // руки
      ctx.strokeStyle = p.color; ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-4, -10); ctx.lineTo(-6 - walk, -6);
      ctx.moveTo(4, -10); ctx.lineTo(6 + walk, -6);
      ctx.stroke();
      // голова
      ctx.fillStyle = '#cfe9ea';
      ctx.beginPath(); ctx.arc(0, -16.5, 5.2, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 0.8; ctx.stroke();
      // глаза
      const asleep = p.task === 'sleep';
      ctx.fillStyle = '#12262c';
      if (asleep) {
        ctx.fillRect(-3, -17, 2.4, 0.9); ctx.fillRect(0.6, -17, 2.4, 0.9);
      } else {
        ctx.beginPath(); ctx.arc(-1.8, -17, 1.15, 0, 7); ctx.arc(1.8, -17, 1.15, 0, 7); ctx.fill();
      }
      // волосы-хохолок
      ctx.strokeStyle = p.color; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-1, -21.2); ctx.lineTo(1.5, -23.4); ctx.stroke();
      ctx.restore();

      // ноша
      if (p.carry) {
        ctx.font = '9px serif'; ctx.textAlign = 'center';
        ctx.fillText(RESOURCES[p.carry.res]?.icon || '•', px + p.facing * 7, py - 9);
      }
      // статусные иконки
      const icons = [];
      if (p.oxygen < 45) icons.push('😵');
      if (p.calories < 1200) icons.push('🍗');
      if (p.stress > 80) icons.push('💢');
      if (asleep) icons.push('💤');
      if (icons.length) {
        ctx.font = '8px serif'; ctx.textAlign = 'center';
        ctx.fillText(icons.join(''), px, py - 26);
      }
      if (game.selected === p) {
        ctx.strokeStyle = '#ffb43d'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(px, py, 9, 3.2, 0, 0, 7); ctx.stroke();
      }
      // имя
      ctx.font = '5.5px "Trebuchet MS"'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(223,243,244,.85)';
      ctx.fillText(p.name.split(' ')[0], px, py + 7);
    }
  }

  drawLight(ctx, x0, x1, y0, y1) {
    if (this.overlay !== 'none') return;
    const w = this.world;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const l = w.light[i];
        if (l > 0.5) continue;
        ctx.fillStyle = `rgba(2,8,14,${(0.5 - l) * 0.5})`;
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
  }

  drawOverlay(ctx, x0, x1, y0, y1, game) {
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
      for (const [i, st] of w.bdata) {
        if (!st.built) continue;
        const x = (i % W) * TILE, y = ((i / W) | 0) * TILE;
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

/** Затемнить hex-цвет: k — доля от исходной яркости. */
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) * k, g = ((n >> 8) & 255) * k, b = (n & 255) * k;
  return `rgb(${r | 0},${g | 0},${b | 0})`;
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
