// Расписание колонии: цикл делится на 12 отрезков со своим режимом.
export const BLOCKS = {
  work:  { name: 'Работа',  color: '#ffb43d', icon: '⛏' },
  rec:   { name: 'Досуг',   color: '#c58ae0', icon: '🕹' },
  bath:  { name: 'Гигиена', color: '#7ec8c8', icon: '🚿' },
  sleep: { name: 'Сон',     color: '#5a7fd6', icon: '💤' },
};

export class Schedule {
  constructor() {
    this.slots = ['work', 'work', 'work', 'work', 'work', 'work', 'work', 'work',
      'bath', 'rec', 'sleep', 'sleep'];
  }
  at(cycleT) { return this.slots[Math.min(11, Math.floor(cycleT * 12))]; }
  cycle(idx) {
    const keys = Object.keys(BLOCKS);
    this.slots[idx] = keys[(keys.indexOf(this.slots[idx]) + 1) % keys.length];
  }
}
