// Area interna do Afinzer. Somente a chave publica fica no navegador;
// autorizacao, plano e tempo de uso sao confirmados no servidor.
import { initDiscoveries } from './deck-conexoes.js';
const $ = id => document.getElementById(id);
const sections = new Set(['inicio', 'deck', 'conexoes', 'conversas', 'salas', 'perfil', 'chat']);
let api;
let userProfile = null;
let isPremium = false;
let planVerified = false;
let activeChat = null;
let chatPoll = null;
let chatHeartbeat = null;
let chatFetching = false;
let chatSending = false;
let leavingChat = Promise.resolve();
let currentView = 'inicio';
let discoveries = null;
let previewPlan = 'real';
let allRooms = [];
let roomFilter = 'todas';
let roomSearch = '';
let nameColors = new Map();
let lastColorSync = 0;
let changingNameColor = false;
let previewNameColor = null;

const NAME_COLORS = [
  { name: 'Ciano', hex: '#00D9FF' },
  { name: 'Roxo', hex: '#BA8EFF' },
  { name: 'Rosa', hex: '#FF80AB' },
  { name: 'Verde', hex: '#4DE0A0' },
  { name: 'Amarelo', hex: '#FFDC66' },
  { name: 'Laranja', hex: '#FFB142' },
  { name: 'Azul', hex: '#6495ED' },
  { name: 'Branco', hex: '#FFFFFF' }
];
const validColor = value => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : null;
const visualPremium = () => previewPlan === 'real' ? isPremium : previewPlan === 'premium';
const isSubjectRoom = room => !String(room.cidade || '').trim() && String(room.id || '').startsWith('public:assunto_');

function make(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (value !== undefined) el.textContent = String(value);
  return el;
}
function friendly(message, error = false, id = 'app-feedback') {
  const target = $(id);
  if (!target) return;
  target.textContent = message;
  target.classList.toggle('error', error);
  target.hidden = !message;
}
async function rpc(name, args = {}) {
  return api.authenticated(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
}
function safePhoto(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname === 'bzjwgvnyfunlwxfzbbbc.supabase.co' ? parsed.href : null;
  } catch { return null; }
}
function showView(view) {
  if (!sections.has(view)) view = 'inicio';
  if (activeChat && view !== 'chat') void leaveChat();
  currentView = view;
  document.querySelectorAll('[data-panel]').forEach(node => {
    node.hidden = node.dataset.panel !== view;
  });
  document.querySelectorAll('.nav-item').forEach(node => {
    const selected = node.dataset.view === (view === 'chat' ? activeChat?.origin : view);
    node.setAttribute('aria-pressed', String(Boolean(selected)));
  });
  if (view === 'salas') void loadRooms();
  if (view === 'deck') void discoveries?.openDeck();
  if (view === 'conexoes') void discoveries?.openConnections();
  if (view !== 'chat') history.replaceState(null, '', `#${view}`);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function loadProfile() {
  try {
    const rows = await api.authenticated(`/rest/v1/usuarios?select=nome,cidade_atual,foto_url,cor_nome&id=eq.${encodeURIComponent(api.user.id)}&limit=1`);
    userProfile = Array.isArray(rows) ? rows[0] : null;
    const name = userProfile?.nome?.trim() || api.user.email?.split('@')[0] || 'você';
    $('welcome-text').textContent = `Olá, ${name}! Escolha onde a conversa vai começar.`;
    $('profile-name').textContent = name;
    $('profile-city').textContent = userProfile?.cidade_atual?.trim() || 'Cidade ainda não informada';
    const color = validColor(userProfile?.cor_nome);
    if (color) nameColors.set(api.user.id, color);
    const photo = safePhoto(userProfile?.foto_url);
    if (photo) {
      const image = make('img');
      image.src = photo;
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      $('profile-avatar').replaceChildren(image);
    }
  } catch {
    $('welcome-text').textContent = 'Sua conta está conectada. Vamos conversar?';
    $('profile-city').textContent = 'Não foi possível carregar seu perfil agora.';
  }
}
async function loadPlan() {
  try {
    isPremium = (await rpc('meu_premium_ativo')) === true;
    planVerified = true;
  } catch {
    planVerified = false;
  }
  updatePlanPresentation();
}
function updatePlanPresentation() {
  const simulated = previewPlan !== 'real';
  $('plan-pill').textContent = simulated
    ? (visualPremium() ? '👑 Premium · prévia' : '♡ Free · prévia')
    : (!planVerified ? 'Plano indisponível' : (isPremium ? '👑 Premium' : '♡ Free'));
  $('preview-plan-note').hidden = !simulated;
  $('home-plan-info').textContent = visualPremium()
    ? 'Premium: Chat Global e salas ilimitados. Esta é uma prévia visual quando seu plano real for diferente.'
    : 'Free: 30 minutos grátis diários no Chat Global. As salas por assunto aguardam ativação da regra compartilhada no servidor.';
  $('rooms-plan-note').textContent = visualPremium()
    ? '👑 Premium: Chat Global e salas ilimitados.'
    : '♡ Free: 30 min/dia no Chat Global. A liberação das salas por assunto no Free ainda está pendente no servidor.';
  if (currentView === 'salas') renderRooms();
}

function appendRoom(room) {
  const card = make('article', 'room-card');
  const byCity = Boolean(room.cidade?.trim());
  card.append(make('span', 'room-kind', byCity ? '📍 POR CIDADE' : '💬 POR ASSUNTO'));
  card.append(make('h2', null, room.nome || 'Sala sem nome'));
  if (byCity) card.append(make('p', 'room-subject', room.cidade.trim()));
  else if (room.assunto && room.assunto !== room.nome) card.append(make('p', 'room-subject', room.assunto));
  card.append(make('p', 'room-info', byCity
    ? 'Conheça pessoas desta cidade e compartilhe histórias.'
    : 'Um espaço para conversar sobre o que vocês gostam.'));
  const actions = make('div', 'room-actions');
  const canEnter = planVerified && isPremium && visualPremium();
  const label = byCity ? '👑 Sala por cidade · Premium'
    : (!visualPremium() ? '♡ Free: aguardando liberação no servidor' : '👑 Sala por assunto');
  actions.append(make('span', 'lock-label', label));
  if (canEnter) {
    const enter = make('button', 'primary-action', 'Entrar na sala');
    enter.type = 'button';
    enter.addEventListener('click', () => void openChat({
      id: String(room.id), name: String(room.nome || 'Sala'), origin: 'salas'
    }));
    actions.append(enter);
  } else {
    const button = make('button', 'outline-action', visualPremium() ? 'Entrar · prévia' : 'Acesso restrito');
    button.type = 'button';
    button.disabled = true;
    button.title = isSubjectRoom(room) && !isPremium
      ? 'O acesso Free por assunto depende da ativação da regra no servidor.'
      : 'Verificação do plano real necessária para entrar nesta sala.';
    actions.append(button);
  }
  card.append(actions);
  $('rooms-list').append(card);
}
function normalizeSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}
function renderRooms() {
  const query = normalizeSearch(roomSearch);
  const rows = allRooms.filter(room => {
    const city = Boolean(room.cidade?.trim());
    const matchesCategory = roomFilter === 'todas'
      || (roomFilter === 'cidade' && city)
      || (roomFilter === 'assunto' && !city)
      || (roomFilter === 'minhas' && room.criador_id === api.user.id);
    const matchesText = !query || [room.nome, room.assunto, room.cidade]
      .some(value => normalizeSearch(value).includes(query));
    return matchesCategory && matchesText;
  });
  $('rooms-list').replaceChildren();
  $('rooms-count').textContent = `${rows.length} sala(s) encontrada(s)`;
  document.querySelectorAll('[data-room-filter]').forEach(button => {
    const active = button.dataset.roomFilter === roomFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (!rows.length) {
    $('rooms-list').append(make('p', 'room-empty', allRooms.length
      ? 'Nenhuma sala encontrada neste filtro. Experimente outra busca.'
      : 'Ainda não há salas disponíveis.'));
    return;
  }
  rows.forEach(appendRoom);
}
async function loadRooms() {
  friendly('Carregando salas…', false, 'rooms-feedback');
  try {
    const rows = await api.authenticated('/rest/v1/salas?select=id,nome,assunto,cidade,criador_id&order=created_at.desc&limit=100');
    if (currentView !== 'salas') return;
    if (!Array.isArray(rows)) throw new Error('Consulta de salas incompleta');
    allRooms = rows;
    friendly('', false, 'rooms-feedback');
    renderRooms();
  } catch {
    friendly('Não foi possível carregar as salas. Tente novamente ao voltar para esta tela.', true, 'rooms-feedback');
  }
}
async function createRoom(event) {
  event.preventDefault();
  const feedback = $('create-room-feedback');
  if (!planVerified || !isPremium) {
    feedback.textContent = 'Criar salas exige uma conta Premium real. A prévia visual não altera seu plano.';
    return;
  }
  const type = $('create-room-type').value;
  const name = $('create-room-name').value.trim();
  const detail = $('create-room-detail').value.trim();
  if (!['assunto', 'cidade'].includes(type) || name.length < 3 || detail.length < 2) {
    feedback.textContent = 'Informe um nome de pelo menos 3 caracteres e um assunto ou cidade com pelo menos 2.';
    return;
  }
  const button = $('create-room-save');
  button.disabled = true;
  feedback.textContent = 'Criando sala…';
  try {
    await restriction();
    const id = `public:${type}_${crypto.randomUUID()}`;
    const result = await api.authenticated('/rest/v1/salas', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ id, nome: name, assunto: type === 'cidade' ? 'Cidade' : detail,
        cidade: type === 'cidade' ? detail : '', criador_id: api.user.id })
    });
    if (!Array.isArray(result) || !result.some(room => room.id === id)) throw new Error('Gravação não confirmada');
    $('create-room-dialog').close();
    $('create-room-form').reset();
    friendly('Sala criada! Ela também aparecerá no aplicativo.', false, 'rooms-feedback');
    await loadRooms();
  } catch {
    feedback.textContent = 'Não foi possível confirmar a criação da sala. Tente novamente.';
  } finally {
    button.disabled = false;
  }
}

async function restriction() {
  const state = await rpc('moderacao_minha_restricao');
  if (state?.restrita) {
    const explanation = state.tipo === 'banimento' ? 'Sua conta está bloqueada.' : 'Sua conta está temporariamente suspensa.';
    throw new Error(explanation);
  }
}
function chatAccessText(state) {
  if (state?.premium === true) return '👑 Premium · ilimitado';
  const seconds = Number(state?.segundos_restantes);
  return Number.isFinite(seconds)
    ? `♡ Free · ${Math.ceil(Math.max(0, seconds) / 60)} min restantes hoje`
    : '♡ Free · 30 minutos grátis diários';
}
function setChatEnabled(enabled) {
  $('chat-input').disabled = !enabled;
  $('chat-send').disabled = !enabled || chatSending;
}
async function syncNameColors(force = false) {
  if (!force && Date.now() - lastColorSync < 30000) return;
  try {
    const profiles = await api.authenticated('/rest/v1/perfis_app?select=id,cor_nome&limit=300');
    if (!Array.isArray(profiles)) throw new Error('Cores indisponíveis');
    nameColors = new Map(profiles.map(person => [person.id, validColor(person.cor_nome)]).filter(([, color]) => color));
    if (userProfile?.cor_nome) nameColors.set(api.user.id, validColor(userProfile.cor_nome));
    lastColorSync = Date.now();
  } catch { /* A falta de uma cor não pode impedir a leitura das mensagens. */ }
}
function renderNameColorOptions() {
  const target = $('name-color-options');
  target.replaceChildren();
  const selected = !isPremium && visualPremium()
    ? (previewNameColor || validColor(userProfile?.cor_nome))
    : validColor(userProfile?.cor_nome);
  $('name-color-demo').textContent = userProfile?.nome?.trim() || 'Seu nome no Afinzer';
  $('name-color-demo').style.color = selected || '#f8e8ff';
  for (const color of NAME_COLORS) {
    const button = make('button', 'name-color-option');
    button.type = 'button';
    button.disabled = changingNameColor;
    button.setAttribute('aria-pressed', String(selected === color.hex));
    const swatch = make('span', 'name-color-swatch');
    swatch.style.backgroundColor = color.hex;
    button.append(swatch, make('span', null, color.name));
    if (selected === color.hex) button.append(make('span', 'name-color-checked', '✓'));
    button.addEventListener('click', () => void saveNameColor(color.hex));
    target.append(button);
  }
}
function openNameColorPicker() {
  if (!planVerified || (!isPremium && !visualPremium())) {
    friendly('🎨 Escolher a cor do nome é um recurso Premium. O modo de prévia não altera seu acesso.', false, 'chat-feedback');
    return;
  }
  $('name-color-feedback').textContent = isPremium ? '' : 'Prévia visual: experimente as cores sem alterar sua conta Free.';
  renderNameColorOptions();
  $('name-color-dialog').showModal();
}
async function saveNameColor(hex) {
  if (!planVerified || !NAME_COLORS.some(color => color.hex === hex) || changingNameColor) return;
  if (!isPremium) {
    if (visualPremium()) {
      previewNameColor = hex;
      renderNameColorOptions();
      $('name-color-feedback').textContent = 'Apenas prévia: a cor não foi salva. A escolha real exige Premium.';
    }
    return;
  }
  changingNameColor = true;
  renderNameColorOptions();
  $('name-color-feedback').textContent = 'Salvando sua cor…';
  try {
    const rows = await api.authenticated(`/rest/v1/usuarios?select=id,cor_nome&id=eq.${encodeURIComponent(api.user.id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ cor_nome: hex })
    });
    if (!Array.isArray(rows) || !rows.some(row => row.id === api.user.id && validColor(row.cor_nome) === hex)) {
      throw new Error('Cor não confirmada');
    }
    if (!userProfile) userProfile = {};
    userProfile.cor_nome = hex;
    nameColors.set(api.user.id, hex);
    $('name-color-feedback').textContent = 'Cor salva! Seu nome será exibido nessa cor no site e no aplicativo.';
    if (activeChat?.ready) await loadMessages();
  } catch {
    $('name-color-feedback').textContent = 'Não foi possível salvar a cor. Verifique seu plano e tente novamente.';
  } finally {
    changingNameColor = false;
    renderNameColorOptions();
  }
}
async function openChat(room) {
  await leavingChat;
  if (activeChat) await leaveChat();
  if (room.id !== 'Global' && (!planVerified || !isPremium)) {
    friendly('Esta sala é exclusiva para assinantes Premium.', true);
    return;
  }
  $('chat-title').textContent = room.name;
  $('chat-time').textContent = 'Conferindo acesso…';
  $('chat-messages').replaceChildren(make('p', 'chat-empty', 'Preparando sua conversa…'));
  $('chat-input').value = '';
  setChatEnabled(false);
  friendly('Verificando seu acesso à conversa…', false, 'chat-feedback');
  activeChat = { ...room, ready: false };
  const chat = activeChat;
  showView('chat');
  try {
    await restriction();
    const name = room.id === 'Global' ? 'tempo_chat_global' : 'tempo_sala_assunto';
    const payload = room.id === 'Global' ? { p_acao: 'entrar' } : { p_sala_id: room.id, p_acao: 'entrar' };
    const allowed = await rpc(name, payload);
    if (activeChat !== chat) return;
    if (allowed?.permitido !== true) {
      friendly(room.id === 'Global'
        ? 'Seus 30 minutos grátis de hoje terminaram. Volte amanhã ou escolha Premium.'
        : 'Essa sala exige uma conta Premium ativa.', true, 'chat-feedback');
      await leaveChat();
      return;
    }
    chat.ready = true;
    $('chat-time').textContent = chatAccessText(allowed);
    friendly('', false, 'chat-feedback');
    setChatEnabled(true);
    await loadMessages();
    chatPoll = setInterval(() => { void loadMessages(); }, 6500);
    chatHeartbeat = setInterval(() => { void heartbeat(); }, 15000);
    $('chat-input').focus();
  } catch (err) {
    if (activeChat !== chat) return;
    friendly(err.message === 'Sua conta está bloqueada.' || err.message === 'Sua conta está temporariamente suspensa.'
      ? err.message
      : 'Não foi possível liberar a conversa. Confira sua conexão e tente novamente.', true, 'chat-feedback');
    await leaveChat();
  }
}

async function heartbeat() {
  const chat = activeChat;
  if (!chat?.ready || document.hidden) return;
  try {
    await restriction();
    const name = chat.id === 'Global' ? 'tempo_chat_global' : 'tempo_sala_assunto';
    const payload = chat.id === 'Global' ? { p_acao: 'ping' } : { p_sala_id: chat.id, p_acao: 'ping' };
    const state = await rpc(name, payload);
    if (activeChat !== chat) return;
    if (state?.permitido !== true) {
      friendly('Seu tempo de hoje terminou. A conversa foi pausada.', true, 'chat-feedback');
      await leaveChat();
      return;
    }
    $('chat-time').textContent = chatAccessText(state);
  } catch (err) {
    if (activeChat !== chat) return;
    friendly(err.message === 'Sua conta está bloqueada.' || err.message === 'Sua conta está temporariamente suspensa.'
      ? err.message
      : 'Não foi possível confirmar sua sessão. Entre novamente na sala.', true, 'chat-feedback');
    await leaveChat();
  }
}

async function leaveChat() {
  const chat = activeChat;
  if (!chat) return leavingChat;
  activeChat = null;
  clearInterval(chatPoll);
  clearInterval(chatHeartbeat);
  chatPoll = null;
  chatHeartbeat = null;
  setChatEnabled(false);
  if (chat.ready) {
    const name = chat.id === 'Global' ? 'tempo_chat_global' : 'tempo_sala_assunto';
    const payload = chat.id === 'Global' ? { p_acao: 'sair' } : { p_sala_id: chat.id, p_acao: 'sair' };
    leavingChat = rpc(name, payload).catch(() => {});
    await leavingChat;
  }
}

async function loadMessages() {
  const chat = activeChat;
  if (!chat?.ready || chatFetching) return;
  chatFetching = true;
  try {
    const id = encodeURIComponent(chat.id);
    const [records] = await Promise.all([
      api.authenticated(`/rest/v1/mensagens?select=id,created_at,conteudo,id_remetente,nome_remetente&sala_id=eq.${id}&order=created_at.desc&limit=60`),
      syncNameColors()
    ]);
    if (activeChat !== chat) return;
    const target = $('chat-messages');
    const wasNearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 130;
    const elements = [];
    for (const message of (Array.isArray(records) ? records.slice().reverse() : [])) {
      const mine = message.id_remetente === api.user.id;
      const bubble = make('article', mine ? 'chat-bubble mine' : 'chat-bubble');
      const author = make('div', 'message-meta', mine ? 'Você' : (message.nome_remetente || 'Pessoa no Afinzer'));
      const authorColor = nameColors.get(message.id_remetente);
      if (authorColor) author.style.color = authorColor;
      bubble.append(author);
      bubble.append(make('p', 'message-text', message.conteudo || ''));
      const date = new Date(message.created_at);
      if (!Number.isNaN(date.getTime())) bubble.append(make('div', 'message-time', date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })));
      elements.push(bubble);
    }
    if (!elements.length) elements.push(make('p', 'chat-empty', 'Ainda não há mensagens nesta conversa. Que tal dar o primeiro oi?'));
    target.replaceChildren(...elements);
    if (wasNearBottom) target.scrollTop = target.scrollHeight;
  } catch {
    if (activeChat === chat) friendly('As mensagens não puderam ser atualizadas. Vamos tentar novamente.', true, 'chat-feedback');
  } finally {
    chatFetching = false;
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const chat = activeChat;
  const input = $('chat-input');
  const draft = input.value.trim();
  if (!chat?.ready || !draft || chatSending) return;
  chatSending = true;
  $('chat-send').disabled = true;
  try {
    const body = {
      conteudo: draft,
      id_remetente: api.user.id,
      nome_remetente: userProfile?.nome?.trim() || 'Pessoa no Afinzer',
      sala_id: chat.id
    };
    await api.authenticated('/rest/v1/mensagens', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body)
    });
    // Se o usuario comecou a proxima mensagem, o novo texto permanece intacto.
    if (input.value.trim() === draft) input.value = '';
    friendly('', false, 'chat-feedback');
    await loadMessages();
  } catch {
    if (activeChat === chat) friendly('Não foi possível enviar. Seu texto foi preservado para tentar novamente.', true, 'chat-feedback');
  } finally {
    chatSending = false;
    $('chat-send').disabled = !activeChat?.ready;
  }
}

export async function initWebApp(context) {
  api = context;
  $('app-home').addEventListener('click', () => showView('inicio'));
  $('preview-plan').addEventListener('change', event => {
    previewPlan = ['free', 'premium'].includes(event.target.value) ? event.target.value : 'real';
    if (previewPlan === 'real') previewNameColor = null;
    updatePlanPresentation();
  });
  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => showView(button.dataset.view));
  });
  $('open-global').addEventListener('click', () => void openChat({ id: 'Global', name: 'Chat Global', origin: 'conversas' }));
  $('rooms-global').addEventListener('click', () => void openChat({ id: 'Global', name: 'Chat Global', origin: 'salas' }));
  $('rooms-search').addEventListener('input', event => { roomSearch = event.target.value; renderRooms(); });
  document.querySelectorAll('[data-room-filter]').forEach(button => {
    button.addEventListener('click', () => { roomFilter = button.dataset.roomFilter; renderRooms(); });
  });
  $('rooms-create').addEventListener('click', () => {
    if (!planVerified || !isPremium) {
      friendly('Criar salas exige uma conta Premium ativa. A simulação visual não libera criação.', false, 'rooms-feedback');
      return;
    }
    $('create-room-feedback').textContent = '';
    $('create-room-dialog').showModal();
  });
  $('rooms-rules').addEventListener('click', () => window.alert(
    'Salas Vivas do Afinzer\n\nFree: 30 minutos diários no Chat Global. O compartilhamento desse tempo com salas por assunto ainda precisa ser ativado no servidor.\n\nPremium: Chat Global e salas ilimitados. Criar salas por assunto ou cidade é Premium.\n\nEscolha a cor do seu nome no chat; os nomes coloridos são visíveis para todas as pessoas.'
  ));
  $('create-room-close').addEventListener('click', () => $('create-room-dialog').close());
  $('create-room-type').addEventListener('change', event => {
    const byCity = event.target.value === 'cidade';
    $('create-room-title').textContent = byCity ? '＋ Criar sala por cidade' : '＋ Criar sala por assunto';
    $('create-room-detail-label').textContent = byCity ? 'Cidade' : 'Assunto da sala';
    $('create-room-detail').placeholder = byCity ? 'Ex.: Campinas - SP' : 'Ex.: Música, viagens, filmes…';
  });
  $('create-room-form').addEventListener('submit', createRoom);
  $('chat-back').addEventListener('click', () => showView(activeChat?.origin || 'conversas'));
  $('chat-name-color').addEventListener('click', openNameColorPicker);
  $('name-color-close').addEventListener('click', () => $('name-color-dialog').close());
  $('chat-form').addEventListener('submit', sendMessage);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && activeChat) showView(activeChat.origin);
  });
  window.addEventListener('pagehide', () => { if (activeChat) void leaveChat(); });
  await Promise.all([loadProfile(), loadPlan()]);
  discoveries = initDiscoveries({ api, rpc, make, safePhoto, friendly, premium: planVerified && isPremium });
  friendly('');
  const start = location.hash.slice(1);
  showView(start !== 'chat' && sections.has(start) ? start : 'inicio');
}
