import type { Status } from './format';
import type { TipoDesconto } from './calculo';

export interface Cliente {
  id: number;
  nome: string;
  telefone: string | null;
  email: string | null;
  cpf: string | null;
  data_nascimento: string | null;
  endereco: string | null;
  observacoes: string | null;
  criado_em: string;
}

export interface Contato {
  id: number;
  cliente_id: number;
  data: string;
  texto: string;
}

export interface Procedimento {
  id: number;
  nome: string;
  descricao: string | null;
  preco: number;
  ativo: boolean;
}

export interface Orcamento {
  id: number;
  cliente_id: number;
  data: string;
  validade_dias: number;
  status: Status;
  observacoes: string | null;
  desconto_tipo: TipoDesconto;
  desconto_valor: number;
}

export interface ItemOrcamento {
  procedimento_id: number | null;
  descricao: string;
  quantidade: number;
  preco_unitario: number;
  desconto_pct: number;
  observacao: string | null;
}

export interface Clinica {
  nome: string;
  profissional: string;
  registro: string;
  endereco: string;
  telefone: string;
  email: string;
}
