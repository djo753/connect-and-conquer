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

  function create(opts) {
    const canvas = opts.canvas;
    const ctx = canvas.getContext('2d');
    const hud = opts.hud || {};
    let theme = window.THEMES[opts.config.theme] || window.THEMES.glow;

    const cfg = Object.assign({
      theme: 'glow',
      gameDuration: 300,        // seconds to survive
      startLives: 5,
      startSeeds: 4,
      startSunSeeds: 1,         // blue-sun seeds you start with
      startDots: 2,
      dotActivations: 4,        // charges on a normal star
      sunActivations: 5,        // charges on a blue sun
      sunSeedChance: 0.25,      // fraction of buddy drops that are blue suns
      sunBlastMaxRadiusFrac: 0.1, // sun's circle radius at max links, as fraction of screen width
      spawnInterval: 2.6,       // seconds between threat spawns (start)
      spawnFloor: 0.7,          // fastest spawn interval
      spawnSpeedup: 0.93,       // interval *= this each spawn
      growTime: 9,              // seconds small -> max
      shakeTime: 2,             // seconds shaking before explode
      specialInterval: 16,      // seconds between special threats (buddy drops + batteries)
      batteryShare: 0.35,       // fraction of special threats that are batteries (rest are buddy drops)
      eelEveryThreats: 15,      // spawn a star eel every Nth normal threat
      eelSpeed: 3,              // eel rush speed in cells/second
      spiderEveryThreats: 18,   // spawn a web spider every Nth normal threat
      spiderSpeed: 3,           // spider rush speed in cells/second
      spiderPullSpeed: 1.2,     // speed the spider drags a webbed star to the edge (cells/sec)
      shotRange: 4,             // directional shot range in cells (1-star = no shot, 2+ = cone)
      threatHitPad: 14,         // extra px added to threat radius for line hit detection
      shotBlastRadius: 1.1,     // cells: small AoE circle around the firing star
      specialSpawnChance: 0.02, // base chance to spawn a special threat behind a kill
      coneChargeRate: 0.35,     // cone range growth per second while holding the shot
      coneChargeMax: 1.2,       // max bonus range multiplier from charging
      coneChargeAngleRate: 0.25,// cone half-angle growth per second while holding
      coneChargeAngleMax: 0.8,  // max bonus angle multiplier from charging
      chainStart: 2,
      xpBase: 100,              // xp needed to reach level 2
      xpGrowth: 3,              // each level needs this multiple of the previous level's xp
      maxLevel: 5,              // level cap (each level grants +1 max chain)
      xpPerEnemy: 10,           // base xp per enemy destroyed
      xpComboBonusMax: 10,      // max bonus xp per enemy from combo size
      juice: 1,                 // 0..1.4 multiplier for fx
    }, opts.config);

    // layout
    let W = 0, H = 0, dpr = 1;
    let cols = 8, cell = 45, rows = 16;
    let topMargin = 92, botMargin = 116; // HUD reserved zones (css px)

    // state
    let dots = [], threats = [], eels = [], spiders = [], parts = [], floats = [];
    let chain = [];                 // dot indices in order
    let pointer = { x: 0, y: 0, down: false };
    let carrying = null;            // {kind:'seed', type:'normal'|'sun'}
    let lives, seeds, sunSeeds, maxChain, elapsed, sinceSpawn, spawnEvery, threatSpawnCount,
        sinceSpecial, holdCharge, xp, level, timeScale, targetScale,
        shakeMag, flashA, running, finished, won;

    let nextId = 1;
    let lastTap = { t: 0, x: 0, y: 0 };

    function reset() {
      dots = []; threats = []; eels = []; spiders = []; parts = []; floats = []; chain = [];
      lives = cfg.startLives; seeds = cfg.startSeeds; sunSeeds = cfg.startSunSeeds;
      level = 1; xp = 0;
      maxChain = cfg.chainStart;
      elapsed = 0; sinceSpawn = 0; spawnEvery = cfg.spawnInterval; threatSpawnCount = 0;
      sinceSpecial = 0; holdCharge = 0;
      timeScale = 1; targetScale = 1; shakeMag = 0; flashA = 0;
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

    function plantAt(x, y, silent, kind) {
      const { c, r } = nearestCell(x, y);
      const cc = cellCenter(c, r);
      // avoid stacking on an existing dot
      for (const d of dots) if (d.c === c && d.r === r) return false;
      const isSun = kind === 'sun';
      const acts = isSun ? cfg.sunActivations : cfg.dotActivations;
      const d = { id: nextId++, c, r, x: cc.x, y: cc.y, kind: isSun ? 'sun' : 'normal',
                  act: acts, max: acts, entangled: false, webbed: false, phase: Math.random() * TAU, pop: 0 };
      dots.push(d);
      if (!silent) {
        burst(cc.x, cc.y, isSun ? ['#4ea8ff', '#bfe4ff', '#ffffff'] : theme.plantParticles, 14, 2.4);
        d.pop = 1;
      } else { d.pop = 0.6; }
      return true;
    }

    // ---- threats -----------------------------------------------------------
    // kind: 'normal' | 'reward' (buddy seed) | 'battery' (recharge). atX/atY optional placement.
    // sun: for reward threats, true => grants a blue-sun seed instead of a normal one.
    function spawnThreat(kind, atX, atY, sun) {
      kind = kind || 'normal';
      const special = kind !== 'normal';
      const x = atX != null ? atX : rand(cell * 0.7, W - cell * 0.7);
      const y = atY != null ? atY : rand(topMargin + cell * 0.6, H - botMargin - cell * 0.4);
      threats.push({
        id: nextId++, x, y, age: 0, kind,
        reward: kind === 'reward', battery: kind === 'battery',
        seedKind: kind === 'reward' ? (sun ? 'sun' : 'normal') : null,
        minR: cell * 0.16, maxR: cell * (special ? 0.62 : 0.7),
        phase: Math.random() * TAU, dead: false, popping: 0,
      });
    }
    // spawn one special threat: a battery (batteryShare) or a buddy drop (rest).
    // Buddy drops are a blue-sun seed with probability sunSeedChance, else a normal seed.
    function spawnSpecial(atX, atY) {
      if (Math.random() < cfg.batteryShare) { spawnThreat('battery', atX, atY); }
      else { spawnThreat('reward', atX, atY, Math.random() < cfg.sunSeedChance); }
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

    // ---- star eels ---------------------------------------------------------
    function pickTargetStar() {
      const free = dots.filter(d => !d.entangled && !d.webbed);
      const pool = free.length ? free : dots;
      if (!pool.length) return null;
      return pool[(Math.random() * pool.length) | 0];
    }
    function spawnEel() {
      const target = pickTargetStar();
      if (!target) return; // nothing to grab
      const m = cell * 0.6;
      const corners = [
        { x: m, y: topMargin + m }, { x: W - m, y: topMargin + m },
        { x: m, y: H - botMargin - m }, { x: W - m, y: H - botMargin - m },
      ];
      const c = corners[(Math.random() * corners.length) | 0];
      eels.push({
        id: nextId++, x: c.x, y: c.y, targetId: target.id, state: 'rush',
        speed: cfg.eelSpeed * cell, angle: Math.atan2(target.y - c.y, target.x - c.x),
        phase: Math.random() * TAU, dead: false, popping: 0,
      });
      if (hud.toast) hud.toast('A star eel appears!', theme.threatBody);
    }
    function updateEels(sdt) {
      for (let k = eels.length - 1; k >= 0; k--) {
        const e = eels[k];
        if (e.dead) { e.popping -= sdt * 3; if (e.popping <= 0) eels.splice(k, 1); continue; }
        let target = dots.find(d => d.id === e.targetId);
        if (!target) {
          const nt = pickTargetStar();
          if (!nt) { e.dead = true; e.popping = 1; continue; }
          e.targetId = nt.id; target = nt; e.state = 'rush';
        }
        if (e.state === 'rush') {
          const ddx = target.x - e.x, ddy = target.y - e.y, dd = Math.hypot(ddx, ddy) || 1;
          e.angle = Math.atan2(ddy, ddx);
          const step = e.speed * sdt;
          if (dd <= step + cell * 0.3) {
            e.x = target.x; e.y = target.y; e.state = 'entangle'; target.entangled = true;
            floatText(target.x, target.y - cell * 0.6, 'Entangled!', theme.threatBody, false);
            navigator.vibrate && navigator.vibrate(30);
          } else {
            e.x += ddx / dd * step; e.y += ddy / dd * step;
          }
        } else { // entangle: cling to the captured star
          e.x = target.x; e.y = target.y; target.entangled = true;
        }
      }
    }

    // ---- web spiders -------------------------------------------------------
    function removeStar(d) {
      const idx = dots.indexOf(d);
      if (idx >= 0) dots.splice(idx, 1);
      chain = []; // drop any in-progress chain to avoid stale indices
      burst(d.x, d.y, [theme.dotBody, theme.dotShine, '#ffffff'], 14, 2.4);
    }
    function spawnSpider() {
      const target = pickTargetStar();
      if (!target) return;
      const top = topMargin, bot = H - botMargin, left = 0, right = W;
      const side = (Math.random() * 4) | 0;
      let o;
      if (side === 0) o = { x: rand(left, right), y: top };
      else if (side === 1) o = { x: rand(left, right), y: bot };
      else if (side === 2) o = { x: left, y: rand(top, bot) };
      else o = { x: right, y: rand(top, bot) };
      spiders.push({
        id: nextId++, x: o.x, y: o.y, origin: o, targetId: target.id, state: 'rush',
        speed: cfg.spiderSpeed * cell, pullSpeed: cfg.spiderPullSpeed * cell,
        angle: Math.atan2(target.y - o.y, target.x - o.x),
        phase: Math.random() * TAU, dead: false, popping: 0,
      });
      if (hud.toast) hud.toast('A web spider appears!', theme.threatBody);
    }
    function updateSpiders(sdt) {
      for (let k = spiders.length - 1; k >= 0; k--) {
        const e = spiders[k];
        if (e.dead) { e.popping -= sdt * 3; if (e.popping <= 0) spiders.splice(k, 1); continue; }
        let target = dots.find(d => d.id === e.targetId);
        if (!target) {
          const nt = pickTargetStar();
          if (!nt) { e.dead = true; e.popping = 1; continue; }
          e.targetId = nt.id; target = nt; e.state = 'rush';
        }
        if (e.state === 'rush') {
          const ddx = target.x - e.x, ddy = target.y - e.y, dd = Math.hypot(ddx, ddy) || 1;
          e.angle = Math.atan2(ddy, ddx);
          const step = e.speed * sdt;
          if (dd <= step + cell * 0.3) {
            e.x = target.x; e.y = target.y; e.state = 'web'; target.webbed = true;
            floatText(target.x, target.y - cell * 0.6, 'Webbed!', theme.threatBody, false);
            navigator.vibrate && navigator.vibrate(30);
          } else {
            e.x += ddx / dd * step; e.y += ddy / dd * step;
          }
        } else { // web: drag the captured star toward the edge
          const ax = e.origin.x - target.x, ay = e.origin.y - target.y, ad = Math.hypot(ax, ay) || 1;
          if (ad <= cell * 0.5) {
            // dragged off the edge -> the star is lost
            floatText(e.origin.x, e.origin.y, 'Star lost!', theme.threatBody, true);
            removeStar(target);
            e.dead = true; e.popping = 1;
            navigator.vibrate && navigator.vibrate(60);
          } else {
            const nx = ax / ad, ny = ay / ad, step = e.pullSpeed * sdt;
            target.x += nx * step; target.y += ny * step; target.webbed = true;
            e.x = target.x + nx * cell * 0.55; e.y = target.y + ny * cell * 0.55;
            e.angle = Math.atan2(ny, nx);
          }
        }
      }
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
        if (dots[i].entangled || dots[i].webbed) continue; // captured stars can't be activated
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
        chain = [i];
        lastTap.t = 0; // a dot tap shouldn't count toward double-tap-to-plant
        navigator.vibrate && navigator.vibrate(8);
        return;
      }
      // double-tap empty field to plant a star from your seeds
      const now = performance.now();
      const onField = p.x >= 0 && p.x <= W && p.y >= topMargin * 0.6 && p.y <= H - botMargin * 0.4;
      if (now - lastTap.t < 350 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < cell) {
        lastTap.t = 0;
        if (onField && seeds > 0 && plantAt(p.x, p.y, false)) { seeds--; pushHud(); }
      } else {
        lastTap = { t: now, x: p.x, y: p.y };
      }
    }
    function onMove(e) {
      const p = toLocal(e); pointer.x = p.x; pointer.y = p.y;
      if (carrying) { positionGhost(e); return; }
      if (!chain.length || !pointer.down) return;
      const cap = maxChain;
      const i = dotAt(p.x, p.y, 0.0);
      if (i < 0) return;
      const last = chain[chain.length - 1];
      if (i === last) return;
      const existingPos = chain.indexOf(i);
      if (existingPos >= 0) {
        if (existingPos === 0) {
          // traced back to the origin dot — cancel the whole chain
          chain = [];
          navigator.vibrate && navigator.vibrate(4);
        } else {
          // traced back to an earlier dot — truncate chain to that point (reroute)
          chain = chain.slice(0, existingPos + 1);
          navigator.vibrate && navigator.vibrate(4);
        }
        return;
      }
      // add new dot if under cap
      if (chain.length < cap) {
        chain.push(i);
        navigator.vibrate && navigator.vibrate(6);
      }
    }
    function onUp(e) {
      pointer.down = false;
      if (carrying) { dropCarry(e); return; }
      if (chain.length >= 1) resolve(false, null);
      else chain = [];
    }

    // ---- resolve the chain -------------------------------------------------
    // Returns cone parameters for a given chain length (0 = no cone)
    function coneParams(chainLen) {
      if (chainLen < 1) return null;
      const base = cfg.shotRange * cell;
      const D = Math.PI / 180;
      let range, halfAngle;
      if (chainLen === 1)      { range = base;        halfAngle = 15 * D; }
      else if (chainLen === 2) { range = base * 1.25; halfAngle = 15 * D; }
      else if (chainLen === 3) { range = base * 1.6;  halfAngle = 28 * D; }
      else                     { range = base * 2.0;  halfAngle = 38 * D; }
      // grow longer & wider the longer you hold the shot
      const rangeMul = 1 + Math.min(holdCharge * cfg.coneChargeRate, cfg.coneChargeMax);
      const angleMul = 1 + Math.min(holdCharge * cfg.coneChargeAngleRate, cfg.coneChargeAngleMax);
      range *= rangeMul;
      halfAngle = Math.min(halfAngle * angleMul, 75 * D);
      return { range, halfAngle };
    }
    // blue sun's circle radius: scales with the number of links (capped, modest)
    function sunBlastRadius(links) {
      const maxR = cfg.sunBlastMaxRadiusFrac * W;
      const f = clamp((links - 1) / 4, 0, 1);
      return maxR * (0.5 + 0.5 * f);
    }

    // ---- xp / leveling -----------------------------------------------------
    // xp needed to advance from `lvl` to `lvl + 1`
    function xpForLevel(lvl) {
      return Math.round(cfg.xpBase * Math.pow(cfg.xpGrowth, lvl - 1));
    }
    function gainXp(amount) {
      if (level >= cfg.maxLevel) { xp = 0; return; }
      xp += amount;
      while (level < cfg.maxLevel && xp >= xpForLevel(level)) {
        xp -= xpForLevel(level);
        level += 1;
        maxChain += 1;
        floatText(W / 2, topMargin + 24, 'Level ' + level + '!  Chain +1', theme.lineCore, true);
        flashA = Math.max(flashA, 0.3);
        navigator.vibrate && navigator.vibrate([10, 30, 10]);
        if (hud.toast) hud.toast('Level ' + level + '! Max chain ' + maxChain, theme.reward);
      }
      if (level >= cfg.maxLevel) xp = 0;
    }

    function resolve(isLoop, loopBackIndex) {
      if (!chain.length) return;
      const pts = chain.map(i => ({ x: dots[i].x, y: dots[i].y }));
      if (isLoop && loopBackIndex != null) {
        const lb = dots[loopBackIndex];
        pts.push({ x: lb.x, y: lb.y });
      }

      // chain-length-based line thickness: 4+ stars get a thick line
      const thickLine = chain.length >= 4;

      // the firing (last) star: a blue sun fires an omni circle instead of a cone
      const last = pts[pts.length - 1];
      const lastDot = dots[chain[chain.length - 1]];
      const lastIsSun = !!(lastDot && lastDot.kind === 'sun');
      const cone = lastIsSun ? null : coneParams(chain.length);
      const blastR = lastIsSun ? sunBlastRadius(chain.length) : cfg.shotBlastRadius * cell;
      const dx = pointer.x - last.x, dy = pointer.y - last.y;
      const pointerDist = Math.hypot(dx, dy);
      const hasConeDir = pointerDist > cell * 0.3; // only shoot if pointer is meaningfully far

      // collect kills along the polyline (only if chain has 2+ pts)
      const killed = new Set();
      if (pts.length >= 2) {
        for (const t of threats) {
          if (t.dead) continue;
          const r = threatRadius(t) + cfg.threatHitPad;
          for (let s = 0; s < pts.length - 1; s++) {
            if (segDist(t.x, t.y, pts[s].x, pts[s].y, pts[s + 1].x, pts[s + 1].y) <= r) {
              killed.add(t); break;
            }
          }
        }
      }

      // cone / directional shot from final dot (normal stars only)
      if (cone && hasConeDir) {
        const dirX = dx / pointerDist, dirY = dy / pointerDist;
        for (const t of threats) {
          if (t.dead || killed.has(t)) continue;
          const tx = t.x - last.x, ty = t.y - last.y;
          const tDist = Math.hypot(tx, ty);
          if (tDist > cone.range + threatRadius(t)) continue;
          const cosA = (tx * dirX + ty * dirY) / (tDist || 1);
          const angle = Math.acos(clamp(cosA, -1, 1));
          if (angle <= cone.halfAngle) killed.add(t);
        }
      }

      // AoE circle around the firing star (small for a normal star, the main shot for a sun)
      {
        for (const t of threats) {
          if (t.dead || killed.has(t)) continue;
          if (dist2(t.x, t.y, last.x, last.y) <= blastR * blastR) killed.add(t);
        }
        ring(last.x, last.y, blastR, lastIsSun ? '#bfe4ff' : theme.lineCore);
      }

      // shots free entangled stars by hitting the eel latched onto them
      let eelKills = 0;
      if (eels.length) {
        const eelR = cell * 0.38;
        const dirX = pointerDist ? dx / pointerDist : 0, dirY = pointerDist ? dy / pointerDist : 0;
        eels.forEach(e => {
          if (e.dead) return;
          let hit = false;
          if (pts.length >= 2) {
            for (let s = 0; s < pts.length - 1; s++) {
              if (segDist(e.x, e.y, pts[s].x, pts[s].y, pts[s + 1].x, pts[s + 1].y) <= eelR + cfg.threatHitPad) { hit = true; break; }
            }
          }
          if (!hit && cone && hasConeDir) {
            const tx = e.x - last.x, ty = e.y - last.y, td = Math.hypot(tx, ty);
            if (td <= cone.range + eelR) {
              const cosA = (tx * dirX + ty * dirY) / (td || 1);
              if (Math.acos(clamp(cosA, -1, 1)) <= cone.halfAngle) hit = true;
            }
          }
          if (!hit && dist2(e.x, e.y, last.x, last.y) <= blastR * blastR) hit = true;
          if (hit) {
            e.dead = true; e.popping = 1; eelKills++;
            burst(e.x, e.y, theme.threatParticles, 18, 2.6);
            const tg = dots.find(d => d.id === e.targetId);
            if (tg) tg.entangled = eels.some(o => !o.dead && o !== e && o.state === 'entangle' && o.targetId === tg.id);
            floatText(e.x, e.y, 'Freed!', theme.lineCore, false);
          }
        });
      }

      // shots also clear web spiders (frees the webbed star, which stops being dragged)
      let spiderKills = 0;
      if (spiders.length) {
        const spR = cell * 0.4;
        const dirX = pointerDist ? dx / pointerDist : 0, dirY = pointerDist ? dy / pointerDist : 0;
        spiders.forEach(e => {
          if (e.dead) return;
          let hit = false;
          if (pts.length >= 2) {
            for (let s = 0; s < pts.length - 1; s++) {
              if (segDist(e.x, e.y, pts[s].x, pts[s].y, pts[s + 1].x, pts[s + 1].y) <= spR + cfg.threatHitPad) { hit = true; break; }
            }
          }
          if (!hit && cone && hasConeDir) {
            const tx = e.x - last.x, ty = e.y - last.y, td = Math.hypot(tx, ty);
            if (td <= cone.range + spR) {
              const cosA = (tx * dirX + ty * dirY) / (td || 1);
              if (Math.acos(clamp(cosA, -1, 1)) <= cone.halfAngle) hit = true;
            }
          }
          if (!hit && dist2(e.x, e.y, last.x, last.y) <= blastR * blastR) hit = true;
          if (hit) {
            e.dead = true; e.popping = 1; spiderKills++;
            burst(e.x, e.y, theme.threatParticles, 18, 2.6);
            const tg = dots.find(d => d.id === e.targetId);
            if (tg) tg.webbed = spiders.some(o => !o.dead && o !== e && o.state === 'web' && o.targetId === tg.id);
            floatText(e.x, e.y, 'Freed!', theme.lineCore, false);
          }
        });
      }

      // apply kills
      const n = killed.size;
      let gained = 0;
      killed.forEach(t => {
        t.dead = true; t.popping = 1;
        const special = t.reward || t.battery;
        burst(t.x, t.y, theme.threatParticles, special ? 22 : 14, special ? 3 : 2.4);
        if (t.reward) {
          gained++;
          if (t.seedKind === 'sun') { sunSeeds++; floatText(t.x, t.y, '+1 sun', '#4ea8ff', false); }
          else { seeds++; floatText(t.x, t.y, '+1 star', theme.reward, false); }
        }
        if (t.battery) {
          for (const d of dots) { d.act = d.max; d.pop = 1; }
          floatText(t.x, t.y, 'Recharged!', theme.lineCore, true);
        }
      });
      // chance to spawn a beneficial special threat behind the kills (grows with combo size)
      if (n > 0) {
        const chance = Math.min(1, cfg.specialSpawnChance * Math.pow(n, 1.5));
        if (Math.random() < chance) {
          const arr = Array.from(killed);
          const src = arr[(Math.random() * arr.length) | 0];
          spawnSpecial(src.x, src.y); // beneficial only: buddy drop or battery
        }
      }

      // spend activations. Starting the chain from a blue sun means only the sun
      // spends a charge — the other chained stars fire for free.
      const originDot = dots[chain[0]];
      const sunOrigin = !!(originDot && originDot.kind === 'sun');
      for (const i of chain) {
        const d = dots[i];
        if (sunOrigin && d !== originDot) continue;
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

      // award xp for every enemy destroyed this stroke (base + capped combo bonus per enemy)
      const enemies = n + eelKills + spiderKills;
      if (enemies > 0) {
        const per = cfg.xpPerEnemy + Math.min(enemies, cfg.xpComboBonusMax);
        const xpGain = enemies * per;
        gainXp(xpGain);
        floatText(pts[pts.length - 1].x, pts[pts.length - 1].y + 16, '+' + xpGain + ' XP', theme.reward, false);
      }
      // line afterglow — carry thick flag, cone info, and sun-circle info for the draw
      glowLine = { pts, life: 1, thick: thickLine,
        cone: (cone && hasConeDir) ? { last, dirX: dx / (pointerDist || 1), dirY: dy / (pointerDist || 1), range: cone.range, halfAngle: cone.halfAngle } : null,
        sun: lastIsSun ? { x: last.x, y: last.y, r: blastR } : null };

      chain = []; holdCharge = 0;
      pushHud();
    }
    let slowTimer = 0;
    let glowLine = null;

    function ring(x, y, r, col) { parts.push({ ring: true, x, y, r0: r * 0.3, r: r, col, life: 1, max: 0.5 }); }
    function comboWord(n) { return n >= 6 ? 'UNREAL' : n >= 5 ? 'MASSIVE' : n >= 4 ? 'HUGE' : n >= 3 ? 'NICE' : 'COMBO'; }

    // ---- carry (drag from trays) ------------------------------------------
    let ghostEl = opts.ghost;
    function startCarry(kind, type, e) {
      type = type || 'normal';
      if (kind === 'seed') {
        if (type === 'sun' ? sunSeeds <= 0 : seeds <= 0) return;
      }
      carrying = { kind, type };
      if (ghostEl) {
        ghostEl.style.display = 'flex';
        ghostEl.textContent = type === 'sun' ? sunGlyph() : seedGlyph();
        ghostEl.style.background = type === 'sun' ? '#4ea8ff' : theme.reward;
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
        const sun = carrying.type === 'sun';
        if (onField && (sun ? sunSeeds > 0 : seeds > 0) && plantAt(p.x, p.y, false, sun ? 'sun' : 'normal')) {
          if (sun) sunSeeds--; else seeds--;
        }
      }
      carrying = null;
      if (ghostEl) ghostEl.style.display = 'none';
      pushHud();
    }
    function seedGlyph() { return '✦'; }
    function sunGlyph() { return '☀'; }

    // ---- update ------------------------------------------------------------
    function update(dt) {
      if (finished) { stepParticles(dt); return; }
      // slow-mo handling (uses real dt for the timer)
      if (slowTimer > 0) { slowTimer -= dt; targetScale = 0.34; } else { targetScale = 1; }
      timeScale += (targetScale - timeScale) * Math.min(1, dt * 10);
      const sdt = dt * timeScale;

      // cone charge while aiming a shot (uses real dt for predictable feel)
      if (pointer.down && chain.length >= 1 && !carrying) holdCharge += dt; else holdCharge = 0;

      elapsed += sdt;
      if (elapsed >= cfg.gameDuration) { endGame(true); }

      // spawns
      sinceSpawn += sdt;
      if (sinceSpawn >= spawnEvery) {
        sinceSpawn -= spawnEvery;
        spawnThreat('normal');
        threatSpawnCount++;
        if (cfg.eelEveryThreats > 0 && threatSpawnCount % cfg.eelEveryThreats === 0) spawnEel();
        if (cfg.spiderEveryThreats > 0 && threatSpawnCount % cfg.spiderEveryThreats === 0) spawnSpider();
        spawnEvery = Math.max(cfg.spawnFloor, spawnEvery * cfg.spawnSpeedup);
      }
      sinceSpecial += sdt;
      if (sinceSpecial >= cfg.specialInterval) { sinceSpecial -= cfg.specialInterval; spawnSpecial(); }

      // threats
      for (let k = threats.length - 1; k >= 0; k--) {
        const t = threats[k];
        if (t.dead) { t.popping -= dt * 3.5; if (t.popping <= 0) threats.splice(k, 1); continue; }
        t.age += sdt;
        if (threatPhaseName(t) === 'pop') {
          // explode -> lose life
          t.dead = true; t.popping = 1;
          burst(t.x, t.y, theme.threatParticles, 26, 3.2);
          loseLife();
        }
      }

      // star eels
      updateEels(sdt);
      // web spiders
      updateSpiders(sdt);

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
      if (hud.end) hud.end(win, { elapsed, lives, maxChain, level });
    }

    // ---- HUD snapshot ------------------------------------------------------
    let hudTick = 0;
    function pushHud() {
      if (!hud.update) return;
      const maxed = level >= cfg.maxLevel;
      hud.update({
        timeLeft: Math.max(0, cfg.gameDuration - elapsed),
        lives, seeds, sunSeeds,
        chainNow: chain.length, chainMax: maxChain, baseMax: maxChain,
        level, xp, xpNext: maxed ? 0 : xpForLevel(level), maxLevel: cfg.maxLevel,
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

      // star eels (over dots so coils wrap the captured star)
      for (const e of eels) drawEel(ctx, e, now);

      // web spiders (over dots so the web wraps the captured star)
      for (const e of spiders) drawSpider(ctx, e, now);

      // particles
      drawParticles(ctx);

      // floats
      drawFloats(ctx);

      ctx.restore();

      // flash
      if (flashA > 0.01) { ctx.fillStyle = theme.flash; ctx.globalAlpha = clamp(flashA, 0, 1); ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    }

    function drawChain(ctx, now) {
      if (chain.length === 0) return;
      const pts = chain.map(i => ({ x: dots[i].x, y: dots[i].y }));
      const last = pts[pts.length - 1];
      const thickLine = chain.length >= 4;

      // cone preview toward pointer (normal star) or omni circle (blue sun)
      const lastDot = dots[chain[chain.length - 1]];
      const lastIsSun = !!(lastDot && lastDot.kind === 'sun');
      const cone = lastIsSun ? null : coneParams(chain.length);
      const pdx = pointer.x - last.x, pdy = pointer.y - last.y;
      const pDist = Math.hypot(pdx, pdy);
      const hasConeDir = pDist > cell * 0.3;
      if (lastIsSun && pointer.down) {
        ctx.save();
        ctx.globalAlpha = 0.22; ctx.fillStyle = '#bfe4ff';
        ctx.shadowColor = '#4ea8ff'; ctx.shadowBlur = 14 * cfg.juice;
        ctx.beginPath(); ctx.arc(last.x, last.y, sunBlastRadius(chain.length), 0, TAU); ctx.fill();
        ctx.restore();
      } else if (cone && hasConeDir && pointer.down) {
        const dirX = pdx / pDist, dirY = pdy / pDist;
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = theme.lineGlow;
        ctx.shadowColor = theme.lineGlow;
        ctx.shadowBlur = 14 * cfg.juice;
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.arc(last.x, last.y, cone.range, Math.atan2(dirY, dirX) - cone.halfAngle, Math.atan2(dirY, dirX) + cone.halfAngle);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      if (pts.length >= 2 || (pts.length === 1 && pointer.down)) {
        const drawPts = pts.slice();
        if (pointer.down) drawPts.push({ x: pointer.x, y: pointer.y });
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        // glow
        ctx.strokeStyle = theme.lineGlow; ctx.globalAlpha = 0.55;
        ctx.lineWidth = thickLine ? 26 : 14;
        ctx.shadowColor = theme.lineGlow; ctx.shadowBlur = 18 * cfg.juice;
        if (drawPts.length >= 2) strokePts(ctx, drawPts);
        // core
        ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.strokeStyle = theme.lineCore;
        ctx.lineWidth = thickLine ? 10 : 5;
        ctx.setLineDash([2, 10]); ctx.lineDashOffset = -now * 0.04;
        if (drawPts.length >= 2) strokePts(ctx, drawPts);
        ctx.setLineDash([]);
      }
      // node rings
      for (const i of chain) { const d = dots[i]; ctx.strokeStyle = theme.lineCore; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(d.x, d.y, cell * 0.46, 0, TAU); ctx.stroke(); }
    }
    function strokePts(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke(); }
    function drawGlowLine(ctx, gl) {
      ctx.save();
      // cone afterglow
      if (gl.cone) {
        const c = gl.cone;
        ctx.globalAlpha = clamp(gl.life, 0, 1) * 0.35;
        ctx.fillStyle = theme.lineGlow;
        ctx.shadowColor = theme.lineGlow;
        ctx.shadowBlur = 20 * cfg.juice;
        ctx.beginPath();
        ctx.moveTo(c.last.x, c.last.y);
        ctx.arc(c.last.x, c.last.y, c.range * (0.5 + gl.life * 0.5), Math.atan2(c.dirY, c.dirX) - c.halfAngle, Math.atan2(c.dirY, c.dirX) + c.halfAngle);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      // sun circle afterglow
      if (gl.sun) {
        ctx.globalAlpha = clamp(gl.life, 0, 1) * 0.4;
        ctx.fillStyle = '#bfe4ff'; ctx.shadowColor = '#4ea8ff'; ctx.shadowBlur = 22 * cfg.juice;
        ctx.beginPath(); ctx.arc(gl.sun.x, gl.sun.y, gl.sun.r * (0.6 + gl.life * 0.4), 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
      }
      // line afterglow (only if there were 2+ points)
      if (gl.pts.length >= 2) {
        ctx.globalAlpha = clamp(gl.life, 0, 1) * 0.8;
        ctx.strokeStyle = theme.lineCore;
        ctx.lineWidth = (gl.thick ? 10 : 6) + (1 - gl.life) * 26;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.shadowColor = theme.lineGlow; ctx.shadowBlur = 24 * cfg.juice;
        strokePts(ctx, gl.pts);
      }
      ctx.restore();
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

    function roundRect(ctx, x, y, w, h, rad) {
      ctx.beginPath();
      ctx.moveTo(x + rad, y);
      ctx.arcTo(x + w, y, x + w, y + h, rad);
      ctx.arcTo(x + w, y + h, x, y + h, rad);
      ctx.arcTo(x, y + h, x, y, rad);
      ctx.arcTo(x, y, x + w, y, rad);
      ctx.closePath();
    }

    // a cute little battery that recharges every star when sliced
    function drawBattery(ctx, x, y, r, danger) {
      const w = r * 1.5, h = r * 2.0;
      if (danger) { ctx.shadowColor = '#5bd66a'; ctx.shadowBlur = 22; }
      // top terminal nub
      ctx.fillStyle = '#d8e0c8';
      roundRect(ctx, x - w * 0.22, y - h / 2 - r * 0.26, w * 0.44, r * 0.32, r * 0.1); ctx.fill();
      // body
      const grad = ctx.createLinearGradient(x, y - h / 2, x, y + h / 2);
      grad.addColorStop(0, '#9bef9f'); grad.addColorStop(1, '#37b24d');
      ctx.fillStyle = grad;
      roundRect(ctx, x - w / 2, y - h / 2, w, h, r * 0.32); ctx.fill();
      ctx.shadowBlur = 0;
      // outline
      ctx.strokeStyle = '#2c8a3a'; ctx.lineWidth = Math.max(1.5, r * 0.1);
      roundRect(ctx, x - w / 2, y - h / 2, w, h, r * 0.32); ctx.stroke();
      // lightning bolt
      const s = r * 0.95;
      ctx.fillStyle = '#ffd24c'; ctx.strokeStyle = '#a9701a'; ctx.lineWidth = Math.max(1, r * 0.07);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.20, y - s * 0.58);
      ctx.lineTo(x - s * 0.30, y + s * 0.06);
      ctx.lineTo(x + s * 0.02, y + s * 0.06);
      ctx.lineTo(x - s * 0.16, y + s * 0.58);
      ctx.lineTo(x + s * 0.32, y - s * 0.10);
      ctx.lineTo(x + s * 0.02, y - s * 0.10);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }

    // a serpentine star eel: rushes a star, then coils around it
    function drawEel(ctx, e, now) {
      ctx.save();
      if (e.dead) ctx.globalAlpha = clamp(e.popping, 0, 1);
      const headR = cell * 0.34;
      const bodyCol = theme.threatBody, darkCol = theme.threatBodyDark;
      if (e.state === 'entangle') {
        // coil rings around the captured star
        ctx.strokeStyle = bodyCol; ctx.lineWidth = cell * 0.15; ctx.lineCap = 'round';
        ctx.shadowColor = bodyCol; ctx.shadowBlur = 12;
        for (let i = 0; i < 3; i++) {
          const a0 = now * 0.004 + i * TAU / 3 + e.phase;
          ctx.beginPath(); ctx.arc(e.x, e.y, cell * (0.34 + i * 0.16), a0, a0 + Math.PI * 1.25); ctx.stroke();
        }
        ctx.shadowBlur = 0;
        const ha = now * 0.004 + e.phase, hr = cell * 0.5;
        eelHead(ctx, e.x + Math.cos(ha) * hr, e.y + Math.sin(ha) * hr, headR * 0.85, ha, bodyCol, darkCol);
      } else {
        // moving serpent body trailing behind the head
        const dx = Math.cos(e.angle), dy = Math.sin(e.angle);
        const px = -dy, py = dx;
        const N = 8, len = cell * 1.8;
        for (let i = N; i >= 1; i--) {
          const f = i / N;
          const along = -f * len;
          const wig = Math.sin(now * 0.009 - i * 0.7 + e.phase) * cell * 0.22 * f;
          const sx = e.x + dx * along + px * wig, sy = e.y + dy * along + py * wig;
          const sr = headR * (1 - f * 0.62);
          ctx.fillStyle = mix(bodyCol, '#10061f', f * 0.55);
          ctx.shadowColor = bodyCol; ctx.shadowBlur = 10;
          ctx.beginPath(); ctx.arc(sx, sy, sr, 0, TAU); ctx.fill();
        }
        ctx.shadowBlur = 0;
        eelHead(ctx, e.x, e.y, headR, e.angle, bodyCol, darkCol);
      }
      ctx.restore();
    }
    function eelHead(ctx, x, y, r, ang, bodyCol, darkCol) {
      ctx.save();
      ctx.shadowColor = bodyCol; ctx.shadowBlur = 14;
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      g.addColorStop(0, mix(bodyCol, '#ffffff', 0.3)); g.addColorStop(1, bodyCol);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      // eyes facing the travel direction
      const ex = Math.cos(ang), ey = Math.sin(ang), nx = -ey, ny = ex;
      const eo = r * 0.42, es = r * 0.3;
      for (const sgn of [-1, 1]) {
        const cx = x + ex * r * 0.3 + nx * sgn * eo, cy = y + ey * r * 0.3 + ny * sgn * eo;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, es, 0, TAU); ctx.fill();
        ctx.fillStyle = darkCol; ctx.beginPath(); ctx.arc(cx + ex * es * 0.3, cy + ey * es * 0.3, es * 0.5, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    // a web spider: rushes a star, wraps it, then drags it toward the edge
    function drawSpider(ctx, e, now) {
      ctx.save();
      if (e.dead) ctx.globalAlpha = clamp(e.popping, 0, 1);
      const bodyCol = theme.threatBody, darkCol = theme.threatBodyDark;
      if (e.state === 'web') {
        // web strand back to the edge it's dragging toward
        ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.origin.x, e.origin.y); ctx.stroke();
        const tg = dots.find(d => d.id === e.targetId);
        if (tg) drawWebWrap(ctx, tg.x, tg.y, cell * 0.5);
      }
      spiderBody(ctx, e.x, e.y, cell * 0.3, e.angle, now, bodyCol, darkCol);
      ctx.restore();
    }
    function drawWebWrap(ctx, x, y, r) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
      const spokes = 8;
      for (let i = 0; i < spokes; i++) {
        const a = i / spokes * TAU;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.stroke();
      }
      for (let ring = 1; ring <= 2; ring++) {
        const rr = r * ring / 2.4;
        ctx.beginPath();
        for (let i = 0; i <= spokes; i++) { const a = i / spokes * TAU; const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
        ctx.stroke();
      }
      ctx.restore();
    }
    function spiderBody(ctx, x, y, r, ang, now, bodyCol, darkCol) {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang);
      // legs
      ctx.strokeStyle = darkCol; ctx.lineWidth = Math.max(1.5, r * 0.2); ctx.lineCap = 'round';
      const wig = Math.sin(now * 0.02 + e_phase(x, y)) * 0.18;
      for (let i = 0; i < 8; i++) {
        const side = i < 4 ? -1 : 1;
        const t = i % 4;
        const a = side * (0.55 + t * 0.45) + wig * side;
        const mx = Math.cos(a) * r * 1.2, my = Math.sin(a) * r * 1.2;
        const fx = Math.cos(a) * r * 2.1, fy = Math.sin(a) * r * 2.1;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(mx, my - r * 0.4, fx, fy); ctx.stroke();
      }
      // abdomen
      ctx.shadowColor = bodyCol; ctx.shadowBlur = 12;
      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r * 1.1);
      g.addColorStop(0, mix(bodyCol, '#ffffff', 0.3)); g.addColorStop(1, bodyCol);
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(-r * 0.25, 0, r * 1.05, r * 0.9, 0, 0, TAU); ctx.fill();
      // head
      ctx.beginPath(); ctx.arc(r * 0.7, 0, r * 0.55, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      // eyes
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(r * 0.92, -r * 0.24, r * 0.16, 0, TAU); ctx.arc(r * 0.92, r * 0.24, r * 0.16, 0, TAU); ctx.fill();
      ctx.fillStyle = darkCol;
      ctx.beginPath(); ctx.arc(r * 1.0, -r * 0.24, r * 0.08, 0, TAU); ctx.arc(r * 1.0, r * 0.24, r * 0.08, 0, TAU); ctx.fill();
      ctx.restore();
    }
    function e_phase(x, y) { return (x + y) * 0.05; }

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
      if (t.battery) { drawBattery(ctx, x, y, rr, danger); ctx.restore(); ctx.globalAlpha = 1; return; }
      // soft outer glow when dangerous
      if (danger) { ctx.shadowColor = t.reward ? theme.reward : theme.threatBody; ctx.shadowBlur = 22; }
      // body
      const grad = ctx.createRadialGradient(x - rr * 0.3, y - rr * 0.35, rr * 0.1, x, y, rr);
      const sunSeed = t.reward && t.seedKind === 'sun';
      if (t.reward) {
        if (sunSeed) { grad.addColorStop(0, '#e6f3ff'); grad.addColorStop(1, '#3f93f0'); }
        else { grad.addColorStop(0, '#fff2b0'); grad.addColorStop(1, theme.reward); }
      }
      else { grad.addColorStop(0, mix(theme.threatBody, '#ffffff', 0.25)); grad.addColorStop(1, danger ? theme.threatBodyDark : theme.threatBody); }
      ctx.fillStyle = grad;
      blobPath(ctx, x, y, rr, t.reward ? 0.05 : 0.07, now * 0.003 + t.phase); ctx.fill();
      ctx.shadowBlur = 0;

      if (t.reward) {
        // sparkle ring + happy face
        ctx.strokeStyle = sunSeed ? '#1f6fd0' : theme.rewardDark; ctx.lineWidth = Math.max(1.5, rr * 0.08);
        for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + now * 0.001; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * rr * 1.05, y + Math.sin(a) * rr * 1.05); ctx.lineTo(x + Math.cos(a) * rr * 1.32, y + Math.sin(a) * rr * 1.32); ctx.stroke(); }
        face(ctx, x, y, rr, sunSeed ? '#0b3a72' : theme.rewardCore, true);
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

      if (d.kind === 'sun') {
        // blue sun: glowing disc ringed by a short corona of rays
        ctx.shadowColor = '#4ea8ff'; ctx.shadowBlur = 18;
        ctx.fillStyle = '#5ba2f5';
        const rays = 12;
        for (let i = 0; i < rays; i++) {
          const a = i / rays * TAU + now * 0.0006;
          const r0 = r * 1.02, r1 = r * (1.45 + 0.12 * Math.sin(now * 0.005 + i));
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a - 0.13) * r0, y + Math.sin(a - 0.13) * r0);
          ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
          ctx.lineTo(x + Math.cos(a + 0.13) * r0, y + Math.sin(a + 0.13) * r0);
          ctx.closePath(); ctx.fill();
        }
        const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r * 1.1);
        g.addColorStop(0, '#e6f3ff'); g.addColorStop(0.6, '#6fb6ff'); g.addColorStop(1, '#1f6fd0');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.05, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
      } else if (theme.dotStyle === 'star') {
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
      const eyeC = d.kind === 'sun' ? '#0b3a72' : theme.dotEye;
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

      // entangled stars are dimmed (disabled until the eel is shot off)
      if (d.entangled || d.webbed) {
        ctx.globalAlpha = 0.5; ctx.fillStyle = '#1a0a2c';
        ctx.beginPath(); ctx.arc(x, y, r * 1.15, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
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
      _frame: () => raf, getCfg: () => cfg, getTheme: () => theme, seedGlyph, sunGlyph,
      _dots: () => dots, _threats: () => threats, _eels: () => eels, _spiders: () => spiders, _render: (t) => render(t || performance.now()), _state: () => ({ lives, seeds, maxChain, elapsed, finished }) };
    raf = requestAnimationFrame(frame);
    return api;
  }

  window.GameEngine = { create };
})();
