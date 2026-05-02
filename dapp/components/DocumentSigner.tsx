"use client";

import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { BaseError, UserRejectedRequestError } from "viem";
import { toast } from "sonner";
import { useContract } from "@/hooks/useContract";
import { Button } from "@/components/ui/button";
import { getTxExplorer } from "@/lib/explorers";
import type { FileWithHash } from "./FileUploader";

interface Props {
  /** Archivo + hash producido por FileUploader. Null cuando no hay archivo aun. */
  fileWithHash: FileWithHash | null;
}

function parseError(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((err) => err instanceof UserRejectedRequestError)) {
      return "Firma rechazada en la wallet";
    }
    return e.shortMessage || e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export function DocumentSigner({ fileWithHash }: Props) {
  const { isConnected, address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const {
    storeDocumentHash,
    isDocumentStored,
    address: contractAddress,
    chainId,
  } = useContract();
  const [busy, setBusy] = useState(false);

  // El user puede estar conectado a una red sin DocumentRegistry deployado.
  const noContractOnThisChain = isConnected && !contractAddress;

  const disabled =
    !fileWithHash || !isConnected || noContractOnThisChain || busy;

  async function handleSign() {
    if (!fileWithHash || !address) return;

    const exists = await isDocumentStored(fileWithHash.hash).catch(() => false);
    if (exists) {
      toast.warning("Este documento ya esta registrado on-chain");
      return;
    }

    setBusy(true);
    const toastId = toast.loading("Firma con tu wallet...");

    try {
      // message: { raw: hash } le dice a viem que use los bytes del hash directamente
      // (no UTF-8 encoding del string). El prefijo EIP-191 lo agrega viem.
      const signature = await signMessageAsync({
        message: { raw: fileWithHash.hash },
      });

      toast.loading("Enviando transaccion (tarda ~15s)...", { id: toastId });
      const timestamp = BigInt(Math.floor(Date.now() / 1000));
      const txHash = await storeDocumentHash({
        hash: fileWithHash.hash,
        timestamp,
        signature,
        signer: address,
      });

      const explorer = getTxExplorer(chainId, txHash);
      toast.success("Documento registrado on-chain", {
        id: toastId,
        description: `tx: ${txHash.slice(0, 10)}…${txHash.slice(-8)}`,
        action: explorer
          ? {
              label: `Ver en ${explorer.name}`,
              onClick: () => window.open(explorer.url, "_blank"),
            }
          : undefined,
      });
    } catch (err) {
      toast.error(parseError(err), { id: toastId });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button onClick={handleSign} disabled={disabled} size="default">
        {busy ? "Procesando..." : "Firmar y registrar on-chain"}
      </Button>

      {!isConnected && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Conecta una wallet para poder firmar.
        </p>
      )}

      {noContractOnThisChain && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          La red activa (chainId {chainId}) no tiene el contrato deployado.
          Cambia a Sepolia o Base Sepolia desde el modal de RainbowKit.
        </p>
      )}

      {!fileWithHash && isConnected && !noContractOnThisChain && (
        <p className="text-xs text-muted-foreground">Subi un archivo primero.</p>
      )}
    </div>
  );
}
