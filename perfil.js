import {
  formatBirthDateBR, formatHeightCm, maskBirthDateBR, parseAdultBirthDate,
  parseHeightCm, parseList, profilePhotos, normalizePhotoSlots, safePhotoUrl
} from './perfil-utils.mjs';
import { configureProfileOptions } from './perfil-opcoes.mjs';
import { configureCitySelectors } from './perfil-cidades.mjs';

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
function friendlyError(error, fallback = 'Não foi possível salvar. Tente novamente.') {
  const message = String(error?.message || '');
  if (/violates .* constraint|new row for relation|PGRST\d+/i.test(message)) {
    return 'Não foi possível salvar os dados. Recarregue a página e tente novamente.';
  }
  return message || fallback;
}

export async function initProfile({ authenticated, getToken, user, apiBase, publicKey }) {
  const form = byId('profile-form');
  const gallery = byId('profile-gallery');
  const fileInput = byId('photo-file');
  const photoHint = byId('photo-hint');
  const photoLabel = document.querySelector('.photo-upload-label');
  const submit = byId('profile-submit');
  const state = { exists: false, photos: normalizePhotoSlots(), savingPhotos: false };
  const options = configureProfileOptions(form);

  function photoStatus(message, error = false) {
    photoHint.textContent = message;
    photoHint.className = error ? 'portal-subtle error' : 'portal-subtle';
    status(message, error);
  }

  async function saveGallery(nextPhotos) {
    const slots = normalizePhotoSlots(nextPhotos);
    const principal = slots.find(Boolean) || null;
    const data = await authenticated(`/rest/v1/usuarios?id=eq.${encodeURIComponent(user.id)}&select=id,foto_url,fotos_perfil`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ foto_url: principal, fotos_perfil: slots })
    });
    if (!Array.isArray(data) || data.length !== 1) throw new Error('Não foi possível atualizar as fotos do perfil.');
    state.photos = slots;
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
    const principalIndex = state.photos.findIndex(Boolean);
    for (let i = 0; i < 6; i += 1) {
      const url = state.photos[i];
      const card = document.createElement('article');
      card.className = `photo-slot${i === principalIndex && url ? ' primary' : ''}`;
      if (url) {
        const photo = safePhotoUrl(url);
        if (photo) card.append(showImage(photo, `Foto ${i + 1} do seu perfil`));
        else {
          const unavailable = document.createElement('span');
          unavailable.className = 'photo-placeholder';
          unavailable.textContent = 'Foto cadastrada no aplicativo, sem prévia disponível aqui';
          card.append(unavailable);
        }
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
            photoStatus('Foto principal atualizada.');
          } catch { photoStatus('Não foi possível mudar a foto principal.', true); }
          finally { state.savingPhotos = false; renderGallery(); }
        }));
        actions.append(createButton('Remover', 'photo-small-button remove', async () => {
          if (state.savingPhotos || !window.confirm('Remover esta foto do seu perfil?')) return;
          state.savingPhotos = true;
          status('Removendo foto...');
          try {
            const next = [...state.photos];
            next[i] = null;
            await saveGallery(next);
            await deleteOldUpload(url).catch(() => {});
            photoStatus('Foto removida do perfil.');
          } catch { photoStatus('Não foi possível remover a foto.', true); }
          finally { state.savingPhotos = false; renderGallery(); }
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
    const photoCount = state.photos.filter(Boolean).length;
    const canUpload = photoCount < 6;
    fileInput.disabled = !canUpload || state.savingPhotos;
    photoLabel.setAttribute('aria-disabled', String(fileInput.disabled));
    if (!state.savingPhotos) {
      photoHint.className = 'portal-subtle';
      photoHint.textContent = photoCount === 6 ? 'Você já tem seis fotos. Remova uma para adicionar outra.' :
        !state.exists ? 'Escolha uma foto. Se seus dados estiverem completos, eles serão salvos antes do envio.' :
          `${photoCount} de 6 fotos. JPG, PNG ou WebP, até 5 MB cada.`;
    }
  }

  function fillProfile(profile) {
    options.prepareCustomChoices(profile);
    for (const key of TEXT_FIELDS) setField(form, key, profile[key]);
    setField(form, 'data_nascimento', formatBirthDateBR(profile.data_nascimento));
    setField(form, 'altura', formatHeightCm(profile.altura));
    setField(form, 'hobbies', Array.isArray(profile.hobbies) ? profile.hobbies.join(', ') : '');
    setField(form, 'idiomas', Array.isArray(profile.idiomas) ? profile.idiomas.join(', ') : '');
    options.hydrateSelections();
  }

  const birthInput = form.elements.namedItem('data_nascimento');
  birthInput.addEventListener('input', () => { birthInput.value = maskBirthDateBR(birthInput.value); });
  const heightInput = form.elements.namedItem('altura');
  heightInput.addEventListener('blur', () => {
    if (!heightInput.value.trim()) return;
    try { heightInput.value = formatHeightCm(parseHeightCm(heightInput.value)); }
    catch { /* A clear error is shown when the form is saved. */ }
  });

  async function saveProfileData() {
    const name = readText(form, 'nome', 80);
    if (!name || name.length < 2) throw new Error('Informe seu nome com pelo menos 2 caracteres.');
    const birth = parseAdultBirthDate(birthInput.value);
    const heightCm = parseHeightCm(heightInput.value);
    const payload = {
      id: user.id, nome: name, data_nascimento: birth, altura: heightCm,
      hobbies: parseList(form.elements.namedItem('hobbies').value, 70),
      idiomas: parseList(form.elements.namedItem('idiomas').value, 40)
    };
    for (const key of TEXT_FIELDS.filter(key => key !== 'nome')) {
      payload[key] = readText(form, key, key === 'mensagem_dia' ? 1000 : 120);
    }
    payload.religiao = options.religionValue();
    if (payload.objetivo_conexao === 'Prefiro não informar') payload.objetivo_conexao = null;
    const saved = await authenticated(`/rest/v1/usuarios?on_conflict=id&select=id`, {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(payload)
    });
    if (!Array.isArray(saved) || saved.length !== 1) throw new Error('Não foi possível confirmar a gravação.');
    state.exists = true;
    heightInput.value = formatHeightCm(heightCm);
    renderGallery();
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    status('Salvando alterações...');
    try {
      await saveProfileData();
      status('Mudanças salvas.');
    } catch (error) { status(friendlyError(error), true); }
    finally { submit.disabled = false; }
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.value = '';
    if (state.savingPhotos) return;
    const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    if (!extensions[file.type] || file.size <= 0 || file.size > 5 * 1024 * 1024) {
      return photoStatus('Use uma imagem JPG, PNG ou WebP com até 5 MB.', true);
    }
    if (state.photos.every(Boolean)) return photoStatus('A galeria já tem seis fotos.', true);
    state.savingPhotos = true;
    fileInput.disabled = true;
    photoStatus('Preparando foto...');
    let completion = '';
    let failed = false;
    try {
      if (!state.exists) {
        photoStatus('Salvando os dados do seu perfil antes de enviar a foto...');
        await saveProfileData();
      }
      const token = await getToken();
      if (!token) throw new Error('Sua sessão expirou. Entre novamente.');
      const objectName = `${user.id}/${crypto.randomUUID()}.${extensions[file.type]}`;
      photoStatus('Enviando foto. Aguarde um instante...');
      const response = await fetch(`${apiBase}/storage/v1/object/fotos/${objectName}`, {
        method: 'POST', body: file,
        headers: { apikey: publicKey, Authorization: `Bearer ${token}`, 'Content-Type': file.type },
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
      });
      if (!response.ok) {
        if (response.status === 401) throw new Error('Sua sessão expirou. Entre novamente.');
        if (response.status === 403) throw new Error('Seu acesso às fotos foi negado. Entre novamente e tente enviar a foto.');
        if (response.status === 413) throw new Error('A foto é muito grande. Escolha outra de até 5 MB.');
        throw new Error(`O envio não foi concluído (código ${response.status}). Tente novamente.`);
      }
      const url = `${apiBase}/storage/v1/object/public/fotos/${objectName}`;
      try {
        const next = [...state.photos];
        const emptySlot = next.findIndex(value => !value);
        if (emptySlot < 0) throw new Error('A galeria já tem seis fotos.');
        next[emptySlot] = url;
        await saveGallery(next);
      }
      catch (error) { await deleteOldUpload(url).catch(() => {}); throw error; }
      completion = 'Foto adicionada ao perfil.';
    } catch (error) {
      completion = friendlyError(error, 'Não foi possível enviar a foto. Verifique sua conexão.');
      failed = true;
    } finally {
      state.savingPhotos = false;
      renderGallery();
      photoStatus(completion || 'Não foi possível enviar a foto.', failed);
    }
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
    configureCitySelectors().catch(() => {});
    status(profile ? 'Seu perfil está pronto para edição.' : 'Complete seus dados para criar seu perfil.');
  } catch {
    byId('profile-panel').hidden = false;
    submit.disabled = true;
    fileInput.disabled = true;
    status('Não foi possível carregar seu perfil. Recarregue a página antes de editar os dados.', true);
  }
}
