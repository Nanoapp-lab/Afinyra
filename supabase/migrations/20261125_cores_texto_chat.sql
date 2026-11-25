-- Cor pessoal do texto dos chats do site; nenhum formato de mensagem do Android muda.
-- Leitura apenas autenticada; somente o dono com Premium efetivo altera a propria cor.
create table if not exists public.cores_texto_chat (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  cor_texto text not null default '#FFFFFF',
  constraint cores_texto_chat_paleta_check check (cor_texto in (
    '#00D9FF', '#BA8EFF', '#FF80AB', '#4DE0A0', '#FFDC66',
    '#FFB142', '#6495ED', '#FFFFFF', '#D8B4FE', '#FF927B',
    '#5CE1E6', '#B7F071', '#FF66D8', '#F5CE6E', '#8EC5FF',
    '#99F6CF', '#FFC4A6', '#E1A9FF', '#72E9A8', '#D5FAFF'
  ))
);

alter table public.cores_texto_chat enable row level security;
revoke all on table public.cores_texto_chat from public, anon, authenticated;
grant select, insert, update on table public.cores_texto_chat to authenticated;

create policy "Cores visiveis para usuarios autenticados"
  on public.cores_texto_chat for select to authenticated using (true);
create policy "Premium insere sua propria cor"
  on public.cores_texto_chat for insert to authenticated
  with check (usuario_id = (select auth.uid()) and (select public.meu_premium_ativo()));
create policy "Premium atualiza sua propria cor"
  on public.cores_texto_chat for update to authenticated
  using (usuario_id = (select auth.uid()) and (select public.meu_premium_ativo()))
  with check (usuario_id = (select auth.uid()) and (select public.meu_premium_ativo()));
