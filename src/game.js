// Игровой цикл: время, энергия, работа зданий, колонисты, события.
import { World, W, H, BUILDINGS, B_BY_KEY, RESOURCES } from './world.js';
import { stepFluids, stepLight, LIQ_FULL } from './fluid.js';
import { JobBoard, countResource } from './jobs.js';
import { Pawn } from './pawn.js';
import { makeRNG } from './util.js';

export const CYCLE = 600;      // секунд на цикл
const GROW_TIME = 150;         // секунд до урожая

export class Game {
  constructor(seed) {
    this.world = new World(seed);
    this.rng = makeRNG((seed || 7) * 2654435761 % 4294967295);
    this.board = new JobBoard();
    this.pawns = [];
    this.time = 0; this.cycle = 1; this.cycleT = 0;
    this.speed = 1; this.selected = null; this.hover = null; this.drag = null;
    this.alerts = []; this.decor = 0;
    this.power = { gen: 0, demand: 0, deficit: 0, stored: 0, cap: 0 };
    this.rebuildAt = 0; this.gameOver = false;

    const s = this.world.start;
    for (let i = 0; i < 3; i++) this.spawnPawn(s.x - 1 + i, s.y);
    // стартовые припасы прямо на полу базы
    this.world.addItem(s.x - 3, s.y, 'stone', 120);
    this.world.addItem(s.x + 3, s.y, 'copper', 80);
    this.world.addItem(s.x - 4, s.y, 'dirt', 60);
    this.world.addItem(s.x + 4, s.y, 'algae', 80);
    this.world.addItem(s.x, s.y, 'food', 20000);
    this.alert('Колония высажена. Копайте, стройте, дышите.', true);
  }

  spawnPawn(x, y) {
    const w = this.world;
    let ty = y;
    while (ty < H - 2 && !w.standable(x, ty)) ty++;
    const p = new Pawn(w, x, ty, this.rng);
    this.pawns.push(p);
    return p;
  }

  alert(text, info = false) {
    this.alerts.push({ text, info, t: this.time });
    if (this.alerts.length > 4) this.alerts.shift();
  }

  kill(pawn, cause) {
    if (pawn.dead) return;
    pawn.dead = true;
    pawn.dropJob(this);
    this.pawns = this.pawns.filter(p => p !== pawn);
    if (pawn.bed) pawn.bed.owner = null;
    this.alert(`${pawn.name} ${cause}.`);
    if (!this.pawns.length) { this.gameOver = true; this.speed = 0; this.alert('Колония погибла. F5 — новая попытка.'); }
  }

  findBuilding(key, near) {
    let best = null, bd = Infinity;
    for (const [, st] of this.world.bdata) {
      if (!st.built || st.def.key !== key) continue;
      const d = near ? Math.abs(st.x - near.x) + Math.abs(st.y - near.y) : 0;
      if (d < bd) { bd = d; best = st; }
    }
    return best;
  }

  claimBed(pawn) {
    if (pawn.bed && pawn.bed.built && pawn.bed.owner === pawn) return pawn.bed;
    for (const [, st] of this.world.bdata) {
      if (!st.built || !st.def.sleep || (st.owner && st.owner !== pawn && !st.owner.dead)) continue;
      st.owner = pawn; pawn.bed = st; return st;
    }
    return null;
  }

  stock(res) { return countResource(this.world, res); }

  // ---------------------------------------------------------------- энергия
  updatePower(dt) {
    const w = this.world;
    let gen = 0, demand = 0, stored = 0, cap = 0;
    const consumers = [], batteries = [];
    for (const [, st] of w.bdata) {
      if (!st.built) continue;
      const d = st.def;
      if (d.storeJ) { batteries.push(st); stored += st.charge; cap += d.storeJ; }
      if (d.power > 0) {
        if (d.manual) {
          st.operating = Math.max(0, (st.operating || 0) - dt);
          if (st.operating > 0) gen += d.power;
        } else gen += d.power;
      } else if (d.power < 0) { demand += -d.power; consumers.push(st); }
    }

    // доступная мощность = генераторы + то, что батареи успеют отдать за тик
    const fromBatteries = dt > 0 ? stored / dt : 0;
    let budget = gen + fromBatteries;
    let consumed = 0;
    for (const st of consumers) {
      const p = -st.def.power;
      if (budget >= p) { st.powered = true; budget -= p; consumed += p; } else st.powered = false;
    }

    const net = (gen - consumed) * dt;          // Дж за тик: + заряд, − разряд
    let rest = Math.abs(net);
    for (const st of batteries) {
      if (rest <= 0) break;
      if (net > 0) {
        const put = Math.min(st.def.storeJ - st.charge, rest);
        st.charge += put; rest -= put;
      } else {
        const take = Math.min(st.charge, rest);
        st.charge -= take; rest -= take;
      }
    }

    this.power = { gen, demand, consumed, stored, cap, deficit: Math.max(0, demand - gen) };
  }

  // -------------------------------------------------------------- устройства
  updateBuildings(dt) {
    const w = this.world;
    this.decor = 0;
    for (const [i, st] of w.bdata) {
      if (!st.built) continue;
      const d = st.def, x = st.x, y = st.y;
      if (d.light || d.eat) this.decor += 1.5;
      if (d.uses === 'algae' && st.powered) {
        const use = 0.06 * dt;
        if ((st.store.algae || 0) > use) {
          st.store.algae -= use;
          w.o2[i] = Math.min(4, w.o2[i] + use * 12);
          w.temp[i] += 0.02 * dt;
        }
      }
      if (d.scrub && st.powered) {
        for (const j of [i, i - 1, i + 1, i - W, i + W]) {
          if (j < 0 || j >= w.co2.length || w.mat[j]) continue;
          w.co2[j] = Math.max(0, w.co2[j] - 0.05 * dt);
        }
      }
      if (d.farm && st.planted && st.growth < 1) {
        const air = w.o2[i] > 0.05 ? 1 : 0.4;
        st.growth = Math.min(1, st.growth + dt / GROW_TIME * air);
      }
    }
  }

  // ------------------------------------------------------------------- тик
  update(realDt) {
    if (this.gameOver) return;
    const steps = this.speed;
    if (!steps) return;
    const dt = Math.min(0.05, realDt) * (steps >= 3 ? 1 : 1);
    const iters = steps >= 3 ? 3 : steps;
    for (let k = 0; k < iters; k++) this.tick(dt);
  }

  tick(dt) {
    this.time += dt;
    const c = Math.floor(this.time / CYCLE) + 1;
    if (c !== this.cycle) {
      this.cycle = c;
      this.onNewCycle();
    }
    this.cycleT = (this.time % CYCLE) / CYCLE;

    stepFluids(this.world, dt);
    this.updateVents(dt);
    if (Math.floor(this.time * 2) % 4 === 0) stepLight(this.world);

    this.updatePower(dt);
    this.updateBuildings(dt);

    if (this.time > this.rebuildAt) { this.board.rebuild(this.world, this); this.rebuildAt = this.time + 0.7; }
    for (const p of [...this.pawns]) p.update(this.world, this, dt);
  }

  /** Гейзеры: периодически выбрасывают пар, воду, CO₂ или водород. */
  updateVents(dt) {
    const w = this.world;
    for (const v of w.vents) {
      v.t += dt;
      if (!v.active && v.t > v.period) { v.active = true; v.t = 0; }
      if (v.active && v.t > v.period * 0.35) { v.active = false; v.t = 0; }
      if (!v.active) continue;
      const i = w.idx(v.x, v.y);
      if (w.mat[i]) continue;
      const r = v.rate * dt;
      if (v.type === 'steam') { w.steam[i] += r * 0.6; w.temp[i] = Math.min(400, w.temp[i] + r * 60); }
      else if (v.type === 'water') { w.water[i] += r * 220; w.temp[i] += (60 - w.temp[i]) * Math.min(1, r * 0.4); }
      else if (v.type === 'co2') { w.co2[i] += r * 0.5; w.temp[i] += r * 5; }
      else { w.h2[i] += r * 0.25; w.temp[i] += r * 20; }
    }
  }

  onNewCycle() {
    this.alert(`Начался цикл ${this.cycle}.`, true);
    // «печатный под»: новобранец раз в 3 цикла, если есть еда
    if (this.cycle % 3 === 0 && this.pawns.length < 12 && this.stock('food') > 1500) {
      const s = this.world.start;
      const p = this.spawnPawn(s.x, s.y);
      this.alert(`Прибыл новый дупликант: ${p.name}!`, true);
    }
  }

  // -------------------------------------------------------------- приказы
  orderDig(x, y) {
    const w = this.world, i = w.idx(x, y);
    if (!w.inside(x, y) || !w.mat[i] || w.mat[i] === 8) return;
    w.dig[i] = 1;
  }
  cancel(x, y) {
    const w = this.world, i = w.idx(x, y);
    w.dig[i] = 0;
    const st = w.bdata.get(i);
    if (st && !st.built) {
      for (const [res, amt] of Object.entries(st.delivered || {})) w.addItem(x, y, res, amt);
      w.removeBuilding(x, y);
    } else if (st) st.remove = false;
  }
  orderDeconstruct(x, y) {
    const st = this.world.bstate(x, y);
    if (st && st.built) st.remove = true;
  }
  place(x, y, key) {
    const def = B_BY_KEY[key];
    if (!def || !this.world.canPlace(x, y, def)) return false;
    this.world.place(x, y, def);
    return true;
  }
}
