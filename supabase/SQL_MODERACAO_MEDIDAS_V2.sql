-- VibeOrbit: medidas administrativas, histórico e bloqueio de novas ações.
-- Acesso de escrita exclusivo a RPCs que verificam private.moderacao_administradores.
-- Não apaga contas, publicações ou denúncias existentes.

create table if not exists public.moderacao_restricoes (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('suspensao', 'banimento')),
  motivo text not null check (char_length(btrim(motivo)) between 5 and 1000),
  origem text not null check (origem in ('geral', 'cegas')),
  denuncia_id uuid not null,
  termina_em timestamptz,
  ativa boolean not null default true,
  moderador_id uuid not null references auth.users(id),
  atualizada_em timestamptz not null default now(),
  constraint moderacao_duracao_valida check
    ((tipo = 'suspensao' and termina_em is not null)
     or (tipo = 'banimento' and termina_em is null))
);

create index if not exists moderacao_restricoes_prazo_idx
  on public.moderacao_restricoes(termina_em) where ativa and tipo = 'suspensao';

create table if not exists public.moderacao_acoes (
  id bigint generated always as identity primary key,
  usuario_id uuid not null,
  origem text not null check (origem in ('geral','cegas')),
  denuncia_id uuid not null,
  acao text not null check (acao in ('advertencia','suspensao','banimento','reversao')),
  motivo text not null check (char_length(btrim(motivo)) between 5 and 1000),
  termina_em timestamptz,
  moderador_id uuid not null,
  criado_em timestamptz not null default now()
);

create index if not exists moderacao_acoes_usuario_data_idx
  on public.moderacao_acoes(usuario_id, criado_em desc);

alter table public.moderacao_restricoes enable row level security;
alter table public.moderacao_acoes enable row level security;
revoke all on public.moderacao_restricoes from public, anon, authenticated;
revoke all on public.moderacao_acoes from public, anon, authenticated;
grant select on public.moderacao_restricoes, public.moderacao_acoes to authenticated;

drop policy if exists moderacao_restricoes_admin_select on public.moderacao_restricoes;
create policy moderacao_restricoes_admin_select on public.moderacao_restricoes
  for select to authenticated using ((select public.moderacao_eh_admin()));
drop policy if exists moderacao_acoes_admin_select on public.moderacao_acoes;
create policy moderacao_acoes_admin_select on public.moderacao_acoes
  for select to authenticated using ((select public.moderacao_eh_admin()));

create or replace function private.moderacao_conta_restrita(p_usuario uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.moderacao_restricoes r
    where r.usuario_id = p_usuario and r.ativa
      and (r.tipo = 'banimento' or r.termina_em > now())
  );
$$;
revoke all on function private.moderacao_conta_restrita(uuid) from public, anon, authenticated;

-- Uma conta punida não pode publicar ou alterar conteúdo por REST ou RPC.
-- A denúncia continua acessível, para não retirar os canais de segurança.
create or replace function private.moderacao_rejeitar_acao()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null
     and private.moderacao_conta_restrita((select auth.uid())) then
    raise exception 'Conta suspensa ou banida. Entre em contato com o suporte.'
      using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.moderacao_rejeitar_acao() from public, anon, authenticated;

do $$
declare tabela text;
begin
  foreach tabela in array array[
    'usuarios','mensagens','mensagens_diretas','cegas_mensagens',
    'posts','comentarios_posts','curtidas_posts','sintonias',
    'descartes_deck','cegas_deck_perfis','cegas_deck_convites',
    'cegas_fila','cegas_conversas','salas',
    'bloqueios_usuario','cegas_bloqueios'
  ] loop
    if to_regclass('public.' || tabela) is not null then
      execute format('drop trigger if exists moderacao_rejeitar_acao on public.%I', tabela);
      execute format('create trigger moderacao_rejeitar_acao before insert or update or delete on public.%I for each row execute function private.moderacao_rejeitar_acao()', tabela);
    end if;
  end loop;
end;
$$;

-- Pré-validação da denúncia e do alvo ANTES de chamar a API administrativa do Auth.
create or replace function public.moderacao_validar_alvo(
  p_origem text, p_denuncia uuid, p_usuario uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select public.moderacao_eh_admin()
     and p_usuario is not null and p_usuario is distinct from (select auth.uid())
     and exists (select 1 from auth.users u where u.id = p_usuario)
     and not exists (
       select 1 from private.moderacao_administradores a
       where a.usuario_id = p_usuario and a.ativo
     )
     and (
       (p_origem='geral' and exists (
         select 1 from public.denuncias d
         where d.id=p_denuncia and d.denunciado_id=p_usuario
       ))
       or
       (p_origem='cegas' and exists (
         select 1 from public.cegas_denuncias d
         where d.id=p_denuncia and d.denunciado=p_usuario
       ))
     );
$$;
revoke all on function public.moderacao_validar_alvo(text,uuid,uuid) from public, anon;
grant execute on function public.moderacao_validar_alvo(text,uuid,uuid) to authenticated;

create or replace function public.moderacao_aplicar_medida(
  p_origem text, p_denuncia uuid, p_usuario uuid,
  p_acao text, p_motivo text, p_horas integer default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := (select auth.uid());
  v_denunciado uuid;
  v_termina timestamptz;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if v_admin is null or not public.moderacao_eh_admin() then
    raise exception 'Acesso administrativo negado' using errcode = '42501';
  end if;
  if p_origem not in ('geral','cegas') or p_denuncia is null or p_usuario is null then
    raise exception 'Denúncia inválida' using errcode = '22023';
  end if;
  if p_origem = 'geral' then
    select denunciado_id into v_denunciado from public.denuncias where id = p_denuncia;
  else
    select denunciado into v_denunciado from public.cegas_denuncias where id = p_denuncia;
  end if;
  if v_denunciado is distinct from p_usuario or not exists
     (select 1 from auth.users u where u.id = p_usuario) then
    raise exception 'Usuário não pertence a esta denúncia' using errcode = '22023';
  end if;
  if p_usuario = v_admin or exists (
    select 1 from private.moderacao_administradores a where a.usuario_id = p_usuario and a.ativo
  ) then
    raise exception 'Não é permitido punir um administrador' using errcode = '42501';
  end if;
  if char_length(v_motivo) not between 5 and 1000 then
    raise exception 'Justificativa deve ter entre 5 e 1000 caracteres' using errcode = '22023';
  end if;
  if p_acao = 'suspensao' and p_horas in (24, 168, 720) then
    v_termina := now() + make_interval(hours => p_horas);
  elsif p_acao in ('advertencia','banimento') and p_horas is null then
    v_termina := null;
  else
    raise exception 'Medida ou duração inválida' using errcode = '22023';
  end if;

  if p_acao <> 'advertencia' then
    insert into public.moderacao_restricoes
      (usuario_id,tipo,motivo,origem,denuncia_id,termina_em,ativa,moderador_id,atualizada_em)
    values (p_usuario,p_acao,v_motivo,p_origem,p_denuncia,v_termina,true,v_admin,now())
    on conflict (usuario_id) do update
      set tipo=excluded.tipo,motivo=excluded.motivo,origem=excluded.origem,
          denuncia_id=excluded.denuncia_id,termina_em=excluded.termina_em,
          ativa=true,moderador_id=excluded.moderador_id,atualizada_em=now();
  end if;

  insert into public.moderacao_acoes
    (usuario_id,origem,denuncia_id,acao,motivo,termina_em,moderador_id)
  values (p_usuario,p_origem,p_denuncia,p_acao,v_motivo,v_termina,v_admin);

  return jsonb_build_object('ok', true, 'acao', p_acao,
     'usuario_id',p_usuario,'termina_em',v_termina);
end;
$$;
revoke all on function public.moderacao_aplicar_medida(text,uuid,uuid,text,text,integer) from public, anon;
grant execute on function public.moderacao_aplicar_medida(text,uuid,uuid,text,text,integer) to authenticated;

create or replace function public.moderacao_reverter_medida(
  p_usuario uuid, p_motivo text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := (select auth.uid());
  v_alvo public.moderacao_restricoes%rowtype;
  v_motivo text := btrim(coalesce(p_motivo,''));
begin
  if v_admin is null or not public.moderacao_eh_admin() then
    raise exception 'Acesso administrativo negado' using errcode = '42501';
  end if;
  if char_length(v_motivo) not between 5 and 1000 then
    raise exception 'Justificativa deve ter entre 5 e 1000 caracteres' using errcode = '22023';
  end if;
  select * into v_alvo from public.moderacao_restricoes
   where usuario_id = p_usuario and ativa and (tipo='banimento' or termina_em > now())
   for update;
  if not found then
    raise exception 'Esta conta não possui restrição ativa' using errcode = '22023';
  end if;
  update public.moderacao_restricoes
    set ativa=false,atualizada_em=now(),moderador_id=v_admin
    where usuario_id=p_usuario;
  insert into public.moderacao_acoes
    (usuario_id,origem,denuncia_id,acao,motivo,termina_em,moderador_id)
  values (p_usuario,v_alvo.origem,v_alvo.denuncia_id,'reversao',v_motivo,null,v_admin);
  return jsonb_build_object('ok',true,'acao','reversao','usuario_id',p_usuario);
end;
$$;
revoke all on function public.moderacao_reverter_medida(uuid,text) from public, anon;
grant execute on function public.moderacao_reverter_medida(uuid,text) to authenticated;

-- Somente a própria pessoa consulta seu estado; nenhum dado de outros usuários é exposto.
create or replace function public.moderacao_minha_restricao()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object('restrita',true,'tipo',r.tipo,
      'motivo',r.motivo,'termina_em',r.termina_em)
    from public.moderacao_restricoes r
    where r.usuario_id=(select auth.uid()) and r.ativa
      and (r.tipo='banimento' or r.termina_em>now())
  ),'{"restrita":false}'::jsonb);
$$;
revoke all on function public.moderacao_minha_restricao() from public, anon;
grant execute on function public.moderacao_minha_restricao() to authenticated;
