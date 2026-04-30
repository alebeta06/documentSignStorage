"use client";
// Client-only: usa hooks de React + signer del context.

import { useMemo } from "react";
import { Contract, type ContractTransactionResponse } from "ethers";
import { useMetaMask } from "@/contexts/MetaMaskContext";
import { DocumentRegistryABI } from "@/lib/DocumentRegistryABI";

// La dirección sale de .env.local. Si no está, lanzamos un error claro
// para que el usuario sepa que falta correr el deploy + actualizar el .env.
const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? "";

// ─────────────────────────────────────────────────────────────
// TIPOS PÚBLICOS — la "shape" del Document que ve el frontend.
// ─────────────────────────────────────────────────────────────

export interface DocumentInfo {
  hash: string;       // bytes32 → "0x..." (66 chars: "0x" + 64 hex)
  timestamp: bigint;  // ethers v6 devuelve uint256 como bigint
  signer: string;     // address → "0x..." (42 chars)
  signature: string;  // bytes (65) → "0x..." (132 chars)
}

// ─────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────

/**
 * Hook que expone funciones tipadas del contrato.
 *
 * Lecturas: usan el provider compartido (no requieren wallet conectada).
 * Escrituras: usan el signer del MetaMaskContext (requieren wallet conectada).
 */
export function useContract() {
  const { provider, getSigner } = useMetaMask();

  // Verificación temprana: si no hay address en .env, fallar claro y temprano.
  if (!CONTRACT_ADDRESS || CONTRACT_ADDRESS === "0x0000000000000000000000000000000000000000") {
    // No tiramos error en runtime de render — solo lo logueamos.
    // Las funciones harán throw cuando se las invoque.
    if (typeof window !== "undefined") {
      console.warn(
        "[useContract] NEXT_PUBLIC_CONTRACT_ADDRESS no configurado. Deployá el contrato y actualizá .env.local."
      );
    }
  }

  // Instancia "read-only": el segundo arg es solo provider, no signer.
  // useMemo evita rearmarla en cada render.
  const readContract = useMemo(
    () => new Contract(CONTRACT_ADDRESS, DocumentRegistryABI, provider),
    [provider]
  );

  // ── Lecturas ──────────────────────────────────────────────

  const isDocumentStored = async (hash: string): Promise<boolean> => {
    return await readContract.isDocumentStored(hash);
  };

  const getDocumentCount = async (): Promise<bigint> => {
    return await readContract.getDocumentCount();
  };

  const getDocumentHashByIndex = async (index: bigint | number): Promise<string> => {
    return await readContract.getDocumentHashByIndex(index);
  };

  const getDocumentInfo = async (hash: string): Promise<DocumentInfo> => {
    // ethers devuelve un Result con acceso named — lo "aplanamos" a nuestro tipo
    // para que el resto del código no dependa del shape interno de ethers.
    const r = await readContract.getDocumentInfo(hash);
    return {
      hash: r.hash,
      timestamp: r.timestamp,
      signer: r.signer,
      signature: r.signature,
    };
  };

  const verifyDocument = async (
    hash: string,
    signer: string,
    signature: string
  ): Promise<boolean> => {
    return await readContract.verifyDocument(hash, signer, signature);
  };

  // ── Escrituras ────────────────────────────────────────────

  /**
   * Manda la tx storeDocumentHash y ESPERA la confirmación.
   * Devuelve el txHash una vez minado.
   */
  const storeDocumentHash = async (params: {
    hash: string;
    timestamp: bigint;
    signature: string;
    signer: string;
  }): Promise<string> => {
    const wallet = getSigner();
    if (!wallet) throw new Error("No wallet connected");

    // Conectamos un Contract NUEVO con el signer activo.
    // No reusamos readContract porque .connect() devuelve un nuevo Contract en v6.
    const writeContract = new Contract(
      CONTRACT_ADDRESS,
      DocumentRegistryABI,
      wallet
    );

    const tx = (await writeContract.storeDocumentHash(
      params.hash,
      params.timestamp,
      params.signature,
      params.signer
    )) as ContractTransactionResponse;

    // .wait() resuelve cuando la tx queda incluida en un bloque.
    // En Anvil esto es básicamente instantáneo.
    const receipt = await tx.wait();
    return receipt?.hash ?? tx.hash;
  };

  return {
    // metadata
    address: CONTRACT_ADDRESS,
    // lecturas
    isDocumentStored,
    getDocumentCount,
    getDocumentHashByIndex,
    getDocumentInfo,
    verifyDocument,
    // escrituras
    storeDocumentHash,
  };
}
