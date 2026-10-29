import { supabase, must } from '../lib/supabase';
import { h, mount, lerForm, aviso, acao } from '../lib/dom';
import { centavos, moeda } from '../lib/format';
import type { Procedimento } from '../lib/tipos';

export async function paginaProcedimentos(alvo: HTMLElement) {
  const lista = h('div');
  const msg = h('div');

  async function carregar() {
    const dados = must(await supabase.from('procedimentos').select('*').order('nome')) as Procedimento[];
    mount(
      lista,
      dados.length === 0
        ? h('p', { class: 'vazio' }, 'Nenhum procedimento cadastrado.')
        : h(
            'table',
            null,
            h('thead', null, h('tr', null, h('th', null, 'Nome'), h('th', null, 'Descrição'), h('th', { class: 'num' }, 'Preço'), h('th', null, 'Ativo'), h('th'))),
            h('tbody', null, dados.map(linha)),
          ),
    );
  }

  function linha(p: Procedimento) {
    const nome = h('input', { value: p.nome, required: true });
    const descricao = h('input', { value: p.descricao ?? '' });
    const preco = h('input', { type: 'number', step: '0.01', min: '0', value: Number(p.preco).toFixed(2), class: 'num' });
    const ativo = h('input', { type: 'checkbox', checked: p.ativo, title: 'Inativos não aparecem para novos orçamentos' });
    const btn = h('button', { type: 'button', class: 'secundario' }, 'Salvar');
    btn.addEventListener('click', () =>
      acao(btn, msg, async () => {
        must(
          await supabase
            .from('procedimentos')
            .update({ nome: nome.value.trim(), descricao: descricao.value.trim() || null, preco: Number(preco.value), ativo: ativo.checked })
            .eq('id', p.id),
        );
        msg.replaceChildren(aviso(`"${nome.value}" salvo (${moeda(centavos(preco.value))}).`, 'ok'));
      }),
    );
    return h('tr', null, h('td', null, nome), h('td', null, descricao), h('td', null, preco), h('td', null, ativo), h('td', null, btn));
  }

  const btnNovo = h('button', { type: 'submit' }, 'Adicionar');
  const form = h(
    'form',
    {
      class: 'linha',
      onsubmit: (e: Event) => {
        e.preventDefault();
        const v = lerForm(form);
        acao(btnNovo, msg, async () => {
          must(await supabase.from('procedimentos').insert({ nome: v.nome, descricao: v.descricao || null, preco: Number(v.preco) }));
          form.reset();
          await carregar();
        });
      },
    },
    h('input', { name: 'nome', placeholder: 'Nome (ex.: Restauração)', required: true }),
    h('input', { name: 'descricao', placeholder: 'Descrição (opcional)' }),
    h('input', { name: 'preco', type: 'number', step: '0.01', min: '0', placeholder: 'Preço', required: true, class: 'num' }),
    btnNovo,
  );

  mount(
    alvo,
    h('h1', null, 'Procedimentos e produtos'),
    h('p', { class: 'dica' }, 'O preço aqui é o padrão sugerido no orçamento; dá para ajustar item a item.'),
    form,
    msg,
    lista,
  );
  await carregar();
}
