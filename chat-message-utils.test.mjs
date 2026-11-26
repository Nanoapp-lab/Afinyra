import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatChatDateTime } from './chat-message-utils.mjs';

const localDate = new Date(2026, 10, 25, 23, 7).toISOString();
assert.equal(formatChatDateTime(localDate), '25/11/2026 · 23:07');
assert.equal(formatChatDateTime('inválida'), '', 'Data inválida não aparece');
assert.equal(formatChatDateTime(null), '', 'Mensagem antiga sem data não quebra');

const html = readFileSync(new URL('./app.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('./app.css', import.meta.url), 'utf8');
assert.match(html, /id="chat-messages" class="chat-messages linear-chat uol-chat"/, 'Chat Global recebe lista contínua no estilo bate-papo');
assert.match(html, /id="direct-messages" class="chat-messages linear-chat"/, 'Privado recebe o mesmo layout');
assert.match(css, /\.linear-chat \.chat-bubble,.linear-chat \.chat-bubble.mine\{[^}]*width:100%/, 'Todas as mensagens usam uma única coluna');
assert.match(html, /id="chat-font"/, 'O usuário pode escolher a fonte');
assert.match(html, /id="chat-font-size"/, 'O usuário pode escolher o tamanho');
assert.match(html, /id="chat-bold"/, 'O usuário pode colocar negrito');
assert.match(html, /id="chat-italic"/, 'O usuário pode colocar itálico');
assert.match(css, /\.uol-chat \.message-heading/, 'Horário e nome são exibidos em linha com o texto');
console.log('OK: chats em lista contínua com nome, data e hora alinhados.');
