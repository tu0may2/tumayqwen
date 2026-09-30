// Психология и социум: мнения друг о друге, разговоры, ссоры, воспоминания.
const CHAT_RANGE = 3;

export const THOUGHTS = {
  chat:       { text: 'Приятная беседа',      value: +6,  dur: 240 },
  argue:      { text: 'Поссорился',           value: -10, dur: 300 },
  friendDied: { text: 'Погиб друг',           value: -30, dur: 900 },
  ateGood:    { text: 'Вкусно поел',          value: +8,  dur: 200 },
  ateSame:    { text: 'Надоела одна и та же еда', value: -6, dur: 300 },
  slept:      { text: 'Выспался',             value: +6,  dur: 200 },
  sleptFloor: { text: 'Спал на полу',         value: -8,  dur: 300 },
  newTech:    { text: 'Прорыв в науке',       value: +6,  dur: 300 },
  scalded:    { text: 'Ошпарился',            value: -12, dur: 240 },
  fell:       { text: 'Больно упал',          value: -8,  dur: 200 },
};

/** Разговоры и отношения: раз в несколько секунд ищем соседей. */
export function stepSocial(game, dt) {
  const pawns = game.pawns;
  for (let a = 0; a < pawns.length; a++) {
    for (let b = a + 1; b < pawns.length; b++) {
      const p = pawns[a], q = pawns[b];
      if (Math.abs(p.x - q.x) + Math.abs(p.y - q.y) > CHAT_RANGE) continue;
      if (p.task === 'sleep' || q.task === 'sleep') continue;
      if (Math.random() > 0.35 * dt) continue;

      const chemistry = (p.mood + q.mood) / 2 - 45 + (p.opinion(q) + q.opinion(p)) / 4;
      const good = chemistry + (Math.random() - 0.5) * 40 > 0;
      const delta = good ? 4 + Math.random() * 4 : -(4 + Math.random() * 6);
      p.addOpinion(q, delta); q.addOpinion(p, delta);
      p.remember(good ? 'chat' : 'argue'); q.remember(good ? 'chat' : 'argue');
      if (!good && Math.abs(delta) > 8) {
        p.stress = Math.min(100, p.stress + 6);
        q.stress = Math.min(100, q.stress + 6);
      }
    }
  }
}

export function relationLabel(v) {
  if (v > 60) return 'лучший друг';
  if (v > 25) return 'друг';
  if (v > -10) return 'знакомый';
  if (v > -45) return 'неприязнь';
  return 'враг';
}
