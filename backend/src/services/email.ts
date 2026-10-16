import net from "node:net";
import os from "node:os";
import tls from "node:tls";

import { config } from "@/config";
import { connectViaEgressProxy } from "@/utils/proxy-connect";
import {
  ApiError,
  EmailNotConfiguredError,
  EmailProviderError,
  EmailTimeoutError,
  ValidationApiError,
} from "@/config/errors";

// ─────────────────────────────────────────────
// Email dispatch — dependency-free SMTP client
// ─────────────────────────────────────────────
//
// Speaks SMTP directly over node:net / node:tls (no nodemailer et al.), the
// same "no batteries" approach used for S3 and Google OAuth. Supports:
//   - implicit TLS (SMTPS, SMTP_SECURE=true)
//   - STARTTLS upgrade when credentials are set and the server advertises it
//   - plain unauthenticated relay (no credentials configured)
//   - AUTH PLAIN on a TLS-protected channel only
//   - per-message MAIL FROM / RCPT TO / DATA with dot-stuffing +
//     header-injection guards, and a message-id extracted from the DATA reply
//
// Error contract (pinned by tests):
//   - not configured → EmailNotConfiguredError (503 EMAIL_NOT_CONFIGURED)
//   - provider refusal / connection failure → EmailProviderError
//     (502 EMAIL_PROVIDER_ERROR)
//   - conversation idle past timeout → EmailTimeoutError (504 EMAIL_TIMEOUT)
//   - invalid recipient/subject → ValidationApiError (400 VALIDATION_ERROR)
//
// Security rules:
//   - The recipient is always an internally sourced address (the owner's own
//     mailbox) — there is no arbitrary-recipient API surface.
//   - Credentials are never sent over a plaintext link (refused unless the
//     connection is implicit TLS or STARTTLS was advertised and upgraded).
//   - Subject/to/from are checked for CR/LF (header injection); the body is
//     CRLF-normalised and dot-stuffed.
//   - Credentials, subject and body are never logged — only recipient,
//     provider and the trimmed outcome.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSendResult {
  /** Acceptance by the provider (queued), NOT inbox delivery. */
  accepted: boolean;
  provider: string;
  messageId?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username?: string;
  password?: string;
  from: string;
  timeoutMs: number;
}

// ─────────────────────────────────────────────
// Provider registry
// ─────────────────────────────────────────────

let injectedProvider: EmailProvider | null = null;

/** Test seam — mirrors `setFileStorage` in `services/storage.ts`. */
export function setEmailProvider(provider: EmailProvider | null): void {
  injectedProvider = provider;
}

/** The configured provider, or null when email dispatch is disabled. */
export function getEmailProvider(): EmailProvider | null {
  if (injectedProvider) return injectedProvider;
  if (!config.emailEnabled || !config.smtpHost) return null;
  return new SmtpProvider({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    username: config.smtpUser || undefined,
    password: config.smtpPassword || undefined,
    from: config.smtpFrom,
    timeoutMs: config.emailTimeoutMs,
  });
}

export class SmtpProvider implements EmailProvider {
  constructor(private readonly smtp: SmtpConfig) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    assertSafeMessage(message);
    const result = await smtpSend({ ...this.smtp, from: this.smtp.from }, message);
    // Outcome only — no credentials, subject or body.
    console.log(
      `[email] accepted provider=smtp to=${message.to}${result.messageId ? ` id=${result.messageId}` : ""}`,
    );
    return result;
  }
}

// ─────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────

function assertSafeMessage(message: EmailMessage): void {
  // The recipient is internally sourced, but enforce an unambiguous local-part
  // address anyway so a bad value can never be routed somewhere unexpected.
  if (
    !message.to ||
    !message.to.includes("@") ||
    /[\s<>"(),:;\[\]\\]/.test(message.to) ||
    /[\r\n]/.test(message.to)
  ) {
    throw new ValidationApiError("Refusing to send to an invalid email address");
  }
  // Header injection guard: a newline in the subject would let CRLF-prefixed
  // headers escape into the DATA block.
  if (/[\r\n]/.test(message.subject)) {
    throw new ValidationApiError("Refusing to send a message with a newline in its subject");
  }
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

function dotStuff(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

function renderData(from: string, message: EmailMessage): string {
  const headers = [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${sanitizeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "Auto-Submitted: auto-generated",
  ];
  // The DATA body MUST end with CRLF so the terminating "." on the next line is
  // a line of its own — without it the dot attaches to the last body line and a
  // real server never sees the end-of-data marker (it hangs until timeout).
  return `${headers.join("\r\n")}\r\n\r\n${dotStuff(message.text)}\r\n`;
}

function extractMessageId(history: readonly string[]): string | undefined {
  for (const line of history) {
    const match = /<([^<>\s]+@[^<>\s]+)>/.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

// ─────────────────────────────────────────────
// Line reader
// ─────────────────────────────────────────────

interface SmtpResponse {
  code: number;
  history: string[];
}

class SmtpResponder {
  private buffer = "";
  private pending: ((response: SmtpResponse) => void) | null = null;
  private readonly onData: (chunk: Buffer) => void;

  constructor(private owner: net.Socket) {
    this.owner = this.owner;
    this.onData = (chunk) => this.handle(chunk.toString("utf-8"));
    this.owner.on("data", this.onData);
  }

  detach(): void {
    this.owner.off("data", this.onData);
  }

  /** The next complete SMTP response ("250 ..." final line). */
  read(): Promise<SmtpResponse> {
    return new Promise((resolve) => {
      this.pending = resolve;
      if (this.buffer) {
        const retained = this.buffer;
        this.buffer = "";
        this.handle(retained);
      }
    });
  }

  private handle(chunk: string): void {
    if (chunk) this.buffer += chunk;
    let cursor = 0;
    const history: string[] = [];
    while (true) {
      const nl = this.buffer.indexOf("\n", cursor);
      if (nl === -1) break;
      const line = this.buffer.slice(cursor, nl).replace(/\r$/, "");
      cursor = nl + 1;
      history.push(line);
      const match = /^(\d{3})([ -])/.exec(line);
      if (match && match[2] === " ") {
        const rest = this.buffer.slice(cursor);
        this.buffer = "";
        const pending = this.pending;
        this.pending = null;
        if (pending) pending({ code: Number(match[1]), history });
        // Bytes after a final line are left for the next read to pick up.
        if (rest) this.buffer = rest;
        return;
      }
    }
    this.buffer = this.buffer.slice(cursor);
  }
}

function expectCode(response: SmtpResponse, expected: number, phase: string): void {
  if (response.code !== expected) {
    throw new EmailProviderError(`SMTP ${phase} was refused by the server (code ${response.code})`);
  }
}

// ─────────────────────────────────────────────
// SMTP conversation
// ─────────────────────────────────────────────

export async function smtpSend(smtp: SmtpConfig, message: EmailMessage): Promise<EmailSendResult> {
  assertSafeMessage(message);

  const needsAuth = Boolean(smtp.username && smtp.password);
  const wantsStartTls = needsAuth && !smtp.secure;

  let active: net.Socket;
  try {
    if (config.isProduction) {
      const tunnel = await connectViaEgressProxy(smtp.host, smtp.port, smtp.timeoutMs);
      active = smtp.secure
        ? tls.connect({ socket: tunnel, servername: smtp.host })
        : tunnel;
    } else {
      active = smtp.secure
        ? tls.connect({ host: smtp.host, port: smtp.port, servername: smtp.host })
        : net.connect({ host: smtp.host, port: smtp.port });
    }
  } catch {
    throw new EmailProviderError("SMTP connection could not be opened");
  }

  const write = (line: string): void => {
    active.write(`${line}\r\n`);
  };

  const timeoutError = new EmailTimeoutError();

  return await new Promise<EmailSendResult>((resolve, reject) => {
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      action();
    };

    const onTimeout = (): void => {
      settle(() => {
        active.destroy();
        reject(timeoutError);
      });
    };
    const onError = (): void => {
      settle(() => {
        active.destroy();
        reject(new EmailProviderError("SMTP connection failed"));
      });
    };
    const onClose = (): void => {
      settle(() => {
        reject(
          new EmailProviderError("SMTP connection closed before the exchange completed"),
        );
      });
    };
    const failTyped = (error: Error): void => {
      settle(() => {
        active.destroy();
        reject(error);
      });
    };

    let responder = new SmtpResponder(active);
    active.setTimeout(smtp.timeoutMs);
    active.on("timeout", onTimeout);
    active.on("error", onError);
    active.on("close", onClose);

    void (async () => {
      try {
        expectCode(await responder.read(), 220, "greeting");
        write(`EHLO ${os.hostname() || "localhost"}`);
        let ehlo = await responder.read();
        expectCode(ehlo, 250, "EHLO");

        if (wantsStartTls) {
          const caps = ehlo.history.join("\n").toUpperCase();
          if (!caps.includes("STARTTLS")) {
            throw new EmailProviderError(
              "SMTP server does not offer STARTTLS — refusing to send credentials over plaintext",
            );
          }
          write("STARTTLS");
          expectCode(await responder.read(), 220, "STARTTLS");

          active.off("timeout", onTimeout);
          active.off("error", onError);
          active.off("close", onClose);
          responder.detach();

          const tlsSocket = tls.connect({ host: smtp.host, servername: smtp.host, socket: active });
          responder = new SmtpResponder(tlsSocket);
          active = tlsSocket;
          tlsSocket.setTimeout(smtp.timeoutMs);
          tlsSocket.on("timeout", onTimeout);
          tlsSocket.on("error", onError);
          tlsSocket.on("close", onClose);

          await new Promise<void>((resolveSecure, rejectSecure) => {
            tlsSocket.once("secureConnect", () => resolveSecure());
            tlsSocket.once("error", () => rejectSecure(timeoutError));
          });
          write(`EHLO ${os.hostname() || "localhost"}`);
          ehlo = await responder.read();
          expectCode(ehlo, 250, "EHLO after STARTTLS");
        } else if (needsAuth && !smtp.secure) {
          // Unreachable via SmtpProvider.send (assertSafeMessage runs first on
          // the provider path), but a direct smtpSend call must not leak
          // credentials either.
          throw new EmailProviderError("SMTP credentials require a TLS channel");
        }

        if (needsAuth) {
          const token = Buffer.from(`\u0000${smtp.username}\u0000${smtp.password}`, "utf-8").toString(
            "base64",
          );
          write(`AUTH PLAIN ${token}`);
          expectCode(await responder.read(), 235, "AUTH");
        }

        write(`MAIL FROM:<${smtp.from}>`);
        expectCode(await responder.read(), 250, "MAIL FROM");
        write(`RCPT TO:<${message.to}>`);
        expectCode(await responder.read(), 250, "RCPT TO");
        write("DATA");
        expectCode(await responder.read(), 354, "DATA");
        write(renderData(smtp.from, message));
        write(".");
        const final = await responder.read();
        expectCode(final, 250, "DATA");
        const messageId = extractMessageId(final.history);

        write("QUIT");
        await responder.read();

        settle(() => {
          active.destroy();
          resolve({
            accepted: true,
            provider: "smtp",
            ...(messageId ? { messageId } : {}),
          });
        });
      } catch (error) {
        if (error instanceof ApiError) {
          failTyped(error);
          return;
        }
        failTyped(new EmailProviderError("SMTP exchange failed"));
      }
    })();
  });
}
