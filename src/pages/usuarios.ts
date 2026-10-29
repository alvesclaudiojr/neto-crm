import { chamarFuncao, loginParaEmail, emailParaLogin, semEmail, LOGIN_VALIDO } from '../lib/supabase';
import { h, mount, lerForm, campo, aviso, acao } from '../lib/dom';
import { dataHoraBR } from '../lib/format';

// Tela só do administrador. Tudo passa pela Edge Function `usuarios`, que
// confere de novo no servidor se quem chama é administrador com 2FA.

interface Usuario {
  user_id: string;
  email: string;
  nome: string | null;
  liberado: boolean;
  admin: boolean;
  trocar_senha: boolean;
  com_2fa: boolean;
  ultimo_acesso: string | null;
  eu: boolean;
}

const usuarios = <T>(corpo: Record<string, unknown>) => chamarFuncao<T>('usuarios', corpo);

export async function paginaUsuarios(alvo: HTMLElement) {
  const lista = h('div');
  const msg = h('div');

  /** Mostra a senha provisória para o administrador repassar. */
  function mostrarSenha(quem: string, senha: string) {
    const codigo = h('code', { class: 'senha-provisoria' }, senha);
    const copiar = h('button', { type: 'button', class: 'secundario' }, 'Copiar');
    copiar.addEventListener('click', async () => {
      await navigator.clipboard.writeText(senha);
      copiar.textContent = 'Copiado';
    });
    msg.replaceChildren(
      h(
        'div',
        { class: 'aviso aviso-info', role: 'status' },
        h('p', null, `Senha provisória de ${quem}:`),
        h('div', { class: 'linha-senha' }, codigo, copiar),
        h('p', null, 'Passe pessoalmente ou por mensagem e apague depois. No primeiro acesso ele cria a senha dele e ativa o autenticador. Esta senha não será mostrada de novo.'),
      ),
    );
  }

  async function carregar() {
    const { usuarios: dados } = await usuarios<{ usuarios: Usuario[] }>({ acao: 'listar' });
    dados.sort((a, b) => Number(b.liberado) - Number(a.liberado) || (a.nome ?? a.email).localeCompare(b.nome ?? b.email));
    mount(
      lista,
      h(
        'table',
        null,
        h('thead', null, h('tr', null, h('th', null, 'Nome'), h('th', null, 'Login'), h('th', null, 'Situação'), h('th', null, 'Último acesso'), h('th'))),
        h('tbody', null, dados.map(linha)),
      ),
    );
  }

  function situacao(u: Usuario) {
    if (!u.liberado) return h('span', { class: 'status status-recusado' }, 'Sem acesso');
    const partes = [u.admin ? 'Administrador' : 'Dentista'];
    if (u.trocar_senha) partes.push('aguardando 1º acesso');
    else if (!u.com_2fa) partes.push('sem autenticador');
    return h('span', { class: `status ${u.trocar_senha ? 'status-aberto' : 'status-aprovado'}` }, partes.join(' · '));
  }

  function botao(rotulo: string, classe: string, pergunta: string, fn: () => Promise<void>) {
    const btn = h('button', { type: 'button', class: classe }, rotulo);
    btn.addEventListener('click', () => {
      if (!confirm(pergunta)) return;
      acao(btn, msg, fn);
    });
    return btn;
  }

  function linha(u: Usuario) {
    const nome = u.nome ?? '—';
    let acoes: (HTMLElement | string)[];
    if (u.eu) {
      acoes = ['Você'];
    } else if (!u.liberado) {
      acoes = [
        botao('Dar acesso', 'secundario', `Liberar o acesso de ${emailParaLogin(u.email)}? Será gerada uma senha provisória.`, async () => {
          const nomeNovo = prompt('Nome do dentista (aparece no topo do sistema):', '')?.trim();
          if (!nomeNovo) return;
          const { senha } = await usuarios<{ senha: string }>({ acao: 'liberar', user_id: u.user_id, nome: nomeNovo });
          await carregar();
          mostrarSenha(nomeNovo, senha);
        }),
        botao('Apagar', 'perigo', `Apagar o login ${emailParaLogin(u.email)}?`, async () => {
          await usuarios({ acao: 'remover', user_id: u.user_id });
          await carregar();
          msg.replaceChildren(aviso('Login apagado.', 'ok'));
        }),
      ];
    } else {
      acoes = [
        botao('Nova senha', 'secundario', `Gerar uma nova senha provisória para ${nome}? A senha atual deixa de funcionar.`, async () => {
          const { senha } = await usuarios<{ senha: string }>({ acao: 'resetar_senha', user_id: u.user_id });
          await carregar();
          mostrarSenha(nome, senha);
        }),
        u.com_2fa
          ? botao('Zerar autenticador', 'secundario', `Zerar o autenticador de ${nome}? Use quando ele trocar ou perder o celular. No próximo acesso ele cadastra de novo.`, async () => {
              await usuarios({ acao: 'resetar_2fa', user_id: u.user_id });
              await carregar();
              msg.replaceChildren(aviso(`Autenticador de ${nome} zerado.`, 'ok'));
            })
          : '',
        botao('Remover', 'perigo', `Remover o acesso de ${nome}? O login é apagado. Os pacientes e orçamentos continuam no sistema.`, async () => {
          await usuarios({ acao: 'remover', user_id: u.user_id });
          await carregar();
          msg.replaceChildren(aviso(`Acesso de ${nome} removido.`, 'ok'));
        }),
      ];
    }
    return h(
      'tr',
      null,
      h('td', null, nome),
      h('td', null, emailParaLogin(u.email)),
      h('td', null, situacao(u)),
      h('td', null, u.ultimo_acesso ? dataHoraBR(u.ultimo_acesso) : 'nunca'),
      h('td', null, h('div', { class: 'botoes-linha' }, acoes)),
    );
  }

  const btnCriar = h('button', { type: 'submit' }, 'Criar acesso');
  const form = h(
    'form',
    {
      class: 'grade',
      onsubmit: (e: Event) => {
        e.preventDefault();
        const v = lerForm(form);
        const ehAdmin = (form.elements.namedItem('admin') as HTMLInputElement).checked;
        acao(btnCriar, msg, async () => {
          const login = v.login.toLowerCase();
          if (semEmail(login) && !LOGIN_VALIDO.test(login)) {
            throw new Error('Usuário: de 3 a 30 caracteres, só letras minúsculas sem acento, números, ponto, hífen ou sublinhado.');
          }
          const { senha } = await usuarios<{ senha: string }>({ acao: 'criar', nome: v.nome, email: loginParaEmail(login), admin: ehAdmin });
          form.reset();
          await carregar();
          mostrarSenha(v.nome, senha);
        });
      },
    },
    campo('Nome *', h('input', { name: 'nome', required: true, placeholder: 'Ex.: Dra. Ana' })),
    campo(
      'E-mail ou usuário *',
      h('input', { name: 'login', required: true, autocomplete: 'off', autocapitalize: 'none', spellcheck: false, placeholder: 'ex.: ana@gmail.com ou ana' }),
      'Sem e-mail: use um nome curto (ex.: neto). Ele entra digitando só esse nome.',
    ),
    h(
      'label',
      { class: 'campo-check' },
      h('input', { type: 'checkbox', name: 'admin' }),
      ' Administrador (pode criar e remover usuários)',
    ),
    h('div', { class: 'acoes' }, btnCriar),
  );

  mount(
    alvo,
    h('h1', null, 'Usuários'),
    h(
      'section',
      null,
      h('h2', null, 'Novo acesso'),
      h('p', { class: 'dica' }, 'O sistema gera uma senha provisória. No primeiro acesso o dentista troca a senha e ativa o autenticador no celular.'),
      form,
    ),
    msg,
    lista,
  );
  await carregar();
}
