// Биржа работ: приказы копать/строить/таскать/собирать урожай/крутить генератор.
import { W, BUILDINGS } from './world.js';
import { findPath, accessCells } from './path.js';

export const JOB_ORDER = ['operate', 'supply', 'build', 'dig', 'harvest', 'deconstruct', 'haul'];
export const JOB_LABEL = {
  operate: 'Генератор', supply: 'Подвоз', build: 'Стройка', dig: 'Копает',
  harvest: 'Урожай', deconstruct: 'Разбор', haul: 'Переноска',
  eat: 'Ест', sleep: 'Спит', breathe: 'Задыхается', idle: 'Без дела', walk: 'Идёт',
};

export class JobBoard {
  constructor() { this.jobs = []; this.claimed = new Map(); }

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
    for (const [i, st] of bdata) {
      const x = i % W, y = (i / W) | 0;
      if (st.remove) { jobs.push({ type: 'deconstruct', x, y, key: 'dec' + i }); continue; }
      if (st.built) {
        if (st.def.farm && st.growth >= 1) jobs.push({ type: 'harvest', x, y, key: 'hv' + i });
        if (st.def.uses && (st.store[st.def.uses] || 0) < 20)
          jobs.push({ type: 'supply', x, y, res: st.def.uses, amount: 20, key: 'sup' + i });
        if (st.def.farm && !st.planted)
          jobs.push({ type: 'supply', x, y, res: 'dirt', amount: 10, key: 'dirt' + i });
        if (st.def.manual && game.power.deficit > 0)
          jobs.push({ type: 'operate', x, y, key: 'op' + i });
        continue;
      }
      // недостроено
      let missing = null;
      for (const [res, amt] of Object.entries(st.def.cost)) {
        const have = st.delivered?.[res] || 0;
        if (have < amt) { missing = { res, amount: amt - have }; break; }
      }
      if (missing) jobs.push({ type: 'supply', x, y, res: missing.res, amount: missing.amount, key: 'sup' + i, site: true });
      else jobs.push({ type: 'build', x, y, key: 'bld' + i });
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
        if (pawn.disabled[j.type]) return false;
        if (!stillValid(world, j)) return false;
        if (j.type === 'haul' && !storageFor(world, j.res)) return false;
        if ((j.type === 'supply' || j.type === 'build') && !supplyReady(world, j)) return false;
        return true;
      })
      .map(j => ({ j, rank: JOB_ORDER.indexOf(j.type), d: Math.abs(j.x - pawn.x) + Math.abs(j.y - pawn.y) }))
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
  const st = world.bdata.get(i);
  switch (j.type) {
    case 'dig': return !!world.mat[i] && !!world.dig[i];
    case 'haul': return (world.items.get(i)?.[j.res] || 0) > 0.4;
    case 'build': return !!st && !st.built && !st.remove;
    case 'deconstruct': return !!st && !!st.remove;
    case 'harvest': return !!st && st.built && st.growth >= 1;
    case 'operate': return !!st && st.built;
    case 'supply': {
      if (!st) return false;
      if (!st.built) {
        if (j.site === undefined && !st.def.uses && !st.def.farm) return false;
        const need = st.def.cost[j.res] || 0;
        return (st.delivered?.[j.res] || 0) + 0.01 < need;
      }
      if (st.def.uses === j.res) return (st.store[j.res] || 0) < 20;
      if (st.def.farm && j.res === 'dirt') return !st.planted;
      return false;
    }
    default: return true;
  }
}

/** Есть ли где хранить ресурс. */
export function storageFor(world, res) {
  const kind = res === 'food' ? 'food' : 'mat';
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

/** Найти источник ресурса: сначала склады, потом кучи на полу. */
export function findResource(world, res, near) {
  let best = null, bestD = Infinity;
  for (const [i, st] of world.bdata) {
    if (!st.built || !st.store[res] || st.store[res] < 0.5) continue;
    const d = near ? Math.abs(st.x - near.x) + Math.abs(st.y - near.y) : 0;
    if (d < bestD) { bestD = d; best = { x: st.x, y: st.y, from: st }; }
  }
  if (best) return best;
  for (const [i, pile] of world.items) {
    if (!pile[res] || pile[res] < 0.5) continue;
    const x = i % W, y = (i / W) | 0;
    const d = near ? Math.abs(x - near.x) + Math.abs(y - near.y) : 0;
    if (d < bestD) { bestD = d; best = { x, y, pileIdx: i }; }
  }
  return best;
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
