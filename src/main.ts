import './style.css';
import { supabase, configurado, must } from './lib/supabase';
import { h, mount, aviso } from './lib/dom';
import {
  telaConfigFaltando,
  telaLogin,
  telaMfaCadastrar,
  telaMfaVerificar,
  telaNovaSenha,
  telaSemAcesso,
  botaoSair,
  sairPorInatividade,
} from './auth';
import { listaOrcamentos, editorOrcamento, imprimirOrcamento } from './pages/orcamentos';
import { listaClientes, fichaCliente } from './pages/clientes';
import { paginaProcedimentos } from './pages/procedimentos';
import { paginaConfiguracoes } from './pages/configuracoes';
import { paginaUsuarios } from './pages/usuarios';

const root = document.getElementById('app')!;
let recuperandoSenha = false;
let nomeUsuario = '';
let ehAdmin = false;

supabase.auth.onAuthStateChange((evento) => {
  // não chamar o Supabase direto dentro do callback (pode travar): agenda
  if (evento === 'PASSWORD_RECOVERY') {
    recuperandoSenha = true;
    setTimeout(iniciar);
  } else if (evento === 'SIGNED_OUT') {
    setTimeout(iniciar);
  }
});

async function iniciar() {
  if (!configurado) return telaConfigFaltando(root);
  nomeUsuario = '';
  ehAdmin = false;
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return telaLogin(root, iniciar);

    const nivel = must(await supabase.auth.mfa.getAuthenticatorAssuranceLevel());
    if (nivel.currentLevel !== 'aal2') {
      return nivel.nextLevel === 'aal2' ? telaMfaVerificar(root, iniciar) : telaMfaCadastrar(root, iniciar);
    }
    if (recuperandoSenha) {
      return telaNovaSenha(root, () => {
        recuperandoSenha = false;
        iniciar();
      });
    }
    const membro = must(
      await supabase.from('membros').select('nome, admin, trocar_senha').eq('user_id', data.session.user.id).maybeSingle(),
    );
    if (!membro) return telaSemAcesso(root);
    if (membro.trocar_senha) {
      return telaNovaSenha(
        root,
        async () => {
          must(await supabase.rpc('senha_trocada'));
          iniciar();
        },
        'Crie sua senha',
        'Você entrou com uma senha provisória. Crie agora a sua senha pessoal; só você vai saber.',
      );
    }

    ehAdmin = membro.admin;
    nomeUsuario = membro.nome;
    rotear();
  } catch (e) {
    mount(root, h('main', { class: 'tela-auth' }, aviso(e instanceof Error ? e.message : String(e)), botaoSair()));
  }
}

const MENU: [string, string][] = [
  ['#/orcamentos', 'Orçamentos'],
  ['#/clientes', 'Clientes'],
  ['#/procedimentos', 'Procedimentos'],
  ['#/configuracoes', 'Configurações'],
];
// a tela some do menu para quem não é admin; quem decide de verdade é a Edge Function
const MENU_ADMIN: [string, string] = ['#/usuarios', 'Usuários'];

async function rotear() {
  const caminho = location.hash.replace(/^#\/?/, '').split('?')[0];
  const partes = (caminho || 'orcamentos').split('/');
  const [secao, id, extra] = partes;

  // impressão ocupa a tela toda, sem menu
  if (secao === 'orcamentos' && id && extra === 'imprimir') {
    const conteudo = h('div');
    mount(root, conteudo);
    return render(conteudo, () => imprimirOrcamento(conteudo, Number(id)));
  }

  const conteudo = h('main', { class: 'conteudo' });
  mount(
    root,
    h(
      'header',
      { class: 'topo no-print' },
      h('strong', { class: 'marca' }, 'Consultório'),
      h(
        'nav',
        null,
        [...MENU, ...(ehAdmin ? [MENU_ADMIN] : [])].map(([href, rotulo]) =>
          h('a', { href, class: href.slice(2) === secao ? 'ativo' : null }, rotulo),
        ),
      ),
      h('span', { class: 'usuario' }, nomeUsuario, ' · ', botaoSair()),
    ),
    conteudo,
  );

  render(conteudo, () => {
    switch (secao) {
      case 'orcamentos':
        return id ? editorOrcamento(conteudo, id === 'novo' ? null : Number(id)) : listaOrcamentos(conteudo);
      case 'clientes':
        return id ? fichaCliente(conteudo, id === 'novo' ? null : Number(id)) : listaClientes(conteudo);
      case 'procedimentos':
        return paginaProcedimentos(conteudo);
      case 'configuracoes':
        return paginaConfiguracoes(conteudo);
      case 'usuarios':
        if (ehAdmin) return paginaUsuarios(conteudo);
        location.hash = '#/orcamentos';
        return;
      default:
        location.hash = '#/orcamentos';
    }
  });
}

async function render(alvo: HTMLElement, fn: () => Promise<void> | void) {
  try {
    await fn();
  } catch (e) {
    alvo.replaceChildren(aviso(e instanceof Error ? e.message : String(e)));
  }
}

window.addEventListener('hashchange', () => {
  if (nomeUsuario) rotear();
});

sairPorInatividade(30);
iniciar();
