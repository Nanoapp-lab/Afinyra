import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('./portal.js', import.meta.url), 'utf8');

async function checkEntry({ signedIn = true, moderator = false, email = 'teste@example.com' } = {}) {
  const nodes = new Map();
  const getNode = id => {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: id === 'entry-choices', value: '', disabled: false, textContent: '',
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
    if (pathname === '/auth/v1/user') payload = { id: 'usuario-teste', email };
    else if (pathname === '/rest/v1/rpc/moderacao_eh_admin') payload = moderator;
    else if (pathname === '/auth/v1/token') payload = {
      access_token: 'token-novo', refresh_token: 'refresh-novo', expires_in: 3600
    };
    else throw new Error('Rota inesperada: ' + pathname);
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  };
  const context = {
    document: { body: { dataset: { portalPage: 'login' } }, getElementById: getNode },
    location: { search: '', replace(page) { target = page; } },
    sessionStorage: { getItem: key => data.get(key), setItem: (key, val) => data.set(key, val), removeItem: key => data.delete(key) },
    URLSearchParams, fetch, Date, JSON, Math, Number, Error
  };
  vm.runInNewContext(script, context, { filename: 'portal.js' });
  await new Promise(resolve => setTimeout(resolve, 0));
  return { target: () => target, node: getNode };
}

const fresh = await checkEntry({ signedIn: false });
assert.equal(fresh.node('entry-choices').hidden, true, 'Antes do login, a escolha fica escondida');
assert.equal(fresh.node('login-card').hidden, false, 'Antes do login, aparecem e-mail e senha');
assert.equal(fresh.target(), null);

const user = await checkEntry();
assert.equal(user.target(), 'app.html', 'O usuário comum abre o aplicativo web');
assert.equal(user.node('entry-choices').hidden, true);

const forbidden = await checkEntry({ moderator: false, email: '01juliano02@gmail.com' });
assert.equal(forbidden.target(), 'app.html', 'Sem autorização do servidor, até o e-mail identificado entra como usuário comum');
assert.equal(forbidden.node('entry-choices').hidden, true);

const permitted = await checkEntry({ moderator: true, email: '01juliano02@gmail.com' });
assert.equal(permitted.target(), null, 'Conta moderadora não é redirecionada automaticamente');
assert.equal(permitted.node('entry-choices').hidden, false, 'A escolha só aparece depois de autenticar a conta moderadora');
assert.equal(permitted.node('login-card').hidden, true);

const differentModerator = await checkEntry({ moderator: true, email: 'outra@example.com' });
assert.equal(differentModerator.target(), 'app.html', 'A escolha especial não aparece para outros e-mails');

const login = await checkEntry({ signedIn: false });
login.node('email').value = 'teste@example.com';
login.node('senha').value = 'senha-teste';
await login.node('login-form').listeners.submit({ preventDefault() {} });
assert.equal(login.target(), 'app.html', 'Login por e-mail abre o Deck da área normal');

const moderatorLogin = await checkEntry({ signedIn: false, moderator: true, email: '01juliano02@gmail.com' });
moderatorLogin.node('email').value = '01juliano02@gmail.com';
moderatorLogin.node('senha').value = 'senha-teste';
await moderatorLogin.node('login-form').listeners.submit({ preventDefault() {} });
assert.equal(moderatorLogin.node('entry-choices').hidden, false, 'Login normal da conta moderadora mostra a escolha depois da senha');

console.log('OK: login normal primeiro; escolha apenas após autenticação da conta moderadora.');
