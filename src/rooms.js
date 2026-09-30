// Комнаты: замкнутые помещения дают бонусы к настроению, как в ONI.
import { W, H } from './world.js';

const MAX_ROOM = 120;

export const ROOM_TYPES = [
  { key: 'bedroom', name: 'Спальня',  need: st => st.def.sleep,  bonus: 8 },
  { key: 'mess',    name: 'Столовая', need: st => st.def.eat,    bonus: 6 },
  { key: 'latrine', name: 'Санузел',  need: st => st.def.toilet, bonus: 4 },
  { key: 'rec',     name: 'Зона отдыха', need: st => st.def.fun, bonus: 6 },
  { key: 'lab',     name: 'Лаборатория', need: st => st.def.manualWork === 'research', bonus: 3 },
];

/** Найти замкнутые помещения и приписать их постройкам. */
export function findRooms(world) {
  const seen = new Uint8Array(W * H);
  const rooms = [];
  for (const [, st] of world.bdata) {
    if (!st.built || st.def.conduit) continue;
    const start = st.y * W + st.x;
    if (seen[start]) continue;
    const tiles = [];
    const stack = [start];
    seen[start] = 1;
    let sealed = true;
    while (stack.length) {
      const c = stack.pop();
      tiles.push(c);
      if (tiles.length > MAX_ROOM) { sealed = false; break; }
      const cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) { sealed = false; continue; }
        const n = ny * W + nx;
        if (world.gasBlocked(n)) continue;       // стена, плитка или дверь — граница
        if (seen[n]) continue;
        seen[n] = 1; stack.push(n);
      }
    }
    if (!sealed) continue;
    const set = new Set(tiles);
    const inside = [];
    for (const [, s2] of world.bdata) if (s2.built && set.has(s2.y * W + s2.x)) inside.push(s2);
    const type = ROOM_TYPES.find(t => inside.some(t.need));
    if (!type) continue;
    const decor = inside.reduce((a, b) => a + (b.def.decor || 0), 0);
    const room = { type: type.key, name: type.name, bonus: type.bonus + Math.min(8, decor), tiles: set, buildings: inside };
    for (const s2 of inside) s2.room = room;
    rooms.push(room);
  }
  return rooms;
}

export function roomAt(rooms, x, y) {
  const i = y * W + x;
  return rooms.find(r => r.tiles.has(i)) || null;
}
