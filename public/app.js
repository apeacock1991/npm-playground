const elements = {
  blankSlateButton: document.querySelector("#blank-slate-button"),
  codeEditor: document.querySelector("#code-editor"),
  logOutput: document.querySelector("#log-output"),
  packageName: document.querySelector("#package-name"),
  packageVersion: document.querySelector("#package-version"),
  resultOutput: document.querySelector("#result-output"),
  runButton: document.querySelector("#run-button"),
  runStatus: document.querySelector("#run-status"),
  sampleDescription: document.querySelector("#selected-sample-description"),
  samplesGrid: document.querySelector("#samples-grid"),
  warningsOutput: document.querySelector("#warnings-output"),
};

const state = {
  blankStarter: "",
  samples: [],
  selectedSampleId: null,
};

initialize().catch((error) => {
  renderStatus(`Could not load the playground: ${error.message}`, true);
});

async function initialize() {
  const response = await fetch("/api/samples");
  const payload = await response.json();

  state.blankStarter = payload.blankStarter;
  state.samples = payload.samples;

  renderSamples();
  applyBlankSlate();

  elements.blankSlateButton.addEventListener("click", applyBlankSlate);
  elements.runButton.addEventListener("click", runPlayground);
}

function renderSamples() {
  elements.samplesGrid.innerHTML = "";

  for (const sample of state.samples) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sample-button";
    button.innerHTML = `
      <span class="sample-title">${escapeHtml(sample.title)}</span>
    `;
    button.addEventListener("click", () => applySample(sample));
    elements.samplesGrid.append(button);
  }
}

function applyBlankSlate() {
  state.selectedSampleId = null;
  elements.packageName.value = "";
  elements.packageVersion.value = "latest";
  elements.codeEditor.value = state.blankStarter;
  elements.sampleDescription.textContent =
    "Blank slate selected. Choose any npm package, import from that package name directly, and write normal module code. Leading imports stay at the top and the rest is auto-run.";
  syncSelectedSampleStyles();
  renderStatus("Blank slate ready.", false);
  elements.resultOutput.textContent = "Run a package example to see output here.";
  elements.logOutput.textContent = "No logs yet.";
  elements.warningsOutput.textContent = "No warnings.";
}

function applySample(sample) {
  state.selectedSampleId = sample.id;
  elements.packageName.value = sample.packageName;
  elements.packageVersion.value = sample.packageVersion;
  elements.codeEditor.value = sample.code;
  elements.sampleDescription.textContent = `${sample.description} Import from "${sample.packageName}".`;
  syncSelectedSampleStyles();
  renderStatus(`Loaded sample: ${sample.title}.`, false);
}

function syncSelectedSampleStyles() {
  const buttons = elements.samplesGrid.querySelectorAll(".sample-button");

  buttons.forEach((button, index) => {
    const sample = state.samples[index];
    button.classList.toggle("is-selected", sample?.id === state.selectedSampleId);
  });
}

async function runPlayground() {
  const packageName = elements.packageName.value.trim();
  const packageVersion = elements.packageVersion.value.trim() || "latest";
  const code = elements.codeEditor.value;

  if (!packageName) {
    renderStatus("Enter an npm package first.", true);
    elements.packageName.focus();
    return;
  }

  if (!code.trim()) {
    renderStatus("Add some code before running.", true);
    elements.codeEditor.focus();
    return;
  }

  setRunning(true);
  renderStatus(`Bundling ${packageName}@${packageVersion} and executing your code...`, false);
  elements.resultOutput.textContent = "Running...";
  elements.logOutput.textContent = "Capturing console output...";
  elements.warningsOutput.textContent = "Waiting for bundle warnings...";

  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        packageName,
        packageVersion,
        code,
      }),
    });

    const payload = await response.json();
    renderExecution(payload);
  } catch (error) {
    renderStatus(`Request failed: ${error.message}`, true);
    elements.resultOutput.textContent = error.message;
    elements.logOutput.textContent = "No logs captured.";
    elements.warningsOutput.textContent = "No warnings.";
  } finally {
    setRunning(false);
  }
}

function renderExecution(payload) {
  const warnings = Array.isArray(payload.bundleWarnings) ? payload.bundleWarnings : [];
  const logs = Array.isArray(payload.logs) ? payload.logs : [];
  const duration = typeof payload.durationMs === "number" ? ` in ${payload.durationMs} ms` : "";

  if (payload.ok) {
    renderStatus(`Execution succeeded${duration}.`, false);
    elements.resultOutput.textContent = formatResult(payload.result);
  } else {
    const phase = payload.phase ? `${payload.phase} failed` : "Execution failed";
    renderStatus(`${phase}${duration}.`, true);
    elements.resultOutput.textContent = formatError(payload.error);
  }

  elements.logOutput.textContent = logs.length
    ? logs.map((entry) => `[${entry.level}] ${entry.message}`).join("\n")
    : "No logs captured.";

  elements.warningsOutput.textContent = warnings.length ? warnings.join("\n\n") : "No warnings.";
}

function renderStatus(message, isError) {
  elements.runStatus.textContent = message;
  elements.runStatus.classList.toggle("status-error", isError);
  elements.runStatus.classList.toggle("status-success", !isError);
}

function setRunning(isRunning) {
  elements.runButton.disabled = isRunning;
  elements.runButton.textContent = isRunning ? "Running..." : "Run code";
}

function formatResult(result) {
  if (!result) {
    return "No result returned.";
  }

  if (result.kind === "string") {
    return result.value;
  }

  if (result.kind === "undefined") {
    return "undefined";
  }

  return JSON.stringify(result.value, null, 2);
}

function formatError(error) {
  if (!error) {
    return "Unknown error";
  }

  if (error.stack) {
    return `${error.name}: ${error.message}\n\n${error.stack}`;
  }

  return `${error.name || "Error"}: ${error.message || String(error)}`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
