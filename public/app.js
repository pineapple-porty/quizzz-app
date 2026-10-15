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

const signInLink = document.querySelector("#nav-sign-in");
const registerLink = document.querySelector("#nav-register");
const accountGreeting = document.querySelector("#account-greeting");
const logoutButton = document.querySelector("#nav-logout");

async function updateAccountNavigation() {
  if (!signInLink || !registerLink || !accountGreeting || !logoutButton) return;

  try {
    const response = await fetch("/api/me");
    if (response.status === 401) return;
    if (!response.ok) throw new Error("Could not check sign-in status.");

    const user = await response.json();
    accountGreeting.textContent = `Signed in as ${user.username}`;
    accountGreeting.hidden = false;
    signInLink.hidden = true;
    registerLink.hidden = true;
    logoutButton.hidden = false;
  } catch (error) {
    console.error("Could not update account navigation:", error);
  }
}

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Could not sign out.");
      window.location.reload();
    } catch (error) {
      console.error("Could not sign out:", error);
      logoutButton.disabled = false;
    }
  });
}

updateAccountNavigation();
