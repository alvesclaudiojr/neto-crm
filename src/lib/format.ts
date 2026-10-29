const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Valores em centavos (inteiros) para não acumular erro de ponto flutuante. */
export const centavos = (v: number | string) => Math.round(Number(v) * 100);
export const moeda = (cent: number) => brl.format(cent / 100);

export function dataBR(iso: string | null | undefined) {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function dataHoraBR(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function somarDias(iso: string, dias: number) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const STATUS = {
  aberto: 'Em aberto',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
} as const;
export type Status = keyof typeof STATUS;
