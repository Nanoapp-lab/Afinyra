import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./app.html', import.meta.url), 'utf8');
const style = readFileSync(new URL('./app.css', import.meta.url), 'utf8');
const pages = ['deck', 'conexoes', 'conversas', 'comunidade', 'responde', 'salas', 'perfil'];

for (const view of pages) {
  const icon = readFileSync(new URL(`./assets/nav-${view}.svg`, import.meta.url), 'utf8');
  assert.match(icon, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 64 64"/);
  assert.ok(icon.includes('</svg>'), `O ícone ${view} deve ser um SVG completo.`);
  assert.doesNotMatch(icon, /<script|onload=|foreignObject/i, `O ícone ${view} não deve executar scripts.`);
  assert.match(html, new RegExp(`data-view="${view}"[^\n]*src="assets/nav-${view}\\.svg"`), `O menu deve usar o ícone ${view}.`);
}
assert.equal((html.match(/class="nav-item"/g) || []).length, 7);
assert.match(html, /data-panel="responde"/);
assert.match(html, /id="community-question-form"/);
assert.match(style, /\.nav-icon-wrap img\{/);
console.log('OK: 7 ícones exclusivos em SVG e seção Afinzer Responde integrados ao menu.');
