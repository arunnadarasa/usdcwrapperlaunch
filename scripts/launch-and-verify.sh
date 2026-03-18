#!/usr/bin/env bash
set -euo pipefail

CHAIN_ID="84532"
BASESCAN_V2_API_URL="https://api-sepolia.basescan.org/v2/api?chainid=${CHAIN_ID}"

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env var: ${name}" >&2
    exit 1
  fi
}

require_env "RPC_URL"
require_env "PRIVATE_KEY"
require_env "USDC_ADDRESS"
require_env "ETHERSCAN_API_KEY"
require_env "SUFFIX"
require_env "INITIAL_USDC_AMOUNT"
require_env "RECIPIENT"

FACTORY_ADDRESS="${FACTORY_ADDRESS:-}"

extract_last_address() {
  local output="$1"
  python3 - <<'PY'
import os, re
out = os.environ["OUTPUT"]
addrs = re.findall(r"0x[a-fA-F0-9]{40}", out)
print(addrs[-1] if addrs else "")
PY
}

echo "==> Launching USDC-backed wrapper for suffix: ${SUFFIX}"

if [[ -z "${FACTORY_ADDRESS}" ]]; then
  echo "==> Deploying factory"
  OUTPUT="$(
    USDC_ADDRESS="${USDC_ADDRESS}" \
    forge script script/DeployFactory.s.sol:DeployFactoryScript \
      --rpc-url "${RPC_URL}" \
      --private-key "${PRIVATE_KEY}" \
      --broadcast 2>&1
  )"
  export OUTPUT
  FACTORY_ADDRESS="$(extract_last_address "${OUTPUT}")"
  if [[ -z "${FACTORY_ADDRESS}" ]]; then
    echo "Failed to parse FACTORY_ADDRESS from forge output" >&2
    exit 1
  fi
fi

echo "Factory: ${FACTORY_ADDRESS}"

echo "==> Deploying token + initial mint"
OUTPUT="$(
  FACTORY_ADDRESS="${FACTORY_ADDRESS}" \
  SUFFIX="${SUFFIX}" \
  INITIAL_USDC_AMOUNT="${INITIAL_USDC_AMOUNT}" \
  RECIPIENT="${RECIPIENT}" \
  forge script script/LaunchToken.s.sol:LaunchTokenScript \
    --rpc-url "${RPC_URL}" \
    --private-key "${PRIVATE_KEY}" \
    --broadcast 2>&1
)"
export OUTPUT
TOKEN_ADDRESS="$(extract_last_address "${OUTPUT}")"
if [[ -z "${TOKEN_ADDRESS}" ]]; then
  echo "Failed to parse TOKEN_ADDRESS from forge output" >&2
  exit 1
fi

echo "Token: ${TOKEN_ADDRESS}"

NAME="USDC ${SUFFIX}"
SYMBOL="USDC.${SUFFIX}"

ENCODED_ARGS="$(cast abi-encode 'constructor(string,string,address,address)' "${NAME}" "${SYMBOL}" "${USDC_ADDRESS}" "${FACTORY_ADDRESS}")"

echo "==> Verifying on Base Sepolia (BaseScan) ..."
forge verify-contract "${TOKEN_ADDRESS}" "src/USDCBackedToken.sol:USDCBackedToken" \
  --rpc-url "${RPC_URL}" \
  --verifier custom \
  --verifier-url "${BASESCAN_V2_API_URL}" \
  --verifier-api-key "${ETHERSCAN_API_KEY}" \
  --constructor-args "${ENCODED_ARGS}" \
  --watch \
  --chain "${CHAIN_ID}" \
  --num-of-optimizations 200 \
  --via-ir

echo "==> Done"
echo "BaseScan token link: https://sepolia.basescan.org/address/${TOKEN_ADDRESS}#code"

