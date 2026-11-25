import { maskBirthDateBR, parseAdultBirthDate } from './perfil-utils.mjs';

// The key is Supabase's browser-publishable key, protected by backend RLS and Auth rules.
const API_BASE = 'https://bzjwgvnyfunlwxfzbbbc.supabase.co';
const PUBLIC_KEY = 'sb_publishable_RX499hxGk3MI_WRF33POng_HcbiCl1O';
const SESSION_KEY = 'vibeorbit_portal_session_v1';
const byId = id => document.getElementById(id);

function showStatus(message, error = false) {
  const status = byId('portal-message');
  status.textContent = message;
  status.className = error ? 'portal-alert error portal-status' : 'portal-status';
}

const form = byId('signup-form');
const birth = byId('signup-birth');
birth.addEventListener('input', () => { birth.value = maskBirthDateBR(birth.value); });

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = byId('signup-submit');
  if (button.disabled) return;
  button.disabled = true;
  try {
    const name = byId('signup-name').value.trim();
    const email = byId('signup-email').value.trim().toLowerCase();
    const password = byId('signup-password').value;
    const repeated = byId('signup-password-repeat').value;
    const birthISO = parseAdultBirthDate(birth.value);
    if (name.length < 2 || name.length > 80) throw new Error('Informe um nome entre 2 e 80 caracteres.');
    if (password.length < 8) throw new Error('A senha deve ter pelo menos 8 caracteres.');
    if (password !== repeated) throw new Error('As senhas digitadas não são iguais.');
    if (!byId('signup-consent').checked) throw new Error('É necessário aceitar as diretrizes da comunidade.');

    showStatus('Criando sua conta...');
    const response = await fetch(`${API_BASE}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: PUBLIC_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password, data: { nome: name, data_nascimento: birthISO } }),
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 429) throw new Error('Muitas tentativas. Aguarde um pouco e tente novamente.');
      if (response.status === 422 && /password/i.test(data.msg || data.message || '')) {
        throw new Error('Escolha uma senha mais forte.');
      }
      throw new Error('Não foi possível concluir o cadastro. Confira seus dados e tente novamente.');
    }
    byId('signup-password').value = '';
    byId('signup-password-repeat').value = '';
    if (data.access_token && data.refresh_token) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600)
      }));
      location.replace('conta.html');
      return;
    }
    showStatus('Cadastro solicitado. Se você receber um e-mail de confirmação, abra o link antes de entrar. Depois, acesse a página de login para completar seu perfil.');
  } catch (error) {
    showStatus(error.message || 'Não foi possível criar sua conta.', true);
  } finally { button.disabled = false; }
});
