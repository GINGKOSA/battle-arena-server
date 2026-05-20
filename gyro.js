'use strict';
/* ═══════════════ GYROSCOPE ═══════════════
   Contrôle de la caméra par gyroscope.
   - Clamp des angles pour éviter les positions folles
   - Freeze automatique si téléphone à plat ou vertical extrême
   - Bouton reset pour revenir à la position de base
   - Demande permission iOS 13+
================================================ */

const GYRO = {
  enabled:   false,
  frozen:    false,      // freeze si position invalide
  baseAlpha: null,       // alpha de référence au moment de l'activation

  // Position de base de la caméra (copiée depuis initThree / buildChars)
  _basePos:    null,
  _baseLookAt: null,

  // Derniers angles valides (si freeze on garde ces valeurs)
  _lastBeta:  45,
  _lastGamma: 0,
  _lastAlpha: 0,

  // Limites d'angles acceptables
  BETA_MIN:  15,   // pas trop à plat (téléphone couché)
  BETA_MAX:  80,   // pas trop vertical (téléphone droit)
  GAMMA_MAX: 45,   // inclinaison latérale max
};

/* ── Sauvegarde la position de base de la caméra ── */
function gyroSaveBase() {
  if (!cam3) return;
  GYRO._basePos    = cam3.position.clone();
  GYRO._baseLookAt = new THREE.Vector3(0, 1.0, -1.0); // lookAt par défaut
}

/* ── Reset caméra à la position de base ── */
function gyroResetCam() {
  if (!cam3 || !GYRO._basePos) return;
  cam3.position.copy(GYRO._basePos);
  cam3.lookAt(GYRO._baseLookAt);
  cam3.updateMatrixWorld(true);
  GYRO.frozen    = false;
  GYRO.baseAlpha = null; // recalibrer au prochain mouvement
  showGyroStatus('🎯 Caméra réinitialisée');
}

/* ── Handler DeviceOrientation ── */
function _onOrientation(e) {
  if (!GYRO.enabled || !cam3) return;

  const alpha = e.alpha ?? 0;  // boussole 0-360
  const beta  = e.beta  ?? 45; // avant/arrière -180→180
  const gamma = e.gamma ?? 0;  // gauche/droite -90→90

  // ── Détection position invalide ──
  const absBeta  = Math.abs(beta);
  const absGamma = Math.abs(gamma);

  const tooFlat     = absBeta < GYRO.BETA_MIN;                    // téléphone à plat
  const tooVertical = absBeta > GYRO.BETA_MAX;                    // tenu très droit
  const tooTilted   = absGamma > GYRO.GAMMA_MAX;                  // trop incliné côté

  if (tooFlat || tooVertical || tooTilted) {
    if (!GYRO.frozen) {
      GYRO.frozen = true;
      let reason = tooFlat ? 'Téléphone à plat' : tooVertical ? 'Téléphone trop vertical' : 'Trop incliné';
      showGyroStatus(`⚠️ ${reason} — Cam gelée`);
    }
    // On garde les derniers angles valides → pas de mouvement caméra
    return;
  }

  // Position valide : dégeler si besoin
  if (GYRO.frozen) {
    GYRO.frozen = false;
    showGyroStatus('✅ Caméra active');
  }

  // ── Calibration alpha (référence au premier appel valide) ──
  if (GYRO.baseAlpha === null) GYRO.baseAlpha = alpha;
  const relAlpha = alpha - GYRO.baseAlpha; // relatif au point de départ

  // Sauvegarder les derniers angles valides
  GYRO._lastBeta  = beta;
  GYRO._lastGamma = gamma;
  GYRO._lastAlpha = relAlpha;

  // ── Application à la caméra ──
  // On ne translate pas, on fait juste pivoter la caméra autour
  // de sa position de base (effet "regarder autour")
  if (!GYRO._basePos) gyroSaveBase();

  const radius = GYRO._basePos.length();

  // Convertir en radians + petite sensibilité
  const pitchOffset = THREE.MathUtils.degToRad((beta - 45) * 0.3);   // avant/arrière
  const yawOffset   = THREE.MathUtils.degToRad(relAlpha   * 0.4);    // gauche/droite

  // Clamp pitch pour ne pas retourner la cam
  const pitchClamped = Math.max(-0.4, Math.min(0.6, pitchOffset));

  // Nouvelle position caméra (orbite autour du lookAt)
  const base = GYRO._basePos.clone();
  base.applyEuler(new THREE.Euler(pitchClamped, yawOffset, 0, 'YXZ'));
  cam3.position.copy(base);
  cam3.lookAt(GYRO._baseLookAt);
  cam3.updateMatrixWorld(true);
}

/* ── Activation / désactivation ── */
async function gyroToggle() {
  if (GYRO.enabled) {
    gyroDisable();
    return;
  }

  // iOS 13+ : demande de permission
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const perm = await DeviceOrientationEvent.requestPermission();
      if (perm !== 'granted') {
        showGyroStatus('❌ Permission refusée');
        return;
      }
    } catch {
      showGyroStatus('❌ Erreur permission');
      return;
    }
  }

  gyroSaveBase();
  window.addEventListener('deviceorientation', _onOrientation);
  GYRO.enabled = true;
  GYRO.frozen  = false;
  GYRO.baseAlpha = null;
  updateGyroBtn(true);
  showGyroStatus('📱 Gyroscope actif');
}

function gyroDisable() {
  window.removeEventListener('deviceorientation', _onOrientation);
  GYRO.enabled = false;
  GYRO.frozen  = false;
  gyroResetCam();
  updateGyroBtn(false);
  showGyroStatus('');
}

/* ── UI ── */
function updateGyroBtn(active) {
  const btn = document.getElementById('gyro-btn');
  if (!btn) return;
  btn.textContent = active ? '📱 Gyro ON' : '📱 Gyro';
  btn.style.borderColor = active ? 'var(--green)' : 'var(--border)';
  btn.style.color       = active ? 'var(--green)' : '';
}

function showGyroStatus(msg) {
  const el = document.getElementById('gyro-status');
  if (!el) return;
  el.textContent = msg;
  clearTimeout(el._t);
  if (msg) el._t = setTimeout(() => { el.textContent = ''; }, 2500);
}

/* ── Injection des boutons dans #top-screen ── */
function initGyroUI() {
  const screen = document.getElementById('top-screen');
  if (!screen || document.getElementById('gyro-btn')) return;

  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'position:absolute',
    'top:4px',
    'right:4px',
    'z-index:8',
    'display:flex',
    'gap:4px',
    'align-items:center',
  ].join(';');

  // Status text
  const status = document.createElement('span');
  status.id = 'gyro-status';
  status.style.cssText = 'font-size:9px;color:#fff;text-shadow:0 1px 3px #000;white-space:nowrap;';
  wrap.appendChild(status);

  // Bouton Gyro ON/OFF
  const gyroBtn = document.createElement('button');
  gyroBtn.id = 'gyro-btn';
  gyroBtn.textContent = '📱 Gyro';
  gyroBtn.style.cssText = _btnStyle();
  gyroBtn.onclick = gyroToggle;
  wrap.appendChild(gyroBtn);

  // Bouton Reset cam
  const resetBtn = document.createElement('button');
  resetBtn.id = 'reset-cam-btn';
  resetBtn.textContent = '🎯 Reset';
  resetBtn.style.cssText = _btnStyle();
  resetBtn.onclick = gyroResetCam;
  wrap.appendChild(resetBtn);

  screen.appendChild(wrap);
}

function _btnStyle() {
  return [
    'padding:2px 6px',
    'background:rgba(0,0,0,0.55)',
    'border:1px solid var(--border)',
    'border-radius:5px',
    'color:#fff',
    'font-family:\'Exo 2\',sans-serif',
    'font-size:9px',
    'font-weight:600',
    'cursor:pointer',
    'backdrop-filter:blur(4px)',
  ].join(';');
}
