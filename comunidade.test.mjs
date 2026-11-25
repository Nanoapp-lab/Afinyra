import assert from 'node:assert/strict';
import { communityReputation, initCommunity } from './comunidade.mjs';

for (const [count, level, next] of [[0,0,10],[10,1,50],[50,2,200],[200,3,500],[500,4,1000],[1000,5,5000],[5000,6,null]]) {
  const result = communityReputation(count);
  assert.equal(result.level, level);
  assert.equal(result.next, next);
}
assert.match(communityReputation(1000).label, /⭐⭐⭐⭐⭐/);
assert.match(communityReputation(5000).label, /💎 Diamante/);

class FakeNode {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.listeners = {}; this.dataset = {}; this.attributes = {};
    this.value = ''; this.textContent = ''; this.hidden = false; this.disabled = false; this.files = [];
    this.classList = { toggle() {} }; this.style = {};
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(type, action) { this.listeners[type] = action; }
  fire(type, event = {}) { return this.listeners[type]?.({ preventDefault() {}, ...event }); }
  setAttribute(name, value) { this.attributes[name] = value; }
}
const roots = new Map();
const $ = id => { if (!roots.has(id)) roots.set(id, new FakeNode()); return roots.get(id); };
const make = (tag, cls, content) => {
  const node = new FakeNode(tag); node.className = cls || '';
  if (content != null) node.textContent = String(content);
  return node;
};
const find = (node, match) => {
  if (match(node)) return node;
  for (const child of node.children) { const found = find(child, match); if (found) return found; }
  return null;
};
const flush = () => new Promise(resolve => setTimeout(resolve, 15));
globalThis.window = { prompt: () => null };
globalThis.document = { getElementById: $ };

const me = '11111111-1111-4111-8111-111111111111';
const beatriz = '22222222-2222-4222-8222-222222222222';
const date = new Date().toISOString();
const posts = [{ id: 'post-1', usuario_id: beatriz, conteudo: 'Hoje quero aprender astronomia.', fotos_urls: [], created_at: date }];
const likes = [];
const questions = [
  { id: 'pergunta-1', autor_id: beatriz, titulo: 'Como aprender sobre as estrelas?', detalhes: 'Quero começar hoje.', categoria: 'Estudos', resposta_util_id: null, created_at: date },
  { id: 'pergunta-2', autor_id: me, titulo: 'Como fazer amigos na cidade?', detalhes: '', categoria: 'Amizade', resposta_util_id: null, created_at: date }
];
const answers = [{ id: 'resposta-1', pergunta_id: 'pergunta-2', autor_id: beatriz, conteudo: 'Participe de atividades que você gosta!', created_at: date }];
const writes = [];
const api = {
  user: { id: me },
  authenticated: async (path, opts = {}) => {
    const body = opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    if (path.startsWith('/rest/v1/perfis_app')) return [{ id: me, nome: 'Juliano' }, { id: beatriz, nome: 'Beatriz' }];
    if (path.startsWith('/rest/v1/posts')) {
      if (opts.method === 'POST') { writes.push(['post', body]); posts.unshift({ ...body, id: 'post-2', created_at: date }); return null; }
      const who = path.match(/usuario_id=eq\.([^&]+)/)?.[1];
      return (who ? posts.filter(post => post.usuario_id === who) : posts).slice(0, 13);
    }
    if (path.startsWith('/rest/v1/curtidas_posts')) {
      if (opts.method === 'POST') { likes.push(body); writes.push(['like', body]); return null; }
      if (opts.method === 'DELETE') { likes.splice(likes.findIndex(like => like.post_id === 'post-1'), 1); return null; }
      return [...likes];
    }
    if (path.startsWith('/rest/v1/comentarios_posts')) return [];
    if (path.startsWith('/rest/v1/comunidade_reputacao')) return [
      { usuario_id: beatriz, total_respostas: 1000, respostas_uteis: 20 },
      { usuario_id: me, total_respostas: 0, respostas_uteis: 0 }
    ];
    if (path.startsWith('/rest/v1/comunidade_perguntas')) {
      if (opts.method === 'POST') { writes.push(['question', body]); questions.unshift({ ...body, id: 'pergunta-3', created_at: date }); return null; }
      if (opts.method === 'PATCH') { writes.push(['accepted', body]); questions.find(q => q.id === 'pergunta-2').resposta_util_id = body.resposta_util_id; return [{}]; }
      return [...questions];
    }
    if (path.startsWith('/rest/v1/comunidade_respostas')) {
      if (opts.method === 'POST') { writes.push(['answer', body]); answers.push({ ...body, id: 'resposta-2', created_at: date }); return null; }
      const id = path.match(/pergunta_id=eq\.([^&]+)/)?.[1];
      return answers.filter(answer => answer.pergunta_id === id);
    }
    throw new Error('Unexpected path: ' + path);
  }
};

const module = initCommunity({ $, api, make, safePhoto: () => null, restriction: async () => {}, premium: () => false, showView: () => {} });
const mural = make('section');
await module.renderMural({ id: beatriz, nome: 'Beatriz' }, mural);
assert.ok(find(mural, node => node.textContent === '💭 Mural de Beatriz'), 'Deck tem mural individual');
assert.ok(find(mural, node => node.textContent === posts[0].conteudo), 'Mural mostra publicação feita no app');
const like = find(mural, node => node.tag === 'button' && /Curtir publicação/.test(node.textContent));
assert.ok(like, 'Free pode curtir a publicação sem gerar match');
like.fire('click'); await flush();
assert.equal(writes.at(-1)?.[0], 'like');

module.openCommunity(); await flush();
assert.ok(find($('community-post-list'), node => node.textContent === 'Hoje quero aprender astronomia.'), 'Feed mostra posts do mesmo banco');
$('community-post-text').value = 'Novo pensamento de hoje';
await $('community-post-form').fire('submit'); await flush();
assert.equal(writes.at(-1)?.[0], 'post', 'Publicação usa posts do Android');
assert.equal(writes.at(-1)?.[1].usuario_id, me);

module.openQuestions(); await flush();
assert.ok(find($('community-question-list'), node => node.textContent === 'Como aprender sobre as estrelas?'), 'Perguntas aparecem no Afinzer Responde');
assert.match($('community-my-reputation').textContent, /0 resposta/);
const q1 = find($('community-question-list'), node => node.className === 'community-question'
  && find(node, child => child.textContent === 'Como aprender sobre as estrelas?'));
find(q1, node => node.tag === 'button' && /Ver respostas/.test(node.textContent)).fire('click'); await flush();
const textarea = find(q1, node => node.tag === 'textarea');
assert.ok(textarea, 'Pessoa pode responder uma pergunta de outra conta');
textarea.value = 'Leia um livro básico de astronomia.';
const form = find(q1, node => node.tag === 'form');
await form.fire('submit'); await flush();
assert.equal(writes.at(-1)?.[0], 'answer');
assert.equal(writes.at(-1)?.[1].autor_id, me);

const q2 = find($('community-question-list'), node => node.className === 'community-question'
  && find(node, child => child.textContent === 'Como fazer amigos na cidade?'));
find(q2, node => node.tag === 'button' && /Ver respostas/.test(node.textContent)).fire('click'); await flush();
const award = find(q2, node => node.tag === 'button' && /Esta resposta me ajudou/.test(node.textContent));
assert.ok(award, 'Autor da pergunta pode reconhecer resposta de Beatriz');
await award.fire('click'); await flush();
assert.deepEqual(writes.at(-1), ['accepted', { resposta_util_id: 'resposta-1' }]);
assert.ok(find(q2, node => node.textContent === '✅ Beatriz'), 'Resposta aceita aparece destacada');
console.log('OK: mural individual, feed Android, curtidas, publicações, perguntas, respostas, seleção útil, 1000 estrelas e 5000 diamante.');
