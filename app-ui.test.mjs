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
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
  reset() {}
}

const roots = new Map();
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
  addEventListener() {},
  createElement: tag => new FakeNode(tag),
  createTextNode: text => { const el = new FakeNode('text'); el.textContent = text; return el; },
  getElementById: id => { if (!roots.has(id)) roots.set(id, new FakeNode()); return roots.get(id); },
  querySelectorAll: selector => selector === '[data-panel]' ? panels
    : selector === '.nav-item' || selector === '[data-view]' ? nav
    : selector === '[data-room-filter]' ? filters : []
};
globalThis.window = { scrollTo() {}, alert() {}, addEventListener() {} };
globalThis.history = { replaceState() {} };
globalThis.location = { hash: '' };

const uid = 'usuario-teste';
let color = '#FF80AB';
let premiumActive = true;
const rooms = [
  { id: 'public:assunto_1', nome: 'Leitura', assunto: 'Livros', cidade: '', criador_id: uid },
  { id: 'public:cidade_1', nome: 'Pessoal de Campinas', assunto: 'Cidade', cidade: 'Campinas - SP', criador_id: 'outro' }
];
const writes = [];
const timeActions = [];
let blindPublished = null;
let blindChatSent = '';
const api = {
  user: { id: uid, email: 'teste@example.com' },
  authenticated: async (path, opts = {}) => {
    if (path.includes('/usuarios?select=nome')) return [{
      nome: 'Pessoa Teste', data_nascimento: '1980-12-25', cidade_atual: 'Santos - SP',
      cidade_natal: 'Campinas - SP', cor_nome: color, altura: 175,
      genero: 'Feminino', buscando: 'Amizades', profissao: 'Professora',
      instagram: '@pessoateste', musica_atual: 'Música para teste', artista_atual: 'Artista Teste',
      mensagem_dia: 'Gosto de conversar e descobrir histórias.',
      hobbies: ['Música', 'Fotografia'], idiomas: ['Português', 'Inglês'],
      fotos_perfil: ['https://bzjwgvnyfunlwxfzbbbc.supabase.co/storage/v1/object/public/fotos/teste.jpg', null, null, null, null, null]
    }];
    if (path.includes('/rpc/meu_premium_ativo')) return premiumActive;
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
  if (path.includes('/salas?')) {
    const params = new URLSearchParams(path.split('?')[1]);
    const category = params.get('id');
    const myId = params.get('criador_id')?.replace(/^eq\./, '');
    const search = params.get('or')?.match(/nome\.ilike\.\*([^*]+)\*/)?.[1]?.toLocaleLowerCase('pt-BR');
    return rooms.filter(room => (!category || room.id.startsWith(category.includes('assunto') ? 'public:assunto_' : 'public:cidade_'))
      && (!myId || room.criador_id === myId)
      && (!search || [room.nome, room.assunto, room.cidade].some(value => value.toLocaleLowerCase('pt-BR').includes(search))))
      .slice(Number(params.get('offset') || 0), Number(params.get('offset') || 0) + Number(params.get('limit') || 100));
  }
    if (path === '/rest/v1/salas' && opts.method === 'POST') {
      const row = JSON.parse(opts.body); rooms.push(row); writes.push(row); return [row];
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
assert.equal($('real-plan-pill').textContent, '👑 Premium real', 'A assinatura comprovada sempre é exibida');
assert.match($('profile-music').textContent, /Música para teste/, 'Premium real vê música registrada');
$('preview-plan').fire('change', { target: { value: 'free' } });
assert.equal($('plan-pill').textContent, '♡ Free · somente visual', 'A comparação Free não troca o plano real');
assert.match($('home-plan-info').textContent, /30 minutos grátis/, 'Prévia Free mostra regras Free');
assert.equal($('real-plan-pill').textContent, '👑 Premium real', 'Prévia Free mantém o plano real visível');
assert.equal($('preview-plan-note').hidden, false, 'O aviso de prévia deve ficar visível');
$('preview-plan').fire('change', { target: { value: 'premium' } });
assert.equal($('plan-pill').textContent, '👑 Premium · somente visual');

nav.find(node => node.dataset.view === 'salas').fire('click');
await flush();
assert.equal($('rooms-count').textContent, '2 sala(s) nesta página');
assert.equal($('rooms-create').disabled, true, 'Simulação não permite criar sala, mesmo em conta Premium');
assert.equal($('rooms-blind').disabled, true, 'Simulação não permite entrar na conversa real');
for (const card of $('rooms-list').children) {
  assert.ok(find(card, child => child.textContent === '👑 Ilimitado · prévia'), 'Todas as salas exibem a mesma regra Premium simulada');
  assert.equal(find(card, child => child.tag === 'button' && child.textContent === 'Disponível no Premium')?.disabled, true,
    'Entradas em salas são bloqueadas na simulação');
}
filters.find(node => node.dataset.roomFilter === 'cidade').fire('click');
await flush();
assert.equal($('rooms-count').textContent, '1 sala(s) nesta página', 'Filtro Cidade reduz a lista');
filters.find(node => node.dataset.roomFilter === 'todas').fire('click');
$('rooms-search').fire('input', { target: { value: 'campinas' } });
assert.equal($('rooms-count').textContent, '1 sala(s) nesta página', 'Busca por cidade funciona');
$('rooms-search').fire('input', { target: { value: '' } });

$('preview-plan').fire('change', { target: { value: 'real' } });
assert.equal($('rooms-create').disabled, false, 'Premium real pode criar salas');
$('rooms-create').fire('click');
assert.equal($('create-room-dialog').open, true, 'Conta Premium pode abrir formulário de criação');
$('create-room-type').value = 'assunto';
$('create-room-name').value = 'Conversa legal';
$('create-room-detail').value = 'Cinema';
$('create-room-form').fire('submit');
await flush();
assert.equal(writes[0].nome, 'Conversa legal', 'Nova sala grava no mesmo banco');
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
const cyan = find($('name-color-options'), node => node.className === 'name-color-option'
  && node.children.some(child => child.textContent === 'Ciano'));
assert.ok(cyan, 'Deve existir a mesma paleta de cores do Android');
cyan.fire('click');
await flush();
assert.equal(color, '#00D9FF', 'Cor escolhida atualiza usuarios.cor_nome');
assert.equal($('name-color-feedback').textContent.startsWith('Cor salva!'), true);
assert.equal($('preview-plan-note').hidden, true, 'Ao voltar ao plano real, aviso de simulação desaparece');
premiumActive = false;
await initWebApp(api);
$('preview-plan').fire('change', { target: { value: 'premium' } });
assert.equal($('plan-pill').textContent, '👑 Premium · somente visual', 'Free pode visualizar Premium sem ser convertido');
assert.equal($('real-plan-pill').textContent, '♡ Free real', 'Conta real permanece Free');
assert.match($('profile-music').textContent, /prévia|Premium real/i, 'A prévia não revela música Premium real para Free');
nav.find(node => node.dataset.view === 'perfil').fire('click');
assert.equal(panels.find(panel => panel.dataset.panel === 'perfil').hidden, false, 'A aba Perfil abre para Free');
assert.equal($('profile-gallery').children.length, 6, 'Galeria do próprio usuário mantém os seis espaços, mesmo Free');
assert.equal($('profile-gallery').children[0].children[0].tag, 'img', 'Foto do proprietário é exibida');
assert.ok(find($('profile-hobbies'), node => node.textContent === 'Música'), 'Hobbies do dono aparecem em Free');
assert.ok(find($('profile-languages'), node => node.textContent === 'Inglês'), 'Idiomas do dono aparecem em Free');
assert.ok(find($('profile-facts'), node => node.textContent === '1,75 m'), 'Altura em metros com vírgula');
assert.equal($('profile-presentation').textContent, 'Gosto de conversar e descobrir histórias.');
assert.ok(find($('profile-facts'), node => node.textContent === '@pessoateste'), 'Instagram do dono aparece no perfil');
assert.match($('profile-music').textContent, /Prévia Premium/, 'Prévia não inventa música automática');
nav.find(node => node.dataset.view === 'salas').fire('click');
await flush();
// A prévia não altera acesso; conferir o texto usando o plano real da conta Free.
$('preview-plan').fire('change', { target: { value: 'real' } });
assert.match($('profile-music').textContent, /recurso Premium/, 'Free real não visualiza música automática');
const subjectRoom = $('rooms-list').children.find(node => find(node, child => child.textContent === 'Leitura'));
const cityRoom = $('rooms-list').children.find(node => find(node, child => child.textContent === 'Pessoal de Campinas'));
assert.ok(find(subjectRoom, node => node.tag === 'button' && node.textContent === 'Entrar na sala'), 'Free entra em sala por assunto usando saldo compartilhado');
assert.equal(Boolean(find(cityRoom, node => node.tag === 'button' && node.textContent === 'Entrar na sala')), false, 'Free não entra em sala por cidade');
assert.match($('rooms-plan-note').textContent, /compartilhados/, 'Texto Free explica saldo compartilhado');
find(subjectRoom, node => node.tag === 'button' && node.textContent === 'Entrar na sala').fire('click');
await flush();
assert.equal(timeActions[0]?.p_acao, 'entrar', 'A entrada de sala Free chama a RPC de tempo compartilhado');
assert.equal(timeActions[0]?.p_sala_id, 'public:assunto_1');
assert.match($('chat-time').textContent, /Free real/, 'Chat usa e informa a permissão real do Supabase');
nav.find(node => node.dataset.view === 'perfil').fire('click');
await flush();
assert.equal(timeActions.at(-1)?.p_acao, 'sair', 'Sair da sala encerra o uso compartilhado');
$('preview-plan').fire('change', { target: { value: 'premium' } });
const before = writes.length;
$('chat-name-color').fire('click');
assert.equal($('name-color-dialog').open, true, 'Prévia Premium permite experimentar cores visualmente');
const yellow = find($('name-color-options'), node => node.className === 'name-color-option'
  && node.children.some(child => child.textContent === 'Amarelo'));
yellow.fire('click');
assert.equal($('name-color-demo').style.color, '#FFDC66', 'Cor pode ser simulada sem autorização de gravação');
assert.equal(writes.length, before, 'Prévia Premium não pode salvar cor em conta Free');
$('rooms-create').fire('click');
assert.equal(writes.length, before, 'Prévia Premium não pode criar sala em conta Free');
assert.equal($('rooms-create').disabled, true, 'A prévia desativa o formulário de criação');
assert.match($('rooms-feedback').textContent, /comparação visual/, 'Free recebe aviso de simulação imediatamente na tela');
nav.find(node => node.dataset.view === 'salas').fire('click');
await flush();
for (const card of $('rooms-list').children) {
  assert.ok(find(card, child => child.textContent === '👑 Ilimitado · prévia'), 'Prévia Premium Free não mistura regra Free nas salas');
}
$('preview-plan').fire('change', { target: { value: 'free' } });
const previewCity = $('rooms-list').children.find(node => find(node, child => child.textContent === 'Pessoal de Campinas'));
assert.ok(find(previewCity, child => child.textContent === '👑 Bloqueada no Free'), 'Prévia Free sinaliza restrição de sala por cidade');
$('preview-return-real').fire('click');
assert.equal($('preview-plan').value, 'real', 'Botão retorna ao modo de acesso verdadeiro');
assert.equal($('rooms-create').disabled, true, 'Conta Free real continua impedida de criar salas');
for (let i = 0; i < 19; i++) rooms.push({ id: `public:assunto_extra${i}`, nome: `Grupo ${i}`, assunto: 'Testes', cidade: '', criador_id: uid });
nav.find(node => node.dataset.view === 'salas').fire('click');
await flush();
assert.equal($('rooms-list').children.length, 15, 'Lista carregada em lotes de quinze');
assert.equal($('rooms-next').disabled, false, 'Há botão para próxima página');
$('rooms-next').fire('click');
await flush();
assert.equal($('rooms-page-status').textContent, 'Página 2');
assert.equal($('rooms-previous').disabled, false, 'É possível voltar de página');
console.log('OK: prévia Free/Premium, perfil completo Free, salas paginadas, criação, cor do nome e Conversa às Cegas com RPCs.');
