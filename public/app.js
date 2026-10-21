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
let currentUsername = null;

function setAccountStatus(message, isError = false) {
  if (!accountStatus) return;
  accountStatus.textContent = message;
  accountStatus.dataset.error = String(isError);
}

function showAccount(username) {
  if (!accountForms || !signedInPanel || !signedInUsername) return;
  currentUsername = username;
  accountForms.hidden = true;
  signedInPanel.hidden = false;
  signedInUsername.textContent = username;
  updateQuizButtonLabels();
}

function showAccountForms() {
  if (!accountForms || !signedInPanel) return;
  currentUsername = null;
  accountForms.hidden = false;
  signedInPanel.hidden = true;
  updateQuizButtonLabels();
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

function updateQuizButtonLabels() {
  document.querySelectorAll(".quiz-play-button").forEach((button) => {
    button.textContent = currentUsername ? "Start quiz" : "Log in to play";
  });
}

const quizList = document.querySelector("#quiz-list");
const quizListStatus = document.querySelector("#quiz-list-status");
const quizPlay = document.querySelector("#quiz-play");
const quizForm = document.querySelector("#quiz-form");
const quizQuestions = document.querySelector("#quiz-questions");
const quizFormStatus = document.querySelector("#quiz-form-status");
const quizResults = document.querySelector("#quiz-results");
let activeQuiz = null;

function setQuizListStatus(message, isError = false) {
  if (!quizListStatus) return;
  quizListStatus.textContent = message;
  quizListStatus.dataset.error = String(isError);
}

function createQuizCard(quiz) {
  const card = document.createElement("article");
  card.className = "quiz-card";

  const difficulty = document.createElement("p");
  difficulty.className = "quiz-card-difficulty";
  difficulty.textContent = String(quiz.difficulty || "").replaceAll("_", " ");

  const title = document.createElement("h3");
  title.textContent = quiz.title;

  const description = document.createElement("p");
  description.className = "quiz-card-description";
  description.textContent = quiz.description || "Ready for a quick challenge?";

  const button = document.createElement("button");
  button.className = "quiz-action-button quiz-play-button";
  button.type = "button";
  button.textContent = currentUsername ? "Start quiz" : "Log in to play";
  button.addEventListener("click", async () => {
    if (!currentUsername) {
      setQuizListStatus("Log in or create an account before starting a quiz.");
      document.querySelector("#account")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    await openQuiz(quiz.id);
  });

  card.append(difficulty, title, description, button);
  return card;
}

async function loadQuizList() {
  try {
    const quizzes = await requestJson("/api/quizzes");
    if (!Array.isArray(quizzes)) throw new Error("The quiz list response was invalid.");
    quizList.replaceChildren();
    if (quizzes.length === 0) {
      setQuizListStatus("No quizzes are available yet.");
      return;
    }
    quizzes.forEach((quiz) => quizList.append(createQuizCard(quiz)));
    setQuizListStatus("Choose a quiz to get started.");
  } catch (error) {
    setQuizListStatus(error.message, true);
  }
}

function renderQuizQuestions(quiz) {
  quizQuestions.replaceChildren();
  quiz.questions.forEach((question, questionIndex) => {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "quiz-question";
    const legend = document.createElement("legend");
    legend.textContent = `${questionIndex + 1}. ${question.text}`;
    fieldset.append(legend);

    question.options.forEach((option, optionIndex) => {
      const label = document.createElement("label");
      label.className = "quiz-answer";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `question-${questionIndex}`;
      input.value = String(optionIndex);
      input.required = true;
      const letter = document.createElement("span");
      letter.className = "quiz-answer-letter";
      letter.textContent = String.fromCharCode(65 + optionIndex);
      const answerText = document.createElement("span");
      answerText.textContent = option;
      label.append(input, letter, answerText);
      fieldset.append(label);
    });
    quizQuestions.append(fieldset);
  });
}

async function openQuiz(quizId) {
  const retrying = activeQuiz?.id === quizId && !quizResults.hidden;
  setQuizListStatus("");
  if (retrying) {
    quizResults.hidden = true;
    quizPlay.hidden = false;
    quizFormStatus.textContent = "Loading quiz…";
  }
  try {
    const quiz = await requestJson(`/api/quizzes/${encodeURIComponent(quizId)}`);
    if (
      !Array.isArray(quiz.questions) ||
      quiz.questions.length === 0 ||
      quiz.questions.some((question) => !Array.isArray(question.options) || question.options.length !== 4)
    ) {
      throw new Error("This quiz is not ready to play.");
    }
    activeQuiz = quiz;
    document.querySelector("#quiz-title").textContent = quiz.title;
    document.querySelector("#quiz-description").textContent = quiz.description || "";
    document.querySelector("#quiz-meta").textContent = `${String(quiz.difficulty || "").replaceAll("_", " ")} · ${quiz.questions.length} questions`;
    quizFormStatus.textContent = "";
    renderQuizQuestions(quiz);
    quizResults.hidden = true;
    quizPlay.hidden = false;
    quizList.hidden = true;
    quizPlay.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    if (retrying) {
      quizFormStatus.textContent = error.message;
    } else {
      setQuizListStatus(error.message, true);
    }
    if (error.message === "Authentication required") {
      document.querySelector("#account")?.scrollIntoView({ behavior: "smooth" });
    }
  }
}

function showQuizList() {
  activeQuiz = null;
  quizPlay.hidden = true;
  quizResults.hidden = true;
  quizList.hidden = false;
  setQuizListStatus("Choose a quiz to get started.");
  document.querySelector("#topics")?.scrollIntoView({ behavior: "smooth" });
}

function renderQuizResults(result) {
  quizPlay.hidden = true;
  quizResults.hidden = false;
  document.querySelector("#quiz-score").textContent = `${result.correct} of ${result.total} correct`;
  document.querySelector("#quiz-percent").textContent = `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(result.percent)}%`;
  const reviewList = document.querySelector("#quiz-review");
  reviewList.replaceChildren();

  result.review.forEach((item, index) => {
    const question = activeQuiz.questions[index];
    const reviewItem = document.createElement("li");
    reviewItem.className = item.your_answer === item.correct_index ? "quiz-review-item is-correct" : "quiz-review-item is-incorrect";
    const questionText = document.createElement("h5");
    questionText.textContent = item.question;
    const yourAnswer = document.createElement("p");
    yourAnswer.textContent = `Your answer: ${question.options[item.your_answer]}`;
    const correctAnswer = document.createElement("p");
    correctAnswer.textContent = `Correct answer: ${question.options[item.correct_index]}`;
    reviewItem.append(questionText, yourAnswer, correctAnswer);
    reviewList.append(reviewItem);
  });
  quizResults.scrollIntoView({ behavior: "smooth", block: "start" });
}

quizForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeQuiz) return;

  const answers = activeQuiz.questions.map((_, index) => {
    const selected = quizForm.querySelector(`input[name="question-${index}"]:checked`);
    return selected ? Number(selected.value) : null;
  });
  if (answers.some((answer) => answer === null)) {
    quizFormStatus.textContent = "Answer every question before submitting.";
    return;
  }

  const submitButton = quizForm.querySelector("button[type=submit]");
  submitButton.disabled = true;
  quizFormStatus.textContent = "";
  try {
    const result = await requestJson(`/api/quizzes/${encodeURIComponent(activeQuiz.id)}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    if (!Array.isArray(result.review) || result.review.length !== activeQuiz.questions.length) {
      throw new Error("The results response was invalid.");
    }
    renderQuizResults(result);
  } catch (error) {
    quizFormStatus.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("#quiz-back")?.addEventListener("click", showQuizList);
document.querySelector("#quiz-results-back")?.addEventListener("click", showQuizList);
document.querySelector("#quiz-retry")?.addEventListener("click", () => {
  if (activeQuiz) openQuiz(activeQuiz.id);
});

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

loadQuizList();
