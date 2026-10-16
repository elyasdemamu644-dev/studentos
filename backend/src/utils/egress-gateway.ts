import { lookup } from "node:dns/promises";
import http from "node:http";
import net, { isIP } from "node:net";
import { domainToASCII } from "node:url";

import { isDisallowedAddress } from "./ssrf-guard";

export interface EgressGatewayOptions {
  allowedDestinations: readonly string[];
  databaseHost?: string;
  databasePort?: number;
  databaseListenPort?: number;
  resolver?: (hostname: string) => Promise<readonly string[]>;
  connect?: (address: string, port: number) => net.Socket;
}

function normalizeHostname(host: string): string {
  return domainToASCII(host.toLowerCase().replace(/\.$/, ""));
}

function parseAuthority(authority: string): { hostname: string; port: number } | null {
  // IP literals and IPv6 authority forms are deliberately unsupported. The
  // operator policy approves DNS names only; the gateway resolves and pins them.
  const match = /^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?):([0-9]{1,5})$/i.exec(authority);
  if (!match || match[1].includes("..") || isIP(match[1])) return null;
  const hostname = normalizeHostname(match[1]);
  if (!hostname || hostname.length > 253 || hostname.split(".").some((part) => part.length > 63)) return null;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { hostname, port };
}

async function publicAddresses(
  hostname: string,
  resolver: NonNullable<EgressGatewayOptions["resolver"]>,
): Promise<string[]> {
  const addresses = await resolver(hostname);
  if (!addresses.length || addresses.some((address) => isDisallowedAddress(address))) {
    throw new Error("destination policy denied");
  }
  return [...new Set(addresses)];
}

function writeStatus(socket: net.Socket, status: number, message: string): void {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/**
 * Restricted HTTP CONNECT gateway. It independently approves exact host:port
 * pairs, resolves every DNS answer, rejects special-use addresses, and dials a
 * selected validated address directly. TLS remains end-to-end between the API
 * client and destination, preserving normal CA and SNI checks.
 */
export function createEgressGatewayServer(options: EgressGatewayOptions): http.Server {
  const allowed = new Set<string>();
  for (const raw of options.allowedDestinations) {
    const parsed = parseAuthority(raw.trim());
    if (!parsed) throw new Error("Egress allowlist contains an invalid destination");
    allowed.add(`${parsed.hostname}:${parsed.port}`);
  }
  const resolver = options.resolver ?? (async (hostname) =>
    (await lookup(hostname, { all: true, verbatim: true })).map((record) => record.address));
  const connect = options.connect ?? ((address, port) => net.connect({ host: address, port }));
  const databaseHost = options.databaseHost ? normalizeHostname(options.databaseHost) : undefined;
  const databasePort = options.databasePort ?? 5432;
  const databaseListenPort = options.databaseListenPort ?? databasePort;
  if (databaseHost && !allowed.has(`${databaseHost}:${databasePort}`)) {
    throw new Error("The database tunnel target must be in the egress allowlist");
  }
  const sockets = new Set<net.Socket>();

  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end('{"status":"ok"}');
      return;
    }
    response.writeHead(405, { Connection: "close", "Content-Length": "0" });
    response.end();
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  server.on("connect", async (request, client, head) => {
    const clientSocket = client as net.Socket;
    const target = parseAuthority(request.url ?? "");
    const targetKey = target ? `${target.hostname}:${target.port}` : "";
    if (!target || !allowed.has(targetKey) || request.headers["proxy-authorization"]) {
      writeStatus(clientSocket, 403, "Forbidden");
      return;
    }

    try {
      const addresses = await publicAddresses(target.hostname, resolver);
      const upstream = connect(addresses[0], target.port);
      const timer = setTimeout(() => {
        upstream.destroy();
        clientSocket.destroy();
      }, 10_000);
      upstream.once("error", () => {
        clearTimeout(timer);
        writeStatus(clientSocket, 502, "Bad Gateway");
      });
      upstream.once("connect", () => {
        clearTimeout(timer);
        if (clientSocket.destroyed) {
          upstream.destroy();
          return;
        }
        clientSocket.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: StudentOS-Egress\r\n\r\n");
        if (head.length) upstream.write(head);
        clientSocket.pipe(upstream);
        upstream.pipe(clientSocket);
        clientSocket.once("error", () => upstream.destroy());
        upstream.once("close", () => clientSocket.destroy());
      });
      clientSocket.once("close", () => upstream.destroy());
    } catch {
      writeStatus(clientSocket, 403, "Forbidden");
    }
  });

  if (databaseHost) {
    const databaseServer = net.createServer(async (client) => {
      try {
        // This fixed target is operator-supplied and distinct from all tenant
        // requests. It is still resolved and pinned at the gateway boundary.
        const addresses = await publicAddresses(databaseHost, resolver);
        const upstream = connect(addresses[0], databasePort);
        const timer = setTimeout(() => {
          upstream.destroy();
          client.destroy();
        }, 10_000);
        upstream.once("error", () => {
          clearTimeout(timer);
          client.destroy();
        });
        upstream.once("connect", () => {
          clearTimeout(timer);
          client.pipe(upstream);
          upstream.pipe(client);
          client.once("error", () => upstream.destroy());
          upstream.once("close", () => client.destroy());
        });
        client.once("close", () => upstream.destroy());
      } catch {
        client.destroy();
      }
    });
    // Bind the dedicated database tunnel to the same private-network address
    // as HTTP proxy traffic; Docker does not publish either port on the host.
    server.on("listening", () => {
      const address = server.address();
      if (!address || typeof address === "string") return;
      databaseServer.listen(databaseListenPort, address.address);
    });
    server.on("close", () => { databaseServer.close(); });
  }

  server.on("close", () => {
    for (const socket of sockets) socket.destroy();
  });
  return server;
}

if (process.argv[1] && /(?:^|[\\/])egress-gateway\.(?:js|ts)$/.test(process.argv[1])) {
  const rawDestinations = process.env.EGRESS_ALLOWED_DESTINATIONS ?? "";
  const allowedDestinations = rawDestinations.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const databaseHost = process.env.EGRESS_DATABASE_HOST?.trim().toLowerCase();
  const port = Number(process.env.EGRESS_PROXY_PORT ?? 3128);
  if (!allowedDestinations.length || (databaseHost && !allowedDestinations.includes(`${databaseHost}:5432`))) {
    throw new Error("Egress gateway destination policy is missing or inconsistent");
  }
  const server = createEgressGatewayServer({ allowedDestinations, databaseHost });
  server.listen(port, "0.0.0.0", () => console.log(`Egress gateway listening on port ${port}`));
  const shutdown = (): void => {
    server.close(() => { process.exit(0); });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
