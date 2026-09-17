// Живность: хатчи грызут породу и дают уголь, пуфты чистят воздух, паку живут в воде.
import { W, H } from './world.js';

export const SPECIES = {
  hatch: {
    name: 'Хатч', icon: '🐗', color: '#b0784a', habitat: 'ground',
    eats: ['stone', 'coal', 'copper', 'dirt'], drops: 'coal', dropAmt: 8,
    meat: 30, eatRate: 6, hungerMax: 1200, breedAt: 900, life: 3000,
  },
  puft: {
    name: 'Пуфт', icon: '🫧', color: '#c9a2d8', habitat: 'air',
    gas: 'co2', drops: 'slime', dropAmt: 4,
    meat: 12, eatRate: 0.05, hungerMax: 900, breedAt: 700, life: 2400,
  },
  pacu: {
    name: 'Паку', icon: '🐟', color: '#6fb6c8', habitat: 'water',
    eats: ['algae'], drops: null, dropAmt: 0,
    meat: 25, eatRate: 4, hungerMax: 1000, breedAt: 800, life: 2600,
  },
};

let CID = 1;

export class Critter {
  constructor(species, x, y) {
    this.id = CID++;
    this.sp = species;
    this.def = SPECIES[species];
    this.x = x; this.y = y; this.px = x; this.py = y;
    this.hunger = this.def.hungerMax * 0.6;
    this.age = 0; this.digest = 0; this.dir = Math.random() < 0.5 ? -1 : 1;
    this.hunted = false; this.tame = 0; this.dead = false;
  }

  update(world, game, dt) {
    this.age += dt;
    this.hunger -= this.def.eatRate * 0.25 * dt;
    const i = this.y * W + this.x;

    // среда обитания
    if (this.def.habitat === 'water' && world.water[i] < 100) { this.health = -1; }
    if (this.def.habitat === 'ground' && world.water[i] > 500) this.hunger -= 20 * dt;

    // питание
    if (this.def.gas) {
      const g = world[this.def.gas];
      if (g[i] > 0.02) {
        const eat = Math.min(g[i], this.def.eatRate * dt);
        g[i] -= eat; this.hunger = Math.min(this.def.hungerMax, this.hunger + eat * 400);
        world.o2[i] += eat * 0.3;
        this.digest += eat * 100;
      }
    } else {
      const pile = world.items.get(i);
      if (pile) {
        for (const res of this.def.eats) {
          if (!pile[res]) continue;
          const eat = world.takeItem(i, res, this.def.eatRate * dt);
          this.hunger = Math.min(this.def.hungerMax, this.hunger + eat * 20);
          this.digest += eat;
          break;
        }
      } else if (this.sp === 'hatch' && Math.random() < 0.02 * dt * 60) {
        // грызёт стену рядом
        for (const [dx, dy] of [[this.dir, 0], [0, 1]]) {
          const nx = this.x + dx, ny = this.y + dy;
          if (world.matAt(nx, ny) && world.matAt(nx, ny) !== 8 && world.mine(nx, ny, 3)) break;
        }
      }
    }

    // продукт жизнедеятельности
    if (this.digest > 12) {
      this.digest = 0;
      if (this.def.drops) world.addItem(this.x, this.y, this.def.drops, this.def.dropAmt);
    }

    // размножение
    if (this.hunger > this.def.breedAt && this.age > 200 && Math.random() < 0.004 * dt) {
      if (game.critters.length < 40) {
        game.critters.push(new Critter(this.sp, this.x, this.y));
        this.hunger *= 0.6;
      }
    }

    // смерть
    if (this.hunger <= 0 || this.age > this.def.life || this.health === -1) {
      this.dead = true;
      world.addItem(this.x, this.y, 'food', this.def.meat * 0.5);
      return;
    }

    this.move(world, dt);
  }

  move(world, dt) {
    const speed = this.def.habitat === 'air' ? 1.2 : this.def.habitat === 'water' ? 1.6 : 1.8;
    if (Math.random() < 0.6 * dt) this.dir = -this.dir;

    if (this.def.habitat === 'ground') {
      const nx = this.x + this.dir;
      if (!world.solid(nx, this.y) && world.standable(nx, this.y)) this.x = nx;
      else if (!world.solid(nx, this.y - 1) && world.standable(nx, this.y - 1)) { this.x = nx; this.y--; }
      else this.dir = -this.dir;
      while (!world.standable(this.x, this.y) && !world.solid(this.x, this.y + 1) && this.y < H - 2) this.y++;
    } else if (this.def.habitat === 'air') {
      const nx = this.x + this.dir, ny = this.y + (Math.random() < 0.5 ? -1 : 1);
      if (!world.solid(nx, this.y)) this.x = nx;
      if (!world.solid(this.x, ny) && ny > 1 && ny < H - 1) this.y = ny;
    } else {
      const nx = this.x + this.dir, ny = this.y + (Math.random() < 0.5 ? -1 : 1);
      if (world.water[this.y * W + nx] > 200 && !world.solid(nx, this.y)) this.x = nx;
      if (world.water[ny * W + this.x] > 200 && !world.solid(this.x, ny)) this.y = ny;
    }
    this.px += (this.x - this.px) * Math.min(1, dt * 6);
    this.py += (this.y - this.py) * Math.min(1, dt * 6);
  }
}

/** Заселение мира при генерации. */
export function populate(world, rng) {
  const out = [];
  const tryPlace = (sp, cond) => {
    for (let t = 0; t < 600; t++) {
      const x = 2 + Math.floor(rng() * (W - 4));
      const y = Math.floor(H * 0.25 + rng() * H * 0.7);
      const i = y * W + x;
      if (world.mat[i]) continue;
      if (!cond(world, x, y, i)) continue;
      out.push(new Critter(sp, x, y));
      return true;
    }
    return false;
  };
  for (let n = 0; n < 8; n++) tryPlace('hatch', (w, x, y) => w.standable(x, y) && w.water[y * W + x] < 50);
  for (let n = 0; n < 5; n++) tryPlace('puft', (w, x, y, i) => w.co2[i] > 0.05 && w.water[i] < 20);
  for (let n = 0; n < 6; n++) tryPlace('pacu', (w, x, y, i) => w.water[i] > 500);
  return out;
}
