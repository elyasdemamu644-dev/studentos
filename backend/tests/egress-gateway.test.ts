import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createEgressGatewayServer } from "@/utils/egress-gateway";

const servers: Array<net.Server> = [];
const listen = (server: net.Server): Promise<number> => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("no server address"));
    resolve(address.port);
  });
});
const close = (server: net.Server) => new Promise<void>((resolve) => server.close(() => resolve()));

afterEach(async () => { await Promise.all(servers.splice(0).map(close)); });

describe("restricted egress gateway", () => {
  it("tunnels only approved public destinations and preserves payloads", async () => {
    const upstream = net.createServer((socket) => socket.pipe(socket));
    servers.push(upstream);
    const targetPort = await listen(upstream);
    const gateway = createEgressGatewayServer({
      allowedDestinations: [`provider.example:${targetPort}`],
      resolver: async () => ["8.8.8.8"],
      connect: () => net.connect({ host: "127.0.0.1", port: targetPort }),
    });
    servers.push(gateway);
    const gatewayPort = await listen(gateway);

    const result = await new Promise<string>((resolve, reject) => {
      const client = net.connect({ host: "127.0.0.1", port: gatewayPort }, () => {
        client.write(`CONNECT provider.example:${targetPort} HTTP/1.1\r\nHost: provider.example:${targetPort}\r\n\r\nhello`);
      });
      let response = "";
      const timer = setTimeout(() => reject(new Error("gateway timed out")), 3000);
      client.on("data", (chunk) => {
        response += chunk.toString();
        if (response.includes("200 Connection Established") && response.endsWith("hello")) {
          clearTimeout(timer);
          client.destroy();
          resolve(response);
        }
      });
      client.once("error", reject);
    });
    expect(result).toContain("200 Connection Established");
    expect(result).toMatch(/hello$/);
  });

  it("denies unapproved hosts and any DNS answer in a private range", async () => {
    const gateway = createEgressGatewayServer({
      allowedDestinations: ["approved.example:443"],
      resolver: async (host) => host === "approved.example" ? ["8.8.8.8", "127.0.0.1"] : ["8.8.8.8"],
      connect: () => { throw new Error("must not connect"); },
    });
    servers.push(gateway);
    const port = await listen(gateway);
    for (const authority of ["other.example:443", "approved.example:443"]) {
      const response = await new Promise<string>((resolve, reject) => {
        const client = net.connect({ host: "127.0.0.1", port }, () => client.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`));
        let data = "";
        client.on("data", (chunk) => { data += chunk.toString(); });
        client.once("end", () => resolve(data));
        client.once("error", reject);
      });
      expect(response).toContain("403 Forbidden");
    }
  });
});

