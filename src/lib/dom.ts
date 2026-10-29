// Criação de elementos sem innerHTML: todo texto vira nó de texto, então
// nome de cliente com "<script>" aparece como texto e não executa (anti-XSS).

type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> | null;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key in el && key !== 'list') {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function mount(root: HTMLElement, ...children: Child[]) {
  root.replaceChildren();
  append(root, children);
}

/** Lê um formulário como objeto de strings (campos vazios viram ''). */
export function lerForm(form: HTMLFormElement): Record<string, string> {
  const out: Record<string, string> = {};
  new FormData(form).forEach((v, k) => (out[k] = String(v).trim()));
  return out;
}

export function campo(label: string, input: HTMLElement, dica?: string) {
  return h('label', { class: 'campo' }, h('span', null, label), input, dica ? h('small', null, dica) : null);
}

export function aviso(texto: string, tipo: 'erro' | 'ok' | 'info' = 'erro') {
  return h('p', { class: `aviso aviso-${tipo}`, role: tipo === 'erro' ? 'alert' : 'status' }, texto);
}

/** Executa uma ação assíncrona desabilitando o botão e mostrando erro no alvo. */
export async function acao(btn: HTMLButtonElement | null, alvo: HTMLElement, fn: () => Promise<void>) {
  alvo.replaceChildren();
  if (btn) btn.disabled = true;
  try {
    await fn();
  } catch (e) {
    alvo.replaceChildren(aviso(e instanceof Error ? e.message : String(e)));
  } finally {
    if (btn) btn.disabled = false;
  }
}
