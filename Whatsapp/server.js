/**
 * TalentWale Backend Entry Point (Refactored MVC)
 */

require("dotenv").config();
const http = require("http");

// 1. Initialize Global State (Mutable shared state like Maps and Sets)
require("./src/config/state").initStateGlobals();

// Helper to bind module exports to global namespace for seamless circular dependency resolution
function loadToGlobal(mod) {
  Object.assign(global, mod);
}

// 2. Load Config & Utilities
loadToGlobal(require("./src/config/constants"));
loadToGlobal(require("./src/utils/helpers"));
loadToGlobal(require("./src/utils/crypto"));

const requestHelpers = require("./src/middleware/requestHelpers");
loadToGlobal(requestHelpers);

const staticServer = require("./src/utils/staticServer");
loadToGlobal(staticServer);
loadToGlobal(require("./send-whatsapp"));

const database = require("./src/config/database");
loadToGlobal(database);

// 3. Load Models
loadToGlobal(require("./src/models/messageModel"));
loadToGlobal(require("./src/models/campaignModel"));
loadToGlobal(require("./src/models/smtpModel"));
loadToGlobal(require("./src/models/emailModel"));
loadToGlobal(require("./src/models/conversationModel"));

// 4. Load Services
loadToGlobal(require("./src/services/smtpService"));
loadToGlobal(require("./src/services/emailVerifyService"));
loadToGlobal(require("./src/services/campaignService"));
loadToGlobal(require("./src/services/sqsQueueService"));
loadToGlobal(require("./src/services/contactService"));
loadToGlobal(require("./src/services/emailTrackingService"));

// 5. Load API Router
const { handleApi } = require("./src/routes/apiRouter");

// 6. Server Initialization
const { PORT } = require("./src/config/constants");

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key"
    });
    res.end();
    return;
  }

  const routePath = String(req.url || "").split("?")[0];
  
  if (routePath.startsWith("/uploads/")) {
    if (staticServer.serveUpload(req, res)) return;
  }
  
  if (routePath.startsWith("/api/") || routePath.startsWith("/unsubscribe")) {
    try {
      await handleApi(req, res);
    } catch (error) {
      console.error("API error:", error);
      const status = error.statusCode || 500;
      requestHelpers.sendJson(res, status, { error: error.message || "Internal server error" });
    }
    return;
  }

  staticServer.serveStatic(req, res);
});

// 7. Lambda Integration
async function lambdaInit() {
  await database.initDatabase();
  await global.loadActiveSmtpCredentialsFromDb();
  await global.initSqsEmailQueue();
  await global.loadEmailUnsubscribesFromDb();
  await global.loadEmailSuppressionsFromDb();
  await global.resetProcessingRecipientsOnStartup();
  
  if (global.emailQueueRuntime && global.emailQueueRuntime.enabled) {
    // startAzureEmailQueueConsumer is removed since we use Lambda SQS Triggers now
  }
}

// 8. Start Local Server if not in Lambda
if (process.env.IS_LAMBDA !== "true" && process.env.NODE_ENV !== "test") {
  server.listen(PORT, async () => {
    console.log(`TalentWale Server running on http://localhost:${PORT}`);
    try {
      await lambdaInit();
    } catch (err) {
      console.error("Initialization failed:", err.message);
      process.exit(1);
    }
  });
}

module.exports = { server, lambdaInit };
