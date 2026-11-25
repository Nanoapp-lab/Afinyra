// Afinzer web portal. The key below is PUBLIC and subject to Supabase RLS.
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
    const body = await response.json().catch(() => ({}));
    const explanation = typeof body.error === 'string' ? body.error :
      (typeof body.message === 'string' ? body.message : `Falha de comunicação (${response.status})`);
    const error = new Error(explanation.slice(0, 280));
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  const raw = await response.text();
  // O PostgREST pode confirmar INSERT com 201 e corpo vazio (return=minimal).
  return raw ? JSON.parse(raw) : null;
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
  // A escolha não aparece antes da autenticação, nem para usuários comuns.
  // O e-mail apenas identifica qual conta mostra a escolha; permissões de
  // moderação continuam conferidas pelo RPC protegido no Supabase.
  async function finishLogin(user) {
    if (user?.email?.trim().toLowerCase() === '01juliano02@gmail.com' && await isAdmin()) {
      element('login-card').hidden = true;
      element('entry-choices').hidden = false;
      element('entry-kicker').textContent = 'CONTA DE MODERAÇÃO';
      element('entry-heading').textContent = 'Como você quer entrar?';
      element('entry-intro').textContent = 'Sua conta pode usar o Afinzer normalmente ou abrir a moderação.';
      setMessage('');
      return;
    }
    location.replace('app.html');
  }
  element('choice-logout').addEventListener('click', signOut);
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
      const user = await currentUser();
      if (!user?.id) throw new Error('Usuário não confirmado');
      await finishLogin(user);
    } catch {
      setMessage('Não foi possível entrar. Confira o e-mail, a senha e a conexão.', true);
    } finally { button.disabled = false; }
  });

  // Sessões já autenticadas passam pela mesma decisão de acesso.
  if (session()?.refresh_token) {
    setMessage('Verificando sua sessão atual...');
    try {
      const user = await currentUser();
      if (user?.id) {
        await finishLogin(user);
        return;
      }
    } catch (error) {
      // Somente falhas de autorizacao comprovadas invalidam a sessao aqui.
      if (error.status === 401 || error.status === 403) clearSession();
    }
    setMessage('');
  }
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
    try {
      const { initProfile } = await import('./perfil.js');
      await initProfile({ authenticated, getToken, user, apiBase: API_BASE, publicKey: PUBLIC_KEY });
    } catch {
      element('profile-panel').hidden = false;
      element('profile-submit').disabled = true;
      element('profile-status').textContent = 'Não foi possível abrir o editor. Recarregue a página para tentar novamente.';
    }
  } catch { redirectToLogin(); }
}

async function initApp() {
  attachLogout();
  try {
    const user = await currentUser();
    if (!user?.id) return redirectToLogin();
    const { initWebApp } = await import('./app.js');
    await initWebApp({ authenticated, getToken, user });
  } catch (error) {
    if (error?.status === 401 || !session()) return redirectToLogin();
    const target = element('app-feedback');
    if (target) {
      target.textContent = 'Não foi possível confirmar sua conta agora. Confira sua conexão e atualize a página.';
      target.classList.add('error');
    }
  }
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

let moderationProfiles = new Map();
let moderationRestrictions = new Map();
let moderationAvailable = false;
const MODERATION_ACTIONS = [
  { value: 'advertencia', label: 'Registrar advertência' },
  { value: 'suspensao_24', label: 'Suspender por 24 horas' },
  { value: 'suspensao_168', label: 'Suspender por 7 dias' },
  { value: 'suspensao_720', label: 'Suspender por 30 dias' },
  { value: 'banimento', label: 'Banir por tempo indeterminado' }
];

function moderationProfile(id) {
  const p = moderationProfiles.get(id);
  return p?.nome?.trim() || (id ? `Perfil ${shortened(id)}` : 'Perfil não identificado');
}
function isActiveRestriction(restriction) {
  return restriction?.ativa === true && (restriction.tipo === 'banimento' ||
    Date.parse(restriction.termina_em) > Date.now());
}
function safeProfilePhoto(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'bzjwgvnyfunlwxfzbbbc.supabase.co' ? url.href : null;
  } catch { return null; }
}
function profileElement(id, labelText) {
  const profile = moderationProfiles.get(id);
  const box = make('div', 'moderation-profile');
  const photo = safeProfilePhoto(profile?.foto_url);
  if (photo) {
    const img = make('img', 'moderation-avatar');
    img.src = photo;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    box.append(img);
  } else {
    box.append(make('span', 'moderation-avatar placeholder', (profile?.nome || '?').slice(0, 1).toUpperCase()));
  }
  const details = make('div');
  details.append(make('span', 'moderation-label', labelText));
  details.append(make('strong', 'moderation-name', moderationProfile(id)));
  if (profile?.cidade_atual) details.append(make('span', 'report-meta', profile.cidade_atual));
  details.append(make('span', 'report-meta', `ID: ${id || 'Indisponível'}`));
  box.append(details);
  return box;
}

function parseMeasure(value) {
  if (value === 'advertencia' || value === 'banimento') return { medida: value, horas: null };
  const match = /^suspensao_(24|168|720)$/.exec(value);
  return match ? { medida: 'suspensao', horas: Number(match[1]) } : null;
}
function friendlyMeasure(restriction) {
  return restriction?.tipo === 'banimento' ? 'Banimento por tempo indeterminado' :
    `Suspensão até ${formatDate(restriction?.termina_em)}`;
}
async function submitMeasure(item, select, reason, feedback, button) {
  const parsed = parseMeasure(select.value);
  if (!parsed || !item.denunciado || !moderationAvailable) return;
  const justification = reason.value.trim();
  if (justification.length < 5) return feedback.textContent = 'Descreva a justificativa (mínimo de 5 caracteres).';
  const actionName = MODERATION_ACTIONS.find(a => a.value === select.value)?.label || parsed.medida;
  const ok = window.confirm(`Aplicar: ${actionName}\nConta: ${moderationProfile(item.denunciado)}\n\nMotivo: ${justification}\n\nConfirmar esta medida administrativa?`);
  if (!ok) return;
  button.disabled = true;
  feedback.textContent = 'Aplicando medida...';
  try {
    await authenticated('/functions/v1/vibeorbit-moderacao', {
      method: 'POST', body: JSON.stringify({
        action: 'aplicar', usuario_id: item.denunciado, origem: item.source,
        denuncia_id: item.id, medida: parsed.medida, horas: parsed.horas, motivo: justification
      })
    });
    feedback.textContent = 'Medida registrada e enviada ao controle de acesso.';
    await loadReports();
  } catch (error) {
    feedback.textContent = `Medida não confirmada: ${error.message}`;
  } finally { button.disabled = false; }
}

async function revokeMeasure(restriction, reason, feedback, button) {
  const justification = reason.value.trim();
  if (justification.length < 5) return feedback.textContent = 'Informe o motivo da reversão (mínimo de 5 caracteres).';
  if (!window.confirm(`Reverter a restrição de ${moderationProfile(restriction.usuario_id)}?\n\nMotivo: ${justification}`)) return;
  button.disabled = true;
  feedback.textContent = 'Revertendo a restrição...';
  try {
    await authenticated('/functions/v1/vibeorbit-moderacao', {
      method: 'POST', body: JSON.stringify({
        action: 'reverter', usuario_id: restriction.usuario_id, motivo: justification
      })
    });
    feedback.textContent = 'Restrição revertida com sucesso.';
    await loadReports();
  } catch (error) { feedback.textContent = `Reversão não confirmada: ${error.message}`; }
  finally { button.disabled = false; }
}

function renderRestrictions(restrictions) {
  const target = element('restriction-list');
  target.replaceChildren();
  const active = restrictions.filter(isActiveRestriction);
  if (!active.length) return target.append(make('p', 'portal-subtle', 'Nenhuma conta com suspensão ou banimento ativo.'));
  for (const restriction of active) {
    const box = make('article', 'report-card');
    box.append(profileElement(restriction.usuario_id, 'Conta com restrição ativa'));
    box.append(make('p', 'restriction-summary', friendlyMeasure(restriction)));
    box.append(make('p', 'portal-subtle', `Justificativa: ${restriction.motivo}`));
    const field = make('div', 'portal-field');
    const label = make('label', null, 'Motivo para revogar a medida');
    const input = make('textarea'); input.maxLength = 1000;
    input.placeholder = 'Explique por que a conta poderá voltar a utilizar o app.';
    input.id = `revogar-${restriction.usuario_id}`; label.htmlFor = input.id;
    field.append(label, input);
    const button = make('button', 'portal-button secondary', 'Reverter suspensão / banimento');
    button.type = 'button';
    const feedback = make('p', 'portal-subtle'); feedback.setAttribute('role', 'status');
    button.addEventListener('click', () => revokeMeasure(restriction, input, feedback, button));
    box.append(field, button, feedback);
    target.append(box);
  }
}

function renderSanctionHistory(actions) {
  const target = element('sanction-history');
  target.replaceChildren();
  if (!actions.length) return target.append(make('p', null, 'Nenhuma medida aplicada até o momento.'));
  const table = make('table', 'portal-table');
  const head = make('thead'); const hrow = make('tr');
  for (const title of ['Data', 'Usuário', 'Medida', 'Duração e término', 'Justificativa']) hrow.append(make('th', null, title));
  head.append(hrow); table.append(head);
  const body = make('tbody');
  for (const action of actions) {
    const tr = make('tr');
    for (const value of [formatDate(action.criado_em), moderationProfile(action.usuario_id),
      actionName(action.acao), measurePeriod(action), action.motivo]) tr.append(make('td', null, value || '—'));
    body.append(tr);
  }
  table.append(body); target.append(table);
}
function actionName(action) {
  return ({ advertencia: 'Advertência', suspensao: 'Suspensão',
    banimento: 'Banimento', reversao: 'Reversão' })[action] || action || '—';
}
function measurePeriod(action) {
  if (action.acao === 'banimento') return 'Sem prazo definido';
  if (action.acao !== 'suspensao' || !action.termina_em) return '—';
  const start = Date.parse(action.criado_em);
  const end = Date.parse(action.termina_em);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return `Até ${formatDate(action.termina_em)}`;
  const hours = Math.round((end - start) / 3600000);
  const duration = hours % 24 === 0 && hours >= 48 ?
    `${hours / 24} dias` : `${hours} horas`;
  return `${duration} · até ${formatDate(action.termina_em)}`;
}

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
  card.append(make('p', 'moderation-label', 'Motivo e descrição enviados pelo denunciante'));
  card.append(make('p', 'moderation-reason', item.motivo || 'Motivo não informado'));
  card.append(make('div', 'report-meta', `Registrada: ${formatDate(item.date)} · Caso ${shortened(item.id)}`));
  card.append(profileElement(item.denunciado, 'Pessoa denunciada'));
  card.append(profileElement(item.denunciante, 'Pessoa que denunciou'));
  if (item.conversa_id) card.append(make('div', 'report-meta', `Conversa: ${shortened(item.conversa_id)}`));
  const restriction = moderationRestrictions.get(item.denunciado);
  if (isActiveRestriction(restriction)) card.append(make('p', 'restriction-summary', `Conta já restringida: ${friendlyMeasure(restriction)}`));
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
  const sanctionTitle = make('h4', 'sanction-title', 'Medida sobre a conta denunciada');
  const sanctionHint = make('p', 'portal-subtle', 'Uma denúncia resolvida não aplica punições automaticamente. Esta medida terá registro próprio e exigirá confirmação.');
  const sanctionField = make('div', 'portal-field');
  const sanctionLabel = make('label', null, 'Medida administrativa');
  const sanctionSelect = make('select'); sanctionSelect.id = `medida-${item.source}-${item.id}`;
  sanctionLabel.htmlFor = sanctionSelect.id;
  for (const action of MODERATION_ACTIONS) {
    const option = make('option', null, action.label); option.value = action.value;
    sanctionSelect.append(option);
  }
  sanctionField.append(sanctionLabel, sanctionSelect);
  const justificationField = make('div', 'portal-field');
  const justificationLabel = make('label', null, 'Justificativa da medida (obrigatória)');
  const justification = make('textarea'); justification.maxLength = 1000;
  justification.id = `motivo-medida-${item.source}-${item.id}`;
  justification.placeholder = 'Descreva os fatos examinados. Não use apenas uma palavra.';
  justificationLabel.htmlFor = justification.id;
  justificationField.append(justificationLabel, justification);
  const sanctionButton = make('button', 'portal-button sanction-button', 'Aplicar medida');
  sanctionButton.type = 'button'; sanctionButton.disabled = !moderationAvailable || !item.denunciado;
  const sanctionFeedback = make('p', 'portal-subtle'); sanctionFeedback.setAttribute('role','status');
  sanctionButton.addEventListener('click', () => submitMeasure(item, sanctionSelect, justification, sanctionFeedback, sanctionButton));
  card.append(sanctionTitle, sanctionHint, sanctionField, justificationField, sanctionButton, sanctionFeedback);
  if (!moderationAvailable) card.append(make('p', 'portal-alert error', 'Medidas administrativas indisponíveis. Tente novamente mais tarde.'));
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
    const ids = [...new Set(records.flatMap(r => [r.denunciante, r.denunciado]).filter(Boolean))];
    const extraRequests = [
      ids.length ? authenticated(`/rest/v1/usuarios?select=id,nome,foto_url,cidade_atual&id=in.(${ids.map(encodeURIComponent).join(',')})`) : Promise.resolve([]),
      authenticated('/rest/v1/moderacao_restricoes?select=usuario_id,tipo,motivo,termina_em,ativa,atualizada_em&order=atualizada_em.desc&limit=100'),
      authenticated('/rest/v1/moderacao_acoes?select=usuario_id,acao,motivo,termina_em,criado_em&order=criado_em.desc&limit=50')
    ];
    const [profilesResult, restrictionsResult, actionsResult] = await Promise.allSettled(extraRequests);
    const restrictions = restrictionsResult.status === 'fulfilled' ? restrictionsResult.value : [];
    const actions = actionsResult.status === 'fulfilled' ? actionsResult.value : [];
    moderationAvailable = restrictionsResult.status === 'fulfilled' && actionsResult.status === 'fulfilled';
    moderationProfiles = new Map((profilesResult.status === 'fulfilled' ? profilesResult.value : []).map(p => [p.id,p]));
    moderationRestrictions = new Map(restrictions.map(r => [r.usuario_id,r]));
    element('total-count').textContent = String(records.length);
    element('pending-count').textContent = String(records.filter(r => r.status === 'pendente').length);
    element('review-count').textContent = String(records.filter(r => r.status === 'em_analise').length);
    target.replaceChildren();
    if (!records.length) target.append(make('p', 'portal-subtle', 'Nenhuma denúncia encontrada.'));
    for (const item of records) target.append(renderReport(item));
    renderRestrictions(restrictions);
    renderSanctionHistory(actions);
    await loadAudit();
  } catch {
    target.replaceChildren(make('p', 'portal-alert error', 'Não foi possível carregar as denúncias. Verifique sua permissão administrativa e tente novamente.'));
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
if (page === 'app') initApp();
if (page === 'account') initAccount();
if (page === 'admin') initAdmin();
