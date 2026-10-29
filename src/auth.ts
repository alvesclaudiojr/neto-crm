import { supabase, must, loginParaEmail, semEmail } from './lib/supabase';
import { h, mount, lerForm, campo, aviso, acao } from './lib/dom';

type Seguir = () => void | Promise<void>;

function cartao(titulo: string, ...conteudo: (Node | null)[]) {
  return h('main', { class: 'tela-auth' }, h('section', { class: 'cartao' }, h('h1', null, titulo), ...conteudo));
}

export function telaConfigFaltando(root: HTMLElement) {
  mount(
    root,
    cartao(
      'Configuração pendente',
      h('p', null, 'Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env (veja o README).'),
    ),
  );
}

export function telaLogin(root: HTMLElement, seguir: Seguir) {
  const msg = h('div');
  const btn = h('button', { type: 'submit' }, 'Entrar');
  const form = h(
    'form',
    {
      onsubmit: (e: Event) => {
        e.preventDefault();
        const { login, senha } = lerForm(form);
        acao(btn, msg, async () => {
          const { error } = await supabase.auth.signInWithPassword({ email: loginParaEmail(login), password: senha });
          if (error?.name === 'AuthRetryableFetchError') {
            throw new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.');
          }
          // mensagem genérica: não revela se o e-mail existe
          if (error) throw new Error('Usuário ou senha inválidos.');
          seguir();
        });
      },
    },
    campo(
      'E-mail ou usuário',
      h('input', { name: 'login', required: true, autocomplete: 'username', autocapitalize: 'none', spellcheck: false }),
    ),
    campo('Senha', h('input', { name: 'senha', type: 'password', required: true, autocomplete: 'current-password' })),
    msg,
    btn,
    h('button', { type: 'button', class: 'link', onclick: () => telaEsqueci(root, seguir) }, 'Esqueci minha senha'),
  );
  mount(root, cartao('Entrar', form));
}

function telaEsqueci(root: HTMLElement, seguir: Seguir) {
  const msg = h('div');
  const btn = h('button', { type: 'submit' }, 'Enviar link');
  const form = h(
    'form',
    {
      onsubmit: (e: Event) => {
        e.preventDefault();
        const { email } = lerForm(form);
        acao(btn, msg, async () => {
          if (semEmail(email)) {
            throw new Error('Usuário sem e-mail não recebe link. Peça ao administrador uma nova senha (tela Usuários).');
          }
          await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: location.origin + location.pathname,
          });
          // mesma resposta exista ou não a conta
          msg.replaceChildren(aviso('Se o e-mail estiver cadastrado, você receberá um link para criar nova senha.', 'ok'));
        });
      },
    },
    campo('E-mail', h('input', { name: 'email', required: true })),
    msg,
    btn,
    h('button', { type: 'button', class: 'link', onclick: () => telaLogin(root, seguir) }, 'Voltar'),
  );
  mount(root, cartao('Recuperar senha', form));
}

export function telaNovaSenha(root: HTMLElement, seguir: Seguir, titulo = 'Criar nova senha', explicacao?: string) {
  const msg = h('div');
  const btn = h('button', { type: 'submit' }, 'Salvar senha');
  const form = h(
    'form',
    {
      onsubmit: (e: Event) => {
        e.preventDefault();
        const { senha, confirma } = lerForm(form);
        acao(btn, msg, async () => {
          validarSenha(senha, confirma);
          must(await supabase.auth.updateUser({ password: senha }));
          await seguir();
        });
      },
    },
    explicacao ? h('p', null, explicacao) : null,
    campo('Nova senha', h('input', { name: 'senha', type: 'password', required: true, minLength: 10, autocomplete: 'new-password' }), 'Mínimo de 10 caracteres.'),
    campo('Repita a senha', h('input', { name: 'confirma', type: 'password', required: true, autocomplete: 'new-password' })),
    msg,
    btn,
    botaoSair(),
  );
  mount(root, cartao(titulo, form));
}

export function validarSenha(senha: string, confirma: string) {
  if (senha.length < 10) throw new Error('A senha precisa ter pelo menos 10 caracteres.');
  if (senha !== confirma) throw new Error('As senhas não conferem.');
}

/** Ativa o app autenticador (2FA, opcional). `cancelar` mostra o botão "Agora não". */
export async function telaMfaCadastrar(root: HTMLElement, seguir: Seguir, cancelar?: () => void) {
  // limpa tentativas anteriores não concluídas
  const fatores = must(await supabase.auth.mfa.listFactors());
  for (const f of fatores.all.filter((f) => f.status === 'unverified')) {
    await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const novo = must(await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Autenticador ${Date.now()}` }));

  const msg = h('div');
  const btn = h('button', { type: 'submit' }, 'Ativar');
  const form = h(
    'form',
    {
      onsubmit: (e: Event) => {
        e.preventDefault();
        const { codigo } = lerForm(form);
        acao(btn, msg, async () => {
          must(await supabase.auth.mfa.challengeAndVerify({ factorId: novo.id, code: codigo }));
          seguir();
        });
      },
    },
    h('p', null, 'Com a verificação em duas etapas, além da senha o login pede um código do seu celular: mesmo que alguém descubra a senha, não entra. Instale um app autenticador (Google Authenticator, Microsoft Authenticator, Authy…) e escaneie o código abaixo.'),
    h('img', { class: 'qr', src: novo.totp.qr_code, alt: 'QR code do autenticador' }),
    h('details', null, h('summary', null, 'Não consegue escanear? Digite a chave'), h('code', { class: 'segredo' }, novo.totp.secret)),
    campoCodigo(),
    msg,
    btn,
    cancelar ? h('button', { type: 'button', class: 'link', onclick: cancelar }, 'Agora não') : botaoSair(),
  );
  mount(root, cartao('Ativar verificação em duas etapas', form));
}

/** Login normal: pede o código de 6 dígitos do autenticador. */
export async function telaMfaVerificar(root: HTMLElement, seguir: Seguir) {
  const fatores = must(await supabase.auth.mfa.listFactors());
  const fator = fatores.totp[0];
  if (!fator) return telaMfaCadastrar(root, seguir);

  const msg = h('div');
  const btn = h('button', { type: 'submit' }, 'Confirmar');
  const form = h(
    'form',
    {
      onsubmit: (e: Event) => {
        e.preventDefault();
        const { codigo } = lerForm(form);
        acao(btn, msg, async () => {
          const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fator.id, code: codigo });
          if (error) throw new Error('Código inválido ou expirado.');
          seguir();
        });
      },
    },
    h('p', null, 'Digite o código de 6 dígitos do seu app autenticador.'),
    campoCodigo(),
    msg,
    btn,
    botaoSair(),
  );
  mount(root, cartao('Verificação em duas etapas', form));
  form.querySelector('input')?.focus();
}

export function telaSemAcesso(root: HTMLElement) {
  mount(
    root,
    cartao(
      'Sem acesso',
      h('p', null, 'Seu usuário entrou, mas ainda não foi liberado para usar o sistema. Peça ao administrador para incluí-lo.'),
      botaoSair(),
    ),
  );
}

function campoCodigo() {
  return campo(
    'Código',
    h('input', {
      name: 'codigo',
      inputMode: 'numeric',
      autocomplete: 'one-time-code',
      pattern: '[0-9]{6}',
      maxLength: 6,
      required: true,
    }),
  );
}

export function botaoSair(classe = 'link') {
  return h('button', { type: 'button', class: classe, onclick: () => supabase.auth.signOut() }, 'Sair');
}

/** Encerra a sessão após um período sem uso (PC compartilhado no consultório). */
export function sairPorInatividade(minutos: number) {
  let timer: number | undefined;
  const reiniciar = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => supabase.auth.signOut(), minutos * 60_000);
  };
  for (const ev of ['mousemove', 'keydown', 'click', 'touchstart']) {
    window.addEventListener(ev, reiniciar, { passive: true });
  }
  reiniciar();
}
