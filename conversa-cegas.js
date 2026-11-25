// Mesmo fluxo privado do Android: as respostas, convites e mensagens passam
// exclusivamente pelas RPCs cegas_* do Supabase. Não consultamos perfis antes
// de uma revelação mútua confirmada pelo servidor.
const QUESTIONS = [
  'Qual conversa fez você perder a noção do tempo?',
  'Que música transporta você para uma lembrança boa?',
  'Se pudesse passar uma tarde em qualquer cidade, qual escolheria e por quê?',
  'Qual lembrança da infância ainda faz você sorrir?',
  'O que você mais valoriza em uma amizade verdadeira?',
  'Que pequeno gesto muda completamente o seu dia?',
  'Como seria um domingo perfeito para você?',
  'Qual foi o conselho mais bonito que já recebeu?',
  'Quando você percebe que pode confiar em alguém?',
  'Qual sonho você gostaria de realizar nos próximos anos?',
  'Qual livro, filme ou série mudou seu jeito de ver a vida?',
  'O que faz uma conversa ser inesquecível?',
  'Você prefere uma viagem sem destino ou um jantar tranquilo? Por quê?',
  'Que tradição de família você gostaria de manter para sempre?',
  'Qual cheiro lembra um momento especial da sua vida?',
  'Como você demonstra carinho por alguém?',
  'O que gostaria de aprender se tivesse tempo de sobra?',
  'Qual foi uma gentileza inesperada que nunca esqueceu?',
  'O que você considera indispensável em um relacionamento?',
  'Se pudesse reviver um dia feliz, qual escolheria?',
  'O que te faz dar risada de verdade?',
  'Você prefere conversar olhando as estrelas ou caminhando pela cidade?',
  'Qual lugar tem um significado especial para você?',
  'Que música colocaria para começar uma viagem de carro?',
  'Se pudesse preparar um jantar para alguém, o que faria?',
  'O que faz você se sentir em casa?',
  'Qual atitude mais inspira você nas outras pessoas?',
  'Se pudesse deixar uma mensagem ao seu eu de dez anos atrás, qual seria?',
  'Qual hobby gostaria de dividir com outra pessoa?',
  'O que costuma fazer quando precisa recuperar a paz?',
  'Qual momento simples recentemente fez você feliz?',
  'Como você gosta de comemorar boas notícias?',
  'Que tipo de conversa você gostaria de ter hoje?',
  'Qual foi a última coisa nova que experimentou?',
  'O que você aprendeu sobre o amor ao longo da vida?',
  'Que detalhe torna uma pessoa interessante para você?',
  'Você prefere surpresa ou planejamento? Conte por quê.',
  'Se a vida tivesse uma trilha sonora hoje, qual música tocaria?',
  'O que significa respeito em uma relação para você?',
  'Que coisa simples nunca deveria sair de moda?',
  'Qual história da sua vida adoraria contar para alguém?'
];

export function initBlindConversations({ $, rpc, api, getAccess, restriction, leaveView }) {
  let stage = 'setup';
  let active = false;
  let pending = false;
  let timer = null;
  let step = 0;
  let questionIndex = [0, 1, 2];
  let answers = ['', '', ''];
  let candidate = null;
  let inviteId = null;
  let seen = [];
  let conversation = null;
  let revealedId = null;
  let chatActive = false;
  let sending = false;

  const setMessage = message => { $('blind-feedback').textContent = message; };
  const text = (tag, content, cls) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    node.textContent = String(content || '');
    return node;
  };
  function setStage(next) {
    stage = next;
    ['setup', 'deck', 'chat'].forEach(name => { $(`blind-${name}`).hidden = name !== next; });
  }
  function showQuestion() {
    setStage('setup');
    $('blind-step').textContent = `Pergunta ${step + 1} de 3`;
    $('blind-question').textContent = QUESTIONS[questionIndex[step]];
    $('blind-answer').value = answers[step];
    $('blind-continue').textContent = step === 2 ? 'Publicar minhas respostas' : 'Próxima pergunta';
    $('blind-answer').disabled = pending;
    $('blind-continue').disabled = pending;
  }
  function renderAnswers(targetId, values) {
    const target = $(targetId);
    target.replaceChildren();
    if (!Array.isArray(values) || values.length !== 3) {
      target.append(text('p', 'Não há três respostas disponíveis.'));
      return;
    }
    values.forEach((item, i) => {
      const question = item && typeof item === 'object' ? item.pergunta : '';
      const answer = item && typeof item === 'object' ? item.resposta : item;
      const block = text('div', '', 'blind-answer-item');
      block.append(text('strong', question || `Resposta ${i + 1}`));
      block.append(text('p', answer || 'Resposta indisponível'));
      target.append(block);
    });
  }
  function stopPolling() {
    if (timer) clearInterval(timer);
    timer = null;
  }
  function startPolling(callback) {
    stopPolling();
    timer = setInterval(() => { if (active && !document.hidden && !pending) void callback(); }, 6000);
  }
  async function enter() {
    if (active) return;
    active = true;
    if (!getAccess()) {
      setMessage('A Conversa às Cegas exige Premium real. A prévia visual não libera acesso.');
      showQuestion();
      $('blind-continue').disabled = true;
      return;
    }
    setMessage('Verificando sua busca anônima…');
    try {
      await restriction();
      const status = await rpc('cegas_deck_status');
      if (!active) return;
      if (status?.situacao === 'conectado' && status.conversa_id) {
        await openChat(status.conversa_id);
      } else if (['procurando', 'convite'].includes(status?.situacao)) {
        setStage('deck');
        await checkStatus(status);
        await nextCandidate();
        startPolling(checkStatus);
      } else {
        setMessage('Responda três perguntas para começar. Não informe dados pessoais nas respostas.');
        showQuestion();
      }
    } catch {
      setMessage('Não foi possível verificar a busca. Confira sua conexão e tente novamente.');
      showQuestion();
    }
  }
  async function exit() {
    active = false;
    stopPolling();
    if (stage === 'deck') {
      try { await rpc('cegas_deck_pausar'); } catch { /* expiração do servidor */ }
    }
  }
  async function publish() {
    const value = $('blind-answer').value.trim();
    if (!value) { setMessage('Escreva uma resposta antes de continuar.'); return; }
    answers[step] = value;
    if (step < 2) { step++; setMessage(''); showQuestion(); return; }
    if (pending || !getAccess()) return;
    pending = true; showQuestion(); setMessage('Publicando suas três respostas…');
    try {
      await restriction();
      const response = await rpc('cegas_deck_publicar', {
        p_respostas: answers.map((resposta, i) => ({ pergunta: QUESTIONS[questionIndex[i]], resposta }))
      });
      if (response?.situacao !== 'publicado') throw new Error('Publicação não confirmada');
      seen = []; setStage('deck');
      setMessage('Suas respostas foram publicadas. Apenas suas respostas aparecem para outras pessoas.');
      pending = false;
      await nextCandidate();
      startPolling(checkStatus);
    } catch { setMessage('Não foi possível publicar suas respostas. Elas foram preservadas para tentar novamente.'); }
    finally { pending = false; $('blind-continue').disabled = false; }
  }
  async function nextCandidate() {
    if (!active || stage !== 'deck' || pending) return;
    pending = true;
    candidate = null;
    $('blind-invite').disabled = true;
    $('blind-deck-status').textContent = 'Procurando respostas anônimas…';
    try {
      const result = await rpc('cegas_deck_proximo', { p_ignorar: seen });
      if (!active || stage !== 'deck') return;
      if (result?.situacao === 'perfil' && result.perfil_id) {
        candidate = result.perfil_id;
        renderAnswers('blind-candidate', result.respostas);
        $('blind-deck-status').textContent = 'Gostou das respostas? Convide para conversar.';
        $('blind-invite').disabled = false;
      } else {
        $('blind-candidate').replaceChildren(text('p', result?.situacao === 'publique_primeiro'
          ? 'Publique suas três respostas antes de procurar pessoas.'
          : 'Não há outras pessoas disponíveis agora. Tente novamente mais tarde.'));
        $('blind-deck-status').textContent = 'Aguardando novas pessoas e convites.';
        if (seen.length) seen = [];
      }
    } catch { $('blind-deck-status').textContent = 'Não foi possível carregar. Tente novamente.'; }
    finally { pending = false; }
  }
  async function invite() {
    if (!candidate || pending) return;
    pending = true;
    const id = candidate;
    $('blind-invite').disabled = true;
    try {
      const result = await rpc('cegas_deck_convidar', { p_perfil: id });
      if (result?.situacao === 'conectado' && result.conversa_id) await openChat(result.conversa_id);
      else {
        seen.push(id);
        candidate = null;
        $('blind-deck-status').textContent = '💌 Convite enviado. O chat abre apenas se a outra pessoa aceitar.';
      }
    } catch { $('blind-deck-status').textContent = 'Não foi possível enviar seu convite. Tente novamente.'; candidate = id; $('blind-invite').disabled = false; }
    finally { pending = false; }
    if (active && stage === 'deck' && !candidate) await nextCandidate();
  }
  async function checkStatus(existing) {
    if (!active || stage !== 'deck') return;
    try {
      const result = existing || await rpc('cegas_deck_status');
      if (!active || stage !== 'deck') return;
      if (result?.situacao === 'conectado' && result.conversa_id) { await openChat(result.conversa_id); return; }
      if (result?.situacao === 'convite' && result.convite_id && Array.isArray(result.respostas)) {
        inviteId = result.convite_id;
        $('blind-incoming').hidden = false;
        renderAnswers('blind-invitation-answers', result.respostas);
      } else { inviteId = null; $('blind-incoming').hidden = true; }
      if (result?.situacao === 'novo') $('blind-deck-status').textContent = 'A busca foi pausada. Volte às perguntas e publique novamente.';
    } catch { $('blind-deck-status').textContent = 'Conexão instável. Tentando atualizar…'; }
  }
  async function respond(accept) {
    if (!inviteId || pending) return;
    pending = true;
    const id = inviteId;
    try {
      const result = await rpc(accept ? 'cegas_deck_aceitar' : 'cegas_deck_recusar', { p_convite: id });
      if (accept && result?.conversa_id) await openChat(result.conversa_id);
      else $('blind-deck-status').textContent = 'Convite recusado. Você pode continuar conhecendo outras pessoas.';
      inviteId = null;
      $('blind-incoming').hidden = true;
    } catch { setMessage('Não foi possível responder ao convite. Atualize a busca.'); }
    finally { pending = false; }
  }
  async function openChat(id) {
    conversation = id;
    revealedId = null;
    setStage('chat');
    stopPolling();
    setMessage('');
    await updateChat();
    startPolling(updateChat);
  }
  async function updateChat() {
    if (!active || stage !== 'chat' || !conversation) return;
    const id = conversation;
    try {
      const state = await rpc('cegas_estado', { p_conversa: id });
      if (id !== conversation || stage !== 'chat') return;
      chatActive = state?.ativa === true;
      $('blind-chat-input').disabled = !chatActive;
      $('blind-send').disabled = !chatActive || sending;
      $('blind-reveal').disabled = !chatActive || state?.eu_solicitei === true;
      $('blind-reveal').textContent = state?.eu_solicitei ? '✓ Revelação solicitada' : '👁 Solicitar revelação';
      $('blind-chat-status').textContent = !chatActive ? 'Conversa encerrada'
        : state.revelado ? '💜 Ambos aceitaram revelar os perfis'
          : state.eu_solicitei ? 'Aguardando a outra pessoa aceitar' : 'Anônima · sem fotos até os dois aceitarem';
      revealedId = state.revelado && state.parceiro_id ? state.parceiro_id : null;
      $('blind-profile').hidden = !revealedId;
      if (Array.isArray(state.respostas_parceiro)) renderAnswers('blind-other-answers', state.respostas_parceiro);
      const messages = await rpc('cegas_listar_mensagens', { p_conversa: id });
      if (id !== conversation || !Array.isArray(messages)) return;
      const target = $('blind-messages');
      const signature = JSON.stringify(messages);
      if (target.dataset.signature === signature) return;
      target.dataset.signature = signature;
      target.replaceChildren(...messages.map(message => {
        const bubble = text('article', '', message.minha ? 'chat-bubble mine' : 'chat-bubble');
        bubble.append(text('p', message.texto || '', 'message-text'));
        return bubble;
      }));
      target.scrollTop = target.scrollHeight;
    } catch { $('blind-chat-status').textContent = 'Falha temporária ao atualizar a conversa.'; }
  }
  async function send(event) {
    event.preventDefault();
    const input = $('blind-chat-input');
    const draft = input.value.trim();
    if (!draft || !chatActive || sending || !conversation) return;
    sending = true; $('blind-send').disabled = true;
    try {
      const success = await rpc('cegas_enviar', { p_conversa: conversation, p_conteudo: draft });
      if (success !== true) throw new Error('Envio não confirmado');
      if (input.value.trim() === draft) input.value = '';
      setMessage(''); await updateChat();
    } catch { setMessage('Mensagem não enviada. Seu texto foi preservado.'); }
    finally { sending = false; $('blind-send').disabled = !chatActive; }
  }
  async function chatAction(name, args = {}) {
    if (!conversation) return;
    try {
      await rpc(name, { p_conversa: conversation, ...args });
      if (['cegas_encerrar', 'cegas_bloquear', 'cegas_denunciar'].includes(name)) { await exit(); leaveView(); }
      else await updateChat();
    } catch { setMessage('Não foi possível concluir essa ação. Tente novamente.'); }
  }
  $('blind-continue').addEventListener('click', () => void publish());
  $('blind-answer').addEventListener('input', event => { answers[step] = event.target.value; });
  $('blind-skip').addEventListener('click', () => {
    const current = new Set(questionIndex);
    const next = QUESTIONS.findIndex((_, i) => i !== questionIndex[step] && !current.has(i) && i > questionIndex[step]);
    questionIndex[step] = next < 0 ? QUESTIONS.findIndex((_, i) => !current.has(i)) : next;
    answers[step] = ''; setMessage(''); showQuestion();
  });
  $('blind-review').addEventListener('click', () => {
    answers[step] = $('blind-answer').value;
    setMessage(answers.map((a, i) => `${i + 1}. ${QUESTIONS[questionIndex[i]]}\n${a || '(ainda não respondida)'}`).join('\n\n'));
  });
  $('blind-next').addEventListener('click', () => { if (candidate) seen.push(candidate); candidate = null; void nextCandidate(); });
  $('blind-invite').addEventListener('click', () => void invite());
  $('blind-accept').addEventListener('click', () => void respond(true));
  $('blind-decline').addEventListener('click', () => void respond(false));
  $('blind-pause').addEventListener('click', () => { void exit(); leaveView(); });
  $('blind-back').addEventListener('click', () => leaveView());
  $('blind-chat-form').addEventListener('submit', send);
  $('blind-reveal').addEventListener('click', () => void chatAction('cegas_revelar'));
  $('blind-end').addEventListener('click', () => { if (window.confirm('Encerrar esta conversa às cegas?')) void chatAction('cegas_encerrar'); });
  $('blind-block').addEventListener('click', () => { if (window.confirm('Bloquear esta pessoa e encerrar a conversa?')) void chatAction('cegas_bloquear'); });
  $('blind-report').addEventListener('click', () => {
    const reason = window.prompt('Motivo da denúncia (mínimo 5 caracteres):');
    if (reason?.trim().length >= 5) void chatAction('cegas_denunciar', { p_motivo: reason.trim() });
  });
  $('blind-profile').addEventListener('click', async () => {
    if (!revealedId) return;
    try {
      const rows = await api.authenticated(`/rest/v1/perfis_app?select=nome,cidade_atual&id=eq.${encodeURIComponent(revealedId)}&limit=1`);
      const person = Array.isArray(rows) ? rows[0] : null;
      window.alert(person ? `${person.nome || 'Pessoa'}\n${person.cidade_atual || 'Cidade não informada'}` : 'Perfil indisponível.');
    } catch { setMessage('Não foi possível abrir o perfil revelado.'); }
  });
  return { enter, exit };
}
