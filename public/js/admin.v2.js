/**
 * Ghar ka Khana — admin.v2.js
 * Elegant Admin Dashboard for Pure-Veg Cloud Kitchen
 *
 * Usage:
 * - Wire #admin-form with input#admin-key and button[type=submit]
 * - Render orders in #orders container
 * - Optional: #order-search (input), #auto-refresh (checkbox), filter buttons [data-status]
 * - Exposes: window.GKKAdmin = { refresh, filter, search }
 */

(() => {
  // ---------- tiny utils ----------
  const qs  = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const debounce = window.Util?.debounce || ((fn, ms = 300) => {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  });
  const safeTxt = s => String(s ?? '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
  const enc = s => encodeURIComponent(String(s ?? ''));

  const fetchJSON = window.Util?.fetchJSON || (async (url, opts = {}) => {
    const res = await fetch(url, {
      ...opts,
      headers: { 'Accept': 'application/json', ...(opts.headers || {}) }
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${text || ''}`.trim());
    }
    // Some APIs return empty 204
    if (res.status === 204) return null;
    return res.json().catch(() => { throw new Error('Invalid JSON response'); });
  });

  const formatINR = window.Util?.formatINR ||
    (n => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n || 0)));

  const toast = window.UI?.toast || ((msg/*, type*/) => alert(msg));
  const confirmDialog = window.UI?.confirmDialog || (msg => Promise.resolve(confirm(msg)));
  const spinner = window.UI?.spinner || ((el, on) => el?.classList.toggle('opacity-50', !!on));

  // ---------- state ----------
  const state = {
    key: '',
    orders: [],
    filter: 'ALL',
    search: '',
    autoRefresh: false,
    timer: null
  };

  let form, keyInput, ordersContainer, searchInput, autoRefreshToggle;

  // ---------- boot ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ---------- init ----------
  function init() {
    form = qs('#admin-form');
    keyInput = qs('#admin-key');
    ordersContainer = qs('#orders');
    searchInput = qs('#order-search');
    autoRefreshToggle = qs('#auto-refresh');

    if (!form || !keyInput || !ordersContainer) {
      toast('Missing admin form or orders container', 'error');
      return;
    }

    // restore key + filter
    const savedKey = localStorage.getItem('gkk_admin_key');
    const savedFilter = localStorage.getItem('gkk_admin_filter');
    if (savedKey) { keyInput.value = savedKey; state.key = savedKey; }
    if (savedFilter) { state.filter = savedFilter; }

    // form submit => refresh
    form.addEventListener('submit', e => {
      e.preventDefault();
      state.key = keyInput.value.trim();
      if (!state.key) return toast('Admin key required', 'error');
      localStorage.setItem('gkk_admin_key', state.key);
      refresh();
    });

    // search
    if (searchInput) {
      searchInput.addEventListener('input', debounce(e => {
        state.search = String(e.target.value || '').trim().toLowerCase();
        render();
      }, 250));
    }

    // auto-refresh
    if (autoRefreshToggle) {
      autoRefreshToggle.addEventListener('change', e => {
        state.autoRefresh = !!e.target.checked;
        togglePolling();
      });
    }

    // filters
    qsa('[data-status]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.filter = btn.dataset.status || 'ALL';
        localStorage.setItem('gkk_admin_filter', state.filter);
        render();
      });
    });

    // action delegation (attach AFTER we have container)
    ordersContainer.addEventListener('click', onOrdersClick);

    // initial load if key present
    render(); // empty state paint
    if (state.key) refresh();
  }

  // ---------- public api ----------
  window.GKKAdmin = {
    refresh,
    filter: status => { state.filter = status || 'ALL'; localStorage.setItem('gkk_admin_filter', state.filter); render(); },
    search: text => { state.search = String(text || '').toLowerCase(); render(); }
  };

  // ---------- data ----------
  async function refresh() {
    if (!state.key) return toast('Admin key required', 'error');
    spinner(form, true);
    try {
      const data = await fetchJSON(`/api/orders?key=${enc(state.key)}`);
      state.orders = Array.isArray(data) ? data : [];
      render();
    } catch (err) {
      console.error(err);
      toast('Failed to load orders', 'error');
      ordersContainer.innerHTML = `<p class="text-red-500 p-4">Error loading orders.</p>`;
    } finally {
      spinner(form, false);
    }
  }

  // ---------- render ----------
  function render() {
    if (!ordersContainer) return;

    const filtered = state.orders.filter(o => {
      const matchStatus = state.filter === 'ALL' || o.status === state.filter;
      if (!matchStatus) return false;

      if (!state.search) return true;

      const hay = [
        o.id, o.customer?.name, o.customer?.phone, o.customer?.address,
        ...(o.items || []).map(i => i?.name)
      ]
      .filter(Boolean)
      .map(x => String(x).toLowerCase());

      return hay.some(x => x.includes(state.search));
    });

    if (!filtered.length) {
      ordersContainer.innerHTML = `<p class="text-gray-500 p-4">No matching orders found.</p>`;
      return;
    }

    ordersContainer.innerHTML = filtered.map(renderOrderCard).join('');
  }

  function renderOrderCard(order) {
    const statusColor = ({
      PLACED: 'gray', CONFIRMED: 'blue', DISPATCHED: 'amber', DELIVERED: 'green', CANCELLED: 'red'
    })[order.status] || 'gray';

    const itemsText = (order.items || [])
      .map(i => `${safeTxt(i?.name)} x${safeTxt(i?.qty)}`)
      .join('\n');

    const actions = getNextActions(order.status).map(next => {
      return `<button class="action-btn text-xs px-2 py-1 bg-${statusColor}-100 text-${statusColor}-800 rounded hover:bg-${statusColor}-200"
        data-id="${safeTxt(order.id)}" data-next="${next}">${next}</button>`;
    }).join('');

    return `
      <div class="bg-white rounded shadow p-4 mb-4">
        <div class="flex justify-between items-center mb-2">
          <div>
            <h2 class="font-bold text-lg">#${safeTxt(order.id)}</h2>
            <p class="text-sm text-gray-500" title="${safeTxt(order.createdAt)}">
              ${new Date(order.createdAt).toLocaleString()}
            </p>
          </div>
          <div class="flex gap-2 items-center">
            <span class="px-2 py-1 text-xs rounded bg-${statusColor}-100 text-${statusColor}-800">${safeTxt(order.status)}</span>
            <span class="font-bold">${formatINR(order.total)}</span>
          </div>
        </div>
        <pre class="text-sm text-gray-700 whitespace-pre-wrap">${itemsText}</pre>
        <div class="mt-2 text-sm text-gray-600">
          <p><strong>${safeTxt(order.customer?.name)}</strong> (${safeTxt(order.customer?.phone)})</p>
          <p>${safeTxt(order.customer?.address)}</p>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">${actions}</div>
      </div>
    `;
  }

  function getNextActions(status) {
    switch (status) {
      case 'PLACED':     return ['CONFIRMED', 'CANCELLED'];
      case 'CONFIRMED':  return ['DISPATCHED', 'CANCELLED'];
      case 'DISPATCHED': return ['DELIVERED'];
      default:           return [];
    }
  }

  // ---------- events ----------
  async function onOrdersClick(e) {
    const btn = e.target.closest('.action-btn');
    if (!btn) return;

    const id = btn.dataset.id;
    const next = btn.dataset.next;
    const order = state.orders.find(o => String(o.id) === String(id));
    if (!order || !next) return;

    const ok = next === 'CANCELLED' ? await confirmDialog(`Cancel order #${id}?`) : true;
    if (!ok) return;

    btn.disabled = true;
    try {
      const res = await fetchJSON(`/api/orders/${enc(id)}/status?key=${enc(state.key)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next })
      });
      if (res && res.error) throw new Error(res.error);
      order.status = next;
      order.updatedAt = new Date().toISOString();
      toast(`Order #${id} updated to ${next}`, 'success');
      render();
    } catch (err) {
      console.error(err);
      toast(`Failed to update order #${id}`, 'error');
      btn.disabled = false;
    }
  }

  // ---------- polling ----------
  function togglePolling() {
    clearInterval(state.timer);
    if (state.autoRefresh) {
      state.timer = setInterval(refresh, 15000);
      toast('Auto-refresh enabled', 'info');
    } else {
      toast('Auto-refresh disabled', 'info');
    }
  }
})();
