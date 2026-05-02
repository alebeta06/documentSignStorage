import { sepolia, baseSepolia } from "wagmi/chains";

const EXPLORERS: Record<number, { name: string; baseUrl: string }> = {
  [sepolia.id]: {
    name: "Sepolia Etherscan",
    baseUrl: sepolia.blockExplorers.default.url,
  },
  [baseSepolia.id]: {
    name: "Base Sepolia Basescan",
    baseUrl: baseSepolia.blockExplorers.default.url,
  },
};

export function getTxExplorer(
  chainId: number | undefined,
  txHash: string
): { name: string; url: string } | null {
  if (chainId === undefined) return null;
  const e = EXPLORERS[chainId];
  return e ? { name: e.name, url: `${e.baseUrl}/tx/${txHash}` } : null;
}
