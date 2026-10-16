import http from "node:http";
import https from "node:https";
import type net from "node:net";

import { config } from "@/config";

/** Open a raw TCP tunnel through the mandatory production CONNECT proxy. */
export function connectViaEgressProxy(hostname: string, port: number, timeoutMs: number): Promise<net.Socket> {
  const proxyUrl = config.egressProxyUrl;
  if (!proxyUrl) return Promise.reject(new Error("The required outbound proxy is unavailable"));
  if (!/^[a-z0-9.-]+$/i.test(hostname) || !Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.reject(new Error("Outbound destination is invalid"));
  }

  const proxy = new URL(proxyUrl);
  const requestFn = proxy.protocol === "https:" ? https.request : http.request;
  return new Promise((resolve, reject) => {
    const request = requestFn({
      hostname: proxy.hostname,
      port: Number(proxy.port || (proxy.protocol === "https:" ? 443 : 80)),
      method: "CONNECT",
      path: `${hostname}:${port}`,
      headers: { Host: `${hostname}:${port}` },
      agent: false,
      timeout: timeoutMs,
    });
    request.once("connect", (response, socket, head) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error("The approved outbound proxy rejected the tunnel"));
        return;
      }
      if (head.length) socket.unshift(head);
      resolve(socket);
    });
    request.once("timeout", () => request.destroy(new Error("Outbound proxy connection timed out")));
    request.once("error", () => reject(new Error("The approved outbound proxy is unavailable")));
    request.end();
  });
}
