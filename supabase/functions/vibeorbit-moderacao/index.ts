// Edge Function: privileged moderation of Supabase Auth accounts.
// Requires a signed-in user with membership in private.moderacao_administradores.
// The service key lives only in the Supabase function environment, never in the site.

const URL = Deno.env.get('SUPABASE_URL') || '';
function defaultKey(variable: string) {
  try {
    const keys = JSON.parse(Deno.env.get(variable) || '{}');
    return typeof keys.default === 'string' ? keys.default : '';
  } catch { return ''; }
}
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || defaultKey('SUPABASE_SECRET_KEYS');
const PUBLIC_KEY = Deno.env.get('SUPABASE_ANON_KEY') || defaultKey('SUPABASE_PUBLISHABLE_KEYS');
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function result(status: number, data: Record<string, unknown>) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
async function userRequest(path: string, token: string, options: RequestInit = {}) {
  return fetch(`${URL}${path}`, {
    ...options,
    headers: {
      apikey: PUBLIC_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}
async function adminAuthBan(userId: string, duration: string) {
  const response = await fetch(`${URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ban_duration: duration }),
  });
  if (!response.ok) throw new Error(`Supabase Auth (${response.status})`);
}
async function previousAuthBanDuration(userId: string) {
  const response = await fetch(`${URL}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!response.ok) throw new Error(`Falha ao conferir a conta no Auth (${response.status})`);
  const user = await response.json();
  const minutes = Math.ceil((Date.parse(user.banned_until || '') - Date.now()) / 60000);
  return Number.isFinite(minutes) && minutes > 0 ? `${minutes}m` : 'none';
}
type Restriction = {
  usuario_id: string;
  ativa: boolean;
  tipo: 'suspensao' | 'banimento';
  termina_em: string | null;
};
function durationBefore(previous: Restriction | undefined) {
  if (!previous?.ativa) return 'none';
  if (previous.tipo === 'banimento') return '876000h';
  const minutes = Math.ceil((Date.parse(previous.termina_em || '') - Date.now()) / 60000);
  return Number.isFinite(minutes) && minutes > 0 ? `${minutes}m` : 'none';
}
async function readRestriction(token: string, userId: string): Promise<Restriction | undefined> {
  const response = await userRequest(`/rest/v1/moderacao_restricoes?usuario_id=eq.${userId}&select=usuario_id,ativa,tipo,termina_em&limit=1`, token);
  if (!response.ok) throw new Error('Não foi possível conferir a medida existente');
  const rows = await response.json();
  return rows[0];
}
async function runRpc(token: string, functionName: string, payload: Record<string, unknown>) {
  const response = await userRequest(`/rest/v1/rpc/${functionName}`, token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.message === 'string' ? body.message : 'Banco recusou a medida');
  }
  return await response.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return result(405, { error: 'Método não permitido' });
  if (!URL || !SERVICE_KEY || !PUBLIC_KEY) return result(503, { error: 'Configuração do servidor incompleta' });
  const header = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(header)) return result(401, { error: 'Autenticação obrigatória' });
  const token = header.replace(/^Bearer\s+/i, '');
  try {
    const auth = await userRequest('/auth/v1/user', token);
    if (!auth.ok) return result(401, { error: 'Sessão inválida ou expirada' });
    const user = await auth.json();
    if (!validUuid(user.id)) return result(403, { error: 'Sessão inválida' });
    const adminResponse = await runRpc(token, 'moderacao_eh_admin', {});
    if (!adminResponse) return result(403, { error: 'Acesso administrativo negado' });

    const input = await req.json().catch(() => null);
    if (!input || typeof input !== 'object') return result(400, { error: 'Requisição inválida' });
    const { action, usuario_id: target, origem, denuncia_id: caseId, medida, motivo, horas } = input;
    if (!validUuid(target) || target === user.id) return result(400, { error: 'Usuário inválido' });
    const reason = typeof motivo === 'string' ? motivo.trim() : '';
    if (reason.length < 5 || reason.length > 1000) return result(400, { error: 'Justificativa: 5 a 1.000 caracteres' });

    if (action === 'aplicar') {
      if (!validUuid(caseId) || !['geral','cegas'].includes(origem)) return result(400, { error: 'Denúncia inválida' });
      const targetValid = await runRpc(token, 'moderacao_validar_alvo', {
        p_origem: origem, p_denuncia: caseId, p_usuario: target,
      });
      if (!targetValid) return result(403, { error: 'Usuário não pertence à denúncia ou está protegido' });
      let duration = 'none';
      if (medida === 'suspensao' && [24,168,720].includes(horas)) duration = 'none';
      else if (medida === 'banimento' && (horas === null || horas === undefined)) duration = '876000h';
      else if (medida !== 'advertencia' || (horas !== null && horas !== undefined)) return result(400, { error: 'Medida inválida' });

      // Suspensao: a pessoa deve conseguir entrar e ler, enquanto os gatilhos
      // do Postgres bloqueiam escrita e participacao. Apenas banimento bloqueia Auth.
      const oldDuration = medida === 'banimento' ? await previousAuthBanDuration(target) : 'none';
      if (medida === 'banimento') await adminAuthBan(target, duration);
      let saved: Record<string, unknown>;
      try {
        saved = await runRpc(token, 'moderacao_aplicar_medida', {
          p_origem: origem, p_denuncia: caseId, p_usuario: target,
          p_acao: medida, p_motivo: reason, p_horas: medida === 'suspensao' ? horas : null,
        });
      } catch (error) {
        if (medida === 'banimento') {
          try { await adminAuthBan(target, oldDuration); }
          catch (rollbackError) { console.error('Falha ao reverter bloqueio no Auth', rollbackError); }
        }
        console.error('Falha ao salvar medida no banco', error);
        return result(409, { error: 'A medida não foi concluída. Atualize o painel e confira o estado da conta.' });
      }
      if (medida === 'suspensao') {
        // Somente depois da restricao no banco estar ativa o login e liberado.
        try { await adminAuthBan(target, 'none'); }
        catch (error) {
          console.error('Suspensao salva, mas login ainda bloqueado no Auth', error);
          return result(502, { error: 'Suspensão salva, mas a liberação do login falhou. Confira a conta no Supabase Auth.' });
        }
      }
      return result(200, saved);
    }

    if (action === 'reverter') {
      const previous = await readRestriction(token, target);
      if (!previous?.ativa || durationBefore(previous) === 'none') return result(409, { error: 'Conta sem restrição ativa' });
      const oldDuration = await previousAuthBanDuration(target);
      await adminAuthBan(target, 'none');
      try {
        const saved = await runRpc(token, 'moderacao_reverter_medida', {
          p_usuario: target, p_motivo: reason,
        });
        return result(200, saved);
      } catch (error) {
        try { await adminAuthBan(target, oldDuration); }
        catch (rollbackError) { console.error('Falha ao restaurar bloqueio no Auth', rollbackError); }
        console.error('Falha ao reverter medida no banco', error);
        return result(409, { error: 'A reversão não foi concluída. Atualize o painel.' });
      }
    }
    return result(400, { error: 'Ação desconhecida' });
  } catch (error) {
    console.error('Falha em operação administrativa', error);
    return result(502, { error: 'Não foi possível concluir a operação. Nenhuma confirmação de punição foi recebida.' });
  }
});
