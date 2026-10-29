-- 2FA deixa de ser obrigatório e passa a ser recomendado.
-- Quem ATIVOU o autenticador continua obrigado a usá-lo: sem isso, quem
-- descobrisse a senha entraria pulando o código.

create or replace function public.pode_acessar()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.membros m where m.user_id = auth.uid())
     and (
       coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
       or not exists (
         select 1 from auth.mfa_factors f
         where f.user_id = auth.uid() and f.status = 'verified'
       )
     );
$$;
