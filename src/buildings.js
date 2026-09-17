// Каталог построек. Данные — здесь, поведение — в machines.js.
export const CAT = {
  base: 'Базовое', power: 'Энергия', plumb: 'Сантехника', vent: 'Вентиляция',
  food: 'Еда', sci: 'Наука и быт', deco: 'Комфорт', auto: 'Автоматика',
};

export const BUILDINGS = [
  null,
  // --- базовое -------------------------------------------------------------
  { id: 1,  key: 'ladder',  cat: 'base', name: 'Лестница',  icon: '🪜', cost: { stone: 3 },  work: 6,  climb: true, floor: true },
  { id: 2,  key: 'tile',    cat: 'base', name: 'Плитка',    icon: '🧱', cost: { stone: 5 },  work: 8,  solid: true },
  { id: 3,  key: 'bed',     cat: 'base', name: 'Койка',     icon: '🛏', cost: { stone: 10 }, work: 12, floor: true, sleep: true, decor: 2, tech: null },
  { id: 4,  key: 'bin',     cat: 'base', name: 'Склад',     icon: '📦', cost: { stone: 15 }, work: 10, floor: true, store: 'mat', cap: 400 },
  { id: 5,  key: 'ration',  cat: 'food', name: 'Холодильник', icon: '🧺', cost: { copper: 10, stone: 10 }, work: 12, floor: true, store: 'food', cap: 600, power: -60, chill: true, tech: 'food1' },
  { id: 6,  key: 'diffuser', auto: true,cat: 'vent', name: 'Диффузор O₂', icon: '💨', cost: { copper: 20 }, work: 16, floor: true, power: -120, uses: 'algae', net: { auto: true, power: true } },
  { id: 7,  key: 'generator', cat: 'power', name: 'Ручной генератор', icon: '⚙️', cost: { stone: 20 }, work: 14, floor: true, power: 400, manual: true, net: { auto: true, power: true } },
  { id: 8,  key: 'battery', cat: 'power', name: 'Батарея',   icon: '🔋', cost: { copper: 15 }, work: 12, floor: true, storeJ: 10000, net: { auto: true, power: true } },
  { id: 9,  key: 'farm',    cat: 'food', name: 'Грядка',     icon: '🌱', cost: { dirt: 20 },  work: 14, floor: true, farm: true },
  { id: 10, key: 'skimmer', auto: true, cat: 'vent', name: 'CO₂-фильтр', icon: '🌀', cost: { copper: 20, stone: 10 }, work: 16, floor: true, power: -120, scrub: true, net: { auto: true, power: true }, tech: 'air1' },
  { id: 11, key: 'table',   cat: 'base', name: 'Стол',       icon: '🍴', cost: { stone: 8 },  work: 8,  floor: true, eat: true, decor: 3 },
  { id: 12, key: 'lamp', auto: true,    cat: 'deco', name: 'Лампа',      icon: '💡', cost: { copper: 8 }, work: 6,  power: -20, light: 7, net: { auto: true, power: true }, decor: 2, tech: 'power1' },

  // --- проводка и трубы ----------------------------------------------------
  { id: 13, key: 'wire',    cat: 'power', name: 'Провод',    icon: '➰', cost: { copper: 2 }, work: 3, conduit: 'power' },
  { id: 14, key: 'lpipe',   cat: 'plumb', name: 'Труба (жидк.)', icon: '🟦', cost: { copper: 3 }, work: 4, conduit: 'liquid', tech: 'plumb1' },
  { id: 15, key: 'gpipe',   cat: 'vent',  name: 'Труба (газ)',   icon: '🟪', cost: { copper: 3 }, work: 4, conduit: 'gas', tech: 'air1' },

  // --- насосы и вентиляция -------------------------------------------------
  { id: 16, key: 'lpump', auto: true,   cat: 'plumb', name: 'Насос',      icon: '🛁', cost: { copper: 30 }, work: 18, floor: true, power: -240, net: { auto: true, power: true, liquid: 'out' }, tech: 'plumb1' },
  { id: 17, key: 'lvent',   cat: 'plumb', name: 'Слив',       icon: '🚿', cost: { copper: 10 }, work: 8,  floor: true, net: { liquid: 'in' }, tech: 'plumb1' },
  { id: 18, key: 'gpump', auto: true,   cat: 'vent',  name: 'Газовый насос', icon: '🌬', cost: { copper: 30 }, work: 18, floor: true, power: -240, net: { auto: true, power: true, gas: 'out' }, tech: 'air1' },
  { id: 19, key: 'gvent',   cat: 'vent',  name: 'Вентиляция',  icon: '🔲', cost: { copper: 10 }, work: 8,  floor: true, net: { gas: 'in' }, tech: 'air1' },

  // --- производство --------------------------------------------------------
  { id: 20, key: 'electro', auto: true, cat: 'vent',  name: 'Электролизёр', icon: '⚗️', cost: { copper: 40 }, work: 24, floor: true, power: -120, net: { auto: true, power: true, liquid: 'in' }, tech: 'air1' },
  { id: 21, key: 'sieve', auto: true,   cat: 'plumb', name: 'Очиститель воды', icon: '🧽', cost: { copper: 20, stone: 20 }, work: 20, floor: true, power: -120, net: { auto: true, power: true, liquid: 'in' }, uses: 'stone', tech: 'plumb1' },
  { id: 22, key: 'grill',   cat: 'food',  name: 'Кухня',       icon: '🍳', cost: { copper: 20, stone: 10 }, work: 20, floor: true, power: -240, manualWork: 'cook', net: { auto: true, power: true }, tech: 'food1' },
  { id: 23, key: 'coalgen', auto: true, cat: 'power', name: 'Угольный генератор', icon: '🏭', cost: { copper: 20, stone: 30 }, work: 24, floor: true, power: 600, uses: 'coal', net: { auto: true, power: true }, tech: 'power1' },

  // --- быт, наука, медицина ------------------------------------------------
  { id: 24, key: 'outhouse', cat: 'sci',  name: 'Уборная',    icon: '🚽', cost: { stone: 20, dirt: 10 }, work: 12, floor: true, toilet: true },
  { id: 25, key: 'basin',    cat: 'sci',  name: 'Умывальник', icon: '🚰', cost: { copper: 10, stone: 10 }, work: 10, floor: true, wash: true },
  { id: 26, key: 'research', cat: 'sci',  name: 'Лаборатория', icon: '🔬', cost: { copper: 20, stone: 20 }, work: 20, floor: true, power: -60, manualWork: 'research', net: { auto: true, power: true } },
  { id: 27, key: 'medcot',   cat: 'sci',  name: 'Медкойка',   icon: '🩺', cost: { copper: 15, stone: 15 }, work: 16, floor: true, sleep: true, med: true, decor: 1, tech: 'med1' },
  { id: 28, key: 'door',     cat: 'base', name: 'Дверь',      icon: '🚪', cost: { copper: 10 }, work: 10, door: true, floor: true },
  { id: 29, key: 'arcade', auto: true,   cat: 'deco', name: 'Игровой автомат', icon: '🕹', cost: { copper: 25, stone: 10 }, work: 18, floor: true, power: -120, fun: 12, net: { auto: true, power: true }, decor: 4, tech: 'rec1' },
  { id: 30, key: 'sculpt',   cat: 'deco', name: 'Статуя',     icon: '🗿', cost: { stone: 30 },  work: 20, floor: true, decor: 8 },
  { id: 31, key: 'shower',   cat: 'sci',  name: 'Душ',        icon: '🛀', cost: { copper: 20 }, work: 16, floor: true, wash: true, big: true, net: { liquid: 'in' }, tech: 'plumb1' },
  // --- автоматика ----------------------------------------------------------
  { id: 35, key: 'awire',   cat: 'auto', name: 'Логопровод', icon: '🟩', cost: { copper: 2 },  work: 3, conduit: 'auto', tech: 'auto1' },
  { id: 36, key: 'tsensor', cat: 'auto', name: 'Термодатчик', icon: '🌡', cost: { copper: 10 }, work: 8, floor: true, sensor: 'temp', threshold: 30, above: false, net: { auto: 'out' }, tech: 'auto1' },
  { id: 37, key: 'psensor', cat: 'auto', name: 'Датчик давления', icon: '📊', cost: { copper: 10 }, work: 8, floor: true, sensor: 'gas', threshold: 1.5, above: false, net: { auto: 'out' }, tech: 'auto1' },
  { id: 38, key: 'wsensor', cat: 'auto', name: 'Датчик жидкости', icon: '💧', cost: { copper: 10 }, work: 8, floor: true, sensor: 'water', threshold: 400, above: true, net: { auto: 'out' }, tech: 'auto1' },
  { id: 39, key: 'switch',  cat: 'auto', name: 'Тумблер',    icon: '🎚', cost: { copper: 6 },  work: 6, floor: true, sensor: 'manual', net: { auto: 'out' }, tech: 'auto1' },
  { id: 34, key: 'suitdock', auto: true, cat: 'vent', name: 'Док скафандров', icon: '🥽', cost: { copper: 30, stone: 10 }, work: 20, floor: true, power: -60, suit: true, net: { auto: true, power: true, gas: 'in' }, tech: 'air1' },
  { id: 33, key: 'feeder',  cat: 'food', name: 'Кормушка',  icon: '🥣', cost: { copper: 15, stone: 10 }, work: 14, floor: true, uses: 'stone', feeder: true, tech: 'ranch1' },
  { id: 32, key: 'compost',  cat: 'food', name: 'Компостер',  icon: '🪱', cost: { stone: 20 },  work: 14, floor: true, uses: 'pdirt', tech: 'food1' },
];

export const B_BY_KEY = {};
for (const b of BUILDINGS) if (b) B_BY_KEY[b.key] = b;
