/**
 * Ghar ka Khana — admin.js (LOCAL EDITION)
 * Works with public/orders.json for live preview on Vercel/local
 */
(() => {
  const STATUS = ['PLACED', 'CONFIRMED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'];

  const state = {
    orders: [],
    filters: { status: 'ALL' },
    search: '',
    sort: 'Newest'
  };

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const formatINR = n => `₹${Number(n || 0).toLocaleString('en-IN')}`;
  const safeTxt = s =>
    String(s ?? '').replace(/[<>&"']/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;', "'":'&#39;' }[c]));
  const timeAgo = iso => {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.max(0, Math.floor(diffMs / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  };

  // ---- Fetch local orders.json ----
  async function fetchOrders() {
    try {
      const res = await fetch('./orders.json', { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error('Failed to load orders.json');
      state.orders = await res.json();
      render();
    } catch (err) {
      console.error('Error fetching orders:', err);
      const c = $('#orders-list');
      if (c) c.innerHTML = `<p class="text-red-500 p-4">Error loading orders.</p>`;
    }
  }

  // ---- Update order status (local only simulation) ----
  function updateStatus(id, nextStatus) {
    const order = state.orders.find(o => o.id === id);
    if (!order || !STATUS.includes(nextStatus)) return;
    if (!confirm(`Change status for #${id} → ${nextStatus}?`)) return;
    order.status = nextStatus;
    order.updatedAt = new Date().toISOString();
    render();
  }

  // ---- WhatsApp Message Generator ----
  function whatsAppURL(order) {
    const lines = [
      `Order #${order.id}`,
      `Status: ${order.status}`,
      '',
      ...(order.items || []).map(i => `• ${i.name} × ${i.qty}`),
      '',
      `Total: ₹${order.total}`,
      '',
      `Customer: ${order.customer.name}`,
      `Phone: ${order.customer.phone}`,
      `Address: ${order.customer.address}`
    ];
    return `https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`;
  }

  // ---- Render Orders ----
  function render() {
    const container = $('#orders-list');
    if (!container) return;
    container.innerHTML = '';

    let list = [...state.orders];

    if (state.filters.status !== 'ALL') {
      list = list.filter(o => o.status === state.filters.status);
    }

    if (state.search) {
      const q = state.search.toLowerCase();
      list = list.filter(o =>
        [o.id, o.customer.name, o.customer.phone, o.customer.address]
          .join(' ')
          .toLowerCase()
          .includes(q)
      );
    }

    if (state.sort === 'Newest') {
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    if (!list.length) {
      container.innerHTML = `<p class="text-gray-500 text-center py-8">No orders found.</p>`;
      return;
    }

    list.forEach(order => {
      const badge =
        {
          PLACED: 'bg-gray-100 text-gray-800',
          CONFIRMED: 'bg-blue-100 text-blue-800',
          DISPATCHED: 'bg-amber-100 text-amber-800',
          DELIVERED: 'bg-green-100 text-green-800',
          CANCELLED: 'bg-red-100 text-red-800'
        }[order.status] || 'bg-gray-100 text-gray-800';

      const el = document.createElement('div');
      el.className = 'p-5 bg-white rounded-2xl shadow-sm border border-gray-200 hover:shadow-md transition-all';
      el.innerHTML = `
        <div class="flex justify-between items-center mb-2">
          <h3 class="font-bold text-lg text-gray-900">#${safeTxt(order.id)}</h3>
          <span class="px-3 py-1 rounded-full text-xs font-semibold ${badge}">${safeTxt(order.status)}</span>
        </div>
        <p class="text-sm text-gray-600 mb-1">
          <strong>${safeTxt(order.customer.name)}</strong> • ${safeTxt(order.customer.phone)}
        </p>
        <p class="text-sm text-gray-500 mb-2">${safeTxt(order.customer.address)}</p>
        <ul class="text-sm text-gray-700 mb-2">
          ${(order.items || []).map(i => `<li>• ${safeTxt(i.name)} × ${i.qty} — ₹${i.price * i.qty}</li>`).join('')}
        </ul>
        <div class="flex justify-between items-center text-sm">
          <span>💳 ${order.paymentMethod}</span>
          <span class="font-bold text-brand">${formatINR(order.total)}</span>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          ${renderActions(order)}
        </div>
      `;
      container.appendChild(el);
    });
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
        `<button data-action="status" data-id="${safeTxt(order.id)}" data-next="${next}"
          class="px-3 py-1 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200 transition-all">${next}</button>`
      );
    });
    parts.push(
      `<button data-action="wa" data-id="${safeTxt(order.id)}"
        class="px-3 py-1 text-xs bg-green-100 text-green-800 rounded hover:bg-green-200 transition-all">📲 WhatsApp</button>`
    );
    return parts.join('');
  }

  // ---- Event Handlers ----
  function init() {
    fetchOrders();

    // Button actions (status / WhatsApp)
    $('#orders-list')?.addEventListener('click', e => {
      const t = e.target.closest('button');
      if (!t) return;
      const { id, action } = t.dataset;
      if (action === 'status') {
        updateStatus(id, t.dataset.next);
      } else if (action === 'wa') {
        const order = state.orders.find(o => o.id === id);
        if (order) window.open(whatsAppURL(order), '_blank');
      }
    });

    // Optional: hook up search/filter inputs if present
    $('#search')?.addEventListener('input', e => {
      state.search = (e.target.value || '').trim();
      render();
    });
    $$('#filters [data-status]')?.forEach(btn => {
      btn.addEventListener('click', () => {
        state.filters.status = btn.dataset.status || 'ALL';
        render();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
