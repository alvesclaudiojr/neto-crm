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

// O Supabase exige e-mail no login. Quem não tem e-mail entra com um nome de
// usuário, guardado como e-mail interno num domínio reservado (.invalid), que
// nunca recebe mensagem: então "esqueci minha senha" não serve para esses
// usuários, e o administrador gera uma nova senha na tela Usuários.
const DOMINIO_SEM_EMAIL = 'usuarios.invalid';

export function loginParaEmail(login: string) {
  const l = login.trim().toLowerCase();
  return l.includes('@') ? l : `${l}@${DOMINIO_SEM_EMAIL}`;
}

export function emailParaLogin(email: string) {
  const sufixo = `@${DOMINIO_SEM_EMAIL}`;
  return email.endsWith(sufixo) ? email.slice(0, -sufixo.length) : email;
}

export const semEmail = (login: string) => !login.includes('@');

/** Nome de usuário: letras minúsculas, números, ponto, hífen e sublinhado. */
export const LOGIN_VALIDO = /^[a-z0-9._-]{3,30}$/;

/** Chama uma Edge Function e devolve o JSON; o erro vem no campo `erro` da resposta. */
export async function chamarFuncao<T>(nome: string, corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(nome, { body: corpo });
  if (error) {
    let msg = error.message;
    try {
      const j = await (error as { context?: Response }).context?.json();
      if (j?.erro) msg = j.erro;
    } catch {
      // resposta sem JSON: fica a mensagem genérica
    }
    throw new Error(msg);
  }
  return data as T;
}

/** Desembrulha a resposta do Supabase (sucesso | erro), lançando o erro se houver. */
export function must<R extends Resposta>(res: R): Sucesso<R> {
  if (res.error) throw new Error(res.error.message);
  return res.data as Sucesso<R>;
}
