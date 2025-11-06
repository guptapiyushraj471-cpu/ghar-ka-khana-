/**
 * Ghar ka Khana — menu.aligned.js
 * Aligns with menu.aligned.html and menu.json (images: /images/<id>.jpeg)
 *
 * Exposes: window.GKKMenu = { refresh, setFilter, setSearch, setSort }
 * Optional elements:
 *   - #menu-grid (required)
 *   - #menu-search (optional)
 *   - #menu-sort (optional) values: featured | priceLow | priceHigh | name
 *   - buttons[data-filter]  (case-insensitive; "All" shows everything)
 */

(() => {
  // ---------- utils ----------
  const qs  = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const clampTxt = (s) => String(s ?? '');
  const esc = (s) => clampTxt(s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
  const inr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n || 0));

  const LS_FILTER = 'gkk_menu_filter';
  const LS_SORT   = 'gkk_menu_sort';
  const FILTER_ALL = 'All';
  const SKELETON_COUNT = 9;

  // ---------- state ----------
  const state = {
    menu: [],
    filtered: [],
    filter: localStorage.getItem(LS_FILTER) || FILTER_ALL,
    search: '',
    sort: localStorage.getItem(LS_SORT) || 'featured',
    loading: true,
    error: null
  };

  // ---------- elements ----------
  let grid, searchInput, sortSelect, filterButtons, cartCTA;

  // ---------- boot ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    grid = qs('#menu-grid');
    searchInput = qs('#menu-search');
    sortSelect = qs('#menu-sort');
    filterButtons = qsa('button[data-filter]');
    cartCTA = qs('#cart-cta') || createCartCTA();

    if (!grid) {
      console.warn('Menu grid not found (#menu-grid)');
      return;
    }

    // filters (case-insensitive & persists)
    filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        state.filter = btn.dataset.filter || FILTER_ALL;
        localStorage.setItem(LS_FILTER, state.filter);
        render();
      });
    });

    // search
    if (searchInput) {
      searchInput.setAttribute('aria-label', 'Search menu');
      searchInput.value = state.search;
      searchInput.addEventListener('input', debounce(e => {
        state.search = (e.target.value || '').trim().toLowerCase();
        render();
      }, 200));
    }

    // sort
    if (sortSelect) {
      sortSelect.value = state.sort;
      sortSelect.addEventListener('change', e => {
        state.sort = e.target.value || 'featured';
        localStorage.setItem(LS_SORT, state.sort);
        render();
      });
    }

    // add-to-cart via delegation (optional Cart)
    document.addEventListener('click', onClickAdd);

    // load data
    loadMenu();
  }

  // ---------- public api ----------
  window.GKKMenu = {
    refresh: () => loadMenu(true),
    setFilter: (f) => { state.filter = f || FILTER_ALL; localStorage.setItem(LS_FILTER, state.filter); render(); },
    setSearch: (s) => { state.search = String(s || '').toLowerCase(); render(); },
    setSort:   (s) => { state.sort = s || 'featured'; localStorage.setItem(LS_SORT, state.sort); render(); }
  };

  // ---------- events ----------
  function onClickAdd(e) {
    const btn = e.target.closest('.add-btn');
    if (!btn) return;

    const { id, name, price } = btn.dataset;
    const p = Number(price);
    if (!window.Cart) return;

    window.Cart.addItem({ id, name, price: p }, 1);
    const prev = btn.textContent;
    btn.textContent = 'Added ✓';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = prev || 'Add'; btn.disabled = false; }, 900);
  }

  // ---------- data ----------
  async function loadMenu(force = false) {
    if (!force && state.menu.length) { render(); return; }

    state.loading = true;
    state.error = null;
    render(); // show skeleton

    try {
      const r = await fetch('/menu.json', { headers: { 'Accept': 'application/json' }, cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();

      // Expect array with fields: id, name, price, img, desc, category, veg
      state.menu = Array.isArray(data) ? data : [];
      state.loading = false;
      render();
    } catch (err) {
      console.warn('Menu load failed', err);
      state.loading = false;
      state.error = 'Unable to load menu. Please try again.';
      render();
    }
  }

  // ---------- render ----------
  function render() {
    if (!grid) return;
    grid.innerHTML = '';

    // highlight active filter buttons
    qsa('button[data-filter]').forEach(b => {
      const active = (b.dataset.filter || FILTER_ALL).toLowerCase() === (state.filter || FILTER_ALL).toLowerCase();
      b.classList.toggle('bg-brand', active);
      b.classList.toggle('text-white', active);
      b.classList.toggle('border-brand', active);
      b.classList.toggle('border-gray-300', !active);
      b.classList.toggle('text-gray-700', !active);
    });

    if (state.loading) {
      grid.innerHTML = renderSkeleton(SKELETON_COUNT);
      return;
    }

    if (state.error) {
      grid.innerHTML = renderError(state.error);
      return;
    }

    state.filtered = applyPipeline(state.menu);

    if (!state.filtered.length) {
      grid.innerHTML = `<div class="text-center py-12 col-span-full text-gray-500">No dishes found.</div>`;
      return;
    }

    grid.innerHTML = state.filtered.map(renderCard).join('');
    updateCartCTA();
  }

  function renderSkeleton(count = 9) {
    return Array(count).fill('').map(() => `
      <div class="animate-pulse bg-gray-100 rounded-2xl p-4 h-64"></div>
    `).join('');
  }

  function renderError(msg) {
    return `
      <div class="text-center p-4 text-red-600">
        <p>${esc(msg)}</p>
        <button class="mt-2 px-4 py-2 bg-red-100 text-red-800 rounded" onclick="window.GKKMenu?.refresh()">Retry</button>
      </div>
    `;
  }

  function pictureURL(item) {
    const id = esc(item?.id || '');
    const fromJSON = clampTxt(item?.img || '');
    // If JSON already provides path, use it; else fall back to /images/<id>.jpeg
    return fromJSON ? esc(fromJSON) : `/images/${id}.jpeg`;
  }

  function renderCard(item) {
    const { id, name, price, desc } = item;
    const img = pictureURL(item);
    const alt = esc(name || 'Dish');
    const rupees = (price != null && price !== '') ? `₹${price}` : '-';

    return `
      <article class="bg-white rounded-2xl shadow hover:shadow-lg transition p-4 flex flex-col">
        <div class="relative overflow-hidden rounded-xl aspect-[4/3] bg-gray-100">
          <picture>
            <source srcset="${img}" type="image/jpeg">
            <img src="${img}" alt="${alt}" loading="lazy" decoding="async"
                 class="w-full h-full object-cover"
                 onerror="this.onerror=null;this.src='/images/placeholder.jpeg';" />
          </picture>
          <span class="absolute top-3 left-3 text-xs bg-green-600 text-white px-2 py-1 rounded-full font-bold">VEG</span>
        </div>
        <div class="mt-4 flex-1">
          <h3 class="font-extrabold text-lg text-gray-900">${esc(name)}</h3>
          <p class="text-sm text-gray-600 mt-1 line-clamp-2">${esc(desc || '')}</p>
        </div>
        <div class="mt-4 flex items-center justify-between">
          <span class="font-extrabold text-lg">${rupees}</span>
          <button class="add-btn px-4 py-2 rounded-xl bg-brand text-white font-bold hover:bg-orange-600 transition"
                  data-id="${esc(id)}" data-name="${esc(name)}" data-price="${Number(price) || 0}">Add</button>
        </div>
      </article>
    `;
  }

  // ---------- pipeline ----------
  function applyPipeline(items) {
    return sortItems(searchItems(filterItems(items)));
  }

  function filterItems(items) {
    const f = (state.filter || FILTER_ALL).toLowerCase();
    if (f === FILTER_ALL.toLowerCase()) return items;
    return items.filter(i => clampTxt(i?.category).toLowerCase() === f);
  }

  function searchItems(items) {
    if (!state.search) return items;
    const s = state.search;
    return items.filter(i =>
      [i?.name, i?.desc, i?.category].some(f => clampTxt(f).toLowerCase().includes(s))
    );
  }

  function sortItems(items) {
    const sorted = [...items];
    switch (state.sort) {
      case 'priceLow':  sorted.sort((a, b) => (a.price || 0) - (b.price || 0)); break;
      case 'priceHigh': sorted.sort((a, b) => (b.price || 0) - (a.price || 0)); break;
      case 'name':      sorted.sort((a, b) => clampTxt(a.name).localeCompare(clampTxt(b.name))); break;
      // featured = API order
    }
    return sorted;
  }

  // ---------- cart CTA (optional) ----------
  function createCartCTA() {
    const el = document.createElement('div');
    el.id = 'cart-cta';
    el.className = 'fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg p-4 flex justify-between items-center z-50';
    document.body.appendChild(el);
    return el;
  }

  function updateCartCTA() {
    if (!cartCTA) return;
    const cart = window.Cart?.get ? window.Cart.get() : [];
    const count = cart.reduce((s, i) => s + (Number(i.qty) || 0), 0);
    const total = window.Cart?.total ? window.Cart.total() : 0;
    cartCTA.innerHTML = `
      <span class="text-sm">View Cart (${count})</span>
      <span class="font-semibold">${inr(total)}</span>
      <a href="/order.html" class="ml-4 px-4 py-2 bg-green-600 text-white rounded">Checkout</a>
    `;
  }
})();