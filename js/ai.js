'use strict';
/* ═══════════════════════════════════════════════════
   AI.JS — Intelligence artificielle locale
   ═══════════════════════════════════════════════════
   L'IA simule un joueur supplémentaire entièrement
   côté client. Pas de WebRTC — elle s'insère dans
   le même flux que les joueurs humains.

   UTILISATION :
   - Depuis l'écran de login : bouton "⚔️ vs IA"
   - L'IA choisit son perso automatiquement
   - Elle prend ses décisions avec un délai simulé
   - Niveau réglable : FACILE / NORMAL / DIFFICILE
   ═══════════════════════════════════════════════════ */

const AI = {
  slot:  1,          // slot fixe de l'IA
  level: 'normal',   // 'easy' | 'normal' | 'hard'
  _timer: null,
};

/* ══════════════════════════════════════
   DÉMARRAGE D'UNE PARTIE VS IA
══════════════════════════════════════ */
function startVsAI(count, mode) {
  count = count || 2;
  mode  = mode  || '1v1';

  const p = prompt('Ton pseudo :')?.trim().slice(0, 20);
  if (!p) return;

  G.myPseudo  = p;
  G.isHost    = true;
  G.mySlot    = 0;
  G.roomId    = 'CPU' + count;
  G.mode       = mode;
  G.teamHPMode = 'individual'; // réinitialisé — le lobby permettra de choisir
  G.phase      = 'lobby';
  G.aiEnabled  = true;

  // Slot 0 = joueur, slots 1..n-1 = bots
  // En 2v2 : slots 0+1 équipe A, slots 2+3 équipe B
  G.lobbyPlayers = [{ slot: 0, pseudo: p, avatar: null, ready: false }];
  for (let i = 1; i < count; i++) {
    G.lobbyPlayers.push({
      slot:  i,
      pseudo: aiName(),
      avatar: null,
      ready: false,
      isAI:  true,
    });
  }

  showScreen('game');
  // Petit délai pour s'assurer que combat.js est bien initialisé
  setTimeout(function() { renderLobby(); }, 50);
}

function aiName() {
  const names = ['CPU', 'R.O.B', 'NOVA', 'KIRA', 'BYTE', 'ZETA'];
  return names[Math.floor(Math.random() * names.length)];
}

/* ══════════════════════════════════════
   HOOK — L'IA marque "prêt" automatiquement
   et choisit son personnage
══════════════════════════════════════ */

// checkAllReady est géré dans combat.js via G.aiEnabled

// L'IA choisit son perso automatiquement après un délai
const _origRenderCharCards = typeof renderCharCards === 'function' ? renderCharCards : null;
function renderCharCards() {
  // Appeler l'original
  var cards = document.getElementById('char-cards');
  cards.innerHTML = '';
  Object.values(CHARS).forEach(function(c) {
    var d = document.createElement('div');
    d.className    = 'char-card';
    d.dataset.char = c.name;
    d.innerHTML =
      '<div class="char-card-icon">' + c.icon + '</div>' +
      '<div class="char-card-name">' + c.name + '</div>' +
      '<div class="char-card-stats">PV : ' + c.maxHP +
        '<div style="display:flex;align-items:center;gap:6px;margin-top:4px">' +
          '<span style="width:50px;font-size:10px">Vitesse</span>' +
          '<div class="char-card-stat-bar" style="flex:1">' +
            '<div class="char-card-stat-fill" style="width:' + c.speed + '%;background:' + c.colorHex + '"></div>' +
          '</div>' +
        '</div>' +
        c.moves.filter(m => !m.heal).map(m => m.icon + ' ' + m.name + ' ' + m.desc).join('<br>') +
      '</div>';
    d.onclick = (function(name){ return function(){ pickChar(name); }; })(c.name);
    cards.appendChild(d);
  });

  // L'IA choisit son perso après un court délai
  if (G.aiEnabled) {
    // Tous les bots choisissent leur perso avec un délai décalé
    G.lobbyPlayers.filter(p => p.isAI).forEach((bot, i) => {
      setTimeout(() => aiPickCharForSlot(bot.slot), 600 + i * 400 + Math.random() * 400);
    });
  }
}

function aiPickCharForSlot(slot) {
  const charNames = Object.keys(CHARS);
  let chosen;
  if (AI.level === 'hard' && charChoices[G.mySlot]) {
    chosen = charChoices[G.mySlot] === 'Pyros' ? 'Glacius' : 'Pyros';
  } else {
    chosen = charNames[Math.floor(Math.random() * charNames.length)];
  }
  charChoices[slot] = chosen;
  _refreshCharStatus();
  _checkAllChosen();
}

/* ══════════════════════════════════════
   HOOK — L'IA joue son tour
   Appelé après chaque renderActionPanel()
══════════════════════════════════════ */

// On surcharge renderActionPanel pour déclencher l'IA
const _origRenderActionPanel = typeof renderActionPanel === 'function' ? renderActionPanel : null;
function renderActionPanel() {
  // Appel original (logique copiée depuis combat.js)
  var me = G.players.find(p => p.slot === G.mySlot);
  if (!me) return;

  if (!me.alive) {
    var grid = document.getElementById('actions-grid');
    grid.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px">💀 Tu as été éliminé.</div>';
    document.getElementById('waiting-action').style.display = 'none';
    document.getElementById('target-picker').style.display  = 'none';
  } else {
    var grid = document.getElementById('actions-grid');
    grid.innerHTML = '';
    me.char.moves.forEach(function(m) {
      var btn = document.createElement('button');
      btn.className = 'action-btn';
      btn.innerHTML = m.icon + ' ' + m.name + ' <span class="dmg">' + m.desc + '</span>';
      btn.onclick = (function(move){ return function(){ pickAction(move); }; })(m);
      grid.appendChild(btn);
    });
    document.getElementById('waiting-action').style.display = 'none';
    document.getElementById('target-picker').style.display  = 'none';
    document.querySelectorAll('#actions-grid .action-btn').forEach(b => b.disabled = false);
  }

  // Déclencher le tour de l'IA
  if (G.aiEnabled) {
    clearTimeout(AI._timer);
    AI._timer = setTimeout(() => aiPlayTurn(), aiDelay());
  }
}

/* ══════════════════════════════════════
   DÉCISION DE L'IA
══════════════════════════════════════ */
function aiDelay() {
  // Temps de "réflexion" selon le niveau
  switch (AI.level) {
    case 'easy':   return 2000 + Math.random() * 2000;
    case 'hard':   return 400  + Math.random() * 400;
    default:       return 900  + Math.random() * 900;
  }
}

function aiPlayTurn() {
  if (G.phase !== 'fight') return;

  // Jouer pour tous les bots qui n'ont pas encore choisi
  const bots = G.players.filter(p =>
    p.alive && G.lobbyPlayers.find(lp => lp.slot === p.slot && lp.isAI) &&
    G.choices[p.slot] === undefined
  );

  bots.forEach((me, i) => {
    // Délai décalé pour que les bots ne jouent pas tous en même temps
    setTimeout(() => {
      if (G.phase !== 'fight') return;
      if (G.choices[me.slot] !== undefined) return;

      const alive  = G.players.filter(p => p.alive);
      const move   = aiChooseMove(me, alive);
      const target = aiChooseTarget(me, alive, move);
      if (!target) return;

      G.choices[me.slot] = { move, targetSlot: target.slot };
      tryResolve();
    }, i * 200); // décalage entre chaque bot
  });
}

function aiChooseMove(me, alive) {
  const moves = me.char.moves;

  switch (AI.level) {

    case 'easy':
      // Aléatoire complet
      return moves[Math.floor(Math.random() * moves.length)];

    case 'hard': {
      // Stratégique :
      // - Se soigner si HP < 40%
      // - Utiliser le gros coup si l'ennemi est faible
      // - Attaque sûre sinon
      const pct    = me.hp / me.maxHP;
      const heal   = moves.find(m => m.heal);
      const big    = moves.reduce((a, b) => (!b.heal && b.dmg > (a.dmg||0)) ? b : a, {});
      const safe   = moves.filter(m => !m.heal && m.acc >= 0.9)
                          .reduce((a, b) => b.dmg > (a.dmg||0) ? b : a, moves[0]);

      if (heal && pct < 0.35) return heal;

      const target = alive.find(p => p.slot !== me.slot);
      if (target && target.hp <= big.dmg) return big; // kill shot
      if (pct < 0.5 && heal) return heal;             // soigner si en danger

      return safe;
    }

    default: { // normal
      // Semi-stratégique : se soigner si < 30%, sinon move avec meilleur ratio dmg*acc
      const pct  = me.hp / me.maxHP;
      const heal = moves.find(m => m.heal);
      if (heal && pct < 0.30) return heal;

      // Meilleur ratio dégâts * précision
      return moves
        .filter(m => !m.heal)
        .reduce((best, m) => {
          const score = m.dmg * m.acc;
          return score > (best.dmg * best.acc) ? m : best;
        }, moves.find(m => !m.heal) || moves[0]);
    }
  }
}

function aiChooseTarget(me, alive, move) {
  if (move.heal) return me; // soin = se soigner soi-même

  const enemies = alive.filter(p => p.slot !== me.slot);
  if (!enemies.length) return null;

  switch (AI.level) {
    case 'easy':
      // Cible aléatoire
      return enemies[Math.floor(Math.random() * enemies.length)];

    case 'hard':
      // Cible le joueur humain avec le moins de HP (finish him)
      return enemies.reduce((a, b) => b.hp < a.hp ? b : a);

    default:
      // Cible le joueur humain (slot 0 = le vrai joueur)
      return enemies.find(p => p.slot === G.mySlot) || enemies[0];
  }
}

/* ══════════════════════════════════════
   UI — Les boutons sont dans index.html
══════════════════════════════════════ */

function aiSelectCount(btn) {
  document.querySelectorAll('.ai-count-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const count = +btn.dataset.count;
  const modeRow = document.getElementById('ai-mode-row');
  if (modeRow) modeRow.style.display = count === 4 ? 'flex' : 'none';
  // Pour 3 joueurs, forcer FFA
  if (count === 3) {
    document.querySelectorAll('.ai-mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === 'ffa');
    });
  }
}

function aiSelectMode(btn) {
  document.querySelectorAll('.ai-mode-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}



function launchVsAI() {
  AI.level = document.getElementById('ai-level')?.value || 'normal';

  const countBtn  = document.querySelector('.ai-count-btn.active');
  const count     = countBtn ? +countBtn.dataset.count : 2;

  const modeBtn   = document.querySelector('.ai-mode-btn.active');
  const mode      = count === 2 ? '1v1' : count === 3 ? 'ffa' : (modeBtn?.dataset.mode || 'ffa');

  startVsAI(count, mode);
}


/* Fonctions lobby IA — définies dans index.html */
