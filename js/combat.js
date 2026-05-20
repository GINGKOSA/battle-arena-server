'use strict';
/* ═══════════════════════════════════════════════════
   COMBAT.JS — Lobby in-game · Char select · Combat
   ═══════════════════════════════════════════════════ */

/* ══════════════════════════════════════════
   LOBBY IN-GAME
   ══════════════════════════════════════════ */

function renderLobby() {
  document.getElementById('game-lobby').style.display  = 'flex';
  document.getElementById('char-select').style.display = 'none';
  document.getElementById('battle-area').style.display = 'none';
  document.getElementById('lobby-room-code').textContent = G.roomId;
  document.getElementById('lobby-mode-section').style.display = G.isHost ? 'flex' : 'none';
  // Synchroniser le select PV avec G.teamHPMode
  var sel = document.getElementById('teamhp-select');
  if (sel) sel.value = G.teamHPMode || 'individual';
  renderModeButtons();
  renderLobbyPlayers();
  renderReadyBtn();
}

function renderModeButtons() {
  var n     = G.lobbyPlayers.length;
  var modes = MODES_BY_COUNT[n] || MODES_BY_COUNT[2];
  var cont  = document.getElementById('lobby-modes');
  cont.innerHTML = '';
  modes.forEach(function(m) {
    var btn = document.createElement('button');
    btn.className = 'mode-pill' + (G.mode === m.id ? ' active' : '');
    btn.textContent = m.icon + ' ' + m.label;
    btn.onclick = (function(modeId) {
      return function() {
        G.mode = modeId;
        document.getElementById('lobby-2v2-opts').style.display = modeId === '2v2' ? 'flex' : 'none';
        renderModeButtons();
        broadcast({ type: 'lobby_state', mode: G.mode, teamHPMode: G.teamHPMode, players: G.lobbyPlayers });
        // Mettre à jour le lobby public si connecté Discord
        if (G.myToken && typeof api === 'function') {
          const slots = G.lobbyPlayers.length || 4;
          api('/lobby/update', 'POST', { mode: modeId, maxSlots: slots }).catch(()=>{});
        }
      };
    })(m.id);
    cont.appendChild(btn);
  });
  document.getElementById('lobby-2v2-opts').style.display = G.mode === '2v2' ? 'flex' : 'none';
}

function renderLobbyPlayers() {
  var list = document.getElementById('lobby-player-list');
  list.innerHTML = '';
  G.lobbyPlayers.forEach(function(p) {
    var row = document.createElement('div');
    row.className = 'lobby-player-row';
    row.style.borderLeftColor = SLOT_CLR[p.slot] || 'var(--border)';
    row.innerHTML =
      '<div class="lp-avatar" style="background:' + (SLOT_CLR[p.slot] || '#333') + '">' +
        (p.avatar ? '<img src="' + p.avatar + '" onerror="this.style.display=\'none\'"/>' : '') +
        '<span>' + p.pseudo.charAt(0).toUpperCase() + '</span>' +
      '</div>' +
      '<div class="lp-info">' +
        '<span class="lp-name">' + p.pseudo + '</span>' +
        (p.slot === 0 ? '<span class="lp-host">Hôte</span>' : '') +
      '</div>' +
      '<div class="lp-ready ' + (p.ready ? 'yes' : 'no') + '">' + (p.ready ? '✅ Prêt' : '⏳ …') + '</div>';
    list.appendChild(row);
  });
  var n = G.lobbyPlayers.length;
  document.getElementById('lobby-count').textContent = n + ' joueur' + (n > 1 ? 's' : '');
}

function renderReadyBtn() {
  var me  = G.lobbyPlayers.find(function(p){ return p.slot === G.mySlot; });
  var btn = document.getElementById('ready-btn');
  if (!me || !btn) return;
  btn.textContent = me.ready ? '⏳ En attente…' : '✅ Je suis prêt !';
  btn.disabled    = !!me.ready;
}

function setReady() {
  var me = G.lobbyPlayers.find(function(p){ return p.slot === G.mySlot; });
  if (!me || me.ready) return;
  me.ready = true;
  send({ type: 'player_ready', slot: G.mySlot });
  renderLobbyPlayers();
  renderReadyBtn();
  checkAllReady();
}

function checkAllReady() {
  if (G.lobbyPlayers.length < 2) return;
  // Mode IA : marquer les bots non-prêts avec délai
  if (G.aiEnabled) {
    var notReady = G.lobbyPlayers.filter(function(p){ return p.isAI && !p.ready; });
    if (notReady.length) {
      notReady.forEach(function(bot, i) {
        setTimeout(function() {
          bot.ready = true;
          renderLobbyPlayers();
          if (G.lobbyPlayers.every(function(p){ return p.ready; })) startCharSelect();
        }, 500 + i * 300 + Math.random() * 300);
      });
      return;
    }
  }
  if (G.lobbyPlayers.every(function(p){ return p.ready; })) startCharSelect();
}

/* ══════════════════════════════════════════
   ROUTEUR DE MESSAGES
   ══════════════════════════════════════════ */
function onMessage(msg) {
  switch (msg.type) {
    case 'hello':
    case 'lobby_state':
    case 'player_ready':
      handleLobbyMessage(msg);
      break;
    case 'chat':
      addChatMsg(msg.text, false, msg.slot);
      break;
    case 'char_choice':
      onCharChoice(msg);
      break;
    case 'begin_fight':
      if (!G.isHost) {
        /* FIX: charChoices reçus en JSON ont des clés string,
           on normalise en number pour que charChoices[lp.slot] fonctionne */
        Object.entries(msg.choices).forEach(function(e) {
          charChoices[+e[0]] = e[1];
        });
        /* FIX: synchroniser le mode et teamHPMode depuis l'hôte avant beginFight
           pour éviter tout décalage de ciblage (coéquipier attaquable) */
        if (msg.mode)       G.mode       = msg.mode;
        if (msg.teamHPMode) G.teamHPMode = msg.teamHPMode;
        beginFight();
      }
      break;
    case 'action':
      onAction(msg);
      break;
    case 'round_result':
      onRoundResult(msg);
      break;
    case 'game_over':
      /* L'hôte a décidé — tout le monde affiche le même résultat */
      showGameOver(msg.outcome);
      break;
    case 'new_round':
      if (!G.isHost) {
        G.phase  = 'fight';
        G.choices = {};
        addLog('— Nouveau round —', 'system');
        renderActionPanel();
      }
      break;
    case 'rematch_ask':
      onRematchAsk();
      break;
    case 'rematch_go':
      doRematch();
      break;
  }
}

/* ── Messages lobby ── */
function handleLobbyMessage(msg) {
  switch (msg.type) {
    case 'hello': {
      addLobbyPlayer(msg.slot, msg.pseudo, msg.avatar || null);
      if (G.isHost) {
        /* FIX: sendTo au lieu de broadcast pour ne pas écraser l'état
           des autres guests qui ont déjà rejoint */
        sendTo(msg.slot, { type: 'lobby_state', mode: G.mode, teamHPMode: G.teamHPMode, players: G.lobbyPlayers });
      }
      break;
    }
    case 'lobby_state': {
      G.mode       = msg.mode;
      G.teamHPMode = msg.teamHPMode || 'individual';
      G.lobbyPlayers = msg.players;

      /* FIX: résolution robuste du mySlot pour le guest.
         On cherche d'abord par slot explicite si fourni,
         sinon par pseudo, sinon on garde la valeur courante si valide. */
      if (G.mySlot < 0) {
        var me = G.lobbyPlayers.find(function(p) {
          return p.pseudo === G.myPseudo;
        });
        if (me) G.mySlot = me.slot;
      }

      if (G.phase === 'waiting') {
        G.phase = 'lobby';
        stopPolls();
        document.getElementById('waiting-room').style.display = 'none';
        var anonWrap = document.getElementById('anon-wait-wrap');
        if (anonWrap) anonWrap.style.display = 'none';
        showScreen('game');
      }
      renderLobby();
      break;
    }
    case 'player_ready': {
      var p = G.lobbyPlayers.find(function(x){ return x.slot === msg.slot; });
      if (p) p.ready = true;
      renderLobbyPlayers();
      renderReadyBtn();
      checkAllReady();
      break;
    }
  }
}

function addLobbyPlayer(slot, pseudo, avatar) {
  if (G.lobbyPlayers.find(function(p){ return p.slot === slot; })) return;
  G.lobbyPlayers.push({ slot: slot, pseudo: pseudo, avatar: avatar, ready: false });
  renderLobbyPlayers();
  renderModeButtons();
  if (G.isHost) {
    broadcast({ type: 'lobby_state', mode: G.mode, teamHPMode: G.teamHPMode, players: G.lobbyPlayers });
  }
}

/* ══════════════════════════════════════════
   CHAR SELECT
   ══════════════════════════════════════════ */
/* FIX: charChoices indexé par number pour cohérence avec p.slot (number) */
var charChoices = {};

function startCharSelect() {
  G.phase = 'charselect';
  // Fermer le lobby public — la partie commence
  if (typeof closeLobby === 'function') closeLobby();
  document.getElementById('game-lobby').style.display  = 'none';
  document.getElementById('char-select').style.display = 'flex';
  document.getElementById('char-select-status').textContent = 'Choisis ton personnage !';
  renderCharCards();
}

function renderCharCards() {
  // Mode IA : déclencher le choix de perso des bots
  if (G.aiEnabled) {
    setTimeout(function() {
      G.lobbyPlayers.filter(function(p){ return p.isAI; }).forEach(function(bot, i) {
        setTimeout(function() {
          if (typeof aiPickCharForSlot === 'function') aiPickCharForSlot(bot.slot);
        }, 600 + i * 400 + Math.random() * 400);
      });
    }, 100);
  }
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
        c.moves.filter(function(m){ return !m.heal; }).map(function(m){ return m.icon + ' ' + m.name + ' ' + m.desc; }).join('<br>') +
      '</div>';
    d.onclick = (function(name){ return function(){ pickChar(name); }; })(c.name);
    cards.appendChild(d);
  });
}

function pickChar(name) {
  /* FIX: clé en number pour cohérence */
  charChoices[G.mySlot] = name;
  document.querySelectorAll('.char-card').forEach(function(c) {
    c.style.borderColor = c.dataset.char === name ? CHARS[name].colorHex : 'var(--border)';
  });
  send({ type: 'char_choice', slot: G.mySlot, charName: name });
  _refreshCharStatus();
  if (G.isHost) _checkAllChosen();
}

function onCharChoice(msg) {
  /* FIX: normaliser la clé en number */
  charChoices[+msg.slot] = msg.charName;
  _refreshCharStatus();
  if (G.isHost) _checkAllChosen();
}

function _refreshCharStatus() {
  var n     = Object.keys(charChoices).length;
  var total = G.lobbyPlayers.length;
  var el    = document.getElementById('char-select-status');
  if (el) el.textContent = n + '/' + total + ' prêts…';
}

function _checkAllChosen() {
  if (Object.keys(charChoices).length >= G.lobbyPlayers.length) {
    /* FIX: inclure mode et teamHPMode pour que les guests synchronisent
       correctement le mode avant beginFight() → évite le bug coéquipier attaquable */
    broadcast({ type: 'begin_fight', choices: Object.assign({}, charChoices),
                mode: G.mode, teamHPMode: G.teamHPMode });
    beginFight();
  }
}

/* ══════════════════════════════════════════
   COMBAT — Initialisation
   ══════════════════════════════════════════ */
function beginFight() {
  if (G.phase === 'fight') return;
  G.phase = 'fight';
  document.getElementById('char-select').style.display = 'none';
  document.getElementById('battle-area').style.display = 'flex';

  var n = G.lobbyPlayers.length;
  if (n === 2) G.mode = '1v1';
  if (n === 3) G.mode = 'ffa';
  /* FIX: pour 4 joueurs, respecter le mode choisi dans le lobby (2v2 ou ffa).
     On ne force FFA que si le mode n'est ni '2v2' ni 'ffa', pour éviter
     qu'un guest dont G.mode n'est pas encore synchronisé bascule en FFA. */
  if (n === 4 && G.mode !== '2v2' && G.mode !== 'ffa') G.mode = 'ffa';

  console.log('[beginFight] mode=' + G.mode + ' joueurs=' + n + ' mySlot=' + G.mySlot);

  G.players = G.lobbyPlayers.map(function(lp) {
    /* FIX: charChoices[lp.slot] — lp.slot est un number,
       charChoices est indexé par number → correspondance garantie */
    var charName = charChoices[lp.slot] || charChoices[String(lp.slot)];
    var char     = CHARS[charName] || CHARS.Pyros;
    var team     = G.mode === '2v2' ? (lp.slot < 2 ? 0 : 1) : null;
    return {
      slot:  lp.slot,
      pseudo: lp.pseudo,
      avatar: lp.avatar,
      char:   char,
      hp:     char.maxHP,
      maxHP:  char.maxHP,
      alive:  true,
      team:   team
    };
  });

  G.choices = {};
  if (typeof clearDialogQueue === 'function') clearDialogQueue();
  if (!r3) initThree(); else resetThreeChars();
  renderActionPanel();
  addLog('⚔️ Que le combat commence !', 'system');
}

/* ══════════════════════════════════════════
   COMBAT — Panel d'actions
   ══════════════════════════════════════════ */
function renderActionPanel() {
  /* FIX: recherche robuste du joueur local */
  var me = G.players.find(function(p){ return p.slot === G.mySlot; });
  if (!me) {
    console.error('[renderActionPanel] me introuvable ! mySlot=' + G.mySlot +
      ' slots disponibles=' + G.players.map(function(p){ return p.slot; }).join(','));
    return;
  }
  if (!me.alive) {
    /* Joueur mort : afficher un message et pas de boutons */
    var grid = document.getElementById('actions-grid');
    grid.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px">💀 Tu as été éliminé.</div>';
    document.getElementById('waiting-action').style.display = 'none';
    document.getElementById('target-picker').classList.remove('visible');
    return;
  }

  var grid = document.getElementById('actions-grid');
  grid.innerHTML = '';

  me.char.moves.forEach(function(m) {
    var btn = document.createElement('button');
    btn.className = 'action-btn';
    btn.innerHTML = m.icon + ' ' + m.name + ' <span class="dmg">' + m.desc + '</span>';
    /* FIX: closure correcte avec IIFE pour capturer m */
    btn.onclick = (function(move){ return function(){ pickAction(move); }; })(m);
    grid.appendChild(btn);
  });

  document.getElementById('waiting-action').style.display = 'none';
  var tp = document.getElementById('target-picker');
  if (tp) tp.classList.remove('visible');
  var ag = document.getElementById('actions-grid');
  if (ag) ag.style.display = 'grid';
  document.querySelectorAll('#actions-grid .action-btn').forEach(function(b){ b.disabled = false; });

  // Mode IA : déclencher le tour des bots
  if (G.aiEnabled && typeof aiPlayTurn === 'function') {
    clearTimeout(AI._timer);
    AI._timer = setTimeout(aiPlayTurn, typeof aiDelay === 'function' ? aiDelay() : 1000);
  }
}

/* ══════════════════════════════════════════
   COMBAT — Ciblage
   ══════════════════════════════════════════ */
function pickAction(move) {
  if (G.phase !== 'fight') {
    console.warn('[pickAction] phase=' + G.phase + ' → ignoré');
    return;
  }
  /* FIX: vérification cohérente — mySlot est un number, G.choices est
     indexé par number depuis submitAction */
  if (G.choices[G.mySlot] !== undefined) {
    console.warn('[pickAction] déjà choisi ce round');
    return;
  }

  var me = G.players.find(function(p){ return p.slot === G.mySlot; });
  if (!me) {
    console.error('[pickAction] me introuvable ! mySlot=' + G.mySlot);
    return;
  }
  if (!me.alive) return;

  var alive = G.players.filter(function(p){ return p.alive; });

  /* ── 1v1 : toujours automatique ── */
  if (G.mode === '1v1') {
    if (move.heal) {
      submitAction(move, me.slot);
    } else {
      var t = alive.find(function(p){ return p.slot !== me.slot; });
      if (t) submitAction(move, t.slot);
    }
    return;
  }

  /* ── FFA et 2v2 : picker si plusieurs cibles ── */
  var targets = [];

  if (move.heal) {
    if (G.mode === '2v2') {
      targets = alive.filter(function(p){ return p.team === me.team; });
    } else {
      submitAction(move, me.slot);
      return;
    }
  } else {
    if (G.mode === '2v2') {
      targets = alive.filter(function(p){ return p.team !== me.team; });
    } else {
      /* FIX: en FFA, exclure aussi les joueurs de la même équipe (team non-null)
         pour éviter qu'un coéquipier soit ciblable si le mode 2v2 a été mal synchronisé */
      targets = alive.filter(function(p){
        return p.slot !== me.slot && (me.team === null || p.team !== me.team);
      });
    }
  }

  if (targets.length === 0) return;
  if (targets.length === 1) { submitAction(move, targets[0].slot); return; }
  showTargetPicker(move, targets, me);
}

function showTargetPicker(move, targets, me) {
  // Cacher la grille d'attaques, afficher le picker en 2×2
  var grid   = document.getElementById('actions-grid');
  var picker = document.getElementById('target-picker');
  if (grid)   { grid.style.display = 'none'; }
  if (picker) { picker.classList.remove('visible'); picker.innerHTML = ''; }

  // Remplir jusqu'à 4 slots pour avoir toujours une grille 2×2
  // Les slots vides sont des boutons transparents/disabled
  var slots = [null, null, null, null];
  targets.forEach(function(p, i) { if (i < 4) slots[i] = p; });

  slots.forEach(function(p) {
    var btn = document.createElement('button');
    btn.className = 'target-btn';

    if (!p) {
      // Cellule vide
      btn.disabled = true;
      btn.style.background = 'transparent';
      btn.style.border = '2px dashed rgba(0,0,0,0.1)';
      btn.style.boxShadow = 'none';
      picker.appendChild(btn);
      return;
    }

    var isSelf = p.slot === me.slot;
    var teamBadge = '';
    if (G.mode === '2v2') {
      teamBadge = p.team === 0
        ? '<span class="team-badge fire">Équipe A</span>'
        : '<span class="team-badge ice">Équipe B</span>';
    }

    btn.innerHTML =
      '<span class="target-dot" style="background:' + SLOT_CLR[p.slot] + '"></span>' +
      '<span class="target-name">' + (isSelf ? '🛡️ ' + p.pseudo : p.pseudo) + '</span>' +
      teamBadge +
      '<span class="target-hp">' + p.hp + '/' + p.maxHP + ' PV</span>';

    btn.onclick = (function(slot) {
      return function() {
        picker.classList.remove('visible');
        if (grid) grid.style.display = 'grid';
        submitAction(move, slot);
      };
    })(p.slot);

    picker.appendChild(btn);
  });

  picker.classList.add('visible');
}

function submitAction(move, targetSlot) {
  /* FIX: double-guard pour éviter toute soumission en double */
  if (G.choices[G.mySlot] !== undefined) return;
  if (G.phase !== 'fight') return;

  /* FIX: stocker avec clé number pour cohérence avec tryResolve */
  G.choices[G.mySlot] = { move: move, targetSlot: targetSlot };

  document.querySelectorAll('#actions-grid .action-btn').forEach(function(b){ b.disabled = true; });
  document.getElementById('target-picker').classList.remove('visible');
  document.getElementById('waiting-action').style.display = 'flex';

  /* FIX: send envoie le move complet tel quel — les propriétés heal/dmg/acc
     sont des primitives, elles survivent à la sérialisation JSON sans problème */
  send({ type: 'action', slot: G.mySlot, move: move, targetSlot: targetSlot });

  if (G.isHost) tryResolve();
}

function onAction(msg) {
  /* FIX: normaliser slot en number, et ne pas écraser si déjà reçu */
  var slot = +msg.slot;
  if (G.choices[slot] !== undefined) return;
  G.choices[slot] = { move: msg.move, targetSlot: msg.targetSlot };
  if (G.isHost) tryResolve();
}

function tryResolve() {
  if (!G.isHost) return;
  if (G.phase !== 'fight') return;
  var aliveSlots = G.players.filter(function(p){ return p.alive; }).map(function(p){ return p.slot; });
  if (aliveSlots.length === 0) return;
  if (aliveSlots.every(function(s){ return G.choices[s] !== undefined; })) resolveRound();
}

/* ══════════════════════════════════════════
   COMBAT — Résolution du round (hôte seul)
   ══════════════════════════════════════════ */
async function resolveRound() {
  if (G.phase !== 'fight') return;
  G.phase = 'resolving';

  /* Calculer hit avant de vider G.choices */
  var results = {};
  Object.entries(G.choices).forEach(function(entry) {
    var s = +entry[0], c = entry[1];
    results[s] = Object.assign({}, c, {
      /* FIX: move est un objet — on copie ses propriétés pour la sérialisation JSON */
      move: {
        name: c.move.name,
        icon: c.move.icon,
        dmg:  c.move.dmg  || 0,
        acc:  c.move.acc  || 1,
        heal: c.move.heal || 0,
        desc: c.move.desc || ''
      },
      hit: c.move.heal ? true : Math.random() < c.move.acc
    });
  });

  /* FIX: vider choices APRÈS avoir construit results */
  G.choices = {};

  /* Broadcaster en premier pour que les guests puissent appliquer en parallèle */
  /* FIX: inclure l'ordre de résolution dans le message pour que tous appliquent
     exactement dans le même ordre → état HP identique partout */
  var sortedForBroadcast = Object.entries(results).map(function(e) {
    var action = Object.assign({ slot: +e[0] }, e[1]);
    var player = G.players.find(function(p){ return p.slot === action.slot; });
    action._speed = player ? player.char.speed : 0;
    return action;
  }).sort(function(a, b){
    if (b._speed !== a._speed) return b._speed - a._speed;
    return Math.random() - 0.5;
  });
  var broadcastOrder = sortedForBroadcast.map(function(a){ return a.slot; });

  broadcast({ type: 'round_result', results: results, order: broadcastOrder });
  await applyRound(results, broadcastOrder);
}

function onRoundResult(msg) {
  /* Seuls les guests appliquent ici ; l'hôte applique dans resolveRound */
  if (!G.isHost) {
    /* Normaliser les clés en number et l'ordre envoyé par l'hôte */
    var normalized = {};
    Object.entries(msg.results).forEach(function(e) {
      normalized[+e[0]] = e[1];
    });
    /* L'hôte a déjà calculé l'ordre (msg.order = tableau de slots triés) */
    applyRound(normalized, msg.order);
  }
}

/*
 * applyRound(results, order)
 *   results : { [slot]: { move, targetSlot, hit } }
 *   order   : [slot, slot, …] — ordre d'application déterminé par l'hôte
 *             (undefined côté hôte → on le calcule ici et on le broadcast)
 */
async function applyRound(results, order) {
  G.phase = 'resolving';
  document.getElementById('waiting-action').style.display = 'none';

  /* ── Ordre d'application ──
     L'hôte le calcule une seule fois et le transmet dans round_result.
     Les guests utilisent cet ordre directement → état identique garanti. */
  if (!order) {
    /* Côté hôte : trier par vitesse, égalités résolues aléatoirement */
    var sorted = Object.entries(results).map(function(entry) {
      var action = Object.assign({ slot: +entry[0] }, entry[1]);
      var player = G.players.find(function(p){ return p.slot === action.slot; });
      action._speed = player ? player.char.speed : 0;
      return action;
    }).sort(function(a, b){
      if (b._speed !== a._speed) return b._speed - a._speed;
      return Math.random() - 0.5;   /* aléatoire OK : l'hôte est seul à trier */
    });
    order = sorted.map(function(a){ return a.slot; });
  }

  /* Appliquer dans l'ordre fourni */
  for (var i = 0; i < order.length; i++) {
    var slot   = order[i];
    var action = results[slot];
    if (!action) continue;

    var atk = G.players.find(function(p){ return p.slot === slot; });
    var tgt = G.players.find(function(p){ return p.slot === action.targetSlot; });

    if (!atk || !atk.alive) continue;

    await applyOne(atk, tgt, action.move, action.hit);
    updateAllSprites();
    await delay(600);
  }

  /* ── Fin de partie : seul l'hôte décide et notifie ── */
  if (G.isHost) {
    if (isOver()) {
      /* Calcule le résultat et le broadcast AVANT d'afficher localement */
      var outcome = computeOutcome();
      broadcast({ type: 'game_over', outcome: outcome });
      showGameOver(outcome);
      return;
    }
    /* Nouveau round */
    G.phase  = 'fight';
    G.choices = {};
    broadcast({ type: 'new_round' });
    addLog('— Nouveau round —', 'system');
    renderActionPanel();
    tryResolve();
  } else {
    /* Guest : attend le message game_over ou new_round de l'hôte */
    /* (ne pas toucher à G.phase ici — c'est l'hôte qui commande) */
  }
}

async function applyOne(atk, tgt, move, hit) {
  if (!tgt) return;
  var isMe = atk.slot === G.mySlot;

  /* FIX: en 2v2, distinguer coéquipier (ally) et ennemi (them) pour le log */
  var logType;
  if (isMe) {
    logType = 'me';
  } else if (G.mode === '2v2' && atk.team !== null && atk.team !== undefined) {
    var me = G.players.find(function(p){ return p.slot === G.mySlot; });
    logType = (me && atk.team === me.team) ? 'ally' : 'them';
  } else {
    logType = 'them';
  }

  if (move.heal) {
    if (G.mode === '2v2' && G.teamHPMode === 'shared') {
      // Soin partagé : soigne toute l'équipe de la cible
      var teammates = G.players.filter(function(p){ return p.team === tgt.team && p.alive; });
      var gainTotal = 0;
      teammates.forEach(function(p) {
        var g = Math.min(move.heal, p.maxHP - p.hp);
        p.hp = Math.min(p.maxHP, p.hp + g);
        gainTotal += g;
      });
      addLog(atk.pseudo + ' soigne l\'equipe +' + gainTotal + ' PV 💚', logType);
    } else {
      var gain = Math.min(move.heal, tgt.maxHP - tgt.hp);
      tgt.hp = Math.min(tgt.maxHP, tgt.hp + gain);
      addLog(atk.pseudo + ' soigne ' + tgt.pseudo + ' +' + gain + ' PV 💚', logType);
    }
  } else if (hit) {
    if (G.mode === '2v2' && G.teamHPMode === 'shared') {
      // Dégâts partagés : répartis sur toute l'équipe vivante
      var teamTargets = G.players.filter(function(p){ return p.team === tgt.team; });
      var remaining   = move.dmg;
      // Répartir les dégâts sur l'équipe
      teamTargets.forEach(function(p) {
        if (remaining <= 0) return;
        var dmg = Math.min(remaining, p.hp);
        p.hp      = Math.max(0, p.hp - dmg);
        remaining -= dmg;
        // FIX: marquer alive=false même en shared pour bloquer les attaques post-mortem
        if (p.hp === 0) p.alive = false;
        spawnHitParticles(p.slot);
      });
      addLog(atk.pseudo + ' → ' + move.icon + ' ' + move.name + ' → Équipe ' +
        (tgt.team === 0 ? 'A' : 'B') + ' (' + move.dmg + ' dmg partagés)', logType);
    } else {
      tgt.hp = Math.max(0, tgt.hp - move.dmg);
      if (tgt.hp === 0) tgt.alive = false;
      addLog(atk.pseudo + ' → ' + move.icon + ' ' + move.name + ' → ' + tgt.pseudo +
        ' (' + move.dmg + ' dmg)', logType);
      spawnHitParticles(tgt.slot);
    }
  } else {
    addLog(atk.pseudo + ' rate ' + move.icon + ' ' + move.name + ' !', logType);
  }
}

/* ══════════════════════════════════════════
   COMBAT — Fin de partie
   ══════════════════════════════════════════ */
function isOver() {
  if (!G.players || G.players.length === 0) return false;

  if (G.mode === '2v2' && G.teamHPMode === 'shared') {
    // En PV partagés : une équipe est éliminée quand la somme de ses HP = 0
    var hp0 = G.players.filter(function(p){ return p.team === 0; })
                       .reduce(function(s,p){ return s + p.hp; }, 0);
    var hp1 = G.players.filter(function(p){ return p.team === 1; })
                       .reduce(function(s,p){ return s + p.hp; }, 0);
    return hp0 <= 0 || hp1 <= 0;
  }

  var alive = G.players.filter(function(p){ return p.alive; });
  if (G.mode === '1v1' || G.mode === 'ffa') return alive.length <= 1;
  if (G.mode === '2v2') {
    return alive.filter(function(p){ return p.team === 0; }).length === 0
        || alive.filter(function(p){ return p.team === 1; }).length === 0;
  }
  return false;
}

/* Calcule l'outcome côté hôte — résultat brut transmis à tous */
function computeOutcome() {
  if (G.mode === '2v2' && G.teamHPMode === 'shared') {
    var hp0 = G.players.filter(function(p){ return p.team === 0; })
                       .reduce(function(s,p){ return s + p.hp; }, 0);
    return { type: 'team', winnerTeam: hp0 > 0 ? 0 : 1 };
  }
  if (G.mode === '1v1' || G.mode === 'ffa') {
    var winner = G.players.find(function(p){ return p.alive; });
    return { type: 'winner', winnerSlot: winner ? winner.slot : -1 };
  }
  /* 2v2 normal : quelle équipe a encore des survivants ? */
  var team0alive = G.players.some(function(p){ return p.alive && p.team === 0; });
  return { type: 'team', winnerTeam: team0alive ? 0 : 1 };
}

/* Affiche l'overlay à partir de l'outcome reçu — pareil pour hôte et guests */
function showGameOver(outcome) {
  G.phase = 'over';
  var txt = '';
  if (outcome.type === 'winner') {
    if (outcome.winnerSlot === -1) {
      txt = '🤝 Match nul !';
    } else if (outcome.winnerSlot === G.mySlot) {
      txt = '🏆 Victoire !';
    } else {
      var winner = G.players.find(function(p){ return p.slot === outcome.winnerSlot; });
      txt = '💀 ' + (winner ? winner.pseudo : 'Adversaire') + ' gagne.';
    }
  } else {
    var me = G.players.find(function(p){ return p.slot === G.mySlot; });
    var myTeam = me ? me.team : -1;
    txt = myTeam === outcome.winnerTeam ? '🏆 Votre équipe gagne !' : '💀 Votre équipe perd.';
  }
  document.getElementById('overlay').style.display = 'flex';
  document.getElementById('overlay-text').textContent = txt;
}

/* ══════════════════════════════════════════
   COMBAT — Revanche
   ══════════════════════════════════════════ */
var _rematchAsked = false;

function askRematch() {
  if (_rematchAsked) return;
  _rematchAsked = true;

  // Mode IA : pas de réseau, relancer directement
  if (G.aiEnabled) {
    doRematch();
    return;
  }

  var btn = document.querySelector('#overlay .btn');
  btn.textContent = '⏳ En attente…';
  btn.disabled = true;
  send({ type: 'rematch_ask' });
}

function onRematchAsk() {
  if (_rematchAsked) {
    send({ type: 'rematch_go' });
    doRematch();
  } else {
    document.getElementById('overlay-text').textContent += '\n\nUn adversaire veut rejouer !';
    var btn = document.querySelector('#overlay .btn');
    btn.textContent = '✅ Accepter';
    btn.disabled = false;
    btn.onclick = function() {
      _rematchAsked = true;
      send({ type: 'rematch_go' });
      doRematch();
    };
  }
}

function doRematch() {
  _rematchAsked = false;
  document.getElementById('overlay').style.display = 'none';
  var btn = document.querySelector('#overlay .btn');
  btn.textContent = '↺ Rejouer';
  btn.disabled = false;
  btn.onclick  = askRematch;

  var box = document.getElementById('combat-log-messages');
  if (box && box.children.length) {
    var sep = document.createElement('div');
    sep.className = 'log-entry system';
    sep.innerHTML = '<span class="log-badge">•</span>' +
      '<span class="log-text" style="color:var(--muted)">── Revanche ──</span>';
    box.appendChild(sep);
  }

  /* Reset complet */
  charChoices = {};
  G.choices   = {};
  G.players   = [];
  G.lobbyPlayers = [];
  G.phase     = 'idle';
  if (typeof clearDialogQueue === 'function') clearDialogQueue();

  // Mode IA : nettoyer le timer et retourner au login pour rechoisir
  if (G.aiEnabled) {
    if (typeof AI !== 'undefined') { clearTimeout(AI._timer); AI._timer = null; }
    G.aiEnabled = false;
    showScreen('login');
    return;
  }

  // Mode multi : retour au lobby
  G.lobbyPlayers.forEach(function(p){ p.ready = false; });
  G.phase = 'lobby';
  renderLobby();
}
