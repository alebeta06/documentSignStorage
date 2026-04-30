"use client";

import { useState } from "react";
import { getBytes } from "ethers";
import { useMetaMask } from "@/contexts/MetaMaskContext";
import { useContract } from "@/hooks/useContract";
import type { FileWithHash } from "./FileUploader";

interface Props {
  /** Archivo + hash producido por FileUploader. Null cuando no hay archivo aún. */
  fileWithHash: FileWithHash | null;
}

// Estados del flujo:
//  - idle: esperando acción del usuario.
//  - signing: la wallet está firmando el hash.
//  - submitting: la tx fue enviada y esperamos confirmación on-chain.
//  - done: tx confirmada.
//  - error: algo falló.
type Status =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "submitting" }
  | { kind: "done"; txHash: string }
  | { kind: "error"; message: string };

export function DocumentSigner({ fileWithHash }: Props) {
  const { isConnected, address, signMessage } = useMetaMask();
  const { storeDocumentHash, isDocumentStored } = useContract();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const disabled =
    !fileWithHash ||
    !isConnected ||
    status.kind === "signing" ||
    status.kind === "submitting";

  async function handleSign() {
    if (!fileWithHash || !address) return;
    setStatus({ kind: "idle" });

    try {
      // 0) Pre-check: ¿este hash ya existe? Evita la tx revertida (ahorra gas y UX).
      const exists = await isDocumentStored(fileWithHash.hash);
      if (exists) {
        setStatus({
          kind: "error",
          message: "Este documento ya está registrado on-chain",
        });
        return;
      }

      // 1) Firmar.
      // Pasamos el hash COMO BYTES (Uint8Array de 32). Si pasáramos el string "0x..."
      // ethers lo trataría como un mensaje de texto y firmaría su UTF-8 — eso rompería
      // la verificación porque el contrato hashea bytes32, no la cadena hexadecimal.
      // getBytes("0x...") convierte el hex a Uint8Array.
      setStatus({ kind: "signing" });
      const signature = await signMessage(getBytes(fileWithHash.hash));

      // 2) Mandar la tx.
      setStatus({ kind: "submitting" });
      const timestamp = BigInt(Math.floor(Date.now() / 1000));
      const txHash = await storeDocumentHash({
        hash: fileWithHash.hash,
        timestamp,
        signature,
        signer: address,
      });

      setStatus({ kind: "done", txHash });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={handleSign}
        disabled={disabled}
        className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm
                   hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status.kind === "signing" && "Firmando..."}
        {status.kind === "submitting" && "Enviando transacción..."}
        {(status.kind === "idle" ||
          status.kind === "done" ||
          status.kind === "error") &&
          "Firmar y registrar on-chain"}
      </button>

      {!isConnected && (
        <p className="text-xs text-amber-600">
          Conectá una wallet para poder firmar.
        </p>
      )}

      {!fileWithHash && isConnected && (
        <p className="text-xs text-gray-500">
          Subí un archivo primero.
        </p>
      )}

      {status.kind === "done" && (
        <div className="text-sm bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 p-3 rounded-md">
          <div className="font-semibold text-green-800 dark:text-green-300">
            ✓ Documento registrado
          </div>
          <div className="text-xs text-green-700 dark:text-green-400 break-all mt-1">
            tx: <code>{status.txHash}</code>
          </div>
        </div>
      )}

      {status.kind === "error" && (
        <div className="text-sm bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 p-3 rounded-md text-red-800 dark:text-red-300">
          ✗ {status.message}
        </div>
      )}
    </div>
  );
}
