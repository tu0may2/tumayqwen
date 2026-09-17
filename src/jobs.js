// Биржа работ: приказы копать/строить/таскать/собирать урожай/крутить генератор.
import { W, BUILDINGS } from './world.js';
import { findPath, accessCells } from './path.js';
import { PLANTS } from './plants.js';
const PLANT_NEEDS = Object.fromEntries(Object.entries(PLANTS).map(([k, p]) => [k, p.needs]));
const PLANT_WATER = Object.fromEntries(Object.entries(PLANTS).map(([k, p]) => [k, p.water > 0]));

export const JOB_ORDER = ['operate', 'hunt', 'cook', 'research', 'supply', 'build', 'dig', 'harvest', 'deconstruct', 'haul'];

/** Нужен ли оператор станку (кухня, лаборатория). */
function needsOperator(st, game) {
  if (st.def.manualWork === 'cook') return (st.store.food || 0) >= 5 && (st.store.meal || 0) < 40;
  if (st.def.manualWork === 'research') return !!game.research && !!game.research.current;
  return false;
}
export const JOB_LABEL = {
  operate: 'Генератор', supply: 'Подвоз', build: 'Стройка', dig: 'Копает',
  harvest: 'Урожай', deconstruct: 'Разбор', haul: 'Переноска',
  hunt: 'Охотится', eat: 'Ест', sleep: 'Спит', breathe: 'Задыхается', idle: 'Без дела', walk: 'Идёт',
  cook: 'Готовит', research: 'Изучает', toilet: 'В уборной', wash: 'Моется', heal: 'Лечится', fun: 'Отдыхает',
};

export class JobBoard {
  constructor() { this.jobs = []; this.claimed = new Map(); this.bad = new Map(); }

  /** Временно отложить невыполнимую задачу, чтобы не зацикливаться на ней. */
  postpone(job, until) { if (job) this.bad.set(job.key, until); }

  clearClaims(pawn) {
    for (const [job, owner] of this.claimed) if (owner === pawn) this.claimed.delete(job);
  }

  rebuild(world, game) {
    const jobs = [];
    const { mat, dig, bdata, items } = world;

    // 1. добыча
    for (let i = 0; i < dig.length; i++) {
      if (dig[i] && mat[i]) jobs.push({ type: 'dig', x: i % W, y: (i / W) | 0, key: 'dig' + i });
    }

    // 2. стройплощадки: подвоз материалов, затем работа
    for (const [k, st] of bdata) {
      const x = st.x, y = st.y;
      if (st.remove) { jobs.push({ type: 'deconstruct', x, y, k, key: 'dec' + k }); continue; }
      if (st.built) {
        if (st.def.farm && st.growth >= 1) jobs.push({ type: 'harvest', x, y, k, key: 'hv' + k });
        if (st.def.uses && (st.store[st.def.uses] || 0) < 20)
          jobs.push({ type: 'supply', x, y, k, res: st.def.uses, amount: 20, key: 'sup' + k });
        if (st.def.farm) {
          const want = st.plant ? Object.keys(PLANT_NEEDS[st.plant] || { dirt: 1 })[0] : 'dirt';
          if ((st.store[want] || 0) < 10) jobs.push({ type: 'supply', x, y, k, res: want, amount: 10, key: 'farm' + k });
          if (st.plant && PLANT_WATER[st.plant] && (st.store.water || 0) < 5 && st.net?.liquid === -1)
            jobs.push({ type: 'supply', x, y, k, res: 'ice', amount: 10, key: 'fw' + k });
        }
        if (st.def.manual && game.power.deficit > 0)
          jobs.push({ type: 'operate', x, y, k, key: 'op' + k });
        if (st.def.manualWork === 'cook' && (st.store.food || 0) < 40)
          jobs.push({ type: 'supply', x, y, k, res: 'food', amount: 40, key: 'sfood' + k });
        if (st.def.manualWork && st.powered !== false && needsOperator(st, game))
          jobs.push({ type: st.def.manualWork, x, y, k, key: 'mw' + k });
        continue;
      }
      let missing = null;
      for (const [res, amt] of Object.entries(st.def.cost)) {
        const have = st.delivered?.[res] || 0;
        if (have < amt) { missing = { res, amount: amt - have }; break; }
      }
      if (missing) jobs.push({ type: 'supply', x, y, k, res: missing.res, amount: missing.amount, key: 'sup' + k, site: true });
      else jobs.push({ type: 'build', x, y, k, key: 'bld' + k });
    }

    // 2.5 охота
    for (const c of game.critters || []) {
      if (c.hunted && !c.dead) jobs.push({ type: 'hunt', x: c.x, y: c.y, cid: c.id, key: 'hunt' + c.id });
    }

    // 3. переноска: кучи на полу → склад
    for (const [i, pile] of items) {
      const x = i % W, y = (i / W) | 0;
      for (const [res, amt] of Object.entries(pile)) {
        if (amt < 0.5) continue;
        jobs.push({ type: 'haul', x, y, res, amount: amt, key: 'h' + i + res });
      }
    }

    this.jobs = jobs;
    const live = new Set(jobs.map(j => j.key));
    for (const key of [...this.claimed.keys()]) if (!live.has(key)) this.claimed.delete(key);
  }

  /** Подобрать задачу для дупликанта: ближайшая доступная с учётом приоритетов. */
  assign(world, pawn, game) {
    const cands = this.jobs
      .filter(j => {
        const owner = this.claimed.get(j.key);
        if (owner && owner !== pawn) return false;
        const bad = this.bad.get(j.key);
        if (bad !== undefined) { if (bad > game.time) return false; this.bad.delete(j.key); }
        if (pawn.prioOf(j.type) <= 0) return false;
        if (!stillValid(world, j)) return false;
        if (j.type === 'haul' && !storageFor(world, j.res)) return false;
        if ((j.type === 'supply' || j.type === 'build') && !supplyReady(world, j)) return false;
        return true;
      })
      .map(j => ({
        j,
        rank: JOB_ORDER.indexOf(j.type) - pawn.prioOf(j.type) * 3,
        d: Math.abs(j.x - pawn.x) + Math.abs(j.y - pawn.y),
      }))
      .sort((a, b) => (a.rank - b.rank) || (a.d - b.d))
      .slice(0, 14);

    for (const { j } of cands) {
      const goals = accessCells(world, j.x, j.y, j.type !== 'dig');
      const path = findPath(world, pawn.x, pawn.y, goals);
      if (!path) continue;
      this.claimed.set(j.key, pawn);
      return { job: j, path };
    }
    return null;
  }
}

/** Проверка задачи по актуальному состоянию мира (список работ обновляется не каждый кадр). */
export function stillValid(world, j) {
  const i = j.y * W + j.x;
  const st = j.k !== undefined ? world.bdata.get(j.k) : null;
  switch (j.type) {
    case 'dig': return !!world.mat[i] && !!world.dig[i];
    case 'haul': return (world.items.get(i)?.[j.res] || 0) > 0.4;
    case 'build': return !!st && !st.built && !st.remove;
    case 'deconstruct': return !!st && !!st.remove;
    case 'harvest': return !!st && st.built && st.growth >= 1;
    case 'operate': return !!st && st.built;
    case 'cook': return !!st && st.built && (st.store.food || 0) >= 5;
    case 'research': return !!st && st.built;
    case 'supply': {
      if (!st) return false;
      if (!st.built) {
        if (j.site === undefined && !st.def.uses && !st.def.farm) return false;
        const need = st.def.cost[j.res] || 0;
        return (st.delivered?.[j.res] || 0) + 0.01 < need;
      }
      if (st.def.uses === j.res) return (st.store[j.res] || 0) < 20;
      if (st.def.manualWork === 'cook' && j.res === 'food') return (st.store.food || 0) < 40;
      if (st.def.farm) return (st.store[j.res] || 0) < 10;
      return false;
    }
    case 'hunt': return true;
    default: return true;
  }
}

/** Есть ли где хранить ресурс. */
export function storageFor(world, res) {
  const kind = storageKind(res);
  for (const [i, st] of world.bdata) {
    if (!st.built || st.def.store !== kind) continue;
    const used = Object.values(st.store).reduce((a, b) => a + b, 0);
    if (used < st.def.cap) return st;
  }
  return null;
}

/** Есть ли откуда взять ресурс для подвоза. */
function supplyReady(world, job) {
  if (job.type === 'build') return true;
  return !!findResource(world, job.res);
}

export function storageKind(res) { return res === 'food' || res === 'meal' ? 'food' : 'mat'; }

/** Источники ресурса, отсортированные по удалённости: склады и кучи на полу. */
export function findResources(world, res, near, limit = 8) {
  const out = [];
  for (const [, st] of world.bdata) {
    if (!st.built || !st.store[res] || st.store[res] < 0.5) continue;
    out.push({ x: st.x, y: st.y, from: st });
  }
  for (const [i, pile] of world.items) {
    if (!pile[res] || pile[res] < 0.5) continue;
    out.push({ x: i % W, y: (i / W) | 0, pileIdx: i });
  }
  if (near) out.sort((a, b) =>
    (Math.abs(a.x - near.x) + Math.abs(a.y - near.y)) - (Math.abs(b.x - near.x) + Math.abs(b.y - near.y)));
  return out.slice(0, limit);
}

/** Ближайший источник ресурса (без проверки достижимости). */
export function findResource(world, res, near) {
  return findResources(world, res, near, 1)[0] || null;
}

/** Ближайший достижимый источник — с проверкой пути. */
export function reachableResource(world, res, pawn) {
  for (const src of findResources(world, res, pawn)) {
    const path = findPath(world, pawn.x, pawn.y, accessCells(world, src.x, src.y));
    if (path) return { src, path };
  }
  return null;
}

/** Ближайший достижимый склад для ресурса. */
export function reachableStorage(world, res, pawn) {
  const kind = res === 'food' || res === 'meal' ? 'food' : 'mat';
  const bins = [];
  for (const [, st] of world.bdata) {
    if (!st.built || st.def.store !== kind) continue;
    const used = Object.values(st.store).reduce((a, b) => a + b, 0);
    if (used < st.def.cap) bins.push(st);
  }
  bins.sort((a, b) => (Math.abs(a.x - pawn.x) + Math.abs(a.y - pawn.y)) - (Math.abs(b.x - pawn.x) + Math.abs(b.y - pawn.y)));
  for (const bin of bins.slice(0, 6)) {
    const path = findPath(world, pawn.x, pawn.y, accessCells(world, bin.x, bin.y));
    if (path) return { bin, path };
  }
  return null;
}

/** Сколько всего ресурса на складах и на полу. */
export function countResource(world, res) {
  let n = 0;
  for (const [, st] of world.bdata) if (st.built && st.store[res]) n += st.store[res];
  for (const [, pile] of world.items) if (pile[res]) n += pile[res];
  return n;
}

export function buildingCostText(def) {
  return Object.entries(def.cost).map(([r, a]) => `${a} ${r}`).join(', ');
}
export { BUILDINGS };
