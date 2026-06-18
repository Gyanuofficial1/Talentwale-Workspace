// State Management
let appState = {
  headers: [],
  rows: [],
  totalRows: 0,
  currentJobId: null,
  isProcessing: false,
  stats: {
    processed: 0,
    success: 0,
    failure: 0
  },
  responses: {}, // Store full curl responses for inspection
  currentFilter: 'all' // Active filter for 1000+ records view
};

// DOM Elements
const sheetUrlInput = document.getElementById('sheet-url');
const btnFetchSheet = document.getElementById('btn-fetch-sheet');
const sheetInfoDiv = document.getElementById('sheet-info');
const infoRowCount = document.getElementById('info-row-count');
const infoColumns = document.getElementById('info-columns');
const placeholdersList = document.getElementById('placeholders-list');

const curlTemplateTextarea = document.getElementById('curl-template');
const ruleTypeSelect = document.getElementById('rule-type');
const ruleInputsContainer = document.getElementById('rule-inputs');

// Rule Groups
const groupStatusCode = document.getElementById('group-status-code');
const groupBodyContains = document.getElementById('group-body-contains');
const groupJsonPath = document.getElementById('group-json-path');
const groupJsExpr = document.getElementById('group-js-expr');

const concurrencyInput = document.getElementById('concurrency');
const delayInput = document.getElementById('delay');
const btnRunValidation = document.getElementById('btn-run-validation');

const statTotal = document.getElementById('stat-total');
const statProcessed = document.getElementById('stat-processed');
const statSuccess = document.getElementById('stat-success');
const statFailure = document.getElementById('stat-failure');

const progressContainer = document.getElementById('progress-container');
const progressStatusText = document.getElementById('progress-status-text');
const progressPercentText = document.getElementById('progress-percent-text');
const progressBarFill = document.getElementById('progress-bar-fill');

const previewTable = document.getElementById('preview-table');
const exportActions = document.getElementById('export-actions');
const btnExportExcel = document.getElementById('btn-export-excel');
const btnExportCsv = document.getElementById('btn-export-csv');

const terminalLogs = document.getElementById('terminal-logs');
const btnClearLogs = document.getElementById('btn-clear-logs');

// Initialize Icons
lucide.createIcons();

// Setup Rule Condition UI toggles
ruleTypeSelect.addEventListener('change', (e) => {
  const selected = e.target.value;
  
  // Hide all groups
  groupStatusCode.classList.add('hidden');
  groupBodyContains.classList.add('hidden');
  groupJsonPath.classList.add('hidden');
  groupJsExpr.classList.add('hidden');

  // Show selected group
  if (selected === 'status') {
    groupStatusCode.classList.remove('hidden');
  } else if (selected === 'contains') {
    groupBodyContains.classList.remove('hidden');
  } else if (selected === 'json') {
    groupJsonPath.classList.remove('hidden');
  } else if (selected === 'js') {
    groupJsExpr.classList.remove('hidden');
  }
});

// Logger Helper
function logToTerminal(message, type = 'system') {
  const line = document.createElement('div');
  line.className = `log-line ${type}-log`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  terminalLogs.appendChild(line);
  terminalLogs.scrollTop = terminalLogs.scrollHeight;
}

btnClearLogs.addEventListener('click', () => {
  terminalLogs.innerHTML = '';
});

// 1. Fetch Google Sheet Data
btnFetchSheet.addEventListener('click', async () => {
  const url = sheetUrlInput.value.trim();
  if (!url) {
    alert('Please enter a Google Sheet URL first.');
    return;
  }

  btnFetchSheet.disabled = true;
  btnFetchSheet.innerHTML = `<i data-lucide="loader" class="animate-spin"></i> Fetching...`;
  lucide.createIcons();
  
  logToTerminal(`Fetching Google Sheet from URL...`, 'system');

  try {
    const response = await fetch('/api/fetch-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch Google Sheet.');
    }

    appState.headers = data.headers;
    appState.rows = data.rows;
    appState.totalRows = data.totalRows;

    logToTerminal(`Successfully fetched ${data.totalRows} rows from Google Sheet.`, 'res-success-log');

    // Update UI Stats
    statTotal.textContent = data.totalRows;
    infoRowCount.textContent = data.totalRows;
    
    // Render placeholders list
    placeholdersList.innerHTML = '';
    infoColumns.innerHTML = '';
    data.headers.forEach(header => {
      // Columns info tags
      const colTag = document.createElement('span');
      colTag.className = 'tag';
      colTag.textContent = header;
      infoColumns.appendChild(colTag);

      // Placeholder helper tags
      const phTag = document.createElement('span');
      phTag.className = 'tag placeholder-tag';
      phTag.style.cursor = 'pointer';
      phTag.textContent = `{{${header}}}`;
      phTag.title = 'Click to insert into curl command';
      phTag.addEventListener('click', () => {
        insertTextAtCursor(curlTemplateTextarea, `{{${header}}}`);
      });
      placeholdersList.appendChild(phTag);
    });

    sheetInfoDiv.classList.remove('hidden');
    btnRunValidation.disabled = false;
    
    // Reset export buttons to disabled state
    btnExportExcel.disabled = true;
    btnExportCsv.disabled = true;
    
    appState.currentFilter = 'all';
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-filter="all"]').classList.add('active');

    renderTablePreview();
    updateTabCounts();
  } catch (err) {
    logToTerminal(`Error: ${err.message}`, 'res-fail-log');
    alert(err.message);
  } finally {
    btnFetchSheet.disabled = false;
    btnFetchSheet.innerHTML = `<i data-lucide="download"></i> Fetch`;
    lucide.createIcons();
  }
});

// Insert helper for Textarea
function insertTextAtCursor(textarea, text) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const val = textarea.value;
  textarea.value = val.substring(0, start) + text + val.substring(end);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + text.length;
}

// 2. Render Table Preview
function renderTablePreview() {
  const thead = previewTable.querySelector('thead');
  const tbody = previewTable.querySelector('tbody');

  thead.innerHTML = '';
  tbody.innerHTML = '';

  // Setup Header Row
  const headerTr = document.createElement('tr');
  
  // Row number header
  const rowNumTh = document.createElement('th');
  rowNumTh.textContent = '#';
  headerTr.appendChild(rowNumTh);

  // Status & Validation Headers
  const statusTh = document.createElement('th');
  statusTh.textContent = 'Status';
  headerTr.appendChild(statusTh);

  const valTh = document.createElement('th');
  valTh.textContent = 'Validation';
  headerTr.appendChild(valTh);

  const resTh = document.createElement('th');
  resTh.textContent = 'Response Body';
  headerTr.appendChild(resTh);

  // Dynamic headers from sheet
  appState.headers.forEach(header => {
    const th = document.createElement('th');
    th.textContent = header;
    headerTr.appendChild(th);
  });
  thead.appendChild(headerTr);

  // Limit rendering to first 1000 rows for DOM performance
  const rowsToRender = appState.rows.slice(0, 1000);
  
  rowsToRender.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.id = `row-tr-${idx + 1}`;
    tr.className = 'clickable-row';
    tr.title = 'Click to view full HTTP response';

    // Index
    const indexTd = document.createElement('td');
    indexTd.textContent = idx + 1;
    tr.appendChild(indexTd);

    // Status Code Column
    const statusTd = document.createElement('td');
    statusTd.id = `row-status-${idx + 1}`;
    statusTd.innerHTML = `<span class="badge badge-pending">Pending</span>`;
    tr.appendChild(statusTd);

    // Validation Column
    const valTd = document.createElement('td');
    valTd.id = `row-val-${idx + 1}`;
    valTd.innerHTML = `<span class="badge badge-pending">Pending</span>`;
    tr.appendChild(valTd);

    // Response Body Preview Column
    const resTd = document.createElement('td');
    resTd.id = `row-response-${idx + 1}`;
    resTd.className = 'text-ellipsis';
    resTd.textContent = 'Pending';
    tr.appendChild(resTd);

    // Data Columns
    appState.headers.forEach(header => {
      const td = document.createElement('td');
      td.textContent = row[header] || '';
      tr.appendChild(td);
    });

    tr.addEventListener('click', () => {
      showRowDetails(idx + 1);
    });

    tbody.appendChild(tr);
  });

  if (appState.rows.length > 1000) {
    const warningTr = document.createElement('tr');
    const warningTd = document.createElement('td');
    warningTd.colSpan = appState.headers.length + 4; // Adjusted for response column
    warningTd.className = 'text-center text-muted';
    warningTd.textContent = `Showing first 1000 rows. Remaining ${appState.rows.length - 1000} rows will still be validated and exported.`;
    warningTr.appendChild(warningTd);
    tbody.appendChild(warningTr);
  }
}

// 3. Run Validation Job
btnRunValidation.addEventListener('click', async () => {
  if (appState.isProcessing) return;

  const curlTemplate = curlTemplateTextarea.value.trim();
  if (!curlTemplate) {
    alert('Please enter a Curl command template.');
    return;
  }

  // Get Validation Rule
  const ruleType = ruleTypeSelect.value;
  let condition = { type: ruleType };

  if (ruleType === 'status') {
    condition.value = document.getElementById('rule-status-code').value;
  } else if (ruleType === 'contains') {
    condition.value = document.getElementById('rule-body-contains').value;
  } else if (ruleType === 'json') {
    condition.path = document.getElementById('rule-json-path').value;
    condition.value = document.getElementById('rule-json-val').value;
  } else if (ruleType === 'js') {
    condition.value = document.getElementById('rule-js-expr').value;
  }

  const concurrency = parseInt(concurrencyInput.value, 10) || 5;
  const delay = parseInt(delayInput.value, 10) || 200;

  // Reset UI State
  appState.isProcessing = true;
  appState.stats = { processed: 0, success: 0, failure: 0 };
  
  statProcessed.textContent = '0';
  statSuccess.textContent = '0';
  statFailure.textContent = '0';

  btnRunValidation.disabled = true;
  btnRunValidation.innerHTML = `<i data-lucide="loader" class="animate-spin"></i> Processing...`;
  
  progressContainer.classList.remove('hidden');
  progressStatusText.textContent = 'Starting execution...';
  progressBarFill.style.width = '0%';
  progressPercentText.textContent = '0%';
  
  // Disable exports during processing
  btnExportExcel.disabled = true;
  btnExportCsv.disabled = true;
  
  lucide.createIcons();

  // Reset table rows status in DOM
  const tableRowsCount = Math.min(appState.rows.length, 1000);
  for (let i = 1; i <= tableRowsCount; i++) {
    const statusTd = document.getElementById(`row-status-${i}`);
    const valTd = document.getElementById(`row-val-${i}`);
    const resTd = document.getElementById(`row-response-${i}`);
    if (statusTd) statusTd.innerHTML = `<span class="badge badge-pending">Pending</span>`;
    if (valTd) valTd.innerHTML = `<span class="badge badge-pending">Pending</span>`;
    if (resTd) resTd.textContent = 'Pending';
  }

  logToTerminal('Initializing bulk request execution job...', 'system');

  try {
    const response = await fetch('/api/run-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: appState.rows,
        curlTemplate,
        condition,
        concurrency,
        delay
      })
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || 'Failed to start execution job.');
    }

    // Read SSE Stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep last chunk in buffer

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.substring(7).trim();
        } else if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.substring(6).trim());
            handleSseEvent(currentEvent, data);
          } catch (e) {
            console.error('Error parsing SSE data:', e, line);
          }
        }
      }
    }
  } catch (err) {
    logToTerminal(`Fatal Job Error: ${err.message}`, 'res-fail-log');
    alert(err.message);
    appState.isProcessing = false;
    btnRunValidation.disabled = false;
    btnRunValidation.innerHTML = `<i data-lucide="play"></i> Run Validation Job`;
    lucide.createIcons();
  }
});

// SSE Event Dispatcher
function handleSseEvent(event, data) {
  if (event === 'status') {
    logToTerminal(`[Row ${data.rowIndex}] ${data.message}`, 'system');
    const statusTd = document.getElementById(`row-status-${data.rowIndex}`);
    if (statusTd) {
      statusTd.innerHTML = `<span class="badge badge-processing">Running</span>`;
    }
  } 
  
  else if (event === 'row_result') {
    const statusTd = document.getElementById(`row-status-${data.rowIndex}`);
    const valTd = document.getElementById(`row-val-${data.rowIndex}`);

    // Store response details locally for modal inspect view
    appState.responses[data.rowIndex] = {
      url: data.url || 'N/A',
      status: data.httpStatus,
      success: data.success,
      error: data.error || null,
      response: data.response || 'Empty response'
    };

    const resTd = document.getElementById(`row-response-${data.rowIndex}`);
    const rawText = typeof data.response === 'object' ? JSON.stringify(data.response) : String(data.response);
    const shortText = rawText.substring(0, 100) + (rawText.length > 100 ? '...' : '');

    if (data.success) {
      const validationText = data.validationResult ? 'TRUE' : 'FALSE';
      const validationClass = data.validationResult ? 'badge-success' : 'badge-fail';
      
      if (statusTd) {
        statusTd.innerHTML = `<span class="badge badge-success">${data.httpStatus}</span>`;
      }
      if (valTd) {
        valTd.innerHTML = `<span class="badge ${validationClass}">${validationText}</span>`;
      }
      if (resTd) {
        resTd.textContent = shortText;
        resTd.title = rawText;
      }

      if (data.validationResult) {
        appState.stats.success++;
        statSuccess.textContent = appState.stats.success;
      } else {
        appState.stats.failure++;
        statFailure.textContent = appState.stats.failure;
      }

      logToTerminal(
        `[Row ${data.rowIndex}] Response Status: ${data.httpStatus} (${data.duration}ms) -> Validation: ${validationText}`,
        data.validationResult ? 'res-success-log' : 'res-fail-log'
      );
    } else {
      if (statusTd) {
        statusTd.innerHTML = `<span class="badge badge-fail">Error</span>`;
      }
      if (valTd) {
        valTd.innerHTML = `<span class="badge badge-fail">FALSE</span>`;
      }
      if (resTd) {
        resTd.textContent = `Error: ${data.error}`;
      }
      appState.stats.failure++;
      statFailure.textContent = appState.stats.failure;

      logToTerminal(`[Row ${data.rowIndex}] Request failed: ${data.error}`, 'res-fail-log');
    }

    // Refresh UI filter and counts dynamically
    updateTabCounts();
    applyFilter(appState.currentFilter);
  } 
  
  else if (event === 'progress') {
    appState.stats.processed = data.completed;
    statProcessed.textContent = data.completed;
    
    progressStatusText.textContent = `Processing rows (${data.completed}/${data.total})...`;
    progressBarFill.style.width = `${data.percent}%`;
    progressPercentText.textContent = `${data.percent}%`;
  } 
  
  else if (event === 'complete') {
    appState.currentJobId = data.jobId;
    appState.isProcessing = false;
    
    progressStatusText.textContent = 'Execution Completed!';
    progressBarFill.style.width = '100%';
    progressPercentText.textContent = '100%';

    logToTerminal(`Job completed successfully! All rows processed. Job ID: ${data.jobId}`, 'res-success-log');
    
    btnRunValidation.disabled = false;
    btnRunValidation.innerHTML = `<i data-lucide="play"></i> Run Validation Job`;
    
    // Enable Export Buttons
    btnExportExcel.disabled = false;
    btnExportCsv.disabled = false;
    
    lucide.createIcons();
  }
}

// 4. Export Results (Excel/CSV)
async function triggerExport(format) {
  if (!appState.currentJobId) {
    alert('No active job results found.');
    return;
  }

  logToTerminal(`Generating export in ${format.toUpperCase()} format...`, 'system');

  try {
    const response = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: appState.currentJobId, format })
    });

    if (!response.ok) {
      throw new Error('Export failed on the server.');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `validated_results_${Date.now()}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    logToTerminal(`Export download initiated.`, 'res-success-log');
  } catch (err) {
    logToTerminal(`Export Error: ${err.message}`, 'res-fail-log');
    alert(err.message);
  }
}

btnExportExcel.addEventListener('click', () => triggerExport('xlsx'));
btnExportCsv.addEventListener('click', () => triggerExport('csv'));

// --- Modal Inspection Logic ---
const detailsModal = document.getElementById('details-modal');
const modalOverlay = document.getElementById('modal-overlay');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCopyResponse = document.getElementById('btn-copy-response');

const modalRowNum = document.getElementById('modal-row-num');
const modalReqUrl = document.getElementById('modal-req-url');
const modalResBody = document.getElementById('modal-res-body');

function showRowDetails(rowIndex) {
  modalRowNum.textContent = rowIndex;
  
  const details = appState.responses[rowIndex];
  if (!details) {
    modalReqUrl.textContent = 'N/A';
    modalResBody.textContent = 'No response captured yet. Run the validation job first.';
  } else {
    modalReqUrl.textContent = details.url;
    if (details.success) {
      if (typeof details.response === 'object') {
        modalResBody.textContent = JSON.stringify(details.response, null, 2);
      } else {
        try {
          // Attempt to parse string as JSON for formatting
          const parsed = JSON.parse(details.response);
          modalResBody.textContent = JSON.stringify(parsed, null, 2);
        } catch (e) {
          modalResBody.textContent = String(details.response);
        }
      }
    } else {
      modalResBody.textContent = `Error: ${details.error}\nNo HTTP response body returned.`;
    }
  }
  
  detailsModal.classList.remove('hidden');
}

function closeModal() {
  detailsModal.classList.add('hidden');
}

btnCloseModal.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', closeModal);

// Close on escape key
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// Clipboard copy response body
btnCopyResponse.addEventListener('click', async () => {
  const content = modalResBody.textContent;
  try {
    await navigator.clipboard.writeText(content);
    const origText = btnCopyResponse.innerHTML;
    btnCopyResponse.innerHTML = `<i data-lucide="check"></i> Copied!`;
    lucide.createIcons();
    setTimeout(() => {
      btnCopyResponse.innerHTML = origText;
      lucide.createIcons();
    }, 2000);
  } catch (err) {
    console.error('Failed to copy text: ', err);
  }
});

// --- Filter & Count Logic for 1000+ Records ---
function updateTabCounts() {
  const pendingCount = appState.totalRows - (appState.stats.success + appState.stats.failure);
  document.getElementById('tab-count-all').textContent = appState.totalRows;
  document.getElementById('tab-count-true').textContent = appState.stats.success;
  document.getElementById('tab-count-false').textContent = appState.stats.failure;
  document.getElementById('tab-count-pending').textContent = pendingCount;
}

function applyFilter(filterType) {
  appState.currentFilter = filterType;
  const rows = previewTable.querySelectorAll('tbody tr');
  rows.forEach(tr => {
    // Skip warnings/placeholders
    if (!tr.id || !tr.id.startsWith('row-tr-')) return;
    
    const index = tr.id.replace('row-tr-', '');
    const valTd = document.getElementById(`row-val-${index}`);
    const valText = valTd ? valTd.textContent.trim() : 'Pending';
    
    let isVisible = false;
    if (filterType === 'all') {
      isVisible = true;
    } else if (filterType === 'true') {
      isVisible = (valText === 'TRUE');
    } else if (filterType === 'false') {
      isVisible = (valText === 'FALSE');
    } else if (filterType === 'pending') {
      isVisible = (valText === 'Pending');
    }
    
    if (isVisible) {
      tr.classList.remove('hidden-row');
    } else {
      tr.classList.add('hidden-row');
    }
  });
}

// Bind tabs click events
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    // Support clicking directly on target button or child span
    const targetBtn = e.target.closest('.tab-btn');
    targetBtn.classList.add('active');
    
    const filter = targetBtn.getAttribute('data-filter');
    applyFilter(filter);
  });
});
