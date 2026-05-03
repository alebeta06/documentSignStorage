import { fallback, http } from "viem";
import { sepolia, baseSepolia } from "wagmi/chains";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

if (!projectId) {
  // Fail fast en dev/build — sin projectId, RainbowKit no puede armar
  // el modal de WalletConnect. Que reviente con un mensaje claro.
  throw new Error(
    "Missing NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID. Crealo en https://cloud.reown.com y pegalo en dapp/.env.local"
  );
}

// RPCs opcionales del usuario (Alchemy, Infura, QuickNode, etc.). Si estan
// definidos, son los primeros en el fallback. Sino, usamos solo los publicos.
const userSepoliaRpc = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL;
const userBaseSepoliaRpc = process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL;

// fallback() prueba en orden: si el primer transport falla (timeout, 429, 5xx),
// pasa al siguiente. Esencial cuando dependes de RPCs publicos porque
// estos rate-limitean agresivo cuando haces varias calls seguidas
// (read pre-check + write + waitForReceipt = 10+ requests por firma).
const sepoliaTransports = [
  ...(userSepoliaRpc ? [http(userSepoliaRpc)] : []),
  http("https://ethereum-sepolia-rpc.publicnode.com"),
  http("https://sepolia.gateway.tenderly.co"),
  http("https://eth-sepolia.public.blastapi.io"),
];

const baseSepoliaTransports = [
  ...(userBaseSepoliaRpc ? [http(userBaseSepoliaRpc)] : []),
  http("https://base-sepolia-rpc.publicnode.com"),
  http("https://sepolia.base.org"),
  http("https://base-sepolia.gateway.tenderly.co"),
];

// getDefaultConfig (RainbowKit) arma una wagmi config con los connectors
// estandar (injected/MetaMask, WalletConnect, Coinbase, Rainbow). Lo
// preferimos sobre createConfig porque la lista curada cubre el 95% de
// los casos sin tener que mantener nosotros la fauna de connectors.
export const config = getDefaultConfig({
  appName: "Document Sign Storage",
  projectId,
  chains: [sepolia, baseSepolia],
  // ssr=true le dice a wagmi que somos un app de Next con render SSR;
  // ajusta cookies/persistencia para no romper la hidratacion.
  ssr: true,
  transports: {
    [sepolia.id]: fallback(sepoliaTransports),
    [baseSepolia.id]: fallback(baseSepoliaTransports),
  },
});
