// Paleta de emojis acessivel nos chats; envia Unicode puro pelas RPCs existentes.
export const CHAT_EMOJIS = ['😀', '😁', '😂', '🥰', '😍', '😘', '😊', '😉', '😎', '🥹', '😢', '😮', '😡', '🤔', '🤗', '😴', '❤️', '💕', '💜', '💛', '💚', '💙', '💔', '✨', '🎉', '🌹', '🌻', '🔥', '👏', '🙌', '👍', '👎', '🤝', '🙏', '💬', '☕', '🎵', '📸', '🌎', '🐱'];

export function insertChatEmoji(input, emoji) {
  if (!input || input.disabled || !CHAT_EMOJIS.includes(emoji)) return false;
  const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
  const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
  if (input.value.length - (end - start) + emoji.length > Number(input.maxLength || 1500)) return false;
  if (typeof input.setRangeText === 'function') input.setRangeText(emoji, start, end, 'end');
  else input.value = `${input.value.slice(0, start)}${emoji}${input.value.slice(end)}`;
  input.dispatchEvent?.(new Event('input', { bubbles: true }));
  input.focus();
  return true;
}

export function initChatEmojis($, make) {
  const pairs = [['chat-emoji', 'chat-emoji-picker', 'chat-input'],
    ['direct-emoji', 'direct-emoji-picker', 'direct-input'],
    ['blind-emoji', 'blind-emoji-picker', 'blind-chat-input']];
  for (const [buttonId, pickerId, inputId] of pairs) {
    const button = $(buttonId);
    const picker = $(pickerId);
    picker.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    for (const emoji of CHAT_EMOJIS) {
      const choice = make('button', 'emoji-choice', emoji);
      choice.type = 'button';
      choice.title = `Inserir ${emoji}`;
      choice.setAttribute('aria-label', `Inserir emoji ${emoji}`);
      choice.addEventListener('click', () => {
        if (insertChatEmoji($(inputId), emoji)) {
          picker.hidden = true;
          button.setAttribute('aria-expanded', 'false');
        }
      });
      picker.append(choice);
    }
    button.addEventListener('click', () => {
      if ($(inputId).disabled) return;
      const next = picker.hidden;
      for (const [otherButton, otherPicker] of pairs) {
        $(otherPicker).hidden = true;
        $(otherButton).setAttribute('aria-expanded', 'false');
      }
      picker.hidden = !next;
      button.setAttribute('aria-expanded', String(next));
    });
  }
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    for (const [buttonId, pickerId] of pairs) {
      $(pickerId).hidden = true;
      $(buttonId).setAttribute('aria-expanded', 'false');
    }
  });
}
