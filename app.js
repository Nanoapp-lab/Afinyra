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
    const rows = await api.authenticated(`/rest/v1/usuarios?select=nome,cidade_atual,foto_url&id=eq.${encodeURIComponent(api.user.id)}&limit=1`);
    userProfile = Array.isArray(rows) ? rows[0] : null;
    const name = userProfile?.nome?.trim() || api.user.email?.split('@')[0] || 'você';
    $('welcome-text').textContent = `Olá, ${name}! Escolha onde a conversa vai começar.`;
    $('profile-name').textContent = name;
    $('profile-city').textContent = userProfile?.cidade_atual?.trim() || 'Cidade ainda não informada';
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
    $('plan-pill').textContent = isPremium ? '👑 Premium' : '♡ Free';
    $('home-plan-info').textContent = isPremium
      ? 'Seu plano Premium oferece chat e salas ilimitados.'
      : 'Free: 30 minutos grátis diários no Chat Global. Salas por assunto são exclusivas do Premium.';
  } catch {
    planVerified = false;
    $('plan-pill').textContent = 'Plano indisponível';
  }
}

function appendRoom(room) {
  const card = make('article', 'room-card');
  card.append(make('h2', null, room.nome || 'Sala sem nome'));
  if (room.assunto) card.append(make('p', 'room-subject', room.assunto));
  const info = make('p', 'room-info', room.cidade?.trim() || 'Sala por assunto');
  card.append(info);
  const actions = make('div', 'room-actions');
  if (!planVerified || !isPremium) {
    actions.append(make('span', 'lock-label', '👑 Exclusiva do Premium'));
    const button = make('button', 'outline-action', 'Acesso Premium');
    button.type = 'button';
    button.disabled = true;
    actions.append(button);
  } else {
    const button = make('button', 'primary-action', 'Entrar na sala');
    button.type = 'button';
    button.addEventListener('click', () => void openChat({
      id: String(room.id), name: String(room.nome || 'Sala'), origin: 'salas'
    }));
    actions.append(button);
  }
  card.append(actions);
  $('rooms-list').append(card);
}
async function loadRooms() {
  friendly('Carregando salas…', false, 'rooms-feedback');
  $('rooms-list').replaceChildren();
  try {
    const rows = await api.authenticated('/rest/v1/salas?select=id,nome,assunto,cidade&order=created_at.desc&limit=60');
    if (currentView !== 'salas') return;
    if (!Array.isArray(rows) || rows.length === 0) {
      friendly('Ainda não há salas cadastradas.', false, 'rooms-feedback');
      return;
    }
    friendly('', false, 'rooms-feedback');
    rows.forEach(appendRoom);
  } catch {
    friendly('Não foi possível carregar as salas. Tente novamente ao voltar para esta tela.', true, 'rooms-feedback');
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
    const records = await api.authenticated(`/rest/v1/mensagens?select=id,created_at,conteudo,id_remetente,nome_remetente&sala_id=eq.${id}&order=created_at.desc&limit=60`);
    if (activeChat !== chat) return;
    const target = $('chat-messages');
    const wasNearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 130;
    const elements = [];
    for (const message of (Array.isArray(records) ? records.slice().reverse() : [])) {
      const mine = message.id_remetente === api.user.id;
      const bubble = make('article', mine ? 'chat-bubble mine' : 'chat-bubble');
      bubble.append(make('div', 'message-meta', mine ? 'Você' : (message.nome_remetente || 'Pessoa no Afinzer')));
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
  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => showView(button.dataset.view));
  });
  $('open-global').addEventListener('click', () => void openChat({ id: 'Global', name: 'Chat Global', origin: 'conversas' }));
  $('chat-back').addEventListener('click', () => showView(activeChat?.origin || 'conversas'));
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
