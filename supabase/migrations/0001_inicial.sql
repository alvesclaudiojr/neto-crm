-- Esquema inicial do CRM do consultório.
-- Rodar uma vez no Supabase: SQL Editor > New query > colar > Run.
--
-- Modelo de segurança:
--  * Cadastro público desligado no painel (só o admin cria usuários).
--  * Só quem está na tabela `membros` acessa os dados.
--  * E só depois de passar pelo 2FA (sessão com aal = 'aal2').
--  Tudo isso é conferido pelo banco (RLS), não pelo navegador.

-- Quem pode usar o sistema. Inserir manualmente pelo SQL Editor.
create table public.membros (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  nome      text not null,
  criado_em timestamptz not null default now()
);

create or replace function public.pode_acessar()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.membros m where m.user_id = auth.uid());
$$;

revoke all on function public.pode_acessar() from public, anon;
grant execute on function public.pode_acessar() to authenticated;

-- Dados da clínica que aparecem no orçamento impresso (linha única).
create table public.clinica (
  id           int primary key default 1 check (id = 1),
  nome         text not null default '',
  profissional text not null default '',
  registro     text not null default '',  -- ex.: CRO/UF 12345
  endereco     text not null default '',
  telefone     text not null default '',
  email        text not null default ''
);
insert into public.clinica (id) values (1);

create table public.clientes (
  id              bigint generated always as identity primary key,
  nome            text not null check (length(trim(nome)) > 0),
  telefone        text,
  email           text,
  cpf             text,
  data_nascimento date,
  endereco        text,
  observacoes     text,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create index clientes_nome_idx on public.clientes (lower(nome));

-- Histórico de contato com o cliente (ligou, mandou WhatsApp, etc.).
create table public.contatos (
  id         bigint generated always as identity primary key,
  cliente_id bigint not null references public.clientes (id) on delete cascade,
  data       timestamptz not null default now(),
  texto      text not null check (length(trim(texto)) > 0)
);
create index contatos_cliente_idx on public.contatos (cliente_id, data desc);

-- Catálogo de procedimentos/produtos com preço padrão.
create table public.procedimentos (
  id        bigint generated always as identity primary key,
  nome      text not null check (length(trim(nome)) > 0),
  descricao text,
  preco     numeric(10, 2) not null check (preco >= 0),
  ativo     boolean not null default true
);

create table public.orcamentos (
  id            bigint generated always as identity primary key,
  cliente_id    bigint not null references public.clientes (id) on delete restrict,
  data          date not null default current_date,
  validade_dias int not null default 30 check (validade_dias > 0),
  status        text not null default 'aberto'
                check (status in ('aberto', 'aprovado', 'recusado')),
  observacoes   text,
  criado_em     timestamptz not null default now()
);
create index orcamentos_cliente_idx on public.orcamentos (cliente_id);

-- A descrição e o preço são copiados do catálogo no momento do orçamento,
-- para que mudar o catálogo não altere orçamentos já entregues.
create table public.orcamento_itens (
  id              bigint generated always as identity primary key,
  orcamento_id    bigint not null references public.orcamentos (id) on delete cascade,
  procedimento_id bigint references public.procedimentos (id) on delete set null,
  descricao       text not null check (length(trim(descricao)) > 0),
  quantidade      int not null default 1 check (quantidade > 0),
  preco_unitario  numeric(10, 2) not null check (preco_unitario >= 0),
  observacao      text,  -- ex.: "desconto de 10%"
  ordem           int not null default 0
);
create index orcamento_itens_orcamento_idx on public.orcamento_itens (orcamento_id, ordem);

create or replace function public.tocar_atualizado_em()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;
create trigger clientes_atualizado_em before update on public.clientes
  for each row execute function public.tocar_atualizado_em();

-- RLS: sem política, ninguém acessa. Anônimo nunca acessa nada.
alter table public.membros         enable row level security;
alter table public.clinica         enable row level security;
alter table public.clientes        enable row level security;
alter table public.contatos        enable row level security;
alter table public.procedimentos   enable row level security;
alter table public.orcamentos      enable row level security;
alter table public.orcamento_itens enable row level security;

-- O usuário só enxerga a própria linha em membros (para o app saber se tem acesso).
create policy membros_ver_proprio on public.membros
  for select to authenticated using (user_id = auth.uid());

create policy clinica_ler on public.clinica
  for select to authenticated using (public.pode_acessar());
create policy clinica_editar on public.clinica
  for update to authenticated using (public.pode_acessar()) with check (public.pode_acessar());

create policy clientes_tudo on public.clientes
  for all to authenticated using (public.pode_acessar()) with check (public.pode_acessar());
create policy contatos_tudo on public.contatos
  for all to authenticated using (public.pode_acessar()) with check (public.pode_acessar());
create policy procedimentos_tudo on public.procedimentos
  for all to authenticated using (public.pode_acessar()) with check (public.pode_acessar());
create policy orcamentos_tudo on public.orcamentos
  for all to authenticated using (public.pode_acessar()) with check (public.pode_acessar());
create policy orcamento_itens_tudo on public.orcamento_itens
  for all to authenticated using (public.pode_acessar()) with check (public.pode_acessar());

revoke all on all tables in schema public from anon;

-- Salva orçamento + itens numa transação só. security invoker: as regras RLS
-- acima continuam valendo para quem chama.
create or replace function public.salvar_orcamento(p_id bigint, p_orcamento jsonb, p_itens jsonb)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id bigint := p_id;
begin
  if v_id is null then
    insert into public.orcamentos (cliente_id, data, validade_dias, status, observacoes)
    values (
      (p_orcamento ->> 'cliente_id')::bigint,
      coalesce((p_orcamento ->> 'data')::date, current_date),
      coalesce((p_orcamento ->> 'validade_dias')::int, 30),
      coalesce(p_orcamento ->> 'status', 'aberto'),
      nullif(p_orcamento ->> 'observacoes', '')
    )
    returning id into v_id;
  else
    update public.orcamentos set
      cliente_id    = (p_orcamento ->> 'cliente_id')::bigint,
      data          = (p_orcamento ->> 'data')::date,
      validade_dias = (p_orcamento ->> 'validade_dias')::int,
      status        = p_orcamento ->> 'status',
      observacoes   = nullif(p_orcamento ->> 'observacoes', '')
    where id = v_id;
    if not found then
      raise exception 'Orçamento % não encontrado', v_id;
    end if;
    delete from public.orcamento_itens where orcamento_id = v_id;
  end if;

  insert into public.orcamento_itens
    (orcamento_id, procedimento_id, descricao, quantidade, preco_unitario, observacao, ordem)
  select
    v_id,
    (i ->> 'procedimento_id')::bigint,
    i ->> 'descricao',
    (i ->> 'quantidade')::int,
    (i ->> 'preco_unitario')::numeric,
    nullif(i ->> 'observacao', ''),
    (ord - 1)::int
  from jsonb_array_elements(p_itens) with ordinality as t(i, ord);

  return v_id;
end;
$$;

revoke all on function public.salvar_orcamento(bigint, jsonb, jsonb) from public, anon;
grant execute on function public.salvar_orcamento(bigint, jsonb, jsonb) to authenticated;
