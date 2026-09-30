// Игровой цикл: время, энергия, работа зданий, колонисты, события.
import { World, W, H, BUILDINGS, B_BY_KEY, RESOURCES } from './world.js';
import { stepFluids, stepLight, LIQ_FULL } from './fluid.js';
import { JobBoard, countResource } from './jobs.js';
import { Networks } from './network.js';
import { updatePower, updateMachines, updateAutomation } from './machines.js';
import { Pawn } from './pawn.js';
import { makeRNG } from './util.js';
import { Research } from './research.js';
import { Schedule } from './schedule.js';
import { findRooms, roomAt } from './rooms.js';
import { stepSocial } from './social.js';
import { PLANTS, chooseCrop, checkPlant } from './plants.js';
import { populate } from './critters.js';

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
    this.fx = [];        // визуальные события для рендера (пыль, брызги)
    this.power = { gen: 0, demand: 0, deficit: 0, stored: 0, cap: 0 };
    this.nets = new Networks();
    this.research = new Research(this);
    this.schedule = new Schedule();
    this.rooms = []; this.roomsAt = 0;
    this.world.netDirty = true;
    this.rebuildAt = 0; this.gameOver = false; this.warnAt = 20;

    this.critters = populate(this.world, this.rng);
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
    for (const p of this.pawns) if (p.opinion(pawn) > 20) p.remember('friendDied');
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
  // -------------------------------------------------------------- устройства
  updateBuildings(dt) {
    if (this.world.netDirty) this.nets.rebuild(this.world);
    updateAutomation(this.world, this.nets, dt);
    const burnedBefore = this.power.burned || 0;
    updatePower(this.world, this.nets, dt, this.power);
    if ((this.power.burned || 0) > burnedBefore) this.alert('Провод перегорел от перегрузки!');
    updateMachines(this.world, this.nets, this, dt);

    this.decor = 0;
    for (const [, st] of this.world.bdata) {
      if (!st.built) continue;
      const i = this.world.idx(st.x, st.y);
      if (st.def.decor) this.decor += st.def.decor * 0.4;
      // перегрев: машина в жаре ломается и требует ремонта
      if (st.def.power && this.world.temp[i] > 75) {
        st.overheat = (st.overheat || 0) + dt;
        if (st.overheat > 20) {
          st.overheat = 0; st.built = false; st.prog = st.def.work * 0.4;
          this.alert(`${st.def.name} вышел из строя от перегрева.`);
        }
      } else st.overheat = 0;
      if (st.def.farm && st.planted && st.growth < 1) {
        if (!st.plant) st.plant = chooseCrop(this.world, i);
        const c = checkPlant(this.world, st, i);
        st.wilt = c.ok ? null : c.reason;
        if (c.ok) {
          st.store[c.res] = Math.max(0, st.store[c.res] - c.rate * dt);
          if (c.plant.water > 0) st.store.water = Math.max(0, (st.store.water || 0) - c.plant.water * dt * 0.1);
          const air = this.world.o2[i] > 0.05 ? 1 : 0.4;
          st.growth = Math.min(1, st.growth + dt / c.plant.time * air);
        }
      }
    }
    this.decor = Math.min(20, this.decor);
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

    this.updateBuildings(dt);

    if (this.time > this.roomsAt) {
      for (const [, st] of this.world.bdata) st.room = null;
      this.rooms = findRooms(this.world);
      this.roomsAt = this.time + 5;
      this.spoilFood(5);
    }
    if (this.time > this.rebuildAt) { this.board.rebuild(this.world, this); this.rebuildAt = this.time + 0.7; }
    for (const p of [...this.pawns]) p.update(this.world, this, dt);
    stepSocial(this, dt);
    this.checkWarnings();
    for (const c of this.critters) c.update(this.world, this, dt);
    if (this.critters.some(c => c.dead)) this.critters = this.critters.filter(c => !c.dead);
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
      if (v.type === 'steam') { w.steam[i] += r * 0.15; w.temp[i] = Math.min(400, w.temp[i] + r * 25); }
      else if (v.type === 'water') { w.water[i] += r * 9; w.temp[i] += (60 - w.temp[i]) * Math.min(1, r * 0.2); }
      else if (v.type === 'co2') { w.co2[i] += r * 0.12; w.temp[i] += r * 4; }
      else { w.h2[i] += r * 0.06; w.temp[i] += r * 12; }
    }
  }

  /** Еда на полу портится; в работающем холодильнике — нет. */
  spoilFood(dt) {
    const w = this.world;
    for (const [i, pile] of [...w.items]) {
      for (const res of ['food', 'meal']) {
        if (!pile[res]) continue;
        const loss = pile[res] * 0.00006 * dt;   // ~3.5% за цикл на полу
        pile[res] -= loss;
        w.germs[i] += loss * 2;
        if (loss > 0.5) w.addItem(i % W, (i / W) | 0, 'pdirt', loss * 0.2);
        if (pile[res] <= 0.01) delete pile[res];
      }
      if (!Object.keys(pile).length) w.items.delete(i);
    }
    for (const [, st] of w.bdata) {
      if (!st.built || st.def.store !== 'food') continue;
      if (st.chilled) continue;                       // холодильник под током
      for (const res of ['food', 'meal']) {
        if (!st.store[res]) continue;
        st.store[res] *= 1 - 0.00002 * dt;       // в тёплом шкафу портится медленно
        if (st.store[res] < 0.01) delete st.store[res];
      }
    }
  }

  roomOf(x, y) { return roomAt(this.rooms, x, y); }

  /** Случайные события: как у рассказчика в RimWorld, но по-астероидному. */
  rollEvent() {
    const r = this.rng();
    const w = this.world;
    if (r < 0.18) {
      // извержение: один из гейзеров просыпается надолго
      const v = w.vents[Math.floor(this.rng() * w.vents.length)];
      if (v) { v.active = true; v.t = 0; v.rate *= 1.8; this.alert(`Извержение ${v.type}-жерла на ${v.x},${v.y}!`); }
    } else if (r < 0.34) {
      // вспышка болезни: споры в воздухе базы
      const s = w.start, i = w.idx(s.x, s.y);
      w.germs[i] += 800;
      this.alert('Вспышка спор в базе — проветривайте и мойтесь!');
    } else if (r < 0.5) {
      // метеоритный дождь по поверхности
      for (let n = 0; n < 12; n++) {
        const x = 2 + Math.floor(this.rng() * (W - 4));
        for (let y = 1; y < H - 2; y++) {
          const i = w.idx(x, y);
          if (!w.mat[i]) continue;
          w.mat[i] = 0; w.addItem(x, y, 'copper', 12); w.temp[i] += 120;
          w.markDirty(x, y);
          this.fx.push({ x, y, big: true, color: '#ffb46a' });
          break;
        }
      }
      this.alert('Метеоритный дождь! На поверхности появились обломки.');
    } else if (r < 0.62 && this.pawns.length < 12) {
      const s = this.world.start;
      const p = this.spawnPawn(s.x, s.y);
      this.alert(`К шлюзу прибился скиталец: ${p.name}.`, true);
    }
  }

  /** Предупреждения: кислород, энергия, еда, болезни. */
  checkWarnings() {
    if (this.time < this.warnAt) return;
    this.warnAt = this.time + 30;
    const gasping = this.pawns.filter(p => p.oxygen < 45).length;
    if (gasping) this.alert(`Задыхаются: ${gasping}. Нужен кислород!`);
    if (this.power.deficit > 0) this.alert(`Не хватает ${Math.round(this.power.deficit)} Вт.`);
    if (this.stock('food') + this.stock('meal') < 1200 * this.pawns.length)
      this.alert('Еда на исходе — стройте грядки и кухню.');
    const sick = this.pawns.filter(p => p.sick).length;
    if (sick) this.alert(`Больных: ${sick}. Нужны медкойки и гигиена.`);
  }

  onNewCycle() {
    this.alert(`Начался цикл ${this.cycle}.`, true);
    if (this.cycle > 2) this.rollEvent();
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
    for (const st of w.allAt(x, y)) {
      if (!st.built) {
        for (const [res, amt] of Object.entries(st.delivered || {})) w.addItem(x, y, res, amt);
        w.removeBuilding(x, y, st.layer);
      } else st.remove = false;
    }
  }
  /** Пометить живность на отлов. */
  orderHunt(x, y) {
    for (const c of this.critters) if (c.x === x && c.y === y) c.hunted = true;
  }

  orderDeconstruct(x, y) {
    for (const st of this.world.allAt(x, y)) if (st.built) st.remove = true;
  }
  place(x, y, key) {
    const def = B_BY_KEY[key];
    if (!def || !this.world.canPlace(x, y, def)) return false;
    this.world.place(x, y, def);
    return true;
  }
}
