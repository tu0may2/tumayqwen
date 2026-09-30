// Растения: у каждого свои требования к среде. Не выполнены — рост стоит.
export const PLANTS = {
  mealwood: {
    name: 'Мучное дерево', icon: '🌾', yield: 'food', amount: 20, time: 150,
    needs: { dirt: 0.02 }, temp: [5, 35], light: null, water: 0,
    hint: 'грунт, 5…35 °C',
  },
  bristle: {
    name: 'Щетинистая почка', icon: '🌼', yield: 'food', amount: 34, time: 200,
    needs: { dirt: 0.01 }, temp: [5, 30], light: 0.45, water: 0.6,
    hint: 'свет, вода, 5…30 °C',
  },
  mushroom: {
    name: 'Пузырчатый гриб', icon: '🍄', yield: 'food', amount: 26, time: 240,
    needs: { slime: 0.03 }, temp: [10, 45], light: -0.2, water: 0,
    hint: 'слизь, темнота',
  },
  sleetwheat: {
    name: 'Морозная пшеница', icon: '❄️', yield: 'food', amount: 30, time: 300,
    needs: { dirt: 0.01 }, temp: [-30, 5], light: null, water: 0.3,
    hint: 'холод ниже 5 °C',
  },
};

/** Подобрать культуру под условия тайла. */
export function chooseCrop(world, i) {
  const t = world.temp[i], l = world.light[i];
  let best = 'mealwood', score = -1;
  for (const [key, p] of Object.entries(PLANTS)) {
    let s = 0;
    if (t < p.temp[0] || t > p.temp[1]) continue;
    s += 1;
    if (p.light !== null) s += p.light > 0 ? (l >= p.light ? 1 : -1) : (l < 0.25 ? 1 : -1);
    s += p.amount / 40;
    if (s > score) { score = s; best = key; }
  }
  return best;
}

/** Проверка условий роста. Возвращает {ok, reason}. */
export function checkPlant(world, st, i) {
  const p = PLANTS[st.plant];
  if (!p) return { ok: false, reason: 'нет культуры' };
  const t = world.temp[i];
  if (t < p.temp[0]) return { ok: false, reason: 'холодно' };
  if (t > p.temp[1]) return { ok: false, reason: 'жарко' };
  if (p.light !== null) {
    if (p.light > 0 && world.light[i] < p.light) return { ok: false, reason: 'мало света' };
    if (p.light < 0 && world.light[i] > 0.25) return { ok: false, reason: 'слишком светло' };
  }
  if (p.water > 0 && (st.store.water || 0) <= 0) return { ok: false, reason: 'нужна вода' };
  const [res, rate] = Object.entries(p.needs)[0];
  if ((st.store[res] || 0) <= 0) return { ok: false, reason: `нужен ресурс: ${res}` };
  return { ok: true, res, rate, plant: p };
}
