// Дупликант: потребности, характер, навыки и исполнение задач.
import { W, BREATH_MIN, BUILDINGS } from './world.js';
import { findPath, accessCells } from './path.js';
import { JOB_LABEL, storageFor, findResource } from './jobs.js';
import { randomName, pick, clamp } from './util.js';

export const TRAITS = [
  { key: 'strong',   name: 'Силач',        desc: '+40% к копанию',            mod: p => p.skills.dig += 0.4 },
  { key: 'builder',  name: 'Мастеровой',   desc: '+40% к строительству',      mod: p => p.skills.build += 0.4 },
  { key: 'green',    name: 'Агроном',      desc: '+50% к фермерству',         mod: p => p.skills.farm += 0.5 },
  { key: 'fast',     name: 'Быстрые ноги', desc: '+30% к скорости',           mod: p => p.speed *= 1.3 },
  { key: 'lungs',    name: 'Ёмкие лёгкие', desc: 'дольше держится без O₂',    mod: p => p.lungs = 2.0 },
  { key: 'glutton',  name: 'Обжора',       desc: 'ест на 40% больше',         mod: p => p.appetite = 1.4 },
  { key: 'nervous',  name: 'Нервный',      desc: 'стресс растёт быстрее',     mod: p => p.stressRate = 1.6 },
  { key: 'calm',     name: 'Хладнокровный',desc: 'стресс растёт медленнее',   mod: p => p.stressRate = 0.55 },
  { key: 'owl',      name: 'Сова',         desc: 'меньше спит',               mod: p => p.sleepNeed = 0.7 },
  { key: 'lazy',     name: 'Лентяй',       desc: '-25% ко всей работе',       mod: p => p.workMul = 0.75 },
];

let UID = 1;

export class Pawn {
  constructor(world, x, y, rng) {
    this.id = UID++;
    this.name = randomName(rng);
    this.x = x; this.y = y;
    this.px = x; this.py = y;
    this.path = null; this.plan = []; this.job = null;
    this.speed = 3.4;            // тайлов/с
    this.lungs = 1; this.appetite = 1; this.stressRate = 1; this.sleepNeed = 1; this.workMul = 1;
    this.skills = { dig: 1, build: 1, farm: 1, haul: 1 };
    this.xp = { dig: 0, build: 0, farm: 0, haul: 0 };
    this.oxygen = 100; this.calories = 3000; this.stamina = 100; this.stress = 0; this.health = 100;
    this.mood = 100; this.moodFactors = [];
    this.carry = null; this.task = 'idle'; this.facing = 1; this.anim = 0;
    this.disabled = {};
    this.bed = null; this.breaking = false; this.retryAt = 0;
    this.traits = [];
    const pool = [...TRAITS];
    for (let i = 0; i < 2; i++) {
      const t = pool.splice(Math.floor(rng() * pool.length), 1)[0];
      this.traits.push(t); t.mod(this);
    }
    this.color = `hsl(${Math.floor(rng() * 360)},55%,62%)`;
  }

  get idx() { return this.y * W + this.x; }
  get maxCalories() { return 4000; }

  // ------------------------------------------------------------- потребности
  updateNeeds(world, game, dt) {
    const i = this.idx;
    const o2 = world.o2[i];
    const submerged = world.water[i] > 300;
    if (submerged) {
      this.oxygen -= (14 / this.lungs) * dt;          // тонет
      this.health -= 1.5 * dt;
    } else if (o2 > BREATH_MIN) {
      world.o2[i] = Math.max(0, o2 - 0.0009 * dt * 60 * 0.2);
      world.co2[i] += 0.0006 * dt * 60 * 0.2;
      this.oxygen = Math.min(100, this.oxygen + 25 * dt);
    } else {
      this.oxygen -= (8 / this.lungs) * dt;
    }

    // температура: перегрев и переохлаждение
    const T = world.temp[i];
    if (T > 40) this.health -= (T - 40) * 0.05 * dt;
    if (T < -5) this.health -= (-5 - T) * 0.05 * dt;
    if (this.health < 100) this.health = Math.min(100, this.health + (this.task === 'sleep' ? 1.2 : 0.35) * dt);
    this.calories -= (this.task === 'sleep' ? 0.9 : 1.8) * this.appetite * dt;
    if (this.task === 'sleep') this.stamina = Math.min(100, this.stamina + 0.75 * dt);
    else this.stamina -= 0.22 / this.sleepNeed * dt;

    this.calories = Math.max(-2000, this.calories);
    this.stamina = clamp(this.stamina, 0, 100);
    this.oxygen = clamp(this.oxygen, 0, 100);

    // настроение
    const f = [];
    if (this.calories < 800) f.push(['Голод', -25]);
    else if (this.calories > 3200) f.push(['Сыт', +8]);
    if (this.oxygen < 60) f.push(['Нехватка кислорода', -20]);
    if (this.stamina < 20) f.push(['Хочет спать', -15]);
    if (this.bed) f.push(['Своя койка', +10]);
    if (world.light[i] > 0.4) f.push(['Светло', +5]); else f.push(['Темнота', -6]);
    if (world.co2[i] > 0.9) f.push(['Смрад CO₂', -12]);
    if (world.water[i] > 100) f.push(['Мокрые ноги', -8]);
    if (T > 35) f.push(['Жарко', -12]); else if (T < 5) f.push(['Холодно', -12]);
    if (this.health < 60) f.push(['Плохое самочувствие', -15]);
    if (game.decor > 0) f.push(['Обжитая база', +Math.min(12, game.decor)]);
    this.moodFactors = f;
    const target = clamp(100 + f.reduce((a, b) => a + b[1], 0), 0, 100);
    this.mood += (target - this.mood) * Math.min(1, dt * 0.35);

    const stressPush = (this.mood < 45 ? (45 - this.mood) * 0.05 : -3) * this.stressRate;
    this.stress = clamp(this.stress + stressPush * dt, 0, 100);
    if (this.stress >= 99 && !this.breaking) {
      this.breaking = true; this.dropJob(game);
      game.alert(`${this.name}: нервный срыв!`);
    }
    if (this.breaking && this.stress < 55) { this.breaking = false; game.alert(`${this.name} успокоился.`, true); }

    if (this.oxygen <= 0 || this.calories <= -1500 || this.health <= 0) {
      game.kill(this, this.oxygen <= 0 ? (submerged ? 'утонул' : 'задохнулся')
        : this.health <= 0 ? 'погиб от травм' : 'умер от голода');
    }
  }

  dropJob(game) {
    if (this.job) game.board.claimed.delete(this.job.key);
    this.job = null; this.plan = []; this.path = null;
  }

  // -------------------------------------------------------------- поведение
  think(world, game) {
    if (this.plan.length) return;

    if (this.breaking) { this.wander(world); this.task = 'idle'; return; }

    // 0. выбраться из воды
    if (world.water[this.idx] > 300) { if (this.planEscapeWater(world)) { this.task = 'breathe'; return; } }
    // 1. воздух
    if (this.oxygen < 45) { if (this.planBreathe(world)) { this.task = 'breathe'; return; } }
    // 2. еда
    if (this.calories < 1500) { if (this.planEat(world, game)) { this.task = 'eat'; return; } }
    // 3. сон
    const night = game.cycleT > 0.75;
    if (this.stamina < 18 || (night && this.stamina < 65)) {
      if (this.planSleep(world, game)) { this.task = 'sleep'; return; }
    }
    // 4. работа
    if (game.time > this.retryAt) {
      const got = game.board.assign(world, this, game);
      if (got) { this.startJob(world, game, got.job, got.path); return; }
      this.retryAt = game.time + 1.2;
    }
    this.task = 'idle';
    this.wander(world);
  }

  wander(world) {
    if (Math.random() < 0.985) return;
    const goals = new Set();
    for (let k = 0; k < 12; k++) {
      const nx = this.x + Math.floor((Math.random() - 0.5) * 14);
      const ny = this.y + Math.floor((Math.random() - 0.5) * 6);
      if (world.inside(nx, ny) && world.standable(nx, ny)) goals.add(ny * W + nx);
    }
    const p = findPath(world, this.x, this.y, goals, 1500);
    if (p) this.plan = [{ go: p }];
  }

  planEscapeWater(world) {
    const goals = new Set();
    for (let y = Math.max(1, this.y - 12); y < this.y + 4; y++)
      for (let x = Math.max(1, this.x - 16); x < this.x + 16; x++) {
        if (!world.inside(x, y)) continue;
        const i = y * W + x;
        if (world.water[i] < 100 && world.standable(x, y) && world.o2[i] > BREATH_MIN) goals.add(i);
      }
    const p = goals.size ? findPath(world, this.x, this.y, goals) : null;
    if (!p) return false;
    this.dropJobSoft();
    this.plan = [{ go: p }];
    return true;
  }

  dropJobSoft() { this.plan = []; }

  planBreathe(world) {
    const goals = new Set();
    let best = Infinity;
    for (let y = Math.max(1, this.y - 20); y < Math.min(world.o2.length / W - 1, this.y + 20); y++) {
      for (let x = Math.max(1, this.x - 30); x < this.x + 30; x++) {
        if (!world.inside(x, y)) continue;
        const i = y * W + x;
        if (world.o2[i] > BREATH_MIN * 2.5 && world.standable(x, y)) {
          const d = Math.abs(x - this.x) + Math.abs(y - this.y);
          if (d < best) { best = d; goals.clear(); goals.add(i); }
        }
      }
    }
    const p = goals.size ? findPath(world, this.x, this.y, goals) : null;
    if (!p) return false;
    this.plan = [{ go: p }, { act: () => this.oxygen > 92, label: 'breathe' }];
    return true;
  }

  planEat(world, game) {
    const src = findResource(world, 'food', this);
    if (!src) return false;
    const steps = [{ go: null, goals: accessCells(world, src.x, src.y) },
      { act: () => { this.takeFrom(world, src, 'food', 1000); return true; } }];
    // поесть за столом, если он есть и рядом
    const table = game.findBuilding('table', this);
    if (table) steps.push({ go: null, goals: accessCells(world, table.x, table.y) });
    steps.push({ act: (dt) => {
      if (!this.carry) return true;
      const bite = Math.min(this.carry.amt, 900 * dt);
      this.carry.amt -= bite; this.calories = Math.min(this.maxCalories, this.calories + bite);
      if (this.carry.amt <= 0.01 || this.calories >= this.maxCalories - 10) {
        if (this.carry.amt > 0.01) world.addItem(this.x, this.y, 'food', this.carry.amt);
        this.carry = null; return true;
      }
      return false;
    }, label: 'eat' });
    this.plan = steps;
    return true;
  }

  planSleep(world, game) {
    let bed = game.claimBed(this);
    const goals = bed ? accessCells(world, bed.x, bed.y) : null;
    if (goals) {
      const p = findPath(world, this.x, this.y, goals);
      if (p) {
        this.plan = [{ go: p }, { act: () => this.stamina > 97, label: 'sleep' }];
        return true;
      }
    }
    if (this.stamina < 6) { this.plan = [{ act: () => this.stamina > 60, label: 'sleep' }]; return true; }
    return false;
  }

  startJob(world, game, job, path) {
    this.job = job;
    this.task = job.type;
    const steps = [];
    if (job.type === 'supply' || job.type === 'haul') {
      if (job.type === 'haul') {
        const bin = storageFor(world, job.res);
        steps.push({ go: path });
        steps.push({ act: () => { this.takeFrom(world, { x: job.x, y: job.y, pileIdx: job.y * W + job.x }, job.res, 100); return true; } });
        if (!bin) { this.plan = steps; return; }
        steps.push({ goals: accessCells(world, bin.x, bin.y) });
        steps.push({ act: () => { this.deposit(world, bin); return true; } });
      } else {
        const src = findResource(world, job.res, this);
        if (!src) { this.dropJob(game); return; }
        steps.push({ goals: accessCells(world, src.x, src.y) });
        steps.push({ act: () => { this.takeFrom(world, src, job.res, job.amount); return true; } });
        steps.push({ goals: accessCells(world, job.x, job.y) });
        steps.push({ act: () => { this.deliverToSite(world, job); return true; } });
      }
    } else if (job.type === 'dig') {
      steps.push({ go: path });
      steps.push({ act: (dt) => {
        if (!world.mat[job.y * W + job.x]) return true;
        const done = world.mine(job.x, job.y, this.workRate('dig') * dt * 4);
        this.gain('dig', dt);
        return done;
      }, label: 'dig' });
    } else if (job.type === 'build') {
      steps.push({ go: path });
      steps.push({ act: (dt) => {
        const st = world.bdata.get(job.y * W + job.x);
        if (!st || st.built) return true;
        st.prog += this.workRate('build') * dt * 3;
        this.gain('build', dt);
        if (st.prog >= st.def.work) { st.built = true; st.prog = st.def.work; return true; }
        return false;
      }, label: 'build' });
    } else if (job.type === 'deconstruct') {
      steps.push({ go: path });
      steps.push({ act: (dt) => {
        const st = world.bdata.get(job.y * W + job.x);
        if (!st) return true;
        st.prog -= this.workRate('build') * dt * 4;
        if (st.prog <= 0) { world.removeBuilding(job.x, job.y); return true; }
        return false;
      }, label: 'deconstruct' });
    } else if (job.type === 'harvest') {
      steps.push({ go: path });
      steps.push({ act: (dt) => {
        const st = world.bdata.get(job.y * W + job.x);
        if (!st || st.growth < 1) return true;
        st.growth = 0; st.planted = true;
        world.addItem(job.x, job.y, 'food', 18 + this.skills.farm * 4);
        this.gain('farm', 1);
        return true;
      }, label: 'harvest' });
    } else if (job.type === 'operate') {
      steps.push({ go: path });
      steps.push({ act: (dt) => {
        const st = world.bdata.get(job.y * W + job.x);
        if (!st || !st.built) return true;
        st.operating = 0.6;
        this.stamina -= 3 * dt;
        return game.power.deficit <= 0 || this.stamina < 12;
      }, label: 'operate' });
    }
    this.plan = steps;
  }

  workRate(skill) { return this.skills[skill] * this.workMul * (0.6 + this.mood / 250); }
  gain(skill, dt) {
    this.xp[skill] += dt;
    const lvl = 1 + Math.sqrt(this.xp[skill]) * 0.22;
    this.skills[skill] = Math.max(this.skills[skill], lvl);
  }

  takeFrom(world, src, res, amount) {
    let got = 0;
    if (src.from && src.from.store) {
      got = Math.min(src.from.store[res] || 0, amount);
      src.from.store[res] -= got;
      if (src.from.store[res] <= 1e-6) delete src.from.store[res];
    } else {
      got = world.takeItem(src.pileIdx ?? (src.y * W + src.x), res, amount);
    }
    if (got > 0) this.carry = { res, amt: got };
    this.gain('haul', 0.3);
  }

  deposit(world, bin) {
    if (!this.carry) return;
    const used = Object.values(bin.store).reduce((a, b) => a + b, 0);
    const room = Math.max(0, bin.def.cap - used);
    const put = Math.min(room, this.carry.amt);
    bin.store[this.carry.res] = (bin.store[this.carry.res] || 0) + put;
    this.carry.amt -= put;
    if (this.carry.amt > 0.01) world.addItem(this.x, this.y, this.carry.res, this.carry.amt);
    this.carry = null;
  }

  deliverToSite(world, job) {
    if (!this.carry) return;
    const st = world.bdata.get(job.y * W + job.x);
    if (!st) { world.addItem(this.x, this.y, this.carry.res, this.carry.amt); this.carry = null; return; }
    if (!st.built) {
      st.delivered = st.delivered || {};
      const need = Math.max(0, (st.def.cost[this.carry.res] || 0) - (st.delivered[this.carry.res] || 0));
      const put = Math.min(need, this.carry.amt);
      st.delivered[this.carry.res] = (st.delivered[this.carry.res] || 0) + put;
      if (this.carry.amt - put > 0.01) world.addItem(this.x, this.y, this.carry.res, this.carry.amt - put);
    } else if (st.def.farm && this.carry.res === 'dirt') {
      st.planted = true; st.growth = 0;
    } else {
      st.store[this.carry.res] = (st.store[this.carry.res] || 0) + this.carry.amt;
    }
    this.carry = null;
  }

  // ---------------------------------------------------------------- шаг ИИ
  update(world, game, dt) {
    this.updateNeeds(world, game, dt);
    if (this.dead) return;
    this.think(world, game);

    const step = this.plan[0];
    if (!step) { this.settle(world, dt); return; }

    if (step.goals && !step.go) {
      const p = findPath(world, this.x, this.y, step.goals);
      if (!p) { this.dropJob(game); this.retryAt = game.time + 1.5; return; }
      step.go = p;
    }
    if (step.go) {
      if (this.follow(world, step.go, dt)) { this.plan.shift(); }
      this.task = this.job ? this.job.type : (step.label || this.task);
      return;
    }
    if (step.act) {
      this.task = step.label || this.task;
      if (step.act(dt)) {
        this.plan.shift();
        if (!this.plan.length && this.job) { game.board.claimed.delete(this.job.key); this.job = null; }
      }
    }
    this.settle(world, dt);
  }

  /** Гравитация и сглаживание позиции, когда дупликант не идёт. */
  settle(world, dt) {
    if (!world.standable(this.x, this.y) && !world.solid(this.x, this.y + 1)) this.y++;
    this.px += (this.x - this.px) * Math.min(1, dt * 12);
    this.py += (this.y - this.py) * Math.min(1, dt * 12);
  }

  follow(world, path, dt) {
    if (!path.length) return true;
    const n = path[0];
    if (world.solid(n.x, n.y)) { this.plan = []; this.path = null; return true; }
    const dx = n.x - this.px, dy = n.y - this.py;
    const d = Math.hypot(dx, dy);
    const climbing = world.climbable(this.x, this.y) || world.climbable(n.x, n.y);
    const v = this.speed * (climbing && Math.abs(dy) > 0.1 ? 0.65 : 1) * (this.mood < 35 ? 0.8 : 1);
    if (d < 0.08) {
      this.px = n.x; this.py = n.y; this.x = n.x; this.y = n.y;
      path.shift();
      return path.length === 0;
    }
    this.px += (dx / d) * v * dt;
    this.py += (dy / d) * v * dt;
    if (Math.abs(dx) > 0.05) this.facing = dx > 0 ? 1 : -1;
    this.x = Math.round(this.px); this.y = Math.round(this.py);
    this.anim += dt * 9;
    this.path = path;
    return false;
  }

  statusText() { return JOB_LABEL[this.task] || this.task; }
}
