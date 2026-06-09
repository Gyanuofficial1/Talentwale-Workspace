/**
 * Contact Service
 */

const constants = require("../config/constants");
const ObjectKeys = Object.keys(constants);
for (const k of ObjectKeys) {
  if (typeof global[k] === "undefined") {
    global[k] = constants[k];
  }
}
const { getPool, ensureDbAvailable } = require("../config/database");
const helpers = require("../utils/helpers");
const cryptoUtils = require("../utils/crypto");
const { broadcastInboxEvent } = require("../middleware/requestHelpers");
const nodemailer = require("nodemailer");
// using built-in fetch
const net = require("net");
const dns = require("dns").promises;
const crypto = require("crypto");


function workbookToContacts(buffer, options = {}) {
  const workbook = xlsx.read(buffer, { type: "buffer" });
  const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
  if (!sheetNames.length) {
    return {
      sheetName: "",
      sheetNames: [],
      selectedSheetIndex: 0,
      columns: [],
      rows: [],
    };
  }

  const requestedSheetName = String(options.sheetName || "").trim();
  const requestedSheetIndex = Number.isFinite(options.sheetIndex)
    ? Math.max(0, Math.min(sheetNames.length - 1, Math.floor(options.sheetIndex)))
    : 0;
  const selectedSheetIndex = requestedSheetName
    ? Math.max(0, sheetNames.findIndex((name) => String(name).toLowerCase() === requestedSheetName.toLowerCase()))
    : requestedSheetIndex;
  const sheetName = sheetNames[selectedSheetIndex] || sheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(worksheet, { defval: "" });
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const requestedLimit = Number(options.rowLimit);
  const rowLimit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), SMTP_BULK_MAX_ROWS)
      : DEFAULT_CONTACT_ROWS_LIMIT;

  return {
    sheetName,
    sheetNames,
    selectedSheetIndex,
    columns,
    rows: rows.slice(0, rowLimit),
  };
}

function googleSheetCsvUrl(sheetUrl) {
  const url = new URL(sheetUrl);
  const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);

  if (!match) {
    throw new Error("Enter a valid Google Sheet URL.");
  }

  const gid = url.searchParams.get("gid") || "0";
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
}

module.exports = {
  workbookToContacts,
  googleSheetCsvUrl
};
