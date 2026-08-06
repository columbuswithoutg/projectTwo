/************************************************
 * LOGIN VIEW
 *
 * Register and Login share one box with a tab toggle. On a successful
 * registration this used to just call tabs[0].click() — whose own handler
 * immediately hid the "Account created!" message it had just shown,
 * leaving the user staring at a blank form with zero feedback. Now a
 * success step plays first (checkmark + toast), then the view lands back
 * on Login with the username prefilled and the password field focused —
 * the user still authenticates themselves; the server keeps returning no
 * token from /register.
 ************************************************/
const LoginView = {
  title: 'MCU Tracker — Login',

  mount(container) {
    // If already logged in, skip to app
    if (Auth.isLoggedIn()) {
      Router.go('/');
      return;
    }

    // Reset app state flags so next login fetches fresh data.
    // resetLocal fires listeners so layout/renderer caches invalidate for
    // the incoming account (otherwise the new login inherits the previous
    // user's cached map until a hard refresh).
    AppView._initialized = false;
    Walkers.resetInit();
    state.resetLocal();

    container.innerHTML = `
      <div class="auth-modal-static">
        <div class="auth-box" id="auth-box">
          <div class="auth-form-panel" id="auth-form-panel">
            <h1>MCU Watch Order</h1>
            <p class="auth-subtitle">Track your Marvel journey</p>

            <div class="auth-tabs">
              <button class="auth-tab active" data-tab="login">Login</button>
              <button class="auth-tab" data-tab="register">Register</button>
            </div>

            <input id="auth-username" type="text" placeholder="Username" />
            <input id="auth-password" type="password" placeholder="Password" />
            <p class="auth-error" id="auth-error"></p>
            <button id="auth-submit">Login</button>
          </div>

          <div class="auth-success-panel" id="auth-success-panel" hidden>
            <div class="auth-success-check" aria-hidden="true">✓</div>
            <h2 class="auth-success-title">Account created</h2>
            <p class="auth-success-sub">Welcome, <strong id="auth-success-name"></strong> — sign in to continue.</p>
          </div>
        </div>
      </div>
    `;

    document.body.classList.add('auth-page');

    const box = document.getElementById('auth-box');
    const formPanel = document.getElementById('auth-form-panel');
    const successPanel = document.getElementById('auth-success-panel');
    const successNameEl = document.getElementById('auth-success-name');
    const usernameEl = document.getElementById('auth-username');
    const passwordEl = document.getElementById('auth-password');
    const submitBtn = document.getElementById('auth-submit');
    const errorEl = document.getElementById('auth-error');
    const tabs = document.querySelectorAll('.auth-tab');

    const FADE_MS = 260;
    const HOLD_MS = 900;
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    let currentMode = 'login';

    function setMode(mode, opts = {}) {
      currentMode = mode;
      tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === mode));
      submitBtn.textContent = mode === 'login' ? 'Login' : 'Create Account';
      if (!opts.preserveError) hideError();
    }

    tabs.forEach(tab => {
      tab.addEventListener('click', () => setMode(tab.dataset.tab));
    });

    function showError(msg, kind = 'error') {
      errorEl.textContent = msg;
      errorEl.classList.toggle('success', kind === 'success');
      errorEl.classList.add('visible');
    }
    function hideError() {
      errorEl.classList.remove('visible', 'success');
    }

    // Animated success beat: fade the form out, show a checkmark panel with
    // the new username, hold briefly, fade back to the Login tab with the
    // username prefilled and the password field focused. Respects
    // prefers-reduced-motion by skipping straight to the end state with a
    // persistent inline success line instead of the animated panel.
    async function playSuccessTransition(name) {
      toast(`Account created — welcome, ${name}. Sign in to continue.`, 'success');

      const prefersReduced = window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (prefersReduced) {
        setMode('login', { preserveError: true });
        showError(`Account created — welcome, ${name}. Sign in to continue.`, 'success');
        usernameEl.value = name;
        passwordEl.value = '';
        passwordEl.focus();
        return;
      }

      box.classList.add('is-transitioning');
      usernameEl.disabled = true;
      passwordEl.disabled = true;

      successNameEl.textContent = name;

      formPanel.classList.add('is-fading');
      await wait(FADE_MS);
      formPanel.hidden = true;
      formPanel.classList.remove('is-fading');

      successPanel.hidden = false;
      successPanel.classList.add('is-entering');
      requestAnimationFrame(() => successPanel.classList.remove('is-entering'));
      await wait(FADE_MS + HOLD_MS);

      successPanel.classList.add('is-fading');
      await wait(FADE_MS);
      successPanel.hidden = true;
      successPanel.classList.remove('is-fading');

      usernameEl.value = name;
      passwordEl.value = '';
      setMode('login');

      formPanel.hidden = false;
      formPanel.classList.add('is-entering');
      requestAnimationFrame(() => formPanel.classList.remove('is-entering'));
      await wait(FADE_MS);

      usernameEl.disabled = false;
      passwordEl.disabled = false;
      box.classList.remove('is-transitioning');
      passwordEl.focus();
    }

    const doSubmit = async () => {
      const username = usernameEl.value.trim();
      const password = passwordEl.value;

      if (!username || !password) {
        showError('Please fill in all fields.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Please wait...';

      try {
        const res = await fetch(`${API}/auth/${currentMode}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });

        const data = await res.json();

        if (data.error) {
          showError(data.error);
          return;
        }

        if (currentMode === 'login') {
          localStorage.setItem('mcu_token', data.token);
          localStorage.setItem('mcu_username', data.username);
          Router.go('/');
        } else {
          await playSuccessTransition(username);
        }
      } catch (e) {
        showError('Server error. Is the server running?');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = currentMode === 'login' ? 'Login' : 'Create Account';
      }
    };

    submitBtn.addEventListener('click', doSubmit);
    passwordEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSubmit();
    });
  },

  unmount() {
    document.body.classList.remove('auth-page');
  }
};
