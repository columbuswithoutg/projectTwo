const API = "/api";

const usernameEl = document.getElementById("auth-username");
const passwordEl = document.getElementById("auth-password");
const submitBtn  = document.getElementById("auth-submit");
const errorEl    = document.querySelector(".auth-error");
const tabs       = document.querySelectorAll(".auth-tab");

let currentMode = "login";

// If already logged in, skip straight to the app
if (localStorage.getItem("mcu_token")) {
  window.location.href = "/app.html";
}

// Tab switching
tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentMode = tab.dataset.tab;
    submitBtn.textContent = currentMode === "login" ? "Login" : "Create Account";
    errorEl.style.display = "none";
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

  submitBtn.disabled = true;
  submitBtn.textContent = "Please wait...";

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
      window.location.href = "/app.html"; // ← redirect to tracker
    } else {
      // After register, auto-switch to login tab
      showError("Account created! Please log in.", "green");
      tabs[0].click();
    }

  } catch (e) {
    showError("Server error. Is the server running?");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = currentMode === "login" ? "Login" : "Create Account";
  }
});

// Allow Enter key to submit
passwordEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitBtn.click();
});

function showError(msg, color = "red") {
  errorEl.textContent = msg;
  errorEl.style.color = color;
  errorEl.style.display = "block";
}