// Edge Function `usuarios`: gestão de acesso feita pela tela Usuários do app.
// Roda no servidor do Supabase com a chave secreta (service role), que nunca
// vai para o navegador. Só atende administrador (e, se ele ativou o 2FA, só
// depois de passar pelo código).
//
// Deploy: painel do Supabase > Edge Functions > Deploy a new function > Via Editor,
// nome `usuarios`, colar este arquivo. (Ou: supabase functions deploy usuarios)

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

class Recusado extends Error {
  constructor(msg: string, readonly status = 400) {
    super(msg);
  }
}

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

// sem letras e números que se confundem (l, 1, O, 0) para ditar a senha sem erro
const ALFABETO = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
function senhaProvisoria(tamanho = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(tamanho));
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('');
}

function claims(jwt: string): Record<string, unknown> {
  const meio = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(meio));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    // variáveis que o Supabase já injeta na função (chave legada ou a nova "secret key")
    const chave =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, chave, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // quem está chamando: o token é validado no servidor de autenticação
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
    const { data: quem, error: erroQuem } = await admin.auth.getUser(jwt);
    if (erroQuem || !quem.user) throw new Recusado('Sessão inválida. Entre de novo.', 401);
    // 2FA é opcional, mas quem ativou precisa ter passado por ele nesta sessão
    const tem2fa = (quem.user.factors ?? []).some((f) => f.status === 'verified');
    if (tem2fa && claims(jwt).aal !== 'aal2') throw new Recusado('Confirme o código do autenticador antes.', 403);
    const { data: eu } = await admin.from('membros').select('admin').eq('user_id', quem.user.id).maybeSingle();
    if (!eu?.admin) throw new Recusado('Só o administrador pode gerenciar usuários.', 403);

    const corpo = await req.json();
    const alvo = typeof corpo.user_id === 'string' ? corpo.user_id : '';
    if (['resetar_senha', 'resetar_2fa', 'remover', 'liberar'].includes(corpo.acao)) {
      if (!alvo) throw new Recusado('Usuário não informado.');
      // evita o administrador se trancar para fora
      if (alvo === quem.user.id) throw new Recusado('Isso não pode ser feito no seu próprio usuário.');
    }

    switch (corpo.acao) {
      case 'listar': {
        const { data: lista, error } = await admin.auth.admin.listUsers({ perPage: 100 });
        if (error) throw error;
        const { data: membros, error: e2 } = await admin.from('membros').select('user_id, nome, admin, trocar_senha');
        if (e2) throw e2;
        const porId = new Map(membros.map((m) => [m.user_id, m]));
        const usuarios = lista.users.map((u) => {
          const m = porId.get(u.id);
          return {
            user_id: u.id,
            email: u.email,
            nome: m?.nome ?? null,
            liberado: !!m,
            admin: m?.admin ?? false,
            trocar_senha: m?.trocar_senha ?? false,
            com_2fa: (u.factors ?? []).some((f) => f.status === 'verified'),
            ultimo_acesso: u.last_sign_in_at ?? null,
            eu: u.id === quem.user.id,
          };
        });
        return resposta({ usuarios });
      }

      case 'criar': {
        const nome = String(corpo.nome ?? '').trim();
        const email = String(corpo.email ?? '').trim().toLowerCase();
        if (!nome || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Recusado('Informe nome e um e-mail válido.');
        const senha = senhaProvisoria();
        const { data: novo, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true });
        if (error) {
          if (/already|registered|exists/i.test(error.message)) throw new Recusado('Já existe um usuário com esse e-mail.');
          throw error;
        }
        const { error: e2 } = await admin
          .from('membros')
          .insert({ user_id: novo.user.id, nome, admin: !!corpo.admin, trocar_senha: true });
        if (e2) {
          await admin.auth.admin.deleteUser(novo.user.id); // não deixa usuário sem acesso pendurado
          throw e2;
        }
        return resposta({ senha });
      }

      case 'liberar': {
        const nome = String(corpo.nome ?? '').trim();
        if (!nome) throw new Recusado('Informe o nome.');
        const senha = senhaProvisoria();
        const { error } = await admin.auth.admin.updateUserById(alvo, { password: senha });
        if (error) throw error;
        const { error: e2 } = await admin
          .from('membros')
          .upsert({ user_id: alvo, nome, admin: false, trocar_senha: true });
        if (e2) throw e2;
        return resposta({ senha });
      }

      case 'resetar_senha': {
        const senha = senhaProvisoria();
        const { error } = await admin.auth.admin.updateUserById(alvo, { password: senha });
        if (error) throw error;
        await admin.from('membros').update({ trocar_senha: true }).eq('user_id', alvo);
        return resposta({ senha });
      }

      case 'resetar_2fa': {
        const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: alvo });
        if (error) throw error;
        for (const f of data.factors) {
          const { error: e2 } = await admin.auth.admin.mfa.deleteFactor({ userId: alvo, id: f.id });
          if (e2) throw e2;
        }
        return resposta({ ok: true });
      }

      case 'remover': {
        // apaga o login; a linha em membros sai junto (on delete cascade)
        const { error } = await admin.auth.admin.deleteUser(alvo);
        if (error) throw error;
        return resposta({ ok: true });
      }

      default:
        throw new Recusado('Ação desconhecida.');
    }
  } catch (e) {
    const status = e instanceof Recusado ? e.status : 500;
    const msg = e instanceof Error ? e.message : String(e);
    if (status === 500) console.error(e);
    return resposta({ erro: msg }, status);
  }
});
