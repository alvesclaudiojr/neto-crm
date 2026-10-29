-- Novo status "pago": o orçamento aprovado que o paciente já pagou.
alter table public.orcamentos drop constraint orcamentos_status_check;
alter table public.orcamentos add constraint orcamentos_status_check
  check (status in ('aberto', 'aprovado', 'pago', 'recusado'));
