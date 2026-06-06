/**
 * AWS Lambda Entry Point — TalentWale Backend
 *
 * Yeh file root server.js ko Lambda-compatible banata hai.
 * serverless-http library HTTP requests ko Lambda events mein convert karta hai.
 *
 * Handler: lambda.handler
 * Runtime: Node.js 18.x
 */

"use strict";

const serverlessHttp = require("serverless-http");

// Lambda mein yeh flag set hoga — server.js isko dekh ke auto-listen nahi karega
process.env.IS_LAMBDA = "true";

// Root server.js load karo (lambda.js -> ../server.js)
const { server, lambdaInit } = require("../server");

// serverless-http HTTP server ko Lambda event handler mein wrap karta hai
const serverlessApp = serverlessHttp(server, {
  // Binary file types jo base64 encode honge (multipart uploads ke liye)
  binary: [
    "image/*",
    "application/octet-stream",
    "application/pdf",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
});

// Lambda cold start optimization — DB connection persist hoga warm invocations mein
let initialized = false;
let initPromise = null;

async function ensureInitialized() {
  if (initialized) return;
  if (initPromise) return initPromise;
  initPromise = lambdaInit()
    .then(() => {
      initialized = true;
      console.log("[Lambda] Initialization complete.");
    })
    .catch((err) => {
      initPromise = null; // Retry on next invocation if init fails
      throw err;
    });
  return initPromise;
}

/**
 * AWS Lambda Handler
 * API Gateway events yahan aate hain
 */
exports.handler = async (event, context) => {
  // Lambda ko event loop ke liye wait nahi karna — DB connections ke liye important
  context.callbackWaitsForEmptyEventLoop = false;

  // First invocation (cold start) mein DB init karo
  await ensureInitialized();

  // API Gateway event → HTTP request → server.js handle → response
  return serverlessApp(event, context);
};
