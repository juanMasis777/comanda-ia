// Utilidades compartidas por las páginas del panel.
const params = new URLSearchParams(location.search);
export const token = params.get('token') || '';
const headers = { 'Content-Type': 'application/json', ...(token ? { 'x-dashboard-token': token } : {}) };

export async function api(url, opts = {}) {
  const res = await fetch(url, { headers, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data.errores || [data.error || `Error ${res.status}`]).join(' '));
    err.errores = data.errores || [err.message];
    err.status = res.status;
    throw err;
  }
  return data;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const money = (n) => '$' + Number(n || 0).toFixed(2);

export function describeLine(l) {
  const opts = Object.values(l.opciones || {});
  let t = `${l.cantidad} x ${l.nombre}`;
  if (opts.length) t += ` (${opts.join(', ')})`;
  if (l.extras?.length) t += ` con ${l.extras.join(' y ')}`;
  return t;
}

/** Arma la barra de arriba con navegación y selector de restaurante. */
export async function setupTop(active, onChange) {
  const list = await api('/api/restaurantes');
  let current = params.get('r') && list.some((r) => r.id === params.get('r')) ? params.get('r') : list[0]?.id;
  const link = (page, label) => {
    const q = new URLSearchParams();
    if (token) q.set('token', token);
    if (current) q.set('r', current);
    return `<a href="/${page}?${q}" class="${active === page ? 'on' : ''}">${label}</a>`;
  };
  const top = document.querySelector('.top');
  const render = () => {
    top.innerHTML = `
      <h1>Comanda <span>IA</span></h1>
      <nav>${link('index.html', 'Pedidos')}${link('menu.html', 'Menú')}${link('cocina.html', 'Cocina')}</nav>
      <select id="rest" aria-label="Restaurante" style="width:auto">${list
        .map((r) => `<option value="${esc(r.id)}" ${r.id === current ? 'selected' : ''}>${esc(r.nombre)}</option>`)
        .join('')}</select>`;
    top.querySelector('#rest').onchange = (e) => {
      current = e.target.value;
      const q = new URLSearchParams(location.search);
      q.set('r', current);
      history.replaceState(null, '', `?${q}`);
      render();
      onChange?.(current);
    };
  };
  render();
  return current;
}
