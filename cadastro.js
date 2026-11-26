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

let betaOpen = null;
async function refreshBetaAvailability() {
  try {
    const response = await fetch(`${API_BASE}/rest/v1/rpc/afinzer_beta_status`, {
      headers: { apikey: PUBLIC_KEY, Accept: 'application/json' },
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
    });
    if (!response.ok) throw new Error('Status indisponível');
    const info = await response.json();
    const total = Number(info.total);
    const limit = Number(info.limite);
    if (!Number.isFinite(total) || !Number.isFinite(limit) || limit < 1) throw new Error('Status inválido');
    betaOpen = info.aberto === true;
    byId('beta-vagas-numeros').textContent = `${total} de ${limit} contas`;
    byId('beta-vagas-progresso').style.width = `${Math.min(100, (total / limit) * 100)}%`;
    byId('beta-vagas-informacao').textContent = betaOpen
      ? `Restam ${Math.max(0, limit - total)} vagas. Inscrições por ordem de chegada, sem pagamento.`
      : 'Vagas preenchidas. Quem já tem conta pode entrar normalmente. Aguarde a próxima abertura.';
    byId('signup-submit').disabled = !betaOpen;
    byId('signup-submit').textContent = betaOpen ? 'Participar do Beta gratuitamente' : 'Inscrições temporariamente encerradas';
  } catch {
    betaOpen = null;
    byId('beta-vagas-numeros').textContent = 'Vagas em atualização';
    byId('beta-vagas-informacao').textContent = 'O limite é confirmado no momento do cadastro. Nenhum pagamento é necessário.';
  }
}
refreshBetaAvailability();

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = byId('signup-submit');
  if (button.disabled) return;
  button.disabled = true;
  try {
    if (betaOpen === false) throw new Error('As vagas do Beta estão preenchidas. Aguarde a próxima fase.');
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
      await refreshBetaAvailability();
      if (betaOpen === false) throw new Error('As vagas do Beta Afinzer foram preenchidas. Aguarde a próxima fase.');
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
      location.replace('app.html');
      return;
    }
    showStatus('Cadastro solicitado. Se você receber um e-mail de confirmação, abra o link antes de entrar. Depois, acesse a página de login para completar seu perfil.');
  } catch (error) {
    showStatus(error.message || 'Não foi possível criar sua conta.', true);
  } finally { button.disabled = betaOpen === false; }
});
