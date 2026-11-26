-- Estilo por mensagem no Chat Global e nas salas web do Afinzer.
-- Campos opcionais: o aplicativo Android continua enviando suas mensagens sem eles,
-- e mensagens antigas seguem legiveis com a tipografia padrao.
alter table public.mensagens
  add column if not exists fonte_chat text,
  add column if not exists tamanho_chat smallint,
  add column if not exists negrito_chat boolean,
  add column if not exists italico_chat boolean;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mensagens_fonte_chat_valid_check'
      and conrelid = 'public.mensagens'::regclass
  ) then
    alter table public.mensagens
      add constraint mensagens_fonte_chat_valid_check
      check (fonte_chat is null or fonte_chat in ('padrao', 'classica', 'monoespaco', 'arredondada'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'mensagens_tamanho_chat_valid_check'
      and conrelid = 'public.mensagens'::regclass
  ) then
    alter table public.mensagens
      add constraint mensagens_tamanho_chat_valid_check
      check (tamanho_chat is null or tamanho_chat in (14, 16, 18, 20, 22));
  end if;
end $$;
