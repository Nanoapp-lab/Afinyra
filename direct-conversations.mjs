// Mesmo chat privado 1:1 do Android, sem tabela ou permissao paralela no site.
// A caixa, a leitura e o envio passam pelas RPCs Premium do Supabase.
export function initDirectConversations({ $, api, rpc, make, getAccess, restriction, showView }) {
  let active = null;
  let timer = null;
  let fetching = null;
  let sending = false;
  let inboxRequest = 0;

  const feedback = (message, error = false, id = 'direct-feedback') => {
    const target = $(id);
    target.textContent = message;
    target.classList.toggle('error', error);
  };
  function setInputEnabled(enabled) {
    $('direct-input').disabled = !enabled;
    $('direct-send').disabled = !enabled || sending;
  }
  function close() {
    active = null;
    clearInterval(timer);
    timer = null;
    setInputEnabled(false);
  }
  async function loadMessages() {
    const chat = active;
    if (!chat || fetching === chat || !getAccess()) return;
    fetching = chat;
    try {
      const messages = await rpc('minhas_mensagens_diretas', { p_outro_id: chat.id });
      if (active !== chat) return;
      if (!Array.isArray(messages)) throw new Error('Resposta inválida');
      const target = $('direct-messages');
      const wasNearBottom = (target.scrollHeight || 0) - (target.scrollTop || 0) - (target.clientHeight || 0) < 150;
      const items = messages.map(message => {
        const mine = message.remetente_id === api.user.id;
        const bubble = make('article', mine ? 'chat-bubble mine' : 'chat-bubble');
        bubble.append(make('div', 'message-meta', mine ? 'Você' : chat.name));
        bubble.append(make('p', 'message-text', message.conteudo || ''));
        const date = new Date(message.created_at);
        if (Number.isFinite(date.getTime())) bubble.append(make('div', 'message-time', date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })));
        return bubble;
      });
      if (!items.length) items.push(make('p', 'chat-empty', 'Conversa ainda sem mensagens. Escreva uma saudação para começar.'));
      target.replaceChildren(...items);
      if (wasNearBottom) target.scrollTop = target.scrollHeight;
      $('direct-status').textContent = '👑 Premium · conversa privada';
      feedback('');
      setInputEnabled(true);
    } catch {
      if (active === chat) {
        $('direct-status').textContent = 'Conexão indisponível';
        feedback('Não foi possível carregar as mensagens privadas. Verifique seu plano e a conexão.', true);
        setInputEnabled(false);
      }
    } finally {
      if (fetching === chat) fetching = null;
    }
  }
  async function open(person) {
    if (!getAccess()) {
      feedback('Conversas privadas são exclusivas do Premium.', true, 'direct-inbox-feedback');
      return;
    }
    const id = String(person?.id || '').trim();
    if (!id || id === api.user.id) return;
    close();
    const chat = { id, name: String(person.nome || person.name || 'Pessoa no Afinzer'), origin: person.origin || 'conversas' };
    active = chat;
    $('direct-title').textContent = `Conversa com ${chat.name}`;
    $('direct-status').textContent = 'Verificando acesso…';
    $('direct-input').value = '';
    $('direct-messages').replaceChildren(make('p', 'chat-empty', 'Carregando mensagens privadas…'));
    feedback('');
    setInputEnabled(false);
    showView('direta');
    await loadMessages();
    if (active !== chat || $('direct-input').disabled) return;
    timer = setInterval(() => { if (!document.hidden) void loadMessages(); }, 5000);
    $('direct-input').focus();
  }
  async function send(event) {
    event.preventDefault();
    const chat = active;
    const input = $('direct-input');
    const draft = input.value.trim();
    if (!chat || !draft || !getAccess() || sending || input.disabled) return;
    sending = true;
    $('direct-send').disabled = true;
    try {
      await restriction();
      const id = await rpc('enviar_mensagem_direta', { p_destinatario_id: chat.id, p_conteudo: draft });
      if (!id) throw new Error('Envio não confirmado');
      if (active !== chat) return;
      if (input.value.trim() === draft) input.value = '';
      feedback('Mensagem enviada. A outra pessoa poderá responder pelo site ou aplicativo.');
      await loadMessages();
    } catch (error) {
      if (active === chat) feedback(/segundos|seconds|rajada/i.test(error?.message || '')
        ? 'Aguarde alguns segundos antes de enviar outra mensagem.'
        : 'Mensagem não enviada. Seu texto foi preservado para tentar novamente.', true);
    } finally {
      sending = false;
      $('direct-send').disabled = !active || $('direct-input').disabled;
    }
  }
  async function openInbox() {
    const request = ++inboxRequest;
    const target = $('direct-inbox-list');
    target.replaceChildren();
    if (!getAccess()) {
      $('direct-refresh').hidden = true;
      feedback('👑 Conversas privadas são exclusivas do Premium. No Free, você pode usar o Chat Global.', false, 'direct-inbox-feedback');
      return;
    }
    $('direct-refresh').hidden = false;
    feedback('Buscando suas conversas privadas…', false, 'direct-inbox-feedback');
    try {
      const inbox = await rpc('minha_caixa_entrada');
      if (request !== inboxRequest) return;
      if (inbox?.premium !== true || !Array.isArray(inbox.conversas)) throw new Error('Acesso indisponível');
      feedback(inbox.total_nao_lidas > 0 ? `💬 ${inbox.total_nao_lidas} mensagem(ns) não lida(s).` : 'Suas mensagens são compartilhadas com o aplicativo Android.', false, 'direct-inbox-feedback');
      if (!inbox.conversas.length) {
        target.append(make('p', 'direct-inbox-empty', 'Nenhuma conversa privada ainda. No Deck, toque em 💬 Conversar para chamar alguém.'));
        return;
      }
      for (const person of inbox.conversas) {
        if (!person.id) continue;
        const button = make('button', 'direct-contact');
        button.type = 'button';
        const detail = make('span', 'direct-contact-detail');
        detail.append(make('strong', null, person.nome || 'Pessoa no Afinzer'));
        if (person.ultima_mensagem) detail.append(make('small', null, person.ultima_mensagem));
        button.append(detail);
        if (Number(person.nao_lidas) > 0) button.append(make('span', 'direct-unread', String(person.nao_lidas)));
        button.addEventListener('click', () => void open({ id: person.id, nome: person.nome, origin: 'conversas' }));
        target.append(button);
      }
    } catch {
      if (request === inboxRequest) feedback('Não foi possível carregar sua caixa de mensagens agora.', true, 'direct-inbox-feedback');
    }
  }

  $('direct-back').addEventListener('click', () => showView(active?.origin || 'conversas'));
  $('direct-refresh').addEventListener('click', () => void openInbox());
  $('direct-form').addEventListener('submit', event => void send(event));
  $('direct-input').addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.repeat || event.keyCode === 229) return;
    event.preventDefault();
    if (!$('direct-input').disabled && !sending && $('direct-input').value.trim()) $('direct-form').requestSubmit();
  });

  return { open, close, openInbox, origin: () => active?.origin || 'conversas' };
}
