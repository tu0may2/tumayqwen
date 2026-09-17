// A* по тайлам: ходьба по полу, лазание по лестницам, падения.
import { W, H } from './world.js';

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node, f) {
    this.a.push({ node, f });
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.a[p].f <= this.a[i].f) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]]; i = p;
    }
  }
  pop() {
    const top = this.a[0], last = this.a.pop();
    if (this.a.length) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < this.a.length && this.a[l].f < this.a[m].f) m = l;
        if (r < this.a.length && this.a[r].f < this.a[m].f) m = r;
        if (m === i) break;
        [this.a[m], this.a[i]] = [this.a[i], this.a[m]]; i = m;
      }
    }
    return top.node;
  }
}

/** Куда можно шагнуть из (x,y). cb(nx, ny, cost). */
export function neighbors(world, x, y, cb) {
  const onFoot = world.standable(x, y) || world.climbable(x, y);
  if (onFoot) {
    for (const dx of [-1, 1]) {
      const nx = x + dx;
      if (world.solid(nx, y)) continue;
      if (world.standable(nx, y) || world.climbable(nx, y)) { cb(nx, y, 1); continue; }
      // шаг в пустоту: падаем, если внизу есть куда приземлиться
      let fy = y;
      while (fy - y < 8 && !world.solid(nx, fy + 1) && !world.standable(nx, fy + 1)) fy++;
      if (!world.solid(nx, fy + 1) || world.standable(nx, fy + 1)) {
        if (world.standable(nx, fy + 1)) cb(nx, fy + 1, 1 + (fy - y) * 0.6);
      }
    }
  }
  if (world.climbable(x, y) && !world.solid(x, y - 1)) cb(x, y - 1, 1.3);
  if (!world.solid(x, y + 1) && (world.climbable(x, y + 1) || world.standable(x, y + 1))) cb(x, y + 1, 1.1);
}

/**
 * Путь от (sx,sy) до любой из целевых клеток.
 * goals — Set индексов. Возвращает массив [{x,y}, ...] или null.
 */
export function findPath(world, sx, sy, goals, limit = 7000) {
  if (!goals || !goals.size) return null;
  const start = sy * W + sx;
  if (goals.has(start)) return [];
  const came = new Map(), g = new Map();
  const open = new Heap();
  // эвристика — до ближайшей цели
  let gx = 0, gy = 0, best = Infinity;
  for (const gi of goals) {
    const x = gi % W, y = (gi / W) | 0;
    const d = Math.abs(x - sx) + Math.abs(y - sy);
    if (d < best) { best = d; gx = x; gy = y; }
  }
  const h = (x, y) => Math.abs(x - gx) + Math.abs(y - gy);
  g.set(start, 0);
  open.push(start, h(sx, sy));
  let visited = 0;

  while (open.size) {
    const cur = open.pop();
    if (goals.has(cur)) {
      const path = [];
      let c = cur;
      while (c !== start) { path.push({ x: c % W, y: (c / W) | 0 }); c = came.get(c); }
      return path.reverse();
    }
    if (++visited > limit) break;
    const cx = cur % W, cy = (cur / W) | 0, cg = g.get(cur);
    neighbors(world, cx, cy, (nx, ny, cost) => {
      const ni = ny * W + nx;
      const ng = cg + cost;
      if (g.has(ni) && g.get(ni) <= ng) return;
      g.set(ni, ng); came.set(ni, cur);
      open.push(ni, ng + h(nx, ny));
    });
  }
  return null;
}

/** Клетки, из которых можно взаимодействовать с (x,y). */
export function accessCells(world, x, y, includeSelf = true) {
  const out = new Set();
  const add = (ax, ay) => {
    if (!world.inside(ax, ay)) return;
    if (world.standable(ax, ay) || world.climbable(ax, ay)) out.add(ay * W + ax);
  };
  if (includeSelf) add(x, y);
  add(x - 1, y); add(x + 1, y); add(x, y - 1); add(x, y + 1);
  add(x - 1, y - 1); add(x + 1, y - 1); add(x - 1, y + 1); add(x + 1, y + 1);
  return out;
}
