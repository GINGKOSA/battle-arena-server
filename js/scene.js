'use strict';
/* ═══════════════ THREE.JS SCENE — Style Pokémon DS ═══════════════
   1v1  : allié bas-gauche (grand, dos), ennemi haut-droite (petit, face)
   FFA  : allié bas-gauche (grand, dos), TOUS les ennemis alignés en face
   2v2  : alliés bas, ennemis haut, tous face caméra
================================================================= */

let r3 = null, s3, cam3;
let meshes = {}, hitParticles = [], t3 = 0;

/* ── Init Three.js ── */
function initThree() {
  const canvas = document.getElementById('battle-canvas');
  const cont   = document.getElementById('top-screen');

  r3 = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  r3.setPixelRatio(Math.min(devicePixelRatio, 2));
  r3.shadowMap.enabled = true;
  r3.shadowMap.type    = THREE.PCFSoftShadowMap;
  r3.setClearColor(0x1a2a1a, 1);

  s3   = new THREE.Scene();
  cam3 = new THREE.PerspectiveCamera(35, 2, 0.1, 200);
  cam3.position.set(0, 3.5, 7);
  cam3.lookAt(0, 1.2, -2);

  const onResize = () => {
    const w = cont.clientWidth, h = cont.clientHeight;
    if (!w || !h) return;
    r3.setSize(w, h, false);
    cam3.aspect = w / h;
    cam3.updateProjectionMatrix();
  };
  onResize();
  window.addEventListener('resize', onResize);

  buildScene();
  buildChars();
  animate3();
  // Init des boutons gyroscope sur l'écran du haut
  if (typeof initGyroUI === 'function') initGyroUI();
}

/* ── Décors ── */
function buildScene() {
  // ── Fond spatial (ciel étoilé) ──
  r3.setClearColor(0x05050f, 1); // noir spatial

  // Étoiles particules
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(800 * 3);
  for (let i = 0; i < 800; i++) {
    starPos[i*3]   = (Math.random() - 0.5) * 120;
    starPos[i*3+1] = (Math.random() - 0.5) * 60;
    starPos[i*3+2] = (Math.random() - 0.5) * 120 - 20;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  s3.add(new THREE.Points(starGeo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, transparent: true, opacity: 0.8 })
  ));

  // ── Sol plat unique — grande dalle sombre ──
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({
      color: 0x111122,
      roughness: 0.6,
      metalness: 0.3,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  s3.add(floor);

  // Grille fine sur le sol
  const grid = new THREE.GridHelper(40, 40, 0x222244, 0x1a1a33);
  grid.position.y = 0.01;
  s3.add(grid);

  // ── Cercle d'arène central ──
  const arenaRing = new THREE.Mesh(
    new THREE.RingGeometry(4.8, 5.0, 64),
    new THREE.MeshBasicMaterial({ color: 0x4444cc, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
  );
  arenaRing.rotation.x = -Math.PI / 2;
  arenaRing.position.y = 0.02;
  s3.add(arenaRing);

  // Remplissage intérieur de l'arène légèrement éclairé
  const arenaFloor = new THREE.Mesh(
    new THREE.CircleGeometry(4.8, 64),
    new THREE.MeshStandardMaterial({ color: 0x15152e, roughness: 0.5, metalness: 0.2 })
  );
  arenaFloor.rotation.x = -Math.PI / 2;
  arenaFloor.position.y = 0.015;
  arenaFloor.receiveShadow = true;
  s3.add(arenaFloor);

  // Lignes décoratives de l'arène (croix)
  [[0,0,4.8,0],[0,0,-4.8,0],[4.8,0,0,Math.PI/2],[-4.8,0,0,Math.PI/2]].forEach(([x,y,z,ry]) => {
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(0.04, 9.6),
      new THREE.MeshBasicMaterial({ color: 0x3333aa, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = ry;
    line.position.set(0, 0.02, 0);
    s3.add(line);
  });

  // ── Lumières ──
  s3.add(new THREE.AmbientLight(0x8888bb, 0.5));

  const dl = new THREE.DirectionalLight(0xffffff, 1.0);
  dl.position.set(3, 12, 5);
  dl.castShadow = true;
  s3.add(dl);

  // Point lights colorés aux coins de l'arène
  const pl1 = new THREE.PointLight(0xff4400, 1.2, 12);
  pl1.position.set(-3, 2, 3); s3.add(pl1); s3._pl1 = pl1;

  const pl2 = new THREE.PointLight(0x0044ff, 1.2, 12);
  pl2.position.set(3, 2, -3); s3.add(pl2); s3._pl2 = pl2;

  // Pas de brouillard — on est dans l'espace
  s3.fog = null;
}

/* ── Construction des personnages ── */
function buildChars() {
  Object.values(meshes).forEach(m => s3.remove(m));
  meshes = {};

  const n       = G.players.length;
  const allies  = G.players.filter(p => p.slot === G.mySlot ||
                    (G.mode === '2v2' && G.players.find(q => q.slot === G.mySlot)?.team === p.team));
  const enemies = G.players.filter(p => !allies.includes(p));

  if (n <= 2) {
    // ── 1v1 ──
    G.players.forEach(p => {
      const isAlly = p.slot === G.mySlot;
      const col    = SLOT_CLR_3D[p.slot] || 0xff5522;
      if (isAlly) {
        const m = makeChar(col, p.char.name === 'Pyros', 1.6);
        m.position.set(-1.5, 0, 3.5);
        m.rotation.y = 0.3;
        s3.add(m); meshes[p.slot] = m;
      } else {
        const m = makeChar(col, p.char.name === 'Pyros', 1.0);
        m.position.set(1.5, 0, -2);
        m.rotation.y = Math.PI + 0.15;
        s3.add(m); meshes[p.slot] = m;
      }
    });

  } else {
    // ── FFA / 2v2 ──
    // Caméra légèrement sur la gauche et en hauteur :
    // - toi bien visible en bas-gauche (grand, de dos)
    // - ennemis groupés à droite en face, légèrement en escalier
    //   pour qu'on voie chacun sans qu'ils se cachent
    cam3.position.set(-1.0, 4.0, 9.5);
    cam3.lookAt(0.5, 0.0, -0.5);
    cam3.updateMatrixWorld(true);

    // Toi : bas-gauche, grand, de dos tourné vers les ennemis
    const me = G.players.find(p => p.slot === G.mySlot);
    if (me) {
      const col = SLOT_CLR_3D[me.slot] || 0xff5522;
      const m   = makeChar(col, me.char.name === 'Pyros', 1.0);
      m.position.set(-2.5, 0, 2.5);
      m.rotation.y = 0.62; // dos caméra, tourné vers le centre de l'arène
      s3.add(m); meshes[me.slot] = m;
      // Cercle
      const c = new THREE.Mesh(new THREE.CircleGeometry(0.9, 32),
        new THREE.MeshBasicMaterial({ color: SLOT_CLR_3D[me.slot]||0x4a9a2e, transparent:true, opacity:0.2 }));
      c.rotation.x = -Math.PI/2; c.position.set(-2.5, 0.01, 3.5); s3.add(c);
    }

    // Ennemis : groupés à droite, en escalier (décalés en Z)
    // chacun légèrement devant l'autre → on voit tout le monde
    // Plus l'ennemi est "derrière" (z petit), plus il est surélevé (y) pour rester visible
    const enemies = G.players.filter(p => p.slot !== G.mySlot);
    const eCount  = enemies.length;

    // Positions en escalier décalé :
    //   2 ennemis : côte à côte (même z, x différents)
    //   3 ennemis : triangle — 1 au fond-centre, 2 devant gauche+droite
    // [x, y, z, scale, rotY]  — tous tournés vers le centre (0.5, 0.5)
    const enemyLayouts = {
      1: [[ 3.0,  0,    1.5, 1.00, -2.225]],
      2: [
        [-1.5,  0,   -1.2, 1.00,  0.695],
        [ 3.0,  0,   -1.0, 1.00, -0.824],
      ],
      3: [
        [-1.5,  0,   -1.2, 1.00,  0.695],   // haut-gauche
        [ 3.0,  0,   -1.0, 1.00, -0.824],   // haut-droite
        [ 3.0,  0,    1.5, 1.00, -2.225],   // droite-bas
      ],
    };

    const layout = enemyLayouts[eCount] || enemyLayouts[1];
    enemies.forEach((p, i) => {
      const [ex, ey, ez, eScale, eRy] = layout[i] || layout[0];

      const col = SLOT_CLR_3D[p.slot] || 0x22aaff;
      const m   = makeChar(col, p.char.name === 'Pyros', eScale);
      m.position.set(ex, ey, ez);
      m.rotation.y = eRy;
      s3.add(m); meshes[p.slot] = m;

      const circ = new THREE.Mesh(new THREE.CircleGeometry(0.6, 32),
        new THREE.MeshBasicMaterial({ color: SLOT_CLR_3D[p.slot]||0x4a9a2e, transparent:true, opacity:0.25 }));
      circ.rotation.x = -Math.PI/2;
      circ.position.set(ex, 0.01, ez);
      s3.add(circ);
    });
  }

  renderHPOverlay();
}

function resetThreeChars() { buildChars(); }

/* ── Fabrication personnage ── */
function makeChar(col, fire, scale = 1.0) {
  const g  = new THREE.Group();
  const dk = fire ? 0xcc3300 : 0x0055aa;
  const m  = new THREE.MeshStandardMaterial({ color: col, roughness: 0.4, metalness: 0.2 });
  const dm = new THREE.MeshStandardMaterial({ color: dk,  roughness: 0.5 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.5), m);
  body.position.y = 1.15; body.castShadow = true; g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 16), m);
  head.position.y = 1.9; head.castShadow = true; g.add(head);

  [-0.18, 0.18].forEach(x => {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.7, 12), dm);
    l.position.set(x, 0.35, 0); l.castShadow = true; g.add(l);
  });

  [[-0.48, 0.4], [0.48, -0.4]].forEach(([x, rz]) => {
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.6, 12), dm);
    a.position.set(x, 1.15, 0); a.rotation.z = rz; g.add(a);
  });

  const emb = fire
    ? new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xff8800, emissiveIntensity: 0.8 }))
    : new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 8),
        new THREE.MeshStandardMaterial({ color: 0x88ddff, emissive: 0x0088ff, emissiveIntensity: 0.6 }));
  emb.position.set(0, fire ? 1.2 : 2.28, fire ? 0.28 : 0);
  g.add(emb);

  const sh = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 })
  );
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.03; g.add(sh);

  g.scale.setScalar(scale);
  return g;
}

/* ══════════════════════════════════════════
   HP OVERLAY — style Pokémon DS
   En FFA/2v2 :
   • Toi        → bas-gauche (1 carte)
   • Ennemis    → haut, divisé en colonnes égales
                  avec 2px de gap entre chaque carte
══════════════════════════════════════════ */
function renderHPOverlay() {
  let box = document.getElementById('hp-overlay');
  if (!box) {
    box = document.createElement('div');
    box.id = 'hp-overlay';
    box.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:4;';
    document.getElementById('top-screen').appendChild(box);
  }
  box.innerHTML = '';

  const n = G.players.length;

  if (n <= 2) {
    // ── 1v1 : disposition classique ──
    G.players.forEach(p => {
      const isAlly = p.slot === G.mySlot;
      const style  = isAlly
        ? 'left:3%;bottom:28%;width:42%;'
        : 'right:3%;top:5%;width:42%;';
      box.appendChild(makeHPCard(p, isAlly, style));
    });
    return;
  }

  // ── FFA / 2v2 ──
  const myTeam = G.mode === '2v2'
    ? G.players.find(p => p.slot === G.mySlot)?.team : null;

  const enemies = G.players.filter(p => {
    if (p.slot === G.mySlot) return false;
    if (G.mode === '2v2') return p.team !== myTeam;
    return true;
  });

  const GAP = '3px';
  const W   = '47%'; // largeur de chaque carte (~moitié de l'écran)

  // ── Moi → bas-gauche ──
  const meP = G.players.find(p => p.slot === G.mySlot);
  if (meP) box.appendChild(makeHPCard(meP, true,
    `left:3%;bottom:28%;width:${W};`));

  const eCount = enemies.length;

  if (eCount === 1) {
    // 1 ennemi → haut-droite
    box.appendChild(makeHPCard(enemies[0], false,
      `right:3%;top:3%;width:${W};`));

  } else if (eCount === 2) {
    // 2 ennemis → haut-gauche et haut-droite
    // Rangée flex en haut, width égale avec gap
    const row = document.createElement('div');
    row.style.cssText = `position:absolute;top:3%;left:3%;right:3%;display:flex;gap:${GAP};`;
    enemies.forEach(p => {
      const c = makeHPCard(p, false, '');
      c.style.cssText = 'flex:1;min-width:0;';
      row.appendChild(c);
    });
    box.appendChild(row);

  } else {
    // 3 ennemis : positions dans l'arène
    //   ennemi[0] → haut-gauche
    //   ennemi[1] → haut-droite
    //   ennemi[2] → bas-droite (celui qui est à droite-bas dans l'arène)
    // Rangée du haut : enemies[0] et enemies[1]
    const rowTop = document.createElement('div');
    rowTop.style.cssText = `position:absolute;top:3%;left:3%;right:3%;display:flex;gap:${GAP};`;
    [enemies[0], enemies[1]].forEach(p => {
      const c = makeHPCard(p, false, '');
      c.style.cssText = 'flex:1;min-width:0;';
      rowTop.appendChild(c);
    });
    box.appendChild(rowTop);

    // Ennemi bas-droite (celui à droite dans l'arène)
    box.appendChild(makeHPCard(enemies[2], false,
      `right:3%;bottom:28%;width:${W};`));
  }
}

function makeHPCard(p, isAlly, posStyle) {
  const pct  = Math.max(0, p.hp) / p.maxHP;
  const barC = pct > 0.5 ? '#20c060' : pct > 0.25 ? '#f0c000' : '#e03020';
  const side = isAlly ? 'ally' : 'enemy';

  const card = document.createElement('div');
  card.id = 'hp-card-' + p.slot;
  if (posStyle) card.style.cssText = 'position:absolute;' + posStyle;

  card.innerHTML = `
    <div class="pkm-hp-box ${side}">
      <div class="pkm-name-row">
        <span class="pkm-name" style="color:${SLOT_CLR[p.slot]||'#1a1a1a'}">${p.pseudo.slice(0,8).toUpperCase()}</span>
        <span class="pkm-lv">${p.hp}/${p.maxHP}</span>
      </div>
      <div class="pkm-bar-row">
        <span class="pkm-hp-label">PV</span>
        <div class="pkm-bar-bg">
          <div class="pkm-bar-fill" id="bar-${p.slot}"
            style="width:${pct*100}%;background:${barC}"></div>
        </div>
      </div>
    </div>`;
  return card;
}

/* ── Mise à jour HP ── */
function updateAllSprites() {
  G.players.forEach(p => {
    const bar  = document.getElementById('bar-' + p.slot);
    const card = document.getElementById('hp-card-' + p.slot);
    if (!bar) return;
    const pct  = Math.max(0, p.hp) / p.maxHP;
    const barC = pct > 0.5 ? '#20c060' : pct > 0.25 ? '#f0c000' : '#e03020';
    bar.style.width      = (pct * 100) + '%';
    bar.style.background = barC;
    // Met à jour le "pseudo hp/max" dans pkm-lv
    const lv = card ? card.querySelector('.pkm-lv') : null;
    if (lv) lv.textContent = p.hp + '/' + p.maxHP;
    // Grise la carte si mort
    if (!p.alive && card) card.style.opacity = '0.35';
  });
}

/* ── Particules d'impact ── */
function spawnHitParticles(slot) {
  const mesh = meshes[slot]; if (!mesh) return;
  const color = SLOT_CLR_3D[slot] || 0xff2200;
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.07 + Math.random() * 0.07, 6, 6),
      new THREE.MeshBasicMaterial({ color })
    );
    m.position.set(
      mesh.position.x + (Math.random() - 0.5) * 0.6,
      mesh.position.y + 1.2 + (Math.random() - 0.5) * 0.6,
      mesh.position.z + (Math.random() - 0.5) * 0.4
    );
    m.userData = {
      vx: (Math.random() - 0.5) * 0.08,
      vy: 0.05 + Math.random() * 0.05,
      vz: (Math.random() - 0.5) * 0.05,
      life: 1
    };
    s3.add(m); hitParticles.push(m);
  }
}

/* ── Boucle d'animation ── */
function animate3() {
  requestAnimationFrame(animate3);
  t3 += 0.016;

  Object.entries(meshes).forEach(([s, m]) => {
    m.position.y += Math.sin(t3 * 1.4 + (+s) * 1.2) * 0.0008;
  });

  hitParticles = hitParticles.filter(p => {
    p.userData.life -= 0.035;
    p.userData.vy   -= 0.002;
    p.position.x    += p.userData.vx;
    p.position.y    += p.userData.vy;
    p.position.z    += p.userData.vz;
    p.material.opacity     = p.userData.life;
    p.material.transparent = true;
    if (p.userData.life <= 0) { s3.remove(p); return false; }
    return true;
  });

  r3.render(s3, cam3);
  }

