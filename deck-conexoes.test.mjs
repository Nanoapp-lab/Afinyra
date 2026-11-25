import assert from 'node:assert/strict';
import { initDiscoveries } from './deck-conexoes.js';

class FakeNode {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.listeners = {};
    this.attributes = {}; this.dataset = {}; this.textContent = '';
    this.className = ''; this.disabled = false;
    this.classList = { toggle: () => {} };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  fire(name, event = {}) { return this.listeners[name]?.(event); }
  showModal() { this.open = true; }
  close() { this.open = false; }
}
const roots = new Map();
const tabButtons = ['recebidas', 'enviadas', 'reciprocas'].map(tab => {
  const el = new FakeNode('button'); el.dataset.connectionTab = tab; return el;
});
globalThis.document = {
  createElement: tag => new FakeNode(tag),
  createTextNode: text => { const el = new FakeNode('text'); el.textContent = text; return el; },
  getElementById: id => { if (!roots.has(id)) roots.set(id, new FakeNode()); return roots.get(id); },
  querySelectorAll: selector => selector === '[data-connection-tab]' ? tabButtons : []
};
globalThis.window = { confirm: () => true, prompt: () => 'Comportamento inadequado' };
const people = [
  { id: 'pessoa-a', nome: 'Ana', idade_publica: 29, cidade_atual: 'São Paulo', is_online: true, foto_url: 'demo://retrato/9', fotos_perfil: [], mensagem_dia: 'Gosto de conversar.', hobbies: ['Música'] },
  { id: 'pessoa-b', nome: 'Bia', idade_publica: 31, cidade_atual: 'Recife', cidade_natal: 'Olinda', empresa: 'Empresa Beta', filhos: 'Não', fumante: 'Não', bebida: 'Socialmente', is_online: false, foto_url: 'https://bzjwgvnyfunlwxfzbbbc.supabase.co/storage/v1/object/public/fotos/bia1.jpg', fotos_perfil: ['https://bzjwgvnyfunlwxfzbbbc.supabase.co/storage/v1/object/public/fotos/bia1.jpg', 'https://bzjwgvnyfunlwxfzbbbc.supabase.co/storage/v1/object/public/fotos/bia2.jpg'], hobbies: ['Leitura'] }
];
let sent = [];
let passed = [];
let likes = 0;
let hidden = false;
let isPremium = false;
const api = {
  user: { id: 'pessoa-usuaria' },
  authenticated: async (path, opts = {}) => {
    if (path.includes('/perfis_app?')) return people;
    if (path.includes('/sintonias?')) return sent;
    if (path.includes('/bloqueios_usuario?')) return [];
    if (path.includes('/descartes_deck?') && opts.method !== 'POST') return passed.map(descartado_id => ({ descartado_id }));
    if (path.includes('/descartes_deck?') && opts.method === 'POST') {
      passed.push(JSON.parse(opts.body).descartado_id); return [{ ok: true }];
    }
    if (path.includes('/usuarios?')) return [{ id: 'pessoa-a', disponibilidade_publica: 'Ocupado' }];
    return null;
  }
};
const rpc = async (name, params = {}) => {
  if (name === 'curtir_usuario') {
    likes++;
    sent.unshift({ destinatario_id: params.p_destinatario_id, status: 'pendente' });
    return false;
  }
  if (name === 'minhas_curtidas_recebidas') return {
    premium: isPremium, total: hidden ? 0 : 1,
    pessoas: isPremium && !hidden ? [{ ...people[0], status: 'pendente' }] : []
  };
  if (name === 'ocultar_curtida_recebida') { hidden = true; return null; }
  throw new Error('RPC inesperada: ' + name);
};
const feedback = [];
const make = (tag, className, value) => { const el = new FakeNode(tag); el.className = className || ''; if (value !== undefined) el.textContent = String(value); return el; };
const find = (node, predicate) => {
  if (predicate(node)) return node;
  for (const child of node.children) { const result = find(child, predicate); if (result) return result; }
  return null;
};
const flush = () => new Promise(resolve => setTimeout(resolve, 10));
const create = (premium, getPreviewPlan = () => 'real') => initDiscoveries({
  api, rpc, make, safePhoto: value => typeof value === 'string' && value.startsWith('https://bzjwgvnyfunlwxfzbbbc.supabase.co/') ? value : null,
  friendly: (text, error, id) => feedback.push({ text, error, id }), premium, getPreviewPlan
});

const free = create(false);
await free.openDeck();
let surface = find(roots.get('deck-card-area'), node => node.className === 'deck-swipe-surface');
assert.ok(surface, 'Deck precisa mostrar perfil');
assert.ok(find(roots.get('deck-card-area'), node => node.className === 'deck-profile-panel'), 'Site precisa exibir informações ao lado do cartão');
assert.ok(find(roots.get('deck-card-area'), node => node.textContent === 'Gosto de conversar.'), 'Apresentação deve estar visível');
assert.equal(find(roots.get('deck-card-area'), node => node.textContent === 'Música'), null, 'Free não deve ganhar acesso a detalhes Premium');
assert.ok(find(roots.get('deck-card-area'), node => node.textContent.includes('Imagem demonstrativa')), 'Imagem demo não pode ser apresentada como foto inexistente');
find(roots.get('deck-card-area'), node => node.textContent === 'Ver perfil').fire('click');
assert.ok(roots.get('discovery-dialog').open, 'Ver perfil deve abrir o visualizador');
assert.ok(find(roots.get('discovery-details'), node => node.className === 'discovery-layout'), 'Visualizador deve ter layout com foto e dados');
assert.ok(find(roots.get('discovery-details'), node => node.textContent.includes('imagem de demonstração')), 'Visualizador deve explicar imagem demo');
assert.equal(find(roots.get('discovery-details'), node => node.textContent === 'Música'), null, 'Free não vê campos Premium no visualizador');
roots.get('discovery-dialog').close();
surface.fire('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
surface.fire('pointerup', { pointerId: 1, clientX: 110, clientY: 12 });
assert.equal(likes, 0, 'gesto direita não pode curtir');
surface.fire('pointerdown', { button: 0, pointerId: 1, clientX: 110, clientY: 10 });
surface.fire('pointerup', { pointerId: 1, clientX: 10, clientY: 12 });
await flush();
assert.deepEqual(passed, ['pessoa-a'], 'gesto esquerda deve passar no servidor');
surface = find(roots.get('deck-card-area'), node => node.className === 'deck-swipe-surface');
surface.fire('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
surface.fire('pointerup', { pointerId: 1, clientX: 110, clientY: 12 });
assert.equal(likes, 0, 'voltar ao perfil anterior não pode gerar curtida');
const like = find(roots.get('deck-card-area'), node => node.textContent === '👍 Curtir');
like.fire('click');
await flush();
assert.equal(likes, 1, 'só o joinha pode chamar a RPC de curtida');
const passButton = find(roots.get('deck-card-area'), node => node.textContent === '✕ Passar');
assert.ok(passButton, 'O site precisa ter um botão Passar explícito');
passButton.fire('click');
await flush();
assert.deepEqual(passed, ['pessoa-a', 'pessoa-b'], 'Passar pelo botão registra o descarte no servidor');
assert.equal(likes, 1, 'Passar pelo botão não deve enviar curtida');

await free.openConnections();
tabButtons[0].fire('click');
const countFree = find(roots.get('connections-list'), node => node.textContent.includes('1 pessoa(s)'));
assert.ok(countFree, 'Free vê quantidade de recebidas');
assert.equal(find(roots.get('connections-list'), node => node.textContent === 'Ana'), null, 'Free não vê identidade de recebidas');

isPremium = true;
const premium = create(true);
await premium.openConnections();
await premium.openDeck();
find(roots.get('deck-card-area'), node => node.textContent === 'Ver perfil').fire('click');
assert.ok(find(roots.get('discovery-details'), node => node.textContent === 'Leitura'), 'Premium vê interesses extras');
for (const label of ['📍 Cidade natal:', '🏢 Empresa:', '👶 Filhos:', '🚬 Fumante:', '🍷 Bebida:']) {
  assert.ok(find(roots.get('discovery-details'), node => node.textContent === label), `Premium mostra ${label}`);
}
const nextPhoto = find(roots.get('discovery-details'), node => node.textContent === 'Próxima ›');
assert.ok(nextPhoto, 'Premium tem galeria quando existem fotos válidas');
nextPhoto.fire('click');
assert.ok(find(roots.get('discovery-details'), node => node.textContent === 'Foto 2 de 2'), 'Trocar foto deve atualizar a galeria');
roots.get('discovery-dialog').close();
const dismiss = find(roots.get('connections-list'), node => node.textContent === '✕ Dispensar');
assert.ok(dismiss, 'Premium pode dispensar recebidas');
dismiss.fire('click');
await flush();
assert.equal(hidden, true, 'Dispensar chama RPC de ocultação');
assert.ok(feedback.some(item => item.text === 'Curtida retirada da sua lista.'), 'Retirada é confirmada');
passed = [];
sent = [];
hidden = false;
let previewMode = 'premium';
const previewFree = create(false, () => previewMode);
await previewFree.openDeck();
find(roots.get('deck-card-area'), node => node.textContent === 'Ver perfil').fire('click');
assert.ok(find(roots.get('discovery-details'), node => node.textContent.includes('só podem ser carregados quando sua conta tiver Premium real')),
  'Prévia Premium não revela dados Premium de uma conta Free');
roots.get('discovery-dialog').close();
find(roots.get('deck-card-area'), node => node.textContent === '👍 Curtir').fire('click');
await flush();
assert.equal(likes, 1, 'Simulação nunca envia curtidas reais');
find(roots.get('deck-card-area'), node => node.textContent === '✕ Passar').fire('click');
await flush();
assert.deepEqual(passed, [], 'Simulação de passagem não grava descarte real');
await previewFree.openConnections();
assert.equal(find(roots.get('connections-list'), node => node.textContent === 'Ana'), null,
  'Recebidas continuam privadas na prévia Premium de conta Free');
previewMode = 'free';
previewFree.refreshPreview();
assert.ok(find(roots.get('connections-list'), node => node.textContent.includes('No plano Free')),
  'Trocar a prévia atualiza a apresentação das recebidas');
console.log('OK: Deck, Passar, gestos, modal de perfil, galeria Premium, Free e ocultação de recebidas.');
