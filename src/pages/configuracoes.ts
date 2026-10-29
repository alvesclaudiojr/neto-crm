import { supabase, must } from '../lib/supabase';
import { h, mount, lerForm, campo, aviso, acao } from '../lib/dom';
import { hojeISO } from '../lib/format';
import { validarSenha } from '../auth';
import type { Clinica } from '../lib/tipos';

export async function paginaConfiguracoes(alvo: HTMLElement, com2fa: boolean, ehAdmin: boolean, recarregar: () => Promise<void>) {
  const clinica = must(await supabase.from('clinica').select('*').single()) as Clinica;

  mount(
    alvo,
    h('h1', null, 'Configurações'),
    secaoClinica(clinica),
    secaoSenha(),
    secao2fa(com2fa, recarregar),
    secaoBackup(),
    ehAdmin ? secaoRestaurar() : null,
  );
}

function secao2fa(ativo: boolean, recarregar: () => Promise<void>) {
  const msg = h('div');
  if (!ativo) {
    return h(
      'section',
      null,
      h('h2', null, 'Verificação em duas etapas'),
      h('p', null, h('span', { class: 'status status-recusado' }, 'Desativada'), ' Recomendado: além da senha, o login pede um código do celular.'),
      h('a', { class: 'botao', href: '#/ativar-2fa' }, 'Ativar'),
    );
  }
  const btn = h('button', { type: 'button', class: 'perigo' }, 'Desativar');
  btn.addEventListener('click', () => {
    if (!confirm('Desativar a verificação em duas etapas? O login passa a pedir só a senha.')) return;
    acao(btn, msg, async () => {
      const fatores = must(await supabase.auth.mfa.listFactors());
      for (const f of fatores.all) must(await supabase.auth.mfa.unenroll({ factorId: f.id }));
      await supabase.auth.refreshSession();
      await recarregar();
    });
  });
  return h(
    'section',
    null,
    h('h2', null, 'Verificação em duas etapas'),
    h('p', null, h('span', { class: 'status status-aprovado' }, 'Ativada'), ' O login pede o código do app autenticador.'),
    btn,
    msg,
  );
}

function secaoClinica(c: Clinica) {
  const msg = h('div');
  const btn = h('button', { type: 'submit' }, 'Salvar');
  const inp = (name: keyof Clinica, attrs: Record<string, unknown> = {}) => h('input', { name, value: c[name], ...attrs });
  const form = h(
    'form',
    {
      class: 'grade',
      onsubmit: (e: Event) => {
        e.preventDefault();
        const v = lerForm(form);
        acao(btn, msg, async () => {
          must(await supabase.from('clinica').update(v).eq('id', 1));
          msg.replaceChildren(aviso('Salvo.', 'ok'));
        });
      },
    },
    campo('Nome da clínica', inp('nome')),
    campo('Profissional', inp('profissional'), 'Ex.: Dr. Fulano de Tal'),
    campo('Registro', inp('registro'), 'Ex.: CRO/SP 12345'),
    campo('Endereço', inp('endereco')),
    campo('Telefone / WhatsApp', inp('telefone')),
    campo('E-mail', inp('email', { type: 'email' })),
    h('div', { class: 'acoes' }, btn, msg),
  );
  return h('section', null, h('h2', null, 'Dados da clínica (aparecem no orçamento)'), form);
}

function secaoSenha() {
  const msg = h('div');
  const btn = h('button', { type: 'submit' }, 'Trocar senha');
  const form = h(
    'form',
    {
      class: 'grade',
      onsubmit: (e: Event) => {
        e.preventDefault();
        const { senha, confirma } = lerForm(form);
        acao(btn, msg, async () => {
          validarSenha(senha, confirma);
          must(await supabase.auth.updateUser({ password: senha }));
          form.reset();
          msg.replaceChildren(aviso('Senha alterada.', 'ok'));
        });
      },
    },
    campo('Nova senha', h('input', { name: 'senha', type: 'password', minLength: 10, required: true, autocomplete: 'new-password' })),
    campo('Repita a senha', h('input', { name: 'confirma', type: 'password', required: true, autocomplete: 'new-password' })),
    h('div', { class: 'acoes' }, btn, msg),
  );
  return h('section', null, h('h2', null, 'Minha senha'), form);
}

const TABELAS = ['clinica', 'clientes', 'contatos', 'procedimentos', 'orcamentos', 'orcamento_itens'] as const;

// a API devolve no máximo 1000 linhas por consulta
async function lerTudo(tabela: (typeof TABELAS)[number]) {
  const linhas: unknown[] = [];
  for (let de = 0; ; de += 1000) {
    const pagina = must(await supabase.from(tabela).select('*').order('id').range(de, de + 999));
    linhas.push(...pagina);
    if (pagina.length < 1000) return linhas;
  }
}

async function baixarBackup(nome = `consultorio-backup-${hojeISO()}.json`) {
  const dados: Record<string, unknown> = { gerado_em: new Date().toISOString(), versao: 1 };
  for (const t of TABELAS) dados[t] = await lerTudo(t);
  const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  h('a', { href: url, download: nome }).click();
  URL.revokeObjectURL(url);
}

function secaoBackup() {
  const msg = h('div');
  const btn = h('button', { type: 'button', class: 'secundario' }, 'Baixar backup');
  btn.addEventListener('click', () =>
    acao(btn, msg, async () => {
      await baixarBackup();
      msg.replaceChildren(aviso('Backup gerado.', 'ok'));
    }),
  );
  return h(
    'section',
    null,
    h('h2', null, 'Backup'),
    h(
      'p',
      { class: 'dica' },
      'Gera um arquivo com todos os dados. Ele contém dados pessoais de pacientes: guarde em local protegido (pasta com senha ou nuvem pessoal) e nunca envie por e-mail ou WhatsApp.',
    ),
    btn,
    msg,
  );
}

const qtd = (v: unknown) => (Array.isArray(v) ? v.length : 0);

function secaoRestaurar() {
  const msg = h('div');
  const arquivo = h('input', { type: 'file', accept: '.json,application/json' });
  const btn = h('button', { type: 'button', class: 'perigo' }, 'Restaurar backup');
  btn.addEventListener('click', () =>
    acao(btn, msg, async () => {
      const f = arquivo.files?.[0];
      if (!f) throw new Error('Escolha o arquivo de backup (.json).');
      let dados: Record<string, unknown>;
      try {
        dados = JSON.parse(await f.text());
      } catch {
        throw new Error('O arquivo não é um backup válido.');
      }
      if (!Array.isArray(dados.clientes) || !Array.isArray(dados.orcamentos)) {
        throw new Error('O arquivo não parece um backup deste sistema.');
      }
      const quando = typeof dados.gerado_em === 'string' ? new Date(dados.gerado_em).toLocaleString('pt-BR') : 'data desconhecida';
      const resumo = `${qtd(dados.clientes)} clientes, ${qtd(dados.orcamentos)} orçamentos e ${qtd(dados.procedimentos)} procedimentos (backup de ${quando})`;
      if (!confirm(`Restaurar ${resumo}?\n\nTODOS os dados atuais serão substituídos pelos do arquivo. Antes disso, uma cópia dos dados atuais será baixada.`)) return;
      if (prompt('Para confirmar, digite RESTAURAR:')?.trim().toUpperCase() !== 'RESTAURAR') {
        throw new Error('Restauração cancelada.');
      }
      // rede de segurança: guarda o estado atual antes de trocar
      await baixarBackup(`consultorio-antes-de-restaurar-${hojeISO()}.json`);
      const r = must(await supabase.rpc('restaurar_backup', { p_dados: dados })) as Record<string, number>;
      arquivo.value = '';
      msg.replaceChildren(
        aviso(`Backup restaurado: ${r.clientes} clientes, ${r.orcamentos} orçamentos, ${r.procedimentos} procedimentos.`, 'ok'),
      );
    }),
  );
  return h(
    'section',
    null,
    h('h2', null, 'Restaurar backup'),
    h(
      'p',
      { class: 'dica' },
      'Substitui todos os dados pelos de um arquivo de backup. Use só em emergência (dados apagados por engano, troca de projeto). Antes de restaurar, o sistema baixa uma cópia dos dados atuais.',
    ),
    h('div', { class: 'linha' }, arquivo, btn),
    msg,
  );
}
