import { describe, it, expect, beforeAll, afterEach } from "vitest";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { app } from "@/app";
import request from "supertest";
import { registerAndLogin, authRequestJson, prisma } from "./helpers";
import {
  setEmailProvider,
  SmtpProvider,
  smtpSend,
  type EmailMessage,
} from "@/services/email";
import { renderNotificationEmail } from "@/services/email-templates";
import { EmailProviderError, EmailTimeoutError } from "@/config/errors";

const BASE = "/api/v1";

// ─────────────────────────────────────────────────────────────────────
// Offline fake SMTP server — proves the real wire conversation without a
// network or credentials. `silent` never greets, so the client must time out.
// ─────────────────────────────────────────────────────────────────────

interface FakeSmtpOptions {
  rcptCode?: number;
  silent?: boolean;
  messageId?: string;
}

async function startFakeSmtp(options: FakeSmtpOptions = {}) {
  const { rcptCode = 250, silent = false, messageId = "wire-1@test.local" } = options;

  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    socket.on("error", () => {});
    if (silent) return; // Accept the TCP connection but never speak.

    socket.write("220 fake ESMTP\r\n");
    let buffer = "";
    let inData = false;

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\r\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        newline = buffer.indexOf("\r\n");

        if (inData) {
          if (line === ".") {
            inData = false;
            socket.write(`250 2.0.0 Ok: queued <${messageId}>\r\n`);
          }
          continue;
        }

        const verb = line.split(" ")[0].toUpperCase();
        if (verb === "EHLO" || verb === "HELO") {
          socket.write("250-fake\r\n250 SIZE 10485760\r\n");
        } else if (verb === "MAIL") {
          socket.write("250 OK\r\n");
        } else if (verb === "RCPT") {
          socket.write(
            rcptCode >= 400 ? `${rcptCode} 5.1.1 refused\r\n` : `${rcptCode} OK\r\n`,
          );
        } else if (verb === "DATA") {
          inData = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (verb === "QUIT") {
          socket.write("221 Bye\r\n");
          socket.end();
        } else {
          socket.write("250 OK\r\n");
        }
      }
    });
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** A port that was listening a moment ago, so a connection is refused. */
async function refusedPort(): Promise<number> {
  const probe = net.createServer();
  const port = await new Promise<number>((resolve) => {
    probe.listen(0, "127.0.0.1", () => resolve((probe.address() as AddressInfo).port));
  });
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

// ─────────────────────────────────────────────────────────────────────
// Email service + dispatch endpoint (mocked provider)
// ─────────────────────────────────────────────────────────────────────

describe("Email dispatch", () => {
  let token: string;
  let userId: string;
  let ownerEmail: string;

  beforeAll(async () => {
    const auth = await registerAndLogin("email-dispatch@test.com", "Pass123!");
    token = auth.token;
    userId = auth.user.id;
    ownerEmail = auth.user.email;
  });

  afterEach(() => {
    setEmailProvider(null);
  });

  async function seedNotification() {
    return prisma.notification.create({
      data: {
        userId,
        title: "Task overdue",
        message: "CS101 essay is 1 day overdue.",
        type: "OVERDUE_TASK",
      },
    });
  }

  it("answers 503 EMAIL_NOT_CONFIGURED when email is disabled", async () => {
    const notification = await seedNotification();
    const res = await authRequestJson(
      "post",
      `${BASE}/notifications/${notification.id}/email`,
      token,
    );

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("EMAIL_NOT_CONFIGURED");
  });

  it("sends to the owner's own mailbox and marks the record delivered", async () => {
    const notification = await seedNotification();
    let captured: EmailMessage | undefined;
    setEmailProvider({
      async send(message) {
        captured = message;
        return { accepted: true, provider: "test-smtp", messageId: "mid-1" };
      },
    });

    const res = await authRequestJson(
      "post",
      `${BASE}/notifications/${notification.id}/email`,
      token,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      dispatched: true,
      status: "accepted",
      delivery: "EMAIL",
      channel: "email",
      provider: "test-smtp",
      messageId: "mid-1",
      to: ownerEmail,
    });
    // The recipient is always the authenticated owner — never an input.
    expect(captured?.to).toBe(ownerEmail);
    expect(captured?.subject).toBe("[Tutor Walle] Task overdue");
    expect(captured?.text).toContain("CS101 essay is 1 day overdue.");

    const stored = await prisma.notification.findUnique({ where: { id: notification.id } });
    expect(stored?.delivery).toBe("EMAIL");
    expect(stored?.channel).toBe("email");
  });

  it("reports a provider rejection without marking the record delivered", async () => {
    const notification = await seedNotification();
    setEmailProvider({
      async send() {
        return { accepted: false, provider: "test-smtp" };
      },
    });

    const res = await authRequestJson(
      "post",
      `${BASE}/notifications/${notification.id}/email`,
      token,
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      dispatched: false,
      status: "rejected",
      delivery: "IN_APP",
    });

    const stored = await prisma.notification.findUnique({ where: { id: notification.id } });
    expect(stored?.delivery).toBe("IN_APP");
    expect(stored?.channel).toBeNull();
  });

  it("maps a provider refusal to 502 EMAIL_PROVIDER_ERROR", async () => {
    const notification = await seedNotification();
    setEmailProvider({
      async send() {
        throw new EmailProviderError("SMTP RCPT TO was refused");
      },
    });

    const res = await authRequestJson(
      "post",
      `${BASE}/notifications/${notification.id}/email`,
      token,
    );

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("EMAIL_PROVIDER_ERROR");
  });

  it("maps a provider timeout to 504 EMAIL_TIMEOUT", async () => {
    const notification = await seedNotification();
    setEmailProvider({
      async send() {
        throw new EmailTimeoutError();
      },
    });

    const res = await authRequestJson(
      "post",
      `${BASE}/notifications/${notification.id}/email`,
      token,
    );

    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe("EMAIL_TIMEOUT");
  });

  it("wraps an unexpected provider failure as 502 without leaking detail", async () => {
    const notification = await seedNotification();
    setEmailProvider({
      async send() {
        throw new Error("boom: internal mail host secret");
      },
    });

    const res = await authRequestJson(
      "post",
      `${BASE}/notifications/${notification.id}/email`,
      token,
    );

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("EMAIL_PROVIDER_ERROR");
    expect(JSON.stringify(res.body)).not.toContain("boom");
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });

  it("requires authentication", async () => {
    const notification = await seedNotification();
    setEmailProvider({
      async send() {
        return { accepted: true, provider: "test-smtp" };
      },
    });

    const res = await request(app).post(`${BASE}/notifications/${notification.id}/email`);
    expect(res.status).toBe(401);
  });

  it("404s for another user's notification and never sends", async () => {
    const other = await registerAndLogin("email-dispatch-other@test.com", "Pass123!");
    const notification = await seedNotification();
    let sent = false;
    setEmailProvider({
      async send() {
        sent = true;
        return { accepted: true, provider: "test-smtp" };
      },
    });

    const res = await authRequestJson(
      "post",
      `${BASE}/notifications/${notification.id}/email`,
      other.token,
    );

    expect(res.status).toBe(404);
    expect(sent).toBe(false);
  });

  it("404s for a missing notification and never sends", async () => {
    let sent = false;
    setEmailProvider({
      async send() {
        sent = true;
        return { accepted: true, provider: "test-smtp" };
      },
    });

    const res = await authRequestJson(
      "post",
      `${BASE}/notifications/does-not-exist/email`,
      token,
    );

    expect(res.status).toBe(404);
    expect(sent).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Message validation (recipient + header-injection guards)
// ─────────────────────────────────────────────────────────────────────

describe("Email message validation", () => {
  // Port 1 is never dialled — assertSafeMessage must throw first.
  const provider = new SmtpProvider({
    host: "127.0.0.1",
    port: 1,
    secure: false,
    from: "no-reply@test.local",
    timeoutMs: 200,
  });

  it("rejects a recipient that is not an email address", async () => {
    await expect(
      provider.send({ to: "not-an-email", subject: "Hi", text: "x" }),
    ).rejects.toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
  });

  it("rejects a recipient carrying header-injection characters", async () => {
    await expect(
      provider.send({
        to: "owner@test.com\r\nBcc: attacker@evil.com",
        subject: "Hi",
        text: "x",
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
  });

  it("rejects a recipient with route characters", async () => {
    await expect(
      provider.send({ to: "a@b.com, c@d.com", subject: "Hi", text: "x" }),
    ).rejects.toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
  });

  it("rejects a subject containing a newline", async () => {
    await expect(
      provider.send({
        to: "owner@test.com",
        subject: "Hi\r\nBcc: attacker@evil.com",
        text: "x",
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
  });
});

// ─────────────────────────────────────────────────────────────────────
// SMTP client — real wire conversation against a local server
// ─────────────────────────────────────────────────────────────────────

describe("SMTP client", () => {
  it("completes a plain exchange, dot-stuffs the body, and parses the message id", async () => {
    const server = await startFakeSmtp({ messageId: "wire-1@test.local" });
    try {
      const result = await smtpSend(
        {
          host: "127.0.0.1",
          port: server.port,
          secure: false,
          from: "no-reply@test.local",
          timeoutMs: 3000,
        },
        { to: "student@test.local", subject: "Hello", text: "Line one\n.leading dot" },
      );

      expect(result).toEqual({
        accepted: true,
        provider: "smtp",
        messageId: "wire-1@test.local",
      });
    } finally {
      await server.close();
    }
  });

  it("maps a refused RCPT TO to 502 EMAIL_PROVIDER_ERROR", async () => {
    const server = await startFakeSmtp({ rcptCode: 550 });
    try {
      await expect(
        smtpSend(
          {
            host: "127.0.0.1",
            port: server.port,
            secure: false,
            from: "no-reply@test.local",
            timeoutMs: 3000,
          },
          { to: "student@test.local", subject: "Hi", text: "x" },
        ),
      ).rejects.toMatchObject({ statusCode: 502, code: "EMAIL_PROVIDER_ERROR" });
    } finally {
      await server.close();
    }
  });

  it("times out when the server never greets", async () => {
    const server = await startFakeSmtp({ silent: true });
    try {
      await expect(
        smtpSend(
          {
            host: "127.0.0.1",
            port: server.port,
            secure: false,
            from: "no-reply@test.local",
            timeoutMs: 150,
          },
          { to: "student@test.local", subject: "Hi", text: "x" },
        ),
      ).rejects.toMatchObject({ statusCode: 504, code: "EMAIL_TIMEOUT" });
    } finally {
      await server.close();
    }
  });

  it("maps an unreachable server to 502 EMAIL_PROVIDER_ERROR", async () => {
    const port = await refusedPort();
    await expect(
      smtpSend(
        {
          host: "127.0.0.1",
          port,
          secure: false,
          from: "no-reply@test.local",
          timeoutMs: 1000,
        },
        { to: "student@test.local", subject: "Hi", text: "x" },
      ),
    ).rejects.toMatchObject({ statusCode: 502, code: "EMAIL_PROVIDER_ERROR" });
  });

  it("refuses to send credentials over a server that does not offer STARTTLS", async () => {
    const server = await startFakeSmtp();
    try {
      await expect(
        smtpSend(
          {
            host: "127.0.0.1",
            port: server.port,
            secure: false,
            username: "user",
            password: "secret",
            from: "no-reply@test.local",
            timeoutMs: 3000,
          },
          { to: "student@test.local", subject: "Hi", text: "x" },
        ),
      ).rejects.toMatchObject({ statusCode: 502, code: "EMAIL_PROVIDER_ERROR" });
    } finally {
      await server.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Template
// ─────────────────────────────────────────────────────────────────────

describe("Notification email template", () => {
  it("renders a branded subject and the notification body", () => {
    const { subject, text } = renderNotificationEmail({
      title: "Task overdue",
      message: '"Essay" is 1 day overdue.',
    });

    expect(subject).toBe("[Tutor Walle] Task overdue");
    expect(text).toContain("Task overdue");
    expect(text).toContain('"Essay" is 1 day overdue.');
    expect(text).toContain("— Tutor Walle");
  });
});
