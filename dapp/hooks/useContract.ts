"use client";
// Wrapper imperativo sobre el contrato. Internamente usa acciones de @wagmi/core
// (readContract / writeContract / waitForTransactionReceipt) — wagmi resuelve
// el RPC, el signer y la chain a partir del wagmi config + wallet conectada.
//
// Mantenemos la API tipo "async function" que ya usaban los componentes en la
// version Anvil, asi minimizamos cambios en DocumentSigner / Verifier / History.

import { useCallback } from "react";
import { useAccount, useChainId, useConfig } from "wagmi";
import {
  readContract,
  writeContract,
  waitForTransactionReceipt,
} from "@wagmi/core";
import type { Address, Hex } from "viem";
import { DocumentRegistryABI } from "@/lib/DocumentRegistryABI";
import { getContractAddress } from "@/lib/contracts";

// "Shape" del Document que ve el frontend — refleja el struct on-chain.
export interface DocumentInfo {
  hash: Hex;
  timestamp: bigint;
  signer: Address;
  signature: Hex;
}

export function useContract() {
  const config = useConfig();
  const chainId = useChainId();
  const { address: account } = useAccount();

  // address del contrato segun la red activa. Puede ser undefined si el user
  // esta en una red no soportada o si no hay deploy en esa chain (Base Sepolia
  // hasta que se complete Fase 2b).
  const contractAddress = getContractAddress(chainId);

  // Helper que valida que tengamos address antes de cualquier llamada.
  // Lanza con mensaje claro para que el componente lo muestre al user.
  const ensureAddress = useCallback((): Address => {
    if (!contractAddress) {
      throw new Error(
        `No DocumentRegistry deployado en chainId ${chainId}. Cambia a Sepolia.`
      );
    }
    return contractAddress;
  }, [contractAddress, chainId]);

  // ── Lecturas ──────────────────────────────────────────────

  const isDocumentStored = useCallback(
    async (hash: Hex): Promise<boolean> => {
      return (await readContract(config, {
        address: ensureAddress(),
        abi: DocumentRegistryABI,
        functionName: "isDocumentStored",
        args: [hash],
      })) as boolean;
    },
    [config, ensureAddress]
  );

  const getDocumentCount = useCallback(async (): Promise<bigint> => {
    return (await readContract(config, {
      address: ensureAddress(),
      abi: DocumentRegistryABI,
      functionName: "getDocumentCount",
    })) as bigint;
  }, [config, ensureAddress]);

  const getDocumentHashByIndex = useCallback(
    async (index: bigint | number): Promise<Hex> => {
      return (await readContract(config, {
        address: ensureAddress(),
        abi: DocumentRegistryABI,
        functionName: "getDocumentHashByIndex",
        args: [BigInt(index)],
      })) as Hex;
    },
    [config, ensureAddress]
  );

  const getDocumentInfo = useCallback(
    async (hash: Hex): Promise<DocumentInfo> => {
      const r = (await readContract(config, {
        address: ensureAddress(),
        abi: DocumentRegistryABI,
        functionName: "getDocumentInfo",
        args: [hash],
      })) as DocumentInfo;
      return r;
    },
    [config, ensureAddress]
  );

  const verifyDocument = useCallback(
    async (
      hash: Hex,
      signer: Address,
      signature: Hex
    ): Promise<boolean> => {
      return (await readContract(config, {
        address: ensureAddress(),
        abi: DocumentRegistryABI,
        functionName: "verifyDocument",
        args: [hash, signer, signature],
      })) as boolean;
    },
    [config, ensureAddress]
  );

  // ── Escrituras ────────────────────────────────────────────

  /**
   * Manda storeDocumentHash y espera 1 confirmacion.
   * Devuelve el txHash una vez minado.
   */
  const storeDocumentHash = useCallback(
    async (params: {
      hash: Hex;
      timestamp: bigint;
      signature: Hex;
      signer: Address;
    }): Promise<Hex> => {
      if (!account) throw new Error("No wallet connected");

      // writeContract abre el popup de la wallet, firma y manda la tx.
      // Devuelve el txHash inmediatamente (la tx queda en mempool).
      const txHash = await writeContract(config, {
        address: ensureAddress(),
        abi: DocumentRegistryABI,
        functionName: "storeDocumentHash",
        args: [params.hash, params.timestamp, params.signature, params.signer],
      });

      // Esperamos 1 confirmacion para que la UI pueda mostrar "registrado".
      // En Sepolia/Base Sepolia tarda ~12-15s.
      const receipt = await waitForTransactionReceipt(config, { hash: txHash });
      return receipt.transactionHash;
    },
    [config, ensureAddress, account]
  );

  return {
    address: contractAddress,
    chainId,
    isDocumentStored,
    getDocumentCount,
    getDocumentHashByIndex,
    getDocumentInfo,
    verifyDocument,
    storeDocumentHash,
  };
}
