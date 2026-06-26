// ─── AWS Amplify + Lambda API URL Configuration ───────────────────────────────
// Jab Amplify pe deploy hoga tab window.__API_CONFIG__.apiUrl mein API Gateway URL hogi.
// Local dev mein yeh empty string hoga (relative URLs kaam karenge).
(function () {
  const API_BASE_URL = (window.__API_CONFIG__ && window.__API_CONFIG__.apiUrl &&
    window.__API_CONFIG__.apiUrl !== "__AMPLIFY_API_URL__")
    ? String(window.__API_CONFIG__.apiUrl).replace(/\/$/, "")
    : "";

  window.__API_BASE_URL__ = API_BASE_URL;

  // fetch() patch
  const _originalFetch = window.fetch.bind(window);
  window.fetch = async function (url, ...args) {
    let requestUrl = url;
    if (typeof url === "string" && url.startsWith("/") && API_BASE_URL) {
      requestUrl = API_BASE_URL + url;
    }

    const token = localStorage.getItem("dashboard_token");
    if (token && typeof url === "string" && url.startsWith("/api/")) {
      const options = args[0] || {};
      options.headers = options.headers || {};
      if (options.headers instanceof Headers) {
        options.headers.set("Authorization", `Bearer ${token}`);
      } else {
        options.headers["Authorization"] = `Bearer ${token}`;
      }
      args[0] = options;
    }

    const response = await _originalFetch(requestUrl, ...args);
    if (response.status === 401 && typeof url === "string" && !url.includes("/api/login")) {
      localStorage.removeItem("dashboard_token");
      const overlay = document.getElementById("loginOverlay");
      const mainApp = document.getElementById("mainAppLayout");
      if (overlay) overlay.classList.remove("is-hidden");
      if (mainApp) mainApp.style.display = "none";
    }
    return response;
  };

  // EventSource patch
  if (typeof window.EventSource !== "undefined") {
    const _OriginalEventSource = window.EventSource;
    window.EventSource = function (url, options) {
      let requestUrl = url;
      if (typeof url === "string" && url.startsWith("/") && API_BASE_URL) {
        requestUrl = API_BASE_URL + url;
      }
      return new _OriginalEventSource(requestUrl, options);
    };
    window.EventSource.prototype = _OriginalEventSource.prototype;
    window.EventSource.CONNECTING = _OriginalEventSource.CONNECTING;
    window.EventSource.OPEN = _OriginalEventSource.OPEN;
    window.EventSource.CLOSED = _OriginalEventSource.CLOSED;
  }
})();

// Initialize Auth Flow
document.addEventListener("DOMContentLoaded", () => {
  const loginOverlay = document.getElementById("loginOverlay");
  const mainAppLayout = document.getElementById("mainAppLayout");
  const loginForm = document.getElementById("loginForm");
  const loginPassword = document.getElementById("loginPassword");
  const loginError = document.getElementById("loginError");
  const loginSubmitBtn = document.getElementById("loginSubmitBtn");

  function checkAuth() {
    const token = localStorage.getItem("dashboard_token");
    if (!token) {
      loginOverlay.classList.remove("is-hidden");
      mainAppLayout.style.display = "none";
    } else {
      loginOverlay.classList.add("is-hidden");
      mainAppLayout.style.display = "flex";
    }
  }

  if (loginOverlay) {
    checkAuth();

    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      loginError.classList.add("is-hidden");
      const originalText = loginSubmitBtn.textContent;
      loginSubmitBtn.textContent = "Verifying...";
      loginSubmitBtn.disabled = true;

      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: loginPassword.value })
        });
        const data = await res.json();
        if (res.ok && data.token) {
          localStorage.setItem("dashboard_token", data.token);
          loginOverlay.classList.add("is-hidden");
          mainAppLayout.style.display = "flex";
          loginPassword.value = "";

          if (typeof window.loadDashboardSummary === 'function') {
            window.loadDashboardSummary();
          }
        } else {
          loginError.textContent = data.error || "Invalid password. Please try again.";
          loginError.classList.remove("is-hidden");
        }
      } catch (err) {
        loginError.textContent = "Connection error. Please try again.";
        loginError.classList.remove("is-hidden");
      } finally {
        loginSubmitBtn.textContent = originalText;
        loginSubmitBtn.disabled = false;
      }
    });
  }
});
// ─────────────────────────────────────────────────────────────────────────────

const form = document.querySelector("#sendForm");
const templateSelect = document.querySelector("#templateName");
const templatePicker = document.querySelector("#templatePicker");
const templatePickerButton = document.querySelector("#templatePickerButton");
const templatePickerValue = document.querySelector("#templatePickerValue");
const templatePickerMenu = document.querySelector("#templatePickerMenu");
const phoneInput = document.querySelector("#recipientPhoneNumber");
const sendButton = document.querySelector("#sendButton");
const loadSheetButton = document.querySelector("#loadSheetButton");
const sendBulkButton = document.querySelector("#sendBulkButton");
const stopBulkButton = document.querySelector("#stopBulkButton");
const sheetUrlInput = document.querySelector("#sheetUrl");
const fileUpload = document.querySelector("#fileUpload");
const bulkTemplateSelect = document.querySelector("#bulkTemplateName");
const phoneColumnSelect = document.querySelector("#phoneColumn");
const singleValueOverrides = document.querySelector("#singleValueOverrides");
const valueMappings = document.querySelector("#valueMappings");
const statusBadge = document.querySelector("#statusBadge");
const contactCount = document.querySelector("#contactCount");
const contactCountLabel = document.querySelector("#contactCountLabel");
const reportPendingCount = document.querySelector("#reportPendingCount");
const reportPendingLabel = document.querySelector("#reportPendingLabel");
const reportSentCount = document.querySelector("#reportSentCount");
const reportSentLabel = document.querySelector("#reportSentLabel");
const reportDeliveredCount = document.querySelector("#reportDeliveredCount");
const reportDeliveredLabel = document.querySelector("#reportDeliveredLabel");
const reportFailedCount = document.querySelector("#reportFailedCount");
const reportFailedLabel = document.querySelector("#reportFailedLabel");
const reportBody = document.querySelector("#reportBody");
const downloadReportButton = document.querySelector("#downloadReportButton");
const resultBox = document.querySelector("#resultBox");
const clearLogButton = document.querySelector("#clearLogButton");
const contactsHead = document.querySelector("#contactsHead");
const contactsBody = document.querySelector("#contactsBody");
const inboxList = document.querySelector("#inboxList");
const chatCount = document.querySelector("#chatCount");
const threadTitle = document.querySelector("#threadTitle");
const threadSubtitle = document.querySelector("#threadSubtitle");
const threadAvatar = document.querySelector("#threadAvatar");
const threadMessages = document.querySelector("#threadMessages");
const replyForm = document.querySelector("#replyForm");
const replyInput = document.querySelector("#replyInput");
const replyButton = document.querySelector("#replyButton");
const attachButton = document.querySelector("#attachButton");
const replyFileInput = document.querySelector("#replyFileInput");
const replyAttachmentPreview = document.querySelector("#replyAttachmentPreview");
const chatSearchInput = document.querySelector("#chatSearchInput");
const viewTabs = document.querySelectorAll(".view-tab");
const dashboardView = document.querySelector("#dashboardView");
const analyticsView = document.querySelector("#analyticsView");
const configView = document.querySelector("#configView");
const chatView = document.querySelector("#chatView");
const pageTitle = document.querySelector("#pageTitle");
const quickSendCard = document.querySelector("#quickSendCard");
const bulkSendCard = document.querySelector("#bulkSendCard");
const audiencePreviewCard = document.querySelector("#audiencePreviewCard");
const smtpBulkCard = document.querySelector("#smtpBulkCard");
const smtpPreviewCard = document.querySelector("#smtpPreviewCard");
const smtpAnalyticsCard = document.querySelector("#smtpAnalyticsCard");
const smtpSheetUrlInput = document.querySelector("#smtpSheetUrl");
const loadSmtpSheetButton = document.querySelector("#loadSmtpSheetButton");
const smtpAudienceUpload = document.querySelector("#smtpAudienceUpload");
const smtpAudienceSheet = document.querySelector("#smtpAudienceSheet");
const smtpAudienceSheetWrap = document.querySelector("#smtpAudienceSheetWrap");
const smtpRecipientColumn = document.querySelector("#smtpRecipientColumn");
const smtpRecipientColumnWrap = document.querySelector("#smtpRecipientColumnWrap");
const smtpProvider = document.querySelector("#smtpProvider");
const smtpFromAddress = document.querySelector("#smtpFromAddress");
const smtpReplyToAddress = document.querySelector("#smtpReplyToAddress");
const smtpSubjectTemplate = document.querySelector("#smtpSubjectTemplate");
const smtpBodyTemplate = document.querySelector("#smtpBodyTemplate");
const smtpBodyFormat = document.querySelector("#smtpBodyFormat");
const smtpSendRatePerMinuteInput = document.querySelector("#smtpSendRatePerMinute");
const smtpPreviewButton = document.querySelector("#smtpPreviewButton");
const smtpVariableTokens = document.querySelector("#smtpVariableTokens");
const sendSmtpTestButton = document.querySelector("#sendSmtpTestButton");
const sendSmtpBulkButton = document.querySelector("#sendSmtpBulkButton");
const stopSmtpBulkButton = document.querySelector("#stopSmtpBulkButton");
const smtpPreviewHead = document.querySelector("#smtpPreviewHead");
const smtpPreviewBody = document.querySelector("#smtpPreviewBody");
const smtpPreviewModal = document.querySelector("#smtpPreviewModal");
const smtpPreviewCloseButton = document.querySelector("#smtpPreviewCloseButton");
const smtpPreviewMeta = document.querySelector("#smtpPreviewMeta");
const smtpPreviewSubject = document.querySelector("#smtpPreviewSubject");
const smtpMailPreviewBody = document.querySelector("#smtpMailPreviewBody");
const smtpAnalyticsUniqueOpenCount = document.querySelector("#smtpAnalyticsUniqueOpenCount");
const smtpAnalyticsUniqueClickCount = document.querySelector("#smtpAnalyticsUniqueClickCount");
const smtpAnalyticsOpenRate = document.querySelector("#smtpAnalyticsOpenRate");
const smtpAnalyticsClickRate = document.querySelector("#smtpAnalyticsClickRate");
const smtpAnalyticsChart = document.querySelector("#smtpAnalyticsChart");
const smtpAnalyticsMeta = document.querySelector("#smtpAnalyticsMeta");
const smtpAnalyticsRange = document.querySelector("#smtpAnalyticsRange");
const smtpAnalyticsTopLinks = document.querySelector("#smtpAnalyticsTopLinks");
const smtpAnalyticsRecipientsBody = document.querySelector("#smtpAnalyticsRecipientsBody");
const smtpAnalyticsEventsMeta = document.querySelector("#smtpAnalyticsEventsMeta");
const smtpAnalyticsEventsBody = document.querySelector("#smtpAnalyticsEventsBody");
const smtpAnalyticsLoadMoreButton = document.querySelector("#smtpAnalyticsLoadMoreButton");
const smtpLiveLoaded = document.querySelector("#smtpLiveLoaded");
const smtpLiveSent = document.querySelector("#smtpLiveSent");
const smtpLiveFailed = document.querySelector("#smtpLiveFailed");
const smtpLiveState = document.querySelector("#smtpLiveState");
const smtpLiveUpdated = document.querySelector("#smtpLiveUpdated");
const openSmtpCredentialFormButton = document.querySelector("#openSmtpCredentialFormButton");
const closeSmtpCredentialFormButton = document.querySelector("#closeSmtpCredentialFormButton");
const smtpCredentialEditor = document.querySelector("#smtpCredentialEditor");
const smtpCredentialEditorTitle = document.querySelector("#smtpCredentialEditorTitle");
const smtpCredentialReloadButton = document.querySelector("#smtpCredentialReloadButton");
const smtpCredentialForm = document.querySelector("#smtpCredentialForm");
const smtpCredName = document.querySelector("#smtpCredName");
const smtpCredProvider = document.querySelector("#smtpCredProvider");
const smtpCredHost = document.querySelector("#smtpCredHost");
const smtpCredPort = document.querySelector("#smtpCredPort");
const smtpCredSecure = document.querySelector("#smtpCredSecure");
const smtpCredUser = document.querySelector("#smtpCredUser");
const smtpCredPass = document.querySelector("#smtpCredPass");
const smtpCredFrom = document.querySelector("#smtpCredFrom");
const smtpCredFromName = document.querySelector("#smtpCredFromName");
const smtpCredReplyTo = document.querySelector("#smtpCredReplyTo");
const smtpCredFromOptions = document.querySelector("#smtpCredFromOptions");
const smtpCredSetActive = document.querySelector("#smtpCredSetActive");
const smtpCredSaveButton = document.querySelector("#smtpCredSaveButton");
const smtpCredResetButton = document.querySelector("#smtpCredResetButton");
const smtpCredentialList = document.querySelector("#smtpCredentialList");

let templates = [];
let contactRows = [];
let contactColumns = [];
let selectedConversationId = "";
let selectedParticipant = "";
let inboxPollTimer = null;
let inboxEventSource = null;
let inboxReconnectTimer = null;
let activeView = "quick";
let pendingAttachment = null;
const inboxPageSize = 10;
let inboxOffset = 0;
let inboxHasMore = false;
let inboxLoadingMore = false;
let inboxConversations = [];
let conversationRequestSeq = 0;
let inboxRefreshTimer = null;
let inboxCountRefreshTimer = null;
let conversationRefreshTimer = null;
let reportRefreshTimer = null;
let dashboardSummaryRefreshTimer = null;
let pendingConversationRefreshId = "";
let pendingReportSummaryOnly = true;
let pendingReportForce = false;
let reportLoadInFlight = null;
let dashboardSummaryLoadInFlight = null;
let lastReportLoadAt = 0;
let skipConversationRefreshUntil = 0;
let inboxSearchQuery = "";
let inboxSearchDebounceTimer = null;
let smtpAudienceRows = [];
let smtpAudienceColumns = [];
let smtpAudienceSheetNames = [];
let smtpAudienceFile = null;
let smtpProviderOptions = [];
let smtpFromOptionsByProvider = {};
let smtpDefaultFromByProvider = {};
let smtpDefaultReplyToByProvider = {};
let smtpProviderStatuses = [];
let smtpDefaultProvider = "";
let smtpDefaultSendRatePerMinute = 120;
let smtpCredentials = [];
let editingSmtpCredentialId = "";
let smtpTemplateFocusField = "body";
let smtpLiveSummaryTimer = null;
let whatsappLiveSummaryTimer = null;
let smtpAnalyticsRefreshTimer = null;
let smtpAnalyticsLoadInFlight = null;
let activeWhatsappCampaignId = "";
let activeSmtpCampaignId = "";
let smtpAnalyticsState = {
  campaignId: "",
  range: "14d",
  timelineGranularity: "day",
  summary: {
    uniqueOpens: 0,
    uniqueClicks: 0,
    openRate: 0,
    clickRate: 0,
  },
  timeline: [],
  topLinks: [],
  recipients: [],
  generatedAt: "",
};
let smtpAnalyticsDetailsState = {
  campaignId: "",
  limit: 10,
  offset: 0,
  totalRecords: 0,
  hasMore: false,
  records: [],
  generatedAt: "",
};
let smtpLiveSummary = {
  runId: "",
  channel: "email",
  status: "idle",
  loaded: 0,
  total: 0,
  processed: 0,
  sent: 0,
  failed: 0,
  inProgress: false,
  stopRequested: false,
  lastMessage: "Idle",
  lastUpdatedAt: "",
  lastTestRecipient: "",
  lastTestAt: "",
};
let whatsappLiveSummary = {
  runId: "",
  channel: "whatsapp",
  status: "idle",
  loaded: 0,
  total: 0,
  processed: 0,
  sent: 0,
  failed: 0,
  inProgress: false,
  stopRequested: false,
  lastMessage: "Idle",
  lastUpdatedAt: "",
};
const activityLog = [];
const maxActivityLog = 300;
const EVENT_REFRESH_DEBOUNCE_MS = 350;
const REPORT_REFRESH_DEBOUNCE_MS = 900;
const REPORT_COOLDOWN_MS = 2500;
const CONVERSATION_PAGE_SIZE = 80;
const MAX_SMTP_LOAD_ROWS = 50000;
const SMTP_ANALYTICS_TIMELINE_DAYS = 14;
const SMTP_ANALYTICS_DETAIL_PAGE_SIZE = 10;

const DASHBOARD_STAT_META = {
  quick: {
    contact: "Contacts",
    pending: "Pending Ack",
    sent: "Total Sent",
    delivered: "Delivered",
    failed: "Failed",
  },
  bulk: {
    contact: "Audience",
    pending: "Pending",
    sent: "Processed",
    delivered: "Sent",
    failed: "Failed",
  },
  smtp: {
    contact: "Audience",
    pending: "Pending",
    sent: "Processed",
    delivered: "Sent",
    failed: "Failed",
  },
};

function formatReportStatusClass(status) {
  const value = String(status || "").toLowerCase();
  if (value === "delivered") {
    return "success";
  }
  if (value === "failed") {
    return "danger";
  }
  return "neutral";
}

function setStatus(text, state = "") {
  statusBadge.textContent = text;
  statusBadge.className = `badge ${state}`.trim();
}

function logActivity(message, level = "info") {
  const now = new Date();
  const time = now.toLocaleTimeString();
  const tag = level.toUpperCase();
  activityLog.push(`[${time}] [${tag}] ${message}`);
  if (activityLog.length > maxActivityLog) {
    activityLog.splice(0, activityLog.length - maxActivityLog);
  }
  if (resultBox) {
    resultBox.textContent = activityLog.join("\n");
    resultBox.scrollTop = resultBox.scrollHeight;
  }
}

function renderReport(payload = {}) {
  const summary = payload.summary || {};
  const rows = Array.isArray(payload.rows) ? payload.rows : [];

  renderReportSummary(summary);

  reportBody.innerHTML = rows.length
    ? rows
      .map(
        (row) => `
            <tr>
              <td>${escapeHtml(formatTime(row.timestamp))}</td>
              <td>${escapeHtml(row.participant || row.replyTo || "-")}</td>
              <td>${escapeHtml(row.type || row.templateName || "message")}</td>
              <td><span class="report-status ${formatReportStatusClass(row.status)}">${escapeHtml(row.status || "Sent")}</span></td>
              <td title="${escapeHtml(row.statusDetails || "")}">${escapeHtml(row.statusDetails || "-")}</td>
            </tr>
          `,
      )
      .join("")
    : `<tr><td colspan="5" class="report-empty-cell">No outbound report data yet.</td></tr>`;
}

function renderReportSummary(summary = {}) {
  const sent = Number(summary.sent || 0);
  const delivered = Number(summary.delivered || 0);
  const failed = Number(summary.failed || 0);
  const pending = Math.max(0, sent - delivered - failed);

  reportSentCount.textContent = String(sent);
  reportDeliveredCount.textContent = String(delivered);
  reportFailedCount.textContent = String(failed);
  reportPendingCount.textContent = String(pending);
}

function updateDashboardStatLabels(viewName = "quick") {
  const meta = DASHBOARD_STAT_META[viewName] || DASHBOARD_STAT_META.quick;

  if (contactCountLabel) {
    contactCountLabel.textContent = meta.contact;
  }
  if (reportPendingLabel) {
    reportPendingLabel.textContent = meta.pending;
  }
  if (reportSentLabel) {
    reportSentLabel.textContent = meta.sent;
  }
  if (reportDeliveredLabel) {
    reportDeliveredLabel.textContent = meta.delivered;
  }
  if (reportFailedLabel) {
    reportFailedLabel.textContent = meta.failed;
  }
}

async function loadDashboardSummary(options = {}) {
  if (activeView === "smtp" || activeView === "config") {
    return;
  }

  const force = options.force === true;
  if (!force && Date.now() - lastReportLoadAt < REPORT_COOLDOWN_MS) {
    return;
  }

  if (dashboardSummaryLoadInFlight) {
    await dashboardSummaryLoadInFlight;
    return;
  }

  dashboardSummaryLoadInFlight = (async () => {
    try {
      const response = await fetch("/api/dashboard/summary");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load dashboard summary.");
      }
      setInboxCount(data.inbox?.total || 0);
      renderReportSummary(data.report || {});
      reportBody.innerHTML = `<tr><td colspan="5" class="report-empty-cell">Counts only mode enabled.</td></tr>`;
      lastReportLoadAt = Date.now();
    } catch (error) {
      if (!options.quiet) {
        logActivity(error.message, "error");
      }
    }
  })();

  try {
    await dashboardSummaryLoadInFlight;
  } finally {
    dashboardSummaryLoadInFlight = null;
  }
}

async function loadReport(options = {}) {
  const summaryOnly = options.summaryOnly !== false;
  const force = options.force === true;
  if (!force && Date.now() - lastReportLoadAt < REPORT_COOLDOWN_MS) {
    return;
  }

  if (reportLoadInFlight) {
    await reportLoadInFlight;
    return;
  }

  reportLoadInFlight = (async () => {
    try {
      const query = summaryOnly ? "/api/reports?summaryOnly=1" : "/api/reports?limit=100";
      const response = await fetch(query);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load report.");
      }
      renderReportSummary(data.summary || {});
      reportBody.innerHTML = `<tr><td colspan="5" class="report-empty-cell">Counts only mode enabled.</td></tr>`;
      lastReportLoadAt = Date.now();
    } catch (error) {
      logActivity(error.message, "error");
    }
  })();

  try {
    await reportLoadInFlight;
  } finally {
    reportLoadInFlight = null;
  }
}

function clearActivityLog() {
  activityLog.length = 0;
  if (resultBox) {
    resultBox.textContent = "Waiting for action.";
  }
}

function switchView(viewName) {
  activeView = ["quick", "bulk", "smtp", "analytics", "config", "chat"].includes(viewName) ? viewName : "quick";
  const isDashboard = ["quick", "bulk", "smtp"].includes(activeView);
  const isAnalytics = activeView === "analytics";
  const isConfig = activeView === "config";
  const isChat = activeView === "chat";
  const isQuick = activeView === "quick";
  const isBulk = activeView === "bulk";
  const isSmtp = activeView === "smtp";

  dashboardView.classList.toggle("active", isDashboard);
  if (analyticsView) {
    analyticsView.classList.toggle("active", isAnalytics);
  }
  if (configView) {
    configView.classList.toggle("active", isConfig);
  }
  chatView.classList.toggle("active", isChat);
  dashboardView.classList.toggle("workflow-quick", isQuick);
  dashboardView.classList.toggle("workflow-bulk", isBulk);
  dashboardView.classList.toggle("workflow-smtp", isSmtp);

  quickSendCard.classList.toggle("is-hidden", !isQuick);
  bulkSendCard.classList.toggle("is-hidden", !isBulk);
  smtpBulkCard.classList.toggle("is-hidden", !isSmtp);
  audiencePreviewCard.classList.toggle("is-hidden", !isBulk);
  smtpPreviewCard.classList.toggle("is-hidden", !isSmtp);
  if (smtpAnalyticsCard) {
    smtpAnalyticsCard.classList.toggle("is-hidden", !isAnalytics);
  }

  if (pageTitle) {
    pageTitle.textContent = isChat
      ? "Chat Inbox"
      : isConfig
        ? "Config Center"
        : isAnalytics
          ? "Email Engagement Analytics"
          : isBulk
            ? "Bulk Send"
            : isSmtp
              ? "Email Campaign"
              : "Quick Send";
  }

  viewTabs.forEach((tab) => {
    const isActive = tab.dataset.view === activeView;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  updateDashboardStatLabels(isSmtp ? "smtp" : isBulk ? "bulk" : "quick");

  if (isChat && selectedConversationId) {
    loadConversation(selectedConversationId, false, { markRead: false, quiet: true }).catch(() => { });
  }

  if (isChat && !inboxConversations.length) {
    loadInbox({ quiet: true }).catch(() => { });
  }

  if (isQuick) {
    scheduleDashboardSummaryRefresh({ quiet: true, delay: 50, force: false });
  }

  if (isConfig) {
    renderConfigCenterInfo();
  }

  if (isSmtp) {
    renderSmtpDashboardStats();
    fetchSmtpLiveSummary({ quiet: true }).catch(() => { });
  } else {
    stopSmtpLiveSummaryPolling();
    closeSmtpPreviewModal();
  }

  if (isAnalytics) {
    fetchSmtpLiveSummary({ quiet: true }).catch(() => { });
    scheduleSmtpAnalyticsRefresh({ quiet: true, force: true, delay: 50 });
  } else {
    stopSmtpAnalyticsRefreshPolling();
  }

  if (isBulk) {
    renderWhatsappDashboardStats();
    fetchWhatsappLiveSummary({ quiet: true }).catch(() => { });
  } else {
    stopWhatsappLiveSummaryPolling();
  }
}

function renderWhatsappDashboardStats() {
  const loaded = Number(whatsappLiveSummary.loaded || contactRows.length || 0);
  const processed = Number(whatsappLiveSummary.processed || 0);
  const sent = Number(whatsappLiveSummary.sent || 0);
  const failed = Number(whatsappLiveSummary.failed || 0);
  const total = Number(whatsappLiveSummary.total || loaded || 0);
  const pending = Math.max(0, total - processed);

  if (contactCount) {
    contactCount.textContent = String(loaded);
  }
  if (reportPendingCount) {
    reportPendingCount.textContent = String(pending);
  }
  if (reportSentCount) {
    reportSentCount.textContent = String(processed);
  }
  if (reportDeliveredCount) {
    reportDeliveredCount.textContent = String(sent);
  }
  if (reportFailedCount) {
    reportFailedCount.textContent = String(failed);
  }
}

function renderSmtpDashboardStats() {
  const loaded = Number(smtpLiveSummary.loaded || smtpAudienceRows.length || 0);
  const processed = Number(smtpLiveSummary.processed || 0);
  const sent = Number(smtpLiveSummary.sent || 0);
  const failed = Number(smtpLiveSummary.failed || 0);
  const total = Number(smtpLiveSummary.total || loaded || 0);
  const pending = Math.max(0, total - processed);

  if (contactCount) {
    contactCount.textContent = String(loaded);
  }
  if (reportPendingCount) {
    reportPendingCount.textContent = String(pending);
  }
  if (reportSentCount) {
    reportSentCount.textContent = String(processed);
  }
  if (reportDeliveredCount) {
    reportDeliveredCount.textContent = String(sent);
  }
  if (reportFailedCount) {
    reportFailedCount.textContent = String(failed);
  }
}

function formatPercentage(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) {
    return "0%";
  }
  if (Math.abs(numericValue) >= 100) {
    return `${Math.round(numericValue)}%`;
  }
  return `${numericValue.toFixed(1)}%`;
}

function renderSmtpAnalyticsChart(timeline = []) {
  if (!smtpAnalyticsChart) {
    return;
  }

  const points = Array.isArray(timeline) ? timeline : [];
  if (!points.length) {
    smtpAnalyticsChart.innerHTML = `<div class="smtp-analytics-empty">No open/click events yet.</div>`;
    return;
  }

  const timelineGranularity = String(smtpAnalyticsState.timelineGranularity || "day").toLowerCase();
  const hourlyLabelStep = points.length > 18 ? 3 : 2;

  const maxValue = Math.max(
    1,
    ...points.map((item) => Math.max(Number(item.opens || 0), Number(item.clicks || 0))),
  );

  smtpAnalyticsChart.innerHTML = points
    .map((item, index) => {
      const opens = Number(item.opens || 0);
      const clicks = Number(item.clicks || 0);
      const openHeight = opens > 0 ? Math.max(8, Math.round((opens / maxValue) * 88)) : 0;
      const clickHeight = clicks > 0 ? Math.max(8, Math.round((clicks / maxValue) * 88)) : 0;
      const label = String(item.label || item.day || "").trim() || "-";
      const showLabel =
        timelineGranularity !== "hour"
        || index === 0
        || index === points.length - 1
        || index % hourlyLabelStep === 0;

      return `
        <div class="smtp-chart-column" title="${escapeHtml(String(item.bucket || item.day || ""))}: opens ${opens}, clicks ${clicks}">
          <div class="smtp-chart-bars">
            <span class="smtp-chart-bar smtp-chart-bar-open" style="height:${openHeight}%"></span>
            <span class="smtp-chart-bar smtp-chart-bar-click" style="height:${clickHeight}%"></span>
          </div>
          <div class="smtp-chart-label">${showLabel ? escapeHtml(label || "-") : ""}</div>
        </div>
      `;
    })
    .join("");
}

function formatAnalyticsEventTypeLabel(eventType) {
  const value = String(eventType || "").trim().toLowerCase();
  if (value === "click") {
    return "Click";
  }
  if (value === "open") {
    return "Open";
  }
  return value ? value[0].toUpperCase() + value.slice(1) : "-";
}

function normalizeAnalyticsEventTypeClass(eventType) {
  const value = String(eventType || "").trim().toLowerCase();
  if (value === "open" || value === "click") {
    return value;
  }
  return "other";
}

function buildAnalyticsEventKey(record = {}) {
  const id = Number(record.id || 0);
  if (id > 0) {
    return `id:${id}`;
  }
  return [
    String(record.campaignId || ""),
    String(record.recipient || "").toLowerCase(),
    String(record.eventType || "").toLowerCase(),
    String(record.targetUrl || ""),
    String(record.createdAt || ""),
  ].join("|");
}

function sortAnalyticsEventsDescending(records = []) {
  return records.sort((a, b) => {
    const aTime = new Date(a.createdAt || 0).getTime() || 0;
    const bTime = new Date(b.createdAt || 0).getTime() || 0;
    if (bTime !== aTime) {
      return bTime - aTime;
    }
    return Number(b.id || 0) - Number(a.id || 0);
  });
}

function mergeSmtpAnalyticsEventRecords(existingRecords = [], incomingRecords = [], mode = "replace") {
  if (mode === "replace") {
    return sortAnalyticsEventsDescending(incomingRecords.slice());
  }

  const mergedMap = new Map();
  const addRecords = (records) => {
    records.forEach((record) => {
      const key = buildAnalyticsEventKey(record);
      if (!mergedMap.has(key)) {
        mergedMap.set(key, record);
      }
    });
  };

  if (mode === "append") {
    addRecords(existingRecords);
    addRecords(incomingRecords);
  } else {
    addRecords(incomingRecords);
    addRecords(existingRecords);
  }

  return sortAnalyticsEventsDescending(Array.from(mergedMap.values()));
}

function renderSmtpAnalyticsEventFeed() {
  if (!smtpAnalyticsEventsBody) {
    return;
  }

  const records = Array.isArray(smtpAnalyticsDetailsState.records) ? smtpAnalyticsDetailsState.records : [];
  if (!records.length) {
    smtpAnalyticsEventsBody.innerHTML = `<tr><td colspan="5" class="report-empty-cell">No open/click event records yet.</td></tr>`;
  } else {
    smtpAnalyticsEventsBody.innerHTML = records
      .map((item) => {
        const occurredAt = item.createdAt ? new Date(item.createdAt) : null;
        const readableTime = occurredAt && !Number.isNaN(occurredAt.getTime())
          ? occurredAt.toLocaleString()
          : "-";
        const eventType = String(item.eventType || "").toLowerCase();
        const eventTypeClass = normalizeAnalyticsEventTypeClass(eventType);
        const targetUrl = String(item.targetUrl || "").trim();
        const eventLabel = formatAnalyticsEventTypeLabel(eventType);
        const countLabel = `${Number(item.occurrenceCount || 0)} / ${Number(item.totalCountForSignature || 0)}`;

        return `
          <tr>
            <td>${escapeHtml(readableTime)}</td>
            <td title="${escapeHtml(item.recipient || "")}">${escapeHtml(item.recipient || "-")}</td>
            <td>
              <span class="smtp-event-type smtp-event-type-${eventTypeClass}">${escapeHtml(eventLabel)}</span>
            </td>
            <td>
              ${targetUrl
            ? `<a href="${escapeHtml(targetUrl)}" class="smtp-event-link" target="_blank" rel="noopener noreferrer">${escapeHtml(targetUrl)}</a>`
            : `<span class="smtp-event-link-empty">-</span>`}
            </td>
            <td><span class="smtp-event-count">${escapeHtml(countLabel)}</span></td>
          </tr>
        `;
      })
      .join("");
  }

  if (smtpAnalyticsEventsMeta) {
    const totalRecords = Number(smtpAnalyticsDetailsState.totalRecords || 0);
    const shownRecords = records.length;
    const generatedAt = String(smtpAnalyticsDetailsState.generatedAt || "").trim();
    smtpAnalyticsEventsMeta.textContent = generatedAt
      ? `Showing ${shownRecords}/${totalRecords} recent records | Live updated ${new Date(generatedAt).toLocaleTimeString()}`
      : `Showing ${shownRecords}/${totalRecords} recent records`;
  }

  if (smtpAnalyticsLoadMoreButton) {
    const hasMore = Boolean(smtpAnalyticsDetailsState.hasMore);
    smtpAnalyticsLoadMoreButton.hidden = !hasMore;
    smtpAnalyticsLoadMoreButton.disabled = false;
    smtpAnalyticsLoadMoreButton.textContent = hasMore
      ? `Load ${SMTP_ANALYTICS_DETAIL_PAGE_SIZE} More`
      : "No More Records";
  }
}

function renderSmtpAnalytics(payload = {}, options = {}) {
  const incoming = payload && typeof payload === "object" ? payload : {};
  const incomingCampaignId = String(incoming.campaignId || "").trim();
  const currentCampaignId = String(smtpAnalyticsState.campaignId || "").trim();
  const campaignChanged = currentCampaignId !== incomingCampaignId;

  if (campaignChanged) {
    smtpAnalyticsDetailsState = {
      campaignId: incomingCampaignId,
      limit: SMTP_ANALYTICS_DETAIL_PAGE_SIZE,
      offset: 0,
      totalRecords: 0,
      hasMore: false,
      records: [],
      generatedAt: "",
    };
  }

  smtpAnalyticsState = {
    ...smtpAnalyticsState,
    ...incoming,
  };

  const summary = smtpAnalyticsState.summary && typeof smtpAnalyticsState.summary === "object"
    ? smtpAnalyticsState.summary
    : {};
  const range = String(smtpAnalyticsState.range || "14d").toLowerCase();
  const timelineGranularity = String(smtpAnalyticsState.timelineGranularity || "day").toLowerCase();
  const topLinks = Array.isArray(smtpAnalyticsState.topLinks) ? smtpAnalyticsState.topLinks : [];
  const recipients = Array.isArray(smtpAnalyticsState.recipients) ? smtpAnalyticsState.recipients : [];

  if (smtpAnalyticsRange && smtpAnalyticsRange.value !== range) {
    smtpAnalyticsRange.value = range;
  }

  if (smtpAnalyticsUniqueOpenCount) {
    smtpAnalyticsUniqueOpenCount.textContent = String(Number(summary.uniqueOpens || 0));
  }
  if (smtpAnalyticsUniqueClickCount) {
    smtpAnalyticsUniqueClickCount.textContent = String(Number(summary.uniqueClicks || 0));
  }
  if (smtpAnalyticsOpenRate) {
    smtpAnalyticsOpenRate.textContent = formatPercentage(summary.openRate || 0);
  }
  if (smtpAnalyticsClickRate) {
    smtpAnalyticsClickRate.textContent = formatPercentage(summary.clickRate || 0);
  }

  renderSmtpAnalyticsChart(Array.isArray(smtpAnalyticsState.timeline) ? smtpAnalyticsState.timeline : []);

  if (smtpAnalyticsMeta) {
    const generatedAt = String(smtpAnalyticsState.generatedAt || "").trim();
    const sent = Number(summary.sent || 0);
    const opens = Number(summary.opens || 0);
    const clicks = Number(summary.clicks || 0);
    const rangeLabelMap = {
      today: "Today",
      yesterday: "Yesterday",
      "7d": "Last 7 Days",
      "14d": "Last 14 Days",
      "30d": "Last 30 Days",
    };
    const rangeLabel = rangeLabelMap[range] || "Custom";
    const granularityLabel = timelineGranularity === "hour" ? "Hourly" : "Daily";
    smtpAnalyticsMeta.textContent = generatedAt
      ? `${rangeLabel} (${granularityLabel}) | Sent ${sent} | Opens ${opens} | Clicks ${clicks} | Updated ${new Date(generatedAt).toLocaleTimeString()}`
      : `${rangeLabel} (${granularityLabel}) | Sent ${sent} | Opens ${opens} | Clicks ${clicks}`;
  }

  if (smtpAnalyticsTopLinks) {
    smtpAnalyticsTopLinks.innerHTML = topLinks.length
      ? topLinks
        .map(
          (item) => `
              <li>
                <a href="${escapeHtml(item.url || "")}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.url || "-")}</a>
                <span>${Number(item.clicks || 0)} clicks</span>
              </li>
            `,
        )
        .join("")
      : `<li class="smtp-top-links-empty">No click data yet.</li>`;
  }

  if (smtpAnalyticsRecipientsBody) {
    smtpAnalyticsRecipientsBody.innerHTML = recipients.length
      ? recipients
        .map(
          (item) => `
              <tr>
                <td title="${escapeHtml(item.recipient || "")}">${escapeHtml(item.recipient || "-")}</td>
                <td>${Number(item.sent || 0)}</td>
                <td>${Number(item.opens || 0)}</td>
                <td>${Number(item.clicks || 0)}</td>
                <td>${formatPercentage(item.openRate || 0)}</td>
                <td>${formatPercentage(item.clickRate || 0)}</td>
              </tr>
            `,
        )
        .join("")
      : `<tr><td colspan="6" class="report-empty-cell">Recipient engagement data is not available yet.</td></tr>`;
  }

  if (incoming.details && typeof incoming.details === "object") {
    const detailPayload = incoming.details;
    const detailCampaignId = String(detailPayload.campaignId || incomingCampaignId || activeSmtpCampaignId || "").trim();
    const detailLimit = Number.isFinite(Number(detailPayload.limit))
      ? Math.max(1, Number(detailPayload.limit))
      : SMTP_ANALYTICS_DETAIL_PAGE_SIZE;
    const detailOffset = Number.isFinite(Number(detailPayload.offset))
      ? Math.max(0, Number(detailPayload.offset))
      : 0;
    const detailTotal = Number.isFinite(Number(detailPayload.totalRecords))
      ? Math.max(0, Number(detailPayload.totalRecords))
      : 0;
    const incomingRecords = Array.isArray(detailPayload.records) ? detailPayload.records : [];

    let mergeMode = "replace";
    if (options.appendDetails) {
      mergeMode = "append";
    } else if (options.mergeLatestDetails) {
      mergeMode = "merge-latest";
    }

    const existingRecords = Array.isArray(smtpAnalyticsDetailsState.records) ? smtpAnalyticsDetailsState.records : [];
    const mergedRecords = mergeSmtpAnalyticsEventRecords(existingRecords, incomingRecords, mergeMode);

    smtpAnalyticsDetailsState = {
      campaignId: detailCampaignId,
      limit: detailLimit,
      offset: detailOffset,
      totalRecords: detailTotal,
      hasMore: Boolean(detailPayload.hasMore),
      records: mergedRecords,
      generatedAt: String(smtpAnalyticsState.generatedAt || ""),
    };
  }

  renderSmtpAnalyticsEventFeed();
}

async function fetchSmtpAnalytics(options = {}) {
  if (!["smtp", "analytics"].includes(activeView) && !options.force) {
    return;
  }

  if (smtpAnalyticsLoadInFlight) {
    await smtpAnalyticsLoadInFlight;
    return;
  }

  smtpAnalyticsLoadInFlight = (async () => {
    try {
      const params = new URLSearchParams();
      params.set("days", String(SMTP_ANALYTICS_TIMELINE_DAYS));
      const requestedRange = String(options.range || smtpAnalyticsState.range || smtpAnalyticsRange?.value || "14d")
        .trim()
        .toLowerCase();
      params.set("range", requestedRange);
      params.set("includeEmptyTimeline", ["today", "yesterday"].includes(requestedRange) ? "1" : "0");
      if (activeSmtpCampaignId) {
        params.set("campaignId", activeSmtpCampaignId);
      }
      const detailLimit = Number.isFinite(Number(options.detailLimit))
        ? Math.max(1, Number(options.detailLimit))
        : SMTP_ANALYTICS_DETAIL_PAGE_SIZE;
      const hasExplicitDetailOffset = Number.isFinite(Number(options.detailOffset));
      const detailOffset = hasExplicitDetailOffset ? Math.max(0, Number(options.detailOffset)) : 0;

      params.set("detailLimit", String(detailLimit));
      params.set("detailOffset", String(detailOffset));

      const response = await fetch(`/api/email-analytics?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load email analytics.");
      }

      data.range = String(data.range || requestedRange || "14d").toLowerCase();
      if (!data.timelineGranularity) {
        data.timelineGranularity = ["today", "yesterday"].includes(data.range) ? "hour" : "day";
      }

      const mergeLatestDetails = options.mergeLatestDetails === true
        || (options.refreshLatest === true && !hasExplicitDetailOffset && smtpAnalyticsDetailsState.records.length > 0);
      const appendDetails = options.appendDetails === true && detailOffset > 0;

      renderSmtpAnalytics(data, { appendDetails, mergeLatestDetails });
    } catch (error) {
      if (!options.quiet) {
        logActivity(error.message, "error");
      }
    }
  })();

  try {
    await smtpAnalyticsLoadInFlight;
  } finally {
    smtpAnalyticsLoadInFlight = null;
  }
}

function scheduleSmtpAnalyticsRefresh(options = {}) {
  const delay = Number.isFinite(options.delay) ? options.delay : REPORT_REFRESH_DEBOUNCE_MS;
  const quiet = options.quiet !== false;
  const force = options.force === true;
  const refreshLatest = options.refreshLatest !== false;

  if (smtpAnalyticsRefreshTimer) {
    return;
  }

  smtpAnalyticsRefreshTimer = setTimeout(async () => {
    smtpAnalyticsRefreshTimer = null;
    await fetchSmtpAnalytics({ quiet, force, refreshLatest });
  }, delay);
}

function stopSmtpAnalyticsRefreshPolling() {
  if (!smtpAnalyticsRefreshTimer) {
    return;
  }
  clearTimeout(smtpAnalyticsRefreshTimer);
  smtpAnalyticsRefreshTimer = null;
}

function renderSmtpLiveSummary() {
  if (!smtpLiveLoaded || !smtpLiveSent || !smtpLiveFailed || !smtpLiveState || !smtpLiveUpdated) {
    return;
  }

  const loaded = Number(smtpLiveSummary.loaded || smtpAudienceRows.length || 0);
  const sent = Number(smtpLiveSummary.sent || 0);
  const failed = Number(smtpLiveSummary.failed || 0);
  const processed = Number(smtpLiveSummary.processed || 0);
  const total = Number(smtpLiveSummary.total || 0);
  const statusText = smtpLiveSummary.inProgress
    ? `Sending ${processed}/${total || loaded || 0}`
    : String(smtpLiveSummary.lastMessage || (loaded ? "Ready" : "Idle"));

  smtpLiveLoaded.textContent = String(loaded);
  smtpLiveSent.textContent = String(sent);
  smtpLiveFailed.textContent = String(failed);
  smtpLiveState.textContent = statusText;

  if (activeView === "smtp") {
    renderSmtpDashboardStats();
  }

  const updatedAt = String(smtpLiveSummary.lastUpdatedAt || "").trim();
  smtpLiveUpdated.textContent = updatedAt
    ? `Updated ${new Date(updatedAt).toLocaleTimeString()}`
    : "No updates yet";

  if (sendSmtpBulkButton) {
    sendSmtpBulkButton.disabled = smtpLiveSummary.inProgress;
  }
  if (stopSmtpBulkButton) {
    stopSmtpBulkButton.disabled = !smtpLiveSummary.inProgress;
  }
}

async function fetchSmtpLiveSummary(options = {}) {
  try {
    const campaignQuery = activeSmtpCampaignId ? `?campaignId=${encodeURIComponent(activeSmtpCampaignId)}` : "";
    const response = await fetch(`/api/smtp/live-summary${campaignQuery}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to load mail summary.");
    }
    smtpLiveSummary = {
      ...smtpLiveSummary,
      ...data,
      loaded: Math.max(Number(data.loaded || 0), smtpAudienceRows.length),
    };
    if (smtpLiveSummary.runId) {
      activeSmtpCampaignId = smtpLiveSummary.runId;
    }
    renderSmtpLiveSummary();
    scheduleSmtpAnalyticsRefresh({ quiet: true, delay: 120, force: false });

    if (smtpLiveSummary.inProgress) {
      setStatus(`SMTP sending ${smtpLiveSummary.processed}/${smtpLiveSummary.total || smtpLiveSummary.loaded}`,
        "sending");
    } else if (smtpLiveSummary.runId) {
      setStatus(`SMTP ${smtpLiveSummary.status || "completed"}`);
    }

  } catch (error) {
    if (!options.quiet) {
      logActivity(error.message, "error");
    }
  }
}

function startSmtpLiveSummaryPolling() {
  stopSmtpLiveSummaryPolling();
}

function stopSmtpLiveSummaryPolling() {
  if (!smtpLiveSummaryTimer) {
    return;
  }
  clearInterval(smtpLiveSummaryTimer);
  smtpLiveSummaryTimer = null;
}

function renderWhatsappCampaignState() {
  if (sendBulkButton) {
    sendBulkButton.disabled = whatsappLiveSummary.inProgress;
  }
  if (stopBulkButton) {
    stopBulkButton.disabled = !whatsappLiveSummary.inProgress;
  }
}

function applyCampaignEvent(payload = {}) {
  const channel = String(payload.channel || "").toLowerCase();
  const summary = payload.summary && typeof payload.summary === "object" ? payload.summary : null;
  if (!summary) {
    return;
  }

  if (channel === "email") {
    smtpLiveSummary = {
      ...smtpLiveSummary,
      ...summary,
      loaded: Math.max(Number(summary.loaded || 0), smtpAudienceRows.length),
    };
    if (smtpLiveSummary.runId) {
      activeSmtpCampaignId = smtpLiveSummary.runId;
    }
    renderSmtpLiveSummary();
    scheduleSmtpAnalyticsRefresh({ quiet: true, delay: 100, force: false });
    if (activeView === "smtp") {
      setStatus(`SMTP ${smtpLiveSummary.lastMessage || smtpLiveSummary.status || "updated"}`,
        smtpLiveSummary.inProgress ? "sending" : "");
    }
    return;
  }

  if (channel === "whatsapp") {
    whatsappLiveSummary = {
      ...whatsappLiveSummary,
      ...summary,
      loaded: Math.max(Number(summary.loaded || 0), contactRows.length),
    };
    if (whatsappLiveSummary.runId) {
      activeWhatsappCampaignId = whatsappLiveSummary.runId;
    }
    renderWhatsappCampaignState();
    if (activeView === "bulk") {
      renderWhatsappDashboardStats();
    }
    if (activeView === "bulk") {
      setStatus(`WA ${whatsappLiveSummary.lastMessage || whatsappLiveSummary.status || "updated"}`,
        whatsappLiveSummary.inProgress ? "sending" : "");
    }
  }
}

async function fetchWhatsappLiveSummary(options = {}) {
  try {
    const campaignQuery = activeWhatsappCampaignId
      ? `?campaignId=${encodeURIComponent(activeWhatsappCampaignId)}`
      : "";
    const response = await fetch(`/api/whatsapp/live-summary${campaignQuery}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to load WhatsApp campaign summary.");
    }

    whatsappLiveSummary = {
      ...whatsappLiveSummary,
      ...data,
      loaded: Math.max(Number(data.loaded || 0), contactRows.length),
    };
    if (whatsappLiveSummary.runId) {
      activeWhatsappCampaignId = whatsappLiveSummary.runId;
    }
    renderWhatsappCampaignState();
    if (activeView === "bulk") {
      renderWhatsappDashboardStats();
    }

    if (whatsappLiveSummary.inProgress) {
      setStatus(
        `WA sending ${whatsappLiveSummary.processed}/${whatsappLiveSummary.total || whatsappLiveSummary.loaded}`,
        "sending",
      );
    } else if (whatsappLiveSummary.runId) {
      setStatus(`WA ${whatsappLiveSummary.status || "completed"}`);
    }

    if (!whatsappLiveSummary.inProgress && whatsappLiveSummary.runId && !options.quiet) {
      logActivity(
        `WA campaign ${whatsappLiveSummary.status}: sent=${whatsappLiveSummary.sent}, failed=${whatsappLiveSummary.failed}.`,
      );
    }

  } catch (error) {
    if (!options.quiet) {
      logActivity(error.message, "error");
    }
  }
}

function startWhatsappLiveSummaryPolling() {
  stopWhatsappLiveSummaryPolling();
}

function stopWhatsappLiveSummaryPolling() {
  if (!whatsappLiveSummaryTimer) {
    return;
  }
  clearInterval(whatsappLiveSummaryTimer);
  whatsappLiveSummaryTimer = null;
}

function scheduleInboxRefresh(options = {}) {
  if (activeView !== "chat") {
    scheduleInboxCountRefresh(options);
    return;
  }
  const delay = Number.isFinite(options.delay) ? options.delay : EVENT_REFRESH_DEBOUNCE_MS;
  const quiet = options.quiet !== false;
  if (inboxRefreshTimer) {
    return;
  }
  inboxRefreshTimer = setTimeout(async () => {
    inboxRefreshTimer = null;
    await loadInbox({ quiet });
  }, delay);
}

function scheduleInboxCountRefresh(options = {}) {
  const delay = Number.isFinite(options.delay) ? options.delay : EVENT_REFRESH_DEBOUNCE_MS;
  const quiet = options.quiet !== false;
  if (inboxCountRefreshTimer) {
    return;
  }
  inboxCountRefreshTimer = setTimeout(async () => {
    inboxCountRefreshTimer = null;
    await loadInboxCount({ quiet });
  }, delay);
}

function scheduleDashboardSummaryRefresh(options = {}) {
  if (activeView === "smtp" || activeView === "config") {
    return;
  }

  const delay = Number.isFinite(options.delay) ? options.delay : REPORT_REFRESH_DEBOUNCE_MS;
  const quiet = options.quiet !== false;
  const force = options.force === true;
  if (dashboardSummaryRefreshTimer) {
    return;
  }
  dashboardSummaryRefreshTimer = setTimeout(async () => {
    dashboardSummaryRefreshTimer = null;
    await loadDashboardSummary({ quiet, force });
  }, delay);
}

function scheduleConversationRefresh(conversationId, options = {}) {
  if (!conversationId) {
    return;
  }
  pendingConversationRefreshId = conversationId;
  const delay = Number.isFinite(options.delay) ? options.delay : EVENT_REFRESH_DEBOUNCE_MS;
  if (conversationRefreshTimer) {
    return;
  }
  conversationRefreshTimer = setTimeout(async () => {
    const targetConversationId = pendingConversationRefreshId;
    pendingConversationRefreshId = "";
    conversationRefreshTimer = null;
    if (!targetConversationId || targetConversationId !== selectedConversationId || activeView !== "chat") {
      return;
    }
    await loadConversation(targetConversationId, false, { markRead: false, quiet: true });
  }, delay);
}

function scheduleReportRefresh(options = {}) {
  if (activeView !== "chat") {
    scheduleDashboardSummaryRefresh({ quiet: true, delay: REPORT_REFRESH_DEBOUNCE_MS, force: options.force === true });
    return;
  }
  const delay = Number.isFinite(options.delay) ? options.delay : REPORT_REFRESH_DEBOUNCE_MS;
  const summaryOnly = options.summaryOnly === true;
  const force = options.force === true;

  pendingReportSummaryOnly = pendingReportSummaryOnly && summaryOnly;
  pendingReportForce = pendingReportForce || force;

  if (reportRefreshTimer) {
    return;
  }

  reportRefreshTimer = setTimeout(async () => {
    const shouldSummaryOnly = true;
    const shouldForce = pendingReportForce;
    pendingReportSummaryOnly = true;
    pendingReportForce = false;
    reportRefreshTimer = null;
    await loadReport({ summaryOnly: shouldSummaryOnly, force: shouldForce });
  }, delay);
}

function setInboxCount(value) {
  if (!chatCount) {
    return;
  }
  chatCount.textContent = String(Math.max(0, Number(value) || 0));
}

async function loadInboxCount(options = {}) {
  if (activeView !== "chat") {
    await loadDashboardSummary({ quiet: options.quiet === true });
    return;
  }
  const quiet = options.quiet === true;
  try {
    const response = await fetch("/api/inbox/count");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to load inbox count.");
    }
    setInboxCount(data.total || 0);
  } catch (error) {
    if (!quiet) {
      logActivity(error.message, "error");
    }
  }
}

function closeTemplatePicker() {
  templatePicker.dataset.open = "false";
  templatePickerButton.setAttribute("aria-expanded", "false");
}

function updateTemplatePickerValue() {
  const selected = templates.find((template) => template.name === templateSelect.value);
  templatePickerValue.textContent = selected?.label || "Select template";

  templatePickerMenu.querySelectorAll(".custom-select-option").forEach((option) => {
    const isSelected = option.dataset.value === templateSelect.value;
    option.classList.toggle("selected", isSelected);
    option.setAttribute("aria-selected", String(isSelected));
  });
}

function renderTemplatePicker() {
  templatePickerMenu.innerHTML = templates
    .map(
      (template) => `
        <button
          type="button"
          class="custom-select-option"
          role="option"
          data-value="${escapeHtml(template.name)}"
          aria-selected="false"
        >
          <span>${escapeHtml(template.label)}</span>
        </button>
      `,
    )
    .join("");

  updateTemplatePickerValue();
}

function updateTemplateFields() {
  const selected = templates.find((template) => template.name === templateSelect.value);

  if (!selected) {
    singleValueOverrides.innerHTML = "";
    return;
  }

  renderSingleValueOverrides();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString();
}

function formatChatTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatChatDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}

function toDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function filterInboxConversations(conversations) {
  const query = String(inboxSearchQuery || "").trim();
  if (!query) {
    return conversations;
  }

  const loweredQuery = query.toLowerCase();
  const digitsQuery = toDigits(query);

  return conversations.filter((conversation) => {
    const participant = String(conversation.participant || "");
    const replyTo = String(conversation.replyTo || "");
    const id = String(conversation.id || "");
    const haystack = `${participant} ${replyTo} ${id}`.toLowerCase();
    if (haystack.includes(loweredQuery)) {
      return true;
    }
    if (!digitsQuery) {
      return false;
    }
    const combinedDigits = `${toDigits(participant)} ${toDigits(replyTo)} ${toDigits(id)}`;
    return combinedDigits.includes(digitsQuery);
  });
}

function getConversationInitials(value) {
  const text = String(value || "").trim();
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 2) {
    return digits.slice(-2);
  }
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "TW";
}

function getMessageTypeLabel(message = {}) {
  const type = String(message.type || "").toLowerCase();
  const mime = String(message.media?.mimeType || "").toLowerCase();
  if (mime.startsWith("image/") || type === "image") {
    return "Image";
  }
  if (type === "document") {
    return "Document";
  }
  if (type === "audio") {
    return "Audio";
  }
  if (type === "video") {
    return "Video";
  }
  if (type === "sticker") {
    return "Sticker";
  }
  return "Message";
}

function getConversationPreview(conversation = {}) {
  const text = conversation.lastMessage?.text;
  if (text) {
    return text;
  }
  return `[${getMessageTypeLabel(conversation.lastMessage).toLowerCase()}]`;
}

function selectLikelyColumn(select, patterns) {
  const match = patterns.reduce(
    (found, pattern) => found || contactColumns.find((column) => pattern.test(column)),
    "",
  );
  if (match) {
    select.value = match;
  }
}

function normalizeWords(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function findBestColumnForTemplateKey(templateKey) {
  const keyWords = normalizeWords(templateKey);

  if (!keyWords.length) {
    return "";
  }

  const exact = contactColumns.find((column) => column.toLowerCase() === templateKey.toLowerCase());
  if (exact) {
    return exact;
  }

  const scored = contactColumns
    .map((column) => {
      const columnWords = normalizeWords(column);
      const score = keyWords.filter((word) => columnWords.includes(word)).length;
      return { column, score };
    })
    .sort((a, b) => b.score - a.score);

  if (scored[0]?.score) {
    return scored[0].column;
  }

  if (keyWords.includes("name")) {
    return contactColumns.find((column) => /(^|\W)(name|customer|candidate|client)(\W|$)/i.test(column)) || "";
  }

  if (keyWords.some((word) => ["amount", "balance", "price"].includes(word))) {
    return contactColumns.find((column) => /amount|balance|price|wallet/i.test(column)) || "";
  }

  return "";
}

function renderSingleValueOverrides() {
  const selected = templates.find((template) => template.name === templateSelect.value);

  if (!selected?.values?.length) {
    singleValueOverrides.innerHTML = "";
    return;
  }

  singleValueOverrides.innerHTML = selected.values
    .map(
      (value) => `
        <label>
          ${escapeHtml(value.name)}
          <input
            class="single-value-input"
            data-template-key="${escapeHtml(value.name)}"
            placeholder="Type value"
            autocomplete="off"
          />
        </label>
      `,
    )
    .join("");
}

function renderValueMappings() {
  const selected = templates.find((template) => template.name === bulkTemplateSelect.value);

  if (!selected?.values?.length) {
    valueMappings.innerHTML = "";
    return;
  }

  const options = `<option value="">Select column</option>${contactColumns
    .map((column) => `<option value="${escapeHtml(column)}">${escapeHtml(column)}</option>`)
    .join("")}`;

  valueMappings.innerHTML = selected.values
    .map(
      (value) => `
        <div class="mapping-row" data-template-key="${escapeHtml(value.name)}">
          <div>
            <span class="eyebrow">Template key</span>
            <div class="mapping-key">${escapeHtml(value.name)}</div>
          </div>
          <label>
            Source
            <select class="mapping-source" data-template-key="${escapeHtml(value.name)}">
              <option value="column">Select column</option>
              <option value="static">Type value</option>
            </select>
          </label>
          <label class="mapping-value-wrap">
            Value
            <span class="mapping-dynamic-control" data-template-key="${escapeHtml(value.name)}">
              <select class="mapping-select" data-template-key="${escapeHtml(value.name)}">
                ${options}
              </select>
            </span>
          </label>
        </div>
      `,
    )
    .join("");

  document.querySelectorAll(".mapping-select").forEach((select) => {
    const match = findBestColumnForTemplateKey(select.dataset.templateKey);
    if (match) {
      select.value = match;
    }
  });

  document.querySelectorAll(".mapping-source").forEach((sourceSelect) => {
    sourceSelect.addEventListener("change", () => {
      updateMappingSource(sourceSelect.dataset.templateKey);
    });
    updateMappingSource(sourceSelect.dataset.templateKey);
  });
}

function updateMappingSource(templateKey) {
  const row = document.querySelector(`.mapping-row[data-template-key="${CSS.escape(templateKey)}"]`);
  if (!row) {
    return;
  }

  const source = row.querySelector(".mapping-source")?.value || "column";
  const dynamicControl = row.querySelector(".mapping-dynamic-control");
  const previousColumn = row.querySelector(".mapping-select")?.value || "";
  const previousStatic = row.querySelector(".mapping-static")?.value || "";

  if (!dynamicControl) {
    return;
  }

  if (source === "static") {
    dynamicControl.innerHTML = `
      <input
        class="mapping-static"
        data-template-key="${escapeHtml(templateKey)}"
        placeholder="Same value for all rows"
        autocomplete="off"
        value="${escapeHtml(previousStatic)}"
      />
    `;
    return;
  }

  const options = `<option value="">Select column</option>${contactColumns
    .map((column) => `<option value="${escapeHtml(column)}">${escapeHtml(column)}</option>`)
    .join("")}`;

  dynamicControl.innerHTML = `
    <select class="mapping-select" data-template-key="${escapeHtml(templateKey)}">
      ${options}
    </select>
  `;

  const select = dynamicControl.querySelector(".mapping-select");
  const match = previousColumn || findBestColumnForTemplateKey(templateKey);
  if (match) {
    select.value = match;
  }
}

function getSelectedTemplateFields() {
  const selected = templates.find((template) => template.name === templateSelect.value);
  return selected?.values || [];
}

function getSelectedBulkTemplateFields() {
  const selected = templates.find((template) => template.name === bulkTemplateSelect.value);
  return selected?.values || [];
}

function getBulkValueMappings() {
  return Object.fromEntries(
    Array.from(document.querySelectorAll(".mapping-row"))
      .map((row) => {
        const templateKey = row.dataset.templateKey;
        const source = row.querySelector(".mapping-source")?.value || "column";
        const column = row.querySelector(".mapping-select")?.value || "";
        const value = row.querySelector(".mapping-static")?.value.trim() || "";

        return [
          templateKey,
          source === "static" ? { source, value } : { source: "column", column },
        ];
      })
      .filter(([templateKey]) => templateKey),
  );
}

function renderContacts(payload) {
  contactRows = payload.rows || [];
  contactColumns = payload.columns || [];
  contactCount.textContent = String(contactRows.length);

  const options = contactColumns
    .map((column) => `<option value="${escapeHtml(column)}">${escapeHtml(column)}</option>`)
    .join("");
  phoneColumnSelect.innerHTML = options;

  selectLikelyColumn(phoneColumnSelect, [
    /^(phone|mobile|number|whatsapp|contact)(\W|$)/i,
    /(\W|_)(phone|mobile|number|whatsapp|contact)(\W|$)/i,
  ]);
  renderValueMappings();

  const visibleColumns = contactColumns.slice(0, 5);
  contactsHead.innerHTML = visibleColumns.length
    ? `<tr>${visibleColumns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>`
    : "";
  contactsBody.innerHTML = contactRows
    .slice(0, 8)
    .map(
      (row) =>
        `<tr>${visibleColumns.map((column) => `<td>${escapeHtml(row[column])}</td>`).join("")}</tr>`,
    )
    .join("");

  logActivity(
    contactRows.length ? `Parsed ${contactRows.length} rows from ${payload.sheetName || "file"}.` : "No rows found.",
  );
}

async function parseWorkbookUpload(file, options = {}) {
  const sheetIndex = Number.isFinite(options.sheetIndex) ? Math.max(0, Math.floor(options.sheetIndex)) : 0;
  const rowLimit = Number.isFinite(options.rowLimit) ? Math.max(1, Math.floor(options.rowLimit)) : null;
  const query = new URLSearchParams({ sheetIndex: String(sheetIndex) });
  if (rowLimit) {
    query.set("rowLimit", String(rowLimit));
  }
  const response = await fetch(`/api/contacts/upload?${query.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: await file.arrayBuffer(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to parse file.");
  }
  return data;
}

function updateSmtpColumnsAndPreview() {
  const recipientOptions = `<option value="">Select email column</option>${smtpAudienceColumns
    .map((column) => `<option value="${escapeHtml(column)}">${escapeHtml(column)}</option>`)
    .join("")}`;
  smtpRecipientColumn.innerHTML = recipientOptions;
  if (smtpRecipientColumnWrap) {
    smtpRecipientColumnWrap.classList.toggle("is-hidden", !smtpAudienceColumns.length);
  }
  if (smtpAudienceSheetWrap) {
    const showSheetPicker = Boolean(smtpAudienceFile) && smtpAudienceSheetNames.length > 1;
    smtpAudienceSheetWrap.classList.toggle("is-hidden", !showSheetPicker);
  }

  selectLikelyColumn(smtpRecipientColumn, [/email/i, /mail/i, /recipient/i, /to/i]);
  renderSmtpVariableTokens();
  renderSmtpPreview();
}

function getSelectedSmtpBodyFormat() {
  const value = String(smtpBodyFormat?.value || "html").trim().toLowerCase();
  return value === "plain" ? "plain" : "html";
}

function getSelectedSmtpSendRatePerMinute() {
  const fallback = Math.max(1, Math.floor(Number(smtpDefaultSendRatePerMinute) || 120));
  const parsed = Math.floor(Number(smtpSendRatePerMinuteInput?.value || fallback));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(60000, parsed);
}

function interpolateSmtpTemplate(templateValue, rowData = {}) {
  return String(templateValue || "").replace(/{{\s*([^{}]+?)\s*}}/g, (_, rawKey) => {
    const key = String(rawKey || "").trim();
    if (!key) {
      return "";
    }
    return String(rowData[key] ?? "").trim();
  });
}

function buildSmtpPreviewBodies(bodyTemplate, rowData = {}, format = "html") {
  const rendered = interpolateSmtpTemplate(bodyTemplate, rowData);
  const mode = format === "plain" ? "plain" : "html";
  if (mode === "plain") {
    return {
      html: `<div>${escapeHtml(rendered).replace(/\r?\n/g, "<br>")}</div>`,
      text: rendered,
    };
  }

  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(rendered);
  return {
    html: looksLikeHtml ? rendered : `<div>${escapeHtml(rendered).replace(/\r?\n/g, "<br>")}</div>`,
    text: rendered.replace(/<[^>]+>/g, ""),
  };
}

function closeSmtpPreviewModal() {
  if (!smtpPreviewModal) {
    return;
  }
  smtpPreviewModal.classList.remove("is-open");
  smtpPreviewModal.setAttribute("aria-hidden", "true");
}

function openSmtpPreviewModal() {
  if (!smtpPreviewModal || !smtpPreviewSubject || !smtpMailPreviewBody) {
    return;
  }

  const recipientColumn = String(smtpRecipientColumn?.value || "").trim();
  const sampleRow = smtpAudienceRows[0] && typeof smtpAudienceRows[0] === "object" ? smtpAudienceRows[0] : {};
  const previewRow = {
    ...sampleRow,
    recipientEmail: recipientColumn ? String(sampleRow[recipientColumn] || "").trim() : "",
  };
  const subject = interpolateSmtpTemplate(String(smtpSubjectTemplate?.value || ""), previewRow);
  const format = getSelectedSmtpBodyFormat();
  const bodyTemplate = String(smtpBodyTemplate?.value || "");
  const previewBodies = buildSmtpPreviewBodies(bodyTemplate, previewRow, format);

  smtpPreviewSubject.textContent = subject || "(No subject)";
  if (smtpPreviewMeta) {
    smtpPreviewMeta.textContent = smtpAudienceRows.length
      ? `Previewing first row of ${smtpAudienceRows.length} recipients (${format.toUpperCase()}).`
      : `Previewing template only (${format.toUpperCase()}).`;
  }

  if (format === "plain") {
    smtpMailPreviewBody.innerHTML = `<pre class="smtp-preview-plain">${escapeHtml(previewBodies.text || "")}</pre>`;
  } else {
    const htmlWithoutScript = String(previewBodies.html || "").replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
    smtpMailPreviewBody.innerHTML = `<div class="smtp-preview-render">${htmlWithoutScript}</div>`;
  }

  smtpPreviewModal.classList.add("is-open");
  smtpPreviewModal.setAttribute("aria-hidden", "false");
}

function renderSmtpVariableTokens() {
  if (!smtpVariableTokens) {
    return;
  }

  if (!smtpAudienceColumns.length) {
    smtpVariableTokens.innerHTML = "";
    return;
  }

  smtpVariableTokens.innerHTML = smtpAudienceColumns
    .map(
      (column) =>
        `<button type="button" class="smtp-token" data-token="{{${escapeHtml(column)}}}">{{${escapeHtml(
          column,
        )}}}</button>`,
    )
    .join("");
}

function renderSmtpPreview() {
  const visibleColumns = smtpAudienceColumns.slice(0, 6);

  smtpPreviewHead.innerHTML = visibleColumns.length
    ? `<tr>${visibleColumns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>`
    : "";

  smtpPreviewBody.innerHTML = smtpAudienceRows.length
    ? smtpAudienceRows
      .slice(0, 8)
      .map(
        (row) =>
          `<tr>${visibleColumns.map((column) => `<td>${escapeHtml(row[column] ?? "")}</td>`).join("")}</tr>`,
      )
      .join("")
    : `<tr><td colspan="6" class="report-empty-cell">No SMTP data preview yet.</td></tr>`;
}

function insertSmtpToken(token) {
  const target = smtpTemplateFocusField === "subject" ? smtpSubjectTemplate : smtpBodyTemplate;
  if (!target) {
    return;
  }

  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? target.value.length;
  const currentValue = target.value || "";
  target.value = `${currentValue.slice(0, start)}${token}${currentValue.slice(end)}`;
  target.focus();
  const cursor = start + token.length;
  target.setSelectionRange(cursor, cursor);
}

function getSelectedSmtpProvider() {
  const value = String(smtpProvider?.value || "").trim().toLowerCase();
  if (value && smtpProviderOptions.includes(value)) {
    return value;
  }

  const configuredDefault = String(smtpDefaultProvider || "").trim().toLowerCase();
  if (configuredDefault && smtpProviderOptions.includes(configuredDefault)) {
    return configuredDefault;
  }

  return smtpProviderOptions[0] || "";
}

function renderSmtpProviderOptions(selectedValue = "") {
  if (!smtpProvider) {
    return;
  }

  smtpProvider.innerHTML = smtpProviderOptions.length
    ? smtpProviderOptions
      .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value.toUpperCase())}</option>`)
      .join("")
    : `<option value="">No SMTP provider configured</option>`;

  const resolved = String(selectedValue || "").trim().toLowerCase();
  if (resolved && smtpProviderOptions.includes(resolved)) {
    smtpProvider.value = resolved;
    return;
  }
  smtpProvider.value = smtpProviderOptions[0] || "";
}

function renderSmtpFromOptions(selectedValue = "") {
  if (!smtpFromAddress) {
    return;
  }

  const provider = getSelectedSmtpProvider();
  const options = Array.isArray(smtpFromOptionsByProvider[provider]) ? smtpFromOptionsByProvider[provider] : [];
  const providerDefaultFrom = String(smtpDefaultFromByProvider[provider] || "").trim();

  smtpFromAddress.innerHTML = options.length
    ? options
      .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
      .join("")
    : `<option value="">No sender configured</option>`;

  if (selectedValue && options.includes(selectedValue)) {
    smtpFromAddress.value = selectedValue;
    return;
  }

  if (providerDefaultFrom && options.includes(providerDefaultFrom)) {
    smtpFromAddress.value = providerDefaultFrom;
    return;
  }

  if (options.length) {
    smtpFromAddress.value = options[0];
    return;
  }

  smtpFromAddress.value = "";
}

function renderSmtpReplyToDefault(selectedValue = "") {
  if (!smtpReplyToAddress) {
    return;
  }

  const provider = getSelectedSmtpProvider();
  const providerDefaultReplyTo = String(smtpDefaultReplyToByProvider[provider] || "").trim();
  const requested = String(selectedValue || "").trim();
  smtpReplyToAddress.value = requested || providerDefaultReplyTo;
}

function isValidEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function renderSmtpCredentialProviderOptions(selectedValue = "") {
  if (!smtpCredProvider) {
    return;
  }

  const providers = smtpProviderOptions;
  if (!providers.length) {
    smtpCredProvider.innerHTML = `<option value="">No SMTP provider configured</option>`;
    smtpCredProvider.value = "";
    return;
  }

  smtpCredProvider.innerHTML = providers
    .map((provider) => `<option value="${escapeHtml(provider)}">${escapeHtml(provider.toUpperCase())}</option>`)
    .join("");

  const selected = String(selectedValue || providers[0] || "").trim().toLowerCase();
  smtpCredProvider.value = providers.includes(selected) ? selected : providers[0] || "";
}

function resetSmtpCredentialForm() {
  editingSmtpCredentialId = "";
  if (smtpCredentialForm) {
    smtpCredentialForm.reset();
  }
  renderSmtpCredentialProviderOptions(getSelectedSmtpProvider());
  if (smtpCredPort) {
    smtpCredPort.value = "587";
  }
  if (smtpCredSetActive) {
    smtpCredSetActive.checked = true;
  }
  if (smtpCredSaveButton) {
    smtpCredSaveButton.textContent = "Save Credential";
  }
  if (smtpCredProvider) {
    smtpCredProvider.disabled = false;
  }
  if (smtpCredPass) {
    smtpCredPass.placeholder = "SMTP password";
  }
  if (smtpCredentialEditorTitle) {
    smtpCredentialEditorTitle.textContent = "Add SMTP Credential";
  }
}

function openSmtpCredentialForm(mode = "add") {
  if (!smtpCredentialEditor) {
    return;
  }
  smtpCredentialEditor.classList.remove("is-hidden");
  if (smtpCredentialEditorTitle) {
    smtpCredentialEditorTitle.textContent = mode === "edit" ? "Edit SMTP Credential" : "Add SMTP Credential";
  }
}

function closeSmtpCredentialForm() {
  if (!smtpCredentialEditor) {
    return;
  }
  smtpCredentialEditor.classList.add("is-hidden");
}

function populateSmtpCredentialForm(item) {
  if (!item || !smtpCredName) {
    return;
  }

  openSmtpCredentialForm("edit");
  editingSmtpCredentialId = String(item.id || "");
  smtpCredName.value = String(item.profileName || "");
  renderSmtpCredentialProviderOptions(String(item.provider || ""));
  if (smtpCredProvider) {
    smtpCredProvider.disabled = true;
  }
  if (smtpCredHost) {
    smtpCredHost.value = String(item.host || "");
  }
  if (smtpCredPort) {
    smtpCredPort.value = String(item.port || 587);
  }
  if (smtpCredSecure) {
    smtpCredSecure.checked = Boolean(item.secure);
  }
  if (smtpCredUser) {
    smtpCredUser.value = String(item.user || "");
  }
  if (smtpCredPass) {
    smtpCredPass.value = "";
    smtpCredPass.placeholder = "Leave empty to keep existing password";
  }
  if (smtpCredFrom) {
    smtpCredFrom.value = String(item.fromAddress || "");
  }
  if (smtpCredFromName) {
    smtpCredFromName.value = String(item.fromName || "");
  }
  if (smtpCredReplyTo) {
    smtpCredReplyTo.value = String(item.replyToAddress || "");
  }
  if (smtpCredFromOptions) {
    smtpCredFromOptions.value = Array.isArray(item.fromOptions) ? item.fromOptions.join(", ") : "";
  }
  if (smtpCredSetActive) {
    smtpCredSetActive.checked = Boolean(item.isActive);
  }
  if (smtpCredSaveButton) {
    smtpCredSaveButton.textContent = "Update Credential";
  }
}

function renderSmtpCredentialList() {
  if (!smtpCredentialList) {
    return;
  }

  if (!smtpCredentials.length) {
    smtpCredentialList.innerHTML =
      '<tr><td colspan="6" class="report-empty-cell">No SMTP credentials saved yet.</td></tr>';
    return;
  }

  smtpCredentialList.innerHTML = smtpCredentials
    .map((item) => {
      const isActive = Boolean(item.isActive);
      const isDefault = isActive && String(item.provider || "") === smtpDefaultProvider;
      const statusLabel = isDefault ? "Active / Default" : isActive ? "Active" : "Saved";
      const provider = String(item.provider || "").toLowerCase();
      const makeDefaultDisabled = !isActive || isDefault;
      const fromLabel = item.fromName
        ? `${escapeHtml(String(item.fromName || ""))} &lt;${escapeHtml(item.fromAddress || "-")}&gt;`
        : escapeHtml(item.fromAddress || "-");
      return `
        <tr>
          <td>${escapeHtml(item.profileName || "-")}</td>
          <td>${escapeHtml(String(item.provider || "").toUpperCase())}</td>
          <td title="${escapeHtml(item.host || "")}">${escapeHtml(item.host || "-")}</td>
          <td>
            <div class="smtp-sender-cell">
              <strong>${fromLabel}</strong>
              <span>${escapeHtml(item.user || "-")}</span>
            </div>
          </td>
          <td>
            <span class="report-status ${isActive ? "success" : "neutral"}">${statusLabel}</span>
          </td>
          <td>
            <div class="smtp-cred-actions">
              <button type="button" class="btn-text" data-action="edit" data-id="${escapeHtml(item.id || "")}">Edit</button>
              <button type="button" class="btn-text" data-action="activate" data-id="${escapeHtml(item.id || "")}">Set Active</button>
              <button type="button" class="btn-text" data-action="make-default" data-id="${escapeHtml(item.id || "")}" data-provider="${escapeHtml(provider)}" ${makeDefaultDisabled ? "disabled" : ""
        }>Make Default</button>
              <button type="button" class="btn-text text-danger" data-action="delete" data-id="${escapeHtml(item.id || "")}">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderConfigCenterInfo() {
  return;
}

async function setDefaultProvider(provider) {
  const selectedProvider = String(provider || "").trim().toLowerCase();
  if (!selectedProvider) {
    logActivity("Select SMTP provider first.", "warn");
    return;
  }

  const selectedStatus = smtpProviderStatuses.find(
    (item) => String(item.provider || "").trim().toLowerCase() === selectedProvider,
  );

  if (selectedStatus && !selectedStatus.configured) {
    logActivity(`Provider ${selectedProvider.toUpperCase()} is not configured yet.`, "warn");
    return;
  }

  const response = await fetch("/api/smtp-default-provider", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: selectedProvider }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to update default SMTP provider.");
  }
}

async function loadConfig() {
  try {
    logActivity("Loading app configuration...");
    const response = await fetch("/api/config");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to load configuration.");
    }

    templates = data.templates;
    const templateOptions = templates
      .map((template) => `<option value="${template.name}">${template.label}</option>`)
      .join("");
    templateSelect.innerHTML = templateOptions;
    bulkTemplateSelect.innerHTML = templateOptions;
    bulkTemplateSelect.value = templateSelect.value;
    renderTemplatePicker();
    phoneInput.value = data.defaultRecipient || "";
    smtpProviderOptions = Array.isArray(data.smtpProviderOptions)
      ? data.smtpProviderOptions.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
      : [];
    smtpFromOptionsByProvider = data.smtpFromOptionsByProvider && typeof data.smtpFromOptionsByProvider === "object"
      ? data.smtpFromOptionsByProvider
      : {};
    smtpDefaultFromByProvider = data.smtpDefaultFromByProvider && typeof data.smtpDefaultFromByProvider === "object"
      ? data.smtpDefaultFromByProvider
      : {};
    smtpDefaultReplyToByProvider =
      data.smtpDefaultReplyToByProvider && typeof data.smtpDefaultReplyToByProvider === "object"
        ? data.smtpDefaultReplyToByProvider
        : {};
    smtpProviderStatuses = Array.isArray(data.smtpProviderStatuses) ? data.smtpProviderStatuses : [];
    smtpDefaultProvider = String(data.smtpDefaultProvider || "").trim().toLowerCase();
    smtpDefaultSendRatePerMinute = Math.max(1, Math.floor(Number(data.smtpSendRatePerMinute || 120) || 120));
    smtpCredentials = Array.isArray(data.smtpCredentials) ? data.smtpCredentials : [];
    if (smtpSendRatePerMinuteInput) {
      smtpSendRatePerMinuteInput.value = String(smtpDefaultSendRatePerMinute);
    }
    renderSmtpProviderOptions(smtpDefaultProvider);
    renderSmtpFromOptions(String(smtpDefaultFromByProvider[getSelectedSmtpProvider()] || "").trim());
    renderSmtpReplyToDefault(String(smtpDefaultReplyToByProvider[getSelectedSmtpProvider()] || "").trim());
    renderSmtpCredentialProviderOptions(getSelectedSmtpProvider());
    renderSmtpCredentialList();
    renderConfigCenterInfo();
    if (!editingSmtpCredentialId) {
      resetSmtpCredentialForm();
    }
    updateTemplateFields();
    renderValueMappings();
    renderSmtpVariableTokens();
    renderSmtpPreview();
    setStatus("Ready");
    logActivity(`Configuration loaded. Templates: ${templates.length}.`);
    await loadDashboardSummary({ quiet: true, force: true });
  } catch (error) {
    setStatus("Config error", "error");
    logActivity(error.message, "error");
  }
}

function renderInbox(conversations) {
  const visibleConversations = filterInboxConversations(conversations);

  if (!visibleConversations.length) {
    const hasSearch = Boolean(String(inboxSearchQuery || "").trim());
    inboxList.innerHTML = `
      <div class="chat-empty">
        <strong>${hasSearch ? "No match found" : "No replies yet"}</strong>
        <span>${hasSearch
        ? `No chats found for \"${escapeHtml(inboxSearchQuery)}\".`
        : "Incoming WhatsApp replies will appear here."
      }</span>
      </div>
    `;
    if (!selectedConversationId && !hasSearch) {
      threadTitle.textContent = "Select a contact";
      threadSubtitle.textContent = "Conversation details will appear here";
      threadAvatar.textContent = "TW";
      threadMessages.innerHTML = `
        <div class="thread-empty">
          <strong>No conversation selected</strong>
          <span>Choose a chat from the left panel to view messages.</span>
        </div>
      `;
    }
    return;
  }

  inboxList.innerHTML = visibleConversations
    .map((conversation) => {
      const isActive = conversation.id === selectedConversationId;
      const preview = getConversationPreview(conversation);
      const participant = conversation.participant || conversation.replyTo || "Unknown";
      return `
        <button
          type="button"
          class="inbox-item ${isActive ? "active" : ""}"
          data-conversation-id="${escapeHtml(conversation.id)}"
          data-participant="${escapeHtml(participant)}"
          data-reply-to="${escapeHtml(conversation.replyTo || "")}"
        >
          <span class="inbox-avatar">${escapeHtml(getConversationInitials(participant))}</span>
          <div class="inbox-item-head">
            <strong>${escapeHtml(participant)}</strong>
            <span>${escapeHtml(formatChatTime(conversation.lastTimestamp))}</span>
          </div>
          <p>${escapeHtml(preview)}</p>
          ${conversation.unread ? `<span class="inbox-unread">${conversation.unread} new</span>` : ""}
        </button>
      `;
    })
    .join("");
}

function renderThread(messages) {
  if (!messages.length) {
    threadMessages.innerHTML = `
      <div class="thread-empty">
        <strong>No messages</strong>
        <span>This conversation has no messages yet.</span>
      </div>
    `;
    return;
  }

  let currentDate = "";
  threadMessages.innerHTML = messages
    .map((message) => {
      const messageDate = formatChatDate(message.timestamp);
      const divider =
        messageDate && messageDate !== currentDate
          ? `<div class="date-divider"><span>${escapeHtml(messageDate)}</span></div>`
          : "";
      currentDate = messageDate || currentDate;
      const isOutbound = message.direction === "outbound";
      const body = message.text ? `<p>${escapeHtml(message.text)}</p>` : "";
      const status = isOutbound && message.status ? `<span class="msg-status">${escapeHtml(message.status)}</span>` : "";

      return `
        ${divider}
        <div class="msg-row ${isOutbound ? "out" : "in"}">
          <div class="msg-bubble">
            ${body}
            ${renderMediaInMessage(message)}
            <div class="msg-meta">
              <span>${escapeHtml(formatChatTime(message.timestamp))}</span>
              ${status}
            </div>
            ${isOutbound && message.statusDetails
          ? `<span class="msg-status-detail">${escapeHtml(message.statusDetails)}</span>`
          : ""
        }
          </div>
        </div>
      `;
    })
    .join("");

  threadMessages.scrollTop = threadMessages.scrollHeight;
}

function renderMediaInMessage(message) {
  const type = String(message.type || "").toLowerCase();
  const media = message.media || null;
  if (!media && type !== "image" && type !== "document") {
    return "";
  }

  const mediaKind = String(media?.mimeType || "").toLowerCase().startsWith("image/")
    ? "image"
    : type;

  if (mediaKind === "image") {
    const src = media?.id ? `/api/media/${encodeURIComponent(media.id)}` : media?.mediaUri || "";
    if (!src) {
      return "";
    }
    return `
      <a class="chat-image-link" href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer">
        <img class="chat-media chat-image" src="${escapeHtml(src)}" alt="Shared image" loading="lazy" />
      </a>
    `;
  }

  if (type === "document" || type === "audio" || type === "video" || type === "sticker") {
    const href = media?.id ? `/api/media/${encodeURIComponent(media.id)}` : media?.mediaUri || "";
    const label = media?.fileName || media?.mimeType || `${getMessageTypeLabel(message)} file`;
    if (!href) {
      return `
        <div class="chat-file disabled">
          <span class="chat-file-icon">${escapeHtml(getMessageTypeLabel(message).slice(0, 1))}</span>
          <span>
            <strong>${escapeHtml(label)}</strong>
            <em>${escapeHtml(getMessageTypeLabel(message))}</em>
          </span>
        </div>
      `;
    }
    return `
      <a class="chat-file" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
        <span class="chat-file-icon">${escapeHtml(getMessageTypeLabel(message).slice(0, 1))}</span>
        <span>
          <strong>${escapeHtml(label)}</strong>
          <em>${escapeHtml(getMessageTypeLabel(message))}</em>
        </span>
      </a>
    `;
  }

  return "";
}

function detectAttachmentType(file) {
  const mime = String(file?.type || "").toLowerCase();
  if (mime.startsWith("image/")) {
    return "image";
  }
  return "document";
}

function clearAttachment() {
  pendingAttachment = null;
  replyFileInput.value = "";
  replyAttachmentPreview.hidden = true;
  replyAttachmentPreview.innerHTML = "";
}

function renderAttachmentPreview() {
  if (!pendingAttachment) {
    clearAttachment();
    return;
  }

  const kind = detectAttachmentType(pendingAttachment);
  replyAttachmentPreview.hidden = false;
  replyAttachmentPreview.innerHTML = `
    <span class="attachment-chip">
      <strong>${kind === "image" ? "Image" : "Document"}</strong>
      <em>${escapeHtml(pendingAttachment.name)}</em>
      <button type="button" id="removeAttachmentButton" class="attachment-remove" aria-label="Remove attachment">x</button>
    </span>
  `;
  const removeButton = document.querySelector("#removeAttachmentButton");
  if (removeButton) {
    removeButton.addEventListener("click", clearAttachment);
  }
}

async function uploadAttachment(file) {
  logActivity(`Uploading attachment: ${file.name}`);
  const response = await fetch("/api/uploads", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "x-file-name": encodeURIComponent(file.name || "file.bin"),
      "x-file-type": file.type || "application/octet-stream",
    },
    body: await file.arrayBuffer(),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to upload attachment.");
  }

  logActivity(`Attachment uploaded: ${data.fileName || file.name}`);
  return data;
}

async function loadInbox(options = {}) {
  if (activeView !== "chat") {
    await loadInboxCount({ quiet: true });
    return;
  }
  const append = options.append === true;
  const quiet = options.quiet === true;
  const query = String(options.query ?? inboxSearchQuery ?? "").trim();
  const shouldAppend = append;
  const offset = shouldAppend ? inboxOffset : 0;
  try {
    if (!quiet) {
      logActivity(append ? `Loading more chats from offset ${offset}...` : "Loading latest chats...");
    }
    const fullLimit = CONVERSATION_PAGE_SIZE;
    const url =
      `/api/inbox?limit=${inboxPageSize}` +
      `&offset=${offset}` +
      `&fullLimit=${fullLimit}` +
      `&includeRecentConversation=${query ? "0" : "1"}` +
      `&q=${encodeURIComponent(query)}`;
    const response = await fetch(
      url,
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to load inbox.");
    }
    const conversations = data.conversations || [];
    const recentConversation = data.recentConversation || null;
    setInboxCount(data.total || conversations.length || 0);
    inboxHasMore = Boolean(data.hasMore);
    inboxOffset = conversations.length + (shouldAppend ? inboxOffset : 0);
    inboxConversations = shouldAppend ? [...inboxConversations, ...conversations] : conversations;

    const stillExists = inboxConversations.some((conversation) => conversation.id === selectedConversationId);
    if (!shouldAppend && !selectedConversationId) {
      selectedConversationId = inboxConversations[0]?.id || "";
      selectedParticipant = inboxConversations[0]?.participant || "";
    } else if (!shouldAppend && stillExists) {
      const selectedConversation = inboxConversations.find(
        (conversation) => conversation.id === selectedConversationId,
      );
      if (selectedConversation) {
        selectedParticipant = selectedConversation.replyTo || selectedConversation.participant || selectedParticipant;
      }
    }

    if (!shouldAppend && recentConversation && recentConversation.id) {
      const shouldHydrateRecent = !selectedConversationId || selectedConversationId === recentConversation.id;
      if (shouldHydrateRecent) {
        selectedConversationId = recentConversation.id;
        selectedParticipant = recentConversation.replyTo || recentConversation.participant || selectedParticipant;
        threadTitle.textContent = recentConversation.participant || "Unknown";
        threadSubtitle.textContent = recentConversation.replyTo
          ? `Reply to ${recentConversation.replyTo}`
          : "WhatsApp conversation";
        threadAvatar.textContent = getConversationInitials(recentConversation.participant);
        renderThread(recentConversation.messages || []);
      }
    }

    renderInbox(inboxConversations);
    if (!quiet) {
      logActivity(
        `Chats loaded: visible ${inboxConversations.length}, hasMore=${inboxHasMore ? "yes" : "no"}.`,
      );
    }
  } catch (error) {
    if (!quiet) {
      logActivity(error.message, "error");
    }
  } finally {
    inboxLoadingMore = false;
  }
}

async function loadConversation(conversationId, focusInput = true, options = {}) {
  const requestSeq = ++conversationRequestSeq;
  try {
    const markRead = options.markRead !== false;
    const quiet = options.quiet === true;
    const limit = Number.isFinite(options.limit)
      ? Math.max(20, Math.min(200, Math.floor(options.limit)))
      : CONVERSATION_PAGE_SIZE;
    if (!quiet) {
      logActivity(`Opening chat ${conversationId}${markRead ? " (mark read)" : ""}...`);
    }
    const response = await fetch(
      `/api/inbox/${encodeURIComponent(conversationId)}?markRead=${markRead ? "1" : "0"}&limit=${limit}`,
    );
    const data = await response.json();
    if (requestSeq !== conversationRequestSeq) {
      return;
    }
    if (!response.ok) {
      throw new Error(data.error || "Failed to load conversation.");
    }
    selectedConversationId = data.id;
    selectedParticipant = data.replyTo || data.participant;
    renderInbox(inboxConversations);
    threadTitle.textContent = data.participant;
    threadSubtitle.textContent = data.replyTo ? `Reply to ${data.replyTo}` : "WhatsApp conversation";
    threadAvatar.textContent = getConversationInitials(data.participant);
    renderThread(data.messages || []);
    if (!quiet) {
      logActivity(`Chat loaded: ${data.participant}, messages=${(data.messages || []).length}.`);
    }
    if (focusInput) {
      replyInput.focus();
    }
  } catch (error) {
    if (!options.quiet) {
      logActivity(error.message, "error");
    }
  }
}

templateSelect.addEventListener("change", () => {
  updateTemplatePickerValue();
  updateTemplateFields();
});

bulkTemplateSelect.addEventListener("change", () => {
  renderValueMappings();
});

templatePickerButton.addEventListener("click", () => {
  const isOpen = templatePicker.dataset.open === "true";
  templatePicker.dataset.open = String(!isOpen);
  templatePickerButton.setAttribute("aria-expanded", String(!isOpen));
});

templatePickerMenu.addEventListener("click", (event) => {
  const option = event.target.closest(".custom-select-option");
  if (!option) {
    return;
  }

  templateSelect.value = option.dataset.value;
  templateSelect.dispatchEvent(new Event("change"));
  closeTemplatePicker();
});

document.addEventListener("click", (event) => {
  if (!templatePicker.contains(event.target)) {
    closeTemplatePicker();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeTemplatePicker();
    closeSmtpPreviewModal();
  }
});

viewTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    switchView(tab.dataset.view);
  });
});

if (chatSearchInput) {
  chatSearchInput.addEventListener("input", () => {
    inboxSearchQuery = String(chatSearchInput.value || "").trim();
    if (inboxSearchDebounceTimer) {
      clearTimeout(inboxSearchDebounceTimer);
    }
    inboxSearchDebounceTimer = setTimeout(() => {
      inboxLoadingMore = false;
      loadInbox({ quiet: true, query: inboxSearchQuery }).catch(() => { });
    }, 1000);
  });
}

loadSheetButton.addEventListener("click", async () => {
  loadSheetButton.disabled = true;
  setStatus("Parsing", "sending");
  logActivity("Reading Google Sheet...");

  try {
    const response = await fetch("/api/contacts/sheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheetUrl: sheetUrlInput.value }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to parse sheet.");
    }

    renderContacts(data);
    setStatus("Parsed");
  } catch (error) {
    setStatus("Parse failed", "error");
    logActivity(error.message, "error");
  } finally {
    loadSheetButton.disabled = false;
  }
});

fileUpload.addEventListener("change", async () => {
  const file = fileUpload.files[0];
  if (!file) {
    return;
  }

  setStatus("Parsing", "sending");
  logActivity(`Reading file: ${file.name}...`);

  try {
    const response = await fetch("/api/contacts/upload", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: await file.arrayBuffer(),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to parse file.");
    }

    renderContacts(data);
    setStatus("Parsed");
  } catch (error) {
    setStatus("Parse failed", "error");
    logActivity(error.message, "error");
  }
});

if (smtpSubjectTemplate) {
  smtpSubjectTemplate.addEventListener("focus", () => {
    smtpTemplateFocusField = "subject";
  });
}

if (smtpBodyTemplate) {
  smtpBodyTemplate.addEventListener("focus", () => {
    smtpTemplateFocusField = "body";
  });
}

if (smtpBodyFormat) {
  smtpBodyFormat.addEventListener("change", () => {
    if (smtpPreviewModal?.classList.contains("is-open")) {
      openSmtpPreviewModal();
    }
  });
}

if (smtpProvider) {
  smtpProvider.addEventListener("change", () => {
    const provider = getSelectedSmtpProvider();
    if (!provider) {
      logActivity("Primary SMTP provider is not configured.", "error");
      return;
    }
    renderSmtpFromOptions(String(smtpDefaultFromByProvider[provider] || "").trim());
    renderSmtpReplyToDefault(String(smtpDefaultReplyToByProvider[provider] || "").trim());
    if (!editingSmtpCredentialId) {
      renderSmtpCredentialProviderOptions(provider);
    }
    logActivity(`SMTP provider selected: ${provider.toUpperCase()}.`);
  });
}

if (smtpVariableTokens) {
  smtpVariableTokens.addEventListener("click", (event) => {
    const tokenButton = event.target.closest(".smtp-token");
    if (!tokenButton) {
      return;
    }
    insertSmtpToken(tokenButton.dataset.token || "");
  });
}

if (smtpPreviewButton) {
  smtpPreviewButton.addEventListener("click", () => {
    openSmtpPreviewModal();
  });
}

if (smtpPreviewCloseButton) {
  smtpPreviewCloseButton.addEventListener("click", () => {
    closeSmtpPreviewModal();
  });
}

if (smtpPreviewModal) {
  smtpPreviewModal.addEventListener("click", (event) => {
    if (event.target === smtpPreviewModal) {
      closeSmtpPreviewModal();
    }
  });
}

if (smtpCredResetButton) {
  smtpCredResetButton.addEventListener("click", () => {
    resetSmtpCredentialForm();
    logActivity("SMTP credential form reset.");
  });
}

if (openSmtpCredentialFormButton) {
  openSmtpCredentialFormButton.addEventListener("click", () => {
    resetSmtpCredentialForm();
    openSmtpCredentialForm("add");
    logActivity("Opened add SMTP credential form.");
  });
}

if (closeSmtpCredentialFormButton) {
  closeSmtpCredentialFormButton.addEventListener("click", () => {
    closeSmtpCredentialForm();
  });
}

if (smtpCredentialForm) {
  smtpCredentialForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
      provider: String(smtpCredProvider?.value || "").trim().toLowerCase(),
      profileName: String(smtpCredName?.value || "").trim(),
      host: String(smtpCredHost?.value || "").trim(),
      port: Number(smtpCredPort?.value || 587),
      secure: Boolean(smtpCredSecure?.checked),
      user: String(smtpCredUser?.value || "").trim(),
      pass: String(smtpCredPass?.value || "").trim(),
      fromAddress: String(smtpCredFrom?.value || "").trim().toLowerCase(),
      fromName: String(smtpCredFromName?.value || "").trim(),
      replyToAddress: "",
      fromOptions: "",
      setActive: Boolean(smtpCredSetActive?.checked),
    };

    if (!payload.profileName || !payload.host || !payload.user) {
      logActivity("Profile name, host and username are required.", "warn");
      return;
    }
    if (!payload.provider) {
      logActivity("Primary SMTP provider is required.", "warn");
      return;
    }

    if (!Number.isFinite(payload.port) || payload.port <= 0 || payload.port > 65535) {
      logActivity("SMTP port must be between 1 and 65535.", "warn");
      return;
    }

    if (!isValidEmailAddress(payload.fromAddress)) {
      logActivity("From email must be valid.", "warn");
      return;
    }

    if (!editingSmtpCredentialId && !payload.pass) {
      logActivity("Password is required while creating new SMTP credential.", "warn");
      return;
    }

    const endpoint = editingSmtpCredentialId
      ? `/api/smtp-credentials/${encodeURIComponent(editingSmtpCredentialId)}`
      : "/api/smtp-credentials";
    const method = editingSmtpCredentialId ? "PUT" : "POST";

    if (smtpCredSaveButton) {
      smtpCredSaveButton.disabled = true;
    }

    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to save SMTP credential.");
      }

      logActivity(editingSmtpCredentialId ? "SMTP credential updated." : "SMTP credential saved.");
      resetSmtpCredentialForm();
      closeSmtpCredentialForm();
      await loadConfig();
    } catch (error) {
      logActivity(error.message, "error");
    } finally {
      if (smtpCredSaveButton) {
        smtpCredSaveButton.disabled = false;
      }
    }
  });
}

if (smtpCredentialList) {
  smtpCredentialList.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("button[data-action]");
    if (!actionButton) {
      return;
    }

    const action = String(actionButton.dataset.action || "").trim().toLowerCase();
    const profileId = String(actionButton.dataset.id || "").trim();
    if (!profileId) {
      return;
    }

    const target = smtpCredentials.find((item) => String(item.id || "") === profileId);
    if (!target) {
      logActivity("Selected credential not found.", "warn");
      return;
    }

    if (action === "edit") {
      populateSmtpCredentialForm(target);
      logActivity(`Editing SMTP credential: ${target.profileName || profileId}.`);
      return;
    }

    if (action === "activate") {
      try {
        const response = await fetch(`/api/smtp-credentials/${encodeURIComponent(profileId)}/activate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to activate SMTP credential.");
        }
        logActivity(`SMTP credential activated: ${target.profileName || profileId}.`);
        await loadConfig();
      } catch (error) {
        logActivity(error.message, "error");
      }
      return;
    }

    if (action === "make-default") {
      const provider = String(actionButton.dataset.provider || target.provider || "").trim().toLowerCase();
      try {
        if (!target.isActive) {
          const activateResponse = await fetch(`/api/smtp-credentials/${encodeURIComponent(profileId)}/activate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });
          const activateData = await activateResponse.json();
          if (!activateResponse.ok) {
            throw new Error(activateData.error || "Failed to activate SMTP credential.");
          }
        }

        await setDefaultProvider(provider);
        logActivity(`Default SMTP provider set to ${provider.toUpperCase()} via ${target.profileName || profileId}.`);
        await loadConfig();
      } catch (error) {
        logActivity(error.message, "error");
      }
      return;
    }

    if (action === "delete") {
      const allowDelete = confirm(`Delete SMTP credential "${target.profileName || profileId}"?`);
      if (!allowDelete) {
        return;
      }

      try {
        const response = await fetch(`/api/smtp-credentials/${encodeURIComponent(profileId)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to delete SMTP credential.");
        }

        logActivity(`SMTP credential deleted: ${target.profileName || profileId}.`);
        if (editingSmtpCredentialId === profileId) {
          resetSmtpCredentialForm();
        }
        await loadConfig();
      } catch (error) {
        logActivity(error.message, "error");
      }
    }
  });
}

if (smtpCredentialReloadButton) {
  smtpCredentialReloadButton.addEventListener("click", async () => {
    smtpCredentialReloadButton.disabled = true;
    try {
      await loadConfig();
      logActivity("SMTP Config Center refreshed.");
    } finally {
      smtpCredentialReloadButton.disabled = false;
    }
  });
}

if (smtpAnalyticsRange) {
  smtpAnalyticsRange.addEventListener("change", async () => {
    const selectedRange = String(smtpAnalyticsRange.value || "14d").trim().toLowerCase();
    smtpAnalyticsState = {
      ...smtpAnalyticsState,
      range: selectedRange,
      timelineGranularity: ["today", "yesterday"].includes(selectedRange) ? "hour" : "day",
    };

    await fetchSmtpAnalytics({
      quiet: false,
      force: true,
      range: selectedRange,
      detailLimit: SMTP_ANALYTICS_DETAIL_PAGE_SIZE,
      detailOffset: 0,
      mergeLatestDetails: true,
    });
  });
}

if (smtpAnalyticsLoadMoreButton) {
  smtpAnalyticsLoadMoreButton.addEventListener("click", async () => {
    if (smtpAnalyticsLoadMoreButton.disabled || !smtpAnalyticsDetailsState.hasMore) {
      return;
    }

    smtpAnalyticsLoadMoreButton.disabled = true;
    const previousLabel = smtpAnalyticsLoadMoreButton.textContent;
    smtpAnalyticsLoadMoreButton.textContent = "Loading...";

    try {
      await fetchSmtpAnalytics({
        quiet: false,
        force: true,
        detailLimit: SMTP_ANALYTICS_DETAIL_PAGE_SIZE,
        detailOffset: smtpAnalyticsDetailsState.records.length,
        appendDetails: true,
      });
    } finally {
      smtpAnalyticsLoadMoreButton.disabled = false;
      if (!smtpAnalyticsDetailsState.hasMore) {
        smtpAnalyticsLoadMoreButton.textContent = "No More Records";
      } else {
        smtpAnalyticsLoadMoreButton.textContent = previousLabel || `Load ${SMTP_ANALYTICS_DETAIL_PAGE_SIZE} More`;
      }
    }
  });
}

if (loadSmtpSheetButton) {
  loadSmtpSheetButton.addEventListener("click", async () => {
    const sheetUrl = String(smtpSheetUrlInput?.value || "").trim();
    if (!sheetUrl) {
      logActivity("Enter Google Sheet URL first.", "warn");
      return;
    }

    loadSmtpSheetButton.disabled = true;
    logActivity("Reading SMTP Google Sheet...");

    try {
      const response = await fetch("/api/contacts/sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetUrl, rowLimit: MAX_SMTP_LOAD_ROWS }),
      });
      const parsed = await response.json();
      if (!response.ok) {
        throw new Error(parsed.error || "Failed to parse Google Sheet.");
      }

      const parsedRows = Array.isArray(parsed.rows) ? parsed.rows : [];
      smtpAudienceRows = parsedRows.slice(0, MAX_SMTP_LOAD_ROWS);
      smtpAudienceColumns = parsed.columns || [];
      smtpAudienceSheetNames = [parsed.sheetName || "Google Sheet"];
      smtpAudienceSheet.innerHTML = `<option value="0">${escapeHtml(smtpAudienceSheetNames[0])}</option>`;
      smtpAudienceSheet.value = "0";
      smtpAudienceFile = null;
      updateSmtpColumnsAndPreview();
      smtpLiveSummary = {
        ...smtpLiveSummary,
        loaded: smtpAudienceRows.length,
        total: smtpAudienceRows.length,
        processed: 0,
        sent: 0,
        failed: 0,
        inProgress: false,
        lastMessage: "Data parsed",
        lastUpdatedAt: new Date().toISOString(),
      };
      renderSmtpLiveSummary();
      logActivity(`SMTP sheet parsed: ${smtpAudienceRows.length} rows.`);
      if (parsedRows.length > MAX_SMTP_LOAD_ROWS) {
        logActivity(`Only first ${MAX_SMTP_LOAD_ROWS} rows loaded for email campaign.`, "warn");
      }
    } catch (error) {
      logActivity(error.message, "error");
    } finally {
      loadSmtpSheetButton.disabled = false;
    }
  });
}

if (smtpAudienceUpload) {
  smtpAudienceUpload.addEventListener("change", async () => {
    const file = smtpAudienceUpload.files?.[0];
    if (!file) {
      return;
    }

    smtpAudienceFile = file;
    logActivity(`Reading audience file: ${file.name}...`);

    try {
      const parsed = await parseWorkbookUpload(file, {
        sheetIndex: 0,
        rowLimit: MAX_SMTP_LOAD_ROWS,
      });
      const parsedRows = Array.isArray(parsed.rows) ? parsed.rows : [];
      smtpAudienceRows = parsedRows.slice(0, MAX_SMTP_LOAD_ROWS);
      smtpAudienceColumns = parsed.columns || [];
      smtpAudienceSheetNames = parsed.sheetNames || [parsed.sheetName || "Sheet1"];
      smtpAudienceSheet.innerHTML = smtpAudienceSheetNames
        .map((sheetName, index) => `<option value="${index}">${escapeHtml(sheetName)}</option>`)
        .join("");
      smtpAudienceSheet.value = String(parsed.selectedSheetIndex || 0);
      updateSmtpColumnsAndPreview();
      smtpLiveSummary = {
        ...smtpLiveSummary,
        loaded: smtpAudienceRows.length,
        total: smtpAudienceRows.length,
        processed: 0,
        sent: 0,
        failed: 0,
        inProgress: false,
        lastMessage: "Data parsed",
        lastUpdatedAt: new Date().toISOString(),
      };
      renderSmtpLiveSummary();
      logActivity(`Audience parsed: ${smtpAudienceRows.length} rows.`);
      if (parsedRows.length > MAX_SMTP_LOAD_ROWS) {
        logActivity(`Only first ${MAX_SMTP_LOAD_ROWS} rows loaded for email campaign.`, "warn");
      }
    } catch (error) {
      logActivity(error.message, "error");
    }
  });
}

if (smtpAudienceSheet) {
  smtpAudienceSheet.addEventListener("change", async () => {
    if (!smtpAudienceFile) {
      return;
    }
    try {
      const parsed = await parseWorkbookUpload(smtpAudienceFile, {
        sheetIndex: Number(smtpAudienceSheet.value || 0),
        rowLimit: MAX_SMTP_LOAD_ROWS,
      });
      const parsedRows = Array.isArray(parsed.rows) ? parsed.rows : [];
      smtpAudienceRows = parsedRows.slice(0, MAX_SMTP_LOAD_ROWS);
      smtpAudienceColumns = parsed.columns || [];
      updateSmtpColumnsAndPreview();
      smtpLiveSummary = {
        ...smtpLiveSummary,
        loaded: smtpAudienceRows.length,
        total: smtpAudienceRows.length,
        processed: 0,
        sent: 0,
        failed: 0,
        inProgress: false,
        lastMessage: "Sheet loaded",
        lastUpdatedAt: new Date().toISOString(),
      };
      renderSmtpLiveSummary();
      logActivity(`Audience sheet loaded: ${parsed.sheetName || "Sheet"}.`);
      if (parsedRows.length > MAX_SMTP_LOAD_ROWS) {
        logActivity(`Only first ${MAX_SMTP_LOAD_ROWS} rows loaded for email campaign.`, "warn");
      }
    } catch (error) {
      logActivity(error.message, "error");
    }
  });
}

if (sendSmtpTestButton) {
  sendSmtpTestButton.addEventListener("click", async () => {
    const subjectTemplate = smtpSubjectTemplate ? String(smtpSubjectTemplate.value || "").trim() : "";
    const bodyTemplate = smtpBodyTemplate ? String(smtpBodyTemplate.value || "").trim() : "";
    const bodyFormat = getSelectedSmtpBodyFormat();
    if (!subjectTemplate || !bodyTemplate) {
      setStatus("SMTP test failed", "error");
      logActivity("Subject and body template are required.", "warn");
      return;
    }

    const recipientColumn = smtpRecipientColumn ? String(smtpRecipientColumn.value || "").trim() : "";
    const smtpProviderValue = getSelectedSmtpProvider() || "sesapi";
    const mailFrom = smtpFromAddress ? String(smtpFromAddress.value || "").trim() : "";
    const replyTo = smtpReplyToAddress ? String(smtpReplyToAddress.value || "").trim().toLowerCase() : "";
    if (replyTo && !isValidEmailAddress(replyTo)) {
      setStatus("SMTP test failed", "error");
      logActivity("Reply-To email must be valid.", "warn");
      return;
    }
    const testRow = smtpAudienceRows.length ? smtpAudienceRows[0] : {};
    if (!smtpAudienceRows.length) {
      logActivity("No sheet/file parsed. Sending test with plain subject/body only.", "warn");
    }

    sendSmtpTestButton.disabled = true;
    setStatus("SMTP test", "sending");
    logActivity("Sending SMTP test email...");
    smtpLiveSummary = {
      ...smtpLiveSummary,
      inProgress: true,
      lastMessage: "Sending test email",
      lastUpdatedAt: new Date().toISOString(),
    };
    renderSmtpLiveSummary();

    try {
      const response = await fetch("/api/send-smtp-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smtpProvider: smtpProviderValue,
          recipientColumn,
          subjectTemplate,
          bodyTemplate,
          bodyFormat,
          mailFrom,
          replyTo,
          row: testRow,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "SMTP test send failed.");
      }

      setStatus("SMTP test sent");
      logActivity(`SMTP test sent to ${data.testRecipient}.`);
      await fetchSmtpLiveSummary({ quiet: true });
    } catch (error) {
      setStatus("SMTP test failed", "error");
      logActivity(error.message, "error");
      smtpLiveSummary = {
        ...smtpLiveSummary,
        inProgress: false,
        lastMessage: "Test failed",
        lastUpdatedAt: new Date().toISOString(),
      };
      renderSmtpLiveSummary();
    } finally {
      sendSmtpTestButton.disabled = false;
    }
  });
}

if (sendSmtpBulkButton) {
  sendSmtpBulkButton.addEventListener("click", async () => {
    if (!smtpAudienceRows.length) {
      logActivity("Parse Google Sheet or upload file first.", "warn");
      return;
    }

    const recipientColumn = String(smtpRecipientColumn.value || "").trim();
    if (!recipientColumn) {
      logActivity("Select recipient email column.", "warn");
      return;
    }

    const subjectTemplate = String(smtpSubjectTemplate.value || "").trim();
    const bodyTemplate = String(smtpBodyTemplate.value || "").trim();
    const bodyFormat = getSelectedSmtpBodyFormat();
    const sendRatePerMinute = getSelectedSmtpSendRatePerMinute();
    const smtpProviderValue = getSelectedSmtpProvider();
    if (!smtpProviderValue) {
      setStatus("SMTP failed", "error");
      logActivity("Primary SMTP provider is not configured.", "error");
      return;
    }
    const mailFrom = String(smtpFromAddress?.value || "").trim();
    const replyTo = String(smtpReplyToAddress?.value || "").trim().toLowerCase();
    if (!subjectTemplate || !bodyTemplate) {
      logActivity("Subject and body template are required.", "warn");
      return;
    }
    if (replyTo && !isValidEmailAddress(replyTo)) {
      logActivity("Reply-To email must be valid.", "warn");
      return;
    }
    if (sendRatePerMinute <= 0) {
      logActivity("Send speed must be at least 1 email/min.", "warn");
      return;
    }

    activeSmtpCampaignId = "";
    setStatus("SMTP sending", "sending");
    logActivity(`SMTP campaign started for ${smtpAudienceRows.length} rows at ${sendRatePerMinute}/min.`);
    smtpLiveSummary = {
      ...smtpLiveSummary,
      runId: "",
      status: "queued",
      loaded: smtpAudienceRows.length,
      total: smtpAudienceRows.length,
      processed: 0,
      sent: 0,
      failed: 0,
      inProgress: true,
      lastMessage: "Campaign started",
      lastUpdatedAt: new Date().toISOString(),
    };
    renderSmtpLiveSummary();

    try {
      const response = await fetch("/api/send-smtp-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smtpProvider: smtpProviderValue,
          recipientColumn,
          subjectTemplate,
          bodyTemplate,
          bodyFormat,
          sendRatePerMinute,
          mailFrom,
          replyTo,
          rows: smtpAudienceRows,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "SMTP bulk send failed.");
      }

      activeSmtpCampaignId = String(data.campaignId || "").trim();
      if (data.summary && typeof data.summary === "object") {
        smtpLiveSummary = {
          ...smtpLiveSummary,
          ...data.summary,
        };
      }
      logActivity(`SMTP campaign queued: ${activeSmtpCampaignId || "pending id"}.`);
      if (data.emailValidation && typeof data.emailValidation === "object") {
        const mode = String(data.emailValidation.mode || "mx");
        const enforce = data.emailValidation.enforce === true ? "enforced" : "advisory";
        logActivity(`Email validation mode: ${mode} (${enforce}).`);
      }
      if (data.tracking && typeof data.tracking === "object") {
        const trackingBaseUrl = String(data.tracking.baseUrl || "").trim();
        const trackingReachable = data.tracking.publicReachable === true;
        if (trackingBaseUrl) {
          logActivity(`Email tracking base URL: ${trackingBaseUrl}`);
        }
        if (!trackingReachable) {
          logActivity(
            "Tracking URL looks local. Set PUBLIC_BASE_URL or run ngrok to capture real open/click events.",
            "warn",
          );
        }
      }
      if (data.trackingWarning) {
        logActivity(String(data.trackingWarning), "warn");
      }
      if (data.rejectedListEndpoint) {
        logActivity(`Rejected list API: ${String(data.rejectedListEndpoint)}`);
      }
      await fetchSmtpLiveSummary({ quiet: true });
      scheduleSmtpAnalyticsRefresh({ quiet: true, force: true, delay: 80 });
    } catch (error) {
      setStatus("SMTP failed", "error");
      logActivity(error.message, "error");
      smtpLiveSummary = {
        ...smtpLiveSummary,
        inProgress: false,
        lastMessage: "Campaign failed",
        lastUpdatedAt: new Date().toISOString(),
      };
      renderSmtpLiveSummary();
    }
  });
}

if (stopSmtpBulkButton) {
  stopSmtpBulkButton.addEventListener("click", async () => {
    try {
      const response = await fetch("/api/campaigns/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "email",
          campaignId: activeSmtpCampaignId || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to stop SMTP campaign.");
      }

      if (data.summary && typeof data.summary === "object") {
        smtpLiveSummary = {
          ...smtpLiveSummary,
          ...data.summary,
        };
      }
      renderSmtpLiveSummary();
      setStatus("SMTP stop requested", "sending");
      logActivity("SMTP campaign stop requested.");
      scheduleSmtpAnalyticsRefresh({ quiet: true, force: true, delay: 80 });
    } catch (error) {
      logActivity(error.message, "error");
    }
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const missingSingleValues = getSelectedTemplateFields()
    .filter(
      (value) =>
        !document.querySelector(`.single-value-input[data-template-key="${CSS.escape(value.name)}"]`)?.value.trim(),
    )
    .map((value) => value.name);

  if (missingSingleValues.length) {
    logActivity(`Type values for: ${missingSingleValues.join(", ")}.`, "warn");
    return;
  }

  const payload = {
    templateName: templateSelect.value,
    recipientPhoneNumber: phoneInput.value,
    valueOverrides: Object.fromEntries(
      Array.from(document.querySelectorAll(".single-value-input"))
        .map((input) => [input.dataset.templateKey, input.value.trim()])
        .filter(([, value]) => value),
    ),
  };

  sendButton.disabled = true;
  setStatus("Sending", "sending");
  logActivity("Sending single template message...");

  try {
    const response = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to send message.");
    }

    setStatus("Sent");
    logActivity(`Message sent to ${payload.recipientPhoneNumber}.`);
    logActivity(`Receipts: ${JSON.stringify(data.receipts || [])}`);
    if (activeView === "chat") {
      scheduleReportRefresh({ summaryOnly: true, force: true });
      scheduleInboxRefresh({ quiet: true, delay: 50 });
    } else {
      scheduleDashboardSummaryRefresh({ quiet: true, delay: 50, force: true });
    }
  } catch (error) {
    setStatus("Failed", "error");
    logActivity(error.message, "error");
  } finally {
    sendButton.disabled = false;
  }
});

sendBulkButton.addEventListener("click", async () => {
  if (!contactRows.length) {
    logActivity("Parse Google Sheet or upload Excel first.", "warn");
    return;
  }

  const bulkMappings = getBulkValueMappings();
  const missingBulkMappings = getSelectedBulkTemplateFields()
    .filter(
      (value) => {
        const mapping = bulkMappings[value.name];
        if (!mapping) {
          return true;
        }
        return mapping.source === "static" ? !mapping.value : !mapping.column;
      },
    )
    .map((value) => value.name);

  if (missingBulkMappings.length) {
    logActivity(`Select column or type values for: ${missingBulkMappings.join(", ")}.`, "warn");
    return;
  }

  activeWhatsappCampaignId = "";
  setStatus("Bulk sending", "sending");
  logActivity(`Bulk sending started: ${contactRows.length} contacts.`);
  whatsappLiveSummary = {
    ...whatsappLiveSummary,
    runId: "",
    status: "queued",
    loaded: contactRows.length,
    total: contactRows.length,
    processed: 0,
    sent: 0,
    failed: 0,
    inProgress: true,
    lastMessage: "Campaign started",
    lastUpdatedAt: new Date().toISOString(),
  };
  renderWhatsappCampaignState();

  try {
    const response = await fetch("/api/send-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateName: bulkTemplateSelect.value,
        phoneColumn: phoneColumnSelect.value,
        valueMappings: bulkMappings,
        rows: contactRows,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Bulk send failed.");
    }

    activeWhatsappCampaignId = String(data.campaignId || "").trim();
    if (data.summary && typeof data.summary === "object") {
      whatsappLiveSummary = {
        ...whatsappLiveSummary,
        ...data.summary,
      };
    }
    logActivity(`WA campaign queued: ${activeWhatsappCampaignId || "pending id"}.`);
    await fetchWhatsappLiveSummary({ quiet: true });
    if (activeView === "chat") {
      scheduleReportRefresh({ summaryOnly: true, force: true });
      scheduleInboxRefresh({ quiet: true, delay: 50 });
    } else {
      scheduleDashboardSummaryRefresh({ quiet: true, delay: 50, force: true });
    }
  } catch (error) {
    setStatus("Bulk failed", "error");
    logActivity(error.message, "error");
  }
});

if (stopBulkButton) {
  stopBulkButton.addEventListener("click", async () => {
    try {
      const response = await fetch("/api/campaigns/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "whatsapp",
          campaignId: activeWhatsappCampaignId || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to stop WhatsApp campaign.");
      }

      if (data.summary && typeof data.summary === "object") {
        whatsappLiveSummary = {
          ...whatsappLiveSummary,
          ...data.summary,
        };
      }
      renderWhatsappCampaignState();
      setStatus("WA stop requested", "sending");
      logActivity("WhatsApp campaign stop requested.");
    } catch (error) {
      logActivity(error.message, "error");
    }
  });
}

inboxList.addEventListener("click", async (event) => {
  const item = event.target.closest(".inbox-item");
  if (!item) {
    return;
  }
  selectedConversationId = item.dataset.conversationId || "";
  selectedParticipant = item.dataset.replyTo || item.dataset.participant || "";
  renderInbox(inboxConversations);
  await loadConversation(selectedConversationId);
});

inboxList.addEventListener("scroll", async () => {
  const nearBottom = inboxList.scrollTop + inboxList.clientHeight >= inboxList.scrollHeight - 40;
  if (!nearBottom || !inboxHasMore || inboxLoadingMore) {
    return;
  }
  inboxLoadingMore = true;
  await loadInbox({ append: true });
});

attachButton.addEventListener("click", () => {
  replyFileInput.click();
});

replyFileInput.addEventListener("change", () => {
  const file = replyFileInput.files?.[0];
  if (!file) {
    clearAttachment();
    return;
  }
  pendingAttachment = file;
  renderAttachmentPreview();
});

replyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = replyInput.value.trim();

  if (!selectedParticipant) {
    logActivity("Select a contact from inbox first.", "warn");
    return;
  }
  if (!pendingAttachment && !text) {
    return;
  }

  replyButton.disabled = true;
  attachButton.disabled = true;
  setStatus(pendingAttachment ? "Uploading" : "Replying", "sending");
  logActivity(`Reply started for ${selectedParticipant}.`);

  try {
    let messageType = "text";
    let mediaUrl = "";
    let fileName = "";

    if (pendingAttachment) {
      const upload = await uploadAttachment(pendingAttachment);
      messageType = upload.kind || detectAttachmentType(pendingAttachment);
      mediaUrl = upload.url;
      fileName = upload.fileName || pendingAttachment.name;
      setStatus("Replying", "sending");
    }

    const response = await fetch("/api/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: selectedParticipant,
        content: text,
        messageType,
        mediaUrl,
        fileName,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to send reply.");
    }

    replyInput.value = "";
    clearAttachment();
    setStatus("Reply sent");
    logActivity("Reply sent successfully.");
    skipConversationRefreshUntil = Date.now() + 1200;
    await loadConversation(selectedConversationId, false, { markRead: false, quiet: true });
    if (activeView === "chat") {
      // Conversation is already refreshed above; skip extra inbox/report requests.
    } else {
      scheduleDashboardSummaryRefresh({ quiet: true, delay: 50, force: true });
    }
  } catch (error) {
    setStatus("Reply failed", "error");
    logActivity(error.message, "error");
  } finally {
    replyButton.disabled = false;
    attachButton.disabled = false;
  }
});

if (clearLogButton) {
  clearLogButton.addEventListener("click", () => {
    clearActivityLog();
  });
}

if (downloadReportButton) {
  downloadReportButton.addEventListener("click", () => {
    if (["smtp", "analytics"].includes(activeView)) {
      const params = new URLSearchParams();
      params.set("days", String(SMTP_ANALYTICS_TIMELINE_DAYS));
      if (activeSmtpCampaignId) {
        params.set("campaignId", activeSmtpCampaignId);
      }
      window.location.href = `/api/email-analytics/export?${params.toString()}`;
      return;
    }

    window.location.href = "/api/reports/export";
  });
}

logActivity("Waiting for action.");
renderSmtpLiveSummary();
renderWhatsappCampaignState();
loadConfig();
switchView("quick");

