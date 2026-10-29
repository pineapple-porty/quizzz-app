(() => {
  const applicationForm = document.querySelector("#teacher-application-form");
  const institutionInput = document.querySelector("#institution-search");
  const suggestions = document.querySelector("#institution-suggestions");
  const selectedInstitution = document.querySelector("#selected-institution");
  const applicationMessage = document.querySelector("#application-message");
  const codePanel = document.querySelector("#teacher-code-panel");
  const codeOutput = document.querySelector("#assigned-code");
  const codeInput = document.querySelector("#signup-code");
  const accountForm = document.querySelector("#teacher-account-form");
  const accountMessage = document.querySelector("#account-message");
  let selected = null;
  let searchTimer;
  let activeSearch;

  function setMessage(target, message, isError = false) {
    target.textContent = message;
    target.dataset.error = isError ? "true" : "false";
  }

  function closeSuggestions() {
    suggestions.replaceChildren();
    suggestions.hidden = true;
    institutionInput.setAttribute("aria-expanded", "false");
  }

  async function searchInstitutions(query) {
    if (activeSearch) activeSearch.abort();
    activeSearch = new AbortController();
    try {
      const response = await fetch(`/api/teacher-applications/search?q=${encodeURIComponent(query)}`, {
        signal: activeSearch.signal,
        headers: { Accept: "application/json" },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to search the directory.");
      suggestions.replaceChildren();
      if (!data.length) {
        setMessage(applicationMessage, "No matching public schools or districts found. Try another keyword.", true);
        closeSuggestions();
        return;
      }
      for (const institution of data) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "teacher-suggestion";
        option.setAttribute("role", "option");
        const label = institution.type === "district" ? "District" : "School";
        option.textContent = `${institution.name} · ${label}${institution.address ? ` · ${institution.address}` : ""}`;
        option.addEventListener("click", () => {
          selected = institution;
          institutionInput.value = institution.name;
          selectedInstitution.textContent = `Selected ${label.toLowerCase()}: ${institution.name}${institution.address ? ` — ${institution.address}` : ""}`;
          selectedInstitution.hidden = false;
          setMessage(applicationMessage, "");
          closeSuggestions();
        });
        suggestions.append(option);
      }
      suggestions.hidden = false;
      institutionInput.setAttribute("aria-expanded", "true");
      setMessage(applicationMessage, `${data.length} directory match${data.length === 1 ? "" : "es"} found.`);
    } catch (error) {
      if (error.name === "AbortError") return;
      closeSuggestions();
      setMessage(applicationMessage, error.message || "Unable to search the directory. Try again.", true);
    }
  }

  institutionInput.addEventListener("input", () => {
    selected = null;
    selectedInstitution.hidden = true;
    closeSuggestions();
    const query = institutionInput.value.trim();
    window.clearTimeout(searchTimer);
    if (query.length < 2) {
      setMessage(applicationMessage, query ? "Enter at least 2 characters to search." : "");
      return;
    }
    setMessage(applicationMessage, "Searching the NCES directory…");
    searchTimer = window.setTimeout(() => searchInstitutions(query), 250);
  });

  document.addEventListener("click", (event) => {
    if (!suggestions.contains(event.target) && event.target !== institutionInput) closeSuggestions();
  });

  applicationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!applicationForm.reportValidity()) return;
    if (!selected || selected.name !== institutionInput.value.trim()) {
      setMessage(applicationMessage, "Select a school or district from the directory results.", true);
      institutionInput.focus();
      return;
    }
    const button = applicationForm.querySelector("button[type=submit]");
    button.disabled = true;
    setMessage(applicationMessage, "Submitting your application…");
    try {
      const response = await fetch("/api/teacher-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          name: document.querySelector("#applicant-name").value.trim(),
          email: document.querySelector("#applicant-email").value.trim(),
          institution_type: selected.type,
          institution_id: selected.id,
          institution_name: selected.name,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to create your application.");
      document.querySelector("#assigned-username").textContent = data.username;
      document.querySelector("#teacher-username").value = data.username;
      const isDemo = data.mode === "demo";
      document.querySelector("#demo-code-row").hidden = !isDemo;
      document.querySelector("#signup-code-field").hidden = isDemo;
      codeInput.required = !isDemo;
      if (isDemo) {
        codeOutput.textContent = data.demo_code;
        codeInput.value = data.demo_code;
      } else {
        codePanel.querySelector("h2").textContent = "Check your school email";
        document.querySelector("#code-instructions").textContent = data.message;
        codeInput.value = "";
      }
      codePanel.hidden = false;
      applicationForm.hidden = true;
      setMessage(applicationMessage, "");
      document.querySelector("#teacher-password").focus();
    } catch (error) {
      setMessage(applicationMessage, error.message || "Unable to create your application. Try again.", true);
      button.disabled = false;
    }
  });

  document.querySelector("#copy-code").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(codeOutput.textContent);
      button.textContent = "Copied";
    } catch {
      setMessage(accountMessage, "Select and copy the code above to save it.");
    }
  });

  accountForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!accountForm.reportValidity()) return;
    const button = accountForm.querySelector("button[type=submit]");
    button.disabled = true;
    setMessage(accountMessage, "Creating your account…");
    try {
      const response = await fetch("/api/auth/register-teacher", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          code: codeInput.value,
          password: document.querySelector("#teacher-password").value,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to create your account.");
      document.querySelector("#assigned-username").textContent = data.username;
      document.querySelector("#teacher-username").value = data.username;
      codePanel.querySelector("h2").textContent = "Teacher account created";
      codePanel.querySelector(":scope > p").textContent = `You are signed in as ${data.username}. Your code can no longer be used.`;
      codePanel.querySelector(".teacher-code-row").hidden = true;
      accountForm.hidden = true;
      const teacherToolsLink = document.createElement("a");
      teacherToolsLink.className = "button button--primary";
      teacherToolsLink.href = "/teacher.html";
      teacherToolsLink.textContent = "Open teacher tools";
      codePanel.append(teacherToolsLink);
    } catch (error) {
      setMessage(accountMessage, error.message || "Unable to create your account. Try again.", true);
      button.disabled = false;
    }
  });
})();
