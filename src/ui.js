// Интерфейс: панели, инструменты, ввод мыши и клавиатуры.
import { BUILDINGS, B_BY_KEY, MATS, RESOURCES, TILE, W } from './world.js';
import { mass } from './util.js';

const TABS = [
  { name: 'Приказы', tools: [
    { key: 'select', icon: '🔍', name: 'Осмотр' },
    { key: 'dig',    icon: '⛏', name: 'Копать' },
    { key: 'cancel', icon: '✖',  name: 'Отмена' },
    { key: 'decon',  icon: '🔨', name: 'Разобрать' },
  ]},
  { name: 'Строительство', tools: ['ladder', 'tile', 'bed', 'bin', 'ration', 'table', 'lamp'] },
  { name: 'Производство', tools: ['diffuser', 'skimmer', 'generator', 'battery', 'farm'] },
];

export class UI {
  constructor(game, renderer) {
    this.game = game; this.r = renderer;
    this.tab = 0; this.tool = { key: 'select' };
    this.buildTabs(); this.buildTools();
    this.bindInput();
    this.lastUI = 0;
  }

  // --------------------------------------------------------------- панели
  buildTabs() {
    const host = document.getElementById('tabs');
    host.innerHTML = '';
    TABS.forEach((t, i) => {
      const el = document.createElement('div');
      el.className = 'tab' + (i === this.tab ? ' active' : '');
      el.textContent = t.name;
      el.onclick = () => { this.tab = i; this.buildTabs(); this.buildTools(); };
      host.appendChild(el);
    });
  }

  buildTools() {
    const host = document.getElementById('tools');
    host.innerHTML = '';
    for (const t of TABS[this.tab].tools) {
      const def = typeof t === 'string' ? B_BY_KEY[t] : null;
      const key = def ? def.key : t.key;
      const el = document.createElement('div');
      el.className = 'tool' + (this.tool.key === key ? ' active' : '');
      el.innerHTML = def
        ? `<div class="ic">${def.icon}</div><div class="nm">${def.name}</div>
           <div class="cost">${Object.entries(def.cost).map(([r, a]) => `${a}${RESOURCES[r].icon}`).join(' ')}</div>`
        : `<div class="ic">${t.icon}</div><div class="nm">${t.name}</div><div class="cost">&nbsp;</div>`;
      el.onclick = () => { this.tool = def ? { key: def.key, build: def } : { key: t.key }; this.buildTools(); };
      host.appendChild(el);
    }
    document.getElementById('hint').textContent = this.tool.build
      ? `${this.tool.build.name}: ЛКМ — поставить чертёж (можно протянуть). Материалы принесут дупликанты.`
      : 'ЛКМ — применить · ПКМ/Esc — отмена инструмента · СКМ — камера · колесо — зум · Space — пауза';
  }

  // ----------------------------------------------------------------- ввод
  bindInput() {
    const c = this.r.c, g = this.game;
    let panning = false, last = null;

    c.addEventListener('contextmenu', e => e.preventDefault());

    c.addEventListener('mousedown', e => {
      const t = this.r.screenToTile(e.clientX, e.clientY);
      if (e.button === 1 || e.shiftKey) { panning = true; last = { x: e.clientX, y: e.clientY }; return; }
      if (e.button === 2) { this.tool = { key: 'select' }; this.buildTools(); g.drag = null; return; }
      if (this.tool.key === 'select') { this.selectAt(t); return; }
      g.drag = t;
    });

    window.addEventListener('mousemove', e => {
      const t = this.r.screenToTile(e.clientX, e.clientY);
      g.hover = t;
      if (panning && last) {
        this.r.cam.x -= (e.clientX - last.x) / this.r.cam.z;
        this.r.cam.y -= (e.clientY - last.y) / this.r.cam.z;
        last = { x: e.clientX, y: e.clientY };
      }
    });

    window.addEventListener('mouseup', e => {
      panning = false;
      if (!g.drag) return;
      const t = this.r.screenToTile(e.clientX, e.clientY);
      this.applyArea(g.drag, t);
      g.drag = null;
    });

    c.addEventListener('wheel', e => {
      e.preventDefault();
      const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      this.r.cam.z = Math.max(0.6, Math.min(4.5, this.r.cam.z * k));
    }, { passive: false });

    window.addEventListener('keydown', e => {
      if (e.code === 'Space') { e.preventDefault(); g.speed = g.speed ? 0 : 1; this.syncSpeed(); }
      if (e.code === 'Escape') { this.tool = { key: 'select' }; this.buildTools(); g.drag = null; }
      if (e.key === '1') { g.speed = 1; this.syncSpeed(); }
      if (e.key === '2') { g.speed = 2; this.syncSpeed(); }
      if (e.key === '3') { g.speed = 3; this.syncSpeed(); }
      const pan = 40 / this.r.cam.z;
      if (e.key === 'ArrowLeft' || e.key === 'a') this.r.cam.x -= pan;
      if (e.key === 'ArrowRight' || e.key === 'd') this.r.cam.x += pan;
      if (e.key === 'ArrowUp' || e.key === 'w') this.r.cam.y -= pan;
      if (e.key === 'ArrowDown' || e.key === 's') this.r.cam.y += pan;
    });

    document.querySelectorAll('.spd').forEach(b => {
      b.onclick = () => { g.speed = +b.dataset.speed; this.syncSpeed(); };
    });
    document.querySelectorAll('.ov').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('.ov').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.r.overlay = b.dataset.ov;
      };
    });
  }

  syncSpeed() {
    document.querySelectorAll('.spd').forEach(b =>
      b.classList.toggle('active', +b.dataset.speed === this.game.speed));
  }

  selectAt(t) {
    const g = this.game;
    let best = null, bd = 2.2;
    for (const p of g.pawns) {
      const d = Math.hypot(p.px - t.x, p.py - t.y);
      if (d < bd) { bd = d; best = p; }
    }
    g.selected = best;
  }

  applyArea(a, b) {
    const g = this.game;
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        switch (this.tool.key) {
          case 'dig': g.orderDig(x, y); break;
          case 'cancel': g.cancel(x, y); break;
          case 'decon': g.orderDeconstruct(x, y); break;
          default: if (this.tool.build) g.place(x, y, this.tool.build.key);
        }
      }
    }
  }

  // --------------------------------------------------------------- вывод
  update(dt) {
    this.lastUI += dt;
    if (this.lastUI < 0.2) return;
    this.lastUI = 0;
    const g = this.game, w = g.world;

    document.getElementById('cycle').textContent =
      `Цикл ${g.cycle} · ${g.cycleT > 0.75 ? 'ночь' : 'день'} · ${g.pawns.length} дупл.`;

    const res = ['food', 'stone', 'copper', 'dirt', 'coal', 'algae', 'ice'];
    document.getElementById('resbar').innerHTML =
      res.map(r => `<div class="r"><i>${RESOURCES[r].icon}</i>${RESOURCES[r].name} <b>${Math.round(g.stock(r))}</b></div>`).join('') +
      `<div class="r"><i>⚡</i><b>${Math.round(g.power.gen)}</b>/${Math.round(g.power.demand)} Вт · ${(g.power.stored / 1000).toFixed(1)} кДж</div>`;

    // инспектор
    const t = g.hover;
    const body = document.getElementById('inspector-body');
    if (t && w.inside(t.x, t.y)) {
      const i = w.idx(t.x, t.y);
      const m = MATS[w.mat[i]];
      const st = w.bdata.get(i);
      const pile = w.items.get(i);
      const rows = [];
      rows.push(kv('Тайл', `${t.x}, ${t.y}`));
      rows.push(kv('Порода', m ? m.name : '—'));
      rows.push(kv('Кислород', mass(w.o2[i])));
      rows.push(kv('CO₂', mass(w.co2[i])));
      rows.push(kv('Пар', mass(w.steam[i])));
      rows.push(kv('Водород', mass(w.h2[i])));
      rows.push(kv('Вода', `${w.water[i].toFixed(1)} кг${w.pwater[i] > 0.4 ? ' (грязная)' : ''}`));
      rows.push(kv('Температура', `${w.temp[i].toFixed(1)} °C`));
      rows.push(kv('Свет', `${Math.round(w.light[i] * 100)} %`));
      if (w.dig[i]) rows.push(kv('Приказ', 'копать'));
      if (st) {
        rows.push('<div class="sep"></div>');
        rows.push(kv('Постройка', st.def.name));
        rows.push(kv('Статус', st.built ? (st.remove ? 'на разбор' : 'работает') : `стройка ${Math.round(st.prog / st.def.work * 100)}%`));
        if (!st.built) rows.push(kv('Доставлено', Object.entries(st.delivered || {}).map(([r, a]) => `${Math.round(a)} ${RESOURCES[r].name}`).join(', ') || '—'));
        if (st.def.power) rows.push(kv('Энергия', `${st.def.power} Вт ${st.def.power < 0 ? (st.powered ? '✅' : '❌') : ''}`));
        if (st.def.storeJ) rows.push(kv('Заряд', `${(st.charge / 1000).toFixed(1)} кДж`));
        if (Object.keys(st.store || {}).length)
          rows.push(kv('Внутри', Object.entries(st.store).map(([r, a]) => `${Math.round(a)} ${RESOURCES[r].name}`).join(', ')));
        if (st.def.farm) rows.push(kv('Рост', st.planted ? `${Math.round(st.growth * 100)}%` : 'нужен грунт'));
      }
      if (pile) {
        rows.push('<div class="sep"></div>');
        rows.push(kv('На полу', Object.entries(pile).map(([r, a]) => `${Math.round(a)} ${RESOURCES[r].name}`).join(', ')));
      }
      body.innerHTML = rows.join('');
    }

    // колонисты
    const list = document.getElementById('colonist-list');
    list.innerHTML = g.pawns.map(p => {
      const sel = g.selected === p;
      const detail = sel ? `
        <div class="sep"></div>
        <div class="blabel"><span>Черты</span></div>
        <div>${p.traits.map(t => `<b title="${t.desc}">${t.name}</b>`).join(', ')}</div>
        <div class="blabel"><span>Навыки</span></div>
        <div>⛏ ${p.skills.dig.toFixed(1)} · 🔨 ${p.skills.build.toFixed(1)} · 🌱 ${p.skills.farm.toFixed(1)} · 📦 ${p.skills.haul.toFixed(1)}</div>
        <div class="blabel"><span>Настроение</span><span>${Math.round(p.mood)}</span></div>
        <div>${p.moodFactors.map(f => `<span style="color:${f[1] < 0 ? 'var(--bad)' : 'var(--good)'}">${f[0]} ${f[1] > 0 ? '+' : ''}${f[1]}</span>`).join(' · ')}</div>
      ` : '';
      return `<div class="col-card ${sel ? 'sel' : ''}" data-id="${p.id}">
        <div class="col-head"><span class="col-name">${p.name}</span><span class="col-task">${p.statusText()}</span></div>
        ${bar('O₂', p.oxygen, 100, '#68c8e8')}
        ${bar('Еда', p.calories, 4000, '#e8b95c')}
        ${bar('Силы', p.stamina, 100, '#8ad86a')}
        ${bar('Стресс', p.stress, 100, '#e8705c')}
        ${bar('Здоровье', p.health, 100, '#e86a9a')}
        ${detail}
      </div>`;
    }).join('') || '<div>Колонистов нет.</div>';
    list.querySelectorAll('.col-card').forEach(el => {
      el.onclick = () => { g.selected = g.pawns.find(p => p.id === +el.dataset.id); this.lastUI = 1; };
    });

    // оповещения
    const al = document.getElementById('alerts');
    al.innerHTML = g.alerts.filter(a => g.time - a.t < 12)
      .map(a => `<div class="alert ${a.info ? 'info' : ''}">${a.text}</div>`).join('');
  }
}

const kv = (k, v) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`;
const bar = (label, v, max, color) => {
  const pct = Math.max(0, Math.min(100, v / max * 100));
  return `<div class="blabel"><span>${label}</span><span>${Math.round(pct)}%</span></div>
          <div class="bar"><i style="width:${pct}%;background:${color}"></i></div>`;
};
