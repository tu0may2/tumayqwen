// Интерфейс: панели, инструменты, ввод мыши и клавиатуры.
import { BUILDINGS, B_BY_KEY, MATS, RESOURCES, TILE, W, CAT } from './world.js';
import { mass } from './util.js';
import { JOB_ORDER, JOB_LABEL } from './jobs.js';
import { TECHS } from './research.js';
import { PLANTS } from './plants.js';
import { BLOCKS } from './schedule.js';
import { saveGame, loadInto, hasSave } from './save.js';

const TABS = [
  { name: 'Приказы', tools: [
    { key: 'select', icon: '🔍', name: 'Осмотр' },
    { key: 'dig',    icon: '⛏', name: 'Копать' },
    { key: 'hunt',   icon: '🏹', name: 'Отлов' },
    { key: 'cancel', icon: '✖',  name: 'Отмена' },
    { key: 'decon',  icon: '🔨', name: 'Разобрать' },
  ]},
  ...Object.entries(CAT).map(([cat, name]) => ({
    name, tools: BUILDINGS.filter(b => b && b.cat === cat).map(b => b.key),
  })),
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
      const locked = def && !this.game.research.unlocked(def);
      const el = document.createElement('div');
      el.className = 'tool' + (this.tool.key === key ? ' active' : '') + (locked ? ' locked' : '');
      el.title = def ? `${def.name}${locked ? ' — нужно исследование' : ''}` : t.name;
      el.innerHTML = def
        ? `<div class="ic">${locked ? '🔒' : def.icon}</div><div class="nm">${def.name}</div>
           <div class="cost">${Object.entries(def.cost).map(([r, a]) => `${a}${RESOURCES[r].icon}`).join(' ')}</div>`
        : `<div class="ic">${t.icon}</div><div class="nm">${t.name}</div><div class="cost">&nbsp;</div>`;
      el.onclick = () => {
        if (locked) return;
        this.tool = def ? { key: def.key, build: def } : { key: t.key };
        this.buildTools();
      };
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

    c.addEventListener('pointerdown', e => {
      c.setPointerCapture?.(e.pointerId);
      const t = this.r.screenToTile(e.clientX, e.clientY);
      if (e.button === 1 || e.shiftKey) { panning = true; last = { x: e.clientX, y: e.clientY }; return; }
      if (e.button === 2) { this.tool = { key: 'select' }; this.buildTools(); g.drag = null; return; }
      if (this.tool.key === 'select') { this.selectAt(t); return; }
      g.drag = t;
    });

    window.addEventListener('pointermove', e => {
      const t = this.r.screenToTile(e.clientX, e.clientY);
      g.hover = t;
      if (panning && last) {
        this.r.cam.x -= (e.clientX - last.x) / this.r.cam.z;
        this.r.cam.y -= (e.clientY - last.y) / this.r.cam.z;
        last = { x: e.clientX, y: e.clientY };
      }
    });

    window.addEventListener('pointerup', e => {
      panning = false;
      if (!g.drag) return;
      const t = this.r.screenToTile(e.clientX, e.clientY);
      this.applyArea(g.drag, t);
      g.drag = null;
    });

    let pinch = null;
    c.addEventListener('touchstart', e => {
      if (e.touches.length !== 2) return;
      panning = false; g.drag = null;
      pinch = this.touchInfo(e);
    }, { passive: true });
    c.addEventListener('touchmove', e => {
      if (e.touches.length !== 2 || !pinch) return;
      e.preventDefault();
      const now = this.touchInfo(e);
      this.r.cam.z = Math.max(0.6, Math.min(4.5, this.r.cam.z * (now.d / pinch.d)));
      this.r.cam.x -= (now.x - pinch.x) / this.r.cam.z;
      this.r.cam.y -= (now.y - pinch.y) / this.r.cam.z;
      pinch = now;
    }, { passive: false });
    c.addEventListener('touchend', () => { pinch = null; }, { passive: true });

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

    document.querySelectorAll('.spd[data-speed]').forEach(b => {
      b.onclick = () => { g.speed = +b.dataset.speed; this.syncSpeed(); };
    });
    document.getElementById('btn-save').onclick = () => saveGame(g);
    document.getElementById('btn-load').onclick = () => { if (hasSave()) loadInto(g); else g.alert('Сохранений нет.'); };
    document.querySelectorAll('.ov').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('.ov').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.r.overlay = b.dataset.ov;
      };
    });
  }

  /** Центр и разброс двух касаний — для панорамы и зума. */
  touchInfo(e) {
    const [a, b] = [e.touches[0], e.touches[1]];
    return {
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
      d: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
    };
  }

  syncSpeed() {
    document.querySelectorAll('.spd[data-speed]').forEach(b =>
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
          case 'hunt': g.orderHunt(x, y); break;
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
      const st = w.bstate(t.x, t.y) || w.allAt(t.x, t.y)[0];
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
      if (w.germs[i] > 1) rows.push(kv('Микробы', Math.round(w.germs[i])));
      if (w.dig[i]) rows.push(kv('Приказ', 'копать'));
      if (st) {
        rows.push('<div class="sep"></div>');
        rows.push(kv('Постройка', st.def.name));
        rows.push(kv('Статус', st.built ? (st.remove ? 'на разбор' : 'работает') : `стройка ${Math.round(st.prog / st.def.work * 100)}%`));
        if (!st.built) rows.push(kv('Доставлено', Object.entries(st.delivered || {}).map(([r, a]) => `${Math.round(a)} ${RESOURCES[r].name}`).join(', ') || '—'));
        if (st.def.sensor) {
          rows.push(kv('Датчик', st.def.sensor === 'manual' ? (st.on !== false ? 'включён' : 'выключен')
            : `${st.above ?? st.def.above ? '>' : '<'} ${st.threshold ?? st.def.threshold}`));
          rows.push(kv('Сигнал', st.signal ? 'ДА' : 'нет'));
        }
        if (st.autoOff) rows.push(kv('Автоматика', 'выключено сигналом'));
        if (st.def.power) rows.push(kv('Энергия', `${st.def.power} Вт ${st.def.power < 0 ? (st.powered ? '✅' : '❌') : ''}`));
        if (st.def.storeJ) rows.push(kv('Заряд', `${(st.charge / 1000).toFixed(1)} кДж`));
        if (Object.keys(st.store || {}).length)
          rows.push(kv('Внутри', Object.entries(st.store).map(([r, a]) => `${Math.round(a)} ${RESOURCES[r].name}`).join(', ')));
        if (st.def.farm) {
          rows.push(kv('Культура', st.plant ? `${PLANTS[st.plant].icon} ${PLANTS[st.plant].name}` : '—'));
          rows.push(kv('Рост', st.planted ? `${Math.round(st.growth * 100)}%${st.wilt ? ` (${st.wilt})` : ''}` : 'нужен субстрат'));
          if (st.plant) rows.push(kv('Требования', PLANTS[st.plant].hint));
        }
        for (const kind of ['power', 'liquid', 'gas']) {
          const id = st.net?.[kind] ?? -1;
          if (id < 0) continue;
          const net = g.nets.net(kind, id);
          const label = kind === 'power' ? 'Электросеть' : kind === 'liquid' ? 'Водопровод' : 'Газопровод';
          rows.push(kv(label, kind === 'power'
            ? `${Math.round(net.gen)}/${Math.round(net.demand)} Вт`
            : Object.entries(net.buffer).map(([r, a]) => `${r} ${a.toFixed(1)}`).join(', ') || 'пусто'));
        }
      }
      const cr = (g.critters || []).find(c => c.x === t.x && c.y === t.y);
      if (cr) {
        rows.push('<div class="sep"></div>');
        rows.push(kv('Существо', cr.def.name));
        rows.push(kv('Сытость', `${Math.round(cr.hunger / cr.def.hungerMax * 100)}%`));
        if (cr.hunted) rows.push(kv('Метка', 'на отлов'));
      }
      if (pile) {
        rows.push('<div class="sep"></div>');
        rows.push(kv('На полу', Object.entries(pile).map(([r, a]) => `${Math.round(a)} ${RESOURCES[r].name}`).join(', ')));
      }
      body.innerHTML = rows.join('');
    }

    // расписание
    const strip = document.getElementById('schedule-strip');
    const nowSlot = Math.min(11, Math.floor(g.cycleT * 12));
    strip.innerHTML = g.schedule.slots.map((k, idx) =>
      `<div class="${idx === nowSlot ? 'now' : ''}" data-slot="${idx}" title="${BLOCKS[k].name}"
        style="background:${BLOCKS[k].color}33;border-color:${BLOCKS[k].color}">${BLOCKS[k].icon}</div>`).join('');
    strip.querySelectorAll('div').forEach(el => {
      el.onclick = () => { g.schedule.cycle(+el.dataset.slot); this.lastUI = 1; };
    });

    // исследования
    const rb = document.getElementById('research-body');
    const R = g.research;
    rb.innerHTML = TECHS.map(t => {
      const done = R.done.has(t.key);
      const ready = t.req.every(r => R.done.has(r));
      const cur = R.current?.key === t.key;
      const pct = cur ? Math.round(R.progress / t.cost * 100) : 0;
      return `<div class="tech ${done ? 'done' : ''} ${cur ? 'active' : ''}" data-tech="${t.key}">
        <div><b>${t.name}</b> ${done ? '✔' : ready ? `${t.cost}` : '🔒'}</div>
        <div class="d">${t.desc}</div>
        ${cur ? `<div class="bar"><i style="width:${pct}%;background:var(--accent2)"></i></div>` : ''}
      </div>`;
    }).join('');
    rb.querySelectorAll('.tech').forEach(el => {
      el.onclick = () => { R.select(el.dataset.tech); this.lastUI = 1; };
    });

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
        ${p.sick ? `<div style="color:var(--bad)">Болезнь: ${p.sick.name}</div>` : ''}
        <div class="blabel"><span>Работы (клик — вкл/выкл)</span></div>
        <div class="prio">${JOB_ORDER.map(j => {
          const v = p.prioOf(j);
          return `<span class="${v === 0 ? 'off' : v >= 5 ? 'p5' : v <= 1 ? 'p1' : ''}" data-pid="${p.id}" data-job="${j}">${JOB_LABEL[j] || j} ${v}</span>`;
        }).join('')}</div>
        <div class="blabel"><span>Увлечения</span></div>
        <div>${Object.entries(p.passions).filter(([, v]) => v).map(([k, v]) => `${v === 2 ? '🔥' : '✨'} ${k}`).join(' · ') || '—'}</div>
        <div class="blabel"><span>Отношения</span></div>
        <div class="rel">${g.pawns.filter(q => q !== p).map(q => `${q.name.split(' ')[0]}: ${p.relationTo(q)} (${Math.round(p.opinion(q))})`).join('<br>') || '—'}</div>
        ${p.suitO2 > 0 ? `<div>Скафандр: ${Math.round(p.suitO2)}%</div>` : ''}
      ` : '';
      return `<div class="col-card ${sel ? 'sel' : ''}" data-id="${p.id}">
        <div class="col-head"><span class="col-name">${p.name}</span><span class="col-task">${p.statusText()}</span></div>
        ${bar('O₂', p.oxygen, 100, '#68c8e8')}
        ${bar('Еда', p.calories, 4000, '#e8b95c')}
        ${bar('Силы', p.stamina, 100, '#8ad86a')}
        ${bar('Стресс', p.stress, 100, '#e8705c')}
        ${bar('Здоровье', p.health, 100, '#e86a9a')}
        ${sel ? bar('Мочевой пузырь', p.bladder, 100, '#c8b45c') + bar('Гигиена', p.hygiene, 100, '#7ec8c8') + bar('Досуг', p.fun, 100, '#c58ae0') : ''}
        ${detail}
      </div>`;
    }).join('') || '<div>Колонистов нет.</div>';
    list.querySelectorAll('.prio span').forEach(el => {
      el.onclick = (e) => {
        e.stopPropagation();
        const p = g.pawns.find(x => x.id === +el.dataset.pid);
        if (!p) return;
        const cur = p.prioOf(el.dataset.job);
        p.prio[el.dataset.job] = e.shiftKey ? Math.max(0, cur - 1) : (cur + 1) % 6;
        p.dropJob(g);
        this.lastUI = 1;
      };
    });
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
