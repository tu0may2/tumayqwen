// Дупликант: потребности, характер, навыки и исполнение задач.
import { W, BREATH_MIN, BUILDINGS, MATS } from './world.js';
import { findPath, accessCells } from './path.js';
import { JOB_LABEL, storageFor, findResource, reachableResource, reachableStorage } from './jobs.js';
import { randomName, pick, clamp } from './util.js';
import { PLANTS } from './plants.js';
import { THOUGHTS, relationLabel } from './social.js';

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
    this.bladder = 0; this.hygiene = 100; this.fun = 70;
    this.germs = { slimelung: 0, food: 0 };
    this.sick = null;
    this.suitO2 = 0;      // запас кислорода в скафандре
    this.memories = [];   // временные впечатления (как мысли в RimWorld)
    this.rel = new Map(); // мнения о других колонистах
    this.diet = [];       // что ел в последнее время
    this.passions = {};   // увлечения: ускоряют рост навыка
    this.mood = 100; this.moodFactors = [];
    this.carry = null; this.task = 'idle'; this.facing = 1; this.anim = 0;
    this.disabled = {};
    this.prio = {};        // тип работы -> 0 (выкл) … 5 (срочно), по умолчанию 3
    this.bed = null; this.breaking = false; this.retryAt = 0;
    this.traits = [];
    const pool = [...TRAITS];
    for (let i = 0; i < 2; i++) {
      const t = pool.splice(Math.floor(rng() * pool.length), 1)[0];
      this.traits.push(t); t.mod(this);
    }
    for (const sk of ['dig', 'build', 'farm', 'haul']) {
      const r = rng();
      this.passions[sk] = r > 0.82 ? 2 : r > 0.62 ? 1 : 0;   // 2 — страсть, 1 — интерес
    }
    this.color = `hsl(${Math.floor(rng() * 360)},55%,62%)`;
  }

  get idx() { return this.y * W + this.x; }
  get maxCalories() { return 4000; }

  // ------------------------------------------------------------- потребности
  updateNeeds(world, game, dt) {
    const i = this.idx;
    // дышим на уровне головы, а выдыхаем CO₂ вниз — он тяжелее
    const head = world.inside(this.x, this.y - 1) && !world.gasBlocked(i - W) ? i - W : i;
    const o2 = world.o2[head];
    const submerged = world.water[i] > 450 || world.water[head] > 450;   // с головой
    if (submerged) {
      this.oxygen -= (14 / this.lungs) * dt;          // тонет
      this.health -= 1.5 * dt;
    } else if (this.suitO2 > 0 && o2 <= BREATH_MIN) {
      this.suitO2 = Math.max(0, this.suitO2 - 3 * dt);   // дышим из баллона
      this.oxygen = Math.min(100, this.oxygen + 20 * dt);
    } else if (o2 > BREATH_MIN) {
      world.o2[head] = Math.max(0, o2 - 0.0009 * dt * 60 * 0.2);
      world.co2[i] += 0.0006 * dt * 60 * 0.2;
      this.oxygen = Math.min(100, this.oxygen + 25 * dt);
    } else {
      this.oxygen -= (8 / this.lungs) * dt;
    }

    // дозаправка скафандра у дока
    if (this.suitO2 < 100) {
      for (const st of world.allAt(this.x, this.y).concat(world.allAt(this.x + 1, this.y), world.allAt(this.x - 1, this.y))) {
        if (!st.built || !st.def.suit || !st.powered || (st.store.o2 || 0) <= 0.01) continue;
        const take = Math.min(st.store.o2, 0.02 * dt * 60);
        st.store.o2 -= take;
        this.suitO2 = Math.min(100, this.suitO2 + take * 120);
        break;
      }
    }

    // температура: перегрев и переохлаждение
    const T = world.temp[i];
    if (T > 40) { this.health -= (T - 40) * 0.05 * dt; if (T > 70) this.remember('scalded'); }
    if (T < -5) this.health -= (-5 - T) * 0.05 * dt;
    if (this.health < 100) this.health = Math.min(100, this.health + (this.task === 'sleep' ? 1.2 : 0.35) * dt);
    this.calories -= (this.task === 'sleep' ? 0.9 : 1.8) * this.appetite * dt;
    if (this.task === 'sleep') this.stamina = Math.min(100, this.stamina + 0.75 * dt);
    else this.stamina -= 0.22 / this.sleepNeed * dt;

    this.bladder = Math.min(120, this.bladder + (this.task === 'sleep' ? 0.05 : 0.12) * dt);
    this.hygiene = Math.max(0, this.hygiene - 0.05 * dt);
    this.fun = Math.max(0, this.fun - (this.task === 'sleep' ? 0 : 0.07) * dt);

    // микробы: слизь и грязная вода заражают, гигиена защищает
    const germCell = world.germs[i];
    if (germCell > 1) {
      this.germs.slimelung += germCell * 0.0006 * dt * (submerged ? 3 : 1);
      world.germs[i] = Math.max(0, germCell - 0.02 * dt);
    }
    if (world.pwater[i] > 0.4 && world.water[i] > 50) this.germs.food += 0.05 * dt;
    if (this.hygiene > 70) { this.germs.food *= 1 - 0.04 * dt; this.germs.slimelung *= 1 - 0.02 * dt; }
    if (!this.sick) {
      if (this.germs.slimelung > 1) this.sick = { type: 'slimelung', name: 'Слизистая лёгочка', t: 0 };
      else if (this.germs.food > 1) this.sick = { type: 'food', name: 'Пищевое отравление', t: 0 };
      if (this.sick) game.alert(`${this.name} заболел: ${this.sick.name}`);
    } else {
      this.sick.t += dt;
      if (this.sick.type === 'slimelung') { this.health -= 0.5 * dt; this.stamina -= 0.1 * dt; }
      else { this.calories -= 1.2 * dt; this.bladder += 0.25 * dt; }
      const healRate = this.onMedCot ? 4 : 1;
      this.germs[this.sick.type] -= 0.012 * healRate * dt;
      if (this.germs[this.sick.type] <= 0) {
        this.germs[this.sick.type] = 0;
        game.alert(`${this.name} выздоровел.`, true);
        this.sick = null;
    this.suitO2 = 0;      // запас кислорода в скафандре
    this.memories = [];   // временные впечатления (как мысли в RimWorld)
    this.rel = new Map(); // мнения о других колонистах
    this.diet = [];       // что ел в последнее время
    this.passions = {};   // увлечения: ускоряют рост навыка
      }
    }

    // не дотерпел
    if (this.bladder >= 120) {
      this.bladder = 0;
      world.water[i] += 30; world.pwater[i] = 1; world.germs[i] += 400;
      this.stress = Math.min(100, this.stress + 20);
      this.hygiene = Math.max(0, this.hygiene - 50);
      game.alert(`${this.name} не добежал до уборной...`);
    }

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
    if (this.sick) f.push(['Болезнь', -18]);
    if (this.bladder > 80) f.push(['Хочет в уборную', -10]);
    if (this.hygiene < 35) f.push(['Грязный', -8]);
    if (this.fun < 25) f.push(['Скука', -14]); else if (this.fun > 75) f.push(['Отдохнул', +8]);
    if (game.decor > 0) f.push(['Обжитая база', +Math.min(12, game.decor)]);
    const room = game.roomOf(this.x, this.y);
    if (room) f.push([room.name, room.bonus]);
    // воспоминания и отношения
    for (const m of this.memories) m.left -= dt;
    this.memories = this.memories.filter(m => m.left > 0);
    for (const m of this.memories) f.push([m.text, m.value]);
    let social = 0;
    for (const q of game.pawns) {
      if (q === this) continue;
      const op = this.opinion(q);
      if (Math.abs(op) < 20) continue;
      if (Math.abs(q.x - this.x) + Math.abs(q.y - this.y) < 8) social += op > 0 ? 4 : -4;
    }
    if (social) f.push([social > 0 ? 'Рядом друзья' : 'Рядом неприятные люди', Math.max(-12, Math.min(12, social))]);

    this.moodFactors = f;
    const target = clamp(100 + f.reduce((a, b) => a + b[1], 0), 0, 100);
    this.mood += (target - this.mood) * Math.min(1, dt * 0.35);

    const stressPush = (this.mood < 45 ? (45 - this.mood) * 0.05 : -3) * this.stressRate;
    this.stress = clamp(this.stress + stressPush * dt, 0, 100);
    if (this.stress >= 99 && !this.breaking) {
      this.breaking = true; this.dropJob(game);
      const kinds = ['destructive', 'sulk', 'binge'];
      this.breakKind = kinds[Math.floor(Math.random() * kinds.length)];
      const what = { destructive: 'крушит постройки', sulk: 'сидит и плачет', binge: 'заедает стресс' }[this.breakKind];
      game.alert(`${this.name}: нервный срыв — ${what}!`);
      if (this.breakKind === 'destructive') {
        const near = [...world.bdata.values()].filter(st => st.built && !st.def.conduit
          && Math.abs(st.x - this.x) + Math.abs(st.y - this.y) < 6);
        const victim = near[Math.floor(Math.random() * near.length)];
        if (victim) world.removeBuilding(victim.x, victim.y, victim.layer);
      }
      if (this.breakKind === 'binge') this.calories = Math.max(0, this.calories - 600);
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

    if (this.breaking) {
      if (this.breakKind !== 'sulk') this.wander(world);
      this.stress = Math.max(0, this.stress - 1.2 * 0.016);
      this.task = 'idle';
      return;
    }

    // 0. выбраться из воды
    if (world.water[this.idx] > 150) { if (this.planEscapeWater(world)) { this.task = 'breathe'; return; } }
    // 1. воздух
    if (this.oxygen < 45) { if (this.planBreathe(world)) { this.task = 'breathe'; return; } }
    // 2. еда
    if (this.calories < 1500) { if (this.planEat(world, game)) { this.task = 'eat'; return; } }
    // 3. расписание: сон, гигиена, досуг
    const block = game.schedule.at(game.cycleT);
    if (this.stamina < 18 || (block === 'sleep' && this.stamina < 92)) {
      if (this.planSleep(world, game)) { this.task = 'sleep'; return; }
    }
    if (block === 'bath' && (this.hygiene < 90 || this.bladder > 40)) {
      if (this.bladder > 40 && this.planUse(world, game, 'toilet')) { this.task = 'toilet'; return; }
      if (this.planUse(world, game, 'wash')) { this.task = 'wash'; return; }
    }
    if (block === 'rec' && this.fun < 85 && this.planUse(world, game, 'fun')) { this.task = 'fun'; return; }
    // 3.5 личные нужды: уборная, гигиена, лечение, досуг
    if (this.bladder > 75 && this.planUse(world, game, 'toilet')) { this.task = 'toilet'; return; }
    if (this.hygiene < 40 && this.planUse(world, game, 'wash')) { this.task = 'wash'; return; }
    if (this.sick && this.health < 75 && this.planUse(world, game, 'med')) { this.task = 'heal'; return; }
    if (this.fun < 25 && this.planUse(world, game, 'fun')) { this.task = 'fun'; return; }

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
        if (world.water[i] < 60 && world.standable(x, y) && world.o2[i] > BREATH_MIN) goals.add(i);
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
    const found = reachableResource(world, 'meal', this) || reachableResource(world, 'food', this);
    if (!found) return false;
    const src = found.src, res = (src.from ? src.from.store.meal : world.items.get(src.pileIdx)?.meal) ? 'meal' : 'food';
    const steps = [{ go: found.path },
      { act: () => { this.takeFrom(world, src, res, 1000); return true; } }];
    // поесть за столом, если он есть и рядом
    const table = game.findBuilding('table', this);
    if (table) steps.push({ go: null, goals: accessCells(world, table.x, table.y) });
    steps.push({ act: (dt) => {
      if (!this.carry) return true;
      const quality = this.carry.res === 'meal' ? 1.35 : 1;
      const bite = Math.min(this.carry.amt, 900 * dt);
      this.carry.amt -= bite;
      this.calories = Math.min(this.maxCalories, this.calories + bite * quality);
      if (this.carry.res === 'food' && world.germs[this.idx] > 50) this.germs.food += 0.02 * dt;
      if (this.carry.amt <= 0.01 || this.calories >= this.maxCalories - 10) {
        this.diet.push(this.carry.res);
        if (this.diet.length > 4) this.diet.shift();
        if (this.carry.res === 'meal') this.remember('ateGood');
        if (this.diet.length >= 4 && this.diet.every(d => d === this.diet[0])) this.remember('ateSame');
        if (this.carry.amt > 0.01) world.addItem(this.x, this.y, this.carry.res, this.carry.amt);
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
        this.plan = [{ go: p }, { act: () => { if (this.stamina > 97) { this.remember('slept'); return true; } return false; }, label: 'sleep' }];
        return true;
      }
    }
    if (this.stamina < 6) {
      this.remember('sleptFloor');
      this.plan = [{ act: () => this.stamina > 60, label: 'sleep' }];
      return true;
    }
    return false;
  }

  /** Универсальный поход к бытовому зданию: уборная, умывальник, медкойка, автомат. */
  planUse(world, game, kind) {
    const match = st => kind === 'toilet' ? st.def.toilet
      : kind === 'wash' ? st.def.wash
      : kind === 'med' ? st.def.med
      : st.def.fun;
    let best = null, bd = Infinity;
    for (const [, st] of world.bdata) {
      if (!st.built || !match(st) || st.busy) continue;
      if (kind === 'fun' && st.def.power < 0 && !st.powered) continue;
      const d = Math.abs(st.x - this.x) + Math.abs(st.y - this.y);
      if (d < bd) { bd = d; best = st; }
    }
    if (!best) return false;
    const p = findPath(world, this.x, this.y, accessCells(world, best.x, best.y));
    if (!p) return false;
    best.busy = this;
    const use = (dt) => {
      best.busy = this;
      const i = best.y * W + best.x;
      if (kind === 'toilet') {
        this.bladder = Math.max(0, this.bladder - 60 * dt);
        this.hygiene = Math.max(0, this.hygiene - 8 * dt);
        if (this.bladder <= 0) {
          best.uses = (best.uses || 0) + 1;
          if ((best.store.dirt || 0) > 5) best.store.dirt -= 5;
          world.addItem(best.x, best.y, 'pdirt', 6);
          world.germs[i] += 60;
          best.busy = null; return true;
        }
      } else if (kind === 'wash') {
        const need = best.def.net?.liquid ? (best.store.water || 0) > 0.5 : true;
        if (!need) { best.busy = null; return true; }
        if (best.store.water) best.store.water -= 5 * dt;
        this.hygiene = Math.min(100, this.hygiene + 45 * dt);
        this.germs.food *= 1 - 1.2 * dt;
        this.germs.slimelung *= 1 - 0.5 * dt;
        world.germs[i] += 4 * dt;
        if (this.hygiene >= 99) { best.busy = null; return true; }
      } else if (kind === 'med') {
        this.onMedCot = true;
        this.health = Math.min(100, this.health + 3 * dt);
        this.stamina = Math.min(100, this.stamina + 0.5 * dt);
        if (!this.sick && this.health > 95) { this.onMedCot = false; best.busy = null; return true; }
      } else {
        this.fun = Math.min(100, this.fun + 12 * dt);
        this.stress = Math.max(0, this.stress - 3 * dt);
        if (this.fun >= 85) { best.busy = null; return true; }
      }
      return false;
    };
    this.plan = [{ go: p }, { act: use, label: kind === 'toilet' ? 'toilet' : kind === 'wash' ? 'wash' : kind === 'med' ? 'heal' : 'fun' }];
    return true;
  }

  startJob(world, game, job, path) {
    this.job = job;
    this.task = job.type;
    const steps = [];
    if (job.type === 'supply' || job.type === 'haul') {
      if (job.type === 'haul') {
        const target = reachableStorage(world, job.res, this);
        if (!target) { game.board.postpone(job, game.time + 20); this.dropJob(game); return; }
        steps.push({ go: path });
        steps.push({ act: () => { this.takeFrom(world, { x: job.x, y: job.y, pileIdx: job.y * W + job.x }, job.res, 100); return true; } });
        steps.push({ goals: accessCells(world, target.bin.x, target.bin.y) });
        steps.push({ act: () => { this.deposit(world, target.bin); return true; } });
      } else {
        const found = reachableResource(world, job.res, this);
        if (!found) { game.board.postpone(job, game.time + 20); this.dropJob(game); return; }
        const src = found.src;
        steps.push({ go: found.path });
        steps.push({ act: () => { this.takeFrom(world, src, job.res, job.amount); return true; } });
        steps.push({ goals: accessCells(world, job.x, job.y) });
        steps.push({ act: () => { this.deliverToSite(world, job); return true; } });
      }
    } else if (job.type === 'dig') {
      steps.push({ go: path });
      steps.push({ act: (dt) => {
        if (!world.mat[job.y * W + job.x]) return true;
        const mat = world.mat[job.y * W + job.x];
        const done = world.mine(job.x, job.y, this.workRate('dig') * dt * 4);
        this.gain('dig', dt);
        this.dustAt = (this.dustAt || 0) - dt;
        if (this.dustAt <= 0) {
          this.dustAt = 0.22;
          game.fx.push({ x: job.x, y: job.y, big: done, color: MATS[mat]?.color || '#c8b49a' });
        }
        return done;
      }, label: 'dig' });
    } else if (job.type === 'build') {
      steps.push({ go: path });
      steps.push({ act: (dt) => {
        const st = world.bdata.get(job.k);
        if (!st || st.built) return true;
        st.prog += this.workRate('build') * dt * 3;
        this.gain('build', dt);
        if (st.prog >= st.def.work) { st.built = true; st.prog = st.def.work; return true; }
        return false;
      }, label: 'build' });
    } else if (job.type === 'deconstruct') {
      steps.push({ go: path });
      steps.push({ act: (dt) => {
        const st = world.bdata.get(job.k);
        if (!st) return true;
        st.prog -= this.workRate('build') * dt * 4;
        if (st.prog <= 0) { world.removeBuilding(job.x, job.y); return true; }
        return false;
      }, label: 'deconstruct' });
    } else if (job.type === 'harvest') {
      steps.push({ go: path });
      steps.push({ act: (dt) => {
        const st = world.bdata.get(job.k);
        if (!st || st.growth < 1) return true;
        st.growth = 0; st.planted = true;
        const crop = PLANTS[st.plant] || { yield: 'food', amount: 18 };
        world.addItem(job.x, job.y, crop.yield, crop.amount + this.skills.farm * 3);
        this.gain('farm', 1);
        return true;
      }, label: 'harvest' });
    } else if (job.type === 'hunt') {
      steps.push({ go: path });
      steps.push({ act: (dt) => {
        const c = game.critters.find(k => k.id === job.cid);
        if (!c || c.dead) return true;
        if (Math.abs(c.x - this.x) + Math.abs(c.y - this.y) > 2) return true;   // убежал — новая задача
        c.hp = (c.hp ?? 10) - this.workRate('dig') * dt * 4;
        if (c.hp <= 0) {
          c.dead = true;
          world.addItem(c.x, c.y, 'food', c.def.meat);
          game.alert(`${this.name} добыл ${c.def.name.toLowerCase()}а.`, true);
          return true;
        }
        return false;
      }, label: 'hunt' });
    } else if (job.type === 'cook') {
      steps.push({ go: path });
      steps.push({ act: (dt) => {
        const st = world.bdata.get(job.k);
        if (!st || (st.store.food || 0) < 5) return true;
        st.cookProg = (st.cookProg || 0) + this.workRate('build') * dt * 2;
        if (st.cookProg >= 10) {
          st.cookProg = 0;
          st.store.food -= 5;
          world.addItem(job.x, job.y, 'meal', 5);
          this.gain('farm', 1);
          return true;
        }
        return false;
      }, label: 'cook' });
    } else if (job.type === 'research') {
      steps.push({ go: path });
      steps.push({ act: (dt) => {
        const st = world.bdata.get(job.k);
        if (!st || !st.powered || !game.research.current) return true;
        game.research.progress += this.workRate('build') * dt * 1.4;
        this.gain('build', dt * 0.5);
        return game.research.check();
      }, label: 'research' });
    } else if (job.type === 'operate') {
      steps.push({ go: path });
      steps.push({ act: (dt) => {
        const st = world.bdata.get(job.k);
        if (!st || !st.built) return true;
        st.operating = 0.6;
        this.stamina -= 3 * dt;
        return game.power.deficit <= 0 || this.stamina < 12;
      }, label: 'operate' });
    }
    this.plan = steps;
  }

  prioOf(type) { return this.prio[type] ?? 3; }

  // --- социальное -----------------------------------------------------------
  opinion(other) { return this.rel.get(other.id) || 0; }
  addOpinion(other, d) {
    this.rel.set(other.id, Math.max(-100, Math.min(100, this.opinion(other) + d)));
  }
  relationTo(other) { return relationLabel(this.opinion(other)); }

  remember(key) {
    const t = THOUGHTS[key];
    if (!t) return;
    const old = this.memories.find(m => m.key === key);
    if (old) { old.left = t.dur; return; }
    this.memories.push({ key, text: t.text, value: t.value, left: t.dur });
  }

  workRate(skill) {
    const passion = 1 + (this.passions[skill] || 0) * 0.12;
    return this.skills[skill] * this.workMul * passion * (0.6 + this.mood / 250);
  }
  gain(skill, dt) {
    this.xp[skill] += dt * (1 + (this.passions[skill] || 0) * 0.6);
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
    const st = world.bdata.get(job.k);
    if (!st) { world.addItem(this.x, this.y, this.carry.res, this.carry.amt); this.carry = null; return; }
    if (!st.built) {
      st.delivered = st.delivered || {};
      const need = Math.max(0, (st.def.cost[this.carry.res] || 0) - (st.delivered[this.carry.res] || 0));
      const put = Math.min(need, this.carry.amt);
      st.delivered[this.carry.res] = (st.delivered[this.carry.res] || 0) + put;
      if (this.carry.amt - put > 0.01) world.addItem(this.x, this.y, this.carry.res, this.carry.amt - put);
    } else if (st.def.farm) {
      st.store[this.carry.res] = (st.store[this.carry.res] || 0) + this.carry.amt;
      if (this.carry.res === 'ice') { st.store.water = (st.store.water || 0) + this.carry.amt; delete st.store.ice; }
      if (!st.planted) { st.planted = true; st.growth = 0; }
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
      if (!p) {
        game.board.postpone(this.job, game.time + 15);
        this.dropJob(game); this.retryAt = game.time + 1;
        return;
      }
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
    if (!world.standable(this.x, this.y) && !world.solid(this.x, this.y + 1)) {
      this.y++;
      this.fallFrom = this.fallFrom ?? this.y - 1;
    } else if (this.fallFrom !== undefined) {
      const h = this.y - this.fallFrom;
      if (h > 4) { this.health -= (h - 4) * 7; this.remember('fell'); }
      this.fallFrom = undefined;
    }
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
    const deep = world.water[this.idx];
    const swim = deep > 400 ? 0.45 : deep > 120 ? 0.7 : 1;      // по пояс в воде не побегаешь
    const v = this.speed * (climbing && Math.abs(dy) > 0.1 ? 0.65 : 1) * (this.mood < 35 ? 0.8 : 1) * swim;
    const stepLen = v * dt;
    if (d <= stepLen + 1e-4) {            // доходим ровно до узла, без «перелёта»
      this.px = n.x; this.py = n.y; this.x = n.x; this.y = n.y;
      path.shift();
      if (Math.abs(dx) > 0.05) this.facing = dx > 0 ? 1 : -1;
      this.anim += dt * 9;
      return path.length === 0;
    }
    this.px += (dx / d) * stepLen;
    this.py += (dy / d) * stepLen;
    if (Math.abs(dx) > 0.05) this.facing = dx > 0 ? 1 : -1;
    this.x = Math.round(this.px); this.y = Math.round(this.py);
    this.anim += dt * 9;
    this.path = path;
    return false;
  }

  statusText() { return JOB_LABEL[this.task] || this.task; }
}
