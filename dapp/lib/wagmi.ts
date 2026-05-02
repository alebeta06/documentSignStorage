import { http } from "wagmi";
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
    // http() sin URL usa el RPC publico por default de cada chain
    // (suficiente para el uso de amigos en testnet). Si en el futuro
    // queremos Alchemy/Infura para mejor rate-limit, pasar la URL aqui.
    [sepolia.id]: http(),
    [baseSepolia.id]: http(),
  },
});
