/*!
 * Comanda IA · Chat para ordenar
 * Pega esta línea en la página del restaurante (antes de </body>):
 *   <script src="https://TU-SERVIDOR/widget.js" data-restaurante="el-rincon-latino" async></script>
 * Opcional: data-color="#d9480f"  data-texto="Ordenar aquí"  data-posicion="izquierda"
 */
(() => {
  const script = document.currentScript;
  if (!script || window.__comandaIA) return;
  window.__comandaIA = true;

  const API = new URL(script.src).origin;
  const RID = script.dataset.restaurante;
  if (!RID) return console.warn('[Comanda IA] Falta data-restaurante en el <script>.');
  const LEFT = script.dataset.posicion === 'izquierda';
  const LABEL = script.dataset.texto || 'Ordenar aquí';
  const KEY = `comanda-ia:${RID}`;
  const TTL = 30 * 60 * 1000;

  // ── Estado guardado (si el navegador lo permite) ──
  const load = () => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && Date.now() - s.ts < TTL) return s;
    } catch { /* sin almacenamiento */ }
    return null;
  };
  const newSession = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^A-Za-z0-9_-]/g, '');
  let state = load() || { sesion: newSession(), mensajes: [], terminado: false, ts: Date.now() };
  const persist = () => {
    state.ts = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* sin almacenamiento */ }
  };

  // ── Interfaz (Shadow DOM: no choca con los estilos de la página) ──
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:2147483000;bottom:0;' + (LEFT ? 'left:0' : 'right:0');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  root.innerHTML = `
  <style>
    :host { all: initial; }
    [hidden] { display: none !important; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .launch { position: fixed; bottom: 20px; ${LEFT ? 'left' : 'right'}: 20px; display: flex; align-items: center; gap: 10px;
      background: var(--c); color: #fff; border: 0; border-radius: 999px; padding: 14px 20px 14px 16px; font-size: 16px; font-weight: 600;
      cursor: pointer; box-shadow: 0 10px 30px rgba(0,0,0,.22); transition: transform .15s; }
    .launch:hover { transform: translateY(-2px); }
    .launch svg { width: 24px; height: 24px; }
    .launch.hide { display: none; }
    .panel { position: fixed; bottom: 20px; ${LEFT ? 'left' : 'right'}: 20px; width: 370px; height: min(600px, calc(100vh - 40px));
      background: #fff; color: #1d1b18; border-radius: 18px; box-shadow: 0 20px 60px rgba(0,0,0,.28); display: none; flex-direction: column; overflow: hidden; }
    .panel.open { display: flex; animation: up .2s ease-out; }
    @keyframes up { from { opacity: 0; transform: translateY(12px); } }
    @media (max-width: 480px) { .panel { inset: 0; width: 100%; height: 100%; border-radius: 0; } }
    header { background: var(--c); color: #fff; padding: 16px 18px; display: flex; align-items: center; gap: 12px; }
    header .t { flex: 1; min-width: 0; }
    header b { display: block; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    header small { font-size: 13px; opacity: .92; display: flex; align-items: center; gap: 6px; }
    header small i { width: 8px; height: 8px; border-radius: 50%; background: #8ce99a; display: inline-block; }
    header small i.off { background: #ffc9c9; }
    header button { background: rgba(255,255,255,.18); border: 0; color: #fff; width: 34px; height: 34px; border-radius: 50%; cursor: pointer; font-size: 18px; }
    .msgs { flex: 1; overflow-y: auto; padding: 16px; background: #f6f5f2; display: flex; flex-direction: column; gap: 10px; }
    .m { max-width: 85%; padding: 10px 14px; border-radius: 16px; font-size: 15px; line-height: 1.4; white-space: pre-wrap; word-wrap: break-word; }
    .m.ia { background: #fff; border: 1px solid #ebe7df; border-bottom-left-radius: 4px; align-self: flex-start; }
    .m.yo { background: var(--c); color: #fff; border-bottom-right-radius: 4px; align-self: flex-end; }
    .m.err { background: #fff5f5; border: 1px solid #ffc9c9; color: #a61e1e; align-self: flex-start; }
    .typing { align-self: flex-start; background: #fff; border: 1px solid #ebe7df; border-radius: 16px; padding: 12px 16px; display: flex; gap: 4px; }
    .typing span { width: 7px; height: 7px; border-radius: 50%; background: #b5afa5; animation: b 1s infinite; }
    .typing span:nth-child(2) { animation-delay: .15s; } .typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes b { 50% { transform: translateY(-4px); opacity: .5; } }
    .order { align-self: stretch; background: #fff; border: 2px solid var(--c); border-radius: 14px; padding: 14px; text-align: center; }
    .order b { display: block; font-size: 22px; color: var(--c); }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 10px; background: #f6f5f2; }
    .chips button { background: #fff; border: 1px solid var(--c); color: var(--c); border-radius: 999px; padding: 7px 12px; font-size: 14px; cursor: pointer; }
    form { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #ebe7df; background: #fff; }
    input { flex: 1; border: 1px solid #ddd8cf; border-radius: 999px; padding: 11px 16px; font-size: 16px; outline: none; color: #1d1b18; background: #fff; }
    input:focus { border-color: var(--c); }
    form button { background: var(--c); border: 0; color: #fff; width: 44px; height: 44px; border-radius: 50%; cursor: pointer; display: grid; place-items: center; }
    form button:disabled { opacity: .5; }
    .new { margin: 0 16px 12px; background: var(--c); color: #fff; border: 0; border-radius: 12px; padding: 12px; font-size: 15px; font-weight: 600; cursor: pointer; }
    .foot { text-align: center; font-size: 11px; color: #a39d93; padding: 0 0 8px; background: #fff; }
  </style>
  <button class="launch" aria-label="${LABEL}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11h18M5 11a7 7 0 0 1 14 0M12 4V3M4 15h16l-1.5 4h-13z"/></svg>
    <span>${LABEL}</span>
  </button>
  <section class="panel" role="dialog" aria-label="Chat para ordenar">
    <header>
      <div class="t"><b class="name">Cargando…</b><small><i class="dot"></i><span class="st"></span></small></div>
      <button class="x" aria-label="Cerrar">✕</button>
    </header>
    <div class="msgs" aria-live="polite"></div>
    <div class="chips"></div>
    <button class="new" hidden>Hacer otro pedido</button>
    <form><input placeholder="Escribe tu pedido…" aria-label="Mensaje" maxlength="500" autocomplete="off" /><button aria-label="Enviar">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form>
    <div class="foot">Asistente con IA · Comanda IA</div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  const panel = $('.panel'), msgs = $('.msgs'), input = $('input'), sendBtn = $('form button'), chips = $('.chips');
  let config = null;
  let busy = false;

  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const money = (n) => '$' + Number(n).toFixed(2);

  function render() {
    msgs.innerHTML = '';
    if (config) addBubble('ia', config.saludo, false);
    for (const m of state.mensajes) {
      if (m.tipo === 'pedido') addOrder(m.pedido, false);
      else addBubble(m.rol, m.texto, false);
    }
    chips.hidden = state.mensajes.length > 0 || state.terminado;
    $('.new').hidden = !state.terminado;
    $('form').hidden = state.terminado;
    msgs.scrollTop = msgs.scrollHeight;
  }

  function addBubble(rol, texto, save = true) {
    const d = document.createElement('div');
    d.className = `m ${rol}`;
    d.innerHTML = esc(texto);
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    if (save && rol !== 'err') { state.mensajes.push({ rol, texto }); persist(); }
  }

  function addOrder(p, save = true) {
    const d = document.createElement('div');
    d.className = 'order';
    d.innerHTML = `✅ Pedido enviado a la cocina<b>#${esc(p.numero)}</b>Total ${money(p.total)} · listo como a las ${esc(p.listo_a_las)}`;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    if (save) { state.mensajes.push({ tipo: 'pedido', pedido: p }); persist(); }
  }

  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    busy = true;
    sendBtn.disabled = true;
    chips.hidden = true;
    addBubble('yo', text);
    input.value = '';
    const typing = document.createElement('div');
    typing.className = 'typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    msgs.appendChild(typing);
    msgs.scrollTop = msgs.scrollHeight;
    try {
      const res = await fetch(`${API}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurante: RID, sesion: state.sesion, mensaje: text }),
      });
      const data = await res.json().catch(() => ({}));
      typing.remove();
      if (!res.ok) {
        addBubble('err', data.respuesta || (data.errores || ['No se pudo enviar. Intenta otra vez.']).join(' '));
      } else {
        if (data.respuesta) addBubble('ia', data.respuesta);
        const already = state.mensajes.some((m) => m.tipo === 'pedido' && m.pedido.numero === data.pedido?.numero);
        if (data.pedido && !already) addOrder(data.pedido);
        if (data.terminado) { state.terminado = true; persist(); render(); }
      }
    } catch {
      typing.remove();
      addBubble('err', 'Sin conexión. Revisa tu internet e intenta otra vez.');
    } finally {
      busy = false;
      sendBtn.disabled = false;
      if (!state.terminado) input.focus();
    }
  }

  function open() {
    panel.classList.add('open');
    $('.launch').classList.add('hide');
    render();
    setTimeout(() => input.focus(), 50);
  }
  function close() {
    panel.classList.remove('open');
    $('.launch').classList.remove('hide');
  }

  $('.launch').onclick = open;
  $('.x').onclick = close;
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  $('form').onsubmit = (e) => { e.preventDefault(); send(input.value); };
  $('.new').onclick = () => {
    state = { sesion: newSession(), mensajes: [], terminado: false, ts: Date.now() };
    persist();
    render();
    input.focus();
  };

  const suggestions = ['¿Qué me recomiendas?', 'Quiero ordenar para recoger', '¿A qué hora cierran?'];
  chips.innerHTML = suggestions.map((s) => `<button type="button">${esc(s)}</button>`).join('');
  chips.onclick = (e) => { if (e.target.tagName === 'BUTTON') send(e.target.textContent); };

  // ── Configuración del restaurante ──
  fetch(`${API}/api/chat/config?restaurante=${encodeURIComponent(RID)}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((c) => {
      config = c;
      host.style.setProperty('--c', script.dataset.color || c.color || '#d9480f');
      $('.name').textContent = c.nombre;
      $('.st').textContent = c.estado;
      $('.dot').classList.toggle('off', !c.abierto);
      if (panel.classList.contains('open')) render();
    })
    .catch(() => { host.remove(); }); // si el chat no está activo, no se muestra nada
  host.style.setProperty('--c', script.dataset.color || '#d9480f');
})();
