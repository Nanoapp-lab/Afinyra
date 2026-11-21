// VibeOrbit web portal. The key below is PUBLIC and subject to Supabase RLS.
// Never place service_role/secret keys in this file or any browser asset.
const API_BASE = 'https://bzjwgvnyfunlwxfzbbbc.supabase.co';
const PUBLIC_KEY = 'sb_publishable_RX499hxGk3MI_WRF33POng_HcbiCl1O';
const SESSION_KEY = 'vibeorbit_portal_session_v1';
const VALID_STATUSES = ['pendente', 'em_analise', 'resolvida', 'descartada'];

function element(id) { return document.getElementById(id); }
function setMessage(message, isError = false) {
  const target = element('portal-message');
  if (!target) return;
  target.textContent = message;
  target.className = isError ? 'portal-alert error portal-status' : 'portal-status';
}
function session() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
  catch { return null; }
}
function saveSession(data) {
  const next = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600)
  };
  if (!next.access_token || !next.refresh_token) throw new Error('Sessão inválida');
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
  return next;
}
function clearSession() { sessionStorage.removeItem(SESSION_KEY); }

async function http(path, options = {}, token = null) {
  const headers = { apikey: PUBLIC_KEY, Accept: 'application/json', ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_BASE}${path}`, {
    ...options, headers, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
  });
  if (!response.ok) {
    const error = new Error(`Falha de comunicação (${response.status})`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}
async function refreshSession(current) {
  const next = await http('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', body: JSON.stringify({ refresh_token: current.refresh_token })
  });
  return saveSession(next);
}
async function getToken() {
  let current = session();
  if (!current) return null;
  if (current.expires_at <= Math.floor(Date.now() / 1000) + 90) {
    try { current = await refreshSession(current); }
    catch { clearSession(); return null; }
  }
  return current.access_token;
}
async function authenticated(path, options = {}) {
  let token = await getToken();
  if (!token) throw new Error('Sessão expirada');
  try { return await http(path, options, token); }
  catch (error) {
    if (error.status !== 401) throw error;
    const current = session();
    if (!current) throw error;
    try { token = (await refreshSession(current)).access_token; }
    catch { clearSession(); throw new Error('Sessão expirada'); }
    return http(path, options, token);
  }
}
async function currentUser() { return authenticated('/auth/v1/user'); }
async function isAdmin() {
  const allowed = await authenticated('/rest/v1/rpc/moderacao_eh_admin', {
    method: 'POST', body: '{}'
  });
  return allowed === true;
}
async function signOut() {
  const token = await getToken();
  if (token) {
    try { await http('/auth/v1/logout', { method: 'POST' }, token); }
    catch { /* The local session is cleared even if the network fails. */ }
  }
  clearSession();
  location.replace('entrar.html');
}
function attachLogout() {
  element('logout')?.addEventListener('click', signOut);
}
async function redirectToLogin() {
  clearSession();
  location.replace('entrar.html');
}

async function initLogin() {
  const form = element('login-form');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = element('login-submit');
    button.disabled = true;
    setMessage('Verificando suas credenciais...');
    try {
      const data = await http('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email: element('email').value.trim(), password: element('senha').value })
      });
      saveSession(data);
      element('senha').value = '';
      location.replace('conta.html');
    } catch {
      setMessage('Não foi possível entrar. Confira o e-mail, a senha e a conexão.', true);
    } finally { button.disabled = false; }
  });
}
async function initAccount() {
  attachLogout();
  try {
    const user = await currentUser();
    if (!user?.id) return redirectToLogin();
    element('account-email').textContent = user.email || 'Conta autenticada';
    element('account-content').hidden = false;
    setMessage('Sessão autenticada.');
    try { element('admin-link').hidden = !(await isAdmin()); }
    catch { element('admin-link').hidden = true; }
  } catch { redirectToLogin(); }
}

function make(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = String(value);
  return node;
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Data indisponível' : new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo'
  }).format(date);
}
function shortened(id) { return id ? `${String(id).slice(0, 8)}…` : 'Não informado'; }

async function saveDecision(item, select, note, feedback, button) {
  const newStatus = select.value;
  if (!VALID_STATUSES.includes(newStatus)) return;
  button.disabled = true;
  feedback.textContent = 'Registrando decisão...';
  try {
    const source = item.source === 'cegas' ? 'cegas_denuncias' : 'denuncias';
    const updated = await authenticated(`/rest/v1/${source}?id=eq.${encodeURIComponent(item.id)}&select=id,status`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: newStatus, nota_moderacao: note.value.trim().slice(0, 1000) })
    });
    if (!Array.isArray(updated) || updated.length !== 1) throw new Error('Sem autorização para alterar');
    feedback.textContent = 'Decisão registrada com sucesso.';
    await loadReports();
  } catch {
    feedback.textContent = 'Não foi possível registrar. Verifique a sessão e tente novamente.';
  } finally { button.disabled = false; }
}
function renderReport(item) {
  const card = make('article', 'report-card');
  const top = make('div', 'report-header');
  top.append(make('h3', null, item.source === 'cegas' ? 'Conversa às Cegas' : 'Denúncia geral'));
  top.append(make('span', 'portal-pill', item.status || 'pendente'));
  card.append(top);
  card.append(make('p', null, item.motivo));
  card.append(make('div', 'report-meta', `Registrada: ${formatDate(item.date)} · Caso ${shortened(item.id)}`));
  card.append(make('div', 'report-meta', `Denunciante: ${shortened(item.denunciante)} · Denunciado: ${shortened(item.denunciado)}`));
  if (item.conversa_id) card.append(make('div', 'report-meta', `Conversa: ${shortened(item.conversa_id)}`));
  const field = make('div', 'portal-field');
  const label = make('label', null, 'Situação da denúncia');
  const select = make('select');
  select.id = `status-${item.source}-${item.id}`;
  label.htmlFor = select.id;
  for (const status of VALID_STATUSES) {
    const option = make('option', null, status.replace('_', ' '));
    option.value = status;
    if (status === item.status) option.selected = true;
    select.append(option);
  }
  field.append(label, select);
  card.append(field);
  const noteField = make('div', 'portal-field');
  const noteLabel = make('label', null, 'Observação interna (máximo 1.000 caracteres)');
  const note = make('textarea');
  note.maxLength = 1000;
  note.value = item.nota_moderacao || '';
  note.id = `note-${item.source}-${item.id}`;
  noteLabel.htmlFor = note.id;
  noteField.append(noteLabel, note);
  card.append(noteField);
  const button = make('button', 'portal-button', 'Registrar decisão');
  button.type = 'button';
  const feedback = make('p', 'portal-subtle');
  feedback.setAttribute('role', 'status');
  button.addEventListener('click', () => saveDecision(item, select, note, feedback, button));
  card.append(button, feedback);
  return card;
}
async function loadAudit() {
  const target = element('audit-list');
  try {
    const events = await authenticated('/rest/v1/moderacao_historico?select=origem,denuncia_id,status_de,status_para,registrado_em&order=registrado_em.desc&limit=30');
    target.replaceChildren();
    if (!events.length) return target.append(make('p', null, 'Nenhuma decisão registrada ainda.'));
    const table = make('table', 'portal-table');
    const head = make('thead'); const row = make('tr');
    for (const title of ['Data', 'Origem', 'Caso', 'De', 'Para']) row.append(make('th', null, title));
    head.append(row); table.append(head);
    const body = make('tbody');
    for (const event of events) {
      const tr = make('tr');
      for (const value of [formatDate(event.registrado_em), event.origem, shortened(event.denuncia_id), event.status_de, event.status_para]) {
        tr.append(make('td', null, value || '—'));
      }
      body.append(tr);
    }
    table.append(body); target.append(table);
  } catch { target.textContent = 'Histórico temporariamente indisponível.'; }
}
async function loadReports() {
  const target = element('report-list');
  target.replaceChildren(make('p', 'portal-subtle', 'Atualizando denúncias...'));
  try {
    const [general, blind] = await Promise.all([
      authenticated('/rest/v1/denuncias?select=id,denunciante_id,denunciado_id,motivo,status,nota_moderacao,created_at&order=created_at.desc&limit=100'),
      authenticated('/rest/v1/cegas_denuncias?select=id,conversa_id,denunciante,denunciado,motivo,status,nota_moderacao,criado_em&order=criado_em.desc&limit=100')
    ]);
    const records = [
      ...general.map(r => ({ ...r, source: 'geral', date: r.created_at, denunciante: r.denunciante_id, denunciado: r.denunciado_id })),
      ...blind.map(r => ({ ...r, source: 'cegas', date: r.criado_em }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));
    element('total-count').textContent = String(records.length);
    element('pending-count').textContent = String(records.filter(r => r.status === 'pendente').length);
    element('review-count').textContent = String(records.filter(r => r.status === 'em_analise').length);
    target.replaceChildren();
    if (!records.length) target.append(make('p', 'portal-subtle', 'Nenhuma denúncia encontrada.'));
    for (const item of records) target.append(renderReport(item));
    await loadAudit();
  } catch {
    target.replaceChildren(make('p', 'portal-alert error', 'Não foi possível carregar as denúncias. Verifique a permissão administrativa e a integração do Supabase.'));
  }
}
async function initAdmin() {
  attachLogout();
  try {
    const user = await currentUser();
    if (!user?.id) return redirectToLogin();
    if (!(await isAdmin())) {
      setMessage('Acesso negado. Esta conta não possui permissão de moderação.', true);
      return;
    }
    setMessage('Administrador autenticado.');
    element('admin-content').hidden = false;
    element('refresh-reports').addEventListener('click', loadReports);
    await loadReports();
  } catch { redirectToLogin(); }
}

const page = document.body.dataset.portalPage;
if (page === 'login') initLogin();
if (page === 'account') initAccount();
if (page === 'admin') initAdmin();
