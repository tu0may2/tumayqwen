// Физика флюидов: давление газа, плавучесть по плотности, жидкости со сжатием,
// фазовые переходы (лёд ↔ вода ↔ пар), перенос тепла вместе с массой.
import { W, H, MATS, BUILDINGS } from './world.js';

// ---- газы: молярная масса (кг/кмоль) определяет, что всплывает, а что оседает
export const GASES = [
  { key: 'o2',    name: 'Кислород',       M: 32, color: [120, 200, 235] },
  { key: 'co2',   name: 'Углекислый газ', M: 44, color: [120, 120, 130] },
  { key: 'steam', name: 'Водяной пар',    M: 18, color: [225, 235, 240] },
  { key: 'h2',    name: 'Водород',        M: 2,  color: [200, 160, 235] },
];

export const LIQ_FULL = 1000;     // кг воды в «полном» тайле
const LIQ_MAX_COMP = 1.03;        // сжатие столба
const LIQ_FLOW = 420;             // максимум переноса за шаг, кг
const GAS_DIFF = 0.26;            // выравнивание давления газа
const GAS_SORT = 0.16;            // разделение по плотности
const HEAT_K = 0.055;

// удельная теплоёмкость, кДж/(кг·°C)
const C_GAS = 1.0, C_WATER = 4.18, C_SOLID = 0.8;
// теплопроводность, Вт/(м·К): у газа она мала, у воды заметно выше, вакуум почти не проводит
const K_GAS = 0.026, K_WATER = 0.6, K_VACUUM = 0.0008;
const HEAT_SCALE = 240;        // перевод «физических» единиц в игровой темп
// скрытая теплота, кДж/кг
const L_FUSION = 334, L_VAPOR = 2260;
const ICE_MASS = 400, C_ICE = 2.0;

export function stepFluids(world, dt) {
  stepLiquid(world, dt);
  stepLiquidLayers(world, dt);
  stepGerms(world, dt);
  stepGas(world, dt);
  displaceGas(world);
  stepPhases(world, dt);
  stepHeat(world, dt);
}

function blockedAt(world, i) { return world.gasBlocked(i); }

/** Смешение температур при переносе массы m из a в b (mb — масса приёмника). */
function advect(temp, a, b, m, mb, c) {
  if (m <= 0) return;
  const cb = mb * c + 1e-6;
  temp[b] = (temp[b] * cb + temp[a] * m * c) / (cb + m * c);
}

// --------------------------------------------------------------- жидкости
/** Перелить f кг воды из a в b вместе с теплом, грязью и микробами. */
function moveWater(world, a, b, f) {
  const { water, temp, pwater, germs } = world;
  if (f <= 0) return;
  const wb = water[b];
  advect(temp, a, b, f, wb, C_WATER);
  pwater[b] = (pwater[b] * wb + pwater[a] * f) / (wb + f);
  germs[b] += germs[a] * (f / Math.max(water[a], f));
  germs[a] -= germs[a] * (f / Math.max(water[a], f));
  water[a] -= f;
  water[b] += f;
  if (water[a] < 0.01) { water[a] = 0; pwater[a] = 0; }
}

function stepLiquid(world, dt) {
  const { water, temp } = world;
  const blocked = i => blockedAt(world, i);
  const stable = (total) => {
    // сколько должно остаться в нижней клетке вертикальной пары
    if (total <= LIQ_FULL) return total;
    if (total < 2 * LIQ_FULL * LIQ_MAX_COMP) return (LIQ_FULL * LIQ_MAX_COMP * LIQ_FULL + total) / (LIQ_FULL * LIQ_MAX_COMP + LIQ_FULL);
    return (total + LIQ_FULL * LIQ_MAX_COMP) / 2;
  };
  const flowLimit = LIQ_FLOW * Math.min(1, dt * 60);

  for (let y = H - 2; y >= 1; y--) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      let w = water[i];
      if (w < 0.05 || blocked(i)) continue;
      let remaining = w;

      // вниз
      const d = i + W;
      if (!blocked(d)) {
        let f = stable(remaining + water[d]) - water[d];
        f = Math.max(0, Math.min(f, flowLimit, remaining));
        if (f > 0.01) { moveWater(world, i, d, f); remaining -= f; }
      }
      if (remaining < 0.05) continue;

      // в стороны
      for (const s of [i - 1, i + 1]) {
        if (blocked(s)) continue;
        let f = (remaining - water[s]) / 3;
        f = Math.max(0, Math.min(f, flowLimit, remaining));
        if (f > 0.01) { moveWater(world, i, s, f); remaining -= f; }
      }
      if (remaining < 0.05) continue;

      // вверх — только под давлением столба
      const u = i - W;
      if (!blocked(u)) {
        let f = remaining - stable(remaining + water[u]);
        f = Math.max(0, Math.min(f, flowLimit, remaining));
        if (f > 0.01) moveWater(world, i, u, f);
      }
    }
  }
}

/** Загрязнённая вода плотнее чистой: грязь опускается, чистая всплывает.
 *  Меняем местами именно массу примеси, а не усредняем — иначе слои не разделятся. */
function stepLiquidLayers(world, dt) {
  const { water, pwater, germs } = world;
  const rate = Math.min(0.6, dt * 12);
  for (let y = H - 3; y >= 1; y--) {
    for (let x = 1; x < W - 1; x++) {
      const a = y * W + x, b = a + W;           // a сверху, b снизу
      const wa = water[a], wb = water[b];
      if (wa < 20 || wb < 20) continue;
      if (pwater[a] <= pwater[b] + 0.005) continue;
      const dirtA = pwater[a] * wa;             // масса примеси сверху
      const room = (1 - pwater[b]) * wb;        // сколько ещё примет нижний слой
      const move = Math.min(dirtA, room) * rate;
      if (move < 1e-4) continue;
      pwater[a] = Math.max(0, (dirtA - move) / wa);
      pwater[b] = Math.min(1, (pwater[b] * wb + move) / wb);
      const gm = germs[a] * (move / Math.max(dirtA, move));
      germs[a] -= gm; germs[b] += gm;
    }
  }
}

// ------------------------------------------------------------------ газы
function totalGas(world, i) {
  return world.o2[i] + world.co2[i] + world.steam[i] + world.h2[i];
}

/** Количество вещества в тайле (условные кмоль) — из него считается давление. */
function moles(world, i) {
  return world.o2[i] / 32 + world.co2[i] / 44 + world.steam[i] / 18 + world.h2[i] / 2;
}

/** Давление идеального газа: P ~ n·T/V. Нагрев сам гонит газ наружу — это конвекция. */
function pressure(world, i, room) {
  return moles(world, i) * (world.temp[i] + 273) / Math.max(0.05, room);
}

/** Доля объёма тайла, занятая жидкостью: чем больше воды, тем меньше места газу. */
function gasRoom(world, i) {
  return Math.max(0, 1 - world.water[i] / LIQ_FULL);
}

function stepGas(world, dt) {
  const arr = [world.o2, world.co2, world.steam, world.h2];
  const { temp } = world;
  const k = Math.min(0.5, GAS_DIFF * dt * 60);
  const ks = Math.min(0.4, GAS_SORT * dt * 60);
  const blocked = i => blockedAt(world, i);

  const move = (a, b, frac) => {
    // перенос доли frac всей газовой смеси из a в b + перенос тепла
    const ta = totalGas(world, a);
    if (ta <= 1e-6 || frac <= 0) return;
    const m = ta * frac;
    advect(temp, a, b, m, totalGas(world, b), C_GAS);
    for (const g of arr) { const d = g[a] * frac; g[a] -= d; g[b] += d; }
  };

  // 1. выравнивание давления: горячий газ расширяется и уходит к соседям
  const pass = (ia, ib) => {
    if (blocked(ia) || blocked(ib)) return;
    const ra = gasRoom(world, ia), rb = gasRoom(world, ib);
    if (ra < 0.02 || rb < 0.02) return;
    const pa = pressure(world, ia, ra), pb = pressure(world, ib, rb);
    const diff = (pa - pb) * k * 0.5;
    if (Math.abs(diff) < 1e-6) return;
    if (diff > 0) move(ia, ib, Math.min(0.45, diff / Math.max(pa, 1e-6)));
    else move(ib, ia, Math.min(0.45, -diff / Math.max(pb, 1e-6)));
  };
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 2; x++) { const i = y * W + x; pass(i, i + 1); }
  for (let y = 1; y < H - 2; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; pass(i, i + W); }

  // 2. разделение по плотности: тяжёлые газы вниз, лёгкие вверх
  for (let y = 1; y < H - 2; y++) {
    for (let x = 1; x < W - 1; x++) {
      const a = y * W + x, b = a + W;           // a сверху, b снизу
      if (blocked(a) || blocked(b)) continue;
      if (gasRoom(world, a) < 0.02 || gasRoom(world, b) < 0.02) continue;
      const ta = totalGas(world, a), tb = totalGas(world, b);
      if (ta < 1e-4 && tb < 1e-4) continue;
      // плотность ρ ~ M/T: тяжёлый газ тонет, но нагретый — всплывает даже будучи «тяжёлым»
      const Ta = world.temp[a] + 273, Tb = world.temp[b] + 273;
      const rhoA = meanM(world, a, ta) / Ta, rhoB = meanM(world, b, tb) / Tb;
      for (let gi = 0; gi < arr.length; gi++) {
        const g = arr[gi];
        const rhoUp = GASES[gi].M / Ta, rhoDown = GASES[gi].M / Tb;
        if (rhoUp > rhoB * 1.02 && g[a] > 1e-5) {         // фракция тяжелее нижнего слоя — тонет
          const d = g[a] * ks * 0.5;
          advect(world.temp, a, b, d, tb, C_GAS);
          g[a] -= d; g[b] += d;
        } else if (rhoDown < rhoA * 0.98 && g[b] > 1e-5) { // легче верхнего — всплывает
          const d = g[b] * ks * 0.5;
          advect(world.temp, b, a, d, ta, C_GAS);
          g[b] -= d; g[a] += d;
        }
      }
    }
  }

  // 3. космос сверху: атмосфера улетучивается
  for (let x = 1; x < W - 1; x++) {
    for (let y = 1; y < 6; y++) {
      const i = y * W + x;
      if (blocked(i)) continue;
      for (const g of arr) g[i] *= 0.90;
    }
  }
}

function meanM(world, i, total) {
  if (total <= 1e-6) return 29;
  return (world.o2[i] * 32 + world.co2[i] * 44 + world.steam[i] * 18 + world.h2[i] * 2) / total;
}

/** Вода вытесняет газ: из затопленных тайлов газ уходит вверх/в стороны. */
function displaceGas(world) {
  const arr = [world.o2, world.co2, world.steam, world.h2];
  for (let y = H - 2; y >= 1; y--) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (world.water[i] < LIQ_FULL * 0.9) continue;
      const t = totalGas(world, i);
      if (t < 1e-4) continue;
      for (const n of [i - W, i - 1, i + 1]) {
        if (blockedAt(world, n) || world.water[n] > LIQ_FULL * 0.9) continue;
        for (const g of arr) { g[n] += g[i]; g[i] = 0; }
        break;
      }
    }
  }
}

// ------------------------------------------------------- фазовые переходы
function stepPhases(world, dt) {
  const { water, steam, temp, mat } = world;
  const rate = Math.min(1, dt * 1.5);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;

      // --- лёд тает: сколько растает, ограничено доступным теплом
      if (mat[i] === 6) {
        if (temp[i] > 0) {
          const heat = temp[i] * ICE_MASS * C_ICE;          // кДж выше точки плавления
          const melted = Math.min(ICE_MASS, heat / L_FUSION) * Math.min(1, dt);
          world.phase[i] += melted;
          temp[i] -= melted * L_FUSION / (ICE_MASS * C_ICE);
          if (world.phase[i] >= ICE_MASS) {
            mat[i] = 0; world.digProg[i] = 0; world.phase[i] = 0;
            water[i] += ICE_MASS; temp[i] = 0;
            world.markDirty(x, y);
          }
        } else if (world.phase[i] > 0) {
          world.phase[i] = Math.max(0, world.phase[i] - 5 * dt);  // подмерзает обратно
        }
        continue;
      }

      if (mat[i]) continue;

      // --- вода замерзает: скрытая теплота греет остаток
      if (water[i] > 1 && temp[i] < 0) {
        const cool = -temp[i] * water[i] * C_WATER;
        const frozen = Math.min(water[i], cool / L_FUSION) * Math.min(1, dt);
        if (frozen > 0) {
          water[i] -= frozen;
          world.phase[i] += frozen;
          temp[i] += frozen * L_FUSION / (water[i] * C_WATER + 1);
          if (world.phase[i] >= ICE_MASS * 0.8 && water[i] < 30 && !world.bid[i]) {
            mat[i] = 6; world.phase[i] = 0; water[i] = 0; temp[i] = Math.min(temp[i], -0.5);
            world.markDirty(x, y);
            continue;
          }
        }
      } else if (world.phase[i] > 0 && temp[i] > 0.5) {
        world.phase[i] = Math.max(0, world.phase[i] - 5 * dt);
      }
      // вода → пар: температура кипения растёт с давлением над поверхностью
      if (water[i] > 0.5) {
        const atm = totalGas(world, i) / 1.8;                  // ~1 при обычном давлении
        const boil = 100 + Math.max(-20, Math.min(60, (atm - 1) * 28));
        if (temp[i] > boil) {
          const heat = (temp[i] - boil) * water[i] * C_WATER;
          const ev = Math.min(water[i], heat / L_VAPOR) * rate;
          water[i] -= ev; steam[i] += ev;
          temp[i] -= ev * L_VAPOR / (water[i] * C_WATER + ev * C_GAS + 1);
        } else if (temp[i] > 15 && steam[i] < 0.4) {
          const ev = Math.min(water[i], 0.02 * rate);
          water[i] -= ev; steam[i] += ev; temp[i] -= 0.02 * rate;
        }
      }
      // пар → вода (точка росы тоже зависит от давления)
      const dew = 97 + Math.max(-20, Math.min(60, (totalGas(world, i) / 1.8 - 1) * 28));
      if (steam[i] > 1e-4 && temp[i] < dew) {
        const cond = steam[i] * Math.min(0.5, (dew - temp[i]) * 0.02 * rate);
        steam[i] -= cond; water[i] += cond;
        temp[i] += cond * L_VAPOR / (water[i] * C_WATER + 1) * 0.02;
      }
      if (water[i] < 0.01) water[i] = 0;
    }
  }
}

// ---------------------------------------------------------------- микробы
/** Микробы живут в грязной воде и слизи, гибнут в чистом кислороде и на морозе. */
function stepGerms(world, dt) {
  const { germs, water, pwater, temp, o2, mat } = world;
  const k = Math.min(0.3, 0.12 * dt * 60);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      let g = germs[i];
      if (mat[i] === 9) { germs[i] = Math.max(g, 120); continue; }   // слизь — источник
      if (g <= 0.01) { germs[i] = 0; continue; }
      // среда
      let decay = 0.03;                       // базовое отмирание
      if (water[i] > 20 && pwater[i] > 0.4) decay = -0.01;           // грязная вода — рассадник
      else if (o2[i] > 0.4) decay = 0.09;                            // чистый кислород убивает
      if (temp[i] < -2 || temp[i] > 60) decay += 0.3;                // мороз и жар
      g *= Math.max(0, 1 - decay * dt);
      // расползание по воздуху и воде
      for (const n of [i - 1, i + 1, i - W, i + W]) {
        if (world.gasBlocked(n)) continue;
        const d = (g - germs[n]) * k * 0.12;
        if (d > 0) { g -= d; germs[n] += d; }
      }
      germs[i] = g < 0.01 ? 0 : g;
    }
  }
}

// ------------------------------------------------------------------ тепло
/** Теплоёмкость тайла, кДж/К. */
function heatCapacity(world, i) {
  const m = world.mat[i];
  if (m) { const d = MATS[m]; return d.mass * d.c; }
  return world.water[i] * C_WATER + totalGas(world, i) * C_GAS + 0.05;
}

/** Теплопроводность тайла, Вт/(м·К): у породы своя, у смеси воды и газа — по долям. */
function conductivity(world, i) {
  const m = world.mat[i];
  if (m) return MATS[m].k;
  const wmass = world.water[i], gmass = totalGas(world, i);
  const tot = wmass + gmass;
  if (tot < 1e-4) return K_VACUUM;                   // вакуум почти не проводит тепло
  return (wmass * K_WATER + gmass * K_GAS) / tot;
}

function stepHeat(world, dt) {
  const { temp } = world;
  const pair = (a, b) => {
    const ka = conductivity(world, a), kb = conductivity(world, b);
    const keff = 2 * ka * kb / (ka + kb + 1e-9);      // последовательное соединение
    if (keff < 1e-6) return;
    const dT = temp[a] - temp[b];
    if (Math.abs(dT) < 1e-4) return;
    const Ca = heatCapacity(world, a), Cb = heatCapacity(world, b);
    let q = keff * dT * dt * HEAT_SCALE;              // кДж за шаг
    const qMax = 0.45 * dT / (1 / Ca + 1 / Cb);       // не перескакиваем равновесие
    if (Math.abs(q) > Math.abs(qMax)) q = qMax;
    temp[a] -= q / Ca;
    temp[b] += q / Cb;
  };
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 2; x++) { const i = y * W + x; pair(i, i + 1); }
  for (let y = 1; y < H - 2; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; pair(i, i + W); }
}

/** Освещение: солнечные лучи под углом (утро → вечер) плюс лампы. */
export function stepLight(world, sunDx = 0, sunStrength = 1) {
  const { light, mat, bdata } = world;
  light.fill(0);
  for (let x = 1; x < W - 1; x++) {
    let l = sunStrength;
    let xf = x;
    for (let y = 1; y < H - 1; y++) {
      const cx = Math.round(xf);
      if (cx < 1 || cx >= W - 1) break;
      const i = y * W + cx;
      light[i] = Math.max(light[i], l);
      if (mat[i]) l = 0; else l *= world.water[i] > 100 ? 0.94 : 0.985;
      if (l < 0.02) break;
      xf += sunDx;
    }
  }
  for (const [i, st] of bdata) {
    if (!st.built || !st.def.light || !st.powered) continue;
    const r = st.def.light, bx = i % W, by = (i / W) | 0;
    for (let y = by - r; y <= by + r; y++)
      for (let x = bx - r; x <= bx + r; x++) {
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const d = Math.hypot(x - bx, y - by);
        if (d > r) continue;
        const j = y * W + x;
        light[j] = Math.min(1, light[j] + (1 - d / r) * 0.9);
      }
  }
}
