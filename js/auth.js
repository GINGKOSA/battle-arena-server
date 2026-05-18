'use strict';
/* ═══════════════ AUTH ═══════════════ */

async function initAuth() {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('token');
  const error  = params.get('error');

  if (token) {
    G.myToken = token;
    localStorage.setItem('ba_token', token);
    window.history.replaceState({}, '', location.pathname);
  }

  if (error) { alert('Erreur de connexion Discord.'); showScreen('login'); return; }
  if (!G.myToken) { showScreen('login'); return; }

  try {
    const me = await (await fetch(SIGNAL+'/me',{headers:{Authorization:`Bearer ${G.myToken}`}})).json();
    if (me.error) { G.myToken=null; localStorage.removeItem('ba_token'); showScreen('login'); return; }
    G.myProfile = me;
    G.myPseudo  = me.username;
    document.getElementById('profile-avatar').src = me.avatar;
    document.getElementById('profile-name').textContent = me.username;
    showScreen('lobby');
    startPolls();
  } catch { showScreen('login'); }
}

function login()  { location.href = SIGNAL+'/login'; }

function logout() {
  localStorage.removeItem('ba_token');
  G.myToken=null; G.myProfile=null; G.myPseudo=null;
  stopPolls();
  showScreen('login');
}
