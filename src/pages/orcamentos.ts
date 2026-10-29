import { supabase, must } from '../lib/supabase';
import { h, mount, campo, aviso, acao } from '../lib/dom';
import { centavos, moeda, dataBR, somarDias, hojeISO, STATUS, type Status } from '../lib/format';
import { calcularTotais, liquidoItem, pct, type ItemCalc, type TipoDesconto } from '../lib/calculo';
import type { Cliente, Clinica, ItemOrcamento, Orcamento, Procedimento } from '../lib/tipos';
import { termoBusca } from './clientes';

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
      .select('id, data, status, desconto_tipo, desconto_valor, clientes(nome), orcamento_itens(quantidade, preco_unitario, desconto_pct)')
      .order('id', { ascending: false })
      .limit(200);
    if (filtro.value) q = q.eq('status', filtro.value);
    const dados = must(await q) as unknown as (Pick<Orcamento, 'id' | 'data' | 'status' | 'desconto_tipo' | 'desconto_valor'> & {
      clientes: { nome: string } | null;
      orcamento_itens: ItemCalc[];
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
                  h('td', { class: 'num' }, moeda(calcularTotais(o.orcamento_itens, o.desconto_tipo, o.desconto_valor).total)),
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

type ClienteResumo = Pick<Cliente, 'id' | 'nome' | 'telefone'>;

/**
 * Campo de cliente com busca no servidor: a lista completa não cabe numa
 * caixa de seleção (a API devolve no máximo 1000 linhas por consulta).
 */
function buscaCliente(inicial: ClienteResumo | null) {
  let escolhido: ClienteResumo | null = inicial;
  const entrada = h('input', {
    type: 'search',
    value: inicial?.nome ?? '',
    placeholder: 'Digite o nome ou telefone',
    autocomplete: 'off',
    required: true,
  });
  const opcoes = h('ul', { class: 'opcoes', hidden: true });

  function escolher(c: ClienteResumo) {
    escolhido = c;
    entrada.value = c.nome;
    entrada.setCustomValidity('');
    opcoes.hidden = true;
  }

  async function buscar() {
    const t = termoBusca(entrada.value);
    if (!t) return void (opcoes.hidden = true);
    const achados = must(
      await supabase.from('clientes').select('id, nome, telefone').or(`nome.ilike.*${t}*,telefone.ilike.*${t}*`).order('nome').limit(15),
    ) as ClienteResumo[];
    mount(
      opcoes,
      achados.length === 0
        ? h('li', { class: 'vazio' }, 'Nenhum cliente encontrado. ', h('a', { href: '#/clientes/novo' }, 'Cadastrar novo'))
        : achados.map((c) =>
            h(
              'li',
              null,
              h(
                'button',
                // mousedown: escolhe antes de o campo perder o foco e fechar a lista
                { type: 'button', onmousedown: (e: Event) => (e.preventDefault(), escolher(c)) },
                c.nome,
                c.telefone ? h('small', null, ` · ${c.telefone}`) : null,
              ),
            ),
          ),
    );
    opcoes.hidden = false;
  }

  let timer: number | undefined;
  entrada.addEventListener('input', () => {
    escolhido = null; // mudou o texto: precisa escolher de novo na lista
    entrada.setCustomValidity('Escolha o cliente na lista.');
    clearTimeout(timer);
    timer = window.setTimeout(() => buscar().catch((e) => mount(opcoes, h('li', null, String(e.message ?? e)))), 250);
  });
  entrada.addEventListener('blur', () => window.setTimeout(() => (opcoes.hidden = true), 150));

  return { el: h('div', { class: 'busca-cliente' }, entrada, opcoes), id: () => escolhido?.id ?? null };
}

export async function editorOrcamento(alvo: HTMLElement, id: number | null) {
  const [procedimentos, orc, itensSalvos] = await Promise.all([
    supabase.from('procedimentos').select('*').order('nome').then(must) as Promise<Procedimento[]>,
    id ? (supabase.from('orcamentos').select('*').eq('id', id).single().then(must) as Promise<Orcamento>) : null,
    id
      ? (supabase.from('orcamento_itens').select('*').eq('orcamento_id', id).order('ordem').then(must) as Promise<ItemOrcamento[]>)
      : [],
  ]);
  // versão do orçamento que está na tela; o banco recusa salvar se outra pessoa salvou depois
  let versao = orc?.atualizado_em ?? null;

  const clienteInicialId = orc?.cliente_id ?? Number(new URLSearchParams(location.hash.split('?')[1]).get('cliente'));
  const clienteInicial = clienteInicialId
    ? ((must(await supabase.from('clientes').select('id, nome, telefone').eq('id', clienteInicialId).maybeSingle()) as ClienteResumo | null))
    : null;
  const selCliente = buscaCliente(clienteInicial);
  const data = h('input', { type: 'date', value: orc?.data ?? hojeISO(), required: true });
  const validade = h('input', { type: 'number', min: '1', value: String(orc?.validade_dias ?? 30), required: true });
  const status = h(
    'select',
    null,
    Object.entries(STATUS).map(([v, r]) => h('option', { value: v, selected: v === (orc?.status ?? 'aberto') }, r)),
  );
  const observacoes = h('textarea', { rows: 3 }, orc?.observacoes ?? '');

  const descTipo = h(
    'select',
    { class: 'curto', title: 'Tipo do desconto geral' },
    h('option', { value: 'percentual', selected: (orc?.desconto_tipo ?? 'percentual') === 'percentual' }, '%'),
    h('option', { value: 'valor', selected: orc?.desconto_tipo === 'valor' }, 'R$'),
  );
  const descValor = h('input', {
    type: 'number',
    min: '0',
    step: '0.01',
    value: String(Number(orc?.desconto_valor ?? 0)),
    class: 'num',
    title: 'Desconto aplicado sobre a soma dos itens',
  });

  const corpo = h('tbody');
  const brutoEl = h('span');
  const descItensEl = h('span');
  const descGeralEl = h('span');
  const totalEl = h('strong');
  const linhaDescItens = h('div', null, h('span', null, 'Descontos nos itens'), descItensEl);
  const ativos = procedimentos.filter((p) => p.ativo);

  const valorCampo = (tr: HTMLTableRowElement, attr: string) => (tr.querySelector(`[${attr}]`) as HTMLInputElement).value;

  function lerItens() {
    return [...corpo.rows].map((tr) => ({
      procedimento_id: Number(tr.querySelector('select')!.value) || null,
      descricao: valorCampo(tr, 'data-d').trim(),
      quantidade: Number(valorCampo(tr, 'data-q')),
      preco_unitario: valorCampo(tr, 'data-p'),
      desconto_pct: Number(valorCampo(tr, 'data-dp')) || 0,
      observacao: valorCampo(tr, 'data-o').trim(),
    }));
  }

  function atualizarTotal() {
    const itens = lerItens();
    [...corpo.rows].forEach((tr, n) => {
      (tr.querySelector('[data-sub]') as HTMLElement).textContent = moeda(liquidoItem(itens[n]));
    });
    descValor.max = descTipo.value === 'percentual' ? '100' : '';
    const t = calcularTotais(itens, descTipo.value as TipoDesconto, descValor.value);
    brutoEl.textContent = moeda(t.bruto);
    descItensEl.textContent = `− ${moeda(t.descontoItens)}`;
    linhaDescItens.hidden = t.descontoItens === 0;
    descGeralEl.textContent = `− ${moeda(t.descontoGeral)}`;
    totalEl.textContent = moeda(t.total);
  }
  descTipo.addEventListener('change', atualizarTotal);
  descValor.addEventListener('input', atualizarTotal);

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
    const descPct = h('input', { type: 'number', min: '0', max: '100', step: '0.01', value: String(Number(item?.desconto_pct ?? 0)), class: 'num curto', 'data-dp': true, title: 'Desconto deste item, em %' });
    const obs = h('input', { value: item?.observacao ?? '', placeholder: 'ex.: dente 36', 'data-o': true });

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
      h('td', null, descPct),
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
        const itens = lerItens();
        acao(btnSalvar, msg, async () => {
          if (itens.length === 0) throw new Error('Adicione pelo menos um item.');
          const clienteId = selCliente.id();
          if (!clienteId) throw new Error('Escolha o cliente na lista.');
          const res = await supabase.rpc('salvar_orcamento', {
            p_id: id,
            p_orcamento: {
              cliente_id: clienteId,
              data: data.value,
              validade_dias: Number(validade.value),
              status: status.value as Status,
              observacoes: observacoes.value.trim(),
              desconto_tipo: descTipo.value as TipoDesconto,
              desconto_valor: Number(descValor.value) || 0,
              atualizado_em: versao,
            },
            p_itens: itens,
          });
          if (res.error?.message.includes('CONFLITO_EDICAO')) {
            throw new Error(
              'Outra pessoa salvou este orçamento depois que você abriu. Suas alterações NÃO foram salvas: anote o que mudou, recarregue a página (F5) e faça de novo.',
            );
          }
          const novoId = must(res) as number;
          if (!id) return void (location.hash = `#/orcamentos/${novoId}`);
          const atual = must(await supabase.from('orcamentos').select('atualizado_em').eq('id', id).single());
          versao = atual.atualizado_em;
          msg.replaceChildren(aviso('Salvo.', 'ok'));
        });
      },
    },
    h(
      'div',
      { class: 'grade' },
      campo('Cliente *', selCliente.el),
      campo('Data', data),
      campo('Validade (dias)', validade),
      campo('Status', status),
    ),
    h(
      'table',
      { class: 'itens' },
      h('thead', null, h('tr', null, h('th', null, 'Catálogo'), h('th', null, 'Descrição'), h('th', null, 'Qtd'), h('th', null, 'Valor unit.'), h('th', null, 'Desc. %'), h('th', null, 'Obs.'), h('th', { class: 'num' }, 'Subtotal'), h('th'))),
      corpo,
    ),
    h(
      'div',
      { class: 'barra barra-topo' },
      h('button', { type: 'button', class: 'secundario', onclick: () => linhaItem() }, '+ Adicionar item'),
      h(
        'div',
        { class: 'resumo' },
        h('div', null, h('span', null, 'Soma dos itens'), brutoEl),
        linhaDescItens,
        h('div', null, h('label', { class: 'desconto-geral' }, 'Desconto geral ', descValor, descTipo), descGeralEl),
        h('div', { class: 'resumo-total' }, h('span', null, 'Total'), totalEl),
      ),
    ),
    campo('Observações gerais', observacoes),
    h(
      'div',
      { class: 'acoes' },
      btnSalvar,
      id ? h('a', { class: 'botao secundario', href: `#/orcamentos/${id}/imprimir`, target: '_blank', rel: 'noopener' }, 'Imprimir / PDF') : null,
      msg,
      id ? botaoExcluir(id) : null,
    ),
  );

  mount(
    alvo,
    h('div', { class: 'barra' }, h('h1', null, id ? `Orçamento #${id}` : 'Novo orçamento'), h('a', { href: '#/orcamentos' }, '← Orçamentos')),
    form,
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
  return h('span', { class: 'excluir' }, msg, btn);
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

  const t = calcularTotais(itens, orc.desconto_tipo, orc.desconto_valor);
  const temDescItem = itens.some((i) => Number(i.desconto_pct) > 0);
  const colunas = temDescItem ? 5 : 4;
  const linhaRodape = (rotulo: string, valor: string, classe?: string) =>
    h('tr', { class: classe }, h('td', { colSpan: colunas - 1, class: 'num' }, rotulo), h('td', { class: 'num' }, valor));
  const rotuloDescGeral =
    orc.desconto_tipo === 'percentual' ? `Desconto (${pct(orc.desconto_valor)})` : 'Desconto';

  mount(
    alvo,
    h('div', { class: 'no-print barra-impressao' }, h('button', { type: 'button', onclick: () => window.print() }, 'Imprimir / Salvar PDF')),
    h(
      'article',
      { class: 'folha' },
      h(
        'header',
        { class: 'folha-topo' },
        // a logo normalmente já traz nome e registro; sem logo, vai em texto
        clinica.logo
          ? h('img', { class: 'folha-logo', src: clinica.logo, alt: [clinica.profissional || clinica.nome, clinica.registro].filter(Boolean).join(' · ') })
          : h('div', null, h('h1', null, clinica.nome || 'Consultório'), clinica.profissional ? h('p', null, [clinica.profissional, clinica.registro].filter(Boolean).join(' · ')) : null),
        h('div', { class: 'folha-num' }, h('h2', null, `Orçamento nº ${id}`), h('p', null, `Emitido em ${dataBR(orc.data)}`), h('p', null, `Válido até ${dataBR(somarDias(orc.data, orc.validade_dias))}`)),
      ),
      h('section', null, h('h3', null, 'Paciente'), linhaDado('Nome', c.nome), linhaDado('Telefone', c.telefone), linhaDado('E-mail', c.email)),
      h(
        'table',
        null,
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', null, 'Descrição'),
            h('th', { class: 'num' }, 'Qtd'),
            h('th', { class: 'num' }, 'Valor unit.'),
            temDescItem ? h('th', { class: 'num' }, 'Desc.') : null,
            h('th', { class: 'num' }, 'Subtotal'),
          ),
        ),
        h(
          'tbody',
          null,
          itens.map((i) =>
            h(
              'tr',
              null,
              h('td', null, i.descricao, i.observacao ? h('small', { class: 'obs-item' }, i.observacao) : null),
              h('td', { class: 'num' }, String(i.quantidade)),
              h('td', { class: 'num' }, moeda(centavos(i.preco_unitario))),
              temDescItem ? h('td', { class: 'num' }, Number(i.desconto_pct) > 0 ? pct(i.desconto_pct) : '—') : null,
              h('td', { class: 'num' }, moeda(liquidoItem(i))),
            ),
          ),
        ),
        h(
          'tfoot',
          null,
          t.total !== t.bruto ? linhaRodape('Valor sem desconto', moeda(t.bruto), 'riscado') : null,
          t.descontoItens > 0 ? linhaRodape('Desconto nos itens', `− ${moeda(t.descontoItens)}`) : null,
          t.descontoGeral > 0 ? linhaRodape(rotuloDescGeral, `− ${moeda(t.descontoGeral)}`) : null,
          h('tr', { class: 'folha-total' }, h('td', { colSpan: colunas - 1, class: 'num' }, 'Total'), h('td', { class: 'num' }, h('strong', null, moeda(t.total)))),
        ),
      ),
      orc.observacoes ? h('section', null, h('h3', null, 'Observações'), h('p', { class: 'pre' }, orc.observacoes)) : null,
      h(
        'div',
        { class: 'assinatura' },
        h('span', null, clinica.profissional || 'Assinatura'),
        clinica.registro ? h('small', null, clinica.registro) : null,
      ),
      h('footer', { class: 'folha-rodape' }, [clinica.endereco, clinica.telefone, clinica.email].filter(Boolean).join(' · ')),
    ),
  );
}
