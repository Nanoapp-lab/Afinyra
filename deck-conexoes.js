// Deck e Conexoes compartilham as mesmas tabelas/RPCs usadas pelo Android.
// O gesto nunca registra curtida: somente o botao com joinha chama curtir_usuario.
const $ = id => document.getElementById(id);
// A view perfis_app já aplica no Supabase as colunas visíveis ao Free e ao
// Premium. Não buscar public.usuarios de terceiros para contornar essa regra.
const PROFILE_SELECT = 'id,nome,mensagem_dia,cidade_atual,foto_url,fotos_perfil,idade_publica,is_online,genero,buscando,altura,cidade_natal,profissao,empresa,escolaridade,filhos,fumante,bebida,religiao,idiomas,hobbies,musica_atual,artista_atual';

export function initDiscoveries({ api, rpc, make, safePhoto, friendly, premium, onDirectChat, onPersonShown, getPreviewPlan = () => 'real' }) {
  const uid = api.user.id;
  const isPreview = () => getPreviewPlan() !== 'real';
  const looksPremium = () => getPreviewPlan() === 'real' ? premium : getPreviewPlan() === 'premium';
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
  function sidebarDetail(parent, icon, label, value) {
    if (value == null || String(value).trim() === '') return;
    const row = make('p', 'deck-side-detail');
    row.append(make('strong', null, `${icon} ${label}:`));
    row.append(make('span', null, String(value)));
    parent.append(row);
  }
  function sidebarList(parent, icon, label, values) {
    const items = (Array.isArray(values) ? values : typeof values === 'string' ? values.split(',') : [])
      .map(value => String(value || '').trim()).filter(Boolean);
    if (!items.length) return;
    const group = make('div', 'deck-side-group');
    group.append(make('strong', 'deck-side-group-title', `${icon} ${label}`));
    const list = make('ul', 'deck-side-list');
    for (const item of items) list.append(make('li', null, item));
    group.append(list);
    parent.append(group);
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
    surface.setAttribute('aria-label', `Perfil de ${name(person)}. Use o botão Passar para avançar sem curtir, ou o botão Curtir para demonstrar interesse.`);
    let coverImage = null;
    if (photo(person)) {
      coverImage = avatar(person, 'deck-cover');
      surface.append(coverImage);
    } else {
      const placeholder = make('div', 'deck-cover-placeholder');
      const words = name(person).split(/\s+/).filter(Boolean);
      const initials = [words[0]?.[0], words.length > 1 ? words[words.length - 1][0] : ''].join('').toUpperCase();
      placeholder.append(make('div', 'deck-placeholder-halo', initials || '♡'));
      const demoImage = [person.foto_url, ...(Array.isArray(person.fotos_perfil) ? person.fotos_perfil : [])]
        .some(value => typeof value === 'string' && value.startsWith('demo://'));
      placeholder.append(make('p', 'deck-photo-note', demoImage ? 'Imagem demonstrativa sem foto disponível' : 'Foto de perfil não disponível'));
      surface.append(placeholder);
    }
    surface.append(make('div', 'deck-shade'));
    surface.append(make('span', 'deck-photo-label', '✦ AFINZER · DESCOBERTAS'));
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
    const pass = make('button', 'deck-pass-action', '✕ Passar');
    pass.type = 'button';
    pass.disabled = changingDeck;
    pass.setAttribute('aria-label', `Passar o perfil de ${name(person)} sem curtir`);
    pass.addEventListener('click', () => void nextDeck());
    const like = make('button', 'primary-action deck-like-action', '👍 Curtir');
    like.type = 'button';
    like.disabled = changingDeck;
    like.addEventListener('click', () => void likeCurrent());
    controls.append(pass, like);
    if (premium && !isPreview() && typeof onDirectChat === 'function') {
      controls.classList.add('has-direct');
      const talk = make('button', 'deck-talk-action', '💬 Conversar');
      talk.type = 'button';
      talk.disabled = changingDeck;
      talk.setAttribute('aria-label', `Iniciar conversa privada Premium com ${name(person)}`);
      talk.addEventListener('click', () => { if (!changingDeck) void onDirectChat({ id: person.id, nome: name(person), origin: 'deck' }); });
      controls.append(talk);
    }
    card.append(controls);

    const panel = make('aside', 'deck-profile-panel');
    panel.setAttribute('aria-label', `Mais sobre ${name(person)}`);
    const panelTop = make('div', 'deck-panel-top');
    panelTop.append(make('span', 'deck-panel-eyebrow', 'CONHEÇA UM POUCO MAIS'));
    panelTop.append(make('span', 'deck-counter', `${deckIndex + 1} de ${deck.length}`));
    panel.append(panelTop);
    panel.append(make('h2', 'deck-panel-name', `${name(person)}${age(person)}`));
    panel.append(make('p', 'deck-panel-location', `⌖ ${person.cidade_atual || 'Cidade não informada'}`));

    const bio = make('div', 'deck-profile-bio');
    bio.append(make('span', 'deck-panel-eyebrow', 'SOBRE MIM'));
    const presentation = typeof person.mensagem_dia === 'string' ? person.mensagem_dia.trim() : '';
    bio.append(make('p', presentation ? 'deck-bio-text' : 'deck-bio-empty',
      presentation || 'Esta pessoa ainda não escreveu uma apresentação. Você pode abrir o perfil para conhecer os detalhes disponíveis.'));
    panel.append(bio);

    if (looksPremium() && premium) {
      const details = make('section', 'deck-side-profile');
      details.append(make('span', 'deck-panel-eyebrow', 'PERFIL COMPLETO · PREMIUM'));
      sidebarList(details, '🎨', 'HOBBIES', person.hobbies);
      sidebarList(details, '🗣️', 'IDIOMAS', person.idiomas);
      sidebarDetail(details, '👤', 'Gênero', person.genero);
      sidebarDetail(details, '🎯', 'Buscando', person.buscando);
      sidebarDetail(details, '📏', 'Altura', Number.isInteger(person.altura) ? `${(person.altura / 100).toFixed(2).replace('.', ',')} m` : null);
      sidebarDetail(details, '📍', 'Cidade natal', person.cidade_natal);
      sidebarDetail(details, '💼', 'Profissão', person.profissao);
      sidebarDetail(details, '🏢', 'Empresa', person.empresa);
      sidebarDetail(details, '🎓', 'Escolaridade', person.escolaridade);
      sidebarDetail(details, '👶', 'Filhos', person.filhos);
      sidebarDetail(details, '🚬', 'Fumante', person.fumante);
      sidebarDetail(details, '🍷', 'Bebida', person.bebida);
      sidebarDetail(details, '✨', 'Religião', person.religiao);
      if (person.musica_atual) sidebarDetail(details, '🎵', 'Ouvindo agora',
        `${person.musica_atual}${person.artista_atual ? ` — ${person.artista_atual}` : ''}`);
      if (details.children.length > 1) panel.append(details);

      const photos = [...new Set([photo(person), ...(Array.isArray(person.fotos_perfil) ? person.fotos_perfil.map(safePhoto) : [])].filter(Boolean))];
      if (photos.length > 1 && coverImage) {
        const gallery = make('section', 'deck-side-gallery');
        gallery.append(make('span', 'deck-panel-eyebrow', 'FOTOS DO PERFIL'));
        const thumbnails = make('div', 'deck-side-thumbnails');
        const controls = photos.map((url, index) => {
          const button = make('button', 'deck-side-thumb');
          button.type = 'button';
          button.setAttribute('aria-label', `Mostrar foto ${index + 1} de ${photos.length}`);
          const image = make('img');
          image.src = url;
          image.alt = '';
          image.loading = 'lazy';
          image.referrerPolicy = 'no-referrer';
          button.append(image);
          thumbnails.append(button);
          return button;
        });
        controls.forEach((button, index) => button.addEventListener('click', () => {
          coverImage.src = photos[index];
          controls.forEach((item, photoIndex) => item.setAttribute('aria-pressed', String(photoIndex === index)));
        }));
        controls[0].setAttribute('aria-pressed', 'true');
        gallery.append(thumbnails);
        panel.append(gallery);
      }
    }

    const indicator = make('div', 'deck-profile-progress');
    const progressLabels = make('div', 'deck-progress-labels');
    progressLabels.append(make('span', null, 'Explorando perfis'));
    progressLabels.append(make('span', null, `${deckIndex + 1} / ${deck.length}`));
    indicator.append(progressLabels);
    const progress = make('progress', 'deck-progress');
    progress.max = deck.length;
    progress.value = deckIndex + 1;
    progress.setAttribute('aria-label', 'Progresso na lista de perfis');
    indicator.append(progress);
    panel.append(indicator);

    const reminder = make('div', 'deck-decision-note');
    reminder.append(make('span', 'deck-decision-icon', '♡'));
    const reminderText = make('div');
    reminderText.append(make('strong', null, 'O interesse é você quem decide.'));
    reminderText.append(make('p', null, 'Passar não envia curtida. Curtir demonstra seu interesse e pode criar uma conexão recíproca.'));
    reminder.append(reminderText);
    panel.append(reminder);
    const leftColumn = make('div', 'deck-left-column');
    const mural = make('section', 'deck-mural');
    mural.setAttribute('aria-label', `Mural de ${name(person)}`);
    leftColumn.append(card, mural);
    area.append(leftColumn, panel);
    if (typeof onPersonShown === 'function') void onPersonShown({ id: person.id, nome: name(person) }, mural);
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
    if (isPreview()) {
      deckIndex++;
      renderDeck();
      friendly('Comparação visual: o perfil foi passado somente nesta tela, sem registrar descarte.', false, 'deck-feedback');
      return;
    }
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
    if (isPreview()) return friendly('Esta é uma comparação visual. Selecione Meu plano real para curtir alguém.', true, 'deck-feedback');
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

  function profileLine(parent, label, value, icon = '✦') {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return;
    const row = make('div', 'discovery-field');
    row.append(make('span', 'discovery-field-label', `${icon} ${label}:`));
    row.append(make('p', 'discovery-field-value', Array.isArray(value) ? value.join(', ') : String(value)));
    parent.append(row);
  }
  function profileList(parent, title, values, icon) {
    const items = (Array.isArray(values) ? values : typeof values === 'string' ? values.split(',') : [])
      .map(item => String(item || '').trim()).filter(Boolean);
    if (!items.length) return;
    const group = make('div', 'discovery-detail-group');
    group.append(make('h4', 'discovery-detail-group-title', `${icon} ${title}`));
    const list = make('ul', 'discovery-detail-list');
    for (const item of items) list.append(make('li', null, item));
    group.append(list);
    parent.append(group);
  }
  function showProfile(id) {
    const person = byId.get(id) || receiving?.pessoas?.find(row => row.id === id);
    if (!person) return friendly('Este perfil não está disponível agora.', true);
    currentProfile = id;
    const container = $('discovery-details');
    container.replaceChildren();
    $('discovery-title').textContent = `${name(person)}${age(person)}`;

    const layout = make('div', 'discovery-layout');
    const media = make('section', 'discovery-media');
    media.setAttribute('aria-label', 'Fotos do perfil');
    const photos = (looksPremium() && premium && Array.isArray(person.fotos_perfil))
      ? [...new Set(person.fotos_perfil.map(safePhoto).filter(Boolean))]
      : [];
    const cover = photo(person);
    if (cover && !photos.includes(cover)) photos.unshift(cover);

    const frame = make('div', 'discovery-photo-frame');
    if (photos.length) {
      let photoIndex = 0;
      const image = make('img', 'discovery-hero');
      image.alt = `Foto de ${name(person)}`;
      image.src = photos[0];
      image.referrerPolicy = 'no-referrer';
      frame.append(image);
      media.append(frame);
      if (photos.length > 1) {
        const gallery = make('div', 'discovery-gallery');
        const buttons = make('div', 'discovery-gallery-controls');
        const previous = make('button', null, '‹ Anterior');
        previous.type = 'button';
        previous.setAttribute('aria-label', 'Foto anterior');
        const indicator = make('span', null, `Foto 1 de ${photos.length}`);
        const next = make('button', null, 'Próxima ›');
        next.type = 'button';
        next.setAttribute('aria-label', 'Próxima foto');
        const thumbs = make('div', 'discovery-thumbnails');
        const thumbButtons = photos.map((url, index) => {
          const thumb = make('button', 'discovery-thumb');
          thumb.type = 'button';
          thumb.setAttribute('aria-label', `Mostrar foto ${index + 1}`);
          const preview = make('img');
          preview.src = url;
          preview.alt = '';
          preview.referrerPolicy = 'no-referrer';
          preview.loading = 'lazy';
          thumb.append(preview);
          thumbs.append(thumb);
          return thumb;
        });
        const move = delta => {
          photoIndex = (photoIndex + delta + photos.length) % photos.length;
          image.src = photos[photoIndex];
          indicator.textContent = `Foto ${photoIndex + 1} de ${photos.length}`;
          thumbButtons.forEach((button, index) => button.setAttribute('aria-pressed', index === photoIndex ? 'true' : 'false'));
        };
        previous.addEventListener('click', () => move(-1));
        next.addEventListener('click', () => move(1));
        thumbButtons.forEach((button, index) => button.addEventListener('click', () => move(index - photoIndex)));
        move(0);
        buttons.append(previous, indicator, next);
        gallery.append(buttons, thumbs);
        media.append(gallery);
      }
    } else {
      const placeholder = make('div', 'discovery-photo-placeholder');
      const words = name(person).split(/\s+/).filter(Boolean);
      const initials = [words[0]?.[0], words.length > 1 ? words[words.length - 1][0] : ''].join('').toUpperCase();
      placeholder.append(make('div', 'discovery-placeholder-initials', initials || '♡'));
      const hasDemoPhoto = [person.foto_url, ...(Array.isArray(person.fotos_perfil) ? person.fotos_perfil : [])]
        .some(value => typeof value === 'string' && value.startsWith('demo://'));
      placeholder.append(make('p', null, hasDemoPhoto
        ? 'Este perfil usa uma imagem de demonstração, sem arquivo de foto disponível para o site.'
        : 'Nenhuma foto disponível para exibição neste perfil.'));
      frame.append(placeholder);
      media.append(frame);
    }

    const mediaCaption = make('p', 'discovery-media-note', photos.length
      ? (looksPremium() && premium ? 'Fotos compartilhadas neste perfil.' : 'Foto principal compartilhada neste perfil.')
      : 'Assim que uma foto válida estiver disponível, ela aparecerá aqui.');
    media.append(mediaCaption);
    layout.append(media);

    const content = make('div', 'discovery-content');
    const introduction = make('section', 'discovery-introduction');
    introduction.append(make('p', 'discovery-kicker', 'SOBRE ESTA PESSOA'));
    introduction.append(make('h3', 'discovery-person-name', `${name(person)}${age(person)}`));
    introduction.append(make('p', 'discovery-person-city', `⌖ ${person.cidade_atual || 'Cidade não informada'}`));
    introduction.append(presenceBadge(id));
    content.append(introduction);

    const about = make('section', 'discovery-about');
    about.append(make('h3', 'discovery-section-title', '✨ Sobre mim'));
    const presentation = typeof person.mensagem_dia === 'string' ? person.mensagem_dia.trim() : '';
    about.append(make('p', 'discovery-about-text', `Apresentação: ${presentation || 'Esta pessoa ainda não escreveu uma apresentação.'}`));
    content.append(about);

    if (looksPremium() && premium) {
      const details = make('section', 'discovery-extra');
      details.append(make('h3', 'discovery-section-title', '♡ Um pouco mais sobre mim'));
      const fields = make('div', 'discovery-facts');
      profileList(fields, 'HOBBIES', person.hobbies, '🎨');
      profileList(fields, 'IDIOMAS', person.idiomas, '🗣️');
      profileLine(fields, 'Gênero', person.genero, '👤');
      profileLine(fields, 'Buscando', person.buscando, '🎯');
      profileLine(fields, 'Altura', Number.isInteger(person.altura) ? `${(person.altura / 100).toFixed(2).replace('.', ',')} m` : null, '📏');
      profileLine(fields, 'Cidade natal', person.cidade_natal, '📍');
      profileLine(fields, 'Profissão', person.profissao, '💼');
      profileLine(fields, 'Empresa', person.empresa, '🏢');
      profileLine(fields, 'Escolaridade', person.escolaridade, '🎓');
      profileLine(fields, 'Filhos', person.filhos, '👶');
      profileLine(fields, 'Fumante', person.fumante, '🚬');
      profileLine(fields, 'Bebida', person.bebida, '🍷');
      profileLine(fields, 'Religião', person.religiao, '✨');
      if (person.musica_atual) profileLine(fields, 'Ouvindo agora', `${person.musica_atual}${person.artista_atual ? ' — ' + person.artista_atual : ''}`, '🎵');
      if (fields.children.length) details.append(fields);
      else details.append(make('p', 'discovery-about-text', 'Mais informações ainda não preenchidas.'));
      content.append(details);
    } else {
      const limited = make('div', 'discovery-premium-note');
      limited.append(make('span', 'discovery-premium-icon', '♛'));
      const message = make('div');
      message.append(make('strong', null, 'Conheça mais com o Premium'));
      message.append(make('p', null, looksPremium() && !premium
        ? 'Prévia Premium: os detalhes e as fotos privadas de outras pessoas só podem ser carregados quando sua conta tiver Premium real.'
        : 'Os demais detalhes e a galeria completa de outras pessoas ficam disponíveis no Premium. No Free, você vê a foto principal e a apresentação.'));
      limited.append(message);
      content.append(limited);
    }
    layout.append(content);
    container.append(layout);
    $('discovery-block').disabled = blocked.has(id);
    const dialog = $('discovery-dialog');
    dialog.showModal();
    dialog.scrollTop = 0;
  }
  async function blockProfile() {
    const id = currentProfile;
    if (isPreview()) return friendly('Volte ao plano real para bloquear um perfil. A prévia não altera seus dados.', true);
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
    if (isPreview()) return friendly('Volte ao plano real para denunciar um perfil.', true);
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
    return looksPremium() && premium ? (receiving?.pessoas || []) : [];
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
    if (premium && !isPreview() && typeof onDirectChat === 'function') {
      const talk = make('button', null, '💬 Conversar');
      talk.type = 'button';
      talk.addEventListener('click', () => void onDirectChat({ id, nome: name(person), origin: 'conexoes' }));
      actions.append(talk);
    }
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
    if (connectionTab === 'recebidas' && !(looksPremium() && premium)) {
      const card = make('div', 'connection-intro');
      card.append(make('h2', null, `👑 ${Number(receiving?.total || 0)} pessoa(s) querem conhecer você`));
      card.append(make('p', null, looksPremium() && !premium
        ? 'Prévia Premium: a lista privada de recebidas exige Premium real. A simulação nunca revela dados protegidos.'
        : 'No plano Free você vê a quantidade. O Premium revela quem são e permite dispensar uma curtida recebida.'));
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
      recebidas: looksPremium() && premium ? (receiving?.pessoas || []).filter(row => !blocked.has(row.id)).length : Number(receiving?.total || 0),
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
    if (isPreview()) return friendly('Volte ao plano real para dispensar uma curtida.', true, 'connections-feedback');
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
  return { openDeck, openConnections, refreshPreview() {
    if (deckReady) renderDeck();
    if (receiving) renderConnections();
    if (currentProfile && $('discovery-dialog').open) showProfile(currentProfile);
  } };
}
