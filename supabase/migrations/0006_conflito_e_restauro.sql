-- 1) Edição simultânea: cada orçamento guarda quando foi alterado. Quem salva
--    manda a versão que abriu; se outra pessoa salvou no meio tempo, o banco
--    recusa (CONFLITO_EDICAO) em vez de sobrescrever em silêncio.
-- 2) Restaurar backup: função que troca todos os dados pelos do arquivo,
--    numa transação só (se algo falhar, nada muda). Só administrador.

alter table public.orcamentos add column atualizado_em timestamptz not null default now();
create trigger orcamentos_atualizado_em before update on public.orcamentos
  for each row execute function public.tocar_atualizado_em();

create or replace function public.salvar_orcamento(p_id bigint, p_orcamento jsonb, p_itens jsonb)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id bigint := p_id;
  v_atual timestamptz;
begin
  if v_id is null then
    insert into public.orcamentos
      (cliente_id, data, validade_dias, status, observacoes, desconto_tipo, desconto_valor)
    values (
      (p_orcamento ->> 'cliente_id')::bigint,
      coalesce((p_orcamento ->> 'data')::date, current_date),
      coalesce((p_orcamento ->> 'validade_dias')::int, 30),
      coalesce(p_orcamento ->> 'status', 'aberto'),
      nullif(p_orcamento ->> 'observacoes', ''),
      coalesce(p_orcamento ->> 'desconto_tipo', 'percentual'),
      coalesce((p_orcamento ->> 'desconto_valor')::numeric, 0)
    )
    returning id into v_id;
  else
    select atualizado_em into v_atual from public.orcamentos where id = v_id for update;
    if not found then
      raise exception 'Orçamento % não encontrado', v_id;
    end if;
    -- versão antiga do site não manda atualizado_em: aí não confere
    if p_orcamento ? 'atualizado_em' and v_atual is distinct from (p_orcamento ->> 'atualizado_em')::timestamptz then
      raise exception 'CONFLITO_EDICAO';
    end if;
    update public.orcamentos set
      cliente_id     = (p_orcamento ->> 'cliente_id')::bigint,
      data           = (p_orcamento ->> 'data')::date,
      validade_dias  = (p_orcamento ->> 'validade_dias')::int,
      status         = p_orcamento ->> 'status',
      observacoes    = nullif(p_orcamento ->> 'observacoes', ''),
      desconto_tipo  = coalesce(p_orcamento ->> 'desconto_tipo', 'percentual'),
      desconto_valor = coalesce((p_orcamento ->> 'desconto_valor')::numeric, 0)
    where id = v_id;
    delete from public.orcamento_itens where orcamento_id = v_id;
  end if;

  insert into public.orcamento_itens
    (orcamento_id, procedimento_id, descricao, quantidade, preco_unitario, desconto_pct, observacao, ordem)
  select
    v_id,
    (i ->> 'procedimento_id')::bigint,
    i ->> 'descricao',
    (i ->> 'quantidade')::int,
    (i ->> 'preco_unitario')::numeric,
    coalesce((i ->> 'desconto_pct')::numeric, 0),
    nullif(i ->> 'observacao', ''),
    (ord - 1)::int
  from jsonb_array_elements(p_itens) with ordinality as t(i, ord);

  return v_id;
end;
$$;

-- Troca todos os dados pelos do backup (arquivo gerado em Configurações > Baixar backup).
-- security definer: precisa gravar os ids originais e acertar os contadores de id.
create or replace function public.restaurar_backup(p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinica jsonb := p_dados -> 'clinica' -> 0;
begin
  if not (public.pode_acessar()
          and exists (select 1 from public.membros where user_id = auth.uid() and admin)) then
    raise exception 'Só o administrador pode restaurar backup.';
  end if;
  if jsonb_typeof(p_dados -> 'clientes') is distinct from 'array'
     or jsonb_typeof(p_dados -> 'orcamentos') is distinct from 'array' then
    raise exception 'Arquivo não parece um backup deste sistema.';
  end if;

  -- "where true": chamado pela API, o Supabase recusa delete sem filtro
  delete from public.orcamento_itens where true;
  delete from public.orcamentos where true;
  delete from public.contatos where true;
  delete from public.clientes where true;
  delete from public.procedimentos where true;

  if v_clinica is not null then
    update public.clinica set
      nome         = coalesce(v_clinica ->> 'nome', ''),
      profissional = coalesce(v_clinica ->> 'profissional', ''),
      registro     = coalesce(v_clinica ->> 'registro', ''),
      endereco     = coalesce(v_clinica ->> 'endereco', ''),
      telefone     = coalesce(v_clinica ->> 'telefone', ''),
      email        = coalesce(v_clinica ->> 'email', '')
    where id = 1;
  end if;

  insert into public.clientes
    (id, nome, telefone, email, cpf, data_nascimento, endereco, observacoes, criado_em, atualizado_em)
  overriding system value
  select id, nome, telefone, email, cpf, data_nascimento, endereco, observacoes,
         coalesce(criado_em, now()), coalesce(atualizado_em, now())
  from jsonb_to_recordset(p_dados -> 'clientes') as x(
    id bigint, nome text, telefone text, email text, cpf text, data_nascimento date,
    endereco text, observacoes text, criado_em timestamptz, atualizado_em timestamptz);

  insert into public.contatos (id, cliente_id, data, texto)
  overriding system value
  select id, cliente_id, coalesce(data, now()), texto
  from jsonb_to_recordset(coalesce(p_dados -> 'contatos', '[]')) as x(
    id bigint, cliente_id bigint, data timestamptz, texto text);

  insert into public.procedimentos (id, nome, descricao, preco, ativo)
  overriding system value
  select id, nome, descricao, preco, coalesce(ativo, true)
  from jsonb_to_recordset(coalesce(p_dados -> 'procedimentos', '[]')) as x(
    id bigint, nome text, descricao text, preco numeric, ativo boolean);

  insert into public.orcamentos
    (id, cliente_id, data, validade_dias, status, observacoes, criado_em, desconto_tipo, desconto_valor, atualizado_em)
  overriding system value
  select id, cliente_id, data, coalesce(validade_dias, 30), coalesce(status, 'aberto'), observacoes,
         coalesce(criado_em, now()), coalesce(desconto_tipo, 'percentual'), coalesce(desconto_valor, 0),
         coalesce(atualizado_em, now())
  from jsonb_to_recordset(p_dados -> 'orcamentos') as x(
    id bigint, cliente_id bigint, data date, validade_dias int, status text, observacoes text,
    criado_em timestamptz, desconto_tipo text, desconto_valor numeric, atualizado_em timestamptz);

  insert into public.orcamento_itens
    (id, orcamento_id, procedimento_id, descricao, quantidade, preco_unitario, desconto_pct, observacao, ordem)
  overriding system value
  select id, orcamento_id, procedimento_id, descricao, coalesce(quantidade, 1), preco_unitario,
         coalesce(desconto_pct, 0), observacao, coalesce(ordem, 0)
  from jsonb_to_recordset(coalesce(p_dados -> 'orcamento_itens', '[]')) as x(
    id bigint, orcamento_id bigint, procedimento_id bigint, descricao text, quantidade int,
    preco_unitario numeric, desconto_pct numeric, observacao text, ordem int);

  -- próximos ids continuam depois dos restaurados
  perform setval(pg_get_serial_sequence('public.clientes', 'id'), coalesce((select max(id) from public.clientes), 0) + 1, false);
  perform setval(pg_get_serial_sequence('public.contatos', 'id'), coalesce((select max(id) from public.contatos), 0) + 1, false);
  perform setval(pg_get_serial_sequence('public.procedimentos', 'id'), coalesce((select max(id) from public.procedimentos), 0) + 1, false);
  perform setval(pg_get_serial_sequence('public.orcamentos', 'id'), coalesce((select max(id) from public.orcamentos), 0) + 1, false);
  perform setval(pg_get_serial_sequence('public.orcamento_itens', 'id'), coalesce((select max(id) from public.orcamento_itens), 0) + 1, false);

  return jsonb_build_object(
    'clientes', (select count(*) from public.clientes),
    'contatos', (select count(*) from public.contatos),
    'procedimentos', (select count(*) from public.procedimentos),
    'orcamentos', (select count(*) from public.orcamentos),
    'orcamento_itens', (select count(*) from public.orcamento_itens));
end;
$$;

revoke all on function public.restaurar_backup(jsonb) from public, anon;
grant execute on function public.restaurar_backup(jsonb) to authenticated;
