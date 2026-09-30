// Точка входа: создание мира и главный цикл.
import { Game } from './game.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';

const seed = Number(new URLSearchParams(location.search).get('seed')) || (Date.now() & 0xffff);
const game = new Game(seed);
const renderer = new Renderer(document.getElementById('view'), game.world);
const ui = new UI(game, renderer);

window.game = game;          // для отладки из консоли
window.renderer = renderer;
window.ui = ui;

let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - prev) / 1000);
  prev = now;
  game.update(dt);
  renderer.draw(game);
  ui.update(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
