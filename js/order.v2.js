/**
 * Ghar ka Khana — order.v2.js
 * Pure Veg Cloud Kitchen Order Page Script
 *
 * Features:
 * - Real-time cart updates
 * - Form validation and submission
 * - AI-lite enhancements (optional)
 * - WhatsApp deep link builder
 * - Public API: window.GKKOrder = { renderCart, buildWhatsAppLink }
 */

(() => {
  // ---------- utils ----------
  const qs  = (s, root = document) => root.querySelector(s);
  const qsa = (s, root = document) => Array.from(root.querySelectorAll(s));
  const formatINR = n => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })
    .format(Number(n || 0));
  const toast = (msg, type = 'info') => (window.UI?.toast ? window.UI.toast(msg, type) : alert(msg));
  const spinner = (el, on) => (window.UI?.spinner ? window.UI.spinner(el, on) : el?.classList.toggle('opacity-50', !!on));
  const confirmDialog = (msg) => (window.UI?.confirmDialog ? window.UI.confirmDialog(msg) : Promise.resolve(confirm(msg)));
  const encodeRFC3986 = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16));
  const phoneSanitize = s => String(s || '').replace(/\D/g, '').slice(-12); // keep cc + last 10

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
      console.warn('order.v2.js: Missing required DOM elements');
      return;
    }

    // hydrate persisted fields
    const nameInput  = orderForm.querySelector('[name="name"]');
    const phoneInput = orderForm.querySelector('[name="phone"]');
    if (nameInput)  nameInput.value  = localStorage.getItem('gkk_name')  || '';
    if (phoneInput) phoneInput.value = localStorage.getItem('gkk_phone') || '';

    // optional AI hint
    if (window.AI) {
      const hint = document.createElement('p');
      hint.className = 'text-xs text-gray-500 mt-2';
      hint.textContent = '💡 Most customers prefer UPI during dinner rush.';
      orderForm.querySelector('[name="paymentMethod"]')?.parentElement?.appendChild(hint);
    }

    // initial render + live updates if event bus exists
    renderCart();
    if (window.GKK?.on) window.GKK.on('cart:updated', renderCart);

    // delegate qty/remove once
    cartList.addEventListener('click', onCartClick);
    cartList.addEventListener('keydown', onCartKeydown);

    // submit
    orderForm.addEventListener('submit', handleSubmit);
  }

  // ---------- cart UI ----------
  function renderCart() {
    const items = window.Cart?.get?.() || [];
    if (!items.length) {
      cartList.innerHTML =
        `<p class="text-gray-500 p-4">Your cart is empty — <a href="/menu.html" class="text-green-600 underline">go to Menu</a></p>`;
      cartTotal.textContent = formatINR(0);
      waLink.classList.add('hidden');
      return;
    }

    cartList.innerHTML = items.map(item => `
      <div class="flex justify-between items-center p-2 border-b group" tabindex="0" data-row-id="${String(item.id)}">
        <div>
          <h3 class="font-medium">${String(item.name)}</h3>
          <p class="text-sm text-gray-500">${formatINR(item.price)} × ${item.qty} = ${formatINR(item.price * item.qty)}</p>
        </div>
        <div class="flex items-center gap-2">
          <button class="qty-btn px-2 bg-gray-100 rounded" aria-label="Decrease quantity of ${String(item.name)}" data-id="${String(item.id)}" data-action="decrease">−</button>
          <span aria-live="polite">${item.qty}</span>
          <button class="qty-btn px-2 bg-gray-100 rounded" aria-label="Increase quantity of ${String(item.name)}" data-id="${String(item.id)}" data-action="increase">+</button>
          <button class="remove-btn text-red-500 text-sm" aria-label="Remove ${String(item.name)}" data-id="${String(item.id)}">✕</button>
        </div>
      </div>
    `).join('');

    cartTotal.textContent = formatINR(window.Cart?.total?.() || 0);
  }

  function onCartClick(e) {
    const btn = e.target.closest('button');
    if (!btn || !window.Cart) return;
    const id = btn.dataset.id;
    if (!id) return;

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
      const maybe = item.qty > 3 ? confirmDialog(`Remove ${item.name}?`) : Promise.resolve(true);
      maybe.then(ok => {
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
    // clear previous rings
    qsa('.ring-red-500', form).forEach(el => el.classList.remove('ring', 'ring-red-500'));

    const errors = [];
    const name    = form.name?.value.trim();
    const phone   = phoneSanitize(form.phone?.value);
    const address = form.address?.value.trim();
    const pay     = form.paymentMethod?.value;

    if (!name || name.length < 2)        errors.push({ field: form.name, msg: 'Name too short' });
    if (!phone || phone.length < 10)     errors.push({ field: form.phone, msg: 'Invalid phone number' });
    if (!address || address.length < 10) errors.push({ field: form.address, msg: 'Address too short' });
    if (!pay)                             errors.push({ field: form.paymentMethod, msg: 'Select a payment method' });

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

    const cartSnapshot = window.Cart.get(); // includes prices
    if (!cartSnapshot.length) { toast('Cart is empty', 'error'); return; }

    const { ok, name, phone, address, pay } = validateForm(orderForm);
    if (!ok) return;

    const payload = {
      items: cartSnapshot.map(i => ({ id: i.id, qty: i.qty })), // server typically wants id + qty
      customer: { name, phone, address },
      paymentMethod: pay,
      notes: orderForm.notes?.value.trim() || ''
    };

    // persist user info
    localStorage.setItem('gkk_name', name);
    localStorage.setItem('gkk_phone', phone);

    // UI lock
    spinner(orderForm, true);
    const controls = qsa('input, textarea, select, button', orderForm);
    controls.forEach(el => el.disabled = true);
    orderStatus.textContent = 'Submitting order...';

    // compute total BEFORE clearing
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

      const orderId = res.id || res.order?.id || '';
      orderStatus.textContent = `✅ Order placed! ${orderId ? 'ID: ' + orderId + ', ' : ''}Total: ${formatINR(orderTotal)}`;
      toast('Order placed!', 'success');

      // Build WA link (prefer AI if available)
      const itemsForWA = cartSnapshot.map(i => ({
        name: i.name, qty: i.qty, lineTotal: i.price * i.qty
      }));
      const waURL = buildWhatsAppLink({
        items: itemsForWA,
        customer: payload.customer,
        total: orderTotal,
        paymentMethod: pay,
        phone: '+91XXXXXXXXXX' // replace with your business number
      });

      waLink.href = waURL;
      waLink.classList.remove('hidden');
      waLink.setAttribute('target', '_blank');
      waLink.focus();

      // clear cart AFTER we’ve built the link
      window.Cart.clear();
      renderCart();
    } catch (err) {
      console.error('Order submit failed:', err);
      orderStatus.textContent = '❌ Failed to place order. Please try again.';
      toast(err.message || 'Submit failed', 'error');
    } finally {
      spinner(orderForm, false);
      controls.forEach(el => el.disabled = false);
    }
  }

  // ---------- WA builder (AI-first, safe fallback) ----------
  function buildWhatsAppLink({ items, customer, total, paymentMethod, phone }) {
    if (window.AI?.buildWhatsAppLink) {
      try { return window.AI.buildWhatsAppLink({ items, customer, total, phone }); }
      catch (e) { console.warn('AI.buildWhatsAppLink failed, using fallback', e); }
    }

    if (!Array.isArray(items) || !items.length || !customer?.name || !customer?.phone || !customer?.address) return '';

    const lines = ['Hi Ghar ka Khana,', 'Here’s my order:'];
    items.forEach(i => lines.push(`${i.name} x${i.qty} = ${formatINR(i.lineTotal || 0)}`));
    lines.push(`Total: ${formatINR(total || 0)}`);
    lines.push('');
    lines.push(`Name: ${customer.name}`);
    lines.push(`Phone: ${phoneSanitize(customer.phone)}`);
    lines.push(`Address: ${customer.address}`);
    if (paymentMethod) lines.push(`Payment: ${paymentMethod}`);

    const msg  = lines.join('\n');
    const dest = phoneSanitize(phone) || '91'; // default to country code if not provided
    return `https://wa.me/${dest}?text=${encodeRFC3986(msg)}`;
  }

  // ---------- export ----------
  window.GKKOrder = { renderCart, buildWhatsAppLink };
})();
