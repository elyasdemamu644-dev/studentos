import { ProxyAgent, fetch as undiciFetch, setGlobalDispatcher } from "undici";

import { config } from "@/config";

let productionProxy: ProxyAgent | undefined;

/** A production API never constructs a direct-network fallback transport. */
export function getProductionProxyAgent(): ProxyAgent {
  if (!config.isProduction || !config.egressProxyUrl) {
    throw new Error("The production egress proxy is not configured");
  }
  if (!productionProxy) productionProxy = new ProxyAgent(config.egressProxyUrl);
  return productionProxy;
}

/** Install the explicit proxy for Node's global fetch users (JWKS and storage). */
export function initializeOutboundProxy(): void {
  if (!config.isProduction || config.egressMode === "direct") return;
  setGlobalDispatcher(getProductionProxyAgent());
}

/** Use the same pinned Undici dispatcher for the custom safe-fetch transport. */
export function proxyFetch(
  input: string | URL,
  init: RequestInit,
): Promise<Response> {
  return undiciFetch(input, {
    ...init,
    dispatcher: getProductionProxyAgent(),
  } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
}
