const form = document.getElementById("verify-form");
const resultBody = document.getElementById("resultBody");
const summary = document.getElementById("summary");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = {
    sheetUrl: document.getElementById("sheetUrl").value.trim(),
    emailHeader: document.getElementById("emailHeader").value.trim(),
    maxRows: Number(document.getElementById("maxRows").value),
  };
  const apiKey = document.getElementById("apiKey").value.trim();

  summary.textContent = "Verification running...";
  resultBody.innerHTML = "";

  try {
    const response = await fetch("/api/verify-sheet", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.details || data.error || "Request failed");
    }

    const stats = data.summary;
    summary.textContent = `Processed ${stats.processedRows}/${stats.totalRowsRead} rows | Valid: ${stats.valid} | Invalid: ${stats.invalid}`;

    for (const row of data.results) {
      const tr = document.createElement("tr");
      const statusClass = row.status === "valid" ? "valid" : "invalid";

      tr.innerHTML = `
        <td>${escapeHtml(row.rowNumber)}</td>
        <td>${escapeHtml(row.email)}</td>
        <td><span class="status ${statusClass}">${escapeHtml(row.status)}</span></td>
        <td>${escapeHtml(row.reason)}</td>
      `;

      resultBody.appendChild(tr);
    }
  } catch (error) {
    summary.textContent = `Error: ${error.message}`;
  }
});
