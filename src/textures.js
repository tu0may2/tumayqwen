// Процедурные текстуры пород: шум, вкрапления, жилы и слоистость.
// Готовятся один раз при старте в офскрин-канвасы, дальше рисуются как спрайты.
import { MATS, TILE } from './world.js';
import { makeRNG } from './util.js';

const RES = TILE * 3;          // текстуры втрое крупнее тайла — деталь видна и при зуме
const VARIANTS = 8;        // 4 рисунка × 2 отражения — швы между тайлами не читаются

function mix(a, b, t) {
  const ax = parseInt(a.slice(1), 16), bx = parseInt(b.slice(1), 16);
  const r = ((ax >> 16) & 255) * (1 - t) + ((bx >> 16) & 255) * t;
  const g = ((ax >> 8) & 255) * (1 - t) + ((bx >> 8) & 255) * t;
  const bl = (ax & 255) * (1 - t) + (bx & 255) * t;
  return [r | 0, g | 0, bl | 0];
}

function shadeRGB([r, g, b], k) {
  return `rgb(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0})`;
}

/** Усилить насыщенность, сохранив светлоту: породы перестают быть серой кашей. */
function saturate([r, g, b], k) {
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  return [
    Math.max(0, Math.min(255, l + (r - l) * k)),
    Math.max(0, Math.min(255, l + (g - l) * k)),
    Math.max(0, Math.min(255, l + (b - l) * k)),
  ];
}

function canvas(size = RES) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size)
    : Object.assign(document.createElement('canvas'), { width: size, height: size });
  return c;
}

/** Зернистость: мягкие пятна разного размера поверх базового цвета. */
function grain(ctx, rng, base, amount, size) {
  for (let i = 0; i < amount; i++) {
    const x = rng() * RES, y = rng() * RES, r = size * (0.4 + rng());
    const k = 0.6 + rng() * 0.75;
    ctx.fillStyle = shadeRGB(base, k);
    ctx.globalAlpha = 0.35 + rng() * 0.45;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Осадочные слои (песчаник): горизонтальные полосы разного тона. */
function strata(ctx, rng, base) {
  let y = 0;
  while (y < RES) {
    const h = 2 + rng() * 5;
    ctx.fillStyle = shadeRGB(base, 0.78 + rng() * 0.44);
    ctx.globalAlpha = 0.6;
    ctx.fillRect(0, y, RES, h);
    y += h;
  }
  ctx.globalAlpha = 1;
}

/** Рудные прожилки: ломаные линии яркого минерала. */
function veins(ctx, rng, color, count, width) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    ctx.lineWidth = width * (0.6 + rng());
    ctx.globalAlpha = 0.5 + rng() * 0.45;
    let x = rng() * RES, y = rng() * RES;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 3; s++) {
      x += (rng() - 0.5) * RES * 0.7;
      y += (rng() - 0.5) * RES * 0.7;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Кристаллические грани (лёд, уголь): светлые и тёмные многоугольники. */
function facets(ctx, rng, base, count, light) {
  for (let i = 0; i < count; i++) {
    const cx = rng() * RES, cy = rng() * RES, r = 3 + rng() * 7;
    ctx.beginPath();
    const n = 3 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng();
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = shadeRGB(base, light ? 1.25 + rng() * 0.25 : 0.7 + rng() * 0.2);
    ctx.globalAlpha = 0.35 + rng() * 0.3;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Одна плитка породы. */
function makeTile(mat, seed) {
  const c = canvas();
  const ctx = c.getContext('2d');
  const rng = makeRNG(seed);
  const base = saturate(mix(mat.color, mat.color2, 0.4), 1.35);

  // ровная заливка без градиента: иначе каждый тайл получает свою «полоску» и массив породы полосатит
  ctx.fillStyle = shadeRGB(base, 1);
  ctx.fillRect(0, 0, RES, RES);

  switch (mat.id) {
    case 1:                                     // грунт: комковатый, с камешками
      grain(ctx, rng, base, 190, 2.6);
      veins(ctx, rng, 'rgba(60,40,24,.5)', 3, 1.2);
      break;
    case 2:                                     // песчаник: слоистый
      strata(ctx, rng, base);
      grain(ctx, rng, base, 90, 1.8);
      break;
    case 3:                                     // гранит: крапчатый
      grain(ctx, rng, base, 260, 1.9);
      facets(ctx, rng, base, 12, true);
      break;
    case 4:                                     // уголь: матовый с блестящими сколами
      grain(ctx, rng, base, 150, 2.4);
      facets(ctx, rng, base, 20, true);
      break;
    case 5:                                     // медная руда: породa с рыжими жилами
      grain(ctx, rng, base, 150, 2.2);
      veins(ctx, rng, 'rgba(226,140,60,.85)', 5, 1.8);
      veins(ctx, rng, 'rgba(120,200,160,.4)', 2, 1.1);
      break;
    case 6:                                     // лёд: прозрачные грани и трещины
      facets(ctx, rng, base, 24, true);
      veins(ctx, rng, 'rgba(240,252,255,.7)', 4, 1);
      break;
    case 7:                                     // водоросли: мшистые пятна
      grain(ctx, rng, base, 220, 2.8);
      facets(ctx, rng, base, 16, false);
      break;
    case 8:                                     // абиссалит: плотный, с прожилками
      grain(ctx, rng, base, 130, 2.2);
      veins(ctx, rng, 'rgba(150,130,190,.5)', 4, 1.3);
      break;
    case 9:                                     // слизь: блестящие пузыри
      grain(ctx, rng, base, 170, 3.2);
      facets(ctx, rng, base, 12, true);
      break;
    default:
      grain(ctx, rng, base, 170, 2.4);
  }

  // мелкий общий шум — убирает «пластиковость»
  const img = ctx.getImageData(0, 0, RES, RES);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 34;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Спрайт кромки: полоска с градиентом прозрачности. */
function edgeSprite(side, color) {
  const thick = Math.round(TILE / 4);
  const horiz = side === 'top' || side === 'bottom';
  const c = canvas(TILE);
  const ctx = c.getContext('2d');
  const g = horiz
    ? ctx.createLinearGradient(0, side === 'top' ? 0 : TILE, 0, side === 'top' ? thick : TILE - thick)
    : ctx.createLinearGradient(side === 'left' ? 0 : TILE, 0, side === 'left' ? thick : TILE - thick, 0);
  g.addColorStop(0, color);
  g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  ctx.fillStyle = g;
  if (side === 'top') ctx.fillRect(0, 0, TILE, thick);
  else if (side === 'bottom') ctx.fillRect(0, TILE - thick, TILE, thick);
  else if (side === 'left') ctx.fillRect(0, 0, thick, TILE);
  else ctx.fillRect(TILE - thick, 0, thick, TILE);
  return c;
}

export class TextureSet {
  constructor() {
    this.tiles = [];        // [matId][variant]
    this.backs = [];        // затемнённые версии для задней стены
    this.edges = {
      top: edgeSprite('top', 'rgba(255,248,230,0.34)'),
      bottom: edgeSprite('bottom', 'rgba(0,0,0,0.45)'),
      left: edgeSprite('left', 'rgba(255,245,220,0.16)'),
      right: edgeSprite('right', 'rgba(0,0,0,0.26)'),
    };
    for (const mat of MATS) {
      if (!mat) { this.tiles.push(null); this.backs.push(null); continue; }
      const vars = [], backs = [];
      for (let v = 0; v < VARIANTS / 2; v++) {
        const t = makeTile(mat, mat.id * 7919 + v * 104729 + 13);
        const mirrored = this.mirror(t);
        vars.push(t, mirrored);
        backs.push(this.darken(t, 0.52), this.darken(mirrored, 0.52));
      }
      this.tiles.push(vars);
      this.backs.push(backs);
    }
  }

  /** Зеркальная копия — тот же рисунок, но не повторяется впритык. */
  mirror(src) {
    const c = canvas();
    const ctx = c.getContext('2d');
    ctx.translate(RES, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(src, 0, 0);
    return c;
  }

  /** Тёмная копия текстуры с холодным оттенком — это задняя стена пещеры. */
  darken(src, k) {
    const c = canvas();
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(8,18,26,${1 - k})`;
    ctx.fillRect(0, 0, RES, RES);
    ctx.globalCompositeOperation = 'source-over';
    return c;
  }

  tile(matId, variant) {
    const v = this.tiles[matId];
    return v ? v[variant % VARIANTS] : null;
  }
  back(matId, variant) {
    const v = this.backs[matId];
    return v ? v[variant % VARIANTS] : null;
  }
}
