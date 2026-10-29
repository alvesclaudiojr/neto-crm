-- Gestão de usuários pelo próprio app (tela Usuários, só para administrador).
-- Criar, resetar senha e remover acesso passam pela Edge Function `usuarios`,
-- que guarda a chave secreta no servidor. O site nunca vê essa chave.

alter table public.membros
  add column admin        boolean not null default false,
  add column trocar_senha boolean not null default false;  -- senha provisória: troca no 1º acesso

-- Quem já estava liberado antes desta migração vira administrador.
update public.membros set admin = true;

-- O próprio usuário avisa que trocou a senha provisória. Só mexe na linha dele.
create or replace function public.senha_trocada()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.membros set trocar_senha = false
  where user_id = auth.uid() and public.pode_acessar();
$$;

revoke all on function public.senha_trocada() from public, anon;
grant execute on function public.senha_trocada() to authenticated;
