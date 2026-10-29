-- Logo da clínica no topo do orçamento impresso. Fica na própria tabela como
-- data URL (data:image/png;base64,...): sem serviço de arquivos à parte, e o
-- backup já leva junto. Limite de ~650 kB e só PNG/JPG/WEBP.

alter table public.clinica
  add column logo text not null default ''
    check (logo = '' or (logo ~ '^data:image/(png|jpeg|webp);base64,' and length(logo) <= 700000));

-- restaurar_backup passa a restaurar a logo também
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
      email        = coalesce(v_clinica ->> 'email', ''),
      -- backup antigo (sem logo) mantém a logo atual
      logo         = coalesce(v_clinica ->> 'logo', logo)
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

