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
    secaoLogo(clinica.logo),
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

const TIPOS_LOGO = ['image/png', 'image/jpeg', 'image/webp'];

const lerComoDataURL = (arquivo: Blob) =>
  new Promise<string>((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => falha(new Error('Não foi possível ler a imagem.'));
    r.readAsDataURL(arquivo);
  });

/**
 * A logo fica no próprio banco como data URL (sem serviço de arquivos à parte).
 * Imagem grande é reduzida para caber no topo da folha sem pesar no banco.
 */
async function prepararLogo(arquivo: File) {
  if (!TIPOS_LOGO.includes(arquivo.type)) throw new Error('Use uma imagem PNG, JPG ou WEBP.');
  if (arquivo.size <= 300_000) return lerComoDataURL(arquivo);

  const img = new Image();
  img.src = URL.createObjectURL(arquivo);
  await img.decode().catch(() => {
    throw new Error('Não foi possível abrir a imagem.');
  });
  URL.revokeObjectURL(img.src);
  const escala = Math.min(1, 900 / img.naturalWidth, 400 / img.naturalHeight);
  const tela = h('canvas', { width: Math.round(img.naturalWidth * escala), height: Math.round(img.naturalHeight * escala) });
  tela.getContext('2d')!.drawImage(img, 0, 0, tela.width, tela.height);
  // JPG continua JPG; PNG/WEBP viram PNG para manter o fundo transparente
  const url = arquivo.type === 'image/jpeg' ? tela.toDataURL('image/jpeg', 0.9) : tela.toDataURL('image/png');
  if (url.length > 650_000) throw new Error('Imagem grande demais. Use uma logo menor (até ~400 kB).');
  return url;
}

function secaoLogo(atual: string) {
  const msg = h('div');
  const previa = h('img', { class: 'previa-logo', alt: 'Logo atual', hidden: !atual, src: atual || null });
  const semLogo = h('p', { class: 'dica', hidden: !!atual }, 'Nenhuma logo. O orçamento mostra o nome da clínica em texto.');
  const arquivo = h('input', { type: 'file', accept: TIPOS_LOGO.join(',') });
  const remover = h('button', { type: 'button', class: 'secundario', hidden: !atual }, 'Remover logo');

  async function salvar(logo: string) {
    must(await supabase.from('clinica').update({ logo }).eq('id', 1));
    previa.src = logo;
    previa.hidden = !logo;
    semLogo.hidden = !!logo;
    remover.hidden = !logo;
  }

  arquivo.addEventListener('change', () =>
    acao(null, msg, async () => {
      const f = arquivo.files?.[0];
      if (!f) return;
      await salvar(await prepararLogo(f));
      arquivo.value = '';
      msg.replaceChildren(aviso('Logo salva. Ela aparece no topo do orçamento impresso.', 'ok'));
    }),
  );
  remover.addEventListener('click', () =>
    acao(remover, msg, async () => {
      await salvar('');
      msg.replaceChildren(aviso('Logo removida.', 'ok'));
    }),
  );

  return h(
    'section',
    null,
    h('h2', null, 'Logo do orçamento'),
    h('p', { class: 'dica' }, 'Aparece no topo do orçamento impresso, no lugar do nome da clínica. De preferência PNG com fundo transparente.'),
    previa,
    semLogo,
    h('div', { class: 'linha' }, arquivo, remover),
    msg,
  );
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
