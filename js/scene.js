/* ═══════════════ THREE.JS SCENE ═══════════════ */
let r3 = null, s3, cam3;
let playerMesh, enemyMesh;
let playerHPSprite = null, enemyHPSprite = null;
let hitParticles = [];
let t3 = 0;

/* ── HP Sprites ── */
function makeHPCanvas(name, hp, maxHP, color) {
  const W = 256, H = 80;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(10,10,26,0.75)';
  roundRect(ctx, 4, 4, W-8, H-8, 10); ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  roundRect(ctx, 14, 44, W-28, 18, 6); ctx.fill();

  const pct = Math.max(0, hp) / maxHP;
  ctx.fillStyle = pct > 0.5 ? '#1D9E75' : pct > 0.25 ? '#EF9F27' : '#E24B4A';
  roundRect(ctx, 14, 44, Math.max(0, (W-28) * pct), 18, 6); ctx.fill();

  ctx.fillStyle = color;
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(name, W/2, 34);

  ctx.fillStyle = 'rgba(230,230,255,0.9)';
  ctx.font = '13px sans-serif';
  ctx.fillText(`${Math.max(0,hp)} / ${maxHP}`, W/2, 76);

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
  sprite.scale.set(1.8, 0.56, 1);
  sprite._name = name; sprite._maxHP = maxHP; sprite._color = color;
  return sprite;
}

function updateHPSprite(sprite, hp) {
  if (!sprite) return;
  const canvas = makeHPCanvas(sprite._name, hp, sprite._maxHP, sprite._color);
  sprite.material.map.image = canvas;
  sprite.material.map.needsUpdate = true;
}

function updateHPSprites() {
  updateHPSprite(playerHPSprite, gs.myHP);
  updateHPSprite(enemyHPSprite,  gs.theirHP);
}

/* ── Init scène ── */
function initThree() {
  const canvas = document.getElementById('battle-canvas');
  const cont   = document.getElementById('canvas-container');

  r3 = new THREE.WebGLRenderer({ canvas, antialias: true });
  r3.setPixelRatio(window.devicePixelRatio);
  r3.shadowMap.enabled = true;
  r3.setClearColor(0x0d0d1a, 1);

  s3 = new THREE.Scene();
  s3.fog = new THREE.Fog(0x0d0d1a, 10, 30);

  cam3 = new THREE.PerspectiveCamera(55, 2, 0.1, 100);
  cam3.position.set(0, 2.5, 7);
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
  const pl1 = new THREE.PointLight(0xff6600, 1.5, 8); pl1.position.set(-3,2,2); s3.add(pl1);
  const pl2 = new THREE.PointLight(0x00aaff, 1.5, 8); pl2.position.set(3,2,2);  s3.add(pl2);
  s3._pl1 = pl1; s3._pl2 = pl2;

  // Sol et arène
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(16,16,8,8),
    new THREE.MeshStandardMaterial({color:0x12122a, roughness:0.8})
  );
  floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; s3.add(floor);
  s3.add(new THREE.GridHelper(16,16,0x2a2a6a,0x1a1a44));
  const arena = new THREE.Mesh(
    new THREE.CircleGeometry(3,64),
    new THREE.MeshStandardMaterial({color:0x1a1a3a, roughness:0.5})
  );
  arena.rotation.x = -Math.PI/2; arena.position.y = 0.02; s3.add(arena);

  addParticleField(0xff6600);
  addParticleField(0x00aaff);

  buildChars();
  animate3();
}

function buildChars() {
  if (playerMesh)     { s3.remove(playerMesh); }
  if (enemyMesh)      { s3.remove(enemyMesh); }
  if (playerHPSprite) { s3.remove(playerHPSprite); }
  if (enemyHPSprite)  { s3.remove(enemyHPSprite); }

  playerMesh = makeChar(myChar.color3D,    myChar.name === 'Pyros');
  playerMesh.position.set(-2.2, 0, 0); playerMesh.rotation.y = 0.3;
  s3.add(playerMesh);

  enemyMesh = makeChar(theirChar.color3D, theirChar.name === 'Pyros');
  enemyMesh.position.set(2.2, 0, 0); enemyMesh.rotation.y = Math.PI - 0.3;
  s3.add(enemyMesh);

  // Utilise le pseudo du joueur, pas le nom du perso
  const myLabel    = myPseudo    || myChar.name;
  const theirLabel = theirPseudo || theirChar.name;

  playerHPSprite = makeHPSprite(myLabel, gs.myHP, gs.myMaxHP, myChar.colorHex);
  playerHPSprite.position.set(-2.2, 3.0, 0);
  s3.add(playerHPSprite);

  enemyHPSprite = makeHPSprite(theirLabel, gs.theirHP, gs.theirMaxHP, theirChar.colorHex);
  enemyHPSprite.position.set(2.2, 3.0, 0);
  s3.add(enemyHPSprite);
}

// Met à jour le sprite de l'adversaire si son pseudo arrive après
function updateTheirSprite() {
  if (!enemyHPSprite) return;
  enemyHPSprite._name = theirPseudo;
  updateHPSprite(enemyHPSprite, gs.theirHP);
}

function resetThreeChars() {
  buildChars();
}

function addParticleField(color) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(40*3);
  for (let i=0;i<40;i++) {
    pos[i*3]   = (Math.random()-0.5)*8;
    pos[i*3+1] = Math.random()*4;
    pos[i*3+2] = (Math.random()-0.5)*4-2;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  s3.add(new THREE.Points(geo, new THREE.PointsMaterial({color, size:0.06, transparent:true, opacity:0.6})));
}

function makeChar(col, isFireType) {
  const g    = new THREE.Group();
  const dark = isFireType ? 0xcc3300 : 0x0077cc;
  const mat  = new THREE.MeshStandardMaterial({color:col, roughness:0.4, metalness:0.3});
  const dmat = new THREE.MeshStandardMaterial({color:dark, roughness:0.4});

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7,0.9,0.5), mat);
  body.position.y = 1.15; body.castShadow = true; g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32,16,16), mat);
  head.position.y = 1.9; head.castShadow = true; g.add(head);

  [[-0.18],[0.18]].forEach(([x]) => {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.13,0.13,0.7,12), dmat);
    l.position.set(x,0.35,0); l.castShadow = true; g.add(l);
  });
  [[-0.48,0.4],[0.48,-0.4]].forEach(([x,rz]) => {
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.1,0.6,12), dmat);
    a.position.set(x,1.15,0); a.rotation.z = rz; g.add(a);
  });

  if (isFireType) {
    const e = new THREE.Mesh(
      new THREE.SphereGeometry(0.12,8,8),
      new THREE.MeshStandardMaterial({color:0xffcc00, emissive:0xff8800, emissiveIntensity:0.5})
    );
    e.position.set(0,1.2,0.28); g.add(e);
  } else {
    const sp = new THREE.Mesh(
      new THREE.ConeGeometry(0.1,0.3,8),
      new THREE.MeshStandardMaterial({color:0x88ddff, emissive:0x0088ff, emissiveIntensity:0.4})
    );
    sp.position.set(0,2.28,0); g.add(sp);
  }

  const sh = new THREE.Mesh(
    new THREE.CircleGeometry(0.45,16),
    new THREE.MeshBasicMaterial({color:0x000000, transparent:true, opacity:0.25})
  );
  sh.rotation.x = -Math.PI/2; sh.position.y = 0.03; g.add(sh);
  return g;
}

function spawnHitParticles(who) {
  const isMine = who === 'mine';
  const bx     = isMine ? -2.2 : 2.2;
  const color  = isMine ? 0xff2200 : 0x00aaff;
  for (let i=0;i<14;i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.06+Math.random()*0.06, 6, 6),
      new THREE.MeshBasicMaterial({color})
    );
    m.position.set(bx+(Math.random()-0.5)*0.5, 1.2+(Math.random()-0.5)*0.6, (Math.random()-0.5)*0.4);
    m.userData = {
      vx:(Math.random()-0.5)*0.06,
      vy:0.04+Math.random()*0.04,
      vz:(Math.random()-0.5)*0.04,
      life:1
    };
    s3.add(m); hitParticles.push(m);
  }
}

/* ── Boucle d'animation ── */
function animate3() {
  requestAnimationFrame(animate3);
  t3 += 0.016;

  if (playerMesh) playerMesh.position.y = Math.sin(t3*1.5)*0.04;
  if (enemyMesh)  enemyMesh.position.y  = Math.sin(t3*1.5+Math.PI)*0.04;

  if (playerHPSprite && playerMesh) playerHPSprite.position.x = playerMesh.position.x;
  if (enemyHPSprite  && enemyMesh)  enemyHPSprite.position.x  = enemyMesh.position.x;

  if (gs.myAnim && playerMesh) {
    gs.myAnim.t += 0.05;
    playerMesh.position.x = gs.myAnim.t < 1 ? -2.2+Math.sin(gs.myAnim.t*Math.PI)*1.2 : -2.2;
    if (gs.myAnim.t >= 1) gs.myAnim = null;
  }
  if (gs.theirAnim && enemyMesh) {
    gs.theirAnim.t += 0.05;
    enemyMesh.position.x = gs.theirAnim.t < 1 ? 2.2-Math.sin(gs.theirAnim.t*Math.PI)*1.2 : 2.2;
    if (gs.theirAnim.t >= 1) gs.theirAnim = null;
  }

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

  if (s3._pl1) s3._pl1.intensity = 1.3 + Math.sin(t3*2.1)*0.3;
  if (s3._pl2) s3._pl2.intensity = 1.3 + Math.sin(t3*1.7+1)*0.3;

  r3.render(s3, cam3);
}
