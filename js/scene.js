/* ═══════════════ THREE.JS SCENE ═══════════════ */
let r3 = null, s3, cam3;
let meshes    = {};   // { slot: THREE.Group }
let hpSprites = {};   // { slot: THREE.Sprite }
let hitParticles = [];
let t3 = 0;

/* ── HP Sprites ── */
function makeHPCanvas(name, hp, maxHP, color) {
  const W = 384, H = 105;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(8,8,20,0.82)';
  roundRect(ctx, 3, 3, W-6, H-6, 14); ctx.fill();

  ctx.strokeStyle = color + '55';
  ctx.lineWidth = 2;
  roundRect(ctx, 3, 3, W-6, H-6, 14); ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.shadowColor = color; ctx.shadowBlur = 8;
  ctx.fillText(name.slice(0, 14), W/2, 38);
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, 16, 54, W-32, 24, 7); ctx.fill();

  const pct = Math.max(0, hp) / maxHP;
  const barColor = pct > 0.5 ? '#1D9E75' : pct > 0.25 ? '#EF9F27' : '#E24B4A';
  ctx.fillStyle = barColor; ctx.shadowColor = barColor; ctx.shadowBlur = 6;
  roundRect(ctx, 16, 54, Math.max(0, (W-32) * pct), 24, 7); ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'rgba(230,230,255,0.95)';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.max(0, hp)} / ${maxHP}`, W/2, 94);

  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}

function makeHPSprite(name, hp, maxHP, color) {
  const canvas = makeHPCanvas(name, hp, maxHP, color);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.6, 0.9, 1);
  sprite._name = name; sprite._maxHP = maxHP; sprite._color = color; sprite._lastHP = hp;
  return sprite;
}

function updateHPSprite(sprite, hp, name) {
  if (!sprite) return;
  if (sprite._lastHP === hp && (!name || sprite._name === name)) return;
  sprite._lastHP = hp;
  if (name) sprite._name = name;
  sprite.material.map.image = makeHPCanvas(sprite._name, hp, sprite._maxHP, sprite._color);
  sprite.material.map.needsUpdate = true;
}

function updateAllSprites() {
  players.forEach(p => {
    const sprite = hpSprites[p.slot];
    if (sprite) updateHPSprite(sprite, p.hp, p.pseudo);
  });
}

/* ── Init scène ── */
function initThree() {
  const canvas = document.getElementById('battle-canvas');
  const cont   = document.getElementById('canvas-container');

  r3 = new THREE.WebGLRenderer({ canvas, antialias: true });
  r3.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  r3.shadowMap.enabled = true;
  r3.setClearColor(0x0d0d1a, 1);

  s3 = new THREE.Scene();
  s3.fog = new THREE.Fog(0x0d0d1a, 12, 32);

  cam3 = new THREE.PerspectiveCamera(55, 2, 0.1, 100);
  cam3.position.set(0, 2.8, 8);
  cam3.lookAt(0, 1, 0);

  function resize() {
    const w = cont.clientWidth, h = cont.clientHeight;
    r3.setSize(w, h, false);
    cam3.aspect = w / h;
    cam3.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  // Lumières
  s3.add(new THREE.AmbientLight(0x8888cc, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(5, 8, 5); dir.castShadow = true; s3.add(dir);
  const pl1 = new THREE.PointLight(0xff6600, 1.5, 10); pl1.position.set(-4,2,2); s3.add(pl1);
  const pl2 = new THREE.PointLight(0x00aaff, 1.5, 10); pl2.position.set(4,2,2);  s3.add(pl2);
  s3._pl1 = pl1; s3._pl2 = pl2;

  // Sol
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20,20,10,10),
    new THREE.MeshStandardMaterial({ color:0x12122a, roughness:0.8 })
  );
  floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; s3.add(floor);
  s3.add(new THREE.GridHelper(20,20,0x2a2a6a,0x1a1a44));

  const arena = new THREE.Mesh(
    new THREE.CircleGeometry(4,64),
    new THREE.MeshStandardMaterial({ color:0x1a1a3a, roughness:0.5 })
  );
  arena.rotation.x = -Math.PI/2; arena.position.y = 0.02; s3.add(arena);

  addParticleField(0xff6600);
  addParticleField(0x00aaff);

  buildChars();
  animate3();
}

function buildChars() {
  // Supprime les anciens
  Object.values(meshes).forEach(m => s3.remove(m));
  Object.values(hpSprites).forEach(s => s3.remove(s));
  meshes = {}; hpSprites = {};

  const positions = POSITIONS[players.length] || POSITIONS[2];

  players.forEach((p, i) => {
    const pos   = positions[i] || [0, 0, 0];
    const color = SLOT_COLORS_3D[p.slot] || 0xffffff;
    const colorHex = SLOT_COLORS[p.slot] || '#ffffff';

    // Personnage
    const mesh = makeChar(color, p.char.name === 'Pyros');
    mesh.position.set(pos[0], pos[1], pos[2]);
    // Rotation : slots 0,1 regardent à droite, 2,3 regardent à gauche
    mesh.rotation.y = i < Math.ceil(players.length/2) ? 0.3 : Math.PI - 0.3;
    s3.add(mesh);
    meshes[p.slot] = mesh;
    mesh._baseX = pos[0];

    // Sprite HP
    const label  = p.pseudo || p.char.name;
    const sprite = makeHPSprite(label, p.hp, p.maxHP, colorHex);
    sprite.position.set(pos[0], 3.4, pos[2]);
    s3.add(sprite);
    hpSprites[p.slot] = sprite;
  });
}

function resetThreeChars() {
  buildChars();
}

function addParticleField(color) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(50*3);
  for (let i=0;i<50;i++) {
    pos[i*3]   = (Math.random()-0.5)*12;
    pos[i*3+1] = Math.random()*5;
    pos[i*3+2] = (Math.random()-0.5)*6-3;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  s3.add(new THREE.Points(geo, new THREE.PointsMaterial({color,size:0.06,transparent:true,opacity:0.5})));
}

function makeChar(col, isFireType) {
  const g    = new THREE.Group();
  const dark = isFireType ? 0xcc3300 : 0x0077cc;
  const mat  = new THREE.MeshStandardMaterial({color:col, roughness:0.4, metalness:0.3});
  const dmat = new THREE.MeshStandardMaterial({color:dark, roughness:0.4});

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7,0.9,0.5), mat);
  body.position.y=1.15; body.castShadow=true; g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32,16,16), mat);
  head.position.y=1.9; head.castShadow=true; g.add(head);

  [[-0.18],[0.18]].forEach(([x]) => {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.13,0.13,0.7,12), dmat);
    l.position.set(x,0.35,0); l.castShadow=true; g.add(l);
  });
  [[-0.48,0.4],[0.48,-0.4]].forEach(([x,rz]) => {
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.1,0.6,12), dmat);
    a.position.set(x,1.15,0); a.rotation.z=rz; g.add(a);
  });

  if (isFireType) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.12,8,8),
      new THREE.MeshStandardMaterial({color:0xffcc00,emissive:0xff8800,emissiveIntensity:0.5}));
    e.position.set(0,1.2,0.28); g.add(e);
  } else {
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.1,0.3,8),
      new THREE.MeshStandardMaterial({color:0x88ddff,emissive:0x0088ff,emissiveIntensity:0.4}));
    sp.position.set(0,2.28,0); g.add(sp);
  }

  const sh = new THREE.Mesh(new THREE.CircleGeometry(0.45,16),
    new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:0.25}));
  sh.rotation.x=-Math.PI/2; sh.position.y=0.03; g.add(sh);
  return g;
}

function spawnHitParticles(slot) {
  const mesh = meshes[slot];
  if (!mesh) return;
  const bx = mesh.position.x;
  const color = SLOT_COLORS_3D[slot] || 0xff2200;
  for (let i=0;i<12;i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.06+Math.random()*0.06, 6, 6),
      new THREE.MeshBasicMaterial({color})
    );
    m.position.set(bx+(Math.random()-0.5)*0.5, 1.2+(Math.random()-0.5)*0.6, (Math.random()-0.5)*0.4);
    m.userData = {vx:(Math.random()-0.5)*0.06, vy:0.04+Math.random()*0.04, vz:(Math.random()-0.5)*0.04, life:1};
    s3.add(m); hitParticles.push(m);
  }
}

/* ── Boucle d'animation ── */
function animate3() {
  requestAnimationFrame(animate3);
  t3 += 0.016;

  // Flottement de tous les personnages
  Object.entries(meshes).forEach(([slot, mesh]) => {
    const offset = parseInt(slot) * 0.8;
    mesh.position.y = Math.sin(t3*1.5 + offset)*0.04;

    // Suivi sprite HP
    const sprite = hpSprites[slot];
    if (sprite) {
      sprite.position.x = mesh.position.x;
      sprite.position.y = 3.4 + mesh.position.y;
    }
  });

  // Animation d'attaque (joueur principal)
  if (gs.myAnim) {
    const mesh = meshes[mySlot];
    if (mesh) {
      gs.myAnim.t += 0.05;
      const baseX = mesh._baseX || 0;
      mesh.position.x = gs.myAnim.t < 1 ? baseX + Math.sin(gs.myAnim.t*Math.PI)*0.8 : baseX;
      if (gs.myAnim.t >= 1) gs.myAnim = null;
    }
  }

  if (gs.theirAnim) {
    const slot = gs.theirAnim.slot;
    const mesh = meshes[slot];
    if (mesh) {
      gs.theirAnim.t += 0.05;
      const baseX = mesh._baseX || 0;
      mesh.position.x = gs.theirAnim.t < 1 ? baseX - Math.sin(gs.theirAnim.t*Math.PI)*0.8 : baseX;
      if (gs.theirAnim.t >= 1) gs.theirAnim = null;
    }
  }

  // Particules
  hitParticles = hitParticles.filter(p => {
    p.userData.life -= 0.04; p.userData.vy -= 0.002;
    p.position.x += p.userData.vx;
    p.position.y += p.userData.vy;
    p.position.z += p.userData.vz;
    p.material.opacity = p.userData.life;
    p.material.transparent = true;
    if (p.userData.life <= 0) { s3.remove(p); return false; }
    return true;
  });

  if (s3._pl1) s3._pl1.intensity = 1.3+Math.sin(t3*2.1)*0.3;
  if (s3._pl2) s3._pl2.intensity = 1.3+Math.sin(t3*1.7+1)*0.3;

  r3.render(s3, cam3);
}
