// Area interna do Afinzer. Somente a chave publica fica no navegador;
// autorizacao, plano e tempo de uso sao confirmados no servidor.
import { initDiscoveries } from './deck-conexoes.js';
import { initBlindConversations } from './conversa-cegas.js';
import { initDirectConversations } from './direct-conversations.mjs';
import { formatHeightCm, profilePhotos, todayInSaoPaulo } from './perfil-utils.mjs';
import { roomCountdown } from './room-countdown.mjs';
const $ = id => document.getElementById(id);
const sections = new Set(['inicio', 'deck', 'conexoes', 'conversas', 'salas', 'perfil', 'chat', 'cegas', 'direta']);
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
let blindFeature = null;
let directFeature = null;
let previewPlan = 'real';
let testAllowed = false;
let originalPremium = false;
let switchingTestPlan = false;
let allRooms = [];
let roomFilter = 'todas';
let roomSearch = '';
const ROOMS_PAGE_SIZE = 15;
let roomsPage = 1;
let roomsHasNext = false;
let roomsRequest = 0;
let roomSearchTimer = null;
let roomExpiryRefreshTimer = null;
let roomCountdownTicker = null;
let roomCountdownElements = [];
let lastExpiredRoomRefresh = 0;
let chatCountdownTicker = null;
let expiredChatClosing = false;
let lastChatOrigin = 'conversas';
let nameColors = new Map();
let lastColorSync = 0;
let changingNameColor = false;

const NAME_COLORS = [
  { name: 'Ciano', hex: '#00D9FF' },
  { name: 'Roxo', hex: '#BA8EFF' },
  { name: 'Rosa', hex: '#FF80AB' },
  { name: 'Verde', hex: '#4DE0A0' },
  { name: 'Amarelo', hex: '#FFDC66' },
  { name: 'Laranja', hex: '#FFB142' },
  { name: 'Azul', hex: '#6495ED' },
  { name: 'Branco', hex: '#FFFFFF' },
  { name: 'Lavanda', hex: '#D8B4FE' },
  { name: 'Coral', hex: '#FF927B' },
  { name: 'Turquesa', hex: '#5CE1E6' },
  { name: 'Lima', hex: '#B7F071' },
  { name: 'Magenta', hex: '#FF66D8' },
  { name: 'Dourado', hex: '#F5CE6E' },
  { name: 'Azul-céu', hex: '#8EC5FF' },
  { name: 'Menta', hex: '#99F6CF' },
  { name: 'Pêssego', hex: '#FFC4A6' },
  { name: 'Lilás', hex: '#E1A9FF' },
  { name: 'Esmeralda', hex: '#72E9A8' },
  { name: 'Gelo', hex: '#D5FAFF' }
];
const WALLPAPER_PRESETS = [
  { id: 'default', name: 'Padrão', css: '' },
  { id: 'aurora', name: 'Aurora', css: 'radial-gradient(circle at 12% 22%,#24534f 0%,transparent 50%),linear-gradient(125deg,#071723,#453060)' },
  { id: 'cosmos', name: 'Cosmos', css: 'radial-gradient(circle at 80% 10%,#70409b 0%,transparent 40%),linear-gradient(145deg,#110b29,#2f184f,#081928)' },
  { id: 'oceano', name: 'Oceano', css: 'radial-gradient(circle at 85% 18%,#1c6683 0%,transparent 45%),linear-gradient(145deg,#071a34,#0f3e54,#12132e)' },
  { id: 'vinho', name: 'Vinho', css: 'radial-gradient(circle at 20% 10%,#7b315b 0%,transparent 50%),linear-gradient(135deg,#210d27,#451a37)' },
  { id: 'floresta', name: 'Floresta', css: 'radial-gradient(circle at 95% 10%,#315c45 0%,transparent 45%),linear-gradient(135deg,#091e21,#1b3c2c)' },
  { id: 'crepusculo', name: 'Crepúsculo', css: 'linear-gradient(140deg,#211042 0%,#68395d 48%,#8e5339 100%)' }
];
const wallpaperKey = () => `afinzer-wallpaper-v1:${api?.user?.id}`;
function readWallpaper() {
  try {
    const raw = window.localStorage?.getItem(wallpaperKey());
    const stored = raw ? JSON.parse(raw) : null;
    if (stored?.type === 'preset' && WALLPAPER_PRESETS.some(item => item.id === stored.id)) return stored;
    if (stored?.type === 'photo' && typeof stored.data === 'string'
      && stored.data.length < 1700000 && /^data:image\/jpeg;base64,[a-zA-Z0-9+/=]+$/.test(stored.data)) return stored;
  } catch { /* O armazenamento pode estar desativado no navegador. */ }
  return { type: 'preset', id: 'default' };
}
function applyWallpaper() {
  const allowed = planVerified && isPremium;
  $('wallpaper-chat-open').hidden = !allowed;
  $('wallpaper-profile-open').hidden = !allowed;
  const choice = allowed ? readWallpaper() : { type: 'preset', id: 'default' };
  const css = choice.type === 'photo' ? `url("${choice.data}")`
    : WALLPAPER_PRESETS.find(item => item.id === choice.id)?.css || '';
  document.body.classList.toggle('premium-wallpaper-active', Boolean(css));
  if (css) document.body.style.setProperty('--afinzer-wallpaper', css);
  else document.body.style.removeProperty('--afinzer-wallpaper');
}
function renderWallpaperOptions() {
  const target = $('wallpaper-options');
  target.replaceChildren();
  const selected = readWallpaper();
  for (const preset of WALLPAPER_PRESETS) {
    const button = make('button', 'wallpaper-option');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(selected.type === 'preset' && selected.id === preset.id));
    const swatch = make('span', 'wallpaper-swatch');
    swatch.style.background = preset.css || 'linear-gradient(135deg,#251631,#100a19)';
    button.append(swatch, make('span', null, preset.name));
    button.addEventListener('click', () => saveWallpaper({ type: 'preset', id: preset.id }));
    target.append(button);
  }
}
function saveWallpaper(choice) {
  if (!planVerified || !isPremium) return;
  try {
    window.localStorage.setItem(wallpaperKey(), JSON.stringify(choice));
    applyWallpaper();
    renderWallpaperOptions();
    $('wallpaper-feedback').textContent = choice.type === 'photo'
      ? 'Sua foto foi aplicada neste navegador.' : 'Fundo atualizado! A escolha fica salva neste navegador.';
  } catch {
    $('wallpaper-feedback').textContent = 'Não foi possível salvar o fundo neste navegador. Verifique o espaço disponível ou as configurações de privacidade.';
  }
}
function openWallpaperPicker() {
  if (!planVerified || !isPremium) return;
  $('wallpaper-feedback').textContent = '';
  renderWallpaperOptions();
  $('wallpaper-dialog').showModal();
}
async function uploadWallpaper(event) {
  if (!planVerified || !isPremium) return;
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';
  if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
    $('wallpaper-feedback').textContent = 'Use uma imagem JPG, PNG ou WebP de até 12 MB.';
    return;
  }
  $('wallpaper-feedback').textContent = 'Preparando sua foto…';
  const objectUrl = URL.createObjectURL(file);
  try {
    const data = await new Promise((resolve, reject) => {
      const photo = new Image();
      photo.onload = () => {
        try {
          if (!photo.naturalWidth || !photo.naturalHeight) throw new Error('Imagem vazia');
          const scale = Math.min(1, 1400 / photo.naturalWidth, 1000 / photo.naturalHeight);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(photo.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(photo.naturalHeight * scale));
          canvas.getContext('2d').drawImage(photo, 0, 0, canvas.width, canvas.height);
          const encoded = canvas.toDataURL('image/jpeg', 0.74);
          if (encoded.length > 1600000) throw new Error('Imagem muito grande');
          resolve(encoded);
        } catch (error) { reject(error); }
      };
      photo.onerror = () => reject(new Error('Imagem inválida'));
      photo.src = objectUrl;
    });
    saveWallpaper({ type: 'photo', data });
  } catch {
    $('wallpaper-feedback').textContent = 'Não foi possível preparar esta foto. Tente uma imagem menor ou outro formato.';
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
const validColor = value => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : null;
const visualPremium = () => isPremium;
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
const OWN_PROFILE_COLUMNS = [
  'nome', 'data_nascimento', 'cidade_atual', 'cidade_natal', 'genero', 'buscando',
  'objetivo_conexao', 'altura', 'profissao', 'empresa', 'escolaridade', 'religiao',
  'filhos', 'fumante', 'bebida', 'hobbies', 'idiomas', 'mensagem_dia',
  'foto_url', 'fotos_perfil', 'cor_nome', 'instagram', 'musica_atual', 'artista_atual', 'ocultar_idade'
].join(',');
const OWN_PROFILE_FIELDS = [
  ['👤', 'Gênero', 'genero'], ['🎯', 'Buscando', 'buscando'],
  ['💟', 'Objetivo da conexão', 'objetivo_conexao'],
  ['📏', 'Altura', 'altura', value => formatHeightCm(value) ? `${formatHeightCm(value)} m` : ''],
  ['📍', 'Cidade natal', 'cidade_natal'], ['💼', 'Profissão', 'profissao'],
  ['🏢', 'Empresa', 'empresa'], ['🎓', 'Escolaridade', 'escolaridade'],
  ['👶', 'Filhos', 'filhos'], ['🚬', 'Fumante', 'fumante'],
  ['🍷', 'Bebida', 'bebida'], ['✨', 'Religião', 'religiao']
];
const FREE_PROFILE_FIELDS = new Set(['altura', 'religiao']);
function textValue(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
}
function ageFromBirthDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return '';
  const [year, month, day] = match.slice(1).map(Number);
  const today = todayInSaoPaulo().split('-').map(Number);
  const age = today[0] - year - (today[1] < month || (today[1] === month && today[2] < day) ? 1 : 0);
  return age >= 18 && age <= 125 ? `${age} anos` : '';
}
function fillOwnTags(id, raw) {
  const target = $(id);
  const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,;\n]/) : [];
  target.replaceChildren();
  const values = items.map(textValue).filter(Boolean);
  if (!values.length) {
    target.append(make('li', 'profile-empty', 'Ainda não informado.'));
    return;
  }
  values.forEach(value => target.append(make('li', null, value)));
}
function renderOwnMusic() {
  const target = $('profile-music');
  if (!planVerified) {
    target.textContent = 'Não foi possível confirmar o plano para consultar a música.';
    return;
  }
  if (!isPremium) {
    target.textContent = 'A música automática é um recurso Premium. Seus demais dados e todas as suas fotos continuam visíveis para você no Free.';
    return;
  }
  const title = textValue(userProfile?.musica_atual);
  const artist = textValue(userProfile?.artista_atual);
  target.textContent = title ? `Última música registrada: ${title}${artist ? ` — ${artist}` : ''}`
    : 'Nenhuma música registrada no momento. Abra um player compatível no Android para compartilhar.';
}
function renderOwnProfile() {
  const profile = userProfile || {};
  $('profile-presentation').textContent = textValue(profile.mensagem_dia) || 'Você ainda não escreveu sua apresentação.';
  fillOwnTags('profile-hobbies', profile.hobbies);
  fillOwnTags('profile-languages', profile.idiomas);
  const photos = profilePhotos(profile);
  const gallery = $('profile-gallery');
  gallery.replaceChildren();
  photos.forEach((value, index) => {
    const card = make('figure', 'own-photo');
    const photo = safePhoto(value);
    if (photo) {
      const img = make('img');
      img.src = photo;
      img.alt = `Sua foto ${index + 1}${index === 0 ? ', principal' : ''}`;
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      card.append(img);
    } else {
      card.append(make('span', 'own-photo-placeholder', value ? 'Foto sem prévia disponível neste navegador' : 'Espaço para foto'));
    }
    card.append(make('figcaption', null, index === 0 ? '★ Principal' : `Foto ${index + 1}`));
    gallery.append(card);
  });
  const facts = $('profile-facts');
  facts.replaceChildren();
  const displayed = isPremium ? OWN_PROFILE_FIELDS : OWN_PROFILE_FIELDS.filter(([, , key]) => FREE_PROFILE_FIELDS.has(key));
  displayed.forEach(([icon, label, key, format]) => {
    const card = make('div', 'profile-app-field');
    card.append(make('span', 'profile-app-label', `${icon} ${label}:`));
    const formatted = format ? format(profile[key]) : textValue(profile[key]);
    card.append(make('span', formatted ? 'profile-app-value' : 'profile-app-value profile-empty', formatted || 'Não informado'));
    facts.append(card);
  });
  const registered = OWN_PROFILE_FIELDS.filter(([, , key]) => textValue(profile[key])).length;
  const photosCount = photos.filter(Boolean).length;
  $('profile-data-status').textContent = userProfile
    ? `${photosCount} de 6 fotos · ${isPremium ? `Premium: ${registered} de ${OWN_PROFILE_FIELDS.length} informações cadastradas exibidas conforme preenchimento.` : 'Free: apresentação, hobbies, idiomas, altura e religião. Os demais dados continuam guardados e podem ser editados.'}`
    : 'Você ainda não cadastrou suas informações. Use Editar perfil para começar.';
  $('profile-age').textContent = ageFromBirthDate(profile.data_nascimento);
  renderOwnMusic();
}
function showView(view) {
  if (!sections.has(view)) view = 'inicio';
  clearInterval(roomExpiryRefreshTimer);
  roomExpiryRefreshTimer = null;
  clearInterval(roomCountdownTicker);
  roomCountdownTicker = null;
  if (currentView === 'cegas' && view !== 'cegas') void blindFeature?.exit();
  if (currentView === 'direta' && view !== 'direta') directFeature?.close();
  if (activeChat && view !== 'chat') void leaveChat();
  currentView = view;
  document.querySelectorAll('[data-panel]').forEach(node => {
    node.hidden = node.dataset.panel !== view;
  });
  document.querySelectorAll('.nav-item').forEach(node => {
    const selected = node.dataset.view === (view === 'chat' ? activeChat?.origin
      : view === 'direta' ? directFeature?.origin() : view);
    node.setAttribute('aria-pressed', String(Boolean(selected)));
  });
  if (view === 'salas') {
    void loadRooms();
    roomExpiryRefreshTimer = setInterval(() => { if (!document.hidden) void loadRooms(); }, 60000);
    roomCountdownTicker = setInterval(updateRoomCountdowns, 1000);
  }
  if (view === 'deck') void discoveries?.openDeck();
  if (view === 'conexoes') void discoveries?.openConnections();
  if (view === 'conversas') void directFeature?.openInbox();
  if (view === 'cegas') void blindFeature?.enter();
  if (view !== 'chat') history.replaceState(null, '', `#${view}`);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function loadProfile() {
  try {
    // A aba Perfil le apenas o registro do proprio usuario autenticado.
    // A liberacao de campos de outras pessoas continua regida pelo plano real.
    const rows = await api.authenticated(`/rest/v1/usuarios?select=${OWN_PROFILE_COLUMNS}&id=eq.${encodeURIComponent(api.user.id)}&limit=1`);
    userProfile = Array.isArray(rows) ? rows[0] : null;
    const name = userProfile?.nome?.trim() || api.user.email?.split('@')[0] || 'você';
    $('welcome-text').textContent = `Olá, ${name}! Escolha onde a conversa vai começar.`;
    $('profile-name').textContent = name;
    $('profile-city').textContent = userProfile?.cidade_atual?.trim() || 'Cidade ainda não informada';
    renderOwnProfile();
    const color = validColor(userProfile?.cor_nome);
    if (color) nameColors.set(api.user.id, color);
    const photo = safePhoto(userProfile?.foto_url);
    if (photo) {
      const image = make('img');
      image.src = photo;
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      $('profile-avatar').replaceChildren(image);
    } else {
      $('profile-avatar').replaceChildren(make('span', null, '♡'));
    }
  } catch {
    $('welcome-text').textContent = 'Sua conta está conectada. Vamos conversar?';
    $('profile-city').textContent = 'Não foi possível carregar seu perfil agora.';
    $('profile-data-status').textContent = 'Não foi possível carregar seus dados. Recarregue a página e tente novamente.';
  }
}
async function loadPlan() {
  try {
    const [effective, testState] = await Promise.all([rpc('meu_premium_ativo'), rpc('meu_plano_teste')]);
    isPremium = effective === true;
    testAllowed = testState?.autorizado === true;
    originalPremium = testState?.premium_real === true;
    previewPlan = testAllowed && ['free','premium'].includes(testState?.modo) ? testState.modo : 'real';
    $('preview-plan').value = previewPlan;
    planVerified = true;
  } catch {
    planVerified = false;
    testAllowed = false;
  }
  updatePlanPresentation();
  applyWallpaper();
  renderOwnProfile();
  renderOwnMusic();
}
function updatePlanPresentation() {
  const testing = testAllowed && previewPlan !== 'real';
  const realLabel = !planVerified ? 'Plano indisponível' : originalPremium ? '👑 Premium original' : '♡ Free original';
  $('real-plan-pill').textContent = realLabel;
  $('plan-pill').textContent = testing
    ? (isPremium ? '👑 Premium · TESTE' : '♡ Free · TESTE')
    : (!planVerified ? 'Plano indisponível' : (isPremium ? '👑 Premium' : '♡ Free'));
  $('test-plan-control').hidden = !testAllowed;
  $('preview-plan-note').hidden = !testing;
  $('preview-plan-description').textContent = testing
    ? `Modo ${isPremium ? 'Premium' : 'Free'} de TESTE ativo. As permissões são aplicadas de verdade nesta conta, enquanto a assinatura original permanece ${realLabel}. Você pode alternar novamente ou restaurar o plano original.`
    : '';
  $('home-plan-info').textContent = isPremium
    ? `Premium: Chat Global e salas ilimitados, salas por cidade e Conversa às Cegas liberadas.${testing ? ' TESTE ativo.' : ''}`
    : `Free: 30 minutos grátis diários compartilhados entre o Chat Global e as salas por assunto. Salas por cidade e Conversa às Cegas bloqueadas.${testing ? ' TESTE ativo.' : ''}`;
  $('rooms-plan-note').textContent = isPremium
    ? `👑 Premium: Chat Global e salas ilimitados, incluindo salas por cidade.${testing ? ' Modo de teste.' : ''}`
    : `♡ Free: 30 min/dia compartilhados entre Global e salas por assunto. Salas por cidade são Premium.${testing ? ' Modo de teste.' : ''}`;
  $('rooms-create-note').textContent = !planVerified
    ? 'Não foi possível conferir sua assinatura. Recarregue para tentar criar uma sala.'
    : isPremium ? 'Seu plano Premium permite criar salas. As novas salas aparecem também no Android.'
      : 'Criar salas requer Premium. Altere para Premium no seletor de testes, se sua conta estiver autorizada.';
  const blindEnabled = planVerified && isPremium;
  $('rooms-blind').disabled = !blindEnabled;
  $('rooms-blind').title = blindEnabled ? 'Entrar na Conversa às Cegas' : 'Conversa às Cegas exige Premium.';
  $('conversas-blind').disabled = !blindEnabled;
  $('conversas-blind').title = $('rooms-blind').title;
  $('rooms-create').disabled = !planVerified || !isPremium;
  $('rooms-create').title = isPremium ? 'Criar sala' : 'É necessário Premium para criar sala';
  renderOwnMusic();
  if (currentView === 'salas') renderRooms();
}

function appendRoom(room) {
  const card = make('article', 'room-card');
  const byCity = Boolean(room.cidade?.trim());
  const info = make('div', 'room-main');
  info.append(make('span', 'room-kind', byCity ? '📍 CIDADE' : '💬 ASSUNTO'));
  info.append(make('h2', null, room.nome || 'Sala sem nome'));
  if (byCity) info.append(make('p', 'room-subject', room.cidade.trim()));
  else if (room.assunto && room.assunto !== room.nome) info.append(make('p', 'room-subject', room.assunto));
  if (room.expira_em) {
    const expires = new Date(room.expira_em);
    if (Number.isFinite(expires.getTime())) {
      const formatted = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      }).format(expires);
      info.append(make('p', 'room-expires', `⏳ Encerra em ${formatted} (Brasília)`));
      const timer = make('p', 'room-countdown');
      info.append(timer);
      roomCountdownElements.push({ element: timer, expiresAt: room.expira_em });
    }
  }
  card.append(info);
  const actions = make('div', 'room-actions');
  const subject = isSubjectRoom(room);
  const shownPremium = visualPremium();
  const canEnter = planVerified && (isPremium || subject);
  const label = shownPremium ? '👑 Ilimitado'
    : subject ? '♡ 30 min compartilhados' : '👑 Bloqueada no Free';
  actions.append(make('span', 'lock-label', label));
  if (canEnter) {
    const enter = make('button', 'primary-action', 'Entrar na sala');
    enter.type = 'button';
    enter.addEventListener('click', () => void openChat({
      id: String(room.id), name: String(room.nome || 'Sala'),
      cidade: String(room.cidade || ''), expira_em: room.expira_em, origin: 'salas'
    }));
    actions.append(enter);
  } else {
    const button = make('button', 'outline-action', 'Acesso restrito');
    button.type = 'button';
    button.disabled = true;
    button.title = !planVerified ? 'Não foi possível verificar seu plano real.' : 'Esta sala exige Premium ativo.';
    actions.append(button);
  }
  card.append(actions);
  $('rooms-list').append(card);
}
function updateRoomCountdowns() {
  let expired = false;
  for (const entry of roomCountdownElements) {
    const remaining = roomCountdown(entry.expiresAt);
    if (!remaining) continue;
    entry.element.textContent = remaining.seconds === 0
      ? '⏰ Prazo encerrado' : `⏳ Tempo restante: ${remaining.text}`;
    entry.element.classList.toggle('ending-soon', remaining.phase === 'warning' || remaining.phase === 'final');
    entry.element.classList.toggle('ending-now', remaining.phase === 'expired');
    if (remaining.phase === 'expired') expired = true;
  }
  if (expired && currentView === 'salas' && Date.now() - lastExpiredRoomRefresh > 10000) {
    lastExpiredRoomRefresh = Date.now();
    void loadRooms();
  }
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
    const active = !room.expira_em || new Date(room.expira_em).getTime() > Date.now();
    return active && matchesCategory && matchesText;
  });
  $('rooms-list').replaceChildren();
  roomCountdownElements = [];
  $('rooms-count').textContent = `${rows.length} sala(s) nesta página${roomsHasNext ? ' · há mais salas' : ''}`;
  $('rooms-page-status').textContent = `Página ${roomsPage}`;
  $('rooms-previous').disabled = roomsPage <= 1;
  $('rooms-next').disabled = !roomsHasNext;
  document.querySelectorAll('[data-room-filter]').forEach(button => {
    const active = button.dataset.roomFilter === roomFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (!rows.length) {
    $('rooms-list').append(make('p', 'room-empty', roomsPage > 1
      ? 'Nenhuma sala nesta página. Volte para a anterior.'
      : 'Nenhuma sala encontrada. Experimente outro assunto ou cidade.'));
    return;
  }
  rows.forEach(appendRoom);
  updateRoomCountdowns();
}
async function loadRooms() {
  const thisRequest = ++roomsRequest;
  friendly('Carregando salas…', false, 'rooms-feedback');
  try {
    const params = new URLSearchParams({ select: 'id,nome,assunto,cidade,criador_id,duracao_horas,expira_em', order: 'created_at.desc', limit: String(ROOMS_PAGE_SIZE + 1), offset: String((roomsPage - 1) * ROOMS_PAGE_SIZE) });
    if (roomFilter === 'cidade') params.set('id', 'like.public:cidade_*');
    if (roomFilter === 'assunto') params.set('id', 'like.public:assunto_*');
    if (roomFilter === 'minhas') params.set('criador_id', `eq.${api.user.id}`);
    const search = roomSearch.trim().replace(/[(),.%*]/g, ' ').trim().slice(0, 70);
    if (search) params.set('or', `(nome.ilike.*${search}*,assunto.ilike.*${search}*,cidade.ilike.*${search}*)`);
    const rows = await api.authenticated(`/rest/v1/salas?${params}`);
    if (currentView !== 'salas' || thisRequest !== roomsRequest) return;
    if (!Array.isArray(rows)) throw new Error('Consulta de salas incompleta');
    roomsHasNext = rows.length > ROOMS_PAGE_SIZE;
    allRooms = rows.slice(0, ROOMS_PAGE_SIZE);
    friendly('', false, 'rooms-feedback');
    renderRooms();
  } catch {
    if (thisRequest !== roomsRequest) return;
    friendly('Não foi possível carregar as salas. Tente novamente ao voltar para esta tela.', true, 'rooms-feedback');
  }
}
async function createRoom(event) {
  event.preventDefault();
  const feedback = $('create-room-feedback');
  if (!planVerified || !isPremium) {
    feedback.textContent = 'Criar salas exige o modo Premium ativo.';
    return;
  }
  const type = $('create-room-type').value;
  const name = $('create-room-name').value.trim();
  const detail = $('create-room-detail').value.trim();
  const duration = Number($('create-room-duration').value);
  if (!['assunto', 'cidade'].includes(type) || name.length < 3 || detail.length < 2 || ![2, 12, 24].includes(duration)) {
    feedback.textContent = 'Informe nome, assunto ou cidade e uma duração válida para a sala.';
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
        cidade: type === 'cidade' ? detail : '', criador_id: api.user.id, duracao_horas: duration })
    });
    if (!Array.isArray(result) || !result.some(room => room.id === id)) throw new Error('Gravação não confirmada');
    $('create-room-dialog').close();
    $('create-room-form').reset();
    friendly(`Sala criada com validade de ${duration} horas! Ela também aparecerá no aplicativo.`, false, 'rooms-feedback');
    await loadRooms();
  } catch (error) {
    feedback.textContent = /duplicate|unique/i.test(error?.message || '')
      ? 'Já existe uma sala com esses dados. Tente outro nome.'
      : /permission|policy|premium|denied/i.test(error?.message || '')
        ? 'Não foi possível criar a sala com seu plano atual. Confira seu acesso Premium.'
        : 'Não foi possível confirmar a criação da sala. Verifique a conexão e tente novamente.';
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
  const modeLabel = testAllowed && previewPlan !== 'real' ? 'TESTE' : 'real';
  if (state?.premium === true) return `👑 Premium ${modeLabel} · ilimitado`;
  const seconds = Number(state?.segundos_restantes);
  return Number.isFinite(seconds)
    ? `♡ Free ${modeLabel} · ${Math.ceil(Math.max(0, seconds) / 60)} min compartilhados restantes hoje`
    : `♡ Free ${modeLabel} · 30 minutos compartilhados por dia`;
}
function roomTimeRpc(room) {
  return room.id === 'Global' ? 'tempo_chat_global'
    : isSubjectRoom(room) ? 'tempo_assunto_compartilhado' : 'tempo_sala_assunto';
}
function roomTimePayload(room, action) {
  return room.id === 'Global' ? { p_acao: action } : { p_sala_id: room.id, p_acao: action };
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
  const selected = validColor(userProfile?.cor_nome);
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
  if (!planVerified || !visualPremium()) {
    friendly('🎨 Escolher a cor do nome é um recurso Premium.', false, 'chat-feedback');
    return;
  }
  $('name-color-feedback').textContent = '';
  renderNameColorOptions();
  $('name-color-dialog').showModal();
}
async function saveNameColor(hex) {
  if (!planVerified || !NAME_COLORS.some(color => color.hex === hex) || changingNameColor) return;
  if (!isPremium) {
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
  if (room.expira_em && new Date(room.expira_em).getTime() <= Date.now()) {
    friendly('O prazo desta sala terminou. Escolha outra sala ativa.', true, 'rooms-feedback');
    if (currentView === 'salas') void loadRooms();
    return;
  }
  if (!planVerified || (room.id !== 'Global' && !isPremium && !isSubjectRoom(room))) {
    friendly(!planVerified ? 'Não foi possível conferir seu plano. Entre novamente.' : 'Esta sala é exclusiva para assinantes Premium.', true);
    return;
  }
  $('chat-title').textContent = room.name;
  $('chat-time').textContent = 'Conferindo acesso…';
  $('chat-room-countdown').hidden = true;
  $('chat-room-countdown').textContent = '';
  $('chat-expiration-warning').hidden = true;
  $('chat-expiration-warning').textContent = '';
  $('chat-back').textContent = '← Voltar';
  lastChatOrigin = room.origin || 'conversas';
  $('chat-messages').replaceChildren(make('p', 'chat-empty', 'Preparando sua conversa…'));
  $('chat-input').value = '';
  setChatEnabled(false);
  friendly('Verificando seu acesso à conversa…', false, 'chat-feedback');
  activeChat = { ...room, ready: false };
  const chat = activeChat;
  showView('chat');
  try {
    await restriction();
    const allowed = await rpc(roomTimeRpc(room), roomTimePayload(room, 'entrar'));
    if (activeChat !== chat) return;
    if (allowed?.permitido !== true) {
      friendly(allowed?.motivo === 'expired'
        ? '⏰ O prazo desta sala terminou. Volte às salas para escolher outra.'
        : room.id === 'Global' || isSubjectRoom(room)
        ? 'Seus 30 minutos compartilhados entre o Global e as salas por assunto terminaram. Volte amanhã ou escolha Premium.'
        : 'Essa sala exige uma conta Premium ativa.', true, 'chat-feedback');
      await leaveChat();
      return;
    }
    chat.ready = true;
    $('chat-time').textContent = chatAccessText(allowed);
    friendly('', false, 'chat-feedback');
    setChatEnabled(true);
    if (room.expira_em) {
      updateChatRoomCountdown();
      chatCountdownTicker = setInterval(updateChatRoomCountdown, 1000);
    }
    await loadMessages();
    if (activeChat !== chat || !chat.ready) return;
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

function updateChatRoomCountdown() {
  const chat = activeChat;
  const target = $('chat-room-countdown');
  const warning = $('chat-expiration-warning');
  const remaining = roomCountdown(chat?.expira_em);
  if (!remaining) {
    target.hidden = true;
    warning.hidden = true;
    return;
  }
  target.hidden = false;
  target.textContent = `⏳ Sala encerra em ${remaining.text}`;
  target.classList.toggle('ending-soon', remaining.phase === 'warning' || remaining.phase === 'final');
  target.classList.toggle('ending-now', remaining.phase === 'expired');
  warning.hidden = remaining.phase === 'normal';
  warning.textContent = remaining.phase === 'expired'
    ? '⏰ O tempo da sala terminou. A conversa foi encerrada.'
    : remaining.phase === 'final'
      ? '🚨 Falta menos de 1 minuto! Conclua sua mensagem antes que a sala encerre.'
      : remaining.phase === 'warning'
        ? '⚠️ Atenção: faltam 15 minutos ou menos para o encerramento da sala.' : '';
  if (remaining.phase === 'expired' && chat?.ready) void endExpiredChat();
}
async function endExpiredChat() {
  const chat = activeChat;
  if (!chat?.ready || expiredChatClosing) return;
  expiredChatClosing = true;
  try {
    await leaveChat();
    if (currentView !== 'chat') return;
    $('chat-time').textContent = '⏰ Sala encerrada';
    $('chat-room-countdown').textContent = '⏳ Sala encerrou: 00:00:00';
    $('chat-expiration-warning').hidden = false;
    $('chat-expiration-warning').textContent = '⏰ O tempo da sala terminou. Você pode voltar e escolher outra sala.';
    $('chat-back').textContent = '← Voltar às salas';
    friendly('Esta sala foi encerrada no horário previsto. O envio de mensagens foi desativado.', true, 'chat-feedback');
  } finally {
    expiredChatClosing = false;
  }
}
async function heartbeat() {
  const chat = activeChat;
  if (!chat?.ready || document.hidden) return;
  if (chat.expira_em && new Date(chat.expira_em).getTime() <= Date.now()) {
    await endExpiredChat();
    return;
  }
  try {
    await restriction();
    const state = await rpc(roomTimeRpc(chat), roomTimePayload(chat, 'ping'));
    if (activeChat !== chat) return;
    if (state?.permitido !== true) {
      if (state?.motivo === 'expired') {
        await endExpiredChat();
        return;
      }
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
  clearInterval(chatCountdownTicker);
  chatPoll = null;
  chatHeartbeat = null;
  chatCountdownTicker = null;
  setChatEnabled(false);
  if (chat.ready) {
    leavingChat = rpc(roomTimeRpc(chat), roomTimePayload(chat, 'sair')).catch(() => {});
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
  if (chat?.expira_em && roomCountdown(chat.expira_em)?.seconds === 0) {
    await endExpiredChat();
    return;
  }
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

async function changeTestPlan(mode) {
  if (!testAllowed || !planVerified || switchingTestPlan || !['real','free','premium'].includes(mode)) return;
  if (mode === previewPlan) return;
  switchingTestPlan = true;
  $('preview-plan').disabled = true;
  if (['chat','cegas'].includes(currentView)) showView(activeChat?.origin || 'conversas');
  await leavingChat;
  friendly(`Aplicando ${mode === 'real' ? 'o plano original' : `o modo ${mode === 'free' ? 'Free' : 'Premium'} de teste`}…`, false);
  try {
    const result = await rpc('definir_plano_teste', { p_modo: mode });
    const expectedPremium = mode === 'real' ? originalPremium : mode === 'premium';
    if (result?.autorizado !== true || result?.modo !== mode || result?.premium_efetivo !== expectedPremium) {
      throw new Error('Estado não confirmado');
    }
    location.reload();
  } catch {
    friendly('Não foi possível confirmar a troca de plano de teste. Tente novamente.', true);
    $('preview-plan').value = previewPlan;
  } finally {
    switchingTestPlan = false;
    $('preview-plan').disabled = false;
  }
}

export async function initWebApp(context) {
  api = context;
  $('app-home').addEventListener('click', () => showView('inicio'));
  $('preview-plan').addEventListener('change', event => void changeTestPlan(event.target.value));
  $('preview-return-real').addEventListener('click', () => void changeTestPlan('real'));
  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => showView(button.dataset.view));
  });
  $('open-global').addEventListener('click', () => void openChat({ id: 'Global', name: 'Chat Global', origin: 'conversas' }));
  $('rooms-global').addEventListener('click', () => void openChat({ id: 'Global', name: 'Chat Global', origin: 'salas' }));
  const openBlind = () => {
    if (!planVerified || !isPremium) {
      friendly('🎭 Conversa às Cegas é exclusiva do Premium.', true);
      if (currentView === 'salas') friendly('🎭 Conversa às Cegas exige Premium.', true, 'rooms-feedback');
      return;
    }
    showView('cegas');
  };
  $('rooms-blind').addEventListener('click', openBlind);
  $('conversas-blind').addEventListener('click', openBlind);
  $('rooms-search').addEventListener('input', event => {
    roomSearch = event.target.value;
    roomsPage = 1;
    renderRooms();
    clearTimeout(roomSearchTimer);
    roomSearchTimer = setTimeout(() => { if (currentView === 'salas') void loadRooms(); }, 350);
  });
  document.querySelectorAll('[data-room-filter]').forEach(button => {
    button.addEventListener('click', () => {
      roomFilter = button.dataset.roomFilter;
      roomsPage = 1;
      renderRooms();
      void loadRooms();
    });
  });
  $('rooms-previous').addEventListener('click', () => { if (roomsPage > 1) { roomsPage--; void loadRooms(); } });
  $('rooms-next').addEventListener('click', () => { if (roomsHasNext) { roomsPage++; void loadRooms(); } });
  $('rooms-create').addEventListener('click', () => {
    if (!planVerified || !isPremium) {
      friendly('Criar salas exige uma conta Premium ativa.', false, 'rooms-feedback');
      return;
    }
    $('create-room-feedback').textContent = '';
    $('create-room-dialog').showModal();
  });
  $('rooms-rules').addEventListener('click', () => window.alert(
    'Salas Vivas do Afinzer\n\nFree: 30 minutos diários compartilhados entre o Chat Global e as salas por assunto.\n\nPremium: Chat Global e salas ilimitados. Salas por cidade e criação de salas são Premium.\n\nNovas salas duram 2, 12 ou 24 horas (no máximo 24h). Após o vencimento, desaparecem automaticamente da lista.\n\nEscolha a cor do seu nome no chat; alterar a cor é um recurso Premium.'
  ));
  $('create-room-close').addEventListener('click', () => $('create-room-dialog').close());
  $('create-room-type').addEventListener('change', event => {
    const byCity = event.target.value === 'cidade';
    $('create-room-title').textContent = byCity ? '＋ Criar sala por cidade' : '＋ Criar sala por assunto';
    $('create-room-detail-label').textContent = byCity ? 'Cidade' : 'Assunto da sala';
    $('create-room-detail').placeholder = byCity ? 'Ex.: Campinas - SP' : 'Ex.: Música, viagens, filmes…';
  });
  $('create-room-form').addEventListener('submit', createRoom);
  $('chat-back').addEventListener('click', () => showView(activeChat?.origin || lastChatOrigin));
  $('chat-name-color').addEventListener('click', openNameColorPicker);
  $('name-color-close').addEventListener('click', () => $('name-color-dialog').close());
  $('wallpaper-chat-open').addEventListener('click', openWallpaperPicker);
  $('wallpaper-profile-open').addEventListener('click', openWallpaperPicker);
  $('wallpaper-close').addEventListener('click', () => $('wallpaper-dialog').close());
  $('wallpaper-file').addEventListener('change', event => void uploadWallpaper(event));
  $('chat-form').addEventListener('submit', sendMessage);
  $('chat-input').addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.repeat || event.keyCode === 229) return;
    event.preventDefault();
    if (!$('chat-input').disabled && !chatSending && $('chat-input').value.trim()) $('chat-form').requestSubmit();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && activeChat) showView(activeChat.origin);
  });
  window.addEventListener('pagehide', () => { if (activeChat) void leaveChat(); });
  await Promise.all([loadProfile(), loadPlan()]);
  directFeature = initDirectConversations({ $, api, rpc, make, getAccess: () => planVerified && isPremium, restriction, showView });
  discoveries = initDiscoveries({ api, rpc, make, safePhoto, friendly, premium: planVerified && isPremium,
    onDirectChat: person => directFeature.open(person) });
  blindFeature = initBlindConversations({ $, rpc, api,
    getAccess: () => planVerified && isPremium,
    restriction, leaveView: () => showView('salas') });
  friendly('');
  const start = location.hash.slice(1);
  showView(start !== 'chat' && sections.has(start) ? start : 'deck');
}
