const status = document.querySelector("#teacher-status");
const content = document.querySelector("#teacher-content");
const quizSelect = document.querySelector("#teacher-quiz-select");
const editForm = document.querySelector("#edit-quiz-form");
const addQuestionForm = document.querySelector("#add-question-form");
const questionList = document.querySelector("#question-list");
const csvFile = document.querySelector("#csv-file");
const csvStatus = document.querySelector("#csv-status");
const csvPreviewList = document.querySelector("#csv-preview-list");
const csvImport = document.querySelector("#csv-import");
let quizzes = [];
let csvText = "";
let csvQuizId = "";

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The request could not be completed.");
  return result;
}

function jsonOptions(method, body) {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function selectedQuiz() {
  return quizzes.find((quiz) => quiz.id === quizSelect.value);
}

function populateQuizSelectors() {
  const options = quizzes.map((quiz) => new Option(quiz.title, quiz.id));
  for (const select of [quizSelect, document.querySelector("#assignment-quiz")]) {
    const placeholder = new Option("Select a quiz", "");
    select.replaceChildren(placeholder, ...options.map((option) => option.cloneNode(true)));
  }
}

function renderQuestions(questions) {
  questionList.replaceChildren();
  questions.forEach((question) => {
    const form = document.createElement("form");
    form.className = "teacher-question teacher-form";
    form.dataset.id = question.id;
    const text = document.createElement("label");
    text.textContent = `Question ${question.position}`;
    const textInput = document.createElement("input");
    textInput.name = "text";
    textInput.value = question.text;
    textInput.required = true;
    text.append(textInput);
    form.append(text);
    question.options.forEach((option, index) => {
      const label = document.createElement("label");
      label.textContent = `Choice ${String.fromCharCode(65 + index)}`;
      const input = document.createElement("input");
      input.name = `choice_${index}`;
      input.value = option;
      input.required = true;
      label.append(input);
      form.append(label);
    });
    const correct = document.createElement("label");
    correct.textContent = "Correct choice";
    const select = document.createElement("select");
    select.name = "correct_index";
    ["A", "B", "C", "D"].forEach((letter, index) => {
      const option = new Option(letter, String(index));
      option.selected = index === question.correct_index;
      select.add(option);
    });
    correct.append(select);
    form.append(correct);
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "quiz-secondary-button";
    save.textContent = "Save question";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "quiz-secondary-button";
    remove.textContent = "Delete question";
    remove.addEventListener("click", async () => {
      if (!confirm("Delete this question?")) return;
      try {
        await api(`/api/admin/questions/${question.id}`, { method: "DELETE" });
        await loadQuizzes();
        status.textContent = "Question deleted.";
      } catch (error) {
        status.textContent = error.message;
      }
    });
    form.append(save, remove);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      try {
        await api(`/api/admin/questions/${question.id}`, jsonOptions("PUT", {
          text: data.get("text"),
          options: [0, 1, 2, 3].map((index) => data.get(`choice_${index}`)),
          correct_index: Number(data.get("correct_index")),
        }));
        await loadQuizzes();
        status.textContent = "Question saved.";
      } catch (error) {
        status.textContent = error.message;
      }
    });
    questionList.append(form);
  });
}

async function loadSelectedQuiz() {
  const quiz = selectedQuiz();
  if (!quiz) {
    editForm.hidden = true;
    addQuestionForm.hidden = true;
    questionList.replaceChildren();
    return;
  }
  editForm.hidden = false;
  addQuestionForm.hidden = false;
  for (const field of ["title", "description", "difficulty", "base_points"]) {
    editForm.elements[field].value = quiz[field] ?? "";
  }
  renderQuestions(quiz.questions || []);
}

async function loadQuizzes() {
  const selectedId = quizSelect.value;
  const assignmentSelect = document.querySelector("#assignment-quiz");
  const assignedQuizId = assignmentSelect.value;
  quizzes = await api("/api/admin/quizzes");
  populateQuizSelectors();
  quizSelect.value = selectedId;
  assignmentSelect.value = assignedQuizId;
  await loadSelectedQuiz();
}

document.querySelector("#create-quiz-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  try {
    const created = await api("/api/admin/quizzes", jsonOptions("POST", {
      title: data.get("title"),
      description: data.get("description") || "",
      difficulty: data.get("difficulty"),
      base_points: Number(data.get("base_points")),
    }));
    form.reset();
    await loadQuizzes();
    quizSelect.value = created.id;
    await loadSelectedQuiz();
    status.textContent = "Quiz created. Add questions before players can take it.";
  } catch (error) {
    status.textContent = error.message;
  }
});

quizSelect.addEventListener("change", () => {
  csvText = "";
  csvQuizId = "";
  csvImport.disabled = true;
  csvPreviewList.replaceChildren();
  csvStatus.textContent = "";
  loadSelectedQuiz();
});

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(editForm);
  try {
    await api(`/api/admin/quizzes/${quizSelect.value}`, jsonOptions("PUT", {
      title: data.get("title"),
      description: data.get("description") || "",
      difficulty: data.get("difficulty"),
      base_points: Number(data.get("base_points")),
    }));
    status.textContent = "Quiz details saved.";
    await loadQuizzes();
  } catch (error) {
    status.textContent = error.message;
  }
});

addQuestionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(addQuestionForm);
  try {
    await api(`/api/admin/quizzes/${quizSelect.value}/questions`, jsonOptions("POST", {
      text: data.get("text"),
      options: ["choice_a", "choice_b", "choice_c", "choice_d"].map((key) => data.get(key)),
      correct_index: Number(data.get("correct_index")),
    }));
    addQuestionForm.reset();
    await loadQuizzes();
    status.textContent = "Question added.";
  } catch (error) {
    status.textContent = error.message;
  }
});

csvFile.addEventListener("change", () => {
  csvText = "";
  csvQuizId = "";
  csvStatus.textContent = "";
  csvImport.disabled = true;
  csvPreviewList.replaceChildren();
});

document.querySelector("#csv-preview").addEventListener("click", async () => {
  const file = csvFile.files[0];
  const quizId = quizSelect.value;
  if (!file || !quizId) {
    csvStatus.textContent = "Choose a quiz and CSV file first.";
    return;
  }
  try {
    csvImport.disabled = true;
    csvText = await file.text();
    const preview = await api(`/api/admin/quizzes/${quizId}/upload`, jsonOptions("POST", { csv: csvText }));
    csvPreviewList.replaceChildren();
    preview.valid_rows.forEach((row) => {
      const item = document.createElement("li");
      item.textContent = `Row ${row.row}: ${row.text} (${row.options.join(" / ")}). Correct: ${String.fromCharCode(65 + row.correct_index)}`;
      csvPreviewList.append(item);
    });
    preview.invalid_rows.forEach((row) => {
      const item = document.createElement("li");
      item.textContent = `Row ${row.row}: ${row.errors.join("; ")}`;
      csvPreviewList.append(item);
    });
    csvStatus.textContent = `${preview.valid_rows.length} valid, ${preview.invalid_rows.length} invalid. Nothing has been imported yet.`;
    csvQuizId = quizId;
    csvImport.disabled = preview.valid_rows.length === 0;
  } catch (error) {
    csvStatus.textContent = error.message;
  }
});

csvImport.addEventListener("click", async () => {
  if (!csvText || !csvQuizId || csvQuizId !== quizSelect.value) return;
  csvImport.disabled = true;
  try {
    const result = await api(`/api/admin/quizzes/${csvQuizId}/import`, jsonOptions("POST", { csv: csvText }));
    csvStatus.textContent = `Imported ${result.imported} questions; ${result.invalid_rows.length} invalid rows were skipped.`;
    csvImport.disabled = true;
    await loadQuizzes();
  } catch (error) {
    csvStatus.textContent = error.message;
    csvStatus.textContent += " Preview the file again before retrying.";
  }
});

async function loadAssignments() {
  const [players, assignments] = await Promise.all([
    api("/api/admin/players"),
    api("/api/admin/assignments"),
  ]);
  const playerSelect = document.querySelector("#assignment-player");
  playerSelect.replaceChildren(new Option("Select a player", ""));
  players.forEach((player) => playerSelect.add(new Option(player.username, player.id)));
  const list = document.querySelector("#assignment-list");
  list.replaceChildren();
  assignments.forEach((assignment) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${assignment.quiz_title} → ${assignment.username} · ${assignment.completed_at ? "Complete" : "Open"}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "quiz-secondary-button";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      try {
        await api(`/api/admin/assignments/${assignment.id}`, { method: "DELETE" });
        await loadAssignments();
        status.textContent = "Assignment removed.";
      } catch (error) {
        status.textContent = error.message;
      }
    });
    item.append(label, remove);
    list.append(item);
  });
}

document.querySelector("#assignment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    await api("/api/admin/assignments", jsonOptions("POST", {
      quiz_id: data.get("quiz_id"),
      player_id: data.get("player_id"),
    }));
    await loadAssignments();
    status.textContent = "Quiz assigned.";
  } catch (error) {
    status.textContent = error.message;
  }
});

(async () => {
  try {
    const user = await api("/api/me");
    if (!["teacher", "admin"].includes(user.role)) throw new Error("Teacher access is required.");
    content.hidden = false;
    status.textContent = `Signed in as ${user.username}.`;
    await Promise.all([loadQuizzes(), loadAssignments()]);
  } catch (error) {
    status.textContent = error.message;
    content.hidden = true;
  }
})();
