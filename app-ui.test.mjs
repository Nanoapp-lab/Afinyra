import assert from 'node:assert/strict';
import { initWebApp } from './app.js';

class FakeNode {
  constructor(tag = 'div') {
    this.tag = tag; this.listeners = {}; this.children = []; this.dataset = {};
    this.attributes = {}; this.className = ''; this.style = {}; this.value = '';
    this.hidden = false; this.disabled = false; this.textContent = '';
    this.classList = { toggle: () => {} };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  fire(type, event = {}) { return this.listeners[type]?.({ preventDefault: () => {}, target: this, ...event }); }
  requestSubmit() { return this.fire('submit'); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
  reset() {}
}

const roots = new Map();
const bodyClasses = new Set();
const bodyStyles = new Map();
const savedPrefs = new Map();
const panels = ['inicio', 'deck', 'conexoes', 'conversas', 'salas', 'perfil', 'chat', 'cegas'].map(panel => {
  const node = new FakeNode(); node.dataset.panel = panel; return node;
});
const nav = panels.map(panel => {
  const node = new FakeNode('button'); node.dataset.view = panel.dataset.panel; return node;
});
const filters = ['todas', 'cidade', 'assunto', 'minhas'].map(value => {
  const node = new FakeNode('button'); node.dataset.roomFilter = value; return node;
});
globalThis.document = {
  hidden: false,
  body: {
    classList: { toggle: (name, active) => active ? bodyClasses.add(name) : bodyClasses.delete(name) },
    style: { setProperty: (name, value) => bodyStyles.set(name, value), removeProperty: name => bodyStyles.delete(name) }
  },
  addEventListener() {},
  createElement: tag => new FakeNode(tag),
  createTextNode: text => { const el = new FakeNode('text'); el.textContent = text; return el; },
  getElementById: id => { if (!roots.has(id)) roots.set(id, new FakeNode()); return roots.get(id); },
  querySelectorAll: selector => selector === '[data-panel]' ? panels
    : selector === '.nav-item' || selector === '[data-view]' ? nav
    : selector === '[data-room-filter]' ? filters : []
};
globalThis.window = { scrollTo() {}, alert() {}, addEventListener() {}, localStorage: {
  getItem: key => savedPrefs.get(key) ?? null,
  setItem: (key, value) => savedPrefs.set(key, value)
} };
globalThis.history = { replaceState() {} };
let reloads = 0;
globalThis.location = { hash: '', reload: () => { reloads++; } };

const uid = 'usuario-teste';
let color = '#FF80AB';
let premiumActive = true;
let originalPremium = true;
let testMode = 'real';
let testAuthorized = true;
const planSwitches = [];
const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const rooms = [
  { id: 'public:assunto_1', nome: 'Leitura', assunto: 'Livros', cidade: '', criador_id: uid, expira_em: tomorrow, duracao_horas: 24 },
  { id: 'public:cidade_1', nome: 'Pessoal de Campinas', assunto: 'Cidade', cidade: 'Campinas - SP', criador_id: 'outro', expira_em: tomorrow, duracao_horas: 24 },
  { id: 'public:assunto_antiga', nome: 'Sala antiga', assunto: 'Arquivada', cidade: '', criador_id: 'outro', expira_em: yesterday, duracao_horas: 2 }
];
const writes = [];
const sentMessages = [];
const timeActions = [];
let blindPublished = null;
let blindChatSent = '';
const api = {
  user: { id: uid, email: 'teste@example.com' },
  authenticated: async (path, opts = {}) => {
    if (path.includes('/usuarios?select=nome')) return [{
      nome: 'Pessoa Teste', data_nascimento: '1980-12-25', cidade_atual: 'Santos - SP',
      cidade_natal: 'Campinas - SP', cor_nome: color, altura: 175,
      genero: 'Feminino', buscando: 'Amizades', profissao: 'Professora', empresa: 'Escola Central',
      filhos: 'Não', fumante: 'Não', bebida: 'Socialmente', religiao: 'Católica',
      instagram: '@pessoateste', musica_atual: 'Música para teste', artista_atual: 'Artista Teste',
      mensagem_dia: 'Gosto de conversar e descobrir histórias.',
      hobbies: ['Música', 'Fotografia'], idiomas: ['Português', 'Inglês'],
      fotos_perfil: ['https://bzjwgvnyfunlwxfzbbbc.supabase.co/storage/v1/object/public/fotos/teste.jpg', null, null, null, null, null]
    }];
    if (path.includes('/rpc/meu_premium_ativo')) return premiumActive;
    if (path.includes('/rpc/meu_plano_teste')) return {
      autorizado: testAuthorized, modo: testMode, premium_real: originalPremium,
      premium_efetivo: premiumActive
    };
    if (path.includes('/rpc/definir_plano_teste')) {
      if (!testAuthorized) throw new Error('Não autorizado');
      testMode = JSON.parse(opts.body).p_modo;
      planSwitches.push(testMode);
      premiumActive = testMode === 'real' ? originalPremium : testMode === 'premium';
      return { autorizado: true, modo: testMode, premium_real: originalPremium, premium_efetivo: premiumActive };
    }
    if (path.includes('/rpc/cegas_deck_status')) return { situacao: 'novo' };
    if (path.includes('/rpc/cegas_deck_publicar')) { blindPublished = JSON.parse(opts.body).p_respostas; return { situacao: 'publicado' }; }
    if (path.includes('/rpc/cegas_deck_proximo')) return { situacao: 'perfil', perfil_id: 'outra-pessoa', respostas: [
      { pergunta: 'Uma conversa?', resposta: 'Sobre livros' },
      { pergunta: 'Um lugar?', resposta: 'Na praia' },
      { pergunta: 'Uma música?', resposta: 'Clássica' }
    ] };
    if (path.includes('/rpc/cegas_deck_convidar')) return { situacao: 'conectado', conversa_id: 'conversa-teste' };
    if (path.includes('/rpc/cegas_estado')) return { ativa: true, revelado: false, eu_solicitei: false, respostas_parceiro: ['Ler', 'Praia', 'Música'] };
    if (path.includes('/rpc/cegas_listar_mensagens')) return [{ minha: true, texto: 'Boa noite!' }];
    if (path.includes('/rpc/cegas_enviar')) { blindChatSent = JSON.parse(opts.body).p_conteudo; return true; }
    if (path.includes('/rpc/tempo_assunto_compartilhado')) {
      timeActions.push(JSON.parse(opts.body));
      return { permitido: true, premium: false, segundos_restantes: 1800 };
    }
    if (path.includes('/mensagens?select=')) return [];
    if (path === '/rest/v1/mensagens' && opts.method === 'POST') {
      sentMessages.push(JSON.parse(opts.body));
      return [];
    }
  if (path.includes('/salas?')) {
    const params = new URLSearchParams(path.split('?')[1]);
    const category = params.get('id');
    const myId = params.get('criador_id')?.replace(/^eq\./, '');
    const search = params.get('or')?.match(/nome\.ilike\.\*([^*]+)\*/)?.[1]?.toLocaleLowerCase('pt-BR');
    return rooms.filter(room => (!room.expira_em || new Date(room.expira_em).getTime() > Date.now())
      && (!category || room.id.startsWith(category.includes('assunto') ? 'public:assunto_' : 'public:cidade_'))
      && (!myId || room.criador_id === myId)
      && (!search || [room.nome, room.assunto, room.cidade].some(value => value.toLocaleLowerCase('pt-BR').includes(search))))
      .slice(Number(params.get('offset') || 0), Number(params.get('offset') || 0) + Number(params.get('limit') || 100));
  }
    if (path === '/rest/v1/salas' && opts.method === 'POST') {
      const row = JSON.parse(opts.body);
      row.expira_em = new Date(Date.now() + row.duracao_horas * 60 * 60 * 1000).toISOString();
      rooms.push(row); writes.push(row); return [row];
    }
    if (path.includes('/usuarios?select=id,cor_nome') && opts.method === 'PATCH') {
      color = JSON.parse(opts.body).cor_nome;
      writes.push({ cor_nome: color });
      return [{ id: uid, cor_nome: color }];
    }
    if (path.includes('/rpc/moderacao_minha_restricao')) return { restrita: false };
    if (path.includes('/perfis_app?')) return [{ id: uid, cor_nome: color }];
    return [];
  }
};
const $ = id => document.getElementById(id);
const find = (node, predicate) => {
  if (predicate(node)) return node;
  for (const child of node.children) { const result = find(child, predicate); if (result) return result; }
  return null;
};
const flush = () => new Promise(resolve => setTimeout(resolve, 10));

await initWebApp(api);
assert.equal($('plan-pill').textContent, '👑 Premium', 'A assinatura real é apresentada inicialmente');
assert.equal($('real-plan-pill').textContent, '👑 Premium original', 'A assinatura original é preservada');
assert.equal($('test-plan-control').hidden, false, 'Somente uma conta autorizada pode alternar planos de teste');
assert.match($('profile-music').textContent, /Música para teste/, 'Premium real vê música registrada');
assert.ok(find($('profile-facts'), node => node.textContent === '🏢 Empresa:'), 'Premium mostra todos os dados, incluindo empresa');
assert.ok(find($('profile-facts'), node => node.textContent === '🚬 Fumante:'), 'Premium mostra tabagismo');

nav.find(node => node.dataset.view === 'salas').fire('click');
await flush();
assert.equal($('rooms-count').textContent, '2 sala(s) nesta página');
assert.ok(find($('rooms-list'), node => node.className === 'room-expires' && /Encerra em/.test(node.textContent)), 'Exibe o prazo de encerramento na lista');
assert.equal(Boolean(find($('rooms-list'), node => node.textContent === 'Sala antiga')), false, 'Salas vencidas não aparecem na lista');
assert.equal($('rooms-create').disabled, false, 'Premium tem permissão real para criar sala');
assert.equal($('rooms-blind').disabled, false, 'Premium pode entrar na conversa às cegas');
for (const card of $('rooms-list').children) {
  assert.ok(find(card, child => child.textContent === '👑 Ilimitado'), 'Todas as salas exibem regra Premium real');
  assert.ok(find(card, child => child.tag === 'button' && child.textContent === 'Entrar na sala'), 'Premium entra nas salas');
}
filters.find(node => node.dataset.roomFilter === 'cidade').fire('click');
await flush();
assert.equal($('rooms-count').textContent, '1 sala(s) nesta página', 'Filtro Cidade reduz a lista');
filters.find(node => node.dataset.roomFilter === 'todas').fire('click');
$('rooms-search').fire('input', { target: { value: 'campinas' } });
assert.equal($('rooms-count').textContent, '1 sala(s) nesta página', 'Busca por cidade funciona');
$('rooms-search').fire('input', { target: { value: '' } });

assert.equal($('rooms-create').disabled, false, 'Premium real pode criar salas');
$('rooms-create').fire('click');
assert.equal($('create-room-dialog').open, true, 'Conta Premium pode abrir formulário de criação');
$('create-room-type').value = 'assunto';
$('create-room-name').value = 'Conversa legal';
$('create-room-detail').value = 'Cinema';
$('create-room-duration').value = '168';
$('create-room-form').fire('submit');
assert.match($('create-room-feedback').textContent, /duração válida/, 'Sete dias não é mais uma duração permitida');
assert.equal(writes.length, 0, 'Duração rejeitada não gera sala no banco');
$('create-room-duration').value = '12';
$('create-room-form').fire('submit');
await flush();
assert.equal(writes[0].nome, 'Conversa legal', 'Nova sala grava no mesmo banco');
assert.equal(writes[0].duracao_horas, 12, 'Duração escolhida é enviada ao Supabase');
assert.ok(new Date(writes[0].expira_em).getTime() > Date.now(), 'Servidor registra data futura para encerrar a sala');
assert.match(writes[0].id, /^public:assunto_[0-9a-f-]{36}$/, 'ID de sala segue o padrão Android');

$('rooms-blind').fire('click');
await flush();
assert.equal(panels.find(panel => panel.dataset.panel === 'cegas').hidden, false, 'Premium abre Conversa às Cegas');
for (let i = 0; i < 3; i++) {
  $('blind-answer').value = `Minha resposta número ${i + 1}`;
  await $('blind-continue').fire('click');
  await flush();
}
assert.equal(blindPublished?.length, 3, 'Publica as três respostas nas mesmas RPCs do app Android');
assert.equal($('blind-deck').hidden, false, 'Abre o deck anônimo após publicar');
await $('blind-invite').fire('click');
await flush();
assert.equal($('blind-chat').hidden, false, 'Convite aceito abre chat anônimo');
$('blind-chat-input').value = 'Boa noite!';
await $('blind-chat-form').fire('submit');
await flush();
assert.equal(blindChatSent, 'Boa noite!', 'Chat anônimo envia por cegas_enviar');
nav.find(node => node.dataset.view === 'salas').fire('click');

$('chat-name-color').fire('click');
assert.equal($('name-color-dialog').open, true, 'Premium abre seletor de cores');
assert.ok($('name-color-options').children.length >= 18, 'Premium oferece paleta ampliada de cores');
const cyan = find($('name-color-options'), node => node.className === 'name-color-option'
  && node.children.some(child => child.textContent === 'Ciano'));
assert.ok(cyan, 'Deve existir a mesma paleta de cores do Android');
cyan.fire('click');
await flush();
assert.equal(color, '#00D9FF', 'Cor escolhida atualiza usuarios.cor_nome');
assert.equal($('name-color-feedback').textContent.startsWith('Cor salva!'), true);
assert.equal($('wallpaper-profile-open').hidden, false, 'Premium pode personalizar o fundo do site pelo próprio perfil');
$('wallpaper-profile-open').fire('click');
assert.equal($('wallpaper-dialog').open, true, 'Premium abre seletor de fundo');
const aurora = find($('wallpaper-options'), node => node.className === 'wallpaper-option'
  && node.children.some(child => child.textContent === 'Aurora'));
assert.ok(aurora, 'Há fundos de tela predefinidos para Premium');
aurora.fire('click');
assert.equal(bodyClasses.has('premium-wallpaper-active'), true, 'Fundo premium aparece no site');
assert.equal(JSON.parse(savedPrefs.get(`afinzer-wallpaper-v1:${uid}`)).id, 'aurora', 'Fundo persiste por conta no navegador');
assert.equal($('preview-plan-note').hidden, true, 'Plano original não exibe aviso de teste');
$('preview-plan').fire('change', { target: { value: 'free' } });
await flush();
assert.equal(planSwitches.at(-1), 'free', 'Selecionar Free chama RPC de troca efetiva');
assert.equal(reloads, 1, 'Após trocar o plano, a área interna recarrega para aplicar permissões');
await initWebApp(api);
assert.equal($('plan-pill').textContent, '♡ Free · TESTE', 'O modo Free é aplicado realmente');
assert.equal($('real-plan-pill').textContent, '👑 Premium original', 'Premium original não é apagado');
assert.equal($('preview-plan-note').hidden, false, 'Mostra aviso de teste ativo');
assert.match($('home-plan-info').textContent, /30 minutos grátis/, 'Free mostra saldo de 30 minutos');
assert.match($('profile-music').textContent, /recurso Premium/, 'Modo Free bloqueia música Premium');
assert.equal($('rooms-create').disabled, true, 'Modo Free bloqueia criação de salas');
assert.equal($('rooms-blind').disabled, true, 'Modo Free bloqueia Conversa às Cegas');
assert.equal($('wallpaper-profile-open').hidden, true, 'Modo Free não oferece personalização Premium');
assert.equal(bodyClasses.has('premium-wallpaper-active'), false, 'Modo Free não aplica fundo Premium já salvo');
nav.find(node => node.dataset.view === 'perfil').fire('click');
assert.equal(panels.find(panel => panel.dataset.panel === 'perfil').hidden, false, 'A aba Perfil abre para Free');
assert.equal($('profile-gallery').children.length, 6, 'Galeria do próprio usuário mantém os seis espaços, mesmo Free');
assert.equal($('profile-gallery').children[0].children[0].tag, 'img', 'Foto do proprietário é exibida');
assert.ok(find($('profile-hobbies'), node => node.textContent === 'Música'), 'Hobbies do dono aparecem em Free');
assert.ok(find($('profile-languages'), node => node.textContent === 'Inglês'), 'Idiomas do dono aparecem em Free');
assert.ok(find($('profile-facts'), node => node.textContent === '1,75 m'), 'Altura em metros com vírgula');
assert.equal($('profile-presentation').textContent, 'Gosto de conversar e descobrir histórias.');
assert.equal(find($('profile-facts'), node => node.textContent === '💼 Profissão:'), null, 'Free usa o resumo de dados do aplicativo');
assert.ok(find($('profile-facts'), node => node.textContent === '✨ Religião:'), 'Free mostra religião no resumo');
assert.equal(find($('profile-facts'), node => node.textContent === '@pessoateste'), null, 'Instagram não é exibido na apresentação');
nav.find(node => node.dataset.view === 'salas').fire('click');
await flush();
const subjectRoom = $('rooms-list').children.find(node => find(node, child => child.textContent === 'Leitura'));
const cityRoom = $('rooms-list').children.find(node => find(node, child => child.textContent === 'Pessoal de Campinas'));
assert.ok(find(subjectRoom, node => node.tag === 'button' && node.textContent === 'Entrar na sala'), 'Free teste entra em sala por assunto com saldo compartilhado');
assert.equal(Boolean(find(cityRoom, node => node.tag === 'button' && node.textContent === 'Entrar na sala')), false, 'Free teste bloqueia sala por cidade');
assert.match($('rooms-plan-note').textContent, /compartilhados/, 'Free teste explica saldo compartilhado');
find(subjectRoom, node => node.tag === 'button' && node.textContent === 'Entrar na sala').fire('click');
await flush();
assert.equal($('chat-input').disabled, false, 'O campo de texto está liberado após entrar na sala');
const beforeSend = sentMessages.length;
$('chat-input').value = 'Primeira linha\nSegunda linha';
$('chat-input').fire('keydown', { key: 'Enter', shiftKey: true });
assert.equal(sentMessages.length, beforeSend, 'Shift+Enter não envia mensagem');
$('chat-input').fire('keydown', { key: 'Enter', isComposing: true });
assert.equal(sentMessages.length, beforeSend, 'Enter durante composição do teclado não envia');
$('chat-input').fire('keydown', { key: 'Enter' });
await flush();
assert.equal(sentMessages.length, beforeSend + 1, 'Enter envia mensagem sem clicar no botão');
assert.equal(sentMessages.at(-1).conteudo, 'Primeira linha\nSegunda linha', 'Mensagem com múltiplas linhas é preservada');
assert.equal($('chat-input').value, '', 'Campo é limpo após confirmação de envio');
assert.equal(timeActions[0]?.p_acao, 'entrar', 'A entrada Free chama RPC de tempo compartilhado');
assert.equal(timeActions[0]?.p_sala_id, 'public:assunto_1');
assert.match($('chat-time').textContent, /Free TESTE/, 'Chat usa permissão Free efetiva do teste');
nav.find(node => node.dataset.view === 'perfil').fire('click');
await flush();
assert.equal(timeActions.at(-1)?.p_acao, 'sair', 'Sair da sala encerra o uso compartilhado');
$('preview-plan').fire('change', { target: { value: 'premium' } });
await flush();
assert.equal(planSwitches.at(-1), 'premium', 'Selecionar Premium também chama troca efetiva');
assert.equal(reloads, 2);
await initWebApp(api);
assert.equal($('plan-pill').textContent, '👑 Premium · TESTE');
assert.equal($('rooms-create').disabled, false, 'Premium teste libera criação');
assert.equal($('wallpaper-profile-open').hidden, false, 'Premium teste libera fundo personalizado');
assert.equal(bodyClasses.has('premium-wallpaper-active'), true, 'Fundo salvo retorna ao alternar para Premium');
assert.equal($('rooms-blind').disabled, false, 'Premium teste libera Conversa às Cegas');
assert.match($('profile-music').textContent, /Música para teste/, 'Premium teste libera música');
nav.find(node => node.dataset.view === 'salas').fire('click');
await flush();
for (const card of $('rooms-list').children) {
  assert.ok(find(card, child => child.textContent === '👑 Ilimitado'), 'Premium teste libera todas as salas');
}
$('preview-return-real').fire('click');
await flush();
assert.equal(planSwitches.at(-1), 'real', 'Botão restaura plano original pela RPC');
assert.equal(reloads, 3);
await initWebApp(api);
assert.equal($('preview-plan').value, 'real', 'Modo original selecionado');
assert.equal($('rooms-create').disabled, false, 'Premium original continua intacto');
for (let i = 0; i < 19; i++) rooms.push({ id: `public:assunto_extra${i}`, nome: `Grupo ${i}`, assunto: 'Testes', cidade: '', criador_id: uid });
nav.find(node => node.dataset.view === 'salas').fire('click');
await flush();
assert.equal($('rooms-list').children.length, 15, 'Lista carregada em lotes de quinze');
assert.equal($('rooms-next').disabled, false, 'Há botão para próxima página');
$('rooms-next').fire('click');
await flush();
assert.equal($('rooms-page-status').textContent, 'Página 2');
assert.equal($('rooms-previous').disabled, false, 'É possível voltar de página');
testAuthorized = false;
await initWebApp(api);
assert.equal($('test-plan-control').hidden, true, 'Outras contas não veem o seletor de teste');
const switchCount = planSwitches.length;
$('preview-plan').fire('change', { target: { value: 'premium' } });
await flush();
assert.equal(planSwitches.length, switchCount, 'Conta não autorizada não pode solicitar mudança de plano');
console.log('OK: alternância real Free/Premium/original, recursos por plano, salas paginadas, criação, cor do nome e Conversa às Cegas com RPCs.');
