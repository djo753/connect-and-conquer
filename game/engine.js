// engine.js — Connect & Chain prototype game engine (vanilla canvas).
// Exposes window.GameEngine.create(opts) -> game instance.
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

  // distance from point P to segment AB
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / l2;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  // ---- power-up catalog --------------------------------------------------
  const POWERUPS = {
    blast:  { label: 'Blast',  blurb: 'Clears threats around the dot' },
    chain:  { label: 'Reach',  blurb: '+2 chain length this gesture' },
    freeze: { label: 'Freeze', blurb: 'Stops threat growth ~4s' },
    multi:  { label: 'Free',   blurb: 'Spends no activation' },
    healdot:{ label: 'Mend',   blurb: 'Refills your weakest dot' },
    life:   { label: 'Heart',  blurb: 'Restores one life' },
  };
  const POWERUP_KEYS = Object.keys(POWERUPS);

  function create(opts) {
    const canvas = opts.canvas;
    const ctx = canvas.getContext('2d');
    const hud = opts.hud || {};
    let theme = window.THEMES[opts.config.theme] || window.THEMES.bloom;

    const cfg = Object.assign({
      theme: 'bloom',
      gameDuration: 300,        // seconds to survive
      startLives: 5,
      startSeeds: 4,
      startDots: 4,
      dotActivations: 3,
      spawnInterval: 2.6,       // seconds between threat spawns (start)
      spawnFloor: 0.7,          // fastest spawn interval
      spawnSpeedup: 0.93,       // interval *= this each spawn
      growTime: 9,              // seconds small -> max
      shakeTime: 2,             // seconds shaking before explode
      rewardInterval: 18,       // seconds between reward threats
      powerupInterval: 22,      // seconds between free power-up grants
      chainStart: 2,
      chainGrowthInterval: 20,  // seconds
      chainGrowthAmount: 1,
      juice: 1,                 // 0..1.4 multiplier for fx
    }, opts.config);

    // layout
    let W = 0, H = 0, dpr = 1;
    let cols = 8, cell = 45, rows = 16;
    let topMargin = 92, botMargin = 116; // HUD reserved zones (css px)

    // state
    let dots = [], threats = [], parts = [], floats = [];
    let chain = [];                 // dot indices in order
    let chainBonus = 0;             // from chain power-ups in current gesture
    let pointer = { x: 0, y: 0, down: false };
    let carrying = null;            // {kind:'seed'} | {kind:'pu', type}
    let lives, seeds, powerups, maxChain, elapsed, sinceSpawn, spawnEvery,
        sinceReward, sincePowerup, sinceGrowth, freezeTimer, timeScale, targetScale,
        shakeMag, flashA, running, finished, won;

    let nextId = 1;

    function reset() {
      dots = []; threats = []; parts = []; floats = []; chain = []; chainBonus = 0;
      lives = cfg.startLives; seeds = cfg.startSeeds;
      powerups = ['blast', 'freeze', 'chain']; // a starter hand to show the system
      maxChain = cfg.chainStart;
      elapsed = 0; sinceSpawn = 0; spawnEvery = cfg.spawnInterval;
      sinceReward = 0; sincePowerup = 0; sinceGrowth = 0;
      freezeTimer = 0; timeScale = 1; targetScale = 1; shakeMag = 0; flashA = 0;
      finished = false; won = false; carrying = null;
      // seed a few starting dots so the core feel is immediate
      const used = new Set();
      for (let i = 0; i < cfg.startDots; i++) {
        let c, r, tries = 0;
        do { c = (Math.random() * cols) | 0; r = 2 + ((Math.random() * (rows - 4)) | 0); tries++; }
        while (used.has(c + ',' + r) && tries < 40);
        used.add(c + ',' + r);
        plantAt(cellCenter(c, r).x, cellCenter(c, r).y, true);
      }
      pushHud();
    }

    function resize() {
      W = canvas.offsetWidth || 390; H = canvas.offsetHeight || 760;
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      canvas.width = W * dpr; canvas.height = H * dpr;
      cell = W / cols;
      rows = Math.max(8, Math.floor((H - 0) / cell));
      topMargin = Math.max(78, H * 0.10);
      botMargin = Math.max(104, H * 0.135);
    }

    function cellCenter(c, r) { return { x: (c + 0.5) * cell, y: (r + 0.5) * cell }; }
    function nearestCell(x, y) {
      const c = clamp(Math.floor(x / cell), 0, cols - 1);
      const r = clamp(Math.floor(y / cell), 0, rows - 1);
      return { c, r };
    }

    function plantAt(x, y, silent) {
      const { c, r } = nearestCell(x, y);
      const cc = cellCenter(c, r);
      // avoid stacking on an existing dot
      for (const d of dots) if (d.c === c && d.r === r) return false;
      const d = { id: nextId++, c, r, x: cc.x, y: cc.y, act: cfg.dotActivations,
                  max: cfg.dotActivations, pu: null, phase: Math.random() * TAU, pop: 0 };
      dots.push(d);
      if (!silent) {
        burst(cc.x, cc.y, theme.plantParticles, 14, 2.4);
        d.pop = 1;
      } else { d.pop = 0.6; }
      return true;
    }

    // ---- power-ups ---------------------------------------------------------
    function grantPowerup(type) {
      const t = type || POWERUP_KEYS[(Math.random() * POWERUP_KEYS.length) | 0];
      powerups.push(t);
      if (hud.toast) hud.toast('Power-up! ' + POWERUPS[t].label, theme.reward);
      pushHud();
    }

    // ---- threats -----------------------------------------------------------
    function spawnThreat(reward) {
      const x = rand(cell * 0.7, W - cell * 0.7);
      const y = rand(topMargin + cell * 0.6, H - botMargin - cell * 0.4);
      threats.push({
        id: nextId++, x, y, age: 0, reward: !!reward,
        minR: cell * 0.16, maxR: cell * (reward ? 0.62 : 0.7),
        phase: Math.random() * TAU, dead: false, popping: 0,
      });
    }
    function threatRadius(t) {
      if (t.age < cfg.growTime) return lerp(t.minR, t.maxR, t.age / cfg.growTime);
      return t.maxR;
    }
    function threatPhaseName(t) {
      if (t.age < cfg.growTime) return 'grow';
      if (t.age < cfg.growTime + cfg.shakeTime) return 'shake';
      return 'pop';
    }

    // ---- particles / floats ------------------------------------------------
    function burst(x, y, colors, n, speed) {
      n = Math.round(n * (0.6 + cfg.juice * 0.6));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = rand(0.4, 1) * speed * 60;
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20,
          life: 1, max: rand(0.5, 1.1), r: rand(2.2, 5.5),
          col: colors[(Math.random() * colors.length) | 0], spin: rand(-6, 6), rot: 0 });
      }
    }
    function floatText(x, y, text, col, big) {
      floats.push({ x, y, text, col, life: 1, max: big ? 1.3 : 0.9, vy: -42, big: !!big });
    }

    // ---- input -------------------------------------------------------------
    function toLocal(e) {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
    }
    function dotAt(x, y, pad) {
      let best = -1, bd = (cell * (0.5 + (pad || 0))) ** 2;
      for (let i = 0; i < dots.length; i++) {
        const d = dist2(x, y, dots[i].x, dots[i].y);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }

    function onDown(e) {
      if (finished) return;
      const p = toLocal(e); pointer.x = p.x; pointer.y = p.y; pointer.down = true;
      if (carrying) return; // carrying handled on up
      const i = dotAt(p.x, p.y, 0.05);
      if (i >= 0) {
        chain = [i]; chainBonus = dots[i].pu === 'chain' ? 2 : 0;
        navigator.vibrate && navigator.vibrate(8);
      }
    }
    function onMove(e) {
      const p = toLocal(e); pointer.x = p.x; pointer.y = p.y;
      if (carrying) { positionGhost(e); return; }
      if (!chain.length || !pointer.down) return;
      const cap = maxChain + chainBonus;
      const i = dotAt(p.x, p.y, 0.0);
      if (i < 0) return;
      const last = chain[chain.length - 1];
      if (i === last) return;
      const existingPos = chain.indexOf(i);
      if (existingPos >= 0 && existingPos <= chain.length - 2) {
        // closed a loop back onto an earlier dot
        resolve(true, i);
        return;
      }
      if (existingPos === -1 && chain.length < cap) {
        chain.push(i);
        if (dots[i].pu === 'chain') chainBonus += 2;
        navigator.vibrate && navigator.vibrate(6);
        if (chain.length >= maxChain + chainBonus) resolve(false, null);
      }
    }
    function onUp(e) {
      pointer.down = false;
      if (carrying) { dropCarry(e); return; }
      if (chain.length >= 2) resolve(false, null);
      else chain = [];
    }

    // ---- resolve the chain -------------------------------------------------
    function resolve(isLoop, loopBackIndex) {
      const pts = chain.map(i => ({ x: dots[i].x, y: dots[i].y }));
      if (isLoop && loopBackIndex != null) {
        const lb = dots[loopBackIndex];
        pts.push({ x: lb.x, y: lb.y });
      }
      // collect kills along the polyline
      const killed = new Set();
      for (const t of threats) {
        if (t.dead) continue;
        const r = threatRadius(t) + 6;
        for (let s = 0; s < pts.length - 1; s++) {
          if (segDist(t.x, t.y, pts[s].x, pts[s].y, pts[s + 1].x, pts[s + 1].y) <= r) {
            killed.add(t); break;
          }
        }
      }
      // fire power-ups on chained dots
      let healLife = 0, mendCount = 0, blastHits = 0;
      for (const i of chain) {
        const d = dots[i];
        if (!d.pu) continue;
        if (d.pu === 'blast') {
          const R = cell * 2.0;
          for (const t of threats) if (!t.dead && dist2(t.x, t.y, d.x, d.y) <= R * R) { killed.add(t); blastHits++; }
          ring(d.x, d.y, R, theme.lineCore);
        } else if (d.pu === 'freeze') {
          freezeTimer = Math.max(freezeTimer, 4);
          flashA = Math.max(flashA, 0.3);
        } else if (d.pu === 'life') {
          healLife++;
        } else if (d.pu === 'healdot') {
          mendCount++;
        } else if (d.pu === 'multi') {
          d._free = true; // skip activation spend this resolve
        }
        d.pu = null;
      }
      if (healLife) { lives = clamp(lives + healLife, 0, 9); floatText(W / 2, H * 0.4, '+' + healLife + ' life', '#ff5a7a', true); }
      if (mendCount) {
        for (let m = 0; m < mendCount; m++) {
          let weak = null; for (const d of dots) if (!weak || d.act < weak.act) weak = d;
          if (weak) { weak.act = weak.max; weak.pop = 1; burst(weak.x, weak.y, theme.plantParticles, 10, 2); }
        }
      }

      // apply kills
      const n = killed.size;
      let gained = 0;
      killed.forEach(t => {
        t.dead = true; t.popping = 1;
        burst(t.x, t.y, theme.threatParticles, t.reward ? 22 : 14, t.reward ? 3 : 2.4);
        if (t.reward) { seeds++; gained++; floatText(t.x, t.y, '+1 seed', theme.reward, false); }
      });

      // spend activations (unique dots; multi spends none)
      for (const i of chain) {
        const d = dots[i];
        if (d._free) { d._free = false; continue; }
        d.act -= 1; d.usedFx = 0.0001;
      }
      // remove dead dots
      for (let k = dots.length - 1; k >= 0; k--) {
        if (dots[k].act <= 0) {
          burst(dots[k].x, dots[k].y, [theme.dotBody, theme.dotShine, '#ffffff'], 12, 2.2);
          floatText(dots[k].x, dots[k].y, 'spent', theme.hudInkSoft, false);
          dots.splice(k, 1);
        }
      }

      // feedback / juice
      const big = chain.length >= 4 || n >= 3;
      if (n > 0) {
        floatText(pts[pts.length - 1].x, pts[pts.length - 1].y - 10, '+' + n, theme.lineCore, big);
        if (n >= 2) floatText(W / 2, H * 0.46, comboWord(n) + ' ×' + n, theme.reward, big);
      }
      shakeMag = Math.min(22, shakeMag + (2 + n * 1.6 + (isLoop ? 4 : 0)) * cfg.juice);
      flashA = Math.max(flashA, Math.min(0.6, (0.06 + n * 0.05 + (big ? 0.18 : 0)) * cfg.juice));
      if (big) { targetScale = 0.34; slowTimer = 0.55; navigator.vibrate && navigator.vibrate([12, 30, 18]); }
      // line afterglow
      glowLine = { pts, life: 1 };

      chain = []; chainBonus = 0;
      pushHud();
    }
    let slowTimer = 0;
    let glowLine = null;

    function ring(x, y, r, col) { parts.push({ ring: true, x, y, r0: r * 0.3, r: r, col, life: 1, max: 0.5 }); }
    function comboWord(n) { return n >= 6 ? 'UNREAL' : n >= 5 ? 'MASSIVE' : n >= 4 ? 'HUGE' : n >= 3 ? 'NICE' : 'COMBO'; }

    // ---- carry (drag from trays) ------------------------------------------
    let ghostEl = opts.ghost;
    function startCarry(kind, type, e) {
      if (kind === 'seed' && seeds <= 0) return;
      if (kind === 'pu' && !powerups.includes(type)) return;
      carrying = { kind, type };
      if (ghostEl) {
        ghostEl.style.display = 'flex';
        ghostEl.textContent = kind === 'seed' ? seedGlyph() : puGlyph(type);
        ghostEl.style.background = kind === 'seed' ? theme.reward : theme.lineGlow;
      }
      positionGhost(e);
    }
    function positionGhost(e) {
      if (!ghostEl || !carrying) return;
      ghostEl.style.left = e.clientX + 'px';
      ghostEl.style.top = e.clientY + 'px';
    }
    function dropCarry(e) {
      const p = toLocal(e);
      const onField = p.x >= 0 && p.x <= W && p.y >= topMargin * 0.6 && p.y <= H - botMargin * 0.4;
      if (carrying.kind === 'seed') {
        if (onField && seeds > 0 && plantAt(p.x, p.y, false)) { seeds--; }
      } else if (carrying.kind === 'pu') {
        const i = dotAt(p.x, p.y, 0.05);
        if (i >= 0) {
          dots[i].pu = carrying.type; dots[i].pop = 1;
          const idx = powerups.indexOf(carrying.type);
          if (idx >= 0) powerups.splice(idx, 1);
          burst(dots[i].x, dots[i].y, [theme.lineCore, theme.reward], 10, 2);
        }
      }
      carrying = null;
      if (ghostEl) ghostEl.style.display = 'none';
      pushHud();
    }
    function seedGlyph() { return theme.key === 'tide' ? '◐' : theme.key === 'glow' ? '✦' : '✿'; }
    function puGlyph(t) { return ({ blast: '✸', chain: '↦', freeze: '❋', multi: '∞', healdot: '✚', life: '♥' })[t] || '◆'; }

    // ---- update ------------------------------------------------------------
    function update(dt) {
      if (finished) { stepParticles(dt); return; }
      // slow-mo handling (uses real dt for the timer)
      if (slowTimer > 0) { slowTimer -= dt; targetScale = 0.34; } else { targetScale = 1; }
      timeScale += (targetScale - timeScale) * Math.min(1, dt * 10);
      const sdt = dt * timeScale;

      elapsed += sdt;
      if (elapsed >= cfg.gameDuration) { endGame(true); }

      // chain growth
      sinceGrowth += sdt;
      if (sinceGrowth >= cfg.chainGrowthInterval) { sinceGrowth -= cfg.chainGrowthInterval; maxChain += cfg.chainGrowthAmount; floatText(W / 2, topMargin + 24, 'Chain +' + cfg.chainGrowthAmount + '!', theme.lineCore, true); }

      // spawns
      sinceSpawn += sdt;
      if (sinceSpawn >= spawnEvery) {
        sinceSpawn -= spawnEvery;
        spawnThreat(false);
        spawnEvery = Math.max(cfg.spawnFloor, spawnEvery * cfg.spawnSpeedup);
      }
      sinceReward += sdt;
      if (sinceReward >= cfg.rewardInterval) { sinceReward -= cfg.rewardInterval; spawnThreat(true); }
      sincePowerup += sdt;
      if (sincePowerup >= cfg.powerupInterval) { sincePowerup -= cfg.powerupInterval; grantPowerup(); }

      // freeze
      if (freezeTimer > 0) freezeTimer = Math.max(0, freezeTimer - dt);
      const grow = freezeTimer <= 0;

      // threats
      for (let k = threats.length - 1; k >= 0; k--) {
        const t = threats[k];
        if (t.dead) { t.popping -= dt * 3.5; if (t.popping <= 0) threats.splice(k, 1); continue; }
        if (grow) t.age += sdt;
        if (threatPhaseName(t) === 'pop') {
          // explode -> lose life
          t.dead = true; t.popping = 1;
          burst(t.x, t.y, theme.threatParticles, 26, 3.2);
          loseLife();
        }
      }

      // dots life pulse
      for (const d of dots) { if (d.pop > 0) d.pop = Math.max(0, d.pop - dt * 2.4); if (d.usedFx) d.usedFx = Math.min(1, d.usedFx + dt * 3); }

      stepParticles(dt);

      // shake & flash decay (real time)
      shakeMag *= Math.pow(0.001, dt);
      if (shakeMag < 0.2) shakeMag = 0;
      flashA *= Math.pow(0.002, dt);
      if (glowLine) { glowLine.life -= dt * 2.2; if (glowLine.life <= 0) glowLine = null; }

      pushHud();
    }
    function stepParticles(dt) {
      for (let k = parts.length - 1; k >= 0; k--) {
        const p = parts[k];
        p.life -= dt / p.max;
        if (p.life <= 0) { parts.splice(k, 1); continue; }
        if (p.ring) continue;
        p.vy += 380 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.spin * dt;
      }
      for (let k = floats.length - 1; k >= 0; k--) {
        const f = floats[k]; f.life -= dt / f.max; f.y += f.vy * dt; if (f.life <= 0) floats.splice(k, 1);
      }
    }

    function loseLife() {
      lives -= 1; shakeMag = Math.min(30, shakeMag + 16 * Math.max(0.6, cfg.juice));
      flashA = Math.max(flashA, 0.5); navigator.vibrate && navigator.vibrate(40);
      if (hud.damage) hud.damage();
      if (lives <= 0) endGame(false);
      pushHud();
    }
    function endGame(win) {
      if (finished) return;
      finished = true; won = win; running = false;
      if (hud.end) hud.end(win, { elapsed, lives, maxChain });
    }

    // ---- HUD snapshot ------------------------------------------------------
    let hudTick = 0;
    function pushHud() {
      if (!hud.update) return;
      const cap = maxChain + chainBonus;
      hud.update({
        timeLeft: Math.max(0, cfg.gameDuration - elapsed),
        lives, seeds, powerups: powerups.slice(),
        chainNow: chain.length, chainMax: cap, baseMax: maxChain,
        frozen: freezeTimer > 0,
      });
    }

    // ---- render ------------------------------------------------------------
    let starPts = null;
    function ensureStars() {
      if (!theme.starfield) { starPts = null; return; }
      starPts = [];
      for (let i = 0; i < 60; i++) starPts.push({ x: Math.random() * W, y: Math.random() * H, r: rand(0.6, 1.8), a: rand(0.2, 0.9), tw: rand(0.5, 2) });
    }

    function render(now) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // background gradient
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, theme.bgTop); g.addColorStop(1, theme.bgBot);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

      // shake transform
      let sx = 0, sy = 0;
      if (shakeMag > 0) { sx = rand(-shakeMag, shakeMag); sy = rand(-shakeMag, shakeMag); }
      ctx.save(); ctx.translate(sx, sy);

      // starfield (glow)
      if (starPts) {
        for (const s of starPts) {
          const a = s.a * (0.5 + 0.5 * Math.sin(now * 0.001 * s.tw + s.x));
          ctx.globalAlpha = a; ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // grid
      ctx.strokeStyle = theme.grid; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 1; c < cols; c++) { ctx.moveTo(c * cell, 0); ctx.lineTo(c * cell, H); }
      for (let r = 1; r < rows; r++) { ctx.moveTo(0, r * cell); ctx.lineTo(W, r * cell); }
      ctx.stroke();

      // threats
      for (const t of threats) drawThreat(ctx, t, now);

      // chain preview line (under dots' glow but above threats)
      drawChain(ctx, now);
      if (glowLine) drawGlowLine(ctx, glowLine);

      // dots
      for (const d of dots) drawDot(ctx, d, now);

      // particles
      drawParticles(ctx);

      // floats
      drawFloats(ctx);

      ctx.restore();

      // flash
      if (flashA > 0.01) { ctx.fillStyle = theme.flash; ctx.globalAlpha = clamp(flashA, 0, 1); ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }

      // freeze tint
      if (freezeTimer > 0) {
        ctx.fillStyle = 'rgba(150,220,255,0.10)'; ctx.fillRect(0, 0, W, H);
      }
    }

    function drawChain(ctx, now) {
      if (chain.length === 0) return;
      const pts = chain.map(i => ({ x: dots[i].x, y: dots[i].y }));
      if (pointer.down) pts.push({ x: pointer.x, y: pointer.y });
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      // glow
      ctx.strokeStyle = theme.lineGlow; ctx.globalAlpha = 0.55; ctx.lineWidth = 14;
      ctx.shadowColor = theme.lineGlow; ctx.shadowBlur = 18 * cfg.juice;
      strokePts(ctx, pts);
      // core
      ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.strokeStyle = theme.lineCore; ctx.lineWidth = 5;
      ctx.setLineDash([2, 10]); ctx.lineDashOffset = -now * 0.04; strokePts(ctx, pts); ctx.setLineDash([]);
      // node rings
      for (const i of chain) { const d = dots[i]; ctx.strokeStyle = theme.lineCore; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(d.x, d.y, cell * 0.46, 0, TAU); ctx.stroke(); }
    }
    function strokePts(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke(); }
    function drawGlowLine(ctx, gl) {
      ctx.save(); ctx.globalAlpha = clamp(gl.life, 0, 1) * 0.8; ctx.strokeStyle = theme.lineCore;
      ctx.lineWidth = 6 + (1 - gl.life) * 26; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.shadowColor = theme.lineGlow; ctx.shadowBlur = 24 * cfg.juice; strokePts(ctx, gl.pts); ctx.restore();
    }

    function blobPath(ctx, x, y, r, wob, ph) {
      const N = 18; ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * TAU;
        const rr = r * (1 + Math.sin(a * 3 + ph) * wob);
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
    }

    function drawThreat(ctx, t, now) {
      let r = threatRadius(t);
      const phase = threatPhaseName(t);
      let jx = 0, jy = 0, danger = 0;
      if (t.popping > 0) { // dying pop
        const k = 1 - t.popping; r = r * (1 + k * 0.8); ctx.globalAlpha = clamp(t.popping, 0, 1);
      }
      if (phase === 'shake') { danger = 1; const s = (t.age - cfg.growTime); jx = Math.sin(now * 0.05) * (2 + s); jy = Math.cos(now * 0.043) * (2 + s); }
      const breathe = phase === 'grow' ? 1 + Math.sin(now * 0.004 + t.phase) * 0.04 : 1;
      const x = t.x + jx, y = t.y + jy, rr = r * breathe;

      ctx.save();
      // soft outer glow when dangerous
      if (danger) { ctx.shadowColor = t.reward ? theme.reward : theme.threatBody; ctx.shadowBlur = 22; }
      // body
      const grad = ctx.createRadialGradient(x - rr * 0.3, y - rr * 0.35, rr * 0.1, x, y, rr);
      if (t.reward) { grad.addColorStop(0, '#fff2b0'); grad.addColorStop(1, theme.reward); }
      else { grad.addColorStop(0, mix(theme.threatBody, '#ffffff', 0.25)); grad.addColorStop(1, danger ? theme.threatBodyDark : theme.threatBody); }
      ctx.fillStyle = grad;
      blobPath(ctx, x, y, rr, t.reward ? 0.05 : 0.07, now * 0.003 + t.phase); ctx.fill();
      ctx.shadowBlur = 0;

      if (t.reward) {
        // sparkle ring + happy face
        ctx.strokeStyle = theme.rewardDark; ctx.lineWidth = Math.max(1.5, rr * 0.08);
        for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + now * 0.001; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * rr * 1.05, y + Math.sin(a) * rr * 1.05); ctx.lineTo(x + Math.cos(a) * rr * 1.32, y + Math.sin(a) * rr * 1.32); ctx.stroke(); }
        face(ctx, x, y, rr, theme.rewardCore, true);
      } else {
        face(ctx, x, y, rr, theme.threatEye, false);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    function face(ctx, x, y, r, eyeCol, happy) {
      const e = r * 0.26, ey = y - r * 0.08, ex = r * 0.34;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x - ex, ey, e, 0, TAU); ctx.arc(x + ex, ey, e, 0, TAU); ctx.fill();
      ctx.fillStyle = eyeCol;
      ctx.beginPath(); ctx.arc(x - ex, ey + e * 0.1, e * 0.55, 0, TAU); ctx.arc(x + ex, ey + e * 0.1, e * 0.55, 0, TAU); ctx.fill();
      ctx.strokeStyle = eyeCol; ctx.lineWidth = Math.max(1.5, r * 0.09); ctx.lineCap = 'round';
      ctx.beginPath();
      if (happy) ctx.arc(x, y + r * 0.18, r * 0.34, 0.15 * Math.PI, 0.85 * Math.PI);
      else ctx.arc(x, y + r * 0.62, r * 0.34, 1.15 * Math.PI, 1.85 * Math.PI); // frown
      ctx.stroke();
    }

    function drawDot(ctx, d, now) {
      const bob = Math.sin(now * 0.003 + d.phase) * cell * 0.03;
      const x = d.x, y = d.y + bob;
      const base = cell * 0.34;
      const pop = 1 + d.pop * 0.25;
      const r = base * pop;
      ctx.save();
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath(); ctx.ellipse(d.x, d.y + base * 0.95, base * 0.8, base * 0.34, 0, 0, TAU); ctx.fill();

      if (theme.dotStyle === 'star') {
        ctx.shadowColor = theme.leaf; ctx.shadowBlur = 16; // cyan halo
        starShape(ctx, x, y, r * 1.18, r * 0.5, 5, -Math.PI / 2);
        const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r * 1.2);
        g.addColorStop(0, theme.dotShine); g.addColorStop(1, theme.dotBody); ctx.fillStyle = g; ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        if (theme.dotStyle === 'sprout') {
          ctx.fillStyle = theme.leaf;
          leaf(ctx, x - r * 0.2, y - r * 0.9, r * 0.55, -0.5);
          leaf(ctx, x + r * 0.2, y - r * 0.9, r * 0.55, 0.5);
        }
        const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
        g.addColorStop(0, theme.dotShine); g.addColorStop(1, theme.dotBody);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        if (theme.dotStyle === 'pearl') { ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(x - r * 0.32, y - r * 0.34, r * 0.22, 0, TAU); ctx.fill(); }
      }
      // face
      const eyeC = theme.dotEye;
      const e = r * 0.18, ex = r * 0.3, ey = y - r * 0.02;
      ctx.fillStyle = eyeC;
      ctx.beginPath(); ctx.arc(x - ex, ey, e, 0, TAU); ctx.arc(x + ex, ey, e, 0, TAU); ctx.fill();
      ctx.strokeStyle = eyeC; ctx.lineWidth = Math.max(1.6, r * 0.12); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x, y + r * 0.18, r * 0.3, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();

      // activation pips (above)
      const py = y - r - (theme.dotStyle === 'sprout' ? r * 0.9 : r * 0.55);
      const total = d.max, gap = r * 0.42;
      const startX = x - gap * (total - 1) / 2;
      for (let i = 0; i < total; i++) {
        ctx.beginPath(); ctx.arc(startX + i * gap, py, r * 0.15, 0, TAU);
        ctx.fillStyle = i < d.act ? theme.pip : theme.pipEmpty; ctx.fill();
      }

      // power-up badge
      if (d.pu) {
        const bx = x + r * 0.75, by = y - r * 0.75, br = r * 0.5;
        ctx.fillStyle = theme.lineGlow; ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '700 ' + (br * 1.3) + 'px Fredoka, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(puGlyph(d.pu), bx, by + 1);
      }
      ctx.restore();
    }

    function leaf(ctx, x, y, s, rot) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(s * 0.9, -s * 0.6, 0, -s * 1.4);
      ctx.quadraticCurveTo(-s * 0.7, -s * 0.6, 0, 0); ctx.fill(); ctx.restore();
    }
    function starShape(ctx, cx, cy, outer, inner, points, rot) {
      ctx.beginPath();
      for (let i = 0; i < points * 2; i++) {
        const r = i % 2 ? inner : outer; const a = rot + i * Math.PI / points;
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
    }

    function drawParticles(ctx) {
      for (const p of parts) {
        if (p.ring) {
          ctx.globalAlpha = clamp(p.life, 0, 1) * 0.6; ctx.strokeStyle = p.col; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(p.x, p.y, lerp(p.r0, p.r, 1 - p.life), 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; continue;
        }
        ctx.save(); ctx.globalAlpha = clamp(p.life, 0, 1); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.col; ctx.beginPath();
        ctx.ellipse(0, 0, p.r, p.r * 0.7, 0, 0, TAU); ctx.fill(); ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    function drawFloats(ctx) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const f of floats) {
        ctx.globalAlpha = clamp(f.life, 0, 1);
        const sz = f.big ? 30 : 19;
        ctx.font = '700 ' + sz + 'px Fredoka, sans-serif';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.strokeText(f.text, f.x, f.y);
        ctx.fillStyle = f.col; ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;
    }

    // color mix helper
    function mix(a, b, t) {
      const pa = hex(a), pb = hex(b);
      return 'rgb(' + Math.round(lerp(pa[0], pb[0], t)) + ',' + Math.round(lerp(pa[1], pb[1], t)) + ',' + Math.round(lerp(pa[2], pb[2], t)) + ')';
    }
    function hex(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }

    // ---- loop --------------------------------------------------------------
    let last = 0, raf = 0;
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000 || 0); last = now;
      if (running) update(dt); else stepParticles(dt);
      render(now);
      raf = requestAnimationFrame(frame);
    }

    // ---- public API --------------------------------------------------------
    function start() { resize(); ensureStars(); reset(); running = true; finished = false; }
    function applyConfig(partial) {
      Object.assign(cfg, partial);
      if (partial.theme && window.THEMES[partial.theme]) { theme = window.THEMES[partial.theme]; ensureStars(); }
    }
    function setTheme(k) { if (window.THEMES[k]) { theme = window.THEMES[k]; cfg.theme = k; ensureStars(); } }

    // bind input
    canvas.addEventListener('pointerdown', e => { e.preventDefault(); canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); onDown(e); });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('resize', () => { resize(); ensureStars(); });

    const api = { start, applyConfig, setTheme, startCarry, reset: () => { reset(); running = true; finished = false; },
      _frame: () => raf, getCfg: () => cfg, getTheme: () => theme, POWERUPS, puGlyph, seedGlyph,
      _dots: () => dots, _threats: () => threats, _render: (t) => render(t || performance.now()), _state: () => ({ lives, seeds, powerups: powerups.slice(), maxChain, elapsed, finished }) };
    raf = requestAnimationFrame(frame);
    return api;
  }

  window.GameEngine = { create, POWERUPS };
})();
