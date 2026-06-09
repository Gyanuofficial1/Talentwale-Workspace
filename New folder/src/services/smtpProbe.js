const dns = require("node:dns/promises");
const net = require("node:net");

async function resolveMx(domain) {
  try {
    const records = await dns.resolveMx(domain);
    return records.sort((a, b) => a.priority - b.priority);
  } catch {
    return [];
  }
}

function readSmtpLine(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let timer = null;

    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };

    const onError = (err) => {
      cleanup();
      reject(err);
    };

    const onClose = () => {
      cleanup();
      reject(new Error("SMTP socket closed unexpectedly"));
    };

    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const nl = buffer.indexOf("\n");
      if (nl === -1) {
        return;
      }
      const line = buffer.slice(0, nl).trim();
      cleanup();
      resolve(line);
    };

    timer = setTimeout(() => {
      cleanup();
      reject(new Error("SMTP read timeout"));
    }, timeoutMs);

    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

function getCode(line) {
  const match = String(line).match(/^(\d{3})/);
  return match ? Number(match[1]) : null;
}

async function smtpCommand(socket, command, timeoutMs) {
  socket.write(`${command}\r\n`);
  return readSmtpLine(socket, timeoutMs);
}

async function probeGmailRcpt(email, timeoutMs) {
  const socket = net.createConnection({
    host: "gmail-smtp-in.l.google.com",
    port: 25,
  });

  socket.setTimeout(timeoutMs);

  const done = () => {
    if (!socket.destroyed) {
      socket.destroy();
    }
  };

  try {
    const banner = await readSmtpLine(socket, timeoutMs);
    if (getCode(banner) !== 220) {
      return {
        status: "invalid",
        code: getCode(banner),
        response: banner,
        reason: "SMTP banner rejected",
      };
    }

    const heloLine = await smtpCommand(socket, "HELO talentwale.com", timeoutMs);
    if (getCode(heloLine) !== 250) {
      return {
        status: "invalid",
        code: getCode(heloLine),
        response: heloLine,
        reason: "HELO rejected",
      };
    }

    const mailFrom = await smtpCommand(socket, "MAIL FROM:<probe@talentwale.com>", timeoutMs);
    if (getCode(mailFrom) !== 250) {
      return {
        status: "invalid",
        code: getCode(mailFrom),
        response: mailFrom,
        reason: "MAIL FROM rejected",
      };
    }

    const rcptLine = await smtpCommand(socket, `RCPT TO:<${email}>`, timeoutMs);
    const rcptCode = getCode(rcptLine);

    await smtpCommand(socket, "QUIT", timeoutMs).catch(() => undefined);

    if (rcptCode === 250 || rcptCode === 251) {
      return {
        status: "valid",
        code: rcptCode,
        response: rcptLine,
        reason: "Gmail SMTP accepted recipient",
      };
    }

    return {
      status: "invalid",
      code: rcptCode,
      response: rcptLine,
      reason: "Gmail SMTP rejected recipient",
    };
  } catch (error) {
    return {
      status: "invalid",
      code: null,
      response: String(error.message || error),
      reason: "SMTP probe failed",
    };
  } finally {
    done();
  }
}

module.exports = {
  resolveMx,
  probeGmailRcpt,
};
