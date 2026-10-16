#!/usr/bin/env bash
set -euo pipefail

# Run only on the Linux Docker host after `docker compose up` created the
# network. This policy is intentionally scoped to the API container address;
# it does not edit INPUT/SSH rules or alter other workloads.
API_IP="${TUTOR_WALLE_API_IP:-172.30.0.3}"
GATEWAY_IP="${TUTOR_WALLE_GATEWAY_IP:-172.30.0.2}"
CHAIN="DOCKER-USER"

if ! command -v iptables >/dev/null || ! iptables -nL "$CHAIN" >/dev/null 2>&1; then
  echo "Docker iptables DOCKER-USER chain is unavailable; refusing to continue" >&2
  exit 1
fi

# Idempotently insert the policy before broad Docker forwarding rules.
iptables -C "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN 2>/dev/null || \
  iptables -I "$CHAIN" 1 -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
iptables -C "$CHAIN" -s "$API_IP" -d "$GATEWAY_IP" -p tcp -m multiport --dports 3128,5432 -j RETURN 2>/dev/null || \
  iptables -I "$CHAIN" 2 -s "$API_IP" -d "$GATEWAY_IP" -p tcp -m multiport --dports 3128,5432 -j RETURN
iptables -C "$CHAIN" -s "$API_IP" -j DROP 2>/dev/null || \
  iptables -I "$CHAIN" 3 -s "$API_IP" -j DROP

echo "API forwarding is limited to the egress gateway proxy and database tunnel."
