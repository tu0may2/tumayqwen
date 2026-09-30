// Мелкие утилиты: ГПСЧ, шум, математика, имена.

export function makeRNG(seed = 1337) {
  let s = seed >>> 0;
  return function rng() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t);
export const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

/** Двумерный value-noise с решёткой заданного масштаба. */
export function makeNoise2D(rng) {
  const size = 256;
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const at = (x, y) => grid[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  return function noise(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const tx = smooth(x - x0), ty = smooth(y - y0);
    return lerp(
      lerp(at(x0, y0), at(x0 + 1, y0), tx),
      lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), tx),
      ty
    );
  };
}

/** Фрактальный шум из нескольких октав. */
export function fbm(noise, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }

const FIRST = ['Ая', 'Бим', 'Вега', 'Гор', 'Дина', 'Ёж', 'Жора', 'Зина', 'Иго', 'Кира',
  'Лука', 'Мика', 'Ной', 'Оля', 'Пабло', 'Рита', 'Сева', 'Тина', 'Улу', 'Фома', 'Хлоя', 'Юна'];
const LAST = ['Тик', 'Болт', 'Гайка', 'Пыль', 'Кварц', 'Уголёк', 'Мох', 'Ветер', 'Искра', 'Криль',
  'Пиксель', 'Медь', 'Слюда', 'Крот', 'Эхо'];
export function randomName(rng) { return `${pick(rng, FIRST)} ${pick(rng, LAST)}`; }

/** Форматирование массы в стиле ONI. */
export function mass(kg) {
  if (kg >= 1000) return (kg / 1000).toFixed(1) + ' т';
  if (kg >= 1) return kg.toFixed(1) + ' кг';
  return (kg * 1000).toFixed(0) + ' г';
}
