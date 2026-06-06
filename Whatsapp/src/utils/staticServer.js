/**
 * Static File Server & Upload Server
 * Serves static files from public/ and uploaded files from uploads/.
 */

const fs = require("fs");
const path = require("path");
const { PUBLIC_DIR, UPLOAD_DIR, CONTENT_TYPES } = require("../config/constants");
const { getExt, getMimeTypeFromExt, ensureUploadDir } = require("./helpers");

function serveUpload(req, res) {
  ensureUploadDir();
  const requestPath = decodeURIComponent(req.url.split("?")[0]);
  const relative = requestPath.replace(/^\/uploads\//, "");
  const safeName = path.basename(relative);
  const filePath = path.join(UPLOAD_DIR, safeName);

  if (!filePath.startsWith(UPLOAD_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return true;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = getMimeTypeFromExt(ext);
  const stat = fs.statSync(filePath);

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": stat.size,
    "Cache-Control": "public, max-age=3600",
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function serveStatic(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : decodeURIComponent(req.url.split("?")[0]);
  const safePath = path.normalize(requestPath).replace(/^(\.\.[\\/])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function writeHtml(res, statusCode, htmlBody) {
  const content = Buffer.from(String(htmlBody || ""), "utf8");
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": content.length,
    "Cache-Control": "no-store",
  });
  res.end(content);
}

module.exports = {
  serveUpload,
  serveStatic,
  writeHtml,
};
