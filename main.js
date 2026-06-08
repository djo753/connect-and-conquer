// main.js — shell glue (classic script): DOM HUD, tray drag, theme chrome,
// overlay buttons, and the bridge between the in-app Tweaks panel and the
// vanilla canvas engine. The game fills the whole viewport (no phone frame).
// Reads window.THEMES / window.GameEngine / window.initTweaks.
(function () {
  const $ = (s) => document.querySelector(s);
  const screenEl = $('#screen');
  const canvas = $('#board');
  const ghost = $('#ghost');

  const THEMES = window.THEMES;
  const createGame = window.GameEngine.create;
  const POWERUPS = window.GameEngine.POWERUPS;

  // ---- HUD helpers ----
  const PU_COLORS = {
    blast: '#ff7a3c', chain: '#3fae57', freeze: '#39b6e6',
    multi: '#b06bff', healdot: '#46c46a', life: '#ff5a7a',
  };
  function heartSVG(filled) {
    return '<svg class="heart" viewBox="0 0 24 24">' +
      '<path d="M12 21C5 16 3 11 3 7.5 3 4.5 5.4 3 7.6 3 9.4 3 11 4 12 5.6 13 4 14.6 3 16.4 3 18.6 3 21 4.5 21 7.5 21 11 19 16 12 21Z" ' +
      'fill="' + (filled ? '#ff5067' : 'none') + '" stroke="#ff5067" stroke-width="2"/></svg>';
  }

  let lastLives = -1, lastTraySig = '';
  const hud = {
    update(s) {
      // time
      const m = Math.floor(s.timeLeft / 60), sec = Math.floor(s.timeLeft % 60);
      $('#time').textContent = m + ':' + String(sec).padStart(2, '0');
      // chain
      $('#chain').innerHTML = s.chainNow + '/' + s.chainMax + (s.frozen ? ' <span class="frozen">❋</span>' : '');
      // lives
      if (s.lives !== lastLives) {
        lastLives = s.lives;
        let h = '';
        const max = Math.max(5, s.lives);
        for (let i = 0; i < max; i++) h += heartSVG(i < s.lives);
        $('#lives').innerHTML = h;
      }
      // tray (only when changed)
      const sig = s.seeds + '|' + s.powerups.join(',');
      if (sig !== lastTraySig) {
        lastTraySig = sig;
        $('#seedCt').textContent = s.seeds;
        const row = $('#puRow');
        if (!s.powerups.length) {
          row.innerHTML = '<span class="pu-empty">— earning more —</span>';
        } else {
          row.innerHTML = s.powerups.map((type, i) => {
            const meta = POWERUPS[type];
            return '<div class="pu-chip" data-carry="pu" data-type="' + type + '" data-idx="' + i + '" style="background:' + PU_COLORS[type] + '">' +
              '<span class="g">' + game.puGlyph(type) + '</span><span class="n">' + meta.label + '</span></div>';
          }).join('');
        }
      }
    },
    toast(msg, col) {
      const elx = $('#toast');
      elx.textContent = msg;
      elx.style.background = col || '#333';
      elx.classList.add('show');
      clearTimeout(elx._t);
      elx._t = setTimeout(() => elx.classList.remove('show'), 1300);
    },
    damage() {
      screenEl.animate(
        [{ filter: 'brightness(1)' }, { filter: 'brightness(1.6) saturate(.4)' }, { filter: 'brightness(1)' }],
        { duration: 240 }
      );
    },
    end(win, stats) {
      const m = Math.floor(stats.elapsed / 60), sec = Math.floor(stats.elapsed % 60);
      $('#stTime').textContent = m + ':' + String(sec).padStart(2, '0');
      $('#stChain').textContent = stats.maxChain;
      $('#endMark').textContent = win ? '🏆' : '💥';
      $('#endTitle').textContent = win ? 'You held it!' : 'Overwhelmed!';
      $('#endSub').textContent = win
        ? 'You kept the board alive for the full run.'
        : 'Too many threats burst. Plant earlier, chain bigger.';
      $('#endOv').classList.remove('hide');
    },
  };

  // ---- config (single source of truth) ----
  // TWEAK_DEFAULTS feeds both the engine config and the Tweaks panel so the two
  // can't drift on load. Matches the prototype's hero baseline (Bloom, cap 2).
  const TWEAK_DEFAULTS = {
    theme: 'bloom',
    spawnInterval: 2.6,
    growTime: 9,
    rewardInterval: 18,
    batteryInterval: 26,
    specialSpawnChance: 0.02,
    chainStart: 2,
    chainGrowthInterval: 20,
    dotActivations: 4,
    startSeeds: 4,
    juice: 1,
  };
  const CONFIG = {
    gameDuration: 300,
    startLives: 5,
    startDots: 4,
    powerupInterval: 22,
    chainGrowthAmount: 1,
    ...TWEAK_DEFAULTS,
  };

  // ---- create engine ----
  const game = createGame({ canvas, hud, ghost, config: CONFIG });
  window.__game = game; // handy for console debugging

  function refreshChipGlyphs() { $('#seedGlyph').textContent = game.seedGlyph(); }

  // ---- tray drag ----
  function trayDown(e) {
    const chip = e.target.closest('[data-carry]');
    if (!chip) return;
    e.preventDefault();
    if (chip.dataset.carry === 'seed') game.startCarry('seed', null, e);
    else game.startCarry('pu', chip.dataset.type, e);
  }
  $('#seedChip').addEventListener('pointerdown', trayDown);
  $('#puRow').addEventListener('pointerdown', trayDown);

  // ---- chrome theming (recolors the DOM HUD to match the canvas theme) ----
  function chrome(key) {
    const th = THEMES[key];
    const root = document.documentElement.style;
    root.setProperty('--hud-ink', th.hudInk);
    root.setProperty('--hud-soft', th.hudInkSoft);
    root.setProperty('--panel-bg', th.panelBg);
    root.setProperty('--panel-bd', th.panelBorder);
    root.setProperty('--accent', th.dotBody);
    root.setProperty('--reward', th.reward);
    screenEl.style.background = th.bgTop;
    $('#seedChip').style.background = th.reward;
    refreshChipGlyphs();
  }

  // ---- overlay buttons ----
  function begin() { $('#startOv').classList.add('hide'); game.start(); refreshChipGlyphs(); }
  function restart() {
    $('#endOv').classList.add('hide');
    $('#startOv').classList.add('hide');
    game.start();
    refreshChipGlyphs();
  }
  $('#playBtn').addEventListener('click', begin);
  $('#againBtn').addEventListener('click', () => { $('#endOv').classList.add('hide'); game.reset(); });

  // ---- tweaks bridge ----
  function applyTweaks(t) {
    const map = {
      theme: t.theme, juice: t.juice, spawnInterval: t.spawnInterval, growTime: t.growTime,
      rewardInterval: t.rewardInterval, batteryInterval: t.batteryInterval,
      specialSpawnChance: t.specialSpawnChance,
      chainGrowthInterval: t.chainGrowthInterval, chainStart: t.chainStart,
      dotActivations: t.dotActivations, startSeeds: t.startSeeds,
    };
    Object.keys(map).forEach((k) => { if (map[k] === undefined) delete map[k]; });
    const prevTheme = game.getCfg().theme;
    game.applyConfig(map);
    if (t.theme && t.theme !== prevTheme) chrome(t.theme);
    lastTraySig = ''; lastLives = -1; // force HUD refresh on next tick
  }

  // initial paint + panel
  chrome(TWEAK_DEFAULTS.theme);
  refreshChipGlyphs();
  window.initTweaks({ defaults: TWEAK_DEFAULTS, onChange: applyTweaks, onRestart: restart });
})();
