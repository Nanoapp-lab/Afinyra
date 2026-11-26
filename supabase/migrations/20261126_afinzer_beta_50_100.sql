-- Afinzer Beta: vagas por ordem de chegada, contando todas as contas existentes.
-- Primeira fase: 50 contas; ampliacao manual unica para 100 por administradora/o proprietario.
-- Nao altera usuarios, planos, pagamentos ou regras atuais do aplicativo.

create table if not exists private.afinzer_beta_config (
  unico boolean primary key default true check (unico),
  limite_atual integer not null default 50 check (limite_atual in (50, 100)),
  limite_maximo integer not null default 100 check (limite_maximo = 100),
  iniciado_em timestamptz not null default now(),
  ampliado_em timestamptz,
  ampliado_por uuid
);

alter table private.afinzer_beta_config enable row level security;
revoke all on private.afinzer_beta_config from public, anon, authenticated;

insert into private.afinzer_beta_config (unico, limite_atual, limite_maximo)
values (true, 50, 100)
on conflict (unico) do nothing;

-- Todas as novas contas (site, Android e API Auth) passam por este mesmo limite.
-- O lock transacional evita que duas inscricoes simultaneas ocupem a ultima vaga.
create or replace function private.afinzer_beta_limitar_cadastro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_limite integer;
  v_total bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(261126, 50100);

  select limite_atual into v_limite
  from private.afinzer_beta_config
  where unico = true;

  if v_limite is null then
    raise exception 'Cadastro Beta temporariamente indisponivel.' using errcode = 'P0001';
  end if;

  select count(*) into v_total from auth.users;
  if v_total >= v_limite then
    raise exception 'As vagas do Beta Afinzer foram preenchidas. Aguarde a proxima fase.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

revoke all on function private.afinzer_beta_limitar_cadastro() from public, anon, authenticated;

drop trigger if exists afinzer_beta_limitar_cadastro on auth.users;
create trigger afinzer_beta_limitar_cadastro
before insert on auth.users
for each row execute function private.afinzer_beta_limitar_cadastro();

-- Somente numeros agregados sao expostos ao site; nenhum dado pessoal e retornado.
create or replace function public.afinzer_beta_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'total', (select count(*) from auth.users),
    'limite', c.limite_atual,
    'maximo', c.limite_maximo,
    'restantes', greatest(0, c.limite_atual - (select count(*) from auth.users)),
    'aberto', (select count(*) from auth.users) < c.limite_atual
  )
  from private.afinzer_beta_config c
  where c.unico = true;
$function$;

revoke all on function public.afinzer_beta_status() from public;
grant execute on function public.afinzer_beta_status() to anon, authenticated;

-- A ampliacao nao ocorre automaticamente: exige a conta proprietaria autenticada
-- e o direito administrativo previamente atribuido no Supabase.
create or replace function public.afinzer_beta_ampliar_100()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_usuario uuid := (select auth.uid());
  v_email text;
begin
  if v_usuario is null or not public.moderacao_eh_admin() then
    raise exception 'Sem autorizacao para ampliar o Beta.' using errcode = '42501';
  end if;

  select pg_catalog.lower(email) into v_email
  from auth.users
  where id = v_usuario;

  if v_email is distinct from '01juliano02@gmail.com' then
    raise exception 'Somente a conta proprietaria pode ampliar o Beta.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(261126, 50100);

  update private.afinzer_beta_config
  set limite_atual = 100,
      ampliado_em = pg_catalog.now(),
      ampliado_por = v_usuario
  where unico = true and limite_atual = 50;

  return public.afinzer_beta_status();
end;
$function$;

revoke all on function public.afinzer_beta_ampliar_100() from public, anon;
grant execute on function public.afinzer_beta_ampliar_100() to authenticated;
