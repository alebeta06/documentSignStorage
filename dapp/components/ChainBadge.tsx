"use client";

import { useAccount, useChainId, useChains } from "wagmi";
import { Badge } from "@/components/ui/badge";
import { isSupportedChain } from "@/lib/contracts";

export function ChainBadge() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const chains = useChains();

  if (!isConnected) return null;

  if (!isSupportedChain(chainId)) {
    return <Badge variant="destructive">Red no soportada</Badge>;
  }

  const chain = chains.find((c) => c.id === chainId);
  return <Badge variant="outline">{chain?.name ?? `chainId ${chainId}`}</Badge>;
}
