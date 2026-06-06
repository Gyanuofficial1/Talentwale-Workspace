/**
 * MVC Refactoring Script
 * Extracts code from server.original.js into modular files.
 */

const fs = require("fs");
const path = require("path");

const SOURCE = path.join(__dirname, "..", "server.original.js");
const SRC = path.join(__dirname, "..", "src");

const source = fs.readFileSync(SOURCE, "utf8");
const lines = source.split("\n");

function findFunction(name) {
  const patterns = [
    new RegExp(`^(async\\s+)?function\\s+${name}\\b`),
    new RegExp(`^(const|let|var)\\s+${name}\\s*=\\s*(async\\s+)?(?:\\([^)]*\\)|[a-zA-Z0-9_]+)\\s*=>`),
    new RegExp(`^(const|let|var)\\s+${name}\\s*=\\s*(async\\s+)?function`),
  ];
  
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (patterns.some(p => p.test(trimmed))) {
      startLine = i;
      break;
    }
  }
  
  if (startLine === -1) {
    return null;
  }
  
  let braceCount = 0;
  let endLine = startLine;
  let started = false;
  
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === "{") {
        braceCount++;
        started = true;
      }
      if (ch === "}") {
        braceCount--;
      }
    }
    if (started && braceCount === 0) {
      endLine = i;
      break;
    }
  }
  
  return {
    code: lines.slice(startLine, endLine + 1).join("\n"),
  };
}

function generateFile(groupName, functionNames, folder, filename, importsText = "") {
  const codes = [];
  const exportsList = [];
  
  for (const name of functionNames) {
    const fn = findFunction(name);
    if (fn) {
      codes.push(fn.code);
      exportsList.push(name);
    } else {
      console.log(`Warning: ${name} not found for ${filename}`);
    }
  }
  
  const content = `/**
 * ${groupName}
 */
${importsText}

${codes.join("\n\n")}

module.exports = {
  ${exportsList.join(",\n  ")}
};
`;

  const outDir = path.join(SRC, folder);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(path.join(outDir, filename), content);
  console.log(`Generated ${folder}/${filename}`);
  return exportsList;
}

const CONSTANTS_IMPORTS = `
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
const { QueueServiceClient } = require("@azure/storage-queue");
const nodemailer = require("nodemailer");
const fetch = require("node-fetch");
const net = require("net");
const dns = require("dns").promises;
const crypto = require("crypto");
`;

generateFile("Message Model", [
  "saveMessageToDb", 
  "loadMessagesFromDb",
  "updateMessageStatusInDb"
], "models", "messageModel.js", CONSTANTS_IMPORTS);

generateFile("Campaign Model", [
  "buildCampaignId", "sanitizeRowObject", "buildValueOverridesFromMapping", 
  "buildCampaignSummary", "getCampaignById", "getLatestCampaign", 
  "getLiveCampaignSummary", "broadcastCampaignSummaryEvent", "createEmailCampaignRecord", 
  "enqueueEmailCampaignTasks", "createCampaignWithRecipients", "claimNextCampaign", 
  "claimNextRecipient", "completeRecipient", "finalizeCampaign", "requestCampaignStop", 
  "shouldStopCampaign"
], "models", "campaignModel.js", CONSTANTS_IMPORTS);

generateFile("SMTP Model", [
  "loadActiveSmtpCredentialsFromDb", "listSmtpCredentialProfiles", "getSmtpCredentialProfileRowById", 
  "createSmtpCredentialProfile", "updateSmtpCredentialProfile", "deleteSmtpCredentialProfile", 
  "activateSmtpCredentialProfile", "normalizeSmtpProvider", "getActiveSmtpProviderOptions",
  "getPrimarySmtpProvider", "setPrimarySmtpProvider", "getSmtpCredentialCipherKey",
  "encryptSmtpCredentialSecret", "decryptSmtpCredentialSecret", "normalizeSmtpFromOptionsRaw",
  "normalizeSmtpFromName", "toSmtpCredentialPublic", "buildRuntimeSmtpProfileFromCredentialRow",
  "setRuntimeSmtpProfile"
], "models", "smtpModel.js", CONSTANTS_IMPORTS);

generateFile("Email Model", [
  "loadEmailUnsubscribesFromDb", "loadEmailSuppressionsFromDb", "upsertEmailSuppression", 
  "logEmailRejection", "getEmailRejectionList", "isEmailUnsubscribed", "markRecipientUnsubscribed", 
  "logEmailEngagementEvent", "getEmailAnalyticsPayload"
], "models", "emailModel.js", CONSTANTS_IMPORTS);

generateFile("Conversation Model", [
  "getOrCreateConversation", "pushMessage", "ingestInboundEvent", "ingestDeliveryStatusEvent", 
  "markConversationRead", "buildReportSummary", "getReportSummaryCounts", "getReportRows", 
  "getReportPayload", "getDashboardSummaryPayload", "getInboxSummary", "getInboxCountSummary", 
  "getConversationPayload", "conversationMatchesQuery", "getConversationPayloadById", 
  "getInboxSummaryFromDb", "pushWebhookLog"
], "models", "conversationModel.js", CONSTANTS_IMPORTS);

generateFile("SMTP Service", [
  "getSmtpProviderOptions", "resolveSmtpProvider", "getSmtpConfig", "getSmtpFromOptions", 
  "resolveSmtpFromAddress", "resolveSmtpReplyToAddress", "buildSmtpFromHeader", 
  "normalizeEmailBodyFormat", "buildEmailBodiesFromTemplate", "createSmtpTransporter"
], "services", "smtpService.js", CONSTANTS_IMPORTS);

generateFile("Email Verify Service", [
  "isEmailMxValidationEnabled", "isEmailSmtpProbeEnabled", "isDisposableDomain", "isLikelyHardBounceError", 
  "rememberSuppressedRecipient", "canRetrySoftQueueFailure", 
  "resolveDomainRecordHealth", "getEmailVerifyProbeFromAddress", "classifySmtpRcptResponse", 
  "createSmtpLineReader", "runSmtpRecipientProbe", "probeRecipientWithMx", "preflightEmailDeliverability"
], "services", "emailVerifyService.js", CONSTANTS_IMPORTS);

generateFile("Campaign Service", [
  "processWhatsappRecipient", "processEmailRecipient", "runCampaign", "processCampaignQueue", 
  "resetProcessingRecipientsOnStartup"
], "services", "campaignService.js", CONSTANTS_IMPORTS);

generateFile("Azure Queue Service", [
  "getAzureEmailQueueConfig", "initAzureEmailQueue", "getEmailQueueSmtpContext", 
  "applyEmailQueueThrottle", "enqueueEmailTaskMessage", "processQueuedEmailTask", 
  "drainAzureEmailQueueOnce", "startAzureEmailQueueConsumer"
], "services", "azureQueueService.js", CONSTANTS_IMPORTS);

generateFile("Contact Service", [
  "workbookToContacts", "googleSheetCsvUrl"
], "services", "contactService.js", CONSTANTS_IMPORTS);

generateFile("Email Tracking Service", [
  "decodeHtmlAttributeValue", "escapeHtmlAttributeValue", "normalizeTrackableTargetUrl", 
  "buildEmailOpenTrackingUrl", "buildEmailClickTrackingUrl", "shouldTrackEmailHref", 
  "rewriteHtmlLinksWithTracking", "appendOpenPixelToHtml", "applyEmailEngagementTracking", 
  "getAppBaseUrl", "buildUnsubscribeUrl", "buildEmailTemplateContext", "buildListUnsubscribeHeaders"
], "services", "emailTrackingService.js", CONSTANTS_IMPORTS);

// Extract router
const handleApiCode = findFunction("handleApi");
if (handleApiCode) {
  fs.writeFileSync(path.join(SRC, "routes", "apiRouter.js"), "/**\n * API Router\n */\n" + CONSTANTS_IMPORTS + "\n\n" + handleApiCode.code + "\n\nmodule.exports = { handleApi };\n");
  console.log("Generated routes/apiRouter.js");
}

console.log("Refactoring extraction completed successfully!");
