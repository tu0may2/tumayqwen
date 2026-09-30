// Сборка однофайловой версии игры: CSS и все модули складываются в один HTML.
// Запуск: node tools/build-standalone.mjs [выходной файл]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
// --artifact: без обёртки <html>/<head>/<body> — так требует хостинг артефактов
const artifact = args.includes('--artifact');
const out = args.find(a => !a.startsWith('--')) || join(root, 'deepcolony.html');

/** Порядок модулей выводим из их же импортов, чтобы ничего не забыть вручную. */
function moduleOrder(entry = 'main.js') {
  const order = [], seen = new Set();
  const visit = (name, stack = []) => {
    if (seen.has(name)) return;
    if (stack.includes(name)) throw new Error(`цикл импортов: ${[...stack, name].join(' → ')}`);
    const code = readFileSync(join(root, 'src', name), 'utf8');
    for (const m of code.matchAll(/from\s*['"]\.\/([\w.-]+\.js)['"]/g)) visit(m[1], [...stack, name]);
    seen.add(name);
    order.push(name);
  };
  visit(entry);
  return order;
}

const ORDER = moduleOrder();

/** Убрать import/export: в одном файле всё живёт в общей области видимости. */
function stripModuleSyntax(code) {
  return code
    .replace(/^\s*import\s+[^;]*?from\s*['"][^'"]+['"]\s*;?\s*$/gms, '')
    .replace(/^\s*import\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
    .replace(/^\s*export\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]\s*;?\s*$/gms, '')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gms, '')
    .replace(/^(\s*)export\s+(default\s+)?/gm, '$1');
}

const css = readFileSync(join(root, 'style.css'), 'utf8');
const body = readFileSync(join(root, 'index.html'), 'utf8')
  .match(/<body>([\s\S]*?)<script/)[1]
  .trim();

const modules = ORDER.map(name => {
  const code = stripModuleSyntax(readFileSync(join(root, 'src', name), 'utf8')).trim();
  return `// ===== ${name} ${'='.repeat(Math.max(0, 60 - name.length))}\n${code}`;
}).join('\n\n');

const page = `<title>Deep Colony</title>
<style>
${css.trim()}
</style>
${body}
<script type="module">
${modules}
</script>
`;

const html = artifact ? page : `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body>
${page}</body>
</html>
`;

writeFileSync(out, html);
console.log(`собрано${artifact ? ' (артефакт)' : ''}: ${out} (${(html.length / 1024).toFixed(0)} КБ, модулей: ${ORDER.length})`);
