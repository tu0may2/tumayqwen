// Сохранение и загрузка в localStorage. Большие массивы храним разрежённо.
import { W, H, B_BY_KEY, LAYER } from './world.js';
import { Pawn, TRAITS } from './pawn.js';
import { Critter } from './critters.js';

const KEY = 'deepcolony.save';
const FLOATS = ['o2', 'co2', 'steam', 'h2', 'water', 'pwater', 'germs', 'temp', 'digProg'];
const BYTES = ['mat', 'back', 'dig', 'bid'];

const packSparse = (arr, round = 3) => {
  const out = [];
  const f = 10 ** round;
  for (let i = 0; i < arr.length; i++) if (arr[i]) out.push(i, Math.round(arr[i] * f) / f);
  return out;
};
const unpackSparse = (arr, into) => {
  into.fill(0);
  for (let i = 0; i < arr.length; i += 2) into[arr[i]] = arr[i + 1];
  return into;
};

export function serialize(game) {
  const w = game.world;
  const data = {
    v: 1, seed: w.seed, time: game.time, cycle: game.cycle,
    world: { floats: {}, bytes: {}, cond: {} },
    items: [...w.items].map(([i, pile]) => [i, pile]),
    vents: w.vents,
    buildings: [...w.bdata.values()].map(st => ({
      x: st.x, y: st.y, layer: st.layer || 0, key: st.def.key, built: st.built, prog: st.prog,
      store: st.store, delivered: st.delivered, charge: st.charge, growth: st.growth,
      planted: st.planted, plant: st.plant, remove: st.remove, on: st.on,
      threshold: st.threshold, above: st.above,
    })),
    pawns: game.pawns.map(p => ({
      name: p.name, x: p.x, y: p.y, oxygen: p.oxygen, calories: p.calories, stamina: p.stamina,
      stress: p.stress, health: p.health, bladder: p.bladder, hygiene: p.hygiene, fun: p.fun,
      mood: p.mood, skills: p.skills, xp: p.xp, passions: p.passions, prio: p.prio,
      traits: p.traits.map(t => t.key), germs: p.germs, sick: p.sick, suitO2: p.suitO2,
      memories: p.memories, rel: [...p.rel], color: p.color, diet: p.diet,
    })),
    critters: game.critters.map(c => ({ sp: c.sp, x: c.x, y: c.y, hunger: c.hunger, age: c.age, hunted: c.hunted })),
    research: { done: [...game.research.done], current: game.research.current?.key || null, progress: game.research.progress },
    schedule: game.schedule.slots,
  };
  for (const f of FLOATS) data.world.floats[f] = packSparse(w[f]);
  for (const b of BYTES) data.world.bytes[b] = packSparse(w[b], 0);
  for (const k of Object.keys(w.cond)) data.world.cond[k] = packSparse(w.cond[k], 0);
  return data;
}

export function applySave(game, data) {
  const w = game.world;
  for (const f of FLOATS) if (data.world.floats[f]) unpackSparse(data.world.floats[f], w[f]);
  for (const b of BYTES) if (data.world.bytes[b]) unpackSparse(data.world.bytes[b], w[b]);
  for (const k of Object.keys(w.cond)) if (data.world.cond[k]) unpackSparse(data.world.cond[k], w.cond[k]);

  w.items.clear();
  for (const [i, pile] of data.items) w.items.set(i, pile);
  w.vents = data.vents || [];

  w.bdata.clear();
  for (const b of data.buildings) {
    const def = B_BY_KEY[b.key];
    if (!def) continue;
    w.bdata.set(w.key(b.x, b.y, b.layer), {
      def, x: b.x, y: b.y, layer: b.layer, built: b.built, prog: b.prog,
      store: b.store || {}, delivered: b.delivered, charge: b.charge || 0, growth: b.growth || 0,
      planted: b.planted, plant: b.plant, remove: b.remove, on: b.on,
      threshold: b.threshold, above: b.above, powered: false, net: {},
    });
  }
  w.netDirty = true;

  game.pawns = data.pawns.map(d => {
    const p = new Pawn(w, d.x, d.y, Math.random);
    Object.assign(p, d, { rel: new Map(d.rel), traits: d.traits.map(k => TRAITS.find(t => t.key === k)).filter(Boolean) });
    p.px = d.x; p.py = d.y; p.plan = []; p.job = null; p.bed = null;
    // сбрасываем модификаторы, начисленные случайными чертами в конструкторе
    p.speed = 3.4; p.lungs = 1; p.appetite = 1; p.stressRate = 1; p.sleepNeed = 1; p.workMul = 1;
    for (const t of p.traits) t.mod(p);
    return p;
  });
  game.critters = (data.critters || []).map(d => Object.assign(new Critter(d.sp, d.x, d.y), d));
  game.research.done = new Set(data.research.done);
  game.research.progress = data.research.progress || 0;
  if (data.research.current) game.research.select(data.research.current);
  game.schedule.slots = data.schedule || game.schedule.slots;
  game.time = data.time; game.cycle = data.cycle;
  game.board.jobs = []; game.board.claimed.clear(); game.board.bad.clear();
  return game;
}

export function saveGame(game) {
  try {
    localStorage.setItem(KEY, JSON.stringify(serialize(game)));
    game.alert('Игра сохранена.', true);
    return true;
  } catch (e) {
    game.alert('Не удалось сохранить: ' + e.message);
    return false;
  }
}

export function hasSave() {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

export function loadInto(game) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    applySave(game, JSON.parse(raw));
    game.alert('Игра загружена.', true);
    return true;
  } catch (e) {
    game.alert('Не удалось загрузить: ' + e.message);
    return false;
  }
}

export function savedSeed() {
  try { return JSON.parse(localStorage.getItem(KEY)).seed; } catch { return null; }
}
