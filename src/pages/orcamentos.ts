import { supabase, must } from '../lib/supabase';
import { h, mount, campo, aviso, acao } from '../lib/dom';
import { centavos, moeda, dataBR, somarDias, hojeISO, STATUS, type Status } from '../lib/format';
import type { Cliente, Clinica, ItemOrcamento, Orcamento, Procedimento } from '../lib/tipos';

type ItemResumo = Pick<ItemOrcamento, 'quantidade' | 'preco_unitario'>;
const totalItens = (itens: ItemResumo[]) =>
  itens.reduce((s, i) => s + i.quantidade * centavos(i.preco_unitario), 0);

export async function listaOrcamentos(alvo: HTMLElement) {
  const lista = h('div');
  const filtro = h(
    'select',
    { class: 'filtro' },
    h('option', { value: '' }, 'Todos os status'),
    Object.entries(STATUS).map(([v, r]) => h('option', { value: v }, r)),
  );

  async function carregar() {
    let q = supabase
      .from('orcamentos')
      .select('id, data, status, clientes(nome), orcamento_itens(quantidade, preco_unitario)')
      .order('id', { ascending: false })
      .limit(200);
    if (filtro.value) q = q.eq('status', filtro.value);
    const dados = must(await q) as unknown as (Pick<Orcamento, 'id' | 'data' | 'status'> & {
      clientes: { nome: string } | null;
      orcamento_itens: ItemResumo[];
    })[];
    mount(
      lista,
      dados.length === 0
        ? h('p', { class: 'vazio' }, 'Nenhum orçamento.')
        : h(
            'table',
            null,
            h('thead', null, h('tr', null, h('th', null, 'Nº'), h('th', null, 'Cliente'), h('th', null, 'Data'), h('th', { class: 'num' }, 'Total'), h('th', null, 'Status'))),
            h(
              'tbody',
              null,
              dados.map((o) =>
                h(
                  'tr',
                  { class: 'clicavel', onclick: () => (location.hash = `#/orcamentos/${o.id}`) },
                  h('td', null, h('a', { href: `#/orcamentos/${o.id}` }, `#${o.id}`)),
                  h('td', null, o.clientes?.nome ?? ''),
                  h('td', null, dataBR(o.data)),
                  h('td', { class: 'num' }, moeda(totalItens(o.orcamento_itens))),
                  h('td', null, h('span', { class: `status status-${o.status}` }, STATUS[o.status])),
                ),
              ),
            ),
          ),
    );
  }

  filtro.addEventListener('change', () => carregar().catch((e) => mount(lista, aviso(String(e.message ?? e)))));
  mount(
    alvo,
    h('div', { class: 'barra' }, h('h1', null, 'Orçamentos'), filtro, h('a', { class: 'botao', href: '#/orcamentos/novo' }, 'Novo orçamento')),
    lista,
  );
  await carregar();
}

export async function editorOrcamento(alvo: HTMLElement, id: number | null) {
  const [clientes, procedimentos, orc, itensSalvos] = await Promise.all([
    supabase.from('clientes').select('id, nome').order('nome').then(must) as Promise<Pick<Cliente, 'id' | 'nome'>[]>,
    supabase.from('procedimentos').select('*').order('nome').then(must) as Promise<Procedimento[]>,
    id ? (supabase.from('orcamentos').select('*').eq('id', id).single().then(must) as Promise<Orcamento>) : null,
    id
      ? (supabase.from('orcamento_itens').select('*').eq('orcamento_id', id).order('ordem').then(must) as Promise<ItemOrcamento[]>)
      : [],
  ]);

  if (clientes.length === 0) {
    mount(alvo, h('h1', null, 'Novo orçamento'), h('p', null, 'Cadastre um cliente primeiro. ', h('a', { href: '#/clientes/novo' }, 'Novo cliente')));
    return;
  }

  const clienteInicial = orc?.cliente_id ?? Number(new URLSearchParams(location.hash.split('?')[1]).get('cliente')) ?? 0;
  const selCliente = h(
    'select',
    { required: true },
    h('option', { value: '' }, '— escolha —'),
    clientes.map((c) => h('option', { value: String(c.id), selected: c.id === clienteInicial }, c.nome)),
  );
  const data = h('input', { type: 'date', value: orc?.data ?? hojeISO(), required: true });
  const validade = h('input', { type: 'number', min: '1', value: String(orc?.validade_dias ?? 30), required: true });
  const status = h(
    'select',
    null,
    Object.entries(STATUS).map(([v, r]) => h('option', { value: v, selected: v === (orc?.status ?? 'aberto') }, r)),
  );
  const observacoes = h('textarea', { rows: 3 }, orc?.observacoes ?? '');

  const corpo = h('tbody');
  const totalEl = h('strong');
  const ativos = procedimentos.filter((p) => p.ativo);

  function atualizarTotal() {
    let total = 0;
    for (const tr of corpo.rows) {
      const q = Number((tr.querySelector('[data-q]') as HTMLInputElement).value) || 0;
      const p = centavos((tr.querySelector('[data-p]') as HTMLInputElement).value || 0);
      (tr.querySelector('[data-sub]') as HTMLElement).textContent = moeda(q * p);
      total += q * p;
    }
    totalEl.textContent = moeda(total);
  }

  function linhaItem(item?: ItemOrcamento) {
    // inclui o procedimento atual mesmo se foi inativado depois
    const opcoes = item?.procedimento_id && !ativos.some((p) => p.id === item.procedimento_id)
      ? [...ativos, ...procedimentos.filter((p) => p.id === item.procedimento_id)]
      : ativos;
    const sel = h(
      'select',
      null,
      h('option', { value: '' }, '— avulso —'),
      opcoes.map((p) => h('option', { value: String(p.id), selected: p.id === item?.procedimento_id }, `${p.nome} (${moeda(centavos(p.preco))})`)),
    );
    const desc = h('input', { value: item?.descricao ?? '', required: true, 'data-d': true });
    const qtd = h('input', { type: 'number', min: '1', step: '1', value: String(item?.quantidade ?? 1), required: true, class: 'num curto', 'data-q': true });
    const preco = h('input', { type: 'number', min: '0', step: '0.01', value: item ? Number(item.preco_unitario).toFixed(2) : '', required: true, class: 'num', 'data-p': true });
    const obs = h('input', { value: item?.observacao ?? '', placeholder: 'ex.: 10% de desconto', 'data-o': true });

    sel.addEventListener('change', () => {
      const p = procedimentos.find((x) => String(x.id) === sel.value);
      if (p) {
        desc.value = p.nome;
        preco.value = Number(p.preco).toFixed(2);
      }
      atualizarTotal();
    });
    const tr = h(
      'tr',
      { oninput: atualizarTotal },
      h('td', null, sel),
      h('td', null, desc),
      h('td', null, qtd),
      h('td', null, preco),
      h('td', null, obs),
      h('td', { class: 'num', 'data-sub': true }),
      h('td', null, h('button', { type: 'button', class: 'link', title: 'Remover item', onclick: () => { tr.remove(); atualizarTotal(); } }, '✕')),
    );
    corpo.appendChild(tr);
    atualizarTotal();
  }

  itensSalvos.forEach(linhaItem);
  if (itensSalvos.length === 0) linhaItem();

  const msg = h('div');
  const btnSalvar = h('button', { type: 'submit' }, 'Salvar');
  const form = h(
    'form',
    {
      onsubmit: (e: Event) => {
        e.preventDefault();
        const itens = [...corpo.rows].map((tr) => ({
          procedimento_id: Number(tr.querySelector('select')!.value) || null,
          descricao: (tr.querySelector('[data-d]') as HTMLInputElement).value.trim(),
          quantidade: Number((tr.querySelector('[data-q]') as HTMLInputElement).value),
          preco_unitario: (tr.querySelector('[data-p]') as HTMLInputElement).value,
          observacao: (tr.querySelector('[data-o]') as HTMLInputElement).value.trim(),
        }));
        acao(btnSalvar, msg, async () => {
          if (itens.length === 0) throw new Error('Adicione pelo menos um item.');
          const novoId = must(
            await supabase.rpc('salvar_orcamento', {
              p_id: id,
              p_orcamento: {
                cliente_id: Number(selCliente.value),
                data: data.value,
                validade_dias: Number(validade.value),
                status: status.value as Status,
                observacoes: observacoes.value.trim(),
              },
              p_itens: itens,
            }),
          ) as number;
          if (id) msg.replaceChildren(aviso('Salvo.', 'ok'));
          else location.hash = `#/orcamentos/${novoId}`;
        });
      },
    },
    h(
      'div',
      { class: 'grade' },
      campo('Cliente *', selCliente),
      campo('Data', data),
      campo('Validade (dias)', validade),
      campo('Status', status),
    ),
    h(
      'table',
      { class: 'itens' },
      h('thead', null, h('tr', null, h('th', null, 'Catálogo'), h('th', null, 'Descrição'), h('th', null, 'Qtd'), h('th', null, 'Valor unit.'), h('th', null, 'Obs.'), h('th', { class: 'num' }, 'Subtotal'), h('th'))),
      corpo,
    ),
    h('div', { class: 'barra' }, h('button', { type: 'button', class: 'secundario', onclick: () => linhaItem() }, '+ Adicionar item'), h('p', { class: 'total' }, 'Total: ', totalEl)),
    campo('Observações gerais', observacoes),
    h(
      'div',
      { class: 'acoes' },
      btnSalvar,
      id ? h('a', { class: 'botao secundario', href: `#/orcamentos/${id}/imprimir`, target: '_blank', rel: 'noopener' }, 'Imprimir / PDF') : null,
      msg,
    ),
  );

  mount(
    alvo,
    h('div', { class: 'barra' }, h('h1', null, id ? `Orçamento #${id}` : 'Novo orçamento'), h('a', { href: '#/orcamentos' }, '← Orçamentos')),
    form,
    id ? botaoExcluir(id) : null,
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
        if (!confirm(`Excluir o orçamento #${id}? Esta ação não pode ser desfeita.`)) return;
        acao(btn, msg, async () => {
          must(await supabase.from('orcamentos').delete().eq('id', id));
          location.hash = '#/orcamentos';
        });
      },
    },
    'Excluir orçamento',
  );
  return h('section', { class: 'zona-perigo' }, btn, msg);
}

export async function imprimirOrcamento(alvo: HTMLElement, id: number) {
  const [clinica, orc, itens] = await Promise.all([
    supabase.from('clinica').select('*').single().then(must) as Promise<Clinica>,
    supabase.from('orcamentos').select('*, clientes(*)').eq('id', id).single().then(must) as Promise<Orcamento & { clientes: Cliente }>,
    supabase.from('orcamento_itens').select('*').eq('orcamento_id', id).order('ordem').then(must) as Promise<ItemOrcamento[]>,
  ]);
  const c = orc.clientes;
  document.title = `Orçamento ${id} - ${c.nome}`;
  const linhaDado = (rotulo: string, valor: string | null) => (valor ? h('p', null, h('strong', null, `${rotulo}: `), valor) : null);

  mount(
    alvo,
    h('div', { class: 'no-print barra-impressao' }, h('button', { type: 'button', onclick: () => window.print() }, 'Imprimir / Salvar PDF')),
    h(
      'article',
      { class: 'folha' },
      h(
        'header',
        { class: 'folha-topo' },
        h('div', null, h('h1', null, clinica.nome || 'Consultório'), clinica.profissional ? h('p', null, [clinica.profissional, clinica.registro].filter(Boolean).join(' · ')) : null),
        h('div', { class: 'folha-num' }, h('h2', null, `Orçamento nº ${id}`), h('p', null, `Emitido em ${dataBR(orc.data)}`), h('p', null, `Válido até ${dataBR(somarDias(orc.data, orc.validade_dias))}`)),
      ),
      h('section', null, h('h3', null, 'Paciente'), linhaDado('Nome', c.nome), linhaDado('Telefone', c.telefone), linhaDado('E-mail', c.email)),
      h(
        'table',
        null,
        h('thead', null, h('tr', null, h('th', null, 'Descrição'), h('th', null, 'Obs.'), h('th', { class: 'num' }, 'Qtd'), h('th', { class: 'num' }, 'Valor unit.'), h('th', { class: 'num' }, 'Subtotal'))),
        h(
          'tbody',
          null,
          itens.map((i) =>
            h(
              'tr',
              null,
              h('td', null, i.descricao),
              h('td', null, i.observacao ?? ''),
              h('td', { class: 'num' }, String(i.quantidade)),
              h('td', { class: 'num' }, moeda(centavos(i.preco_unitario))),
              h('td', { class: 'num' }, moeda(i.quantidade * centavos(i.preco_unitario))),
            ),
          ),
        ),
        h('tfoot', null, h('tr', null, h('td', { colSpan: 4, class: 'num' }, 'Total'), h('td', { class: 'num' }, h('strong', null, moeda(totalItens(itens)))))),
      ),
      orc.observacoes ? h('section', null, h('h3', null, 'Observações'), h('p', { class: 'pre' }, orc.observacoes)) : null,
      h('div', { class: 'assinatura' }, h('span', null, clinica.profissional || 'Assinatura')),
      h('footer', { class: 'folha-rodape' }, [clinica.endereco, clinica.telefone, clinica.email].filter(Boolean).join(' · ')),
    ),
  );
}
