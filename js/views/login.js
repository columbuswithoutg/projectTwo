/************************************************
 * LOGIN VIEW
 ************************************************/
const LoginView = {
  title: 'MCU Tracker — Login',

  mount(container) {
    // If already logged in, skip to app
    if (Auth.isLoggedIn()) {
      Router.go('/app');
      return;
    }

    // Reset app state flags so next login fetches fresh data
    AppView._initialized = false;
    Walkers.resetInit();
    state.data.clear();

    container.innerHTML = `
      <div class="auth-modal-static">
        <div class="auth-box">
          <h1>MCU Watch Order</h1>
          <p class="auth-subtitle">Track your Marvel journey</p>

          <div class="auth-tabs">
            <button class="auth-tab active" data-tab="login">Login</button>
            <button class="auth-tab" data-tab="register">Register</button>
          </div>

          <input id="auth-username" type="text" placeholder="Username" />
          <input id="auth-password" type="password" placeholder="Password" />
          <p class="auth-error" style="color:red; display:none;"></p>
          <button id="auth-submit">Login</button>
        </div>
      </div>
    `;

    document.body.classList.add('auth-page');

    const usernameEl = document.getElementById('auth-username');
    const passwordEl = document.getElementById('auth-password');
    const submitBtn = document.getElementById('auth-submit');
    const errorEl = document.querySelector('.auth-error');
    const tabs = document.querySelectorAll('.auth-tab');

    let currentMode = 'login';

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentMode = tab.dataset.tab;
        submitBtn.textContent = currentMode === 'login' ? 'Login' : 'Create Account';
        errorEl.style.display = 'none';
      });
    });

    function showError(msg, color = 'red') {
      errorEl.textContent = msg;
      errorEl.style.color = color;
      errorEl.style.display = 'block';
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
          Router.go('/app');
        } else {
          showError('Account created! Please log in.', 'green');
          tabs[0].click();
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
