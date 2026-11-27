-- AFINZER V28 — instalar SOMENTE após backup e aprovação do proprietário.
-- NÃO executado automaticamente. Não lê nem expõe denunciante_id.
-- O conteúdo mostrado ao denunciado é redigido exclusivamente pela moderação.
-- Conferir esquema/roles/policies em produção antes da aplicação.

begin;

alter table public.denuncias
  add column if not exists motivo_publico text,
  add column if not exists justificativa_publica text;

alter table public.cegas_denuncias
  add column if not exists motivo_publico text,
  add column if not exists justificativa_publica text;

create table if not exists public.moderacao_avisos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  origem text not null check (origem in ('geral', 'cegas')),
  denuncia_id uuid not null,
  tipo text not null check (tipo in ('decisao','advertencia','suspensao','banimento','reversao')),
  medida text not null,
  motivo_publico text not null check (char_length(motivo_publico) between 5 and 200),
  justificativa_publica text not null check (char_length(justificativa_publica) between 5 and 1000),
  termina_em timestamptz,
  acao_id bigint unique references public.moderacao_acoes(id) on delete set null,
  criado_em timestamptz not null default now(),
  lido_em timestamptz
);

create index if not exists moderacao_avisos_usuario_data_idx
  on public.moderacao_avisos(usuario_id, criado_em desc);

-- Evita disparar novamente a mesma conclusão, inclusive após recarregar painel.
create unique index if not exists moderacao_avisos_decisao_unica_idx
  on public.moderacao_avisos(origem, denuncia_id, medida)
  where tipo = 'decisao';

alter table public.moderacao_avisos enable row level security;
revoke all on table public.moderacao_avisos from public, anon, authenticated;
grant select on table public.moderacao_avisos to authenticated;
grant update(lido_em) on table public.moderacao_avisos to authenticated;

drop policy if exists moderacao_avisos_leitura_propria on public.moderacao_avisos;
create policy moderacao_avisos_leitura_propria
  on public.moderacao_avisos for select to authenticated
  using (usuario_id = (select auth.uid()));

drop policy if exists moderacao_avisos_marcar_lido on public.moderacao_avisos;
create policy moderacao_avisos_marcar_lido
  on public.moderacao_avisos for update to authenticated
  using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()));

-- A mudança de status final deve informar motivo e explicação públicos,
-- separados da nota_moderacao. Uma atualização interna não gera mensagem.
create or replace function private.afinzer_avisar_decisao()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_usuario uuid;
  v_origem text;
  v_motivo text := btrim(coalesce(new.motivo_publico, ''));
  v_justificativa text := btrim(coalesce(new.justificativa_publica, ''));
begin
  if new.status not in ('resolvida','descartada') then
    return new;
  end if;
  -- Permite notificar denúncias que já estavam resolvidas ANTES da V28:
  -- o primeiro preenchimento da justificativa pública gera o aviso.
  -- Depois, regravar a mesma decisão não reenvia o comunicado.
  if new.status is not distinct from old.status and
     nullif(btrim(coalesce(old.justificativa_publica, '')), '') is not null then
    return new;
  end if;
  if char_length(v_motivo) not between 5 and 200 or
     char_length(v_justificativa) not between 5 and 1000 then
    raise exception 'Para encerrar a denúncia, preencha motivo e justificativa públicos'
      using errcode = '22023';
  end if;
  if TG_TABLE_NAME = 'denuncias' then
    v_origem := 'geral';
    v_usuario := new.denunciado_id;
  else
    v_origem := 'cegas';
    v_usuario := new.denunciado;
  end if;
  insert into public.moderacao_avisos
    (usuario_id,origem,denuncia_id,tipo,medida,motivo_publico,justificativa_publica)
  values
    (v_usuario,v_origem,new.id,'decisao',
     case when new.status = 'resolvida' then 'Análise concluída'
          else 'Denúncia arquivada sem medida' end,
     v_motivo,v_justificativa)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists afinzer_avisar_decisao_geral on public.denuncias;
create trigger afinzer_avisar_decisao_geral
  after update of status on public.denuncias
  for each row execute function private.afinzer_avisar_decisao();

drop trigger if exists afinzer_avisar_decisao_cegas on public.cegas_denuncias;
create trigger afinzer_avisar_decisao_cegas
  after update of status on public.cegas_denuncias
  for each row execute function private.afinzer_avisar_decisao();

-- As medidas já são gravadas pela RPC privilegiada moderacao_aplicar_medida.
-- Um aviso nasce na MESMA transação da gravação da medida.
-- Motivo público = campo moderado; nunca copia o relato privado do denunciante.
create or replace function private.afinzer_avisar_medida()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_motivo text;
  v_medida text;
begin
  if new.origem = 'geral' then
    select motivo_publico into v_motivo
      from public.denuncias
     where id = new.denuncia_id and denunciado_id = new.usuario_id;
  elsif new.origem = 'cegas' then
    select motivo_publico into v_motivo
      from public.cegas_denuncias
     where id = new.denuncia_id and denunciado = new.usuario_id;
  else
    raise exception 'Origem de moderação inválida' using errcode='22023';
  end if;
  if new.acao <> 'reversao' and char_length(btrim(coalesce(v_motivo, ''))) not between 5 and 200 then
    raise exception 'Informe o motivo público antes de aplicar a medida'
      using errcode='22023';
  end if;
  v_motivo := coalesce(nullif(btrim(v_motivo),''), 'Reavaliação de medida administrativa');
  v_medida := case new.acao
    when 'advertencia' then 'Advertência'
    when 'suspensao' then 'Suspensão temporária'
    when 'banimento' then 'Banimento por tempo indeterminado'
    when 'reversao' then 'Restrição cancelada'
  end;
  if v_medida is null then raise exception 'Tipo de medida inválido'; end if;
  insert into public.moderacao_avisos
    (usuario_id,origem,denuncia_id,tipo,medida,motivo_publico,
     justificativa_publica,termina_em,acao_id)
  values
    (new.usuario_id,new.origem,new.denuncia_id,new.acao,v_medida,v_motivo,
     btrim(coalesce(new.motivo,'')),new.termina_em,new.id)
  on conflict (acao_id) do nothing;
  return new;
end;
$$;

drop trigger if exists afinzer_avisar_medida on public.moderacao_acoes;
create trigger afinzer_avisar_medida
  after insert on public.moderacao_acoes
  for each row execute function private.afinzer_avisar_medida();

commit;

-- TESTES APÓS MIGRAÇÃO, SOMENTE LEITURA:
-- select * from pg_policies where schemaname='public' and tablename='moderacao_avisos';
-- select count(*) from public.moderacao_avisos;
-- Verificar com duas contas distintas: SELECT da outra conta deve retornar zero;
-- usuário comum não consegue criar/alterar justificativa, apenas marcar lido_em.
-- Testar advertência/suspensão/banimento/reversão com contas de teste.
-- NUNCA executar punição real para testar.
