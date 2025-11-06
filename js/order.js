/**
 * Ghar ka Khana — order.js
 * Pure-Veg Cloud Kitchen Order Page
 *
 * Usage:
 * - Cart renders in #cart-list with qty controls and remove buttons
 * - Totals in #cart-total
 * - Form #order-form posts to /api/order
 * - WhatsApp link revealed in #wa-link on success
 * - Optional AI hint if window.AI exists
 */

(() => {
  // ---------- utils ----------
  const qs  = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const formatINR = n => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n || 0));
  const encodeRFC3986 = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16));
  const safeTxt = s => String(s ?? '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
  const toast = (msg, type = 'info') => (window.UI?.toast ? window.UI.toast(msg, type) : alert(msg));
  const spinner = (el, on) => (window.UI?.spinner ? window.UI.spinner(el, on) : el?.classList.toggle('opacity-50', !!on));
  const confirmDialog = (msg) => (window.UI?.confirmDialog ? window.UI.confirmDialog(msg) : Promise.resolve(confirm(msg)));
  const phoneSanitize = str => String(str || '').replace(/\D/g, '').slice(-12); // allow country code + last 10

  // ---------- els ----------
  let cartList, cartTotal, orderForm, orderStatus, waLink;

  // ---------- boot ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    cartList    = qs('#cart-list');
    cartTotal   = qs('#cart-total');
    orderForm   = qs('#order-form');
    orderStatus = qs('#order-status');
    waLink      = qs('#wa-link');

    if (orderStatus) orderStatus.setAttribute('aria-live', 'polite');

    if (!cartList || !cartTotal || !orderForm || !orderStatus || !waLink) {
      console.warn('order.js: Missing required DOM nodes');
      return;
    }

    // hydrate from localStorage
    const nameInput  = orderForm.querySelector('[name="name"]');
    const phoneInput = orderForm.querySelector('[name="phone"]');
    if (nameInput)  nameInput.value  = localStorage.getItem('gkk_name')  || '';
    if (phoneInput) phoneInput.value = localStorage.getItem('gkk_phone') || '';

    // optional AI hint
    if (window.AI) {
      const hint = document.createElement('p');
      hint.className = 'text-xs text-gray-500 mt-2';
      hint.textContent = '💡 Most customers prefer UPI during dinner rush.';
      orderForm.appendChild(hint);
    }

    // render cart now and also on cart updates (if event bus exists)
    renderCart();
    if (window.GKK?.on) {
      window.GKK.on('cart:updated', renderCart);
    }

    // qty/remove — delegate ONCE (don’t rebind in render)
    cartList.addEventListener('click', onCartClick);
    cartList.addEventListener('keydown', onCartKeydown);

    // submit
    orderForm.addEventListener('submit', handleSubmit);
  }

  // ---------- cart ui ----------
  function renderCart() {
    const items = window.Cart?.get?.() || [];
    if (!items.length) {
      cartList.innerHTML = `<p class="text-gray-500 p-4">Your cart is empty — <a href="/menu.html" class="text-green-600 underline">explore the menu</a></p>`;
      cartTotal.textContent = formatINR(0);
      waLink.classList.add('hidden'); // hide WA until success
      return;
    }

    cartList.innerHTML = items.map(item => `
      <div class="flex justify-between items-center p-2 border-b group" tabindex="0" data-row-id="${safeTxt(item.id)}">
        <div>
          <h3 class="font-medium">${safeTxt(item.name)}</h3>
          <p class="text-sm text-gray-500">${formatINR(item.price)} × ${item.qty} = ${formatINR(item.price * item.qty)}</p>
        </div>
        <div class="flex items-center gap-2">
          <button class="qty-btn px-2 bg-gray-100 rounded" aria-label="Decrease quantity of ${safeTxt(item.name)}" data-id="${safeTxt(item.id)}" data-action="decrease">−</button>
          <span aria-live="polite">${item.qty}</span>
          <button class="qty-btn px-2 bg-gray-100 rounded" aria-label="Increase quantity of ${safeTxt(item.name)}" data-id="${safeTxt(item.id)}" data-action="increase">+</button>
          <button class="remove-btn text-red-500 text-sm" aria-label="Remove ${safeTxt(item.name)}" data-id="${safeTxt(item.id)}">✕</button>
        </div>
      </div>
    `).join('');

    cartTotal.textContent = formatINR(window.Cart?.total?.() || 0);
  }

  function onCartClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;

    const id = btn.dataset.id;
    if (!id || !window.Cart) return;

    const items = window.Cart.get();
    const item = items.find(i => String(i.id) === String(id));
    if (!item) return;

    if (btn.classList.contains('qty-btn')) {
      const next = btn.dataset.action === 'increase'
        ? Math.min(item.qty + 1, 99)
        : Math.max(item.qty - 1, 1);
      window.Cart.updateQty(id, next);
      renderCart();
      return;
    }

    if (btn.classList.contains('remove-btn')) {
      const doRemove = item.qty > 3
        ? confirmDialog(`Remove ${item.name}?`)
        : Promise.resolve(true);

      doRemove.then(ok => {
        if (!ok) return;
        window.Cart.removeItem(id);
        renderCart();
      });
    }
  }

  function onCartKeydown(e) {
    const row = e.target.closest('[data-row-id]');
    if (!row || !window.Cart) return;
    const id = row.dataset.rowId;
    const items = window.Cart.get();
    const item = items.find(i => String(i.id) === String(id));
    if (!item) return;

    if (e.key === '+') {
      window.Cart.updateQty(id, Math.min(item.qty + 1, 99));
      renderCart();
    } else if (e.key === '-') {
      window.Cart.updateQty(id, Math.max(item.qty - 1, 1));
      renderCart();
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      window.Cart.removeItem(id);
      renderCart();
    }
  }

  // ---------- validation ----------
  function validateForm(form) {
    // clear previous error rings
    qsa('.ring-red-500', form).forEach(el => el.classList.remove('ring', 'ring-red-500'));

    const errors = [];
    const name    = form.name?.value.trim();
    const phone   = phoneSanitize(form.phone?.value);
    const address = form.address?.value.trim();
    const pay     = form.paymentMethod?.value;

    if (!name || name.length < 2)    errors.push({ field: form.name, msg: 'Name too short' });
    if (!phone || phone.length < 10) errors.push({ field: form.phone, msg: 'Invalid phone' });
    if (!address || address.length < 10) errors.push({ field: form.address, msg: 'Address too short' });
    if (!pay) errors.push({ field: form.paymentMethod, msg: 'Select a payment method' });

    errors.forEach(({ field }) => field?.classList.add('ring', 'ring-red-500'));
    if (errors.length) {
      toast(errors[0].msg, 'error');
      errors[0].field?.focus();
    }

    return { ok: errors.length === 0, name, phone, address, pay };
  }

  // ---------- submit ----------
  async function handleSubmit(e) {
    e.preventDefault();
    if (!window.Cart) { toast('Cart unavailable', 'error'); return; }

    const items = window.Cart.get();
    if (!items.length) { toast('Cart is empty', 'error'); return; }

    const { ok, name, phone, address, pay } = validateForm(orderForm);
    if (!ok) return;

    const payload = {
      items: items.map(i => ({ id: i.id, qty: i.qty })),
      customer: { name, phone: phoneSanitize(phone), address },
      paymentMethod: pay,
      notes: orderForm.notes?.value.trim() || ''
    };

    // persist user fields
    localStorage.setItem('gkk_name', payload.customer.name);
    localStorage.setItem('gkk_phone', payload.customer.phone);

    // prepare UI
    spinner(orderForm, true);
    const controls = qsa('input, textarea, select, button', orderForm);
    controls.forEach(el => el.disabled = true);
    orderStatus.textContent = 'Submitting order...';

    // compute totals BEFORE clearing cart
    const orderTotal = window.Cart.total();

    try {
      const fetcher = window.Util?.fetchJSON || (async (url, opts) => {
        const r = await fetch(url, { ...opts, headers: { 'Accept': 'application/json', ...(opts?.headers || {}) } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });

      const res = await fetcher('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res || res.error) throw new Error(res?.error || 'Unknown error');

      // success!
      const orderId = res.id || res.orderId || '';
      orderStatus.textContent = `✅ Order placed! ${orderId ? 'ID: ' + orderId + ', ' : ''}Total: ${formatINR(orderTotal)}`;
      toast('Order placed successfully!', 'success');

      // Build WhatsApp link
      const waURL = buildWhatsAppLink({
        items: items.map(i => ({ name: i.name, qty: i.qty, lineTotal: i.price * i.qty })),
        customer: payload.customer,
        total: orderTotal,
        phone: '+91XXXXXXXXXX' // replace with your business number if desired
      });

      waLink.href = waURL;
      waLink.classList.remove('hidden');
      waLink.setAttribute('target', '_blank');
      waLink.focus();

      // clear cart AFTER link built
      window.Cart.clear();
      renderCart();
    } catch (err) {
      console.warn('Order submit failed', err);
      orderStatus.textContent = '❌ Failed to place order. Please try again.';
      toast(err.message || 'Submit failed', 'error');
    } finally {
      spinner(orderForm, false);
      controls.forEach(el => el.disabled = false);
    }
  }

  // ---------- WA builder (uses AI if available) ----------
  function buildWhatsAppLink({ items, customer, total, phone }) {
    if (window.AI?.buildWhatsAppLink) {
      try { return window.AI.buildWhatsAppLink({ items, customer, total, phone }); }
      catch (e) { console.warn('AI.buildWhatsAppLink failed, falling back', e); }
    }

    if (!Array.isArray(items) || !customer?.name || !customer?.phone || !customer?.address) return '';

    const lines = [
      'Hi Ghar ka Khana,',
      'Order:'
    ];
    items.forEach(i => lines.push(`${i.name} x${i.qty} = ${formatINR(i.lineTotal || 0)}`));
    lines.push(`Total: ${formatINR(total || 0)}`);
    lines.push('');
    lines.push(`Customer: ${customer.name} (${phoneSanitize(customer.phone)})`);
    lines.push(`Address: ${customer.address}`);

    const msg = lines.join('\n');
    const dest = phoneSanitize(phone) || '91';
    return `https://wa.me/${dest}?text=${encodeRFC3986(msg)}`;
  }
})();
