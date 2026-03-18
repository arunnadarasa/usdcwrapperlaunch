import { http } from "viem";
import { baseSepolia } from "wagmi/chains";
import { createConfig } from "wagmi";
import { getDefaultConfig } from "connectkit";

const RPC_URL =
  import.meta.env.VITE_RPC_URL ||
  "https://base-sepolia-rpc.publicnode.com";

const params = {
  chains: [baseSepolia],
  transports: {
    [baseSepolia.id]: http(RPC_URL)
  },
  appName: "USDC-backed Token Launcher"
};

const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
if (walletConnectProjectId) {
  params.walletConnectProjectId = walletConnectProjectId;
}

export const wagmiConfig = createConfig(getDefaultConfig(params));

