'use strict';
/* ═══════════════ THREE.JS ═══════════════ */
let r3=null, s3, cam3;
let meshes={}, hpSprites={}, hitParticles=[], t3=0;
let _animQueue=[];

/* ── HP Canvas (mis en cache) ── */
function makeHPCanvas(name, hp, maxHP, color) {
  const W=384, H=100, c=document.createElement('canvas');
  c.width=W; c.height=H;
  const ctx=c.getContext('2d');

  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='rgba(8,8,20,0.82)';
  rrect(ctx,3,3,W-6,H-6,12); ctx.fill();
  ctx.strokeStyle=color+'55'; ctx.lineWidth=2;
  rrect(ctx,3,3,W-6,H-6,12); ctx.stroke();

  ctx.fillStyle=color; ctx.font='bold 26px sans-serif'; ctx.textAlign='center';
  ctx.shadowColor=color; ctx.shadowBlur=7;
  ctx.fillText(name.slice(0,14),W/2,34); ctx.shadowBlur=0;

  ctx.fillStyle='rgba(255,255,255,0.08)';
  rrect(ctx,14,50,W-28,22,6); ctx.fill();
  const pct=Math.max(0,hp)/maxHP;
  const bc=pct>.5?'#1D9E75':pct>.25?'#EF9F27':'#E24B4A';
  ctx.fillStyle=bc; ctx.shadowColor=bc; ctx.shadowBlur=5;
  rrect(ctx,14,50,Math.max(0,(W-28)*pct),22,6); ctx.fill(); ctx.shadowBlur=0;

  ctx.fillStyle='rgba(230,230,255,.95)'; ctx.font='bold 19px sans-serif';
  ctx.fillText(`${Math.max(0,hp)} / ${maxHP}`,W/2,90);
  return c;
}

const rrect = (ctx,x,y,w,h,r) => {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
};

function makeSprite(name,hp,maxHP,color) {
  const tex=new THREE.CanvasTexture(makeHPCanvas(name,hp,maxHP,color));
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));
  sp.scale.set(2.5,.87,1);
  sp._n=name; sp._max=maxHP; sp._c=color; sp._hp=hp;
  return sp;
}

function updateSprite(sp, hp, name) {
  if (!sp) return;
  const n=name||sp._n;
  if (sp._hp===hp && sp._n===n) return;
  sp._hp=hp; sp._n=n;
  sp.material.map.image=makeHPCanvas(n,hp,sp._max,sp._c);
  sp.material.map.needsUpdate=true;
}

function updateAllSprites() {
  G.players.forEach(p=>{
    const sp=hpSprites[p.slot];
    if (sp) updateSprite(sp,p.hp,p.pseudo);
  });
}

/* ── Init ── */
function initThree() {
  const canvas=document.getElementById('battle-canvas');
  const cont=document.getElementById('canvas-container');

  r3=new THREE.WebGLRenderer({canvas,antialias:true});
  r3.setPixelRatio(Math.min(devicePixelRatio,2));
  r3.shadowMap.enabled=true; r3.shadowMap.type=THREE.PCFSoftShadowMap;
  r3.setClearColor(0x0d0d1a,1);

  s3=new THREE.Scene(); s3.fog=new THREE.Fog(0x0d0d1a,12,32);
  cam3=new THREE.PerspectiveCamera(55,2,.1,100);
  cam3.position.set(0,2.8,8); cam3.lookAt(0,1,0);

  const onResize=()=>{ const w=cont.clientWidth,h=cont.clientHeight; r3.setSize(w,h,false); cam3.aspect=w/h; cam3.updateProjectionMatrix(); };
  onResize(); window.addEventListener('resize',onResize);

  s3.add(new THREE.AmbientLight(0x8888cc,.6));
  const dl=new THREE.DirectionalLight(0xffffff,1.2); dl.position.set(5,8,5); dl.castShadow=true; s3.add(dl);
  const pl1=new THREE.PointLight(0xff6600,1.4,10); pl1.position.set(-4,2,2); s3.add(pl1);
  const pl2=new THREE.PointLight(0x00aaff,1.4,10); pl2.position.set(4,2,2);  s3.add(pl2);
  s3._pl1=pl1; s3._pl2=pl2;

  // Sol
  const fl=new THREE.Mesh(new THREE.PlaneGeometry(20,20,8,8),new THREE.MeshStandardMaterial({color:0x12122a,roughness:.8}));
  fl.rotation.x=-Math.PI/2; fl.receiveShadow=true; s3.add(fl);
  s3.add(new THREE.GridHelper(20,20,0x2a2a6a,0x1a1a44));
  const arena=new THREE.Mesh(new THREE.CircleGeometry(4,64),new THREE.MeshStandardMaterial({color:0x1a1a3a,roughness:.5}));
  arena.rotation.x=-Math.PI/2; arena.position.y=.02; s3.add(arena);

  addPFX(0xff6600); addPFX(0x00aaff);
  buildChars();
  animate3();
}

function addPFX(color) {
  const geo=new THREE.BufferGeometry();
  const pos=new Float32Array(50*3);
  for(let i=0;i<50;i++){pos[i*3]=(Math.random()-.5)*14;pos[i*3+1]=Math.random()*5;pos[i*3+2]=(Math.random()-.5)*7-3;}
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  s3.add(new THREE.Points(geo,new THREE.PointsMaterial({color,size:.06,transparent:true,opacity:.5})));
}

function buildChars() {
  Object.values(meshes).forEach(m=>s3.remove(m));
  Object.values(hpSprites).forEach(sp=>s3.remove(sp));
  meshes={}; hpSprites={};

  const n=G.players.length;
  const pos=POS[n]||POS[2];

  G.players.forEach((p,i)=>{
    const [x,,z]=pos[i]||[0,0,0];
    const col=SLOT_CLR_3D[p.slot]||0xffffff;
    const mesh=makeChar(col,p.char.name==='Pyros');
    mesh.position.set(x,0,z||0);
    mesh.rotation.y=i<Math.ceil(n/2)?0.4:Math.PI-.4;
    mesh._bx=x;
    s3.add(mesh); meshes[p.slot]=mesh;

    const sp=makeSprite(p.pseudo,p.hp,p.maxHP,SLOT_CLR[p.slot]||'#fff');
    sp.position.set(x,3.3,z||0); s3.add(sp); hpSprites[p.slot]=sp;
  });
}

function resetThreeChars() { buildChars(); }

function makeChar(col,fire) {
  const g=new THREE.Group();
  const dk=fire?0xcc3300:0x0077cc;
  const m=new THREE.MeshStandardMaterial({color:col,roughness:.4,metalness:.3});
  const dm=new THREE.MeshStandardMaterial({color:dk,roughness:.4});

  const body=new THREE.Mesh(new THREE.BoxGeometry(.7,.9,.5),m); body.position.y=1.15; body.castShadow=true; g.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.32,16,16),m); head.position.y=1.9; head.castShadow=true; g.add(head);

  [-.18,.18].forEach(x=>{
    const l=new THREE.Mesh(new THREE.CylinderGeometry(.13,.13,.7,12),dm);
    l.position.set(x,.35,0); l.castShadow=true; g.add(l);
  });
  [[-.48,.4],[.48,-.4]].forEach(([x,rz])=>{
    const a=new THREE.Mesh(new THREE.CylinderGeometry(.1,.1,.6,12),dm);
    a.position.set(x,1.15,0); a.rotation.z=rz; g.add(a);
  });

  const emb=fire
    ? new THREE.Mesh(new THREE.SphereGeometry(.12,8,8),new THREE.MeshStandardMaterial({color:0xffcc00,emissive:0xff8800,emissiveIntensity:.5}))
    : new THREE.Mesh(new THREE.ConeGeometry(.1,.3,8),new THREE.MeshStandardMaterial({color:0x88ddff,emissive:0x0088ff,emissiveIntensity:.4}));
  emb.position.set(0,fire?1.2:2.28,fire?.28:0); g.add(emb);

  const sh=new THREE.Mesh(new THREE.CircleGeometry(.45,16),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.25}));
  sh.rotation.x=-Math.PI/2; sh.position.y=.03; g.add(sh);
  return g;
}

function spawnHitParticles(slot) {
  const mesh=meshes[slot]; if(!mesh) return;
  const color=SLOT_CLR_3D[slot]||0xff2200;
  for(let i=0;i<12;i++){
    const m=new THREE.Mesh(new THREE.SphereGeometry(.06+Math.random()*.06,6,6),new THREE.MeshBasicMaterial({color}));
    m.position.set(mesh.position.x+(Math.random()-.5)*.5,1.2+(Math.random()-.5)*.6,(Math.random()-.5)*.4);
    m.userData={vx:(Math.random()-.5)*.06,vy:.04+Math.random()*.04,vz:(Math.random()-.5)*.04,life:1};
    s3.add(m); hitParticles.push(m);
  }
}

/* ── Boucle ── */
function animate3() {
  requestAnimationFrame(animate3);
  t3+=.016;

  Object.entries(meshes).forEach(([s,m])=>{
    m.position.y=Math.sin(t3*1.5+(+s)*.8)*.04;
    const sp=hpSprites[s];
    if(sp){ sp.position.x=m.position.x; sp.position.y=3.3+m.position.y; }
  });

  hitParticles=hitParticles.filter(p=>{
    p.userData.life-=.04; p.userData.vy-=.002;
    p.position.x+=p.userData.vx; p.position.y+=p.userData.vy; p.position.z+=p.userData.vz;
    p.material.opacity=p.userData.life; p.material.transparent=true;
    if(p.userData.life<=0){s3.remove(p);return false;} return true;
  });

  if(s3._pl1) s3._pl1.intensity=1.3+Math.sin(t3*2.1)*.3;
  if(s3._pl2) s3._pl2.intensity=1.3+Math.sin(t3*1.7+1)*.3;

  r3.render(s3,cam3);
}
