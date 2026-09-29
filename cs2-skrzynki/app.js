/*
  CS2 Case Lab – all app logic.
  Plain JavaScript, no libraries and no build step: just open index.html.
  Data (cases, skins) lives in data.js, which is loaded before this file.
*/
(() => {
  'use strict';

  // ---------- Settings ----------
  const STORAGE_KEY = 'cs2-case-lab';
  const START_BALANCE = 100;
  const CASE_RTP = 0.9; // a case pays back 90% of its price on average
  const UPGRADE_RTP = 0.95; // upgrader keeps a 5% edge
  const MIN_UPGRADE_CHANCE = 0.005;
  const MAX_STAKE_ITEMS = 8;
  const ST_CHANCE = 0.1; // StatTrak™ chance
  const ST_MULT = 1.8; // StatTrak™ price multiplier
  const REEL_LENGTH = 64;
  const REEL_IDLE_INDEX = 6;
  const WIN_INDEX = 56;
  const PAGE_SIZE = 60;
  const HISTORY_SIZE = 30;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const moneyFmt = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
  const money = value => moneyFmt.format(value);
  const round2 = value => Math.round(value * 100) / 100;
  const rand = (min, max) => min + Math.random() * (max - min);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const sumPrice = items => round2(items.reduce((sum, it) => sum + it.price, 0));
  const esc = text => String(text).replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));

  function pct(p) {
    const value = p * 100;
    const opts = value >= 1
      ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      : { maximumSignificantDigits: 2 };
    return new Intl.NumberFormat('pl-PL', opts).format(value) + '%';
  }

  function plural(n, one, few, many) {
    if (n === 1) return one;
    const lastDigit = n % 10;
    const lastTwo = n % 100;
    if (lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
    return many;
  }
  const itemsWord = n => plural(n, 'przedmiot', 'przedmioty', 'przedmiotów');

  // Picks one element; bigger weight = more likely.
  function pickWeighted(list, weightOf) {
    const total = list.reduce((sum, x) => sum + weightOf(x), 0);
    let r = Math.random() * total;
    for (const x of list) {
      r -= weightOf(x);
      if (r < 0) return x;
    }
    return list[list.length - 1];
  }

  // Mixes a hex colour with white (amount > 0) or black (amount < 0).
  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const target = amount < 0 ? 0 : 255;
    const p = Math.abs(amount);
    const channel = shift => {
      const c = (n >> shift) & 255;
      return Math.round(c + (target - c) * p);
    };
    return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
  }

  // ---------- Catalog ----------
  const WEAR_BY_CODE = Object.fromEntries(WEARS.map(w => [w.code, w]));
  const WEAR_EV = WEARS.reduce((sum, w) => sum + (w.chance / 100) * w.mult, 0);
  const SKINS = {};

  function weaponType(weapon) {
    if (/Gloves|Hand Wraps/.test(weapon)) return 'gloves';
    if (/Knife|Karambit|Bayonet|Daggers/.test(weapon)) return 'knife';
    return WEAPON_TYPES[weapon] || 'pistol';
  }

  function defineSkin(entry) {
    if (typeof entry === 'string') {
      if (!SKINS[entry]) throw new Error(`Unknown skin id in data.js: ${entry}`);
      return SKINS[entry];
    }
    const [weapon, name, rarity, price, color1, color2] = entry;
    const id = slug(`${weapon} ${name}`);
    if (!SKINS[id]) {
      const type = weaponType(weapon);
      SKINS[id] = {
        id, weapon, name, rarity, price, type,
        colors: [color1, color2],
        canST: type !== 'gloves',
        star: rarity === 'gold',
      };
    }
    return SKINS[id];
  }

  function priceOf(skin, wearCode, st) {
    return Math.max(0.03, round2(skin.price * WEAR_BY_CODE[wearCode].mult * (st ? ST_MULT : 1)));
  }

  const expectedValue = skin => skin.price * WEAR_EV * (skin.canST ? 1 + ST_CHANCE * (ST_MULT - 1) : 1);

  const CASE_LIST = CASES.map(def => {
    const skins = def.items.map(defineSkin);
    let weights;
    if (def.weighting === 'inverse') {
      weights = skins.map(s => 1 / s.price);
    } else {
      const perTier = {};
      skins.forEach(s => { perTier[s.rarity] = (perTier[s.rarity] || 0) + 1; });
      weights = skins.map(s => RARITIES[s.rarity].odds / perTier[s.rarity]);
    }
    const total = weights.reduce((a, b) => a + b, 0);
    const items = skins.map((skin, i) => ({ skin, chance: weights[i] / total }));
    const ev = items.reduce((sum, it) => sum + it.chance * expectedValue(it.skin), 0);
    return { ...def, items, ev, price: Math.max(0.1, round2(ev / CASE_RTP)) };
  });
  const CASE_BY_ID = Object.fromEntries(CASE_LIST.map(c => [c.id, c]));

  // Every skin in every wear can be an upgrade target.
  const TARGETS = Object.values(SKINS).flatMap(skin => WEARS.map(w => ({
    key: `${skin.id}|${w.code}`,
    skin,
    wear: w.code,
    price: priceOf(skin, w.code, false),
    search: `${skin.weapon} ${skin.name}`.toLowerCase(),
  })));
  const TARGET_BY_KEY = Object.fromEntries(TARGETS.map(t => [t.key, t]));

  const rarityRank = skin => RARITY_ORDER.indexOf(skin.rarity);
  const fullName = skin => `${skin.star ? '★ ' : ''}${skin.weapon} | ${skin.name}`;
  const itemName = item => `${item.st ? 'StatTrak™ ' : ''}${fullName(SKINS[item.skinId])} (${item.wear})`;

  // ---------- State (saved in localStorage) ----------
  const defaultState = () => ({
    balance: START_BALANCE,
    inventory: [],
    history: [],
    stats: { opened: 0, spent: 0, dropValue: 0, deposited: 0, sold: 0, upgrades: 0, upgradesWon: 0, best: null },
    settings: { sound: true, fast: false },
  });

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const base = defaultState();
        const s = {
          ...base,
          ...saved,
          stats: { ...base.stats, ...saved.stats },
          settings: { ...base.settings, ...saved.settings },
        };
        // Skip anything that no longer exists in data.js
        s.inventory = (s.inventory || []).filter(it => SKINS[it.skinId] && WEAR_BY_CODE[it.wear]);
        s.history = (s.history || []).filter(h => SKINS[h.skinId]);
        if (s.stats.best && !SKINS[s.stats.best.skinId]) s.stats.best = null;
        if (typeof s.balance !== 'number' || !isFinite(s.balance)) s.balance = START_BALANCE;
        return s;
      }
    } catch (e) {
      // Storage blocked or corrupted – start with a fresh account.
    }
    return defaultState();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // Private mode / storage full – the app still works, it just won't remember.
    }
  }

  let state = load();

  // Temporary UI state (not saved)
  const ui = {
    route: '',
    caseId: null,
    count: 1,
    spinning: false,
    spinToken: 0,
    lastDrops: [],
    invSort: 'new',
    invLimit: PAGE_SIZE,
    invSelected: new Set(),
    stake: new Set(),
    target: null,
    upResult: null,
    wheelRot: 0,
    search: '',
    targetSort: 'asc',
    targetLimit: PAGE_SIZE,
    upInvLimit: PAGE_SIZE,
  };

  // ---------- Items ----------
  const rollWear = () => pickWeighted(WEARS, w => w.chance);

  function makeItem(skin, wear = rollWear(), st = skin.canST && Math.random() < ST_CHANCE) {
    return {
      uid: newId(),
      skinId: skin.id,
      wear: wear.code,
      float: Number(rand(wear.min, wear.max).toFixed(6)),
      st,
      price: priceOf(skin, wear.code, st),
      ts: Date.now(),
    };
  }

  function recordDrop(item) {
    state.history.unshift({ skinId: item.skinId, wear: item.wear, st: item.st, price: item.price });
    state.history.length = Math.min(state.history.length, HISTORY_SIZE);
    if (!state.stats.best || item.price > state.stats.best.price) {
      state.stats.best = { skinId: item.skinId, wear: item.wear, st: item.st, price: item.price };
    }
  }

  // ---------- Sound (Web Audio, no files needed) ----------
  const sfx = (() => {
    let ctx = null;
    function tone(freq, duration, { type = 'square', volume = 0.04, delay = 0 } = {}) {
      if (!state.settings.sound) return;
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        const start = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(volume, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + duration + 0.02);
      } catch (e) {
        // Audio not available – play silently.
      }
    }
    const chord = (notes, gap = 0.08) => notes.forEach((f, i) => tone(f, 0.22, { type: 'triangle', volume: 0.07, delay: i * gap }));
    return {
      tick: () => tone(1700, 0.025, { volume: 0.02 }),
      coin: () => { tone(1320, 0.08, { type: 'triangle', volume: 0.05 }); tone(1760, 0.1, { type: 'triangle', volume: 0.05, delay: 0.06 }); },
      reveal: rarity => {
        const rank = RARITY_ORDER.indexOf(rarity);
        if (rank >= RARITY_ORDER.indexOf('covert')) chord([523, 659, 784, 1047, 1319]);
        else if (rank >= RARITY_ORDER.indexOf('restricted')) chord([523, 659, 784]);
        else chord([440, 554]);
      },
      win: () => chord([523, 659, 784, 1047]),
      lose: () => {
        tone(220, 0.25, { type: 'sawtooth', volume: 0.035 });
        tone(147, 0.4, { type: 'sawtooth', volume: 0.035, delay: 0.2 });
      },
    };
  })();

  // ---------- Graphics ----------
  // Simple weapon silhouettes (viewBox 0 0 200 80), painted with the skin colours.
  const SHAPES = {
    rifle: `<path d="M4 31 L44 26 L60 25 L61 22 L70 22 L71 25 L124 24 L127 20 L134 20 L135 24 L166 25 L168 21 L172 21 L173 25 L197 25 L197 29 L162 30 L151 31 L149 35 L120 36 L113 36 Q118 51 127 61 L115 65 Q107 52 101 36 L86 36 L81 57 L70 57 L73 37 L50 38 L10 50 L4 48 Z"/>
      <path class="shine" d="M46 27.5 L124 25.8 L124 27.8 L46 29.5 Z"/>
      <path class="shade" d="M124 29 L160 29 L150 31 L149 34 L124 35 Z"/>`,
    sniper: `<path d="M3 37 L22 31 L58 30 L64 32 L150 32 L150 33 L197 33 L197 37 L150 37 L147 40 L118 40 L117 51 L104 51 L105 40 L89 40 L84 58 L73 58 L76 42 L64 42 L55 51 L43 51 L50 42 L28 44 L7 53 L3 51 Z"/>
      <path d="M76 21 Q76 17 80 17 L127 17 Q131 17 131 21 L131 26 Q131 28 127 28 L80 28 Q76 28 76 26 Z"/>
      <path d="M88 28 H93 V32 H88 Z M113 28 H118 V32 H113 Z"/>
      <path class="shine" d="M80 19.5 L127 19.5 L127 21.5 L80 21.5 Z"/>`,
    smg: `<path d="M8 30 L26 30 L26 33 L60 28 L136 27 L137 24 L148 24 L149 27 L172 28 L172 33 L150 33 L140 35 L121 36 L121 64 L108 64 L108 36 L90 36 L85 58 L74 58 L78 37 L58 37 L28 40 L13 43 L8 43 Z"/>
      <path class="shine" d="M62 29.5 L136 28.6 L136 30.6 L62 31.5 Z"/>`,
    pistol: `<path d="M56 24 L146 24 L149 27 L149 40 L105 40 Q104 51 93 51 L87 50 L82 68 L62 68 L68 40 L56 40 Z"/>
      <path class="shine" d="M58 26 L146 26 L146 28.5 L58 28.5 Z"/>`,
    shotgun: `<path d="M4 34 L40 28 L70 27 L178 27 L179 24 L184 24 L185 27 L197 27 L197 31 L165 31 L165 34 L160 34 L158 38 L124 38 L122 34 L108 34 L105 38 L93 38 L88 58 L77 58 L81 40 L58 40 L12 50 L4 48 Z"/>
      <path class="shade" d="M126 34 L157 34 L156 37 L126 37 Z"/>
      <path class="shine" d="M42 29.5 L178 28.6 L178 30.2 L42 31 Z"/>`,
    mg: `<path d="M4 32 L40 26 L128 25 L129 21 L140 21 L141 25 L197 26 L197 30 L152 31 L150 36 L130 37 L130 58 L104 58 L104 38 L90 38 L85 58 L74 58 L78 39 L50 39 L10 50 L4 48 Z"/>
      <path d="M160 31 L164 31 L174 57 L170 58 Z M166 31 L170 31 L160 58 L156 57 Z"/>
      <path class="shade" d="M106 42 L128 42 L128 56 L106 56 Z"/>`,
    knife: `<path class="handle" d="M14 40 Q14 33 22 33 L80 34.5 L80 45.5 L22 47 Q14 47 14 40 Z"/>
      <path class="guard" d="M80 28 L87 28 L87 52 L80 52 Z"/>
      <path d="M87 33 L150 30 Q182 31 197 41 Q172 47 140 47 L87 46 Z"/>
      <path class="shine" d="M90 34.5 L150 32.5 Q175 33.5 188 39 Q168 37 150 36.5 L90 37.5 Z"/>`,
    gloves: `<rect x="70" y="16" width="11" height="30" rx="5.5"/>
      <rect x="82.5" y="7" width="11" height="39" rx="5.5"/>
      <rect x="95" y="9" width="11" height="37" rx="5.5"/>
      <rect x="107.5" y="17" width="10" height="29" rx="5"/>
      <path d="M68 36 Q68 30 74 30 L114 30 Q120 30 120 36 L120 44 L132 34 Q138 30 141 35 Q143 39 139 43 L122 62 Q118 66 112 66 L76 66 Q68 66 68 58 Z"/>
      <rect class="shade" x="71" y="61" width="46" height="15" rx="3"/>`,
  };

  let svgSeq = 0;

  function weaponSVG(skin) {
    const id = `g${++svgSeq}`;
    const [c1, c2] = skin.colors;
    return `<svg class="art" viewBox="0 0 200 80" aria-hidden="true" focusable="false">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
      </linearGradient></defs>
      <g class="shape" fill="url(#${id})">${SHAPES[skin.type]}</g>
    </svg>`;
  }

  function caseSVG(c) {
    const id = `c${++svgSeq}`;
    const markSize = c.mark.length > 2 ? 13 : 20;
    return `<svg class="case-art" viewBox="0 0 160 120" aria-hidden="true" focusable="false">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${shade(c.color, 0.25)}"/><stop offset="1" stop-color="${shade(c.color, -0.45)}"/>
      </linearGradient></defs>
      <ellipse cx="80" cy="112" rx="64" ry="6" fill="rgba(0,0,0,.45)"/>
      <rect x="62" y="12" width="36" height="16" rx="6" fill="none" stroke="#1d222b" stroke-width="6"/>
      <rect x="14" y="36" width="132" height="72" rx="8" fill="url(#${id})"/>
      <path d="M14 94 H146 V100 Q146 108 138 108 H22 Q14 108 14 100 Z" fill="rgba(0,0,0,.25)"/>
      <rect x="10" y="24" width="140" height="22" rx="6" fill="${shade(c.color, -0.15)}"/>
      <rect x="10" y="24" width="140" height="5" rx="2.5" fill="rgba(255,255,255,.25)"/>
      <rect x="10" y="42" width="140" height="4" fill="rgba(0,0,0,.3)"/>
      <rect x="30" y="40" width="12" height="16" rx="2" fill="#1d222b"/>
      <rect x="118" y="40" width="12" height="16" rx="2" fill="#1d222b"/>
      <circle cx="80" cy="74" r="19" fill="rgba(0,0,0,.3)" stroke="rgba(255,255,255,.4)" stroke-width="2"/>
      <text x="80" y="${markSize > 15 ? 81 : 78.5}" text-anchor="middle" font-size="${markSize}" font-weight="800" fill="#fff" font-family="system-ui, sans-serif">${esc(c.mark)}</text>
    </svg>`;
  }

  const stBadge = item => (item.st ? '<span class="badge-st" title="StatTrak™">ST™</span>' : '');
  const itemMeta = item => `<span class="card-wear">${item.wear} · ${item.float.toFixed(4)}</span><span class="card-price">${money(item.price)}</span>`;

  /*
    One card template for every place a skin is shown.
    hit     – makes the whole card a toggle button (selection)
    actions – extra buttons shown under the card
  */
  function card(skin, { cls = '', attrs = '', badges = '', meta = '', hit = null, actions = '', id = '' } = {}) {
    const classes = ['card', `r-${skin.rarity}`, cls];
    if (hit) classes.push('selectable');
    if (hit && hit.pressed) classes.push('is-selected');
    const hitButton = hit
      ? `<button type="button" class="card-hit" data-action="${hit.action}" data-id="${esc(hit.id)}" aria-pressed="${!!hit.pressed}" aria-label="${esc(hit.label)}"></button>`
      : '';
    const dataId = id || (hit ? hit.id : '');
    return `<article class="${classes.join(' ')}"${dataId ? ` data-id="${esc(dataId)}"` : ''} ${attrs}>
      ${hitButton}
      <div class="card-art">${weaponSVG(skin)}${badges}</div>
      <div class="card-body">
        <span class="card-weapon">${esc(skin.star ? '★ ' + skin.weapon : skin.weapon)}</span>
        <span class="card-name">${esc(skin.name)}</span>
        ${meta}
      </div>
      ${actions ? `<div class="card-actions">${actions}</div>` : ''}
    </article>`;
  }

  const moreButton = (action, remaining) => `<div class="more"><button type="button" class="btn" data-action="${action}">Pokaż więcej (${remaining})</button></div>`;

  // ---------- Header, feed, toasts ----------
  let shownBalance = null;
  let balanceTimer = 0;

  function renderBalance() {
    const box = $('#balance-box');
    $('#balance').textContent = money(state.balance);
    if (shownBalance !== null && state.balance !== shownBalance) {
      box.classList.remove('up', 'down');
      void box.offsetWidth; // restart the flash animation
      box.classList.add(state.balance > shownBalance ? 'up' : 'down');
      clearTimeout(balanceTimer);
      balanceTimer = setTimeout(() => box.classList.remove('up', 'down'), 900);
    }
    shownBalance = state.balance;
  }

  const renderInvCount = () => { $('#inv-count').textContent = state.inventory.length; };

  const ICON_SOUND_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const ICON_SOUND_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function renderSoundButton() {
    const btn = $('#sound-btn');
    btn.innerHTML = state.settings.sound ? ICON_SOUND_ON : ICON_SOUND_OFF;
    btn.setAttribute('aria-pressed', String(state.settings.sound));
  }

  function renderFeed(newCount = 0) {
    const feed = $('#feed');
    if (!state.history.length) {
      feed.innerHTML = '<p class="feed-empty">Tu pojawią się Twoje ostatnie dropy.</p>';
      return;
    }
    feed.innerHTML = state.history.slice(0, 20).map((h, i) => {
      const skin = SKINS[h.skinId];
      return `<div class="feed-item r-${skin.rarity}${i < newCount ? ' is-new' : ''}" title="${esc(`${h.st ? 'StatTrak™ ' : ''}${fullName(skin)} (${h.wear}) – ${money(h.price)}`)}">
        ${weaponSVG(skin)}<span>${esc(skin.name)}</span>
      </div>`;
    }).join('');
  }

  function toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    $('#toasts').append(el);
    setTimeout(() => el.classList.add('out'), 2800);
    setTimeout(() => el.remove(), 3200);
  }

  // ---------- Money ----------
  function openFunds(missing = 0) {
    const dialog = $('#funds-dialog');
    const input = $('#funds-amount');
    $('#funds-hint').textContent = missing > 0
      ? `Brakuje Ci ${money(missing)}, aby otworzyć tę skrzynkę.`
      : 'Środki są wirtualne – dodaj tyle, ile chcesz.';
    $('#funds-error').textContent = '';
    input.value = missing > 0 ? Math.max(10, Math.ceil(missing)) : 100;
    dialog.showModal();
    input.select();
  }

  function addFunds(amount) {
    state.balance = round2(state.balance + amount);
    state.stats.deposited = round2(state.stats.deposited + amount);
    save();
    renderBalance();
    sfx.coin();
    toast(`Dodano ${money(amount)} do salda.`, 'success');
    if (ui.route === 'ekwipunek') renderInventory();
  }

  function sellItems(uids, { quiet = false } = {}) {
    const ids = new Set(uids);
    const sold = state.inventory.filter(it => ids.has(it.uid));
    if (!sold.length) return 0;
    const total = sumPrice(sold);
    state.inventory = state.inventory.filter(it => !ids.has(it.uid));
    state.balance = round2(state.balance + total);
    state.stats.sold = round2(state.stats.sold + total);
    sold.forEach(it => { ui.invSelected.delete(it.uid); ui.stake.delete(it.uid); });
    save();
    renderBalance();
    renderInvCount();
    sfx.coin();
    if (!quiet) toast(`Sprzedano ${sold.length} ${itemsWord(sold.length)} za ${money(total)}.`, 'success');
    return total;
  }

  // ---------- View: case list ----------
  function caseTile(c) {
    return `<a class="case-tile" href="#/skrzynka/${c.id}" style="--case:${c.color}">
      ${c.tag ? `<span class="case-tag">${esc(c.tag)}</span>` : ''}
      ${caseSVG(c)}
      <span class="case-name">${esc(c.name)}</span>
      <span class="case-price">${money(c.price)}</span>
    </a>`;
  }

  function renderCases() {
    const official = CASE_LIST.filter(c => c.group === 'official');
    const special = CASE_LIST.filter(c => c.group === 'special').sort((a, b) => a.price - b.price);
    $('#app').innerHTML = `
      <section class="intro">
        <h1>Otwieraj skrzynki CS2</h1>
        <p class="muted">Losuj skiny, sprzedawaj je albo ryzykuj w upgraderze. Wszystko działa lokalnie – saldo i ekwipunek zapisują się w Twojej przeglądarce.</p>
      </section>
      <section class="block">
        <h2 class="block-title">Skrzynki CS2</h2>
        <div class="case-grid">${official.map(caseTile).join('')}</div>
      </section>
      <section class="block">
        <h2 class="block-title">Skrzynki specjalne</h2>
        <div class="case-grid">${special.map(caseTile).join('')}</div>
      </section>`;
  }

  // ---------- View: single case ----------
  function contentCard({ skin, chance }) {
    const low = priceOf(skin, 'BS', false);
    const high = priceOf(skin, 'FN', skin.canST);
    return card(skin, {
      badges: `<span class="chance">${pct(chance)}</span>`,
      meta: `<span class="card-range">${money(low)} – ${money(high)}</span>`,
    });
  }

  function renderCase(c) {
    const sorted = [...c.items].sort((a, b) => rarityRank(b.skin) - rarityRank(a.skin) || b.skin.price - a.skin.price);
    $('#app').innerHTML = `
      <a class="back" href="#/skrzynki">← Wszystkie skrzynki</a>
      <section class="case-hero" style="--case:${c.color}">
        <div class="case-hero-art">${caseSVG(c)}</div>
        <div class="case-hero-info">
          <h1>${esc(c.name)}</h1>
          <p class="muted">${esc(c.desc)}</p>
          <dl class="case-facts">
            <div><dt>Cena</dt><dd>${money(c.price)}</dd></div>
            <div><dt>Średni drop</dt><dd>${money(c.ev)}</dd></div>
            <div><dt>Przedmioty</dt><dd>${c.items.length}</dd></div>
          </dl>
          <div class="open-controls">
            <div class="segmented" role="group" aria-label="Ile skrzynek otworzyć naraz">
              ${[1, 2, 3, 4, 5].map(n => `<button type="button" data-action="set-count" data-count="${n}" aria-pressed="${n === ui.count}">${n}×</button>`).join('')}
            </div>
            <button type="button" class="btn btn-primary btn-lg" data-action="open-case" id="open-btn"></button>
            <label class="check"><input type="checkbox" class="fast-toggle"${state.settings.fast ? ' checked' : ''}> Szybkie otwieranie</label>
          </div>
        </div>
      </section>
      <section class="reels" id="reels" aria-hidden="true"></section>
      <section class="block">
        <h2 class="block-title">Zawartość skrzynki</h2>
        <div class="card-grid">${sorted.map(contentCard).join('')}</div>
      </section>`;
    updateOpenButton(c);
    buildReels(c, null);
  }

  function updateOpenButton(c) {
    const btn = $('#open-btn');
    if (btn) btn.textContent = `Otwórz za ${money(round2(c.price * ui.count))}`;
  }

  function setCount(n) {
    const c = CASE_BY_ID[ui.caseId];
    if (!c) return;
    ui.count = n;
    $$('[data-action="set-count"]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.count) === n)));
    updateOpenButton(c);
    buildReels(c, null);
  }

  // ---------- Reel (the spinning strip) ----------
  // Filler cards use flattened odds so rare items flash by more often – purely visual.
  const fillerSkin = c => pickWeighted(c.items, it => Math.pow(it.chance, 0.5)).skin;

  function reelCard(skin) {
    return `<div class="card reel-card r-${skin.rarity}">
      <div class="card-art">${weaponSVG(skin)}</div>
      <div class="card-body">
        <span class="card-weapon">${esc(skin.star ? '★ ' + skin.weapon : skin.weapon)}</span>
        <span class="card-name">${esc(skin.name)}</span>
      </div>
    </div>`;
  }

  function buildReels(c, winners) {
    const box = $('#reels');
    if (!box) return;
    const count = winners ? winners.length : ui.count;
    box.dataset.count = count;
    box.innerHTML = Array.from({ length: count }, (_, r) => {
      const cards = Array.from({ length: REEL_LENGTH }, (_, k) => (
        reelCard(winners && k === WIN_INDEX ? winners[r] : fillerSkin(c))
      )).join('');
      return `<div class="reel-wrap">
        <div class="reel"><div class="reel-track">${cards}</div></div>
        <div class="reel-marker"></div>
      </div>`;
    }).join('');
    $$('.reel-track', box).forEach(track => placeTrack(track, REEL_IDLE_INDEX, 0.5));
  }

  function trackMetrics(track) {
    const cardWidth = track.firstElementChild.getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    return { cardWidth, step: cardWidth + gap, half: track.parentElement.clientWidth / 2 };
  }

  // Moves the strip so that card `index` sits under the marker (`frac` = where inside that card).
  function placeTrack(track, index, frac, duration = 0) {
    const { cardWidth, step, half } = trackMetrics(track);
    const x = half - (index * step + frac * cardWidth);
    track.dataset.index = index;
    track.dataset.frac = frac;
    track.style.transition = duration ? `transform ${duration}s cubic-bezier(.08,.62,.1,1)` : 'none';
    track.style.transform = `translate3d(${x}px, 0, 0)`;
  }

  function reelTicks(track, token) {
    const { step, half } = trackMetrics(track);
    let last = null;
    const loop = () => {
      if (token !== ui.spinToken || !ui.spinning || !track.isConnected) return;
      const x = new DOMMatrixReadOnly(getComputedStyle(track).transform).m41;
      const index = Math.floor((half - x) / step);
      if (last !== null && index !== last) sfx.tick();
      last = index;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  function spinDuration(normal, fast) {
    if (reduceMotion) return 0.4;
    return state.settings.fast ? fast : normal;
  }

  function spinReels(token) {
    const tracks = $$('#reels .reel-track');
    tracks.forEach(track => void getComputedStyle(track).transform); // lock in the start position
    const durations = tracks.map((_, i) => spinDuration(6 + i * 0.3, 1.4 + i * 0.1));
    tracks.forEach((track, i) => placeTrack(track, WIN_INDEX, rand(0.1, 0.9), durations[i]));
    if (tracks[0]) reelTicks(tracks[0], token);
    return wait(Math.max(...durations) * 1000 + 120);
  }

  function lockCaseControls(locked) {
    $$('.open-controls button').forEach(b => { b.disabled = locked; });
  }

  async function openCase(c) {
    if (!c || ui.spinning) return;
    const count = ui.count;
    const cost = round2(c.price * count);
    if (state.balance < cost) {
      openFunds(round2(cost - state.balance));
      return;
    }

    // Pay and roll first, then animate – the result is already decided and saved.
    state.balance = round2(state.balance - cost);
    const drops = Array.from({ length: count }, () => makeItem(pickWeighted(c.items, it => it.chance).skin));
    state.inventory.unshift(...drops);
    state.stats.opened += count;
    state.stats.spent = round2(state.stats.spent + cost);
    state.stats.dropValue = round2(state.stats.dropValue + sumPrice(drops));
    drops.forEach(recordDrop);
    save();
    renderBalance();

    ui.spinning = true;
    const token = ++ui.spinToken;
    lockCaseControls(true);
    buildReels(c, drops.map(d => SKINS[d.skinId]));
    await spinReels(token);
    if (token !== ui.spinToken) return; // user left the page mid-spin

    ui.spinning = false;
    lockCaseControls(false);
    $$('#reels .reel').forEach(reel => {
      reel.classList.add('done');
      reel.querySelector('.reel-track').children[WIN_INDEX].classList.add('win');
    });
    renderFeed(drops.length);
    renderInvCount();
    const best = drops.reduce((a, b) => (rarityRank(SKINS[b.skinId]) > rarityRank(SKINS[a.skinId]) ? b : a));
    sfx.reveal(SKINS[best.skinId].rarity);

    await wait(reduceMotion ? 0 : 450);
    if (ui.route === 'skrzynka' && ui.caseId === c.id) showDropDialog(drops);
  }

  // ---------- Drop dialog ----------
  function showDropDialog(drops) {
    ui.lastDrops = drops;
    $('#drop-title').textContent = drops.length > 1 ? `Twoje dropy (${drops.length})` : 'Twój drop';
    $('#drop-grid').innerHTML = drops.map((item, i) => card(SKINS[item.skinId], {
      cls: 'drop-card',
      id: item.uid,
      attrs: `style="animation-delay:${i * 90}ms"`,
      badges: stBadge(item),
      meta: `<span class="card-wear">${WEAR_BY_CODE[item.wear].name} · ${item.float.toFixed(4)}</span><span class="card-price">${money(item.price)}</span>`,
      actions: `<button type="button" class="btn btn-sm" data-action="drop-sell" data-id="${item.uid}">Sprzedaj</button>
        <button type="button" class="btn btn-sm btn-ghost" data-action="to-upgrader" data-id="${item.uid}">Upgrade</button>`,
    })).join('');
    updateDropSummary();
    $('#drop-dialog').showModal();
  }

  function updateDropSummary() {
    const owned = new Set(state.inventory.map(it => it.uid));
    const remaining = ui.lastDrops.filter(it => owned.has(it.uid));
    $('#drop-total').innerHTML = `Wartość dropu: <strong>${money(sumPrice(ui.lastDrops))}</strong>`;
    const sellAll = $('#drop-sell-all');
    sellAll.disabled = remaining.length === 0;
    sellAll.textContent = remaining.length ? `Sprzedaj wszystko (${money(sumPrice(remaining))})` : 'Wszystko sprzedane';
  }

  function sellFromDrop(uid) {
    if (!sellItems([uid], { quiet: true })) return;
    const cardEl = $(`#drop-grid .card[data-id="${uid}"]`);
    if (cardEl) {
      cardEl.classList.add('sold');
      cardEl.querySelector('.card-actions').innerHTML = '<span class="sold-label">Sprzedano ✓</span>';
    }
    updateDropSummary();
  }

  // ---------- View: inventory ----------
  const INV_SORTS = [
    ['new', 'Najnowsze', (a, b) => b.ts - a.ts],
    ['price-desc', 'Najdroższe', (a, b) => b.price - a.price],
    ['price-asc', 'Najtańsze', (a, b) => a.price - b.price],
    ['rarity', 'Rzadkość', (a, b) => rarityRank(SKINS[b.skinId]) - rarityRank(SKINS[a.skinId]) || b.price - a.price],
  ];

  function sortedInventory() {
    const sorter = (INV_SORTS.find(s => s[0] === ui.invSort) || INV_SORTS[0])[2];
    return [...state.inventory].sort(sorter);
  }

  function invCard(item) {
    const skin = SKINS[item.skinId];
    return card(skin, {
      hit: { action: 'inv-toggle', id: item.uid, pressed: ui.invSelected.has(item.uid), label: `Zaznacz: ${itemName(item)}` },
      badges: stBadge(item),
      meta: itemMeta(item),
      actions: `<button type="button" class="btn btn-sm" data-action="sell-one" data-id="${item.uid}">Sprzedaj</button>
        <button type="button" class="btn btn-sm btn-ghost" data-action="to-upgrader" data-id="${item.uid}">Upgrade</button>`,
    });
  }

  function inventoryToolbarState() {
    const selected = state.inventory.filter(it => ui.invSelected.has(it.uid));
    const sellBtn = $('#sell-selected');
    const allBtn = $('#select-all');
    if (sellBtn) {
      sellBtn.disabled = selected.length === 0;
      sellBtn.textContent = selected.length
        ? `Sprzedaj zaznaczone (${selected.length}) · ${money(sumPrice(selected))}`
        : 'Sprzedaj zaznaczone';
    }
    if (allBtn) {
      allBtn.textContent = selected.length === state.inventory.length ? 'Odznacz wszystko' : 'Zaznacz wszystko';
    }
  }

  function statsHTML() {
    const s = state.stats;
    const best = s.best && SKINS[s.best.skinId];
    const worth = round2(state.balance + sumPrice(state.inventory));
    const profit = round2(worth - START_BALANCE - s.deposited);
    const tiles = [
      ['Otwarte skrzynki', s.opened],
      ['Wydano na skrzynki', money(s.spent)],
      ['Wartość dropów', money(s.dropValue)],
      ['Sprzedano za', money(s.sold)],
      ['Wpłacono', money(s.deposited)],
      ['Wygrane upgrade’y', `${s.upgradesWon} / ${s.upgrades}`],
      ['Majątek (saldo + EQ)', money(worth)],
      ['Bilans', `<span class="${profit >= 0 ? 'pos' : 'neg'}">${profit > 0 ? '+' : ''}${money(profit)}</span>`],
    ];
    return `<section class="block">
      <h2 class="block-title">Statystyki</h2>
      <div class="stats">
        ${tiles.map(([label, value]) => `<div class="stat"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong></div>`).join('')}
        <div class="stat stat-wide">
          <span class="stat-label">Najlepszy drop</span>
          <strong class="stat-value">${best ? `${esc(`${s.best.st ? 'StatTrak™ ' : ''}${fullName(best)}`)} <span class="muted">(${s.best.wear})</span> · ${money(s.best.price)}` : '—'}</strong>
        </div>
      </div>
      <div class="danger-zone">
        <button type="button" class="btn btn-danger btn-sm" data-action="reset-all">Zresetuj konto</button>
        <span class="muted">Usuwa saldo, ekwipunek i statystyki z tej przeglądarki.</span>
      </div>
    </section>`;
  }

  function renderInventory() {
    const inv = sortedInventory();
    const shown = inv.slice(0, ui.invLimit);
    $('#app').innerHTML = `
      <div class="page-head">
        <div>
          <h1>Ekwipunek</h1>
          <p class="muted">${inv.length} ${itemsWord(inv.length)} · łączna wartość <strong class="accent">${money(sumPrice(inv))}</strong></p>
        </div>
        ${inv.length ? `<div class="toolbar">
          <label><span class="sr-only">Sortowanie</span>
            <select id="inv-sort" class="input">
              ${INV_SORTS.map(([value, label]) => `<option value="${value}"${ui.invSort === value ? ' selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
          <button type="button" class="btn" data-action="inv-select-all" id="select-all"></button>
          <button type="button" class="btn btn-primary" data-action="inv-sell-selected" id="sell-selected"></button>
          <button type="button" class="btn btn-danger" data-action="inv-sell-all">Sprzedaj wszystko</button>
        </div>` : ''}
      </div>
      ${inv.length
        ? `<div class="card-grid">${shown.map(invCard).join('')}</div>${inv.length > shown.length ? moreButton('inv-more', inv.length - shown.length) : ''}`
        : `<div class="empty-state"><p>Twój ekwipunek jest pusty.</p><a class="btn btn-primary" href="#/skrzynki">Otwórz pierwszą skrzynkę</a></div>`}
      ${statsHTML()}`;
    inventoryToolbarState();
  }

  // ---------- View: upgrader ----------
  function stakeItems() {
    const items = state.inventory.filter(it => ui.stake.has(it.uid));
    if (items.length !== ui.stake.size) ui.stake = new Set(items.map(it => it.uid)); // drop sold items
    return items;
  }

  function upgradeChance(stake, target) {
    if (!target || stake <= 0 || target.price <= stake) return 0;
    return (stake / target.price) * UPGRADE_RTP;
  }

  function currentChance() {
    return upgradeChance(sumPrice(stakeItems()), ui.target);
  }

  function renderUpgrader() {
    $('#app').innerHTML = `
      <div class="upgrader-page" id="upgrader-page">
        <div class="page-head">
          <div>
            <h1>Upgrader</h1>
            <p class="muted">Postaw swoje skiny i spróbuj zamienić je na droższy przedmiot. Im większy mnożnik, tym mniejsza szansa. Przegrana = tracisz postawione skiny.</p>
          </div>
        </div>
        <section class="upgrader">
          <div class="up-slot" id="up-stake"></div>
          <div class="up-center">
            <div class="wheel" id="wheel">
              <svg viewBox="0 0 200 200" aria-hidden="true">
                <circle class="wheel-track" cx="100" cy="100" r="86"/>
                <circle class="wheel-arc" id="wheel-arc" cx="100" cy="100" r="86" pathLength="100" transform="rotate(-90 100 100)"/>
              </svg>
              <div class="wheel-pointer" id="wheel-pointer"></div>
              <div class="wheel-center" id="wheel-center" aria-live="polite"></div>
            </div>
            <div class="up-mults" role="group" aria-label="Wybierz cel według mnożnika">
              ${[1.5, 2, 3, 5, 10].map(m => `<button type="button" class="btn btn-sm" data-action="up-mult" data-mult="${m}">x${String(m).replace('.', ',')}</button>`).join('')}
            </div>
            <button type="button" class="btn btn-primary btn-lg up-spin" id="up-spin" data-action="up-spin">Upgrade</button>
            <label class="check"><input type="checkbox" class="fast-toggle"${state.settings.fast ? ' checked' : ''}> Szybki obrót</label>
          </div>
          <div class="up-slot" id="up-target"></div>
        </section>
        <section class="up-lists">
          <div class="up-list">
            <div class="block-head">
              <h2 class="block-title">Twoje przedmioty</h2>
              <button type="button" class="btn btn-sm btn-ghost" data-action="up-clear">Wyczyść wkład</button>
            </div>
            <div id="up-inv"></div>
          </div>
          <div class="up-list">
            <div class="block-head">
              <h2 class="block-title">Wybierz cel</h2>
              <div class="toolbar">
                <input type="search" id="up-search" class="input" placeholder="Szukaj skina…" aria-label="Szukaj skina" value="${esc(ui.search)}">
                <label><span class="sr-only">Sortowanie celów</span>
                  <select id="up-sort" class="input">
                    <option value="asc"${ui.targetSort === 'asc' ? ' selected' : ''}>Najtańsze</option>
                    <option value="desc"${ui.targetSort === 'desc' ? ' selected' : ''}>Najdroższe</option>
                  </select>
                </label>
              </div>
            </div>
            <div id="up-targets"></div>
          </div>
        </section>
      </div>`;
    const pointer = $('#wheel-pointer');
    pointer.style.transition = 'none';
    pointer.style.transform = `rotate(${ui.wheelRot}deg)`;
    updateUpgrader();
  }

  function updateUpgrader() {
    renderStakeSlot();
    renderTargetSlot();
    renderWheel();
    renderUpgradeInventory();
    renderTargets();
  }

  function renderStakeSlot() {
    const el = $('#up-stake');
    const items = stakeItems();
    el.classList.toggle('filled', items.length > 0);
    if (!items.length) {
      const lost = ui.upResult && !ui.upResult.win;
      el.innerHTML = `<span class="up-slot-title">Twój wkład</span>
        <div class="up-slot-empty">${lost
          ? `<p><strong class="neg">Przegrana</strong><br>Straciłeś przedmioty o wartości ${money(ui.upResult.stake)}.</p>`
          : `<p>Wybierz do ${MAX_STAKE_ITEMS} przedmiotów<br>z listy „Twoje przedmioty”.</p>`}
        </div>`;
      return;
    }
    const top = items.reduce((a, b) => (b.price > a.price ? b : a));
    const topSkin = SKINS[top.skinId];
    el.innerHTML = `
      <span class="up-slot-title">Twój wkład · ${items.length}/${MAX_STAKE_ITEMS}</span>
      <div class="up-slot-art r-${topSkin.rarity}">${weaponSVG(topSkin)}</div>
      <div class="up-chips">
        ${items.map(it => {
          const skin = SKINS[it.skinId];
          return `<button type="button" class="chip-item r-${skin.rarity}" data-action="up-stake" data-id="${it.uid}" aria-label="Usuń z wkładu: ${esc(itemName(it))}">
            ${weaponSVG(skin)}<span>${esc(skin.name)}</span><span aria-hidden="true">✕</span>
          </button>`;
        }).join('')}
      </div>
      <div class="up-slot-foot"><span class="muted">Wartość wkładu</span><strong class="up-value">${money(sumPrice(items))}</strong></div>`;
  }

  function renderTargetSlot() {
    const el = $('#up-target');
    const t = ui.target;
    el.classList.toggle('filled', !!t);
    el.classList.toggle('won', !!(ui.upResult && ui.upResult.win));
    if (!t) {
      el.innerHTML = `<span class="up-slot-title">Cel</span>
        <div class="up-slot-empty"><p>Wybierz skin, który chcesz zdobyć,<br>albo kliknij mnożnik.</p></div>`;
      return;
    }
    const stake = sumPrice(stakeItems());
    const tooCheap = stake > 0 && t.price <= stake;
    const tooRare = stake > 0 && !tooCheap && upgradeChance(stake, t) < MIN_UPGRADE_CHANCE;
    const won = ui.upResult && ui.upResult.win;
    el.innerHTML = `
      <span class="up-slot-title">${won ? 'Wygrana! Przedmiot trafił do ekwipunku' : 'Cel'}</span>
      <div class="up-slot-art r-${t.skin.rarity}">${weaponSVG(t.skin)}</div>
      <div class="up-target-name">
        <span class="card-weapon">${esc(t.skin.star ? '★ ' + t.skin.weapon : t.skin.weapon)}</span>
        <strong>${esc(t.skin.name)}</strong>
        <span class="muted">${WEAR_BY_CODE[t.wear].name}</span>
      </div>
      ${tooCheap ? '<p class="up-warn">Cel musi być droższy niż Twój wkład.</p>' : ''}
      ${tooRare ? `<p class="up-warn">Szansa za mała (minimum ${pct(MIN_UPGRADE_CHANCE)}). Dodaj więcej przedmiotów.</p>` : ''}
      <div class="up-slot-foot">
        <span class="muted">${stake > 0 && !tooCheap ? `Mnożnik x${(t.price / stake).toFixed(2).replace('.', ',')}` : 'Wartość'}</span>
        <strong class="up-value">${money(t.price)}</strong>
      </div>`;
  }

  function renderWheel() {
    const chance = currentChance();
    const wheel = $('#wheel');
    const result = ui.upResult;
    wheel.classList.toggle('win', !!(result && result.win));
    wheel.classList.toggle('lose', !!(result && !result.win));
    $('#wheel-arc').style.strokeDasharray = `${(result ? result.chance : chance) * 100} 100`;
    $('#wheel-center').innerHTML = result
      ? `<strong class="res">${result.win ? 'WYGRANA!' : 'PRZEGRANA'}</strong><span>wylosowano ${pct(result.roll)}</span>`
      : `<strong>${pct(chance)}</strong><span>szansa na wygraną</span>`;
    const canSpin = chance >= MIN_UPGRADE_CHANCE && !ui.spinning;
    const spin = $('#up-spin');
    spin.disabled = !canSpin;
    spin.textContent = canSpin ? `Upgrade · ${pct(chance)}` : 'Upgrade';
  }

  function renderUpgradeInventory() {
    const el = $('#up-inv');
    const inv = [...state.inventory].sort((a, b) => b.price - a.price);
    if (!inv.length) {
      el.innerHTML = `<div class="empty-state"><p>Nie masz jeszcze żadnych przedmiotów.</p><a class="btn btn-primary" href="#/skrzynki">Otwórz skrzynkę</a></div>`;
      return;
    }
    const shown = inv.slice(0, ui.upInvLimit);
    el.innerHTML = `<div class="card-grid small scroll-list">${shown.map(item => card(SKINS[item.skinId], {
      hit: { action: 'up-stake', id: item.uid, pressed: ui.stake.has(item.uid), label: `Dodaj do wkładu: ${itemName(item)}` },
      badges: stBadge(item),
      meta: itemMeta(item),
    })).join('')}</div>${inv.length > shown.length ? moreButton('up-inv-more', inv.length - shown.length) : ''}`;
  }

  function renderTargets() {
    const el = $('#up-targets');
    const stake = sumPrice(stakeItems());
    const query = ui.search.trim().toLowerCase();
    const list = TARGETS
      .filter(t => !query || t.search.includes(query))
      .filter(t => !stake || (t.price > stake && upgradeChance(stake, t) >= MIN_UPGRADE_CHANCE))
      .sort((a, b) => (ui.targetSort === 'desc' ? b.price - a.price : a.price - b.price));
    if (!list.length) {
      el.innerHTML = '<div class="empty-state"><p>Brak pasujących skinów.</p></div>';
      return;
    }
    const shown = list.slice(0, ui.targetLimit);
    el.innerHTML = `<div class="card-grid small scroll-list">${shown.map(t => card(t.skin, {
      hit: { action: 'up-target', id: t.key, pressed: !!ui.target && ui.target.key === t.key, label: `Wybierz cel: ${fullName(t.skin)} (${t.wear})` },
      badges: stake ? `<span class="chance chance-left">${pct(upgradeChance(stake, t))}</span>` : '',
      meta: `<span class="card-wear">${WEAR_BY_CODE[t.wear].name}</span><span class="card-price">${money(t.price)}</span>`,
    })).join('')}</div>${list.length > shown.length ? moreButton('up-targets-more', list.length - shown.length) : ''}`;
  }

  function toggleStake(uid, fromList) {
    if (ui.stake.has(uid)) {
      ui.stake.delete(uid);
    } else if (ui.stake.size >= MAX_STAKE_ITEMS) {
      toast(`Możesz postawić maksymalnie ${MAX_STAKE_ITEMS} przedmiotów.`, 'error');
      return;
    } else {
      ui.stake.add(uid);
    }
    ui.upResult = null;
    if (fromList) {
      setCardPressed(fromList, ui.stake.has(uid)); // keep keyboard focus on the clicked card
      renderStakeSlot();
      renderTargetSlot();
      renderWheel();
      renderTargets();
    } else {
      updateUpgrader();
    }
  }

  function selectTarget(key, button) {
    const target = TARGET_BY_KEY[key];
    if (!target) return;
    const previous = ui.target && $(`#up-targets .card[data-id="${ui.target.key}"] .card-hit`);
    if (previous) setCardPressed(previous, false);
    ui.target = ui.target && ui.target.key === key ? null : target;
    ui.upResult = null;
    if (ui.target) setCardPressed(button, true);
    renderTargetSlot();
    renderWheel();
  }

  function pickByMultiplier(mult) {
    const stake = sumPrice(stakeItems());
    if (!stake) {
      toast('Najpierw wybierz przedmioty do wkładu.', 'error');
      return;
    }
    const goal = stake * mult;
    const valid = TARGETS.filter(t => t.price > stake);
    if (!valid.length) return;
    // Pick randomly among targets within ±12% of the goal, otherwise the closest one.
    const near = valid.filter(t => Math.abs(t.price - goal) / goal <= 0.12);
    ui.target = near.length
      ? near[Math.floor(Math.random() * near.length)]
      : valid.reduce((a, b) => (Math.abs(b.price - goal) < Math.abs(a.price - goal) ? b : a));
    ui.upResult = null;
    updateUpgrader();
  }

  function wheelTicks(pointer, token) {
    let last = null;
    const loop = () => {
      if (token !== ui.spinToken || !ui.spinning || !pointer.isConnected) return;
      const m = new DOMMatrixReadOnly(getComputedStyle(pointer).transform);
      const angle = ((Math.atan2(m.b, m.a) * 180) / Math.PI + 360) % 360;
      const sector = Math.floor(angle / 18);
      if (last !== null && sector !== last) sfx.tick();
      last = sector;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  async function runUpgrade() {
    if (ui.spinning) return;
    const items = stakeItems();
    const stake = sumPrice(items);
    const target = ui.target;
    const chance = upgradeChance(stake, target);
    if (!items.length || chance < MIN_UPGRADE_CHANCE) return;

    // Decide and save the result first, then animate the pointer to match it.
    const roll = Math.random();
    const win = roll < chance;
    const stakeIds = new Set(items.map(it => it.uid));
    state.inventory = state.inventory.filter(it => !stakeIds.has(it.uid));
    stakeIds.forEach(id => ui.invSelected.delete(id));
    if (win) {
      const won = makeItem(target.skin, WEAR_BY_CODE[target.wear], false);
      state.inventory.unshift(won);
      recordDrop(won);
      state.stats.upgradesWon += 1;
    }
    state.stats.upgrades += 1;
    save();

    ui.spinning = true;
    const token = ++ui.spinToken;
    $('#upgrader-page').classList.add('is-locked');
    $('#up-spin').disabled = true;
    $('#wheel').classList.remove('win', 'lose');

    // The green arc starts at 12 o'clock, so the pointer lands inside it exactly when roll < chance.
    const duration = spinDuration(4.8, 1.6);
    const turns = state.settings.fast ? 3 : 6;
    ui.wheelRot = ui.wheelRot - (ui.wheelRot % 360) + 360 * turns + roll * 360;
    const pointer = $('#wheel-pointer');
    pointer.style.transition = `transform ${duration}s cubic-bezier(.12,.75,.12,1)`;
    pointer.style.transform = `rotate(${ui.wheelRot}deg)`;
    wheelTicks(pointer, token);
    await wait(duration * 1000 + 100);
    if (token !== ui.spinToken) return;

    ui.spinning = false;
    ui.stake.clear();
    ui.upResult = { win, roll, chance, stake };
    $('#upgrader-page').classList.remove('is-locked');
    renderInvCount();
    renderFeed(win ? 1 : 0);
    if (win) {
      sfx.win();
      toast(`Wygrana! ${fullName(target.skin)} (${target.wear}) jest w ekwipunku.`, 'success');
    } else {
      sfx.lose();
    }
    updateUpgrader();
  }

  // ---------- Small DOM helpers ----------
  function setCardPressed(button, pressed) {
    button.setAttribute('aria-pressed', String(pressed));
    button.closest('.card').classList.toggle('is-selected', pressed);
  }

  // ---------- Router ----------
  // The current page lives in `path` (e.g. "/skrzynka/kilowatt"). The URL hash is only a mirror of it,
  // so navigation also works where the hash can't be changed (e.g. an embedded preview).
  const pathFromHash = () => (/^#\//.test(location.hash) ? location.hash.slice(1) : '/skrzynki');
  let path = pathFromHash();

  function navigate(to) {
    path = to;
    try {
      history.pushState(null, '', `#${to}`);
    } catch (e) {
      // History not available here – the page still switches.
    }
    route();
    $('#app').focus({ preventScroll: true });
  }

  function stopSpin() {
    if (!ui.spinning) return;
    ui.spinning = false;
    ui.spinToken += 1;
    renderFeed();
    renderInvCount();
  }

  function route() {
    const [page = '', arg = ''] = path.replace(/^\//, '').split('/');
    stopSpin();
    let navKey = page;
    let title = '';
    if (page === 'skrzynka' && CASE_BY_ID[arg]) {
      ui.route = 'skrzynka';
      ui.caseId = arg;
      navKey = 'skrzynki';
      title = CASE_BY_ID[arg].name;
      renderCase(CASE_BY_ID[arg]);
    } else if (page === 'upgrader') {
      ui.route = 'upgrader';
      title = 'Upgrader';
      renderUpgrader();
    } else if (page === 'ekwipunek') {
      ui.route = 'ekwipunek';
      title = 'Ekwipunek';
      renderInventory();
    } else {
      ui.route = navKey = 'skrzynki';
      title = 'Skrzynki';
      renderCases();
    }
    $$('.nav a').forEach(a => {
      if (a.dataset.route === navKey) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.title = `${title} · CS2 Case Lab`;
    window.scrollTo(0, 0);
  }

  // ---------- Events ----------
  // Actions that still work while something is spinning.
  const FREE_ACTIONS = new Set(['open-funds', 'close-dialog', 'funds-preset', 'toggle-sound']);

  // In-page replacement for window.confirm()
  let confirmAction = null;
  function askConfirm({ title, text, ok }, onConfirm) {
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#confirm-ok').textContent = ok;
    confirmAction = onConfirm;
    $('#confirm-dialog').showModal();
  }

  const actions = {
    'open-funds': () => openFunds(),
    'close-dialog': el => el.closest('dialog').close(),
    'funds-preset': el => {
      $('#funds-amount').value = el.dataset.amount;
      $('#funds-error').textContent = '';
    },
    'toggle-sound': () => {
      state.settings.sound = !state.settings.sound;
      save();
      renderSoundButton();
    },
    'confirm-ok': () => {
      const run = confirmAction;
      confirmAction = null;
      $('#confirm-dialog').close();
      if (run) run();
    },

    'set-count': el => setCount(Number(el.dataset.count)),
    'open-case': () => openCase(CASE_BY_ID[ui.caseId]),
    'drop-sell': el => sellFromDrop(el.dataset.id),
    'drop-sell-all': () => {
      const owned = new Set(state.inventory.map(it => it.uid));
      const remaining = ui.lastDrops.filter(it => owned.has(it.uid)).map(it => it.uid);
      $('#drop-dialog').close();
      sellItems(remaining);
    },
    'drop-again': () => {
      $('#drop-dialog').close();
      if (ui.route === 'skrzynka') openCase(CASE_BY_ID[ui.caseId]);
    },

    'inv-toggle': el => {
      const uid = el.dataset.id;
      if (ui.invSelected.has(uid)) ui.invSelected.delete(uid);
      else ui.invSelected.add(uid);
      setCardPressed(el, ui.invSelected.has(uid));
      inventoryToolbarState();
    },
    'inv-select-all': () => {
      const all = ui.invSelected.size === state.inventory.length;
      ui.invSelected = all ? new Set() : new Set(state.inventory.map(it => it.uid));
      renderInventory();
    },
    'inv-sell-selected': () => {
      sellItems([...ui.invSelected]);
      renderInventory();
    },
    'inv-sell-all': () => {
      const count = state.inventory.length;
      askConfirm({
        title: 'Sprzedać cały ekwipunek?',
        text: `${count} ${itemsWord(count)} za ${money(sumPrice(state.inventory))}. Tego nie da się cofnąć.`,
        ok: 'Sprzedaj wszystko',
      }, () => {
        sellItems(state.inventory.map(it => it.uid));
        renderInventory();
      });
    },
    'inv-more': () => {
      ui.invLimit += PAGE_SIZE;
      renderInventory();
    },
    'sell-one': el => {
      sellItems([el.dataset.id]);
      renderInventory();
    },
    'to-upgrader': el => {
      const dialog = el.closest('dialog');
      if (dialog) dialog.close();
      ui.stake = new Set([el.dataset.id]);
      ui.upResult = null;
      if (ui.target && ui.target.price <= sumPrice(stakeItems())) ui.target = null;
      navigate('/upgrader');
    },

    'up-stake': el => toggleStake(el.dataset.id, el.classList.contains('card-hit') ? el : null),
    'up-target': el => selectTarget(el.dataset.id, el),
    'up-mult': el => pickByMultiplier(Number(el.dataset.mult)),
    'up-spin': () => runUpgrade(),
    'up-clear': () => {
      ui.stake.clear();
      ui.upResult = null;
      updateUpgrader();
    },
    'up-inv-more': () => {
      ui.upInvLimit += PAGE_SIZE;
      renderUpgradeInventory();
    },
    'up-targets-more': () => {
      ui.targetLimit += PAGE_SIZE;
      renderTargets();
    },

    'reset-all': () => askConfirm({
      title: 'Zresetować konto?',
      text: `Stracisz saldo, ekwipunek i statystyki. Zaczniesz od nowa z ${money(START_BALANCE)}.`,
      ok: 'Zresetuj konto',
    }, () => {
      state = defaultState();
      save();
      Object.assign(ui, { invSelected: new Set(), stake: new Set(), target: null, upResult: null, lastDrops: [] });
      renderBalance();
      renderInvCount();
      renderFeed();
      renderSoundButton();
      route();
      toast(`Konto zresetowane. Masz znowu ${money(START_BALANCE)}.`, 'success');
    }),
  };

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#/"]');
    if (link && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      navigate(link.getAttribute('href').slice(1));
      return;
    }
    const el = event.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const name = el.dataset.action;
    if (ui.spinning && !FREE_ACTIONS.has(name)) return;
    const handler = actions[name];
    if (handler) handler(el, event);
  });

  document.addEventListener('change', event => {
    const el = event.target;
    if (el.matches('.fast-toggle')) {
      state.settings.fast = el.checked;
      save();
    } else if (el.id === 'inv-sort') {
      ui.invSort = el.value;
      renderInventory();
    } else if (el.id === 'up-sort') {
      ui.targetSort = el.value;
      ui.targetLimit = PAGE_SIZE;
      renderTargets();
    }
  });

  document.addEventListener('input', event => {
    if (event.target.id === 'up-search') {
      ui.search = event.target.value;
      ui.targetLimit = PAGE_SIZE;
      renderTargets();
    }
  });

  $('#funds-form').addEventListener('submit', event => {
    event.preventDefault();
    const input = $('#funds-amount');
    const amount = round2(input.valueAsNumber);
    if (!isFinite(amount) || amount < 1 || amount > 1000000) {
      $('#funds-error').textContent = 'Wpisz kwotę od 1 do 1 000 000 zł.';
      input.focus();
      return;
    }
    $('#funds-dialog').close();
    addFunds(amount);
  });

  // Keep the reels centred when the window size changes.
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (ui.spinning) return;
      $$('.reel-track').forEach(track => placeTrack(track, Number(track.dataset.index), Number(track.dataset.frac)));
    }, 120);
  });

  // Back / forward buttons and hand-edited URLs
  window.addEventListener('popstate', () => {
    path = pathFromHash();
    route();
  });

  // ---------- Start ----------
  renderBalance();
  renderSoundButton();
  renderInvCount();
  renderFeed();
  route();
})();
