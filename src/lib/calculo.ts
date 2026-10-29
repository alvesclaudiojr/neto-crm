import { centavos } from './format';

// Todo cálculo em centavos inteiros. Usado pelo editor, pela lista e pela
// impressão, para que os três mostrem sempre o mesmo valor.

export type TipoDesconto = 'percentual' | 'valor';

export interface ItemCalc {
  quantidade: number;
  preco_unitario: number | string;
  desconto_pct?: number | string | null;
}

export const brutoItem = (i: ItemCalc) => (Number(i.quantidade) || 0) * centavos(i.preco_unitario || 0);

export function liquidoItem(i: ItemCalc) {
  const pct = Math.min(Math.max(Number(i.desconto_pct) || 0, 0), 100);
  return Math.round(brutoItem(i) * (1 - pct / 100));
}

export interface Totais {
  bruto: number; // soma sem nenhum desconto
  descontoItens: number;
  subtotal: number; // depois do desconto dos itens
  descontoGeral: number;
  total: number;
}

export function calcularTotais(itens: ItemCalc[], tipo: TipoDesconto = 'percentual', valor: number | string = 0): Totais {
  const bruto = itens.reduce((s, i) => s + brutoItem(i), 0);
  const subtotal = itens.reduce((s, i) => s + liquidoItem(i), 0);
  const v = Math.max(Number(valor) || 0, 0);
  const descontoGeral =
    tipo === 'percentual' ? Math.round((subtotal * Math.min(v, 100)) / 100) : Math.min(centavos(v), subtotal);
  return { bruto, descontoItens: bruto - subtotal, subtotal, descontoGeral, total: subtotal - descontoGeral };
}

/** Formata percentual sem casas desnecessárias: 10 → "10%", 7.5 → "7,5%". */
export const pct = (v: number | string) => `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
