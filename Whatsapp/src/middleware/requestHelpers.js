/**
 * Middleware / Request Helpers
 * HTTP request/response utility functions.
 */

const inboxStreamClients = new Set();

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function broadcastInboxEvent(event) {
  const body = `data: ${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n\n`;
  for (const res of inboxStreamClients) {
    try {
      res.write(body);
    } catch {
      inboxStreamClients.delete(res);
    }
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLength = 0;

    req.on("data", (chunk) => {
      chunks.push(chunk);
      totalLength += chunk.length;
      if (totalLength > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });

    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function readRequestBuffer(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLength = 0;

    req.on("data", (chunk) => {
      chunks.push(chunk);
      totalLength += chunk.length;
      if (totalLength > maxBytes) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function getRequestIpAddress(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").trim();
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return String(req.socket?.remoteAddress || "").trim();
}

module.exports = {
  inboxStreamClients,
  sendJson,
  broadcastInboxEvent,
  readRequestBody,
  readRequestBuffer,
  getRequestIpAddress,
};
