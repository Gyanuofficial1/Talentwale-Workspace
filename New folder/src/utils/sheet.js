const { parse } = require("csv-parse/sync");

function buildCsvExportUrl(sheetUrl) {
  const url = new URL(sheetUrl);

  if (url.hostname !== "docs.google.com") {
    throw new Error("Only public Google Sheet links are allowed");
  }

  if (url.searchParams.get("format") === "csv") {
    return url.toString();
  }

  const match = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) {
    throw new Error("Invalid Google Sheet URL");
  }

  const sheetId = match[1];
  const gid = url.searchParams.get("gid") || "0";

  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

async function fetchSheetRows(sheetUrl, timeoutMs) {
  const csvUrl = buildCsvExportUrl(sheetUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(csvUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "Talentwale-MailVerifier/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch sheet. HTTP ${response.status}`);
    }

    const csvText = await response.text();

    return parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Sheet request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function pickEmailColumn(rows, emailHeader) {
  if (!rows.length) {
    return [];
  }

  const headers = Object.keys(rows[0]);
  const wanted = emailHeader.trim().toLowerCase();
  const matchedHeader = headers.find((header) => header.trim().toLowerCase() === wanted);

  if (!matchedHeader) {
    throw new Error(`Email header '${emailHeader}' not found in sheet`);
  }

  return rows.map((row, index) => ({
    rowNumber: index + 2,
    email: String(row[matchedHeader] || "").trim(),
  }));
}

module.exports = {
  fetchSheetRows,
  pickEmailColumn,
};
