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

// Постройки вынесены в buildings.js
export { BUILDINGS, B_BY_KEY, CAT } from './buildings.js';
import { BUILDINGS, B_BY_KEY } from './buildings.js';

export const LAYER = { power: 1, liquid: 2, gas: 3, auto: 4 };
export const GAS_CAP = 2.2;      // кг/тайл — «комфортное» давление
export const BREATH_MIN = 0.12;  // ниже этого дупликант задыхается

export class World {
  constructor(seed = Date.now() & 0xffff) {
    this.seed = seed;
    this.rng = makeRNG(seed || 1);
    this.mat = new Uint8Array(W * H);
    this.back = new Uint8Array(W * H);      // «задняя стена» биома — фон за выкопанным
    this.digProg = new Float32Array(W * H);
    this.dig = new Uint8Array(W * H);       // помечено к добыче
    this.bid = new Uint8Array(W * H);       // здания (слой 0)
    this.cond = {                            // слои коммуникаций, как в ONI
      power: new Uint8Array(W * H),
      liquid: new Uint8Array(W * H),
      gas: new Uint8Array(W * H),
      auto: new Uint8Array(W * H),
    };
    this.bdata = new Map();                 // key(x,y,layer) -> состояние постройки
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
  /** Ключ в bdata: слой 0 — здание, 1/2/3 — провод/труба/вентиляция. */
  key(x, y, layer = 0) { return (y * W + x) * 8 + layer; }
  static layerOf(def) { return def.conduit ? LAYER[def.conduit] : 0; }
  stateAt(x, y, layer = 0) { return this.bdata.get(this.key(x, y, layer)) || null; }
  inside(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
  matAt(x, y) { return this.inside(x, y) ? this.mat[y * W + x] : 8; }
  buildAt(x, y) { return this.inside(x, y) ? this.bid[y * W + x] : 0; }
  bdef(x, y) { return BUILDINGS[this.buildAt(x, y)] || null; }
  bstate(x, y) { return this.bdata.get(this.key(x, y, 0)) || null; }
  /** Все постройки тайла по слоям. */
  allAt(x, y) {
    const out = [];
    for (let l = 0; l < 5; l++) { const st = this.bdata.get(this.key(x, y, l)); if (st) out.push(st); }
    return out;
  }

  /** Тайл перекрывает газ и жидкость (порода, стена или закрытая дверь). */
  gasBlocked(i) {
    if (this.mat[i]) return true;
    const b = BUILDINGS[this.bid[i]];
    if (!b || (!b.solid && !b.door)) return false;
    const st = this.bdata.get(i * 8);
    return !!(st && st.built);
  }

  /** Тайл непроходим (порода или достроенная стена). */
  solid(x, y) {
    if (!this.inside(x, y)) return true;
    const i = y * W + x;
    if (this.mat[i]) return true;
    const b = BUILDINGS[this.bid[i]];
    const st = this.bdata.get(i * 8);
    return !!(b && b.solid && st && st.built);
  }

  /** На этом тайле можно стоять (есть опора снизу или лестница). */
  standable(x, y) {
    if (this.solid(x, y)) return false;
    const b = BUILDINGS[this.bid[y * W + x]];
    const st = this.bdata.get((y * W + x) * 8);
    if (b && b.climb && st && st.built) return true;
    if (this.solid(x, y + 1)) return true;
    const bb = BUILDINGS[this.bid[(y + 1) * W + x]] , bs = this.bdata.get(((y + 1) * W + x) * 8);
    return !!(bb && (bb.floor || bb.climb) && bs && bs.built);
  }

  climbable(x, y) {
    const b = BUILDINGS[this.bid[y * W + x]], st = this.bdata.get((y * W + x) * 8);
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
        if (y < surface) { this.mat[i] = 0; this.back[i] = 0; continue; }   // космос над поверхностью

        const cave = fbm(n2, x * 0.07, y * 0.09, 4);
        const hollow = cave > 0.63 && y > surface + 3;

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
        this.back[i] = m;
        this.mat[i] = hollow ? 0 : m;
        this.temp[i] = MATS[m].heat;
      }
    }

    // стартовая каверна с кислородом
    const cx = (W >> 1), cy = Math.floor(H * 0.30);
    for (let y = cy - 6; y <= cy + 5; y++) {
      for (let x = cx - 11; x <= cx + 11; x++) {
        if (!this.inside(x, y)) continue;
        const d = ((x - cx) / 11) ** 2 + ((y - cy) / 6) ** 2;
        if (d < 1) {
          const i = y * W + x;
          if (!this.back[i]) this.back[i] = 1;
          this.mat[i] = 0; this.o2[i] = 1.8; this.temp[i] = 22;
        }
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
        if (y / H > 0.72 && ((x * 31 + y * 17) % 7 === 0)) { this.pwater[i] = 1; this.germs[i] = 200; }
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
    const i = this.idx(x, y);
    if (!this.inside(x, y) || this.mat[i]) return false;
    if (def.conduit) return !this.cond[def.conduit][i];
    if (this.bid[i]) return false;
    if (def.climb || def.solid || def.door) return true;
    return this.standable(x, y) || this.solid(x, y + 1);
  }

  place(x, y, def) {
    const i = this.idx(x, y);
    const layer = World.layerOf(def);
    if (def.conduit) this.cond[def.conduit][i] = def.id; else this.bid[i] = def.id;
    this.bdata.set(this.key(x, y, layer),
      { built: false, prog: 0, def, x, y, layer, store: {}, charge: 0, growth: 0, powered: false, net: {} });
    this.netDirty = true;
  }

  removeBuilding(x, y, layer = 0) {
    const i = this.idx(x, y);
    const k = this.key(x, y, layer);
    const st = this.bdata.get(k);
    if (!st) return;
    if (st.built) {
      for (const [res, amt] of Object.entries(st.def.cost)) this.addItem(x, y, res, amt * 0.5);
      for (const [res, amt] of Object.entries(st.store || {})) this.addItem(x, y, res, amt);
    }
    if (st.def.conduit) this.cond[st.def.conduit][i] = 0; else this.bid[i] = 0;
    this.bdata.delete(k);
    this.netDirty = true;
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
    if (m.germs) this.germs[i] += 250;          // вскрытая слизь пылит микробами
    if (m.yield) this.addItem(x, y, m.yield, m.amount);
    this.temp[i] = m.heat;
    return true;
  }
}
