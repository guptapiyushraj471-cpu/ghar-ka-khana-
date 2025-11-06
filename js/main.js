/**
 * Ghar ka Khana — main.js
 * Pure-Veg Cloud Kitchen Frontend Framework
 *
 * Usage:
 *   window.GKK.on('cart:updated', (cart)=>{ ... });
 *   const suggestions = window.AI.suggest(menuItems);
 *   const url = window.AI.buildWhatsAppLink({ items, customer, total, phone });
 */

(() => {
  // ---------- constants ----------
  const CART_KEY = 'gkk_cart';
  const CO_OCCUR_KEY = 'gkk_cooccur';

  // ---------- core namespace ----------
  const GKK = {
    state: {
      cart: [],
      user: {},
      flags: { abVariant: Math.random() < 0.5 ? 'A' : 'B' }
    },
    events: Object.create(null)
  };

  // ---------- tiny utils ----------
  const safeJSON = {
    read(key, fallback = null) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        console.warn('Storage read failed', e);
        return fallback;
      }
    },
    write(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        console.warn('Storage write failed', e);
      }
    }
  };

  const Util = {
    debounce(fn, ms = 300) {
      let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    },
    qs(sel, root = document) { return root.querySelector(sel); },
    qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); },
    async fetchJSON(url, opts = {}) {
      const res = await fetch(url, {
        ...opts,
        headers: { 'Accept': 'application/json', ...(opts.headers || {}) }
      });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      if (res.status === 204) return null;
      return res.json();
    },
    phoneSanitize(str = '') { return String(str).replace(/\D/g, '').slice(-10); },
    isNonEmpty(str) { return typeof str === 'string' && str.trim().length > 0; },
    encodeRFC3986(str) {
      return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16));
    },
    formatINR(n) {
      const num = Number.isFinite(+n) ? +n : 0;
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
    },
    safeTxt(s) {
      return String(s ?? '').replace(/[<>&"']/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c]));
    }
  };

  // ---------- event bus ----------
  GKK.on = (event, fn) => {
    if (!GKK.events[event]) GKK.events[event] = [];
    GKK.events[event].push(fn);
    return () => GKK.off(event, fn);
  };
  GKK.off = (event, fn) => {
    const list = GKK.events[event]; if (!list) return;
    const idx = list.indexOf(fn); if (idx >= 0) list.splice(idx, 1);
  };
  GKK.once = (event, fn) => {
    const off = GKK.on(event, (p) => { off(); fn(p); });
  };
  GKK.emit = (event, payload) => {
    (GKK.events[event] || []).slice().forEach(fn => {
      try { fn(payload); } catch (e) { console.error('Listener error', e); }
    });
  };

  // Emit AB variant after listeners can attach
  queueMicrotask(() => GKK.emit('ab:variant', GKK.state.flags.abVariant));

  // ---------- UI helpers ----------
  const UI = {
    setYear(selector = '#year') {
      const el = document.querySelector(selector);
      if (el) el.textContent = String(new Date().getFullYear());
    },
    toast(message, type = 'info') {
      const div = document.createElement('div');
      const color =
        type === 'error' ? 'red' : type === 'success' ? 'green' : 'gray';
      div.className = `fixed bottom-4 right-4 px-4 py-2 rounded text-white text-sm z-50 bg-${color}-600`;
      div.setAttribute('role', 'alert');
      div.setAttribute('aria-live', 'polite');
      div.textContent = String(message);
      document.body.appendChild(div);
      setTimeout(() => div.remove(), 3000);
      GKK.emit('toast', { message, type });
    },
    spinner(el, on = true) {
      if (!el) return;
      el.classList.toggle('opacity-50', on);
      el.classList.toggle('pointer-events-none', on);
    },
    confirmDialog(message) { return Promise.resolve(confirm(message)); },
    stickyCartCount(selector = '[data-cart-count]') {
      const count = Cart.get().reduce((s, i) => s + (Number(i.qty) || 0), 0);
      document.querySelectorAll(selector).forEach(el => {
        el.textContent = String(count);
        el.classList.toggle('hidden', count === 0);
      });
    }
  };

  // ---------- cart ----------
  const Cart = {
    get() {
      // keep in-memory in sync with storage
      GKK.state.cart = Array.isArray(GKK.state.cart) && GKK.state.cart.length
        ? GKK.state.cart
        : safeJSON.read(CART_KEY, []);
      return GKK.state.cart;
    },
    save(cart) {
      const cleaned = (cart || []).map(i => ({
        id: i.id, name: i.name,
        price: Math.max(0, Number(i.price) || 0),
        qty: Math.max(1, Math.min(99, Number(i.qty) || 1))
      }));
      GKK.state.cart = cleaned;
      safeJSON.write(CART_KEY, cleaned);
      GKK.emit('cart:updated', cleaned);
      UI.stickyCartCount();
    },
    clear() { Cart.save([]); },
    addItem({ id, name, price }, qty = 1) {
      if (!id || !Util.isNonEmpty(name) || !Number.isFinite(+price)) {
        console.warn('Invalid item'); return;
      }
      const cart = Cart.get().slice();
      const existing = cart.find(i => i.id === id);
      const addQty = Math.max(1, Math.min(99, Number(qty) || 1));
      if (existing) {
        existing.qty = Math.min(99, existing.qty + addQty);
      } else {
        cart.push({ id, name, price: +price, qty: addQty });
      }
      Cart.save(cart);
      AI.trackAdd(id);
    },
    removeItem(id) {
      const cart = Cart.get().filter(i => i.id !== id);
      Cart.save(cart);
    },
    updateQty(id, qty) {
      const n = Math.max(0, Math.min(99, Number(qty) || 0));
      if (n === 0) return Cart.removeItem(id);
      const cart = Cart.get().map(i => i.id === id ? { ...i, qty: n } : i);
      Cart.save(cart);
    },
    total() { return Cart.get().reduce((sum, i) => sum + i.price * i.qty, 0); },
    items() {
      return Cart.get().map(i => ({
        id: i.id, name: i.name, qty: i.qty, price: i.price,
        lineTotal: i.price * i.qty
      }));
    },
    formatINR(n) { return Util.formatINR(n); }
  };

  // Cross-tab sync for cart
  window.addEventListener('storage', (e) => {
    if (e.key === CART_KEY) {
      GKK.state.cart = safeJSON.read(CART_KEY, []);
      GKK.emit('cart:updated', GKK.state.cart);
      UI.stickyCartCount();
    }
  });

  // ---------- AI-lite personalization ----------
  const AI = {
    sessionAdds: Object.create(null),

    trackAdd(itemId) {
      AI.sessionAdds[itemId] = (AI.sessionAdds[itemId] || 0) + 1;

      // batch update co-occurrence once per add
      const map = safeJSON.read(CO_OCCUR_KEY, {});
      const cart = Cart.get();
      cart.forEach(i => {
        if (i.id === itemId) return;
        // increment "when user added itemId, item i.id tended to be present"
        map[itemId] = map[itemId] || {};
        map[itemId][i.id] = (map[itemId][i.id] || 0) + 1;
      });
      safeJSON.write(CO_OCCUR_KEY, map);
    },

    suggest(menuItems, { limit = 3, excludeIds = [] } = {}) {
      const items = Array.isArray(menuItems) ? menuItems : [];
      if (!items.length) return [];

      const hour = new Date().getHours();
      const timeTag = hour < 11 ? 'breakfast' : hour < 16 ? 'lunch' : 'dinner';
      const coMap = safeJSON.read(CO_OCCUR_KEY, {});
      const cart = Cart.get();
      const exclude = new Set([...(excludeIds || []), ...cart.map(c => c.id)]);

      const scores = Object.create(null);

      items.forEach(item => {
        if (!item?.id || exclude.has(item.id)) return;
        let s = 0;

        // time-of-day tag
        if (Array.isArray(item.tags) && item.tags.includes(timeTag)) s += 5;

        // session bias
        if (AI.sessionAdds[item.id]) s += AI.sessionAdds[item.id] * 2;

        // co-occurrence with current cart
        cart.forEach(c => { s += (coMap[c.id]?.[item.id] || 0); });

        // mild price normalization (prefer mid-priced items a bit)
        if (Number.isFinite(+item.price)) {
          const p = +item.price;
          const norm = Math.max(0, Math.min(1, 1 - Math.abs(p - 200) / 300)); // peak near ₹200
          s += norm;
        }

        if (s > 0) scores[item.id] = s;
      });

      const ranked = items
        .filter(i => scores[i.id] > 0)
        .sort((a, b) => scores[b.id] - scores[a.id])
        .slice(0, Math.max(1, limit));

      GKK.emit('ai:suggest', ranked);
      return ranked;
    },

    explain() {
      const hour = new Date().getHours();
      if (hour < 11) return 'Popular at breakfast';
      if (hour < 16) return 'Popular at lunch';
      return 'Popular at dinner';
    },

    buildWhatsAppLink({ items, customer, total, phone = '+91XXXXXXXXXX' }) {
      // items: [{name, qty, lineTotal}], customer: {name, phone, address}
      if (!Array.isArray(items) || !items.length) { console.warn('No items'); return ''; }
      if (!customer?.name || !customer?.phone || !customer?.address) {
        console.warn('Invalid customer'); return '';
      }

      const lines = ['Hi Ghar ka Khana,', 'Order:'];
      items.forEach(i => {
        const nm = Util.safeTxt(i.name);
        const qt = Number(i.qty) || 0;
        const lt = Util.formatINR(i.lineTotal || 0);
        lines.push(`${nm} x${qt} = ${lt}`);
      });

      lines.push(`Total: ${Util.formatINR(total || Cart.total())}`);
      lines.push('');
      lines.push(`Customer: ${customer.name} (${Util.phoneSanitize(customer.phone)})`);
      lines.push(`Address: ${customer.address}`);

      const msg = lines.join('\n');
      const encoded = Util.encodeRFC3986(msg);
      const dest = Util.phoneSanitize(phone) || '91'; // default to country code if empty
      return `https://wa.me/${dest}?text=${encoded}`;
    }
  };

  // ---------- export ----------
  window.GKK = GKK;
  window.Cart = Cart;
  window.UI = UI;
  window.Util = Util;
  window.AI = AI;

  // ---------- first paint helpers ----------
  // set year if present and sync initial cart count
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      UI.setYear();
      UI.stickyCartCount();
      GKK.emit('cart:updated', Cart.get()); // let listeners hydrate
    });
  } else {
    UI.setYear();
    UI.stickyCartCount();
    GKK.emit('cart:updated', Cart.get());
  }
})();
