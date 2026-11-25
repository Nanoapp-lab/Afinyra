import {
  formatBirthDateBR, formatHeightCm, maskBirthDateBR, parseAdultBirthDate,
  parseHeightCm, parseList, profilePhotos, safePhotoUrl
} from './perfil-utils.mjs';

const PROFILE_COLUMNS = [
  'id', 'nome', 'data_nascimento', 'cidade_atual', 'cidade_natal', 'genero', 'buscando',
  'objetivo_conexao', 'altura', 'profissao', 'empresa', 'escolaridade', 'religiao',
  'filhos', 'fumante', 'bebida', 'hobbies', 'idiomas', 'mensagem_dia', 'foto_url', 'fotos_perfil'
].join(',');

const TEXT_FIELDS = [
  'nome', 'cidade_atual', 'cidade_natal', 'genero', 'buscando', 'objetivo_conexao',
  'profissao', 'empresa', 'escolaridade', 'religiao', 'filhos', 'fumante', 'bebida', 'mensagem_dia'
];

function byId(id) { return document.getElementById(id); }
function status(message, error = false) {
  const target = byId('profile-status');
  target.textContent = message;
  target.className = error ? 'portal-alert error portal-status' : 'portal-status';
}
function showImage(url, alt) {
  const image = document.createElement('img');
  image.src = url;
  image.alt = alt;
  image.loading = 'lazy';
  image.referrerPolicy = 'no-referrer';
  return image;
}
function createButton(label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}
function readText(form, name, maxLength = 120) {
  const text = String(form.elements.namedItem(name)?.value || '').trim().slice(0, maxLength);
  return text || null;
}
function setField(form, key, value) {
  const field = form.elements.namedItem(key);
  if (field) field.value = value == null ? '' : String(value);
}

export async function initProfile({ authenticated, getToken, user, apiBase, publicKey }) {
  const form = byId('profile-form');
  const gallery = byId('profile-gallery');
  const fileInput = byId('photo-file');
  const photoHint = byId('photo-hint');
  const submit = byId('profile-submit');
  const state = { exists: false, photos: [], savingPhotos: false };

  async function saveGallery(nextPhotos) {
    const safe = nextPhotos.filter(url => safePhotoUrl(url)).slice(0, 6);
    const data = await authenticated(`/rest/v1/usuarios?id=eq.${encodeURIComponent(user.id)}&select=id,foto_url,fotos_perfil`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ foto_url: safe[0] || null, fotos_perfil: safe })
    });
    if (!Array.isArray(data) || data.length !== 1) throw new Error('Não foi possível atualizar as fotos do perfil.');
    state.photos = safe;
    renderGallery();
  }

  async function deleteOldUpload(url) {
    const prefix = `${apiBase}/storage/v1/object/public/fotos/`;
    if (!url.startsWith(prefix)) return;
    const path = decodeURIComponent(url.slice(prefix.length));
    if (!path.startsWith(`${user.id}/`)) return;
    const token = await getToken();
    if (!token) return;
    await fetch(`${apiBase}/storage/v1/object/fotos`, {
      method: 'DELETE',
      headers: { apikey: publicKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [path] }), cache: 'no-store', credentials: 'omit'
    });
  }

  function renderGallery() {
    gallery.replaceChildren();
    for (let i = 0; i < 6; i += 1) {
      const url = state.photos[i];
      const card = document.createElement('article');
      card.className = `photo-slot${i === 0 && url ? ' primary' : ''}`;
      if (url) {
        card.append(showImage(url, `Foto ${i + 1} do seu perfil`));
        const actions = document.createElement('div');
        actions.className = 'photo-slot-actions';
        if (i > 0) actions.append(createButton('Principal', 'photo-small-button', async () => {
          if (state.savingPhotos) return;
          state.savingPhotos = true;
          status('Atualizando foto principal...');
          try {
            const next = [...state.photos];
            next.splice(i, 1);
            next.unshift(url);
            await saveGallery(next);
            status('Foto principal atualizada.');
          } catch { status('Não foi possível mudar a foto principal.', true); }
          finally { state.savingPhotos = false; }
        }));
        actions.append(createButton('Remover', 'photo-small-button remove', async () => {
          if (state.savingPhotos || !window.confirm('Remover esta foto do seu perfil?')) return;
          state.savingPhotos = true;
          status('Removendo foto...');
          try {
            await saveGallery(state.photos.filter((_, index) => index !== i));
            await deleteOldUpload(url).catch(() => {});
            status('Foto removida do perfil.');
          } catch { status('Não foi possível remover a foto.', true); }
          finally { state.savingPhotos = false; }
        }));
        card.append(actions);
      } else {
        const empty = document.createElement('span');
        empty.className = 'photo-placeholder';
        empty.textContent = i === 0 ? '★ Principal' : `Foto ${i + 1}`;
        card.append(empty);
      }
      gallery.append(card);
    }
    const canUpload = state.exists && state.photos.length < 6;
    fileInput.disabled = !canUpload || state.savingPhotos;
    photoHint.textContent = !state.exists ? 'Salve seus dados antes de adicionar fotos.' :
      state.photos.length === 6 ? 'Você já tem seis fotos. Remova uma para adicionar outra.' :
      `${state.photos.length} de 6 fotos. JPG, PNG ou WebP, até 5 MB cada.`;
  }

  function fillProfile(profile) {
    for (const key of TEXT_FIELDS) setField(form, key, profile[key]);
    setField(form, 'data_nascimento', formatBirthDateBR(profile.data_nascimento));
    setField(form, 'altura', formatHeightCm(profile.altura));
    setField(form, 'hobbies', Array.isArray(profile.hobbies) ? profile.hobbies.join(', ') : '');
    setField(form, 'idiomas', Array.isArray(profile.idiomas) ? profile.idiomas.join(', ') : '');
  }

  const birthInput = form.elements.namedItem('data_nascimento');
  birthInput.addEventListener('input', () => { birthInput.value = maskBirthDateBR(birthInput.value); });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    status('Salvando alterações...');
    try {
      const name = readText(form, 'nome', 80);
      if (!name || name.length < 2) throw new Error('Informe seu nome com pelo menos 2 caracteres.');
      const birth = parseAdultBirthDate(birthInput.value);
      const payload = { id: user.id, nome: name, data_nascimento: birth,
        altura: parseHeightCm(form.elements.namedItem('altura').value),
        hobbies: parseList(form.elements.namedItem('hobbies').value),
        idiomas: parseList(form.elements.namedItem('idiomas').value) };
      for (const key of TEXT_FIELDS.filter(key => key !== 'nome')) {
        payload[key] = readText(form, key, key === 'mensagem_dia' ? 1000 : 120);
      }
      const saved = await authenticated(`/rest/v1/usuarios?on_conflict=id&select=id`, {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(payload)
      });
      if (!Array.isArray(saved) || saved.length !== 1) throw new Error('Não foi possível confirmar a gravação.');
      state.exists = true;
      renderGallery();
      status('Alterações salvas.');
    } catch (error) { status(error.message || 'Não foi possível salvar. Tente novamente.', true); }
    finally { submit.disabled = false; }
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.value = '';
    if (state.savingPhotos) return;
    const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    if (!extensions[file.type] || file.size <= 0 || file.size > 5 * 1024 * 1024) {
      return status('Use uma imagem JPG, PNG ou WebP com até 5 MB.', true);
    }
    if (!state.exists || state.photos.length >= 6) return;
    state.savingPhotos = true;
    fileInput.disabled = true;
    status('Enviando foto...');
    try {
      const token = await getToken();
      if (!token) throw new Error('Sua sessão expirou. Entre novamente.');
      const objectName = `${user.id}/${crypto.randomUUID()}.${extensions[file.type]}`;
      const response = await fetch(`${apiBase}/storage/v1/object/fotos/${objectName}`, {
        method: 'POST', body: file,
        headers: { apikey: publicKey, Authorization: `Bearer ${token}`, 'Content-Type': file.type },
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
      });
      if (!response.ok) throw new Error('Falha ao enviar a imagem.');
      const url = `${apiBase}/storage/v1/object/public/fotos/${objectName}`;
      try { await saveGallery([...state.photos, url]); }
      catch (error) { await deleteOldUpload(url).catch(() => {}); throw error; }
      status('Foto adicionada ao perfil.');
    } catch (error) { status(error.message || 'Não foi possível enviar a foto.', true); }
    finally { state.savingPhotos = false; renderGallery(); }
  });

  try {
    const rows = await authenticated(`/rest/v1/usuarios?select=${PROFILE_COLUMNS}&id=eq.${encodeURIComponent(user.id)}&limit=1`);
    const profile = Array.isArray(rows) ? rows[0] : null;
    state.exists = Boolean(profile);
    state.photos = profilePhotos(profile);
    fillProfile(profile || {
      nome: user.user_metadata?.nome || '',
      data_nascimento: user.user_metadata?.data_nascimento || ''
    });
    byId('profile-panel').hidden = false;
    renderGallery();
    status(profile ? 'Seu perfil está pronto para edição.' : 'Complete seus dados para criar seu perfil.');
  } catch {
    byId('profile-panel').hidden = false;
    submit.disabled = true;
    fileInput.disabled = true;
    status('Não foi possível carregar seu perfil. Recarregue a página antes de editar os dados.', true);
  }
}
