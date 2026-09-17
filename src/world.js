// Мир: материалы, постройки, генерация карты, доступ к тайлам.
import { makeRNG, makeNoise2D, fbm, clamp } from './util.js';

export const W = 128, H = 84, TILE = 16;

// ---------------------------------------------------------------- материалы
export const MATS = [
  null, // 0 — пустота (газ)
  { id: 1, name: 'Грунт',        color: '#6d4a2f', color2: '#553823', hard: 1.0, yield: 'dirt',   amount: 8,  heat: 25 },
  { id: 2, name: 'Песчаник',     color: '#9a8560', color2: '#7a684a', hard: 1.6, yield: 'stone',  amount: 10, heat: 22 },
  { id: 3, name: 'Гранит',       color: '#7b8592', color2: '#5e6773', hard: 2.8, yield: 'stone',  amount: 14, heat: 20 },
  { id: 4, name: 'Угольный пласт', color: '#3a3a40', color2: '#26262b', hard: 2.0, yield: 'coal', amount: 10, heat: 21 },
  { id: 5, name: 'Медная руда',  color: '#b4703c', color2: '#8c5329', hard: 2.4, yield: 'copper', amount: 10, heat: 21 },
  { id: 6, name: 'Лёд',          color: '#a8dced', color2: '#7fc0d6', hard: 0.7, yield: 'ice',    amount: 8,  heat: -8 },
  { id: 7, name: 'Водорослевый нарост', color: '#5d8f4e', color2: '#436b38', hard: 1.1, yield: 'algae', amount: 8, heat: 23 },
  { id: 8, name: 'Абиссалит',    color: '#4b4258', color2: '#372f42', hard: Infinity, yield: null, amount: 0, heat: 18 },
  { id: 9, name: 'Слизь',        color: '#6f8f4a', color2: '#55703a', hard: 0.9, yield: 'slime',  amount: 8,  heat: 26, germs: 'slimelung' },
  { id: 10, name: 'Загрязнённый грунт', color: '#5a5a33', color2: '#444427', hard: 1.0, yield: 'pdirt', amount: 8, heat: 24, germs: 'food' },
];

export const RESOURCES = {
  dirt:   { name: 'Грунт',      icon: '🟤' },
  stone:  { name: 'Камень',     icon: '🪨' },
  coal:   { name: 'Уголь',      icon: '⚫' },
  copper: { name: 'Медь',       icon: '🟠' },
  ice:    { name: 'Лёд',        icon: '🧊' },
  algae:  { name: 'Водоросли',  icon: '🟢' },
  slime:  { name: 'Слизь',      icon: '🟩' },
  pdirt:  { name: 'Гряз. грунт',icon: '🟫' },
  food:   { name: 'Еда',        icon: '🍽' },
  meal:   { name: 'Блюдо',      icon: '🍲' },
};

// ---------------------------------------------------------------- постройки
// solid — перекрывает газ и проход; climb — по ней можно лезть вверх/вниз;
// floor — на ней можно стоять; power < 0 — потребление, > 0 — выработка (Вт).
export const BUILDINGS = [
  null,
  { id: 1, key: 'ladder',    name: 'Лестница',     icon: '🪜', cost: { stone: 3 },              work: 6,  climb: true,  floor: true },
  { id: 2, key: 'tile',      name: 'Плитка',       icon: '🧱', cost: { stone: 5 },              work: 8,  solid: true },
  { id: 3, key: 'bed',       name: 'Койка',        icon: '🛏', cost: { stone: 10 },             work: 12, floor: true, sleep: true },
  { id: 4, key: 'bin',       name: 'Склад',        icon: '📦', cost: { stone: 15 },             work: 10, floor: true, store: 'mat', cap: 400 },
  { id: 5, key: 'ration',    name: 'Холодильник',  icon: '🧺', cost: { copper: 10, stone: 10 }, work: 12, floor: true, store: 'food', cap: 60 },
  { id: 6, key: 'diffuser',  name: 'Диффузор O₂',  icon: '💨', cost: { copper: 20 },            work: 16, floor: true, power: -120, uses: 'algae' },
  { id: 7, key: 'generator', name: 'Ручной генератор', icon: '⚙️', cost: { stone: 20 },         work: 14, floor: true, power: 400, manual: true },
  { id: 8, key: 'battery',   name: 'Батарея',      icon: '🔋', cost: { copper: 15 },            work: 12, floor: true, storeJ: 10000 },
  { id: 9, key: 'farm',      name: 'Грядка',       icon: '🌱', cost: { dirt: 20 },              work: 14, floor: true, farm: true },
  { id: 10, key: 'skimmer',  name: 'CO₂-фильтр',   icon: '🌀', cost: { copper: 20, stone: 10 }, work: 16, floor: true, power: -120, scrub: true },
  { id: 11, key: 'table',    name: 'Стол',         icon: '🍴', cost: { stone: 8 },              work: 8,  floor: true, eat: true },
  { id: 12, key: 'lamp',     name: 'Лампа',        icon: '💡', cost: { copper: 8 },             work: 6,  power: -20, light: 7 },
];
export const B_BY_KEY = {};
for (const b of BUILDINGS) if (b) B_BY_KEY[b.key] = b;

export const GAS_CAP = 2.2;      // кг/тайл — «комфортное» давление
export const BREATH_MIN = 0.12;  // ниже этого дупликант задыхается

export class World {
  constructor(seed = Date.now() & 0xffff) {
    this.seed = seed;
    this.rng = makeRNG(seed || 1);
    this.mat = new Uint8Array(W * H);
    this.digProg = new Float32Array(W * H);
    this.dig = new Uint8Array(W * H);       // помечено к добыче
    this.bid = new Uint8Array(W * H);       // тип постройки
    this.bdata = new Map();                 // idx -> состояние постройки
    this.items = new Map();                 // idx -> {res: кг}
    this.o2 = new Float32Array(W * H);
    this.co2 = new Float32Array(W * H);
    this.steam = new Float32Array(W * H);
    this.h2 = new Float32Array(W * H);
    this.water = new Float32Array(W * H);   // кг воды в тайле
    this.pwater = new Float32Array(W * H);  // доля загрязнённой воды 0..1
    this.germs = new Float32Array(W * H);   // условные единицы микробов
    this.vents = [];
    this.temp = new Float32Array(W * H);
    this.light = new Float32Array(W * H);
    this.generate();
  }

  idx(x, y) { return y * W + x; }
  inside(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
  matAt(x, y) { return this.inside(x, y) ? this.mat[y * W + x] : 8; }
  buildAt(x, y) { return this.inside(x, y) ? this.bid[y * W + x] : 0; }
  bdef(x, y) { return BUILDINGS[this.buildAt(x, y)] || null; }
  bstate(x, y) { return this.bdata.get(this.idx(x, y)) || null; }

  /** Тайл непроходим (порода или достроенная стена). */
  solid(x, y) {
    if (!this.inside(x, y)) return true;
    const i = y * W + x;
    if (this.mat[i]) return true;
    const b = BUILDINGS[this.bid[i]];
    const st = this.bdata.get(i);
    return !!(b && b.solid && st && st.built);
  }

  /** На этом тайле можно стоять (есть опора снизу или лестница). */
  standable(x, y) {
    if (this.solid(x, y)) return false;
    const b = BUILDINGS[this.bid[y * W + x]];
    const st = this.bdata.get(y * W + x);
    if (b && b.climb && st && st.built) return true;
    if (this.solid(x, y + 1)) return true;
    const bb = BUILDINGS[this.bid[(y + 1) * W + x]] , bs = this.bdata.get((y + 1) * W + x);
    return !!(bb && (bb.floor || bb.climb) && bs && bs.built);
  }

  climbable(x, y) {
    const b = BUILDINGS[this.bid[y * W + x]], st = this.bdata.get(y * W + x);
    return !!(b && b.climb && st && st.built);
  }

  // ------------------------------------------------------------- генерация
  generate() {
    const n1 = makeNoise2D(this.rng), n2 = makeNoise2D(this.rng), n3 = makeNoise2D(this.rng);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) { this.mat[i] = 8; continue; }

        const depth = y / H;
        const surface = 8 + fbm(n1, x * 0.035, 0.5, 4) * 7;
        if (y < surface) { this.mat[i] = 0; continue; }   // поверхностный вакуум/атмосфера

        // пещеры
        const cave = fbm(n2, x * 0.07, y * 0.09, 4);
        if (cave > 0.63 && y > surface + 3) { this.mat[i] = 0; continue; }

        let m = 1;
        if (depth > 0.22) m = 2;
        if (depth > 0.55) m = 3;
        const ore = fbm(n3, x * 0.12 + 40, y * 0.12, 3);
        if (ore > 0.70 && depth > 0.3) m = 4;                       // уголь
        else if (ore < 0.27 && depth > 0.25) m = 5;                 // медь
        if (depth > 0.75 && fbm(n2, x * 0.05 - 20, y * 0.05, 2) > 0.58) m = 6; // ледяной биом
        if (depth < 0.35 && cave > 0.55 && cave <= 0.63) m = 7;     // водоросли у пещер
        if (depth > 0.38 && depth < 0.62 && cave > 0.52 && cave <= 0.63) m = 9;  // болото со слизью
        if (depth > 0.38 && depth < 0.62 && ore > 0.62 && m === 2) m = 10;       // загрязнённый грунт
        if (depth > 0.92) m = 8;
        this.mat[i] = m;
        this.temp[i] = MATS[m].heat;
      }
    }

    // стартовая каверна с кислородом
    const cx = (W >> 1), cy = Math.floor(H * 0.30);
    for (let y = cy - 6; y <= cy + 5; y++) {
      for (let x = cx - 11; x <= cx + 11; x++) {
        if (!this.inside(x, y)) continue;
        const d = ((x - cx) / 11) ** 2 + ((y - cy) / 6) ** 2;
        if (d < 1) { const i = y * W + x; this.mat[i] = 0; this.o2[i] = 1.8; this.temp[i] = 22; }
      }
    }
    // пол каверны
    for (let x = cx - 11; x <= cx + 11; x++) {
      const y = cy + 5;
      if (this.inside(x, y) && !this.mat[y * W + x]) this.mat[y * W + x] = 2;
    }
    this.start = { x: cx, y: cy + 4 };

    // подземные водоёмы: пещеры ниже середины карты заполняются водой
    for (let y = Math.floor(H * 0.58); y < H - 2; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (this.mat[i]) continue;
        let roof = false;
        for (let k = 1; k <= 3; k++) if (this.mat[i - k * W]) { roof = true; break; }
        if (!roof) continue;
        this.water[i] = 1000;
        this.temp[i] = y / H > 0.8 ? 6 : 18;
        if (y / H > 0.72 && ((x * 31 + y * 17) % 7 === 0)) this.pwater[i] = 1;  // грязные линзы
      }
    }

    // гейзеры и вулканические жерла
    const ventTypes = ['steam', 'water', 'co2', 'h2'];
    for (let n = 0; n < 6; n++) {
      for (let tries = 0; tries < 400; tries++) {
        const x = 3 + Math.floor(this.rng() * (W - 6));
        const y = Math.floor(H * 0.35 + this.rng() * H * 0.55);
        const i = y * W + x;
        if (this.mat[i] || this.mat[i + W] === 0 || this.water[i] > 10) continue;
        const type = ventTypes[n % ventTypes.length];
        this.vents.push({ x, y, type, t: this.rng() * 200, period: 220 + this.rng() * 260, active: false, rate: 0.6 + this.rng() });
        break;
      }
    }

    // атмосфера в пустотах (немного кислорода в пещерах, углекислота внизу)
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (this.mat[i]) continue;
        if (this.o2[i] || this.co2[i]) continue;
        if (y < 9) continue;                     // космос сверху — вакуум
        const deep = y / H;
        this.o2[i] = 0.35 * (1 - deep) + 0.05;
        this.co2[i] = 0.25 * deep;
        this.temp[i] = 18 + deep * 12;
      }
    }
  }

  // --------------------------------------------------------------- предметы
  addItem(x, y, res, amt) {
    if (!this.inside(x, y) || amt <= 0) return;
    const i = this.idx(x, y);
    const pile = this.items.get(i) || {};
    pile[res] = (pile[res] || 0) + amt;
    this.items.set(i, pile);
  }
  takeItem(i, res, amt) {
    const pile = this.items.get(i);
    if (!pile || !pile[res]) return 0;
    const got = Math.min(pile[res], amt);
    pile[res] -= got;
    if (pile[res] <= 1e-6) delete pile[res];
    if (!Object.keys(pile).length) this.items.delete(i);
    return got;
  }

  // -------------------------------------------------------------- постройки
  canPlace(x, y, def) {
    if (!this.inside(x, y) || this.mat[this.idx(x, y)]) return false;
    if (this.bid[this.idx(x, y)]) return false;
    if (def.key === 'ladder' || def.solid) return true;
    return this.standable(x, y) || this.solid(x, y + 1);
  }

  place(x, y, def) {
    const i = this.idx(x, y);
    this.bid[i] = def.id;
    this.bdata.set(i, { built: false, prog: 0, def, x, y, store: {}, charge: 0, growth: 0, powered: false });
  }

  removeBuilding(x, y) {
    const i = this.idx(x, y);
    const st = this.bdata.get(i);
    if (st && st.built) {
      for (const [res, amt] of Object.entries(st.def.cost)) this.addItem(x, y, res, amt * 0.5);
      for (const [res, amt] of Object.entries(st.store || {})) this.addItem(x, y, res, amt);
    }
    this.bid[i] = 0;
    this.bdata.delete(i);
  }

  /** Добыча тайла: возвращает true, когда порода разрушена. */
  mine(x, y, work) {
    const i = this.idx(x, y);
    const m = MATS[this.mat[i]];
    if (!m || m.hard === Infinity) return false;
    this.digProg[i] += work / m.hard;
    if (this.digProg[i] < 10) return false;
    this.mat[i] = 0;
    this.digProg[i] = 0;
    this.dig[i] = 0;
    if (m.yield) this.addItem(x, y, m.yield, m.amount);
    this.temp[i] = m.heat;
    return true;
  }
}
