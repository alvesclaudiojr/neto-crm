import { supabase, must } from '../lib/supabase';
import { h, mount, lerForm, campo, aviso, acao } from '../lib/dom';
import { dataBR, dataHoraBR, STATUS } from '../lib/format';
import type { Cliente, Contato, Orcamento } from '../lib/tipos';

/** Remove caracteres com significado na sintaxe de filtro do PostgREST. */
export function termoBusca(q: string) {
  return q.replace(/[,()*%\\]/g, ' ').trim();
}

export async function listaClientes(alvo: HTMLElement) {
  const lista = h('div');
  const busca = h('input', { type: 'search', placeholder: 'Buscar por nome, telefone ou e-mail', class: 'busca' });

  async function carregar() {
    let q = supabase.from('clientes').select('id, nome, telefone, email').order('nome').limit(200);
    const t = termoBusca(busca.value);
    if (t) q = q.or(`nome.ilike.*${t}*,telefone.ilike.*${t}*,email.ilike.*${t}*`);
    const dados = must(await q) as Pick<Cliente, 'id' | 'nome' | 'telefone' | 'email'>[];
    mount(
      lista,
      dados.length === 0
        ? h('p', { class: 'vazio' }, t ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.')
        : h(
            'table',
            null,
            h('thead', null, h('tr', null, h('th', null, 'Nome'), h('th', null, 'Telefone'), h('th', null, 'E-mail'))),
            h(
              'tbody',
              null,
              dados.map((c) =>
                h(
                  'tr',
                  { class: 'clicavel', onclick: () => (location.hash = `#/clientes/${c.id}`) },
                  h('td', null, h('a', { href: `#/clientes/${c.id}` }, c.nome)),
                  h('td', null, c.telefone ?? ''),
                  h('td', null, c.email ?? ''),
                ),
              ),
            ),
          ),
    );
  }

  let timer: number | undefined;
  busca.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => carregar().catch((e) => mount(lista, aviso(String(e.message ?? e)))), 250);
  });

  mount(
    alvo,
    h('div', { class: 'barra' }, h('h1', null, 'Clientes'), h('a', { class: 'botao', href: '#/clientes/novo' }, 'Novo cliente')),
    busca,
    lista,
  );
  await carregar();
  busca.focus();
}

export async function fichaCliente(alvo: HTMLElement, id: number | null) {
  const c: Partial<Cliente> = id
    ? (must(await supabase.from('clientes').select('*').eq('id', id).single()) as Cliente)
    : {};

  const msg = h('div');
  const btn = h('button', { type: 'submit' }, 'Salvar');
  const inp = (name: keyof Cliente, attrs: Record<string, unknown> = {}) =>
    h('input', { name, value: (c[name] as string | null) ?? '', ...attrs });

  const form = h(
    'form',
    {
      class: 'grade',
      onsubmit: (e: Event) => {
        e.preventDefault();
        const v = lerForm(form);
        const dados = {
          nome: v.nome,
          telefone: v.telefone || null,
          email: v.email || null,
          cpf: v.cpf || null,
          data_nascimento: v.data_nascimento || null,
          endereco: v.endereco || null,
          observacoes: v.observacoes || null,
        };
        acao(btn, msg, async () => {
          if (id) {
            must(await supabase.from('clientes').update(dados).eq('id', id));
            msg.replaceChildren(aviso('Salvo.', 'ok'));
          } else {
            const novo = must(await supabase.from('clientes').insert(dados).select('id').single());
            location.hash = `#/clientes/${novo.id}`;
          }
        });
      },
    },
    campo('Nome *', inp('nome', { required: true })),
    campo('Telefone / WhatsApp', inp('telefone', { type: 'tel' })),
    campo('E-mail', inp('email', { type: 'email' })),
    campo('CPF', inp('cpf', { maxLength: 14 }), 'Opcional. Só preencha se for necessário.'),
    campo('Data de nascimento', inp('data_nascimento', { type: 'date' })),
    campo('Endereço', h('textarea', { name: 'endereco', rows: 2 }, c.endereco ?? '')),
    campo('Observações', h('textarea', { name: 'observacoes', rows: 3 }, c.observacoes ?? '')),
    h('div', { class: 'acoes' }, btn, msg),
  );

  mount(
    alvo,
    h('div', { class: 'barra' }, h('h1', null, id ? c.nome! : 'Novo cliente'), h('a', { href: '#/clientes' }, '← Clientes')),
    form,
    id ? await blocoContatos(id) : null,
    id ? await blocoOrcamentos(id) : null,
    id ? botaoExcluir(id) : null,
  );
}

async function blocoContatos(clienteId: number) {
  const lista = h('ul', { class: 'historico' });
  async function carregar() {
    const dados = must(
      await supabase.from('contatos').select('*').eq('cliente_id', clienteId).order('data', { ascending: false }),
    ) as Contato[];
    mount(
      lista,
      dados.length === 0
        ? h('li', { class: 'vazio' }, 'Nenhum registro ainda.')
        : dados.map((ct) => h('li', null, h('time', null, dataHoraBR(ct.data)), h('p', null, ct.texto))),
    );
  }
  const msg = h('div');
  const btn = h('button', { type: 'submit' }, 'Registrar');
  const texto = h('textarea', { name: 'texto', rows: 2, required: true, placeholder: 'Ex.: Ligou perguntando sobre clareamento.' });
  const form = h(
    'form',
    {
      class: 'linha',
      onsubmit: (e: Event) => {
        e.preventDefault();
        acao(btn, msg, async () => {
          must(await supabase.from('contatos').insert({ cliente_id: clienteId, texto: texto.value.trim() }));
          texto.value = '';
          await carregar();
        });
      },
    },
    texto,
    btn,
  );
  await carregar();
  return h('section', null, h('h2', null, 'Histórico de contato'), form, msg, lista);
}

async function blocoOrcamentos(clienteId: number) {
  const dados = must(
    await supabase.from('orcamentos').select('id, data, status').eq('cliente_id', clienteId).order('data', { ascending: false }),
  ) as Pick<Orcamento, 'id' | 'data' | 'status'>[];
  return h(
    'section',
    null,
    h(
      'div',
      { class: 'barra' },
      h('h2', null, 'Orçamentos'),
      h('a', { class: 'botao secundario', href: `#/orcamentos/novo?cliente=${clienteId}` }, 'Novo orçamento'),
    ),
    dados.length === 0
      ? h('p', { class: 'vazio' }, 'Nenhum orçamento.')
      : h(
          'ul',
          { class: 'simples' },
          dados.map((o) =>
            h('li', null, h('a', { href: `#/orcamentos/${o.id}` }, `#${o.id} · ${dataBR(o.data)}`), ' ', h('span', { class: `status status-${o.status}` }, STATUS[o.status])),
          ),
        ),
  );
}

function botaoExcluir(id: number) {
  const msg = h('div');
  const btn = h(
    'button',
    {
      type: 'button',
      class: 'perigo',
      onclick: () => {
        if (!confirm('Excluir este cliente e todo o histórico de contato? Esta ação não pode ser desfeita.')) return;
        acao(btn, msg, async () => {
          const { error } = await supabase.from('clientes').delete().eq('id', id);
          if (error) {
            throw new Error(
              error.message.includes('foreign key') ? 'Este cliente tem orçamentos. Exclua os orçamentos antes.' : error.message,
            );
          }
          location.hash = '#/clientes';
        });
      },
    },
    'Excluir cliente',
  );
  return h('section', { class: 'zona-perigo' }, btn, msg);
}
