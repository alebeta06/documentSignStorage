import { sepolia, baseSepolia } from "wagmi/chains";
import type { Address } from "viem";

// Mapping chainId -> direccion del DocumentRegistry deployado en esa red.
// Cuando deployemos a Base Sepolia (Fase 2b), reemplazar el placeholder.
export const DOCUMENT_REGISTRY_ADDRESS = {
  [sepolia.id]: "0x2c69e8071e842139dE4eFbc3A1597205098769aA",
  [baseSepolia.id]: "0x0000000000000000000000000000000000000000", // TODO Fase 2b
} as const satisfies Record<number, Address>;

export const SUPPORTED_CHAIN_IDS = [sepolia.id, baseSepolia.id] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

/**
 * Devuelve la direccion del contrato para el chainId dado.
 * Devuelve undefined si la red no esta soportada o el contrato no fue deployado aun.
 */
export function getContractAddress(
  chainId: number | undefined
): Address | undefined {
  if (chainId === undefined) return undefined;
  const address = (DOCUMENT_REGISTRY_ADDRESS as Record<number, Address>)[
    chainId
  ];
  if (!address || address === "0x0000000000000000000000000000000000000000") {
    return undefined;
  }
  return address;
}

/** True si chainId esta listado en SUPPORTED_CHAIN_IDS, falso en cualquier otro caso. */
export function isSupportedChain(
  chainId: number | undefined
): chainId is SupportedChainId {
  if (chainId === undefined) return false;
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}
