// screens/Login-Screen.js
// Renders the login screen and handles sign-in for a private site.
// Requires bcryptjs (browser) loaded by index.html.

const LOGIN_JSON_URL = './data/userLogins.json';
const SESSION_KEY = 'rpAuth';

function setSession(user) {
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      userId: user.userId,
      role: user.role ?? 'user',
      loginAt: new Date().toISOString(),
    })
  );
}

async function loadUsers() {
  const res = await fetch(LOGIN_JSON_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('Unable to load user list');
  return res.json();
}

function renderLogin(root) {
  root.innerHTML = `
    <main class="login-wrap">
      <h1>Sign in</h1>
      <p class="muted">Private site. Accounts are provisioned by the admin.</p>

      <form id="loginForm" autocomplete="off">
        <div class="field">
          <label for="userId">User ID</label>
          <input id="userId" name="userId" type="text" required />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" required />
        </div>
        <button class="btn btn-primary" type="submit">Sign in</button>
        <div id="loginError" class="error"></div>
      </form>
    </main>
  `;
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';

  const userId = document.getElementById('userId').value.trim();
  const password = document.getElementById('password').value;

  try {
    const users = await loadUsers();
    const user = users.find(
      (u) => u.userId?.toLowerCase() === userId.toLowerCase() && u.active !== false
    );

    if (!user) {
      errEl.textContent = 'Invalid credentials.';
      return;
    }

    const bcryptLib = window.bcrypt || (window.dcodeIO && window.dcodeIO.bcrypt);
    if (!bcryptLib) {
      errEl.textContent = 'Auth dependency missing. Try refreshing.';
      return;
    }

    const ok = bcryptLib.compareSync(password, user.passwordHash);
    if (!ok) {
      errEl.textContent = 'Invalid credentials.';
      return;
    }

    setSession(user);
    window.location.href = '../dashboard.html';
  } catch (err) {
    console.error(err);
    errEl.textContent = 'Login failed. Please try again.';
  }
}

function attachHandlers() {
  const form = document.getElementById('loginForm');
  if (form) form.addEventListener('submit', handleLoginSubmit);
}

(function init() {
  // If already logged in, skip to dashboard
  if (sessionStorage.getItem(SESSION_KEY)) {
    window.location.replace('../dashboard.html');
    return;
  }

  const root =
    document.getElementById('app') ||
    (() => {
      const m = document.createElement('main');
      m.id = 'app';
      document.body.appendChild(m);
      return m;
    })();

  renderLogin(root);
  attachHandlers();
})();
