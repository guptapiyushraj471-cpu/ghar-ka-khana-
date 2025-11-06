/**
 * Ghar ka Khana — menu.v2.aligned.js
 * Aligned with: menu.aligned.html and menu.json
 *
 * Assumptions:
 *   - Data served from: /menu.json
 *   - Fields: id, name, price, img, desc, category, veg
 *   - Images: item.img points to /images/<id>.jpeg (fallback used if missing)
 *
 * Exposes:
 *   window.GKKMenu = { refresh, setFilter, setSearch, setSort }
 */

(() => {
  // ---------- utils ----------
  const qs  = window.Util?.qs  || ((s, r = document) => r.querySelector(s));
  const qsa = window.Util?.qsa || ((s, r = document) => Array.from(r.querySelectorAll(s)));
  const debounce = window.Util?.debounce || ((fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; });
  const toast = window.UI?.toast || ((msg/*, type*/) => console.warn(msg));
  const spinner = window.UI?.spinner || ((el, on) => el?.classList.toggle('opacity-50', !!on));
  const stickyCartCount = window.UI?.stickyCartCount || (() => {});
  const formatINR = window.Util?.formatINR || (n => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n || 0)));
  const fetchJSON = window.Util?.fetchJSON || (async (url, opts = {}) => {
    const res = await fetch(url, { ...opts, headers: { 'Accept': 'application/json', ...(opts.headers || {}) } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (res.status === 204) return null;
    return res.json();
  });
  const esc = (s) => String(s ?? '').replace(/[<>&"']/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;', "'":'&#39;' }[c]));

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
    aiSuggestions: []
  };

  // ---------- els ----------
  let grid, searchInput, sortSelect, aiSuggest, cartCTA;

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
    aiSuggest = qs('#ai-suggest'); // optional
    cartCTA = qs('#cart-cta') || createCartCTA();

    if (!grid) { toast('Menu grid not found (#menu-grid)'); return; }

    // filter buttons (case-insensitive + Tailwind classes to match menu.html)
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-filter]');
      if (!btn) return;
      state.filter = btn.dataset.filter || FILTER_ALL;
      localStorage.setItem(LS_FILTER, state.filter);
      highlightActiveFilters();
      render();
    });
    highlightActiveFilters();

    // search
    if (searchInput) {
      searchInput.setAttribute('aria-label', 'Search menu');
      searchInput.addEventListener('input', debounce(e => {
        state.search = String(e.target.value || '').trim().toLowerCase();
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

    // reflect cart updates (optional bus)
    if (window.GKK?.on) {
      window.GKK.on('cart:updated', () => { stickyCartCount(); updateCartCTA(); });
    }

    // initial
    updateCartCTA();
    loadMenu();
  }

  // ---------- api ----------
  window.GKKMenu = {
    refresh: () => loadMenu(true),
    setFilter: f => { state.filter = f || FILTER_ALL; localStorage.setItem(LS_FILTER, state.filter); highlightActiveFilters(); render(); },
    setSearch: s => { state.search = String(s || '').toLowerCase(); render(); },
    setSort:   s => { state.sort = s || 'featured'; localStorage.setItem(LS_SORT, state.sort); render(); }
  };

  // ---------- data ----------
  async function loadMenu(force = false) {
    if (!force && state.menu.length) { render(); return; }

    state.loading = true;
    state.aiSuggestions = [];
    renderSkeleton(SKELETON_COUNT);

    spinner(grid, true);
    try {
      // IMPORTANT: fetch from /menu.json (not /api/menu)
      const data = await fetchJSON('/menu.json', { cache: 'no-store' });
      state.menu = onlyVeg(Array.isArray(data) ? data : []);
      state.loading = false;

      if (window.AI?.suggest) {
        state.aiSuggestions = window.AI.suggest(
          state.menu.filter(i => i?.id),
          { limit: 3, excludeIds: [] }
        );
      }

      render();
    } catch (err) {
      console.warn('Menu fetch error:', err);
      state.loading = false;
      grid.innerHTML = `
        <div class="text-center p-4 text-red-600">
          <p>Failed to load menu. Please try again later.</p>
          <button class="mt-2 px-4 py-2 bg-red-100 text-red-800 rounded" onclick="window.GKKMenu?.refresh()">Retry</button>
        </div>
      `;
    } finally {
      spinner(grid, false);
    }
  }

  function onlyVeg(items) {
    return items.filter(i => i && i.veg === true);
  }

  // ---------- render ----------
  function render() {
    if (!grid) return;

    if (aiSuggest) aiSuggest.innerHTML = '';
    if (state.loading) { renderSkeleton(SKELETON_COUNT); return; }

    state.filtered = applyPipeline(state.menu);

    if (aiSuggest && window.AI && state.aiSuggestions.length) {
      renderAISuggestions();
    }

    if (!state.filtered.length) {
      grid.innerHTML = `<p class="text-gray-500 p-4">No dishes found. Try a different filter or search term.</p>`;
      return;
    }

    grid.innerHTML = state.filtered.map(renderCard).join('');
    updateCartCTA();
    highlightActiveFilters();
  }

  function renderSkeleton(count = 9) {
    grid.innerHTML = Array(count).fill('').map(() => `
      <div class="animate-pulse bg-gray-100 rounded-2xl p-4 h-64"></div>
    `).join('');
  }

  function pictureURL(item) {
    const id = esc(item?.id || '');
    const fromJSON = String(item?.img || '');
    // Prefer JSON path; else fallback
    return fromJSON ? fromJSON : `/images/${id}.jpeg`;
  }

  function renderCard(item) {
    const { id, name, desc, price } = item;
    const img = pictureURL(item);
    const alt = esc(name || 'Dish');
    const rupees = (price != null && price !== '') ? `₹${price}` : '-';

    return `
      <article class="bg-white rounded-2xl shadow hover:shadow-lg transition p-4 flex flex-col">
        <div class="relative overflow-hidden rounded-xl aspect-[4/3] bg-gray-100">
          <picture>
            <source srcset="${esc(img)}" type="image/jpeg">
            <img src="${esc(img)}" alt="${alt}" loading="lazy" decoding="async"
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

  function renderAISuggestions() {
    const items = state.aiSuggestions;
    if (!items.length || !aiSuggest) return;
    aiSuggest.innerHTML = `
      <h2 class="text-lg font-semibold mb-2">Recommended for you</h2>
      <div class="flex gap-4 overflow-x-auto pb-2">
        ${items.map(item => {
          const img = pictureURL(item);
          return `
            <div class="min-w-[200px] bg-white rounded shadow p-3 flex flex-col">
              <img src="${esc(img)}" alt="${esc(item.name || 'Suggested')}" loading="lazy"
                   class="h-24 w-full object-cover rounded mb-1"
                   onerror="this.onerror=null;this.src='/images/placeholder.jpeg';"/>
              <h4 class="font-medium text-sm">${esc(item.name)}</h4>
              <span class="text-xs text-gray-500">${formatINR(item.price)}</span>
              <button
                class="add-btn mt-auto px-2 py-1 bg-green-100 text-green-800 rounded text-xs"
                aria-label="Add ${esc(item.name)}"
                data-id="${esc(item.id)}"
                data-name="${esc(item.name)}"
                data-price="${Number(item.price) || 0}"
              >Add</button>
            </div>
          `;
        }).join('')}
      </div>
      <p class="text-xs text-gray-400 mt-1">${esc(window.AI?.explain?.() || '')}</p>
    `;
  }

  // ---------- pipeline ----------
  function applyPipeline(items) {
    return sortItems(searchItems(filterItems(items)));
  }

  function filterItems(items) {
    const f = (state.filter || FILTER_ALL).toLowerCase();
    if (f === FILTER_ALL.toLowerCase()) return items;
    return items.filter(i => String(i?.category || '').toLowerCase() === f);
  }

  function searchItems(items) {
    if (!state.search) return items;
    const s = state.search;
    return items.filter(i =>
      [i?.name, i?.desc, i?.category].some(f => String(f || '').toLowerCase().includes(s))
    );
  }

  function sortItems(items) {
    const sorted = [...items];
    switch (state.sort) {
      case 'priceLow':  sorted.sort((a, b) => (a.price || 0) - (b.price || 0)); break;
      case 'priceHigh': sorted.sort((a, b) => (b.price || 0) - (a.price || 0)); break;
      case 'name':      sorted.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))); break;
      // 'featured' keeps JSON order
    }
    return sorted;
  }

  // ---------- cart ----------
  function updateCartCTA() {
    if (!cartCTA) return;
    const items = window.Cart?.get ? window.Cart.get() : [];
    const count = items.reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
    const total = window.Cart?.total ? window.Cart.total() : 0;
    cartCTA.innerHTML = `
      <div class="flex justify-between items-center w-full">
        <span class="text-sm">View Cart (${count})</span>
        <span class="font-semibold">${formatINR(total)}</span>
        <a href="/order.html" class="ml-4 px-4 py-2 bg-green-600 text-white rounded">Checkout</a>
      </div>
    `;
    stickyCartCount();
  }

  // add-to-cart delegation (cards + AI strip)
  document.addEventListener('click', e => {
    const btn = e.target.closest('.add-btn');
    if (!btn) return;

    const { id, name, price } = btn.dataset;
    const p = Number(price);
    if (!window.Cart) { toast('Cart not available'); return; }
    if (!id || !name || !Number.isFinite(p)) { toast('Invalid item'); return; }

    window.Cart.addItem({ id, name, price: p }, 1);
    window.AI?.trackAdd?.(id);

    const prev = btn.textContent;
    btn.textContent = 'Added ✓';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = prev || 'Add'; btn.disabled = false; }, 900);
    updateCartCTA();
  });

  // ---------- helpers ----------
  function createCartCTA() {
    const el = document.createElement('div');
    el.id = 'cart-cta';
    el.className = 'fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg p-4 flex justify-between items-center z-50';
    document.body.appendChild(el);
    return el;
  }

  function highlightActiveFilters() {
    // Match classes used in menu.aligned.html buttons
    qsa('button[data-filter]').forEach(b => {
      const active = (b.dataset.filter || FILTER_ALL).toLowerCase() === (state.filter || FILTER_ALL).toLowerCase();
      b.classList.toggle('bg-brand', active);
      b.classList.toggle('text-white', active);
      b.classList.toggle('border-brand', active);
      b.classList.toggle('border-gray-300', !active);
      b.classList.toggle('text-gray-700', !active);
    });
  }
})();