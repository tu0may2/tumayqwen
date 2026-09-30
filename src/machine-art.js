// Рисунки машин: векторные спрайты вместо эмодзи, с анимацией работающих узлов.
// Каждая функция рисует в локальных координатах тайла 0..TILE.
import { TILE } from './world.js';

const T = TILE;

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Корпус прибора: металл, блик, болты. */
function housing(ctx, st, tint) {
  const on = !(st.def.power < 0 && st.powered === false);
  const g = ctx.createLinearGradient(0, 0, 0, T);
  g.addColorStop(0, on ? (tint || '#4a707d') : '#4b3f4d');
  g.addColorStop(1, on ? '#223a44' : '#2a222d');
  ctx.fillStyle = g;
  rr(ctx, 1, 2, T - 2, T - 3, 3); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.13)';
  ctx.fillRect(2.5, 3.2, T - 5, 1.2);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  for (const [bx, by] of [[3, 4.5], [T - 3, 4.5], [3, T - 3], [T - 3, T - 3]]) {
    ctx.beginPath(); ctx.arc(bx, by, 0.7, 0, 7); ctx.fill();
  }
  return on;
}

/** Отметка «нет провода» — машина даже не подключена к сети. */
export function unplugged(ctx) {
  ctx.strokeStyle = '#ff6b5e';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(T - 3.5, T - 3.5, 2.4, 0, 7);
  ctx.moveTo(T - 5.2, T - 5.2); ctx.lineTo(T - 1.8, T - 1.8);
  ctx.stroke();
}

function led(ctx, on, color) {
  ctx.fillStyle = on ? (color || '#7ed957') : '#ff6b5e';
  ctx.beginPath(); ctx.arc(T - 3, 4, 1.5, 0, 7); ctx.fill();
  if (on) {
    ctx.fillStyle = 'rgba(126,217,87,.35)';
    ctx.beginPath(); ctx.arc(T - 3, 4, 2.8, 0, 7); ctx.fill();
  }
}

/** Вращающаяся крыльчатка. */
function fan(ctx, cx, cy, r, angle, blades = 4, color = '#cfe6ea') {
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(angle);
  ctx.fillStyle = color;
  for (let i = 0; i < blades; i++) {
    ctx.rotate((Math.PI * 2) / blades);
    ctx.beginPath();
    ctx.ellipse(r * 0.55, 0, r * 0.5, r * 0.22, 0.5, 0, 7);
    ctx.fill();
  }
  ctx.fillStyle = '#233942';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.22, 0, 7); ctx.fill();
  ctx.restore();
}

export const MACHINE_ART = {
  diffuser(ctx, st, t) {
    const on = housing(ctx, st);
    const spin = on && (st.store.algae || 0) > 0 ? t * 6 : 0;
    ctx.fillStyle = '#1d3038';
    ctx.beginPath(); ctx.arc(T / 2, T / 2 + 1, 4.6, 0, 7); ctx.fill();
    fan(ctx, T / 2, T / 2 + 1, 4.4, spin);
    // зелёный столбик запаса водорослей
    const lvl = Math.min(1, (st.store.algae || 0) / 20);
    ctx.fillStyle = '#5da84a';
    ctx.fillRect(2.5, T - 3 - lvl * 6, 2, lvl * 6);
    led(ctx, on);
  },

  skimmer(ctx, st, t) {
    const on = housing(ctx, st);
    ctx.strokeStyle = on ? '#9fd8e6' : '#5c6a70';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let a = 0; a < 10; a++) {
      const ang = a * 0.7 + (on ? t * 2 : 0);
      const r = 1 + a * 0.45;
      ctx.lineTo(T / 2 + Math.cos(ang) * r, T / 2 + 1 + Math.sin(ang) * r);
    }
    ctx.stroke();
    led(ctx, on);
  },

  generator(ctx, st, t) {
    housing(ctx, st, '#5c5140');
    const spin = (st.operating || 0) > 0 ? t * 7 : 0;
    ctx.save();
    ctx.translate(T / 2, T / 2 + 1); ctx.rotate(spin);
    ctx.strokeStyle = '#d9c07a'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 0, 4.6, 0, 7); ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 3; i++) { ctx.rotate(Math.PI * 2 / 3); ctx.moveTo(0, 0); ctx.lineTo(4.6, 0); }
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = (st.operating || 0) > 0 ? '#7ed957' : '#48555c';
    ctx.beginPath(); ctx.arc(T - 3, 4, 1.5, 0, 7); ctx.fill();
  },

  coalgen(ctx, st, t) {
    housing(ctx, st, '#4a4038');
    // топка с огнём
    ctx.fillStyle = '#1a1512';
    rr(ctx, 3, 6, T - 6, T - 9, 1.5); ctx.fill();
    if (st.burning) {
      const flick = 0.6 + Math.sin(t * 12) * 0.25;
      const g = ctx.createRadialGradient(T / 2, T - 5, 0, T / 2, T - 5, 6);
      g.addColorStop(0, `rgba(255,190,80,${flick})`);
      g.addColorStop(1, 'rgba(210,60,20,0)');
      ctx.fillStyle = g;
      ctx.fillRect(2, 4, T - 4, T - 5);
    }
    ctx.fillStyle = '#2b2b30';
    const lvl = Math.min(1, (st.store.coal || 0) / 20);
    ctx.fillRect(2.5, T - 3 - lvl * 5, 2, lvl * 5);
  },

  battery(ctx, st) {
    housing(ctx, st, '#3f5c52');
    const k = Math.min(1, st.charge / st.def.storeJ);
    ctx.fillStyle = '#16262b';
    rr(ctx, 3.5, 4.5, T - 7, T - 8, 1.5); ctx.fill();
    ctx.fillStyle = k > 0.6 ? '#7ed957' : k > 0.25 ? '#ffb43d' : '#ff6b5e';
    const h = (T - 9) * k;
    ctx.fillRect(4.2, T - 4.5 - h, T - 8.4, h);
    ctx.fillStyle = '#cfe6ea';
    ctx.fillRect(T / 2 - 1.6, 2.6, 3.2, 1.6);
  },

  lamp(ctx, st, t) {
    const on = st.powered;
    ctx.fillStyle = '#4b555c';
    rr(ctx, T / 2 - 4, 2, 8, 3.4, 1); ctx.fill();
    ctx.fillStyle = on ? '#ffe9a8' : '#6b7278';
    ctx.beginPath(); ctx.arc(T / 2, 8, 3.4, 0, 7); ctx.fill();
    if (on) {
      const g = ctx.createRadialGradient(T / 2, 8, 1, T / 2, 8, 9);
      g.addColorStop(0, 'rgba(255,224,150,.4)');
      g.addColorStop(1, 'rgba(255,214,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, T, T);
    }
  },

  bed(ctx, st) {
    ctx.fillStyle = '#6b4a35';
    rr(ctx, 1, T - 7, T - 2, 6, 1.5); ctx.fill();
    ctx.fillStyle = '#cfd9e0';                       // подушка
    rr(ctx, 2, T - 9, 5, 3.4, 1.4); ctx.fill();
    ctx.fillStyle = '#4b7fa8';                       // одеяло
    rr(ctx, 6.5, T - 9.5, T - 8, 4.4, 1.4); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(7, T - 8); ctx.lineTo(T - 2, T - 8); ctx.stroke();
  },

  medcot(ctx, st) {
    MACHINE_ART.bed(ctx, st);
    ctx.fillStyle = '#e5f2f5';
    ctx.fillRect(T - 6, T - 8.5, 3.6, 1.2);
    ctx.fillRect(T - 4.8, T - 9.7, 1.2, 3.6);
  },

  bin(ctx, st) {
    ctx.fillStyle = '#7a5b3a';
    rr(ctx, 1.5, 4, T - 3, T - 5, 1.5); ctx.fill();
    ctx.strokeStyle = '#4e3a24'; ctx.lineWidth = 0.9;
    for (let y = 6; y < T - 1; y += 3.4) { ctx.beginPath(); ctx.moveTo(2, y); ctx.lineTo(T - 2, y); ctx.stroke(); }
    ctx.strokeStyle = '#3a2b1a';
    ctx.strokeRect(1.8, 4.3, T - 3.6, T - 5.6);
    const used = Object.values(st.store || {}).reduce((a, b) => a + b, 0);
    if (used > 0) {
      ctx.fillStyle = '#d8c08a';
      ctx.fillRect(2.6, 5, (T - 5.2) * Math.min(1, used / st.def.cap), 1.2);
    }
  },

  ration(ctx, st) {
    housing(ctx, st, '#5a6a72');
    ctx.fillStyle = '#c9dde4';
    rr(ctx, 3, 4.5, T - 6, T - 7, 1.5); ctx.fill();
    ctx.fillStyle = '#7d949c';
    ctx.fillRect(T - 5.5, 6.5, 1.2, 4);
    if (st.chilled) {
      ctx.strokeStyle = 'rgba(180,230,245,.7)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(4.5, 8); ctx.lineTo(8.5, 8); ctx.moveTo(6.5, 6); ctx.lineTo(6.5, 10); ctx.stroke();
    }
  },

  table(ctx) {
    ctx.fillStyle = '#8a6a44';
    ctx.fillRect(1, T - 8, T - 2, 2.4);
    ctx.fillStyle = '#6a5031';
    ctx.fillRect(3, T - 5.6, 1.6, 4.6);
    ctx.fillRect(T - 4.6, T - 5.6, 1.6, 4.6);
    ctx.fillStyle = '#dfe9ec';                       // тарелка
    ctx.beginPath(); ctx.ellipse(T / 2, T - 9, 3, 1.2, 0, 0, 7); ctx.fill();
  },

  farm(ctx, st) {
    ctx.fillStyle = '#6d5236';
    rr(ctx, 1, T - 7, T - 2, 6, 1.2); ctx.fill();
    ctx.fillStyle = '#4b3a26';
    ctx.fillRect(2, T - 6, T - 4, 4.4);
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.fillRect(1, T - 7, T - 2, 1);
  },

  research(ctx, st, t) {
    const on = housing(ctx, st, '#3f5a6b');
    ctx.fillStyle = on ? '#8fe3d8' : '#33484f';
    rr(ctx, 3, 4.5, T - 6, 6, 1); ctx.fill();
    if (on) {
      ctx.fillStyle = 'rgba(20,50,55,.7)';
      for (let i = 0; i < 3; i++) {
        const wdt = 2 + ((Math.sin(t * 3 + i * 2) + 1) * 3);
        ctx.fillRect(4, 5.6 + i * 1.7, wdt, 0.9);
      }
    }
    ctx.fillStyle = '#2c3d45';
    ctx.fillRect(3, T - 4.5, T - 6, 2.5);
  },

  grill(ctx, st, t) {
    const on = housing(ctx, st, '#5b4a44');
    ctx.fillStyle = '#2a2320';
    rr(ctx, 2.5, 5, T - 5, T - 8, 1.2); ctx.fill();
    ctx.fillStyle = '#b4bcc0';                       // кастрюля
    rr(ctx, 4.5, 4, T - 9, 3.4, 1); ctx.fill();
    if (on && (st.cookProg || 0) > 0) {
      ctx.strokeStyle = 'rgba(230,240,245,.55)'; ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const x = 5.5 + i * 2.2;
        ctx.moveTo(x, 3.6);
        ctx.quadraticCurveTo(x + Math.sin(t * 4 + i) * 1.5, 1.6, x, 0.2);
      }
      ctx.stroke();
    }
    led(ctx, on);
  },

  outhouse(ctx, st) {
    ctx.fillStyle = '#7d6a4f';
    rr(ctx, 1.5, 3, T - 3, T - 4, 1.5); ctx.fill();
    ctx.fillStyle = '#e8eef0';
    rr(ctx, 4, 7, T - 8, 5, 2); ctx.fill();
    ctx.fillStyle = '#9fb0b6';
    rr(ctx, 4, 5.4, T - 8, 2, 1); ctx.fill();
    const used = Math.min(1, (st.uses || 0) / 8);
    if (used > 0) { ctx.fillStyle = '#8a8a4a'; ctx.fillRect(2.4, T - 3.4, (T - 4.8) * used, 1.2); }
  },

  basin(ctx, st) {
    housing(ctx, st, '#4c6a74');
    ctx.fillStyle = '#d3e6ec';
    rr(ctx, 3, 7, T - 6, 5, 1.6); ctx.fill();
    ctx.strokeStyle = '#9fb7be'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(T / 2, 7); ctx.lineTo(T / 2, 4.5); ctx.lineTo(T / 2 + 2.6, 4.5); ctx.stroke();
  },

  shower(ctx, st, t) {
    housing(ctx, st, '#46626e');
    ctx.fillStyle = '#c3d8de';
    rr(ctx, T / 2 - 3.5, 3, 7, 2, 1); ctx.fill();
    ctx.strokeStyle = 'rgba(160,215,235,.75)'; ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const x = T / 2 - 2.4 + i * 1.6;
      const y = 5.5 + ((t * 18 + i * 3) % 7);
      ctx.moveTo(x, y); ctx.lineTo(x, y + 1.6);
    }
    ctx.stroke();
  },

  electro(ctx, st, t) {
    const on = housing(ctx, st, '#3d6472');
    ctx.fillStyle = '#132a33';
    rr(ctx, 3, 4, T - 6, T - 6, 1.5); ctx.fill();
    ctx.fillStyle = 'rgba(90,170,220,.75)';
    ctx.fillRect(3.6, T / 2, T - 7.2, T / 2 - 2.6);
    if (on) {
      ctx.fillStyle = 'rgba(210,240,255,.8)';
      for (let i = 0; i < 4; i++) {
        const x = 4.5 + i * 2, y = T - 4 - ((t * 14 + i * 4) % 8);
        ctx.beginPath(); ctx.arc(x, y, 0.7, 0, 7); ctx.fill();
      }
    }
    led(ctx, on);
  },

  sieve(ctx, st) {
    const on = housing(ctx, st, '#4c6553');
    ctx.fillStyle = '#16262b';
    rr(ctx, 3, 4, T - 6, T - 6, 1.2); ctx.fill();
    ctx.strokeStyle = '#8fb08a'; ctx.lineWidth = 0.8;
    for (let y = 6; y < T - 3; y += 2.2) { ctx.beginPath(); ctx.moveTo(3.6, y); ctx.lineTo(T - 3.6, y); ctx.stroke(); }
    const lvl = Math.min(1, (st.store.stone || 0) / 20);
    ctx.fillStyle = '#b9a884';
    ctx.fillRect(2.4, T - 3.2 - lvl * 4, 1.8, lvl * 4);
    led(ctx, on);
  },

  lpump(ctx, st, t) {
    const on = housing(ctx, st, '#3f5f75');
    ctx.fillStyle = '#16262b';
    ctx.beginPath(); ctx.arc(T / 2, T / 2 + 1, 4.8, 0, 7); ctx.fill();
    fan(ctx, T / 2, T / 2 + 1, 4.4, on ? t * 9 : 0, 3, '#7fc3e8');
    led(ctx, on);
  },

  gpump(ctx, st, t) {
    const on = housing(ctx, st, '#5b4f75');
    ctx.fillStyle = '#1c1a2a';
    ctx.beginPath(); ctx.arc(T / 2, T / 2 + 1, 4.8, 0, 7); ctx.fill();
    fan(ctx, T / 2, T / 2 + 1, 4.4, on ? t * 9 : 0, 5, '#cbb0e8');
    led(ctx, on);
  },

  gvent(ctx, st, t) {
    ctx.fillStyle = '#4a5560';
    rr(ctx, 1.5, 3, T - 3, T - 5, 1.5); ctx.fill();
    ctx.strokeStyle = '#8fa2ad'; ctx.lineWidth = 1;
    for (let y = 5; y < T - 3; y += 2.4) { ctx.beginPath(); ctx.moveTo(3, y); ctx.lineTo(T - 3, y); ctx.stroke(); }
  },

  lvent(ctx, st, t) {
    MACHINE_ART.gvent(ctx, st, t);
    ctx.fillStyle = 'rgba(90,170,230,.8)';
    ctx.beginPath(); ctx.arc(T / 2, T - 3.5 - ((t * 10) % 4), 1, 0, 7); ctx.fill();
  },

  suitdock(ctx, st) {
    const on = housing(ctx, st, '#4b5f6b');
    ctx.fillStyle = '#d6e4e8';
    ctx.beginPath(); ctx.arc(T / 2, 7, 3, 0, 7); ctx.fill();
    ctx.fillStyle = '#6f8b96';
    rr(ctx, T / 2 - 3.4, 9.5, 6.8, 4.5, 1.4); ctx.fill();
    const o2 = Math.min(1, (st.store.o2 || 0) / 40);
    ctx.fillStyle = '#7fd8f0';
    ctx.fillRect(2.4, T - 3.2 - o2 * 5, 1.6, o2 * 5);
    led(ctx, on);
  },

  arcade(ctx, st, t) {
    const on = housing(ctx, st, '#54406b');
    ctx.fillStyle = on ? '#8ff0d8' : '#2c3b40';
    rr(ctx, 3, 4, T - 6, 6, 1); ctx.fill();
    if (on) {
      ctx.fillStyle = '#1b3038';
      const x = 4 + ((t * 9) % (T - 9));
      ctx.fillRect(x, 7.5, 2, 1.6);
      ctx.fillRect(4, 5, 1.4, 1.4);
    }
    ctx.fillStyle = '#c05a7a';
    ctx.beginPath(); ctx.arc(5.5, T - 4, 1.2, 0, 7); ctx.fill();
    ctx.fillStyle = '#5ac0d0';
    ctx.beginPath(); ctx.arc(9, T - 4, 1.2, 0, 7); ctx.fill();
  },

  sculpt(ctx) {
    ctx.fillStyle = '#6e7783';
    rr(ctx, 4, T - 4, T - 8, 3, 0.8); ctx.fill();
    ctx.fillStyle = '#8b94a1';
    ctx.beginPath();
    ctx.moveTo(T / 2 - 2.6, T - 4);
    ctx.lineTo(T / 2 - 1.4, 4.5);
    ctx.lineTo(T / 2 + 1.4, 4.5);
    ctx.lineTo(T / 2 + 2.6, T - 4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#a7b0bc';
    ctx.beginPath(); ctx.arc(T / 2, 3.6, 2, 0, 7); ctx.fill();
  },

  compost(ctx, st) {
    ctx.fillStyle = '#5c5334';
    rr(ctx, 1.5, 4, T - 3, T - 5, 1.4); ctx.fill();
    ctx.fillStyle = '#6f6a3a';
    ctx.fillRect(2.5, 7, T - 5, T - 9);
    ctx.strokeStyle = '#c58a6a'; ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(4, T - 4); ctx.quadraticCurveTo(6, T - 6.5, 8, T - 4);
    ctx.stroke();
  },

  feeder(ctx, st) {
    ctx.fillStyle = '#7a8088';
    ctx.beginPath();
    ctx.ellipse(T / 2, T - 4, 5.2, 2.4, 0, Math.PI, 0, true);
    ctx.fill();
    const lvl = Math.min(1, (st.store.stone || 0) / 20);
    ctx.fillStyle = '#9a8a6a';
    ctx.beginPath(); ctx.ellipse(T / 2, T - 4.4, 4 * lvl, 1.4 * lvl, 0, 0, 7); ctx.fill();
  },

  tsensor(ctx, st) { sensorBody(ctx, st, '#ff9a5c', '🌡'); },
  psensor(ctx, st) { sensorBody(ctx, st, '#9ad0ff', '◴'); },
  wsensor(ctx, st) { sensorBody(ctx, st, '#6fb6e8', '≈'); },
  switch(ctx, st) {
    housing(ctx, st, '#4a5a4a');
    ctx.fillStyle = '#20302c';
    rr(ctx, 4, 5, T - 8, T - 8, 1.4); ctx.fill();
    const on = st.on !== false;
    ctx.fillStyle = on ? '#7ed957' : '#ff6b5e';
    ctx.fillRect(5, on ? 6 : T - 8, T - 10, 2.6);
  },
};

function sensorBody(ctx, st, color, glyph) {
  housing(ctx, st, '#3e4f58');
  ctx.fillStyle = '#132228';
  ctx.beginPath(); ctx.arc(T / 2, T / 2 + 0.5, 4.2, 0, 7); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(T / 2, T / 2 + 0.5, 3, -2.4, st.signal ? 0.6 : -0.9); ctx.stroke();
  ctx.fillStyle = st.signal ? '#7ed957' : '#48555c';
  ctx.beginPath(); ctx.arc(T - 3, 4, 1.4, 0, 7); ctx.fill();
}
