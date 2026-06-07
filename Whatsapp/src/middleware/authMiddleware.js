const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/constants");
const { sendJson } = require("./requestHelpers");

function requireAuth(req, res, next) {
  // Public routes skip auth check
  const routePath = String(req.url || "").split("?")[0];
  const publicRoutes = [
    "/api/login",
    "/api/email/track/open",
    "/api/email/track/click",
    "/unsubscribe"
  ];
  
  if (publicRoutes.includes(routePath)) {
    return next ? next() : true;
  }

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return next ? next() : true;
  }

  const authHeader = req.headers["authorization"] || "";
  let token = "";

  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  }

  if (!token) {
    sendJson(res, 401, { error: "Authentication required. No token provided." });
    return false;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    if (next) return next();
    return true;
  } catch (err) {
    sendJson(res, 401, { error: "Invalid or expired token." });
    return false;
  }
}

module.exports = {
  requireAuth
};
