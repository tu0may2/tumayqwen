// Дерево исследований: открывает постройки, изучается в лаборатории.
export const TECHS = [
  { key: 'power1', name: 'Энергетика',   cost: 120, req: [],          unlock: ['coalgen', 'lamp'],                     desc: 'Угольный генератор и освещение' },
  { key: 'air1',   name: 'Вентиляция',   cost: 180, req: ['power1'],  unlock: ['gpipe', 'gpump', 'gvent', 'skimmer', 'electro'], desc: 'Газовые трубы, насосы, электролизёр' },
  { key: 'plumb1', name: 'Сантехника',   cost: 180, req: ['power1'],  unlock: ['lpipe', 'lpump', 'lvent', 'sieve', 'shower'],    desc: 'Водопровод и очистка воды' },
  { key: 'food1',  name: 'Агрономика',   cost: 150, req: [],          unlock: ['grill', 'ration', 'compost'],          desc: 'Кухня, холодильник, компост' },
  { key: 'med1',   name: 'Медицина',     cost: 240, req: ['food1'],   unlock: ['medcot'],                              desc: 'Медкойка и лечение болезней' },
  { key: 'rec1',   name: 'Досуг',        cost: 220, req: ['power1'],  unlock: ['arcade'],                              desc: 'Развлечения снижают стресс' },
  { key: 'ranch1', name: 'Ранчо',        cost: 260, req: ['food1'],   unlock: ['feeder'],                              desc: 'Приручение хатчей' },
];

export class Research {
  constructor(game) {
    this.game = game;
    this.done = new Set();
    this.current = null;
    this.progress = 0;
  }

  available() {
    return TECHS.filter(t => !this.done.has(t.key) && t.req.every(r => this.done.has(r)));
  }

  select(key) {
    const t = TECHS.find(x => x.key === key);
    if (!t || this.done.has(key)) return;
    if (this.current?.key !== key) this.progress = 0;
    this.current = t;
  }

  /** true — тема завершена (работа оператора окончена). */
  check() {
    if (!this.current) return true;
    if (this.progress < this.current.cost) return false;
    this.done.add(this.current.key);
    this.game.alert(`Исследовано: ${this.current.name}!`, true);
    this.current = null;
    this.progress = 0;
    return true;
  }

  unlocked(def) { return !def.tech || this.done.has(def.tech); }
}
