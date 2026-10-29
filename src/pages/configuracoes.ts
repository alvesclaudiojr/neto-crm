import { supabase, must } from '../lib/supabase';
import { h, mount, lerForm, campo, aviso, acao } from '../lib/dom';
import { hojeISO } from '../lib/format';
import { validarSenha } from '../auth';
import type { Clinica } from '../lib/tipos';

export async function paginaConfiguracoes(alvo: HTMLElement) {
  const clinica = must(await supabase.from('clinica').select('*').single()) as Clinica;

  mount(
    alvo,
    h('h1', null, 'Configurações'),
    secaoClinica(clinica),
    secaoSenha(),
    secaoBackup(),
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

function secaoBackup() {
  const msg = h('div');
  const btn = h('button', { type: 'button', class: 'secundario' }, 'Baixar backup');
  btn.addEventListener('click', () =>
    acao(btn, msg, async () => {
      const dados: Record<string, unknown> = { gerado_em: new Date().toISOString(), versao: 1 };
      for (const t of TABELAS) dados[t] = await lerTudo(t);
      const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      h('a', { href: url, download: `consultorio-backup-${hojeISO()}.json` }).click();
      URL.revokeObjectURL(url);
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
