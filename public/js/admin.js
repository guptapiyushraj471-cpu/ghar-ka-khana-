/**
 * Ghar ka Khana — admin.js
 * Admin Dashboard for Pure-Veg Cloud Kitchen
 *
 * Wire these IDs:
 * #admin-key (input inside a form), #orders (list/container), #search (input),
 * #filters (wrapper with buttons having data-status), #autoRefreshToggle (button)
 *
 * Sorting (optional): set state.sort to 'AI' | 'Newest' | 'Oldest' | 'High Value'
 */

(() => {
  // ---------- Config ----------
  const STATUS = ['PLACED', 'CONFIRMED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'];

  const PRIORITY_WEIGHTS = {
    // how much each sub-score matters (tweak as you like)
    value: 0.5,               // order value
    staleness: 0.3,           // minutes since placed
    status: {                 // stage urgency
      PLACED: 5,
      CONFIRMED: 4,
      DISPATCHED: 2,
      DELIVERED: 1,
      CANCELLED: 0
    },
    itemBoost: 2,             // if items include priority keywords
    timeWindowBoost: 1        // lunch/dinner rush
  };
  const PRIORITY_KEYWORDS = ['paneer', 'thali', 'dal', 'sabzi'];

  const POLL_INTERVAL_MS = 15000;

  // ---------- State ----------
  const state = {
    adminKey: '',
    orders: [],
    filters: { status: 'ALL' },
    search: '',
    polling: null,
    sort: 'AI',
    lastRenderHash: ''
  };

  // ---------- Utils ----------
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const debounce = (fn, ms) => {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };

  const formatINR = n =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n || 0));

  const timeAgo = iso => {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.max(0, Math.floor(diffMs / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  };

  const safeTxt = s => String(s ?? '').replace(/[<>&"']/g, c => ({
    '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&#39;'
  }[c]));

  const toast = (msg, type = 'info') =>
    (window.UI?.toast?.(msg, type)) ?? alert(msg);

  const confirmDialog = msg =>
    (window.UI?.confirmDialog?.(msg)) ?? Promise.resolve(confirm(msg));

  const fetchJSON = async (url, opts = {}) => {
    if (window.Util?.fetchJSON) return window.Util.fetchJSON(url, opts);
    const res = await fetch(url, {
      ...opts,
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', ...(opts.headers || {}) }
    });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    return res.json();
  };

  const encodeRFC3986 = str =>
    encodeURIComponent(str).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16)}`);

  // ---------- Priority Scoring ----------
  function prioritize(list) {
    const now = Date.now();

    list.forEach(o => {
      const minutesSincePlaced = Math.max(0, (now - new Date(o.createdAt).getTime()) / 60000);

      // Normalized value score (assuming typical basket up to ₹1000; clamp to 1)
      const valueScore = Math.min(1, (Number(o.total || 0)) / 1000);

      // Staleness score — more minutes => closer to 1, with soft cap ~90m
      const stalenessScore = Math.min(1, minutesSincePlaced / 90);

      // Status urgency mapped 0..1 from table
      const statusRaw = PRIORITY_WEIGHTS.status[o.status] ?? 0;
      const statusScore = statusRaw / Math.max(...Object.values(PRIORITY_WEIGHTS.status));

      // Keyword boost if any of the items match configured keywords
      const names = (o.items || []).map(i => String(i.name || '').toLowerCase());
      const hasKeyword = PRIORITY_KEYWORDS.some(k => names.some(n => n.includes(k.toLowerCase())));
      const itemBoost = hasKeyword ? PRIORITY_WEIGHTS.itemBoost : 0;

      // Time window boost for lunch (12–15) & dinner (19–22)
      const hr = new Date().getHours();
      const inRush = (hr >= 12 && hr <= 15) || (hr >= 19 && hr <= 22);
      const timeWindowBoost = inRush ? PRIORITY_WEIGHTS.timeWindowBoost : 0;

      // Weighted base
      const base =
        valueScore * PRIORITY_WEIGHTS.value +
        stalenessScore * PRIORITY_WEIGHTS.staleness +
        statusScore;

      // Final score
      o.priorityScore = Number((base + itemBoost + timeWindowBoost).toFixed(2));
      o._priorityExpl = { valueScore, stalenessScore, statusScore, itemBoost, timeWindowBoost, minutesSincePlaced };
    });
  }

  function explainPriority(o) {
    const p = o._priorityExpl || {};
    return [
      `Value:${(p.valueScore ?? 0).toFixed(2)}`,
      `Age:${(p.stalenessScore ?? 0).toFixed(2)} (${Math.round(p.minutesSincePlaced || 0)}m)`,
      `Status:${(p.statusScore ?? 0).toFixed(2)}`,
      p.itemBoost ? `Keywords:+${p.itemBoost}` : '',
      p.timeWindowBoost ? `Rush:+${p.timeWindowBoost}` : ''
    ].filter(Boolean).join(' | ');
  }

  // ---------- API ----------
  async function fetchOrders() {
    if (!state.adminKey) return;
    try {
      const data = await fetchJSON(`/api/orders?key=${encodeRFC3986(state.adminKey)}`);
      state.orders = (data || []).map(o => ({ ...o, priorityScore: 0 }));
      prioritize(state.orders);
      render(true); // force after fetch
    } catch (err) {
      console.error(err);
      toast('Failed to fetch orders', 'error');
      const c = $('#orders');
      if (c) c.innerHTML = `<p class="text-red-500 p-4">Error loading orders.</p>`;
    }
  }

  async function updateStatus(id, nextStatus) {
    if (!STATUS.includes(nextStatus)) return;
    const order = state.orders.find(o => String(o.id) === String(id));
    if (!order) return;

    const ok = await confirmDialog(`Move #${order.id} to ${nextStatus}?`);
    if (!ok) return;

    // optimistic UI
    const prev = order.status;
    order.status = nextStatus;
    order.updatedAt = new Date().toISOString();
    prioritize(state.orders);
    render(true);

    try {
      // Adjust to your backend; common pattern shown:
      await fetchJSON(`/api/orders/${encodeRFC3986(order.id)}:status?key=${encodeRFC3986(state.adminKey)}`, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus })
      });
      toast(`Order #${order.id} → ${nextStatus}`, 'success');
    } catch (e) {
      // revert on failure
      order.status = prev;
      prioritize(state.orders);
      render(true);
      toast('Failed to update status', 'error');
      console.error(e);
    }
  }

  // ---------- Actions ----------
  function whatsAppURL(order) {
    const lines = [];
    lines.push(`Order #${order.id}`);
    lines.push(`Status: ${order.status}`);
    lines.push('');
    (order.items || []).forEach(i => lines.push(`• ${i.name} × ${i.qty}`));
    lines.push('');
    lines.push(`Total: ${formatINR(order.total)} (COD/Prepaid)`);
    if (order.customer) {
      lines.push('');
      lines.push(`Customer: ${order.customer.name}`);
      lines.push(`Phone: ${order.customer.phone}`);
      lines.push(`Address: ${order.customer.address}`);
    }
    const text = encodeRFC3986(lines.join('\n'));
    // generic share link; user can pick contact in WhatsApp
    return `https://wa.me/?text=${text}`;
  }

  function printInvoice(order) {
    const win = window.open('', '_blank');
    if (!win) { toast('Popup blocked. Please allow popups to print.', 'error'); return; }

    const rows = (order.items || []).map(i =>
      `<tr>
        <td>${safeTxt(i.name)}</td>
        <td style="text-align:center">${safeTxt(i.qty)}</td>
        <td style="text-align:right">${formatINR(i.price || 0)}</td>
        <td style="text-align:right">${formatINR((i.price || 0) * (i.qty || 0))}</td>
      </tr>`
    ).join('');

    win.document.write(`<!doctype html>
<html><head>
<meta charset="utf-8"/>
<title>Invoice #${safeTxt(order.id)}</title>
<style>
  body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica,Arial;padding:24px}
  h1{margin:0 0 8px}
  table{width:100%;border-collapse:collapse;margin-top:16px}
  td,th{border:1px solid #ddd;padding:8px}
  tfoot td{font-weight:bold}
  .muted{color:#666;font-size:12px}
</style>
</head><body>
  <h1>Ghar ka Khana</h1>
  <div class="muted">Invoice for Order #${safeTxt(order.id)} • ${new Date(order.createdAt).toLocaleString()}</div>
  <div style="margin-top:12px">
    <div><strong>${safeTxt(order.customer?.name)}</strong> (${safeTxt(order.customer?.phone)})</div>
    <div>${safeTxt(order.customer?.address)}</div>
  </div>
  <table>
    <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr><td colspan="3" style="text-align:right">Total</td><td style="text-align:right">${formatINR(order.total)}</td></tr>
    </tfoot>
  </table>
  <script>window.onload=()=>{window.print(); setTimeout(()=>window.close(), 300);};</script>
</body></html>`);
    win.document.close();
  }

  function renderActions(order) {
    const nextMap = {
      PLACED: ['CONFIRMED', 'CANCELLED'],
      CONFIRMED: ['DISPATCHED', 'CANCELLED'],
      DISPATCHED: ['DELIVERED'],
      DELIVERED: [],
      CANCELLED: []
    };
    const parts = [];
    (nextMap[order.status] || []).forEach(next => {
      parts.push(
        `<button data-action="status" data-id="${safeTxt(order.id)}" data-next="${next}" class="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200">${next}</button>`
      );
    });
    parts.push(
      `<button data-action="wa" data-id="${safeTxt(order.id)}" class="px-2 py-1 text-xs bg-green-100 text-green-800 rounded hover:bg-green-200">📲 WhatsApp</button>`
    );
    parts.push(
      `<button data-action="print" data-id="${safeTxt(order.id)}" class="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200">🧾 Print</button>`
    );
    return parts.join('');
  }

  // ---------- Rendering ----------
  function render(force = false) {
    const container = $('#orders');
    if (!container) return;

    // include filters + search in the hash so those cause re-render
    const hash = JSON.stringify({
      key: state.adminKey,
      orders: state.orders.map(o => [o.id, o.updatedAt, o.status, o.priorityScore]),
      f: state.filters, s: state.search, sort: state.sort
    });

    if (!force && hash === state.lastRenderHash) return;
    state.lastRenderHash = hash;

    // filter
    const filtered = state.orders.filter(o => {
      if (state.filters.status !== 'ALL' && o.status !== state.filters.status) return false;
      if (state.search) {
        const s = state.search.toLowerCase();
        const hay = [
          o.id, o.customer?.name, o.customer?.phone, o.customer?.address,
          ...(o.items || []).map(i => i.name)
        ].map(x => String(x || '').toLowerCase());
        return hay.some(x => x.includes(s));
      }
      return true;
    });

    // sort
    const sorted = [...filtered].sort((a, b) => {
      if (state.sort === 'AI') return (b.priorityScore || 0) - (a.priorityScore || 0);
      if (state.sort === 'Newest') return new Date(b.createdAt) - new Date(a.createdAt);
      if (state.sort === 'Oldest') return new Date(a.createdAt) - new Date(b.createdAt);
      if (state.sort === 'High Value') return (b.total || 0) - (a.total || 0);
      return 0;
    });

    // draw
    container.innerHTML = '';
    if (!sorted.length) {
      container.innerHTML = `<p class="text-gray-500 p-4">No orders found.</p>`;
      return;
    }

    sorted.forEach(order => {
      const statusColor = {
        PLACED: 'gray', CONFIRMED: 'blue', DISPATCHED: 'amber', DELIVERED: 'green', CANCELLED: 'red'
      }[order.status] || 'gray';

      const el = document.createElement('div');
      el.className = 'bg-white shadow hover:shadow-lg transition rounded p-4 mb-4 focus:outline-none';
      el.tabIndex = 0;

      el.innerHTML = `
        <div class="flex justify-between items-center mb-2">
          <div>
            <h2 class="font-bold text-lg">#${safeTxt(order.id)}</h2>
            <p class="text-sm text-gray-500" title="${safeTxt(order.createdAt)}">${timeAgo(order.createdAt)}</p>
          </div>
          <div class="flex gap-2 items-center">
            <span class="px-2 py-1 text-xs rounded bg-${statusColor}-100 text-${statusColor}-800">${safeTxt(order.status)}</span>
            <span class="px-2 py-1 text-xs rounded bg-yellow-100 text-yellow-800" title="${safeTxt(explainPriority(order))}">⚡ ${(order.priorityScore || 0).toFixed(1)}</span>
            <span class="font-bold">${formatINR(order.total)}</span>
          </div>
        </div>
        <pre class="text-sm text-gray-700 whitespace-pre-wrap">${safeTxt((order.items || []).map(i => `${i.name} x${i.qty}`).join('\n'))}</pre>
        <div class="mt-2 text-sm text-gray-600">
          <p><strong>${safeTxt(order.customer?.name)}</strong> (${safeTxt(order.customer?.phone)})</p>
          <p>${safeTxt(order.customer?.address)}</p>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          ${renderActions(order)}
        </div>
      `;
      container.appendChild(el);

      // keyboard shortcuts for status changes
      el.addEventListener('keydown', e => {
        const map = { c: 'CONFIRMED', d: 'DISPATCHED', l: 'DELIVERED', x: 'CANCELLED' };
        const next = map[e.key?.toLowerCase()];
        if (next) updateStatus(order.id, next);
      });
    });
  }

  // ---------- Polling ----------
  function setPollingUI(on) {
    const btn = $('#autoRefreshToggle');
    if (!btn) return;
    btn.dataset.active = on ? '1' : '0';
    btn.textContent = on ? 'Auto-Refresh: ON' : 'Auto-Refresh: OFF';
    btn.classList.toggle('bg-green-600', on);
    btn.classList.toggle('text-white', on);
  }

  function startPolling() {
    if (state.polling) return;
    state.polling = setInterval(fetchOrders, POLL_INTERVAL_MS);
    setPollingUI(true);
  }

  function stopPolling() {
    if (!state.polling) return;
    clearInterval(state.polling);
    state.polling = null;
    setPollingUI(false);
  }

  function togglePolling() {
    if (state.polling) stopPolling(); else startPolling();
  }

  // ---------- Event Wiring ----------
  function init() {
    // admin key
    state.adminKey = localStorage.getItem('gkk_admin_key') || '';
    $('#admin-key') && ($('#admin-key').value = state.adminKey);

    $('#admin-key')?.addEventListener('change', e => {
      state.adminKey = e.target.value.trim();
      localStorage.setItem('gkk_admin_key', state.adminKey);
    });

    // form submit (fetch orders)
    $('#admin-key')?.form?.addEventListener('submit', e => {
      e.preventDefault();
      if (!state.adminKey) return toast('Admin key required', 'error');
      fetchOrders();
    });

    // search
    $('#search')?.addEventListener('input', debounce(e => {
      state.search = (e.target.value || '').trim().toLowerCase();
      render(true);
    }, 250));

    // filter buttons
    $$('#filters button').forEach(btn => {
      btn.addEventListener('click', () => {
        state.filters.status = btn.dataset.status || 'ALL';
        localStorage.setItem('gkk_filter_status', state.filters.status);
        render(true);
      });
    });
    state.filters.status = localStorage.getItem('gkk_filter_status') || 'ALL';

    // auto-refresh
    $('#autoRefreshToggle')?.addEventListener('click', togglePolling);
    setPollingUI(false);

    // action delegation (#orders)
    $('#orders')?.addEventListener('click', async e => {
      const t = e.target.closest('button');
      if (!t) return;
      const id = t.dataset.id;
      const action = t.dataset.action;

      if (action === 'status') {
        const next = t.dataset.next;
        updateStatus(id, next);
      } else if (action === 'wa') {
        const order = state.orders.find(o => String(o.id) === String(id));
        if (!order) return;
        const url = whatsAppURL(order);
        try {
          await navigator.clipboard.writeText(url);
          toast('WhatsApp share link copied', 'success');
          window.open(url, '_blank');
        } catch {
          window.open(url, '_blank');
        }
      } else if (action === 'print') {
        const order = state.orders.find(o => String(o.id) === String(id));
        if (order) printInvoice(order);
      }
    });

    // initial paint
    render(true);

    // optional: fetch once if we have a saved key
    if (state.adminKey) fetchOrders();
  }

  // ---------- Expose (optional for debugging) ----------
  window.Admin = { state, fetchOrders, updateStatus, startPolling, stopPolling };

  // ---------- Boot ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
