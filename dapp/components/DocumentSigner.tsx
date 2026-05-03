"use client";

import { useState } from "react";
import { useAccount, useChains, useSignMessage } from "wagmi";
import { BaseError, UserRejectedRequestError } from "viem";
import { toast } from "sonner";
import { useContract } from "@/hooks/useContract";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentSigner({ fileWithHash }: Props) {
  const { isConnected, address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const chains = useChains();
  const {
    storeDocumentHash,
    isDocumentStored,
    address: contractAddress,
    chainId,
  } = useContract();
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [signedInfo, setSignedInfo] = useState<{
    hash: string;
    signer: string;
    timestamp: bigint;
  } | null>(null);

  const [prevHash, setPrevHash] = useState<string | null>(null);

  const currentHash = fileWithHash?.hash ?? null;
  if (currentHash !== prevHash) {
    setPrevHash(currentHash);
    setSignedInfo(null);
  }

  // El user puede estar conectado a una red sin DocumentRegistry deployado.
  const noContractOnThisChain = isConnected && !contractAddress;

  const disabled =
    !fileWithHash || !isConnected || noContractOnThisChain || busy;

  const currentChain = chains.find((c) => c.id === chainId);

  async function handleConfirm() {
    setDialogOpen(false);
    await handleSign();
  }

  async function handleSign() {
    if (!fileWithHash || !address) return;

    const exists = await isDocumentStored(fileWithHash.hash).catch(() => false);
    if (exists) {
      toast.warning("Este documento ya está registrado on-chain");
      return;
    }

    setBusy(true);
    const toastId = toast.loading("Firmá con tu wallet...");

    try {
      // message: { raw: hash } le dice a viem que use los bytes del hash directamente
      // (no UTF-8 encoding del string). El prefijo EIP-191 lo agrega viem.
      const signature = await signMessageAsync({
        message: { raw: fileWithHash.hash },
      });

      toast.loading("Enviando transacción (tarda ~15 s)...", { id: toastId });
      const timestamp = BigInt(Math.floor(Date.now() / 1000));
      const txHash = await storeDocumentHash({
        hash: fileWithHash.hash,
        timestamp,
        signature,
        signer: address,
      });

      setSignedInfo({
        hash: fileWithHash.hash,
        signer: address,
        timestamp,
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
    <div className="space-y-3 mt-4">
      {signedInfo ? (
        <div className="text-sm bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-900 p-4 rounded-md space-y-2">
          <div className="font-semibold text-green-800 dark:text-green-300">
            ✓ Documento registrado exitosamente
          </div>
          <dl className="text-xs space-y-1">
            <div className="flex flex-col">
              <dt className="font-semibold">Firmado por:</dt>
              <dd className="font-mono break-all">{signedInfo.signer}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="font-semibold">Registrado:</dt>
              <dd>
                {new Date(Number(signedInfo.timestamp) * 1000).toLocaleString()}
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="font-semibold">Hash:</dt>
              <dd className="font-mono break-all">{signedInfo.hash}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <Button
          onClick={() => setDialogOpen(true)}
          disabled={disabled}
          size="default"
        >
          {busy ? "Procesando..." : "Firmar y registrar on-chain"}
        </Button>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar firma</DialogTitle>
            <DialogDescription>
              Vas a registrar este documento on-chain. La operación no se puede
              deshacer.
            </DialogDescription>
          </DialogHeader>

          {fileWithHash && (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Archivo
                </dt>
                <dd className="font-medium mt-1 break-all">
                  {fileWithHash.file.name}{" "}
                  <span className="text-muted-foreground font-normal">
                    ({formatBytes(fileWithHash.file.size)})
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Hash (keccak256)
                </dt>
                <dd className="font-mono text-xs break-all mt-1">
                  {fileWithHash.hash}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Red
                </dt>
                <dd className="font-medium mt-1">
                  {currentChain?.name ?? `chainId ${chainId}`}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Firmando como
                </dt>
                <dd className="font-mono text-xs break-all mt-1">{address}</dd>
              </div>
            </dl>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancelar</Button>} />
            <Button onClick={handleConfirm}>Sí, firmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!isConnected && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Conectá una wallet para poder firmar.
        </p>
      )}

      {noContractOnThisChain && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          La red activa (chainId {chainId}) no tiene el contrato deployado.
          Cambiá a Sepolia o Base Sepolia desde el modal de RainbowKit.
        </p>
      )}

      {!fileWithHash && isConnected && !noContractOnThisChain && (
        <p className="text-xs text-muted-foreground">Subí un archivo primero.</p>
      )}
    </div>
  );
}
