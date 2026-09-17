// Поведение машин: энергия по сетям, насосы, электролиз, очистка, генераторы.
import { W, BUILDINGS } from './world.js';
import { Networks } from './network.js';
import { LIQ_FULL } from './fluid.js';

const GASES = ['o2', 'co2', 'steam', 'h2'];

/** Энергия считается отдельно для каждой электросети. */
export function updatePower(world, nets, dt, totals) {
  totals.gen = 0; totals.demand = 0; totals.stored = 0; totals.cap = 0; totals.deficit = 0;

  // машины без сети остаются обесточенными
  for (const [, st] of world.bdata) if (st.built && st.def.power < 0) st.powered = false;
  if (world.netDirty) return;

  for (const net of nets.nets.power) {
    let gen = 0, demand = 0, stored = 0, cap = 0;
    const consumers = [], batteries = [];
    for (const st of net.machines) {
      const d = st.def;
      if (d.storeJ) { batteries.push(st); stored += st.charge; cap += d.storeJ; }
      if (d.power > 0) {
        if (d.manual) {
          st.operating = Math.max(0, (st.operating || 0) - dt);
          if (st.operating > 0) gen += d.power;
        } else if (d.uses) {
          const fuel = st.store[d.uses] || 0;
          st.burning = fuel > 0;
          if (st.burning) { st.store[d.uses] = Math.max(0, fuel - 0.12 * dt); gen += d.power; }
        } else gen += d.power;
      } else if (d.power < 0) { demand += -d.power; consumers.push(st); }
    }
    const fromBatteries = dt > 0 ? stored / dt : 0;
    let budget = gen + fromBatteries, consumed = 0;
    for (const st of consumers) {
      const p = -st.def.power;
      if (budget >= p) { st.powered = true; budget -= p; consumed += p; } else st.powered = false;
    }
    let rest = Math.abs((gen - consumed) * dt);
    const charging = gen >= consumed;
    for (const st of batteries) {
      if (rest <= 0) break;
      if (charging) { const put = Math.min(st.def.storeJ - st.charge, rest); st.charge += put; rest -= put; }
      else { const take = Math.min(st.charge, rest); st.charge -= take; rest -= take; }
    }
    // перегрузка: если сеть тянет больше предела, провод перегорает
    if (net.wattCap && consumed > net.wattCap) {
      net.overload = (net.overload || 0) + dt;
      if (net.overload > 4) {
        net.overload = 0;
        const wires = [];
        for (let i = 0; i < world.cond.power.length; i++) if (nets.map.power[i] === nets.nets.power.indexOf(net)) wires.push(i);
        const victim = wires[Math.floor(Math.random() * wires.length)];
        if (victim !== undefined) {
          world.removeBuilding(victim % W, (victim / W) | 0, 1);
          totals.burned = (totals.burned || 0) + 1;
        }
      }
    } else net.overload = 0;

    net.gen = gen; net.demand = demand; net.consumed = consumed;
    net.stored = batteries.reduce((a, b) => a + b.charge, 0); net.storeCap = cap;
    totals.gen += gen; totals.demand += demand; totals.stored += net.stored; totals.cap += cap;
    if (demand > gen && net.stored <= 0) totals.deficit += demand - gen;
  }
}

/** Датчики и логические сети: сигнал включает/выключает машины. */
export function updateAutomation(world, nets, dt) {
  for (const net of nets.nets.auto) net.signal = false;
  for (const [, st] of world.bdata) {
    if (!st.built || !st.def.sensor) continue;
    const i = st.y * W + st.x;
    const d = st.def;
    let v = 0;
    if (d.sensor === 'temp') v = world.temp[i];
    else if (d.sensor === 'gas') v = world.o2[i] + world.co2[i] + world.steam[i] + world.h2[i];
    else if (d.sensor === 'water') v = world.water[i];
    const thr = st.threshold ?? d.threshold;
    const above = st.above ?? d.above;
    st.signal = d.sensor === 'manual' ? (st.on !== false) : (above ? v > thr : v < thr);
    const net = nets.net('auto', st.net?.auto ?? -1);
    if (net && st.signal) net.signal = true;
  }
  for (const [, st] of world.bdata) {
    if (!st.built || !st.def.auto) continue;
    const id = st.net?.auto ?? -1;
    st.autoOff = id >= 0 && !nets.net('auto', id).signal;
  }
}

/** Работа устройств: газ, вода, тепло, топливо. */
export function updateMachines(world, nets, game, dt) {
  for (const [, st] of world.bdata) {
    if (!st.built) continue;
    const d = st.def, x = st.x, y = st.y, i = y * W + x;
    if (st.autoOff) { if (d.power < 0) st.powered = false; continue; }
    const liq = nets.net('liquid', st.net?.liquid ?? -1);
    const gas = nets.net('gas', st.net?.gas ?? -1);

    switch (d.key) {
      case 'diffuser': {
        if (!st.powered) break;
        const use = 0.06 * dt;
        if ((st.store.algae || 0) > use) {
          st.store.algae -= use;
          world.o2[i] += use * 12;
          world.temp[i] += 0.4 * dt;
        }
        break;
      }
      case 'skimmer': {
        if (!st.powered) break;
        const got = liq ? Networks.pull(liq, 'water', 0.03 * dt) : null;
        if (!got && liq) break;
        for (const j of [i, i - 1, i + 1, i - W, i + W]) {
          if (j < 0 || j >= world.co2.length || world.gasBlocked(j)) continue;
          world.co2[j] = Math.max(0, world.co2[j] - 0.05 * dt);
        }
        if (got) { world.water[i] += got.amt; world.pwater[i] = 1; }
        world.temp[i] += 0.3 * dt;
        break;
      }
      case 'coalgen': {
        if (st.burning) { world.co2[i] += 0.02 * dt; world.temp[i] += 2.5 * dt; }
        break;
      }
      case 'lpump': {
        if (!st.powered || !liq) break;
        const src = [i, i + W].find(j => world.water[j] > 1);
        if (src === undefined) break;
        const take = Math.min(world.water[src], 10 * dt);
        const dirty = world.pwater[src] > 0.4;
        const moved = Networks.push(liq, dirty ? 'pwater' : 'water', take);
        world.water[src] -= moved;
        if (world.water[src] < 0.01) { world.water[src] = 0; world.pwater[src] = 0; }
        break;
      }
      case 'lvent': {
        if (!liq) break;
        const got = Networks.pull(liq, null, 10 * dt);
        if (!got) break;
        world.water[i] += got.amt;
        if (got.res === 'pwater') world.pwater[i] = Math.min(1, world.pwater[i] + got.amt / LIQ_FULL);
        break;
      }
      case 'gpump': {
        if (!st.powered || !gas) break;
        for (const g of GASES) {
          if (world[g][i] <= 0.005) continue;
          const take = Math.min(world[g][i], 0.5 * dt);
          const moved = Networks.push(gas, g, take);
          world[g][i] -= moved;
        }
        break;
      }
      case 'gvent': {
        if (!gas) break;
        const got = Networks.pull(gas, null, 0.5 * dt);
        if (got) world[got.res][i] += got.amt;
        break;
      }
      case 'electro': {
        if (!st.powered || !liq) break;
        const got = Networks.pull(liq, 'water', 1.0 * dt);
        if (!got) break;
        world.o2[i] += got.amt * 0.888;
        world.h2[i] += got.amt * 0.112;
        world.temp[i] += 1.5 * dt;
        break;
      }
      case 'sieve': {
        if (!st.powered || !liq) break;
        if ((st.store.stone || 0) < 0.02) break;
        const got = Networks.pull(liq, 'pwater', 5 * dt);
        if (!got) break;
        st.store.stone -= got.amt * 0.004;
        Networks.push(liq, 'water', got.amt);
        world.temp[i] += 0.1 * dt;
        break;
      }
      case 'compost': {
        const have = st.store.pdirt || 0;
        if (have <= 0) break;
        const conv = Math.min(have, 0.05 * dt);
        st.store.pdirt -= conv;
        st.store.dirt = (st.store.dirt || 0) + conv;
        world.temp[i] += 0.2 * dt;
        if ((st.store.dirt || 0) > 25) { world.addItem(x, y, 'dirt', st.store.dirt); st.store.dirt = 0; }
        break;
      }
      case 'suitdock': {
        // док набирает кислород из газовой сети или из воздуха вокруг
        if (!st.powered) break;
        const want = 40 - (st.store.o2 || 0);
        if (want > 0) {
          const got = gas ? Networks.pull(gas, 'o2', 1 * dt) : null;
          if (got) st.store.o2 = (st.store.o2 || 0) + got.amt;
          else if (world.o2[i] > 0.4) {
            const take = Math.min(world.o2[i] - 0.4, 0.5 * dt);
            world.o2[i] -= take; st.store.o2 = (st.store.o2 || 0) + take;
          }
        }
        break;
      }
      case 'ration': {
        st.chilled = st.powered;
        break;
      }
      case 'shower': case 'basin': {
        if (d.net?.liquid && liq && (st.store.water || 0) < 20) {
          const got = Networks.pull(liq, 'water', 5 * dt);
          if (got) st.store.water = (st.store.water || 0) + got.amt;
        }
        break;
      }
    }

    if (d.light) st.lit = st.powered;
  }
}
