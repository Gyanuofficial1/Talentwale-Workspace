require("dotenv").config();

const NotificationClient = require("@azure-rest/communication-messages").default;
const { isUnexpected } = require("@azure-rest/communication-messages");

const TEMPLATE_DEFINITIONS = {
  verify: {
    language: "en_GB",
    values: [
      { kind: "text", name: "customerName", text: "" },
      { kind: "text", name: "verificationTarget", text: "" },
      { kind: "quickAction", name: "verificationPath", text: "" },
    ],
    bindings: {
      kind: "whatsApp",
      header: [],
      body: [{ refValue: "customerName" }, { refValue: "verificationTarget" }],
      buttons: [{ subType: "url", refValue: "verificationPath" }],
    },
  },
  tw_test: {
    language: "en",
    values: [],
    bindings: {
      kind: "whatsApp",
      body: [],
      header: [],
      buttons: [],
    },
  },
  tw_job_sug: {
    language: "en",
    values: [
      {
        kind: "image",
        name: "headerImage",
        url: process.env.TW_JOB_SUG_HEADER_IMAGE_URL || "",
        internal: true,
      },
      { kind: "text", name: "candidateName", text: "" },
      { kind: "text", name: "jobTitle", text: "" },
      { kind: "text", name: "companyName", text: "" },
      { kind: "text", name: "jobLocation", text: "" },
      { kind: "quickAction", name: "jobId", text: "" },
    ],
    bindings: {
      kind: "whatsApp",
      header: [{ refValue: "headerImage" }],
      body: [
        { refValue: "candidateName" },
        { refValue: "jobTitle" },
        { refValue: "companyName" },
        { refValue: "jobLocation" },
      ],
      buttons: [{ subType: "url", refValue: "jobId" }],
    },
  },
};

const TEMPLATE_KEYS = Object.fromEntries(
  Object.keys(TEMPLATE_DEFINITIONS).map((templateName) => [templateName, templateName]),
);

function valueMap(templateName, valueOverrides = {}) {
  return Object.fromEntries(
    buildTemplateDefinition(templateName, valueOverrides).values.map((value) => [
      value.name,
      value.text || value.url || "",
    ]),
  );
}

function buildTemplateMessagePreview(templateName, valueOverrides = {}) {
  const values = valueMap(templateName, valueOverrides);

  if (templateName === "verify") {
    const path = String(values.verificationPath || "").replace(/^https?:\/\/talentwale\.com\/?/i, "");
    return [
      "Finalize account set-up",
      "",
      `Hi ${values.customerName},`,
      "",
      "Your new account has been created successfully.",
      "",
      `Please verify ${values.verificationTarget} to complete your profile.`,
      "",
      path ? `Verify account: https://talentwale.com/${path}` : "",
    ]
      .filter((line, index, lines) => line || lines[index - 1])
      .join("\n");
  }

  if (templateName === "tw_job_sug") {
    return [
      `Hi ${values.candidateName},`,
      "",
      `We found a job suggestion for ${values.jobTitle} at ${values.companyName}.`,
      `Location: ${values.jobLocation}`,
      "",
      values.jobId ? `Job link/code: ${values.jobId}` : "",
    ]
      .filter((line, index, lines) => line || lines[index - 1])
      .join("\n");
  }

  if (templateName === "tw_test") {
    return "Hello";
  }

  return `[template] ${templateName}`;
}

function getTemplateMediaPreview(templateName, valueOverrides = {}) {
  const template = buildTemplateDefinition(templateName, valueOverrides);
  const image = template.values.find((value) => value.kind === "image" && value.url);

  if (!image) {
    return null;
  }

  return {
    id: "",
    mimeType: "image/jpeg",
    caption: "",
    fileName: "",
    mediaUri: image.url,
  };
}

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

function buildTemplateDefinition(templateName, valueOverrides = {}) {
  const template = TEMPLATE_DEFINITIONS[templateName];

  if (!template) {
    throw new Error(
      `Unsupported template "${templateName}". Use one of: ${Object.keys(TEMPLATE_KEYS).join(", ")}.`,
    );
  }

  const values = template.values.map((value) => {
    const { internal, ...templateValue } = value;

    if (!Object.prototype.hasOwnProperty.call(valueOverrides, value.name)) {
      return templateValue;
    }

    if (value.kind === "image" || value.kind === "document" || value.kind === "video") {
      return {
        ...templateValue,
        url: String(valueOverrides[value.name] ?? ""),
      };
    }

    if (value.kind === "quickAction") {
      return {
        ...templateValue,
        text: String(valueOverrides[value.name] ?? ""),
      };
    }

    return {
      ...templateValue,
      text: String(valueOverrides[value.name] ?? ""),
    };
  });

  return {
    name: templateName,
    language: template.language,
    bindings: template.bindings,
    values,
  };
}

async function sendTemplate(templateName, recipientPhoneNumber, valueOverrides = {}) {
  const client = NotificationClient(required("COMMUNICATION_SERVICES_CONNECTION_STRING"));
  const result = await client.path("/messages/notifications:send").post({
    contentType: "application/json",
    body: {
      channelRegistrationId: required("WHATSAPP_CHANNEL_ID"),
      to: [recipientPhoneNumber],
      kind: "template",
      template: buildTemplateDefinition(templateName, valueOverrides),
    },
  });

  if (isUnexpected(result)) {
    const errorPayload = JSON.stringify(result.body || {}, null, 2);
    throw new Error(`Azure request failed.\n${errorPayload}`);
  }

  const receipts = result.body.receipts || [];
  console.log(`Template "${templateName}" sent to ${recipientPhoneNumber}`);

  if (!receipts.length) {
    console.log("No delivery receipt returned.");
    return;
  }

  receipts.forEach((receipt) => {
    console.log(`Message ID: ${receipt.messageId}`);
    console.log(`To: ${receipt.to}`);
  });

  return {
    templateName,
    recipientPhoneNumber,
    receipts,
  };
}

async function sendText(recipientPhoneNumber, content) {
  const message = String(content || "").trim();
  if (!message) {
    throw new Error("Reply content is required.");
  }

  const client = NotificationClient(required("COMMUNICATION_SERVICES_CONNECTION_STRING"));
  const result = await client.path("/messages/notifications:send").post({
    contentType: "application/json",
    body: {
      channelRegistrationId: required("WHATSAPP_CHANNEL_ID"),
      to: [recipientPhoneNumber],
      kind: "text",
      content: message,
    },
  });

  if (isUnexpected(result)) {
    const errorPayload = JSON.stringify(result.body || {}, null, 2);
    throw new Error(`Azure request failed.\n${errorPayload}`);
  }

  const receipts = result.body.receipts || [];
  console.log(`Text message sent to ${recipientPhoneNumber}`);
  return {
    recipientPhoneNumber,
    receipts,
  };
}

async function sendMedia(recipientPhoneNumber, mediaKind, mediaUri, options = {}) {
  const kind = String(mediaKind || "").trim().toLowerCase();
  const uri = String(mediaUri || "").trim();

  if (!["image", "document", "video", "audio"].includes(kind)) {
    throw new Error("Unsupported media type. Use image, document, video, or audio.");
  }

  if (!uri) {
    throw new Error("Media URL is required.");
  }

  const body = {
    channelRegistrationId: required("WHATSAPP_CHANNEL_ID"),
    to: [recipientPhoneNumber],
    kind,
    mediaUri: uri,
  };

  if (options.caption) {
    body.content = String(options.caption);
  }
  if (kind === "document" && options.fileName) {
    body.fileName = String(options.fileName);
  }

  const client = NotificationClient(required("COMMUNICATION_SERVICES_CONNECTION_STRING"));
  const result = await client.path("/messages/notifications:send").post({
    contentType: "application/json",
    body,
  });

  if (isUnexpected(result)) {
    const errorPayload = JSON.stringify(result.body || {}, null, 2);
    throw new Error(`Azure request failed.\n${errorPayload}`);
  }

  return {
    recipientPhoneNumber,
    receipts: result.body.receipts || [],
  };
}

async function downloadMediaStream(mediaId) {
  const id = String(mediaId || "").trim();
  if (!id) {
    throw new Error("Media id is required.");
  }

  const client = NotificationClient(required("COMMUNICATION_SERVICES_CONNECTION_STRING"));
  const operation = client.path("/messages/streams/{id}", id).get();
  const result = await operation.asNodeStream();

  if (isUnexpected(result)) {
    const errorPayload = JSON.stringify(result.body || {}, null, 2);
    throw new Error(`Azure media download failed.\n${errorPayload}`);
  }

  const contentType = result.headers?.["content-type"] || "application/octet-stream";
  const chunks = [];
  for await (const chunk of result.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);

  if (!buffer?.length) {
    throw new Error("Downloaded media payload is empty.");
  }

  return { buffer, contentType };
}

function printUsage() {
  console.log("Usage:");
  console.log("  npm run send -- <template-name> <recipient-phone>");
  console.log("  npm run send:verify -- <recipient-phone>");
  console.log("  npm run send:tw-test -- <recipient-phone>");
  console.log("  npm run send:job-sug -- <recipient-phone>");
  console.log("");
  console.log("Supported templates:");
  Object.keys(TEMPLATE_KEYS).forEach((templateName) => {
    console.log(`  - ${templateName}`);
  });
}

async function main() {
  const [templateArg, recipientArg] = process.argv.slice(2);

  if (!templateArg || templateArg === "--help" || templateArg === "-h") {
    printUsage();
    return;
  }

  const templateName = templateArg.trim();
  const recipientPhoneNumber = (recipientArg || process.env.RECIPIENT_PHONE_NUMBER || "").trim();

  if (!recipientPhoneNumber) {
    throw new Error(
      "Recipient phone number missing. Pass it as the second CLI argument or set RECIPIENT_PHONE_NUMBER.",
    );
  }

  await sendTemplate(templateName, recipientPhoneNumber);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Failed to send WhatsApp template message.");
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  TEMPLATE_KEYS,
  buildTemplateDefinition,
  buildTemplateMessagePreview,
  getTemplateMediaPreview,
  sendTemplate,
  sendText,
  sendMedia,
  downloadMediaStream,
};
