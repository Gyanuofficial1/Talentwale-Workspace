const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const stringArgv = require('string-argv').default || require('string-argv');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Job storage (in-memory cache for demo/local use)
const jobs = new Map();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper: Parse Google Sheets URL
function getGoogleSheetCsvUrl(url) {
  try {
    // Standard URL format: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit#gid=GID
    // Or publishing format: https://docs.google.com/spreadsheets/d/e/2PACX-.../pubhtml
    const spreadsheetIdMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!spreadsheetIdMatch) return null;
    const spreadsheetId = spreadsheetIdMatch[1];
    
    let gid = '0';
    const gidMatch = url.match(/[#&?]gid=([0-9]+)/);
    if (gidMatch) {
      gid = gidMatch[1];
    }
    
    // Check if it is a published sheet vs standard edit link
    if (url.includes('/pubhtml') || url.includes('/pub')) {
      // If published, we can try to fetch it directly as csv
      return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/pub?output=csv&gid=${gid}`;
    }
    
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
  } catch (err) {
    console.error('Error parsing sheet URL:', err);
    return null;
  }
}

// Helper: Parse Curl command
function parseCurl(curlString) {
  // Replace backslashes indicating multi-line command
  const cleanCmd = curlString.replace(/\\\n/g, ' ').replace(/\r?\n/g, ' ').trim();
  const args = stringArgv(cleanCmd);
  
  let method = 'GET';
  let url = '';
  let headers = {};
  let bodyData = [];
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'curl') continue;
    
    if (arg === '-X' || arg === '--request') {
      method = args[++i].toUpperCase();
    } else if (arg === '--url') {
      url = args[++i];
    } else if (arg === '-H' || arg === '--header') {
      const headerVal = args[++i];
      const colonIdx = headerVal.indexOf(':');
      if (colonIdx > -1) {
        const key = headerVal.substring(0, colonIdx).trim().toLowerCase();
        const val = headerVal.substring(colonIdx + 1).trim();
        headers[key] = val;
      }
    } else if (arg === '-b' || arg === '--cookie') {
      headers['cookie'] = args[++i];
    } else if (arg === '-d' || arg === '--data' || arg === '--data-raw' || arg === '--data-binary' || arg === '--data-urlencode') {
      bodyData.push(args[++i]);
      if (method === 'GET') method = 'POST'; // Default curl method to POST if data specified
    } else if (arg.startsWith('http://') || arg.startsWith('https://')) {
      url = arg;
    } else if (!url && !arg.startsWith('-') && (arg.includes('.') || arg.includes(':'))) {
      // Positional argument that looks like a URL/domain
      url = arg;
    }
  }
  
  // Join multiple data flags with & (standard curl body aggregation)
  let body = bodyData.length > 0 ? bodyData.join('&') : null;
  
  return { method, url, headers, body };
}

// Helper: Replace placeholders {{Column}} in templates
function replacePlaceholders(templateStr, row) {
  if (!templateStr) return templateStr;
  return templateStr.replace(/\{\{([^}]+)\}\}/g, (match, p1) => {
    const colName = p1.trim();
    // Case-insensitive check
    if (row[colName] !== undefined) return row[colName];
    const lowerCol = colName.toLowerCase();
    for (const key of Object.keys(row)) {
      if (key.toLowerCase() === lowerCol) {
        return row[key];
      }
    }
    return ''; // Default if not found
  });
}

// Helper: Evaluate Condition
function evaluateCondition(condition, status, body) {
  try {
    if (condition.type === 'status') {
      const targetStatus = parseInt(condition.value, 10);
      return status === targetStatus;
    }
    if (condition.type === 'status_2xx') {
      return status >= 200 && status < 300;
    }
    if (condition.type === 'contains') {
      const searchStr = String(condition.value).toLowerCase();
      const bodyStr = (typeof body === 'object' ? JSON.stringify(body) : String(body)).toLowerCase();
      return bodyStr.includes(searchStr);
    }
    if (condition.type === 'json') {
      const json = typeof body === 'object' ? body : JSON.parse(body);
      const parts = condition.path.split('.');
      let val = json;
      for (const part of parts) {
        val = val && val[part];
      }
      return String(val).toLowerCase() === String(condition.value).toLowerCase();
    }
    if (condition.type === 'js') {
      let parsedJson = {};
      try { parsedJson = typeof body === 'object' ? body : JSON.parse(body); } catch(e){}
      const fn = new Function('status', 'body', 'json', `return (${condition.value});`);
      return !!fn(status, body, parsedJson);
    }
  } catch (err) {
    console.error('Condition evaluation error:', err);
    return false;
  }
  return false;
}

// Endpoint: Fetch and parse Google Sheet
app.post('/api/fetch-sheet', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Google Sheet URL is required.' });
  }

  // Intercept test-sheet URL for local testing/verification
  if (url === 'test-sheet' || url.includes('test-sheet')) {
    const csvData = `Name,Email,Status\nGyanu,gyanu@example.com,Active\nAmit,amit@example.com,Pending\nRahul,rahul@example.com,Active`;
    const records = parse(csvData, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    const headers = Object.keys(records[0]);
    return res.json({ headers, preview: records.slice(0, 10), totalRows: records.length, rows: records });
  }

  const csvUrl = getGoogleSheetCsvUrl(url);
  if (!csvUrl) {
    return res.status(400).json({ error: 'Invalid Google Sheet URL format.' });
  }

  try {
    const response = await axios.get(csvUrl, { responseType: 'text' });
    const records = parse(response.data, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    if (records.length === 0) {
      return res.status(400).json({ error: 'No data found in the sheet.' });
    }

    const headers = Object.keys(records[0]);
    res.json({ headers, preview: records.slice(0, 10), totalRows: records.length, rows: records });
  } catch (err) {
    console.error('Error fetching sheet:', err.message);
    res.status(500).json({ error: 'Failed to fetch Google Sheet. Please check if the URL is public and shared.' });
  }
});

// Endpoint: Run requests (Server-Sent Events)
app.post('/api/run-requests', (req, res) => {
  const { rows, curlTemplate, condition, concurrency = 5, delay = 500 } = req.body;

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No rows to process.' });
  }
  if (!curlTemplate) {
    return res.status(400).json({ error: 'Curl command template is required.' });
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const parsedCurl = parseCurl(curlTemplate);
  const jobId = `job_${Date.now()}`;
  const modifiedRows = [];

  let nextIndex = 0;
  let activeRequests = 0;
  let completed = 0;

  async function processRow(index) {
    if (index >= rows.length) return;
    
    activeRequests++;
    const row = { ...rows[index] };
    const rowIndex = index + 1; // 1-based index for UI

    let resultStatus = 0;
    let resultBody = '';
    let validationResult = false;
    let errorMsg = null;
    let finalUrl = '';

    try {
      // Replace templates in URL, headers, and body
      finalUrl = replacePlaceholders(parsedCurl.url, row);
      
      const finalHeaders = {};
      for (const [key, value] of Object.entries(parsedCurl.headers || {})) {
        finalHeaders[key] = replacePlaceholders(value, row);
      }
      
      let finalBody = null;
      if (parsedCurl.body) {
        finalBody = replacePlaceholders(parsedCurl.body, row);
      }

      try {
        sendEvent('status', {
          rowIndex,
          status: 'Processing',
          message: `Sending request to: ${finalUrl}`
        });
      } catch (e) {
        console.error('SSE status write warning:', e.message);
      }

      // Configure Axios request
      const config = {
        method: parsedCurl.method,
        url: finalUrl,
        headers: finalHeaders,
        timeout: 15000,
        validateStatus: () => true // Allow any status code so we evaluate it
      };

      if (finalBody) {
        if (typeof finalBody === 'string' && finalBody.trim().startsWith('{')) {
          try {
            config.data = JSON.parse(finalBody);
            // Ensure Content-Type is application/json if body is JSON
            if (!config.headers['content-type']) {
              config.headers['content-type'] = 'application/json';
            }
          } catch (e) {
            config.data = finalBody; // fallback to string
          }
        } else {
          config.data = finalBody;
        }
      }

      const startTime = Date.now();
      const response = await axios(config);
      const duration = Date.now() - startTime;

      resultStatus = response.status;
      resultBody = response.data;
      validationResult = evaluateCondition(condition, resultStatus, resultBody);

      try {
        sendEvent('row_result', {
          rowIndex,
          success: true,
          httpStatus: resultStatus,
          duration,
          validationResult,
          url: finalUrl,
          response: resultBody
        });
      } catch (e) {
        console.error('SSE row_result write warning:', e.message);
      }
    } catch (err) {
      errorMsg = err.message;
      try {
        sendEvent('row_result', {
          rowIndex,
          success: false,
          httpStatus: 0,
          validationResult: false,
          url: finalUrl,
          error: errorMsg
        });
      } catch (e) {
        console.error('SSE row_result error write warning:', e.message);
      }
    } finally {
      // Add validation results to the row
      row['Validation_Status_Code'] = resultStatus;
      row['Validation_Result'] = validationResult ? 'TRUE' : 'FALSE';
      row['Response_Body'] = typeof resultBody === 'object' ? JSON.stringify(resultBody) : String(resultBody);
      row['Validation_Error'] = errorMsg || '';
      
      modifiedRows[index] = row;
      completed++;
      activeRequests--;

      // Stream overall progress
      try {
        sendEvent('progress', {
          completed,
          total: rows.length,
          percent: Math.round((completed / rows.length) * 100)
        });
      } catch (e) {
        console.error('SSE progress write warning:', e.message);
      }

      // Handle next rows in queue
      if (nextIndex < rows.length) {
        // Delay before next request if specified
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        processRow(nextIndex++);
      } else if (activeRequests === 0 && completed === rows.length) {
        // Job fully finished
        jobs.set(jobId, modifiedRows);
        try {
          sendEvent('complete', { jobId });
        } catch (e) {
          console.error('SSE complete write warning:', e.message);
        }
        res.end();
      }
    }
  }

  // Start initial batch up to concurrency limit
  const initialBatchCount = Math.min(concurrency, rows.length);
  for (let i = 0; i < initialBatchCount; i++) {
    nextIndex++;
    processRow(i);
  }
});

// Endpoint: Export updated rows to Excel
app.post('/api/export', (req, res) => {
  const { jobId, format = 'xlsx' } = req.body;
  
  if (!jobId || !jobs.has(jobId)) {
    return res.status(404).json({ error: 'Job results not found or expired.' });
  }

  const data = jobs.get(jobId);

  try {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Validation Results');
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: format });
    
    const filename = `validated_results_${Date.now()}.${format}`;
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Failed to generate export file.' });
  }
});

// Serve frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
