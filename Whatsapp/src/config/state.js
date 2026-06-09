/**
 * Global State
 * Centralized mutable state exported to global scope to allow seamless MVC refactoring
 * without breaking existing monolithic function references.
 */

function initStateGlobals() {
  global.conversations = new Map();
  global.outboundIndex = new Map();
  global.webhookEventLog = [];
  global.reportSummaryCache = {
    value: { sent: 0, delivered: 0, failed: 0 },
    expiresAt: 0,
  };
  global.smtpRuntimeProfiles = new Map();
  global.emailQueueSmtpContexts = new Map();
  global.runtimeSmtpDefaultProvider = "";
  global.emailQueueRuntime = {
    enabled: false,
    queueClient: null,
    queueName: "",
  };
  global.emailDomainCheckCache = new Map();
  global.emailSmtpProbeCache = new Map();
  global.unsubscribedEmailRecipients = new Set();
  global.suppressedEmailRecipients = new Set();
  global.campaignQueueProcessing = false;
  global.emailTaskProcessingActive = false;
  global.unsubscribeSecretWarningLogged = false;
  global.emailTrackingSecretWarningLogged = false;
  
  global.smtpTestState = {
    inProgress: false,
    lastMessage: "Idle",
    lastTestRecipient: "",
    lastTestAt: ""
  };

  global.updateSmtpTestState = function (patch = {}) {
    global.smtpTestState = {
      ...global.smtpTestState,
      ...patch,
      lastUpdatedAt: new Date().toISOString(),
    };
  };
  
  // Forward declare some functions that are passed around or have circular dependencies
  global.saveMessageToDb = null;
  global.updateMessageStatusInDb = null;
  global.broadcastInboxEvent = null;
  global.logEmailEngagementEvent = null;
}

module.exports = { initStateGlobals };
