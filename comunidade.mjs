// Mural e feed reutilizam as historias do Android: posts, curtidas_posts e comentarios_posts.
// Perguntas/respostas compartilham a conta, moderacao e reputacao no mesmo Supabase.
const ORIGIN = 'https://bzjwgvnyfunlwxfzbbbc.supabase.co';
const PAGE_SIZE = 12;

export function communityReputation(count) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  if (total >= 5000) return { level: 6, label: '💎 Diamante', next: null };
  const limits = [10, 50, 200, 500, 1000];
  const level = limits.filter(number => total >= number).length;
  return { level, label: level ? '⭐'.repeat(level) : '☆ Iniciante', next: level === 5 ? 5000 : limits[level] };
}

export function initCommunity({ $, api, make, safePhoto, restriction, premium, showView }) {
  const uid = api.user.id;
  let people = null;
  let reputation = null;
  let postPage = 0;
  let questionPage = 0;
  let postFilter = null;
  let currentTab = 'posts';
  let postRequest = 0;
  let questionRequest = 0;
  const muralCache = new Map();

  function info(id, message, error = false) {
    const element = $(id);
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('error', error);
  }
  function time(iso) {
    const value = new Date(iso);
    return Number.isFinite(value.getTime()) ? value.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  }
  async function profiles(force = false) {
    if (people && !force) return people;
    const rows = await api.authenticated('/rest/v1/perfis_app?select=id,nome&limit=300');
    people = new Map((Array.isArray(rows) ? rows : []).map(row => [row.id, row.nome || 'Pessoa no Afinzer']));
    return people;
  }
  function personName(id) { return id === uid ? 'Você' : (people?.get(id) || 'Pessoa no Afinzer'); }
  async function reputations(force = false) {
    if (reputation && !force) return reputation;
    const rows = await api.authenticated('/rest/v1/comunidade_reputacao?select=usuario_id,total_respostas,respostas_uteis&limit=500');
    reputation = new Map((Array.isArray(rows) ? rows : []).map(row => [row.usuario_id, row]));
    return reputation;
  }
  function reputationText(id) {
    const record = reputation?.get(id);
    const total = Number(record?.total_respostas || 0);
    return `${communityReputation(total).label} · ${total} resposta(s) · ${Number(record?.respostas_uteis || 0)} reconhecida(s)`;
  }
  async function checkWrite() { await restriction(); }
  async function report(kind, id, owner) {
    if (!owner || owner === uid) return;
    const reason = window.prompt('Informe o motivo da denúncia (mínimo 3 caracteres):');
    if (!reason?.trim()) return;
    const text = `${kind} ${id}: ${reason.trim()}`.slice(0, 990);
    if (text.length < 3) return;
    try {
      await api.authenticated('/rest/v1/denuncias', { method: 'POST',
        body: JSON.stringify({ denunciante_id: uid, denunciado_id: owner, motivo: text }) });
      info('community-feedback', 'Denúncia registrada para análise da moderação.');
    } catch { info('community-feedback', 'Não foi possível registrar sua denúncia.', true); }
  }
  function reportButton(kind, record) {
    if (record.autor_id === uid || record.usuario_id === uid) return null;
    const button = make('button', 'community-report', '⚑ Denunciar');
    button.type = 'button';
    button.addEventListener('click', () => void report(kind, record.id, record.autor_id || record.usuario_id));
    return button;
  }
  async function likesFor(posts) {
    const ids = posts.map(post => post.id).filter(Boolean);
    if (!ids.length) return new Map();
    const rows = await api.authenticated(`/rest/v1/curtidas_posts?select=post_id,usuario_id&post_id=in.(${ids.map(encodeURIComponent).join(',')})&limit=5000`);
    const byPost = new Map(ids.map(id => [id, { total: 0, mine: false }]));
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const count = byPost.get(row.post_id);
      if (!count) continue;
      count.total++;
      if (row.usuario_id === uid) count.mine = true;
    }
    return byPost;
  }
  async function comments(post, target) {
    target.replaceChildren(make('p', 'muted-note', 'Carregando respostas…'));
    try {
      const rows = await api.authenticated(`/rest/v1/comentarios_posts?select=id,post_id,usuario_id,texto,created_at&post_id=eq.${encodeURIComponent(post.id)}&order=created_at.asc&limit=80`);
      await profiles();
      target.replaceChildren();
      if (!rows.length) target.append(make('p', 'muted-note', 'Ainda não há comentários.'));
      for (const row of rows) {
        const line = make('div', 'community-comment');
        line.append(make('strong', null, personName(row.usuario_id)));
        line.append(make('p', null, row.texto));
        target.append(line);
      }
      if (!premium()) {
        target.append(make('p', 'community-premium-note', '👑 Free pode ler e curtir. Responder a histórias é exclusivo do Premium, como no aplicativo.'));
        return;
      }
      const form = make('form', 'community-reply-form');
      const input = make('textarea');
      input.maxLength = 1000; input.required = true; input.rows = 2; input.placeholder = 'Escreva sua resposta…';
      const send = make('button', 'primary-action', 'Responder');
      send.type = 'submit'; form.append(input, send);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const value = input.value.trim();
        if (!value || value.length > 1000 || send.disabled) return;
        send.disabled = true;
        try {
          await checkWrite();
          await api.authenticated('/rest/v1/comentarios_posts', { method: 'POST',
            body: JSON.stringify({ post_id: post.id, usuario_id: uid, texto: value }) });
          await comments(post, target);
        } catch { info('community-feedback', 'Não foi possível responder. Verifique sua conta e o plano Premium.', true); }
        finally { send.disabled = false; }
      });
      target.append(form);
    } catch { target.replaceChildren(make('p', 'muted-note', 'Não foi possível carregar os comentários.')); }
  }
  function renderPost(post, like = { total: 0, mine: false }, options = {}) {
    const card = make('article', 'community-post');
    const status = make('p', 'community-inline-status');
    status.setAttribute('role', 'status');
    const header = make('div', 'community-post-top');
    const author = make('div');
    author.append(make('strong', null, options.author || personName(post.usuario_id)));
    author.append(make('small', null, time(post.created_at)));
    header.append(make('span', 'community-avatar', (options.author || personName(post.usuario_id)).slice(0, 2).toUpperCase()), author);
    card.append(header);
    if (post.conteudo?.trim()) card.append(make('p', 'community-post-body', post.conteudo));
    const photo = Array.isArray(post.fotos_urls) ? post.fotos_urls.map(safePhoto).find(Boolean) : null;
    if (photo) {
      const img = make('img', 'community-post-photo');
      img.src = photo; img.alt = `Foto publicada por ${options.author || personName(post.usuario_id)}`;
      img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; card.append(img);
    }
    const actions = make('div', 'community-post-actions');
    const likeButton = make('button', 'community-mini-action');
    likeButton.type = 'button';
    const label = () => { likeButton.textContent = `${like.mine ? '♥ Curtido' : '♡ Curtir publicação'} · ${like.total}`; };
    label();
    likeButton.addEventListener('click', async () => {
      if (likeButton.disabled) return;
      likeButton.disabled = true;
      try {
        await checkWrite();
        if (like.mine) await api.authenticated(`/rest/v1/curtidas_posts?post_id=eq.${encodeURIComponent(post.id)}&usuario_id=eq.${encodeURIComponent(uid)}`, { method: 'DELETE' });
        else await api.authenticated('/rest/v1/curtidas_posts', { method: 'POST', body: JSON.stringify({ post_id: post.id, usuario_id: uid }) });
        like.total += like.mine ? -1 : 1;
        like.mine = !like.mine;
        label();
      } catch { status.textContent = 'Não foi possível atualizar a curtida. Tente novamente.'; }
      finally { likeButton.disabled = false; }
    });
    const commentsButton = make('button', 'community-mini-action', '💬 Ler respostas');
    commentsButton.type = 'button';
    const replies = make('div', 'community-comments'); replies.hidden = true;
    commentsButton.addEventListener('click', () => {
      replies.hidden = !replies.hidden;
      if (!replies.hidden) void comments(post, replies);
    });
    actions.append(likeButton, commentsButton);
    const reportAction = reportButton('Publicação', { ...post, autor_id: post.usuario_id });
    if (reportAction) actions.append(reportAction);
    card.append(actions, status, replies);
    return card;
  }
  async function renderMural(person, target) {
    if (!person?.id || !target) return;
    const id = person.id;
    target.dataset.profileId = id;
    target.replaceChildren(make('p', 'muted-note', 'Buscando pensamentos e fotos…'));
    try {
      let cached = muralCache.get(id);
      if (!cached || Date.now() - cached.at > 30000) {
        const posts = await api.authenticated(`/rest/v1/posts?select=id,usuario_id,conteudo,fotos_urls,created_at&usuario_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=1`);
        const likes = await likesFor(Array.isArray(posts) ? posts : []);
        cached = { posts: Array.isArray(posts) ? posts : [], likes, at: Date.now() };
        muralCache.set(id, cached);
      }
      if (target.dataset.profileId !== id) return;
      target.replaceChildren();
      target.append(make('h3', null, `💭 Mural de ${person.nome || 'esta pessoa'}`));
      if (cached.posts.length) target.append(renderPost(cached.posts[0], cached.likes.get(cached.posts[0].id) || { total: 0, mine: false }, { author: person.nome }));
      else target.append(make('p', 'muted-note', 'Esta pessoa ainda não compartilhou pensamentos ou fotos.'));
      const explore = make('button', 'outline-action community-explore', 'Ver publicações na Comunidade');
      explore.type = 'button';
      explore.addEventListener('click', () => {
        postFilter = { id: person.id, name: person.nome };
        setTab('posts');
        showView('comunidade');
      });
      target.append(explore);
    } catch {
      if (target.dataset.profileId === id) target.replaceChildren(make('p', 'muted-note', 'Mural temporariamente indisponível.'));
    }
  }
  async function loadPosts(reset = true) {
    const request = ++postRequest;
    const nextPage = reset ? 0 : postPage + 1;
    const target = $('community-post-list');
    if (reset) { target.replaceChildren(make('p', 'muted-note', 'Carregando publicações…')); $('community-post-more').hidden = true; }
    try {
      await profiles();
      const filter = postFilter ? `&usuario_id=eq.${encodeURIComponent(postFilter.id)}` : '';
      const rows = await api.authenticated(`/rest/v1/posts?select=id,usuario_id,conteudo,fotos_urls,created_at${filter}&order=created_at.desc&limit=${PAGE_SIZE + 1}&offset=${nextPage * PAGE_SIZE}`);
      const posts = (Array.isArray(rows) ? rows : []).slice(0, PAGE_SIZE);
      const likes = await likesFor(posts);
      if (request !== postRequest) return;
      if (reset) target.replaceChildren();
      if (!posts.length && reset) target.append(make('p', 'community-empty', 'Ainda não há publicações por aqui. Que tal compartilhar a primeira?'));
      for (const post of posts) target.append(renderPost(post, likes.get(post.id)));
      postPage = nextPage;
      $('community-post-more').hidden = !Array.isArray(rows) || rows.length <= PAGE_SIZE;
      const filterView = $('community-profile-filter');
      filterView.hidden = !postFilter;
      filterView.replaceChildren();
      if (postFilter) {
        filterView.append(make('span', null, `Publicações de ${postFilter.name || 'esta pessoa'}`));
        const clear = make('button', 'community-mini-action', 'Mostrar todas');
        clear.type = 'button';
        clear.addEventListener('click', () => { postFilter = null; void loadPosts(); });
        filterView.append(clear);
      }
    } catch { if (request === postRequest) info('community-feedback', 'Não foi possível carregar o feed.', true); }
  }
  async function uploadPhoto(file) {
    if (!file) return null;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024 || !file.size)
      throw new Error('Escolha JPG, PNG ou WebP até 10 MB.');
    const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${uid}/posts/${crypto.randomUUID()}.${extension}`;
    await api.authenticated(`/storage/v1/object/posts/${path}`, {
      method: 'POST', headers: { 'Content-Type': file.type, 'x-upsert': 'false' }, body: file
    });
    return `${ORIGIN}/storage/v1/object/public/posts/${path}`;
  }
  async function publishPost(event) {
    event.preventDefault();
    const text = $('community-post-text').value.trim();
    const photo = $('community-post-photo').files?.[0];
    const button = $('community-post-submit');
    if (!text && !photo) return info('community-post-feedback', 'Escreva um pensamento ou selecione uma foto.', true);
    if (button.disabled) return;
    button.disabled = true;
    try {
      await checkWrite();
      info('community-post-feedback', photo ? 'Enviando foto…' : 'Publicando…');
      const url = await uploadPhoto(photo);
      await api.authenticated('/rest/v1/posts', { method: 'POST',
        body: JSON.stringify({ usuario_id: uid, conteudo: text, fotos_urls: url ? [url] : [] }) });
      $('community-post-text').value = '';
      $('community-post-photo').value = '';
      info('community-photo-name', 'Foto opcional · até 10 MB');
      info('community-post-feedback', 'Publicado! Sua história também aparecerá no aplicativo Android.');
      postFilter = null;
      muralCache.delete(uid);
      await loadPosts();
    } catch (error) { info('community-post-feedback', error?.message?.includes('Escolha') ? error.message : 'Não foi possível publicar. Seu texto foi preservado.', true); }
    finally { button.disabled = false; }
  }
  async function loadQuestions(reset = true) {
    const request = ++questionRequest;
    const nextPage = reset ? 0 : questionPage + 1;
    const target = $('community-question-list');
    if (reset) { target.replaceChildren(make('p', 'muted-note', 'Carregando perguntas…')); $('community-question-more').hidden = true; }
    try {
      await Promise.all([profiles(), reputations()]);
      const rows = await api.authenticated(`/rest/v1/comunidade_perguntas?select=id,autor_id,titulo,detalhes,categoria,resposta_util_id,created_at&order=created_at.desc&limit=${PAGE_SIZE + 1}&offset=${nextPage * PAGE_SIZE}`);
      const questions = (Array.isArray(rows) ? rows : []).slice(0, PAGE_SIZE);
      if (request !== questionRequest) return;
      if (reset) target.replaceChildren();
      if (!questions.length && reset) target.append(make('p', 'community-empty', 'Ainda não há perguntas. Compartilhe sua dúvida.'));
      for (const question of questions) target.append(renderQuestion(question));
      questionPage = nextPage;
      $('community-question-more').hidden = !Array.isArray(rows) || rows.length <= PAGE_SIZE;
      renderOwnReputation();
    } catch { if (request === questionRequest) info('community-feedback', 'Não foi possível carregar as perguntas. Tente novamente.', true); }
  }
  function renderOwnReputation() {
    const record = reputation?.get(uid);
    const total = Number(record?.total_respostas || 0);
    const tier = communityReputation(total);
    $('community-my-reputation').textContent = `${tier.label} · Você tem ${total} resposta(s) válida(s) e ${Number(record?.respostas_uteis || 0)} reconhecida(s) como úteis. ${tier.next ? `Próxima conquista: ${tier.next} respostas.` : 'Conquista máxima: Diamante!'}`;
  }
  function renderQuestion(q) {
    const card = make('article', 'community-question');
    const header = make('div', 'community-question-meta');
    header.append(make('span', 'community-category', `❓ ${q.categoria || 'Geral'}`));
    header.append(make('small', null, time(q.created_at)));
    card.append(header);
    card.append(make('h3', null, q.titulo));
    if (q.detalhes) card.append(make('p', 'community-question-body', q.detalhes));
    card.append(make('p', 'community-author', `Por ${personName(q.autor_id)} · ${reputationText(q.autor_id)}`));
    if (q.resposta_util_id) card.append(make('p', 'community-accepted-note', '✓ Esta pergunta já recebeu uma resposta reconhecida.'));
    const actions = make('div', 'community-post-actions');
    const show = make('button', 'community-mini-action', '💬 Ver respostas e participar'); show.type = 'button';
    const reportAction = reportButton('Pergunta', q);
    actions.append(show);
    if (reportAction) actions.append(reportAction);
    card.append(actions);
    const answerArea = make('div', 'community-answers'); answerArea.hidden = true;
    show.addEventListener('click', () => {
      answerArea.hidden = !answerArea.hidden;
      if (!answerArea.hidden) void showAnswers(q, answerArea);
    });
    card.append(answerArea);
    return card;
  }
  async function showAnswers(question, target) {
    target.replaceChildren(make('p', 'muted-note', 'Carregando respostas…'));
    try {
      const rows = await api.authenticated(`/rest/v1/comunidade_respostas?select=id,pergunta_id,autor_id,conteudo,created_at&pergunta_id=eq.${encodeURIComponent(question.id)}&order=created_at.asc&limit=100`);
      await Promise.all([profiles(), reputations(true)]);
      target.replaceChildren();
      const answers = Array.isArray(rows) ? rows : [];
      if (!answers.length) target.append(make('p', 'muted-note', 'Ainda não há respostas. Você pode ajudar!'));
      for (const answer of answers) {
        const block = make('div', 'community-answer');
        const accepted = question.resposta_util_id === answer.id;
        block.append(make('strong', null, `${accepted ? '✅ ' : ''}${personName(answer.autor_id)}`));
        block.append(make('small', 'community-rep-caption', reputationText(answer.autor_id)));
        block.append(make('p', null, answer.conteudo));
        if (question.autor_id === uid && !question.resposta_util_id && answer.autor_id !== uid) {
          const award = make('button', 'community-mini-action', '⭐ Esta resposta me ajudou'); award.type = 'button';
          award.addEventListener('click', async () => {
            award.disabled = true;
            try {
              await checkWrite();
              await api.authenticated(`/rest/v1/comunidade_perguntas?id=eq.${encodeURIComponent(question.id)}`, {
                method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ resposta_util_id: answer.id })
              });
              question.resposta_util_id = answer.id;
              reputation = null;
              await showAnswers(question, target);
              info('community-feedback', 'Resposta reconhecida! Obrigado por valorizar quem ajudou.');
            } catch { info('community-feedback', 'Não foi possível confirmar a resposta útil.', true); award.disabled = false; }
          });
          block.append(award);
        }
        const reportAction = reportButton('Resposta', answer);
        if (reportAction) block.append(reportAction);
        target.append(block);
      }
      if (question.autor_id === uid) target.append(make('p', 'muted-note', 'Você pode reconhecer uma resposta de outra pessoa, mas não responder à própria pergunta.'));
      else if (answers.some(answer => answer.autor_id === uid)) target.append(make('p', 'muted-note', 'Você já respondeu a esta pergunta. Uma resposta por pessoa.'));
      else {
        const form = make('form', 'community-reply-form');
        const input = make('textarea'); input.rows = 3; input.required = true; input.maxLength = 2000;
        input.placeholder = 'Compartilhe uma resposta útil (mínimo 10 caracteres)…';
        const button = make('button', 'primary-action', 'Enviar resposta'); button.type = 'submit';
        form.append(input, button);
        form.addEventListener('submit', async event => {
          event.preventDefault();
          const content = input.value.trim();
          if (content.length < 10 || button.disabled) return;
          button.disabled = true;
          try {
            await checkWrite();
            await api.authenticated('/rest/v1/comunidade_respostas', { method: 'POST',
              body: JSON.stringify({ pergunta_id: question.id, autor_id: uid, conteudo: content }) });
            reputation = null;
            await showAnswers(question, target);
            renderOwnReputation();
            info('community-feedback', 'Resposta publicada. Obrigado por ajudar!');
          } catch { info('community-feedback', 'Resposta não enviada. Verifique o texto ou se já respondeu.', true); button.disabled = false; }
        });
        target.append(form);
      }
    } catch { target.replaceChildren(make('p', 'muted-note', 'Não foi possível carregar as respostas.')); }
  }
  async function publishQuestion(event) {
    event.preventDefault();
    const title = $('community-question-title').value.trim();
    const description = $('community-question-details').value.trim();
    const category = $('community-question-category').value;
    const button = $('community-question-submit');
    if (title.length < 10 || title.length > 180 || button.disabled) return info('community-question-feedback', 'Sua pergunta precisa ter de 10 a 180 caracteres.', true);
    button.disabled = true;
    try {
      await checkWrite();
      await api.authenticated('/rest/v1/comunidade_perguntas', { method: 'POST',
        body: JSON.stringify({ autor_id: uid, titulo: title, detalhes: description, categoria: category }) });
      $('community-question-title').value = '';
      $('community-question-details').value = '';
      info('community-question-feedback', 'Pergunta publicada! Agora a comunidade poderá ajudar.');
      await loadQuestions();
    } catch { info('community-question-feedback', 'Não foi possível publicar a pergunta. Seu texto foi preservado.', true); }
    finally { button.disabled = false; }
  }
  function setTab(tab) {
    currentTab = tab;
    $('community-posts-panel').hidden = tab !== 'posts';
    $('community-questions-panel').hidden = tab !== 'questions';
    for (const name of ['posts', 'questions']) {
      const button = $(`community-${name}-tab`);
      button.classList.toggle('active', name === tab);
      button.setAttribute('aria-pressed', String(name === tab));
    }
    info('community-feedback', '');
    if (tab === 'posts') void loadPosts();
    else void loadQuestions();
  }
  function openCommunity() { setTab(currentTab); }

  $('community-posts-tab').addEventListener('click', () => setTab('posts'));
  $('community-questions-tab').addEventListener('click', () => setTab('questions'));
  $('community-post-form').addEventListener('submit', event => void publishPost(event));
  $('community-question-form').addEventListener('submit', event => void publishQuestion(event));
  $('community-post-more').addEventListener('click', () => void loadPosts(false));
  $('community-question-more').addEventListener('click', () => void loadQuestions(false));
  $('community-post-photo').addEventListener('change', () => {
    info('community-photo-name', $('community-post-photo').files?.[0]?.name || 'Foto opcional · até 10 MB');
  });
  return { openCommunity, renderMural };
}
