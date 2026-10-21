const menuToggle = document.querySelector(".menu-toggle");
const primaryNav = document.querySelector("#primary-nav");

function closeMenu() {
  if (!menuToggle || !primaryNav) return;

  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Open menu");
  primaryNav.classList.remove("is-open");
}

if (menuToggle && primaryNav) {
  menuToggle.addEventListener("click", () => {
    const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!isOpen));
    menuToggle.setAttribute("aria-label", isOpen ? "Open menu" : "Close menu");
    primaryNav.classList.toggle("is-open", !isOpen);
  });

  primaryNav.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
}

const accountStatus = document.querySelector("#account-status");
const accountForms = document.querySelector("#account-forms");
const signedInPanel = document.querySelector("#signed-in-panel");
const signedInUsername = document.querySelector("#signed-in-username");

function setAccountStatus(message, isError = false) {
  if (!accountStatus) return;
  accountStatus.textContent = message;
  accountStatus.dataset.error = String(isError);
}

function showAccount(username) {
  if (!accountForms || !signedInPanel || !signedInUsername) return;
  accountForms.hidden = true;
  signedInPanel.hidden = false;
  signedInUsername.textContent = username;
}

function showAccountForms() {
  if (!accountForms || !signedInPanel) return;
  accountForms.hidden = false;
  signedInPanel.hidden = true;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("The server returned an unexpected response.");
  }
  if (!response.ok) {
    throw new Error(body.error || "The request could not be completed.");
  }
  return body;
}

async function submitAccountForm(form, endpoint, onSuccess) {
  const formData = new FormData(form);
  const submitButton = form.querySelector("button[type=submit]");
  submitButton.disabled = true;
  setAccountStatus("");
  try {
    const result = await requestJson(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password"),
      }),
    });
    onSuccess(result);
  } catch (error) {
    setAccountStatus(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
}

const loginForm = document.querySelector("#login-form");
if (loginForm) {
  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitAccountForm(loginForm, "/api/auth/login", (result) => {
      showAccount(result.username);
      setAccountStatus("You’re logged in.");
      loginForm.reset();
    });
  });
}

const registerForm = document.querySelector("#register-form");
if (registerForm) {
  registerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitAccountForm(registerForm, "/api/auth/register", () => {
      registerForm.reset();
      setAccountStatus("Account created. Log in to continue.");
    });
  });
}

const logoutButton = document.querySelector("#logout-button");
if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    setAccountStatus("");
    try {
      await requestJson("/api/auth/logout", { method: "POST" });
      showAccountForms();
      setAccountStatus("You’re logged out.");
    } catch (error) {
      setAccountStatus(error.message, true);
    } finally {
      logoutButton.disabled = false;
    }
  });
}

if (accountForms && signedInPanel) {
  requestJson("/api/me")
    .then((user) => showAccount(user.username))
    .catch((error) => {
      showAccountForms();
      if (error.message !== "Authentication required") {
        setAccountStatus(error.message, true);
      }
    });
}
