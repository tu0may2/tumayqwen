// Сети: электропроводка, трубы для жидкости и газа.
// Каждая сеть — связная группа проводов/труб; машины подключаются
// через собственный тайл или соседний по стороне.
import { W, H, BUILDINGS, LAYER } from './world.js';

const KINDS = ['power', 'liquid', 'gas', 'auto'];

export class Networks {
  constructor() {
    this.map = {};
    this.nets = {};
    for (const k of KINDS) { this.map[k] = new Int32Array(W * H).fill(-1); this.nets[k] = []; }
  }

  rebuild(world) {
    for (const k of KINDS) { this.map[k].fill(-1); this.nets[k] = []; }
    const stack = [];
    for (const [, st] of world.bdata) {
      if (!st.built || !st.def.conduit) continue;
      const kind = st.def.conduit;
      const i = st.y * W + st.x;
      if (this.map[kind][i] >= 0) continue;
      const net = this.newNet(kind);
      const id = this.nets[kind].length - 1;
      stack.length = 0; stack.push(i);
      this.map[kind][i] = id;
      while (stack.length) {
        const c = stack.pop();
        net.tiles++;
        const x = c % W, y = (c / W) | 0;
        for (const n of [c - 1, c + 1, c - W, c + W]) {
          if (n < 0 || n >= W * H) continue;
          if (Math.abs((n % W) - x) > 1) continue;
          if (this.map[kind][n] >= 0) continue;
          if (!world.cond[kind][n]) continue;
          const s2 = world.bdata.get(n * 8 + LAYER[kind]);
          if (!s2 || !s2.built) continue;
          this.map[kind][n] = id; stack.push(n);
        }
      }
      net.cap = net.tiles * (kind === 'liquid' ? 10 : kind === 'gas' ? 1 : 0);
      net.wattCap = kind === 'power' ? 1000 : 0;   // предел обычного провода
    }

    // подключение машин
    for (const [, st] of world.bdata) {
      st.net = { power: -1, liquid: -1, gas: -1, auto: -1 };
      if (!st.built || !st.def.net) continue;
      const i = st.y * W + st.x;
      for (const kind of KINDS) {
        if (!st.def.net[kind]) continue;
        for (const n of [i, i - 1, i + 1, i - W, i + W]) {
          if (n < 0 || n >= W * H) continue;
          const id = this.map[kind][n];
          if (id >= 0) { st.net[kind] = id; this.nets[kind][id].machines.push(st); break; }
        }
      }
    }
    world.netDirty = false;
  }

  newNet(kind) {
    const net = { kind, tiles: 0, cap: 0, machines: [], gen: 0, demand: 0, consumed: 0, stored: 0, storeCap: 0, buffer: {} };
    this.nets[kind].push(net);
    return net;
  }

  net(kind, id) { return id >= 0 ? this.nets[kind][id] : null; }

  /** Жидкость/газ в сети: сколько всего килограммов. */
  static amount(net) {
    if (!net) return 0;
    let s = 0;
    for (const v of Object.values(net.buffer)) s += v;
    return s;
  }

  /** Добавить вещество в сеть, вернуть, сколько влезло. */
  static push(net, res, amt) {
    if (!net || amt <= 0) return 0;
    const room = net.cap - Networks.amount(net);
    const put = Math.min(room, amt);
    if (put <= 0) return 0;
    net.buffer[res] = (net.buffer[res] || 0) + put;
    return put;
  }

  /** Забрать вещество (или любое, если res === null). */
  static pull(net, res, amt) {
    if (!net || amt <= 0) return null;
    if (res) {
      const have = net.buffer[res] || 0;
      const got = Math.min(have, amt);
      if (got <= 0) return null;
      net.buffer[res] -= got;
      return { res, amt: got };
    }
    for (const [k, v] of Object.entries(net.buffer)) {
      if (v <= 0) continue;
      const got = Math.min(v, amt);
      net.buffer[k] -= got;
      return { res: k, amt: got };
    }
    return null;
  }
}
