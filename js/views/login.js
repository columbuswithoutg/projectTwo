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
    // Where to go after signing in: the page the auth gate redirected from
    // (?next=, kept in-app by UxLogic.safeNextUrl), else the watch order.
    const nextUrl = UxLogic.safeNextUrl(new URLSearchParams(location.search).get('next')) || '/';

    // If already logged in, skip to app
    if (Auth.isLoggedIn()) {
      Router.go(nextUrl, { replace: true });
      return;
    }

    // Landing here means no session: forget whatever the previous account
    // left in memory / storage so the next login starts clean.
    Auth.resetClientState();

    container.innerHTML = `
      <div class="auth-modal-static">
        <div class="auth-box" id="auth-box">
          <div class="auth-form-panel" id="auth-form-panel">
            <span class="brand-mark brand-mark--lg" aria-hidden="true"></span>
            <h1>MCU Watch Order</h1>
            <p class="auth-subtitle">Track your Marvel journey</p>

            <div class="auth-tabs" role="tablist" aria-label="Log in or register">
              <button class="auth-tab active" type="button" role="tab" aria-selected="true" data-tab="login">Log in</button>
              <button class="auth-tab" type="button" role="tab" aria-selected="false" data-tab="register">Register</button>
            </div>

            <form class="auth-form" id="auth-form" novalidate>
              <label class="visually-hidden" for="auth-username">Username</label>
              <input id="auth-username" name="username" type="text" placeholder="Username"
                     autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"
                     maxlength="30" aria-describedby="auth-error" />
              <label class="visually-hidden" for="auth-password">Password</label>
              <input id="auth-password" name="password" type="password" placeholder="Password"
                     autocomplete="current-password" aria-describedby="auth-error" />
              <p class="auth-error" id="auth-error" role="status" aria-live="polite"></p>
              <button id="auth-submit" type="submit">Log in</button>
            </form>
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
    const form = document.getElementById('auth-form');
    const errorEl = document.getElementById('auth-error');
    const tabs = document.querySelectorAll('.auth-tab');
    let inFlight = false;   // Enter twice must not send two requests

    const FADE_MS = 260;
    const HOLD_MS = 900;
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    let currentMode = 'login';

    function setMode(mode, opts = {}) {
      currentMode = mode;
      tabs.forEach(t => {
        const on = t.dataset.tab === mode;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', String(on));
      });
      submitBtn.textContent = mode === 'login' ? 'Log in' : 'Create account';
      // Lets password managers offer to save a NEW password on register and
      // fill the saved one on login.
      passwordEl.setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
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
      usernameEl.removeAttribute('aria-invalid');
      passwordEl.removeAttribute('aria-invalid');
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
      if (inFlight) return;
      const username = usernameEl.value.trim();
      const password = passwordEl.value;

      if (!username || !password) {
        showError('Please fill in both fields.');
        (username ? passwordEl : usernameEl).setAttribute('aria-invalid', 'true');
        (username ? passwordEl : usernameEl).focus();
        return;
      }

      inFlight = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Please wait…';

      try {
        const res = await fetch(`${API}/auth/${currentMode}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });

        let data = null;
        try { data = await res.json(); } catch (_) {}

        if (!res.ok || !data || data.error) {
          showError(UxLogic.friendlyAuthError(data, res.status));
          if (res.status === 401) { usernameEl.setAttribute('aria-invalid', 'true'); passwordEl.setAttribute('aria-invalid', 'true'); }
          passwordEl.focus();
          return;
        }

        if (currentMode === 'login') {
          // Clean slate before this account's token lands (a different
          // account's leftovers may still be in memory in this tab).
          Auth.resetClientState();
          Auth.setToken(data.token);
          // Start fetching the 3D character models in the background.
          if (window.HumanoidPrefetch) HumanoidPrefetch.warm();
          localStorage.setItem('mcu_username', data.username);
          Router.go(nextUrl, { replace: true });
        } else {
          await playSuccessTransition(username);
        }
      } catch (e) {
        showError(UxLogic.friendlyAuthError(null, 0));
      } finally {
        inFlight = false;
        submitBtn.disabled = false;
        submitBtn.textContent = currentMode === 'login' ? 'Log in' : 'Create account';
      }
    };

    // One submit path: the button, Enter in either field.
    form.addEventListener('submit', (e) => { e.preventDefault(); doSubmit(); });
  },

  unmount() {
    document.body.classList.remove('auth-page');
  }
};
