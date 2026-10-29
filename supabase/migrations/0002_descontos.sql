-- Descontos no orçamento: por item (%) e geral (% ou R$).
-- Rodar uma vez no SQL Editor, depois da 0001.

alter table public.orcamento_itens
  add column desconto_pct numeric(5, 2) not null default 0
    check (desconto_pct >= 0 and desconto_pct <= 100);

alter table public.orcamentos
  add column desconto_tipo text not null default 'percentual'
    check (desconto_tipo in ('percentual', 'valor')),
  add column desconto_valor numeric(10, 2) not null default 0
    check (desconto_valor >= 0),
  add constraint orcamentos_desconto_pct_max
    check (desconto_tipo <> 'percentual' or desconto_valor <= 100);

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
    update public.orcamentos set
      cliente_id     = (p_orcamento ->> 'cliente_id')::bigint,
      data           = (p_orcamento ->> 'data')::date,
      validade_dias  = (p_orcamento ->> 'validade_dias')::int,
      status         = p_orcamento ->> 'status',
      observacoes    = nullif(p_orcamento ->> 'observacoes', ''),
      desconto_tipo  = coalesce(p_orcamento ->> 'desconto_tipo', 'percentual'),
      desconto_valor = coalesce((p_orcamento ->> 'desconto_valor')::numeric, 0)
    where id = v_id;
    if not found then
      raise exception 'Orçamento % não encontrado', v_id;
    end if;
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
