import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const root = resolve(import.meta.dirname);
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const full = resolve(root, '.' + pathname);
  if (!full.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(full);
    const type = ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' })[extname(full)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }).end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
let premium = false;
let testMode = 'real';
const messages = [{ id: 'initial', created_at: new Date().toISOString(), conteudo: 'Olá, pessoal!', id_remetente: 'someone-else', nome_remetente: 'Pessoa do teste' }];
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', err => errors.push(err.message));
await page.addInitScript(() => sessionStorage.setItem('vibeorbit_portal_session_v1', JSON.stringify({ access_token: 'fake-access', refresh_token: 'fake-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600 })));
await page.route('https://bzjwgvnyfunlwxfzbbbc.supabase.co/**', async route => {
  const req = route.request();
  const url = new URL(req.url());
  const ok = body => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST', 'access-control-allow-headers': '*' } });
  if (url.pathname === '/auth/v1/user') return ok({ id: 'person-one', email: 'usuario@example.test' });
  if (url.pathname.endsWith('/rpc/meu_premium_ativo')) return ok(premium);
  if (url.pathname.endsWith('/rpc/meu_plano_teste')) return ok({ autorizado: true, modo: testMode,
    premium_real: false, premium_efetivo: premium });
  if (url.pathname.endsWith('/rpc/definir_plano_teste')) {
    testMode = JSON.parse(req.postData()).p_modo;
    premium = testMode === 'premium';
    return ok({ autorizado: true, modo: testMode, premium_real: false, premium_efetivo: premium });
  }
  if (url.pathname.endsWith('/rpc/moderacao_minha_restricao')) return ok({ restrita: false });
  if (url.pathname.endsWith('/rpc/tempo_chat_global')) return ok({ permitido: true, premium, segundos_restantes: 1790 });
  if (url.pathname.endsWith('/rpc/tempo_assunto_compartilhado')) return ok({ permitido: true, premium, segundos_restantes: 1790 });
  if (url.pathname.endsWith('/rpc/tempo_sala_assunto')) return ok({ permitido: premium, premium, segundos_restantes: 86400 });
  if (url.pathname === '/rest/v1/usuarios') return ok([{ nome: 'Pessoa de teste', cidade_atual: 'São Paulo - SP', foto_url: null }]);
  if (url.pathname === '/rest/v1/salas') return ok([{ id: 'public:assunto_teste', nome: 'Música e boas conversas', assunto: 'Música', cidade: '' }]);
  if (url.pathname === '/rest/v1/mensagens' && req.method() === 'POST') {
    const body = JSON.parse(req.postData());
    await new Promise(resolve => setTimeout(resolve, 220));
    messages.push({ ...body, id: 'new-message', created_at: new Date().toISOString() });
    return ok([messages.at(-1)]);
  }
  if (url.pathname === '/rest/v1/mensagens') return ok(messages.filter(m => (m.sala_id || 'Global') === url.searchParams.get('sala_id')?.replace('eq.', '') || !m.sala_id));
  return route.fulfill({ status: 404, body: '{}' });
});

function ensure(condition, label) { if (!condition) throw new Error('FALHOU: ' + label); console.log('OK: ' + label); }
try {
  await page.goto(origin + '/entrar.html');
  await page.waitForURL('**/app.html');
  await page.locator('#home-title').waitFor();
  ensure(page.url().includes('/app.html'), 'sessão existente abre área interna sem login');
  await page.locator('[data-view="conversas"].nav-item').click();
  await page.locator('#open-global').click();
  await page.locator('.chat-bubble').first().waitFor();
  ensure((await page.locator('.chat-bubble').count()) > 0, 'Chat Global mostra mensagens do banco');
  await page.locator('#chat-input').fill('Primeira mensagem');
  await page.locator('#chat-send').click();
  await page.locator('#chat-input').fill('Novo texto que não deve sumir');
  await page.waitForTimeout(350);
  ensure(await page.locator('#chat-input').inputValue() === 'Novo texto que não deve sumir', 'nova mensagem preservada durante envio');
  await page.locator('[data-view="salas"].nav-item').click();
  await page.locator('.room-card').first().waitFor();
  ensure(await page.locator('.room-card button').first().isEnabled(), 'Free pode entrar em sala por assunto com saldo compartilhado');
  await page.locator('#preview-plan').selectOption('premium');
  await page.locator('#plan-pill').getByText('Premium · TESTE').waitFor();
  ensure((await page.locator('#real-plan-pill').innerText()).includes('Free original'), 'Premium de teste preserva plano original');
  await page.locator('[data-view="salas"].nav-item').click();
  ensure(await page.locator('.room-card button').first().isEnabled(), 'Premium de teste libera entrada real em sala');
  await page.screenshot({ path: resolve(root, 'app-preview-desktop.png'), fullPage: true });
  await page.locator('.room-card button').first().click();
  await page.locator('#chat-input:not([disabled])').waitFor();
  ensure(await page.locator('#chat-title').innerText() === 'Música e boas conversas', 'Premium entra em sala real');
  await page.locator('#preview-plan').selectOption('free');
  await page.locator('#plan-pill').getByText('Free · TESTE').waitFor();
  ensure((await page.locator('#rooms-plan-note').innerText()).includes('30 min/dia'), 'Modo Free aplica limite de tempo');
  await page.locator('#preview-return-real').click();
  await page.waitForFunction(() => document.querySelector('#plan-pill')?.textContent?.trim() === '♡ Free');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(root, 'app-preview-mobile.png'), fullPage: true });
  ensure(errors.length === 0, 'sem erros JavaScript: ' + errors.join('; '));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
