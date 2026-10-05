async function showHealth(endpoint, elementId, successLabel) {
  const status = document.getElementById(elementId);

  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`Health check returned ${response.status}`);
    }

    status.textContent = successLabel;
    status.dataset.state = "ok";
  } catch {
    status.textContent = "Unavailable";
    status.dataset.state = "error";
  }
}

showHealth("/api/health", "api-status", "Online");
showHealth("/api/health/database", "database-status", "Connected");
