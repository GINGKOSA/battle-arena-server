/* ═══════════════ AUTH ═══════════════ */
let myToken   = localStorage.getItem('battle_token') || null;
let myProfile = null;

function login() { window.location.href = SIGNAL + '/login'; }

function logout() {
  localStorage.removeItem('battle_token');
  myToken = null; myProfile = null;
  stopPolls();
  showScreen('login');
}

async function initAuth() {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('token');
  const error  = params.get('error');

  if (token) {
    myToken = token;
    localStorage.setItem('battle_token', token);
    window.history.replaceState({}, '', window.location.pathname);
  }

  if (error) { alert('Erreur de connexion Discord. Réessaie !'); showScreen('login'); return; }

  if (!myToken) { showScreen('login'); return; }

  try {
    myProfile = await api('/me');
    if (myProfile.error) {
      myToken = null; localStorage.removeItem('battle_token');
      showScreen('login'); return;
    }
    document.getElementById('profile-avatar').src = myProfile.avatar;
    document.getElementById('profile-name').textContent = myProfile.username;
    myPseudo = myProfile.username;
    showScreen('lobby');
    startPolls();
  } catch { showScreen('login'); }
}
