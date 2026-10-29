import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configurado = Boolean(url && anonKey);

export const supabase = createClient(url || 'http://invalido.local', anonKey || 'invalido', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

type Resposta = { data: unknown; error: { message: string } | null };
type Sucesso<R extends Resposta> = [Extract<R, { error: null }>] extends [never]
  ? NonNullable<R['data']>
  : Extract<R, { error: null }>['data'];

/** Desembrulha a resposta do Supabase (sucesso | erro), lançando o erro se houver. */
export function must<R extends Resposta>(res: R): Sucesso<R> {
  if (res.error) throw new Error(res.error.message);
  return res.data as Sucesso<R>;
}
