import assert from 'node:assert/strict';
import { CHAT_EMOJIS, insertChatEmoji } from './chat-emoji.mjs';

assert.ok(CHAT_EMOJIS.includes('🤝') && CHAT_EMOJIS.includes('❤️'));
const input = { value: 'Oi mundo', selectionStart: 3, selectionEnd: 8, maxLength: 1500, disabled: false, focus() {} };
assert.equal(insertChatEmoji(input, '😊'), true);
assert.equal(input.value, 'Oi 😊', 'Insere no cursor, substituindo a seleção');
input.selectionStart = input.value.length;
input.selectionEnd = input.value.length;
assert.equal(insertChatEmoji(input, '🤝'), true);
assert.equal(input.value, 'Oi 😊🤝');
input.maxLength = input.value.length;
assert.equal(insertChatEmoji(input, '💜'), false, 'Respeita o limite da mensagem');
input.disabled = true;
assert.equal(insertChatEmoji(input, '🌹'), false, 'Não altera campos bloqueados');
assert.equal(insertChatEmoji(input, '<script>'), false, 'Não aceita código arbitrário');
console.log('OK: emoji é inserido no cursor sem envio automático, com limites.');
