const authForm = document.querySelector(".auth-form");

function showAuthMessage(message, state = "") {
  const messageElement = document.querySelector("#auth-message");
  if (!messageElement) return;

  messageElement.textContent = message;
  if (state) {
    messageElement.dataset.state = state;
  } else {
    delete messageElement.dataset.state;
  }
}

if (authForm) {
  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showAuthMessage("");

    const formData = new FormData(authForm);
    const username = String(formData.get("username") ?? "");
    const password = String(formData.get("password") ?? "");
    const action = authForm.dataset.authAction;

    if (!authForm.elements.username.validity.valid) {
      authForm.elements.username.reportValidity();
      return;
    }
    if (!password || (action === "register" && password.length < 8)) {
      authForm.elements.password.reportValidity();
      return;
    }
    if (
      action === "register" &&
      password !== String(formData.get("confirmPassword") ?? "")
    ) {
      showAuthMessage("Those passwords don’t match.", "error");
      authForm.elements.confirmPassword.focus();
      return;
    }

    const submitButton = authForm.querySelector("button[type='submit']");
    submitButton.disabled = true;
    submitButton.querySelector("span").textContent =
      action === "register" ? "Creating account…" : "Logging in…";

    try {
      const response = await fetch(`/api/auth/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json();

      if (!response.ok) {
        showAuthMessage(result.error || "Something went wrong. Please try again.", "error");
        return;
      }

      if (action === "register") {
        window.location.assign("/login.html?registered=1");
        return;
      }
      window.location.assign("/");
    } catch {
      showAuthMessage("Could not connect. Check your connection and try again.", "error");
    } finally {
      submitButton.disabled = false;
      submitButton.querySelector("span").textContent =
        action === "register" ? "Create account" : "Log in";
    }
  });
}

const authNotice = document.querySelector("#auth-notice");
if (authNotice && new URLSearchParams(window.location.search).has("registered")) {
  authNotice.textContent = "Your account is ready. Log in to get started.";
  authNotice.hidden = false;
}
