// tweaks.js — standalone in-app tuning panel + gear toggle (classic script).
//
// Exposes window.initTweaks({ defaults, onChange, onRestart }). A lightweight,
// dependency-free rewrite of the design tool's React "Tweaks" island — same
// controls and look, but loads as a plain <script> (no build, no framework).
(function () {
  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  const GEAR_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 ' +
    '1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 ' +
    '1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 ' +
    '1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>';

  function initTweaks({ defaults, onChange, onRestart }) {
    const t = { ...defaults };

    // ---- shell ----
    const fab = el('button', 'twk-fab');
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Open tweaks');
    fab.innerHTML = GEAR_SVG;

    const panel = el('div', 'twk-panel twk-hidden');
    const hd = el('div', 'twk-hd', '<b>Tweaks</b>');
    const closeBtn = el('button', 'twk-x', '✕');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close tweaks');
    hd.appendChild(closeBtn);
    const body = el('div', 'twk-body');
    panel.appendChild(hd);
    panel.appendChild(body);

    function open() { panel.classList.remove('twk-hidden'); fab.classList.add('twk-hidden'); }
    function close() { panel.classList.add('twk-hidden'); fab.classList.remove('twk-hidden'); }
    fab.addEventListener('click', open);
    closeBtn.addEventListener('click', close);

    function setTweak(key, val) {
      t[key] = val;
      if (onChange) onChange({ ...t });
    }

    // ---- control builders ----
    function section(label) { body.appendChild(el('div', 'twk-sect', label)); }

    function slider({ label, key, min, max, step, unit = '' }) {
      const row = el('div', 'twk-row');
      const lbl = el('div', 'twk-lbl');
      lbl.appendChild(el('span', null, label));
      const valEl = el('span', 'twk-val', `${t[key]}${unit}`);
      lbl.appendChild(valEl);
      const input = el('input', 'twk-slider');
      input.type = 'range';
      input.min = min; input.max = max; input.step = step; input.value = t[key];
      input.addEventListener('input', () => {
        const v = Number(input.value);
        valEl.textContent = `${v}${unit}`;
        setTweak(key, v);
      });
      row.appendChild(lbl);
      row.appendChild(input);
      body.appendChild(row);
    }

    function radio({ label, key, options }) {
      const row = el('div', 'twk-row');
      row.appendChild(el('div', 'twk-lbl', `<span>${label}</span>`));
      const seg = el('div', 'twk-seg');
      const n = options.length;
      const thumb = el('div', 'twk-seg-thumb');
      seg.appendChild(thumb);
      const place = () => {
        const idx = Math.max(0, options.indexOf(t[key]));
        thumb.style.left = `calc(2px + ${idx} * (100% - 4px) / ${n})`;
        thumb.style.width = `calc((100% - 4px) / ${n})`;
      };
      options.forEach((opt) => {
        const b = el('button', null, opt);
        b.type = 'button';
        b.addEventListener('click', () => { setTweak(key, opt); place(); });
        seg.appendChild(b);
      });
      row.appendChild(seg);
      body.appendChild(row);
      place();
    }

    function button(label, onClick) {
      const b = el('button', 'twk-btn', label);
      b.type = 'button';
      b.addEventListener('click', onClick);
      body.appendChild(b);
    }

    // ---- layout (mirrors the design prototype's panel exactly) ----
    section('World');
    radio({ label: 'Theme', key: 'theme', options: ['bloom', 'tide', 'glow'] });
    section('Threats');
    slider({ label: 'Spawn gap', key: 'spawnInterval', min: 0.8, max: 4, step: 0.1, unit: 's' });
    slider({ label: 'Grow time', key: 'growTime', min: 4, max: 16, step: 0.5, unit: 's' });
    section('Chaining');
    slider({ label: 'Start cap', key: 'chainStart', min: 2, max: 6, step: 1 });
    slider({ label: '+1 cap every', key: 'chainGrowthInterval', min: 8, max: 40, step: 1, unit: 's' });
    section('Dots');
    slider({ label: 'Activations', key: 'dotActivations', min: 1, max: 6, step: 1 });
    slider({ label: 'Start seeds', key: 'startSeeds', min: 0, max: 10, step: 1 });
    section('Feel');
    slider({ label: 'Juice', key: 'juice', min: 0, max: 1.4, step: 0.1, unit: '×' });
    button('Restart run with these settings', () => onRestart && onRestart());

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    return { open, close, get values() { return { ...t }; } };
  }

  window.initTweaks = initTweaks;
})();
