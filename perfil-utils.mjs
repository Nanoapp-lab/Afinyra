const MIN_BIRTH_YEAR = 1900;

export function todayInSaoPaulo(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function formatBirthDateBR(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

export function maskBirthDateBR(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function parseAdultBirthDate(value, todayISO = todayInSaoPaulo()) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value || '').trim());
  if (!match) throw new Error('Informe a data completa no formato DD/MM/AAAA.');
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('A data de nascimento não é válida.');
  }
  if (year < MIN_BIRTH_YEAR) throw new Error('Confira o ano de nascimento informado.');
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const birthLimit = `${Number(todayISO.slice(0, 4)) - 18}${todayISO.slice(4)}`;
  if (iso > birthLimit) throw new Error('O Afinzer é exclusivo para maiores de 18 anos.');
  return iso;
}

export function parseHeightCm(value) {
  const raw = String(value || '').trim().replace(',', '.');
  if (!raw) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error('Informe a altura como 1,75 ou 175.');
  const number = Number(raw);
  const cm = number < 3 ? Math.round(number * 100) : Math.round(number);
  if (cm < 80 || cm > 250) throw new Error('Informe uma altura entre 0,80 m e 2,50 m.');
  return cm;
}

export function formatHeightCm(value) {
  return Number.isInteger(value) && value >= 80 && value <= 250
    ? (value / 100).toFixed(2).replace('.', ',') : '';
}

export function parseList(value, maxItems = 20) {
  const unique = new Set();
  for (const part of String(value || '').split(/[,;\n]/)) {
    const item = part.trim().slice(0, 60);
    if (item) unique.add(item);
    if (unique.size >= maxItems) break;
  }
  return [...unique];
}

export function safePhotoUrl(value, projectHost = 'bzjwgvnyfunlwxfzbbbc.supabase.co') {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === projectHost) return url.href;
  } catch { /* Invalid or unavailable photo URL. */ }
  return null;
}

// The Android app stores exactly six positions (including nulls), not a compact gallery.
export function normalizePhotoSlots(values) {
  return Array.from({ length: 6 }, (_, index) => {
    const value = Array.isArray(values) ? values[index] : null;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  });
}

export function profilePhotos(profile) {
  const slots = normalizePhotoSlots(profile?.fotos_perfil);
  // Support older records where the principal photo was stored without a gallery.
  if (!slots.some(Boolean) && typeof profile?.foto_url === 'string' && profile.foto_url.trim()) {
    slots[0] = profile.foto_url.trim();
  }
  return slots;
}
