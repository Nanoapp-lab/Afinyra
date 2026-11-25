import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('./portal.js', import.meta.url), 'utf8');

async function checkEntry(destination, { signedIn = true, moderator = false } = {}) {
  const nodes = new Map();
  const getNode = id => {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: id === 'login-card', value: '', disabled: false, textContent: '',
      listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; }
    });
    return nodes.get(id);
  };
  let target = null;
  const data = new Map();
  if (signedIn) data.set('vibeorbit_portal_session_v1', JSON.stringify({
    access_token: 'token', refresh_token: 'refresh', expires_at: Math.floor(Date.now() / 1000) + 3600
  }));
  const fetch = async (url, request = {}) => {
    const pathname = new URL(url).pathname;
    let payload;
    if (pathname === '/auth/v1/user') payload = { id: 'usuario-teste', email: 'teste@example.com' };
    else if (pathname === '/rest/v1/rpc/moderacao_eh_admin') payload = moderator;
    else if (pathname === '/auth/v1/token') payload = {
      access_token: 'token-novo', refresh_token: 'refresh-novo', expires_in: 3600
    };
    else throw new Error('Rota inesperada: ' + pathname);
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  };
  const context = {
    document: { body: { dataset: { portalPage: 'login' } }, getElementById: getNode },
    location: { search: destination ? '?destino=' + destination : '', replace(page) { target = page; } },
    sessionStorage: { getItem: key => data.get(key), setItem: (key, val) => data.set(key, val), removeItem: key => data.delete(key) },
    URLSearchParams, fetch, Date, JSON, Math, Number, Error
  };
  vm.runInNewContext(script, context, { filename: 'portal.js' });
  await new Promise(resolve => setTimeout(resolve, 0));
  return { target: () => target, node: getNode };
}

const chooser = await checkEntry('');
assert.equal(chooser.node('entry-choices').hidden, false, 'A entrada inicial apresenta a escolha');
assert.equal(chooser.node('login-card').hidden, true, 'A entrada inicial oculta o formulário');
assert.equal(chooser.target(), null, 'A sessão existente não deve pular a escolha');

const user = await checkEntry('app');
assert.equal(user.target(), 'app.html', 'O usuário comum abre o aplicativo web');
assert.equal(user.node('entry-choices').hidden, true);
assert.equal(user.node('login-card').hidden, false);

const forbidden = await checkEntry('moderacao');
assert.equal(forbidden.target(), null, 'Uma conta comum não abre a moderação');
assert.match(forbidden.node('portal-message').textContent, /não é moderadora/);
assert.equal(forbidden.node('create-account-actions').hidden, true);

const permitted = await checkEntry('moderacao', { moderator: true });
assert.equal(permitted.target(), 'admin.html', 'Uma conta autorizada entra na moderação');

const login = await checkEntry('app', { signedIn: false });
login.node('email').value = 'teste@example.com';
login.node('senha').value = 'senha-teste';
await login.node('login-form').listeners.submit({ preventDefault() {} });
assert.equal(login.target(), 'app.html', 'Login por e-mail abre o Deck da área normal');

console.log('OK: escolhas de entrada, login normal, moderação restrita e sessão existente.');
