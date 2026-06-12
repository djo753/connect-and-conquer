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

  // ---- HUD helpers ----
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
      // level + chain + xp bar
      $('#level').textContent = s.level;
      $('#chain').innerHTML = s.chainNow + '/' + s.chainMax;
      const maxed = s.maxLevel && s.level >= s.maxLevel;
      const pct = maxed ? 100 : (s.xpNext ? Math.min(100, (s.xp / s.xpNext) * 100) : 0);
      $('#xpFill').style.width = pct + '%';
      $('#xpFill').classList.toggle('maxed', !!maxed);
      // lives
      if (s.lives !== lastLives) {
        lastLives = s.lives;
        let h = '';
        const max = Math.max(5, s.lives);
        for (let i = 0; i < max; i++) h += heartSVG(i < s.lives);
        $('#lives').innerHTML = h;
      }
      // tray (only when changed)
      const sig = s.seeds + '|' + s.sunSeeds;
      if (sig !== lastTraySig) {
        lastTraySig = sig;
        $('#seedCt').textContent = s.seeds;
        $('#sunCt').textContent = s.sunSeeds;
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
    spawnInterval: 2.6,
    growTime: 9,
    specialInterval: 16,
    batteryShare: 0.35,
    sunSeedChance: 0.25,
    specialSpawnChance: 0.02,
    eelEveryThreats: 15,
    spiderEveryThreats: 18,
    chainStart: 2,
    xpBase: 100,
    xpGrowth: 3,
    maxLevel: 5,
    xpPerEnemy: 10,
    xpComboBonusMax: 10,
    dotActivations: 4,
    sunActivations: 5,
    startSeeds: 4,
    juice: 1,
  };
  const CONFIG = {
    theme: 'glow',
    gameDuration: 300,
    startLives: 5,
    startDots: 2,
    startSunSeeds: 1,
    ...TWEAK_DEFAULTS,
  };

  // ---- create engine ----
  const game = createGame({ canvas, hud, ghost, config: CONFIG });
  window.__game = game; // handy for console debugging

  function refreshChipGlyphs() {
    $('#seedGlyph').textContent = game.seedGlyph();
    $('#sunGlyph').textContent = game.sunGlyph();
  }

  // ---- tray drag ----
  function trayDown(e) {
    const chip = e.target.closest('[data-carry]');
    if (!chip) return;
    e.preventDefault();
    if (chip.dataset.carry === 'seed') game.startCarry('seed', chip.dataset.seedkind || 'normal', e);
  }
  $('#seedChip').addEventListener('pointerdown', trayDown);
  $('#sunChip').addEventListener('pointerdown', trayDown);

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
      juice: t.juice, spawnInterval: t.spawnInterval, growTime: t.growTime,
      specialInterval: t.specialInterval, batteryShare: t.batteryShare, sunSeedChance: t.sunSeedChance,
      specialSpawnChance: t.specialSpawnChance, eelEveryThreats: t.eelEveryThreats,
      spiderEveryThreats: t.spiderEveryThreats,
      chainStart: t.chainStart, xpBase: t.xpBase, xpGrowth: t.xpGrowth, maxLevel: t.maxLevel,
      xpPerEnemy: t.xpPerEnemy, xpComboBonusMax: t.xpComboBonusMax,
      dotActivations: t.dotActivations, sunActivations: t.sunActivations, startSeeds: t.startSeeds,
    };
    Object.keys(map).forEach((k) => { if (map[k] === undefined) delete map[k]; });
    game.applyConfig(map);
    lastTraySig = ''; lastLives = -1; // force HUD refresh on next tick
  }

  // initial paint + panel
  chrome('glow');
  refreshChipGlyphs();
  window.initTweaks({ defaults: TWEAK_DEFAULTS, onChange: applyTweaks, onRestart: restart });
})();
