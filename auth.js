const API = window.location.origin + "/api";

const usernameEl = document.getElementById("auth-username");
const passwordEl = document.getElementById("auth-password");
const submitBtn  = document.getElementById("auth-submit");
const errorEl    = document.querySelector(".auth-error");
const tabs       = document.querySelectorAll(".auth-tab");

let currentMode = "login";

// If already logged in, skip straight to the SPA
if (localStorage.getItem("mcu_token")) {
  window.location.href = "/";
}

// Tab switching
tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentMode = tab.dataset.tab;
    submitBtn.textContent = currentMode === "login" ? "Login" : "Create Account";
    hideAlert();
  });
});

// Submit
submitBtn.addEventListener("click", async () => {
  const username = usernameEl.value.trim();
  const password = passwordEl.value;

  if (!username || !password) {
    showError("Please fill in all fields.");
    return;
  }

  setLoading(true);

  try {
    const res = await fetch(`${API}/auth/${currentMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (data.error) {
      showError(data.error);
      return;
    }

    if (currentMode === "login") {
      localStorage.setItem("mcu_token", data.token);
      localStorage.setItem("mcu_username", data.username);
      window.location.href = "/"; // ← redirect into SPA
    } else {
      // After register, auto-switch to login tab
      showSuccess("Account created! Please log in.");
      tabs[0].click();
    }

  } catch (e) {
    showError("Server error. Is the server running?");
  } finally {
    setLoading(false);
  }
});

// Allow Enter key to submit
passwordEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitBtn.click();
});

function setLoading(on) {
  submitBtn.disabled = on;
  submitBtn.classList.toggle("loading", on);
  if (!on) submitBtn.textContent = currentMode === "login" ? "Login" : "Create Account";
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove("success");
  errorEl.classList.add("visible");
}

function showSuccess(msg) {
  errorEl.textContent = msg;
  errorEl.classList.add("success", "visible");
}

function hideAlert() {
  errorEl.classList.remove("visible", "success");
}