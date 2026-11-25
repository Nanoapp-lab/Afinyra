// Deck e Conexoes compartilham as mesmas tabelas/RPCs usadas pelo Android.
// O gesto nunca registra curtida: somente o botao com joinha chama curtir_usuario.
const $ = id => document.getElementById(id);
const PROFILE_SELECT = 'id,nome,mensagem_dia,cidade_atual,foto_url,fotos_perfil,idade_publica,is_online,genero,buscando,altura,profissao,escolaridade,religiao,idiomas,hobbies,musica_atual,artista_atual';

export function initDiscoveries({ api, rpc, make, safePhoto, friendly, premium }) {
  const uid = api.user.id;
  let profiles = [];
  let byId = new Map();
  let presence = new Map();
  let outgoing = [];
  let blocked = new Set();
  let discarded = new Set();
  let deck = [];
  let deckIndex = 0;
  let deckReady = false;
  let loadingCatalog = null;
  let changingDeck = false;
  let receiving = null;
  let connectionTab = 'recebidas';
  let currentProfile = null;

  function photo(profile) {
    const first = Array.isArray(profile?.fotos_perfil) ? profile.fotos_perfil.find(Boolean) : null;
    return safePhoto(profile?.foto_url) || safePhoto(first);
  }
  function name(profile) { return profile?.nome?.trim() || 'Pessoa no Afinzer'; }
  function age(profile) {
    return Number.isInteger(profile?.idade_publica) && profile.idade_publica >= 18
      ? `, ${profile.idade_publica} anos` : '';
  }
  function availability(id) {
    const profile = byId.get(id);
    if (!profile) return 'Estado indisponível';
    if (profile.is_online !== true) return 'Off-line';
    const selected = presence.get(id);
    return ['Online', 'Ocupado', 'Ausente', 'Não perturbe', 'Offline'].includes(selected)
      ? (selected === 'Offline' ? 'Off-line' : selected) : 'On-line';
  }
  function presenceBadge(id) {
    const status = availability(id);
    const cls = ['On-line', 'Online'].includes(status) ? 'presence-pill online'
      : ['Ocupado', 'Ausente', 'Não perturbe'].includes(status) ? 'presence-pill busy' : 'presence-pill';
    return make('span', cls, `● ${status}`);
  }
  function avatar(profile, className = 'connection-avatar') {
    const url = photo(profile);
    if (!url) return make('div', className, '♡');
    const img = make('img', className);
    img.src = url;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.loading = 'lazy';
    return img;
  }
  async function fetchOutgoing() {
    const rows = await api.authenticated(`/rest/v1/sintonias?select=destinatario_id,status,created_at&remetente_id=eq.${encodeURIComponent(uid)}&order=created_at.desc&limit=500`);
    outgoing = Array.isArray(rows) ? rows : [];
  }
  async function ensureCatalog(force = false) {
    if (!force && profiles.length) return;
    if (loadingCatalog) return loadingCatalog;
    loadingCatalog = (async () => {
      const [catalog, sent, blocks, passes] = await Promise.all([
        api.authenticated(`/rest/v1/perfis_app?select=${PROFILE_SELECT}&limit=300`),
        api.authenticated(`/rest/v1/sintonias?select=destinatario_id,status,created_at&remetente_id=eq.${encodeURIComponent(uid)}&order=created_at.desc&limit=500`),
        api.authenticated(`/rest/v1/bloqueios_usuario?select=bloqueado_id&bloqueador_id=eq.${encodeURIComponent(uid)}&limit=500`),
        api.authenticated(`/rest/v1/descartes_deck?select=descartado_id&usuario_id=eq.${encodeURIComponent(uid)}&limit=500`)
      ]);
      if (!Array.isArray(catalog) || !Array.isArray(sent) || !Array.isArray(blocks) || !Array.isArray(passes)) throw new Error('Consulta incompleta');
      profiles = catalog;
      byId = new Map(catalog.map(person => [person.id, person]));
      outgoing = sent;
      blocked = new Set(blocks.map(row => row.bloqueado_id));
      discarded = new Set(passes.map(row => row.descartado_id));
      presence = new Map();
      const ids = catalog.map(person => person.id).filter(Boolean);
      if (ids.length) {
        try {
          const rows = await api.authenticated(`/rest/v1/usuarios?select=id,disponibilidade_publica&id=in.(${ids.map(encodeURIComponent).join(',')})&limit=300`);
          if (Array.isArray(rows)) presence = new Map(rows.map(item => [item.id, item.disponibilidade_publica]));
        } catch { /* Um status nao confirmado nunca vira um status online inventado. */ }
      }
    })().finally(() => { loadingCatalog = null; });
    return loadingCatalog;
  }
  function createDeck() {
    const liked = new Set(outgoing.map(row => row.destinatario_id));
    deck = profiles.filter(person => person.id && person.id !== uid
      && !liked.has(person.id) && !blocked.has(person.id)
      && (premium || !discarded.has(person.id)));
    deckIndex = 0;
    deckReady = true;
  }
  function emptyDeck(message) {
    const card = make('div', 'deck-empty');
    card.append(make('h2', null, 'Todos os perfis vistos por enquanto'));
    card.append(make('p', null, message));
    const refresh = make('button', 'outline-action', 'Atualizar lista');
    refresh.type = 'button';
    refresh.addEventListener('click', async () => {
      deckReady = false;
      profiles = [];
      await openDeck();
    });
    card.append(refresh);
    $('deck-card-area').replaceChildren(card);
  }
  function renderDeck() {
    const area = $('deck-card-area');
    area.replaceChildren();
    const person = deck[deckIndex];
    if (!person) {
      emptyDeck('Novas pessoas aparecerão conforme forem se cadastrando. Não repetimos perfis automaticamente.');
      return;
    }
    const card = make('article', 'deck-card');
    const surface = make('div', 'deck-swipe-surface');
    surface.tabIndex = 0;
    surface.setAttribute('role', 'group');
    surface.setAttribute('aria-label', `Perfil de ${name(person)}. Arraste para a esquerda para avançar, direita para voltar.`);
    surface.append(avatar(person, photo(person) ? 'deck-cover' : 'deck-cover-placeholder'));
    surface.append(make('div', 'deck-shade'));
    const caption = make('div', 'deck-person');
    caption.append(make('h2', null, `${name(person)}${age(person)}`));
    caption.append(make('p', null, person.cidade_atual || 'Cidade não informada'));
    caption.append(presenceBadge(person.id));
    surface.append(caption);
    let starting = null;
    surface.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      starting = { x: event.clientX, y: event.clientY, id: event.pointerId };
    });
    surface.addEventListener('pointercancel', () => { starting = null; });
    surface.addEventListener('pointerup', event => {
      if (!starting || starting.id !== event.pointerId) return;
      const dx = event.clientX - starting.x;
      const dy = event.clientY - starting.y;
      starting = null;
      if (Math.abs(dx) < 65 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
      if (dx < 0) void nextDeck();
      else previousDeck();
    });
    surface.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); void nextDeck(); }
      if (event.key === 'ArrowRight') { event.preventDefault(); previousDeck(); }
    });
    card.append(surface);
    const controls = make('div', 'deck-buttons');
    const details = make('button', 'outline-action', 'Ver perfil');
    details.type = 'button';
    details.addEventListener('click', () => showProfile(person.id));
    const like = make('button', 'primary-action', '👍 Curtir');
    like.type = 'button';
    like.disabled = changingDeck;
    like.addEventListener('click', () => void likeCurrent());
    controls.append(details, like, make('span', 'deck-counter', `${deckIndex + 1} de ${deck.length}`));
    card.append(controls);
    area.append(card);
  }
  async function openDeck() {
    friendly('Carregando perfis…', false, 'deck-feedback');
    try {
      await ensureCatalog();
      if (!deckReady) createDeck();
      renderDeck();
      friendly('', false, 'deck-feedback');
    } catch {
      friendly('Não foi possível conferir perfis, curtidas e bloqueios. Tente novamente.', true, 'deck-feedback');
      $('deck-card-area').replaceChildren();
    }
  }
  async function nextDeck() {
    if (changingDeck || !deck[deckIndex]) return;
    changingDeck = true;
    const person = deck[deckIndex];
    renderDeck();
    try {
      // A passagem fica no historico; o retorno pelo gesto permanece local e seguro.
      await api.authenticated('/rest/v1/descartes_deck?on_conflict=usuario_id,descartado_id', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ usuario_id: uid, descartado_id: person.id })
      });
      discarded.add(person.id);
      deckIndex++;
      friendly('', false, 'deck-feedback');
    } catch {
      friendly('Não foi possível registrar a passagem. O cartão não foi avançado.', true, 'deck-feedback');
    } finally {
      changingDeck = false;
      renderDeck();
    }
  }
  function previousDeck() {
    if (changingDeck) return;
    if (deckIndex > 0) {
      deckIndex--;
      renderDeck();
      friendly('Perfil anterior. Nenhuma curtida foi enviada.', false, 'deck-feedback');
    } else {
      friendly('Este já é o primeiro perfil. Nenhuma curtida foi enviada.', false, 'deck-feedback');
    }
  }
  async function likeCurrent() {
    if (changingDeck || !deck[deckIndex]) return;
    const person = deck[deckIndex];
    changingDeck = true;
    renderDeck();
    try {
      const mutual = await rpc('curtir_usuario', { p_destinatario_id: person.id });
      await fetchOutgoing();
      if (!outgoing.some(row => row.destinatario_id === person.id)) throw new Error('Não confirmado');
      deck.splice(deckIndex, 1);
      friendly(mutual === true ? '✨ Conexão recíproca! Vocês querem se conhecer.' : '👍 Curtida enviada!', false, 'deck-feedback');
    } catch {
      friendly('Não foi possível confirmar a curtida. Tente novamente.', true, 'deck-feedback');
    } finally {
      changingDeck = false;
      renderDeck();
    }
  }

  function profileLine(parent, label, value) {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return;
    const row = make('p', 'discovery-info');
    row.append(make('strong', null, `${label}: `));
    row.append(document.createTextNode(Array.isArray(value) ? value.join(', ') : String(value)));
    parent.append(row);
  }
  function showProfile(id) {
    const person = byId.get(id) || receiving?.pessoas?.find(row => row.id === id);
    if (!person) return friendly('Este perfil não está disponível agora.', true);
    currentProfile = id;
    const container = $('discovery-details');
    container.replaceChildren();
    $('discovery-title').textContent = `${name(person)}${age(person)}`;
    const photos = (premium && Array.isArray(person.fotos_perfil))
      ? [...new Set(person.fotos_perfil.map(safePhoto).filter(Boolean))]
      : [];
    const cover = photo(person);
    if (cover && !photos.includes(cover)) photos.unshift(cover);
    if (photos.length) {
      let photoIndex = 0;
      const image = make('img', 'discovery-hero');
      image.alt = `Foto de ${name(person)}`;
      image.src = photos[0];
      image.referrerPolicy = 'no-referrer';
      container.append(image);
      if (photos.length > 1) {
        const buttons = make('div', 'discovery-gallery');
        const previous = make('button', null, 'Foto anterior');
        const indicator = make('span', null, `1 de ${photos.length}`);
        const next = make('button', null, 'Próxima foto');
        const move = delta => {
          photoIndex = (photoIndex + delta + photos.length) % photos.length;
          image.src = photos[photoIndex];
          indicator.textContent = `${photoIndex + 1} de ${photos.length}`;
        };
        previous.addEventListener('click', () => move(-1));
        next.addEventListener('click', () => move(1));
        buttons.append(previous, indicator, next);
        container.append(buttons);
      }
    }
    profileLine(container, 'Cidade', person.cidade_atual || 'Não informada');
    container.append(presenceBadge(id));
    profileLine(container, 'Apresentação', person.mensagem_dia);
    if (premium) {
      profileLine(container, 'Gênero', person.genero);
      profileLine(container, 'Quer conhecer', person.buscando);
      profileLine(container, 'Profissão', person.profissao);
      profileLine(container, 'Altura', Number.isInteger(person.altura) ? `${(person.altura / 100).toFixed(2).replace('.', ',')} m` : null);
      profileLine(container, 'Escolaridade', person.escolaridade);
      profileLine(container, 'Crenças', person.religiao);
      profileLine(container, 'Hobbies', person.hobbies);
      profileLine(container, 'Idiomas', person.idiomas);
      if (person.musica_atual) profileLine(container, 'Ouvindo agora', `${person.musica_atual}${person.artista_atual ? ' — ' + person.artista_atual : ''}`);
    } else {
      container.append(make('p', 'muted-note', 'Detalhes completos e galeria disponíveis no Premium.'));
    }
    $('discovery-block').disabled = blocked.has(id);
    $('discovery-dialog').showModal();
  }
  async function blockProfile() {
    const id = currentProfile;
    if (!id || blocked.has(id) || !window.confirm('Bloquear este perfil? Ele deixará de aparecer no seu Deck e você poderá desbloquear pelo aplicativo.')) return;
    try {
      await api.authenticated('/rest/v1/bloqueios_usuario', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ bloqueador_id: uid, bloqueado_id: id })
      });
      blocked.add(id);
      deck = deck.filter(person => person.id !== id);
      deckIndex = Math.min(deckIndex, deck.length);
      $('discovery-dialog').close();
      renderDeck();
      renderConnections();
      friendly('Perfil bloqueado.', false);
    } catch {
      friendly('Não foi possível confirmar o bloqueio. Tente novamente.', true);
    }
  }
  async function reportProfile() {
    const id = currentProfile;
    if (!id) return;
    const reason = window.prompt('Descreva o motivo da denúncia (mínimo de 3 caracteres):');
    if (reason == null) return;
    const motivo = reason.trim();
    if (motivo.length < 3 || motivo.length > 1000) return friendly('Informe um motivo entre 3 e 1000 caracteres.', true);
    try {
      await api.authenticated('/rest/v1/denuncias', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ denunciante_id: uid, denunciado_id: id, motivo })
      });
      $('discovery-dialog').close();
      friendly('Denúncia enviada para análise.', false);
    } catch {
      friendly('A denúncia não pôde ser enviada. Tente novamente.', true);
    }
  }

  function activeConnectionRows() {
    if (connectionTab === 'enviadas') return outgoing;
    if (connectionTab === 'reciprocas') return outgoing.filter(row => row.status === 'match');
    return premium ? (receiving?.pessoas || []) : [];
  }
  function renderConnectionCard(person, id, category) {
    if (blocked.has(id)) return null;
    const card = make('article', 'connection-card');
    card.append(avatar(person));
    const content = make('div', 'connection-main');
    content.append(make('h2', null, name(person)));
    content.append(make('p', null, person?.cidade_atual || 'Cidade não informada'));
    content.append(presenceBadge(id));
    content.append(make('p', null, category === 'recebidas' ? '✦ Quer conhecer você'
      : category === 'reciprocas' ? '✨ Conexão recíproca' : '✓ Você quer conhecer esta pessoa'));
    const actions = make('div', 'connection-actions');
    const profile = make('button', null, 'Ver perfil');
    profile.type = 'button';
    profile.addEventListener('click', () => showProfile(id));
    actions.append(profile);
    if (category === 'recebidas') {
      const dismiss = make('button', 'dismiss-button', '✕ Dispensar');
      dismiss.type = 'button';
      dismiss.setAttribute('aria-label', `Dispensar curtida recebida de ${name(person)}`);
      dismiss.addEventListener('click', () => void dismissReceived(id, dismiss));
      actions.append(dismiss);
    }
    content.append(actions);
    card.append(content);
    return card;
  }
  function renderConnections() {
    const list = $('connections-list');
    list.replaceChildren();
    document.querySelectorAll('[data-connection-tab]').forEach(button => {
      const selected = button.dataset.connectionTab === connectionTab;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    if (connectionTab === 'recebidas' && !premium) {
      const card = make('div', 'connection-intro');
      card.append(make('h2', null, `👑 ${Number(receiving?.total || 0)} pessoa(s) querem conhecer você`));
      card.append(make('p', null, 'No plano Free você vê a quantidade. O Premium revela quem são e permite dispensar uma curtida recebida.'));
      list.append(card);
    } else {
      const items = activeConnectionRows();
      const rows = [];
      for (const row of items) {
        const id = connectionTab === 'recebidas' ? row.id : row.destinatario_id;
        if (!id || blocked.has(id)) continue;
        const person = byId.get(id) || (connectionTab === 'recebidas' ? row : { id, nome: 'Perfil indisponível' });
        const card = renderConnectionCard(person, id, connectionTab);
        if (card) rows.push(card);
      }
      if (rows.length) list.append(...rows);
      else list.append(make('div', 'connection-intro', 'Nenhuma pessoa nesta lista por enquanto.'));
    }
    const counts = {
      recebidas: premium ? (receiving?.pessoas || []).filter(row => !blocked.has(row.id)).length : Number(receiving?.total || 0),
      enviadas: outgoing.filter(row => !blocked.has(row.destinatario_id)).length,
      reciprocas: outgoing.filter(row => row.status === 'match' && !blocked.has(row.destinatario_id)).length
    };
    friendly(`${counts[connectionTab]} conexão(ões) · ${connectionTab}`, false, 'connections-feedback');
  }
  async function openConnections() {
    friendly('Buscando conexões…', false, 'connections-feedback');
    try {
      await ensureCatalog();
      const [_, data] = await Promise.all([fetchOutgoing(), rpc('minhas_curtidas_recebidas')]);
      receiving = data && typeof data === 'object' ? data : { total: 0, pessoas: [] };
      // O servidor nunca envia nomes/fotos recebidos para contas Free.
      renderConnections();
    } catch {
      friendly('Não foi possível carregar suas conexões agora. Tente novamente.', true, 'connections-feedback');
      $('connections-list').replaceChildren();
    }
  }
  async function dismissReceived(id, button) {
    if (!premium || !window.confirm('Dispensar esta curtida recebida? Ela será retirada da sua lista, mas não apagará a ação da outra pessoa.')) return;
    button.disabled = true;
    try {
      await rpc('ocultar_curtida_recebida', { p_remetente: id });
      const after = await rpc('minhas_curtidas_recebidas');
      if (after?.pessoas?.some(person => person.id === id)) throw new Error('Não confirmado');
      receiving = after;
      renderConnections();
      friendly('Curtida retirada da sua lista.', false, 'connections-feedback');
    } catch {
      friendly('Não foi possível confirmar a retirada. Tente novamente.', true, 'connections-feedback');
      button.disabled = false;
    }
  }

  document.querySelectorAll('[data-connection-tab]').forEach(button => button.addEventListener('click', () => {
    connectionTab = button.dataset.connectionTab;
    renderConnections();
  }));
  $('discovery-close').addEventListener('click', () => $('discovery-dialog').close());
  $('discovery-block').addEventListener('click', () => void blockProfile());
  $('discovery-report').addEventListener('click', () => void reportProfile());
  return { openDeck, openConnections };
}
