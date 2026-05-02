"use client";

import { useCallback, useEffect, useState } from "react";
import { useChainId } from "wagmi";
import { useContract, type DocumentInfo } from "@/hooks/useContract";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_ROWS = 3;

export function DocumentHistory() {
  const chainId = useChainId();
  const {
    getDocumentCount,
    getDocumentHashByIndex,
    getDocumentInfo,
    address: contractAddress,
  } = useContract();

  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // useCallback para que la referencia sea estable entre renders —
  // si no, el useEffect dispararia en bucle.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDocs([]);
    try {
      const count = await getDocumentCount();
      const total = Number(count);

      // Lecturas en paralelo. Promise.all es safe porque son lecturas RPC
      // independientes. En mainnet con muchos docs convendria batching/limits.
      const promises = Array.from({ length: total }, async (_, i) => {
        const hash = await getDocumentHashByIndex(i);
        return getDocumentInfo(hash);
      });

      const results = await Promise.all(promises);
      setDocs(results.reverse()); // mas recientes arriba
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractAddress, chainId]);
  // Recargamos cuando cambia el contrato/chain. Las funciones del hook se
  // omiten porque useContract devuelve refs nuevas en cada render — meterlas
  // causaria loops. Su efecto siempre apunta al contrato actual.

  useEffect(() => {
    if (!contractAddress) return;
    // queueMicrotask defiere `load` un tick — evita la regla
    // react-hooks/set-state-in-effect (React 19) que prohibe llamar setState
    // sincronicamente en el cuerpo del effect.
    queueMicrotask(load);
  }, [load, contractAddress]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Historial on-chain</h3>
        <Button
          onClick={load}
          disabled={loading || !contractAddress}
          variant="secondary"
          size="sm"
        >
          {loading ? "Cargando..." : "Recargar"}
        </Button>
      </div>

      {!contractAddress && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          Cambia a Sepolia o Base Sepolia para ver el historial (chainId{" "}
          {chainId} no tiene contrato deployado).
        </p>
      )}

      {error && (
        <div className="text-sm bg-destructive/10 border border-destructive/30 p-3 rounded-md text-destructive">
          ✗ {error}
        </div>
      )}

      {loading && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left border-b border-border">
              <tr>
                <th className="py-2 pr-3 font-semibold">Hash</th>
                <th className="py-2 pr-3 font-semibold">Signer</th>
                <th className="py-2 font-semibold">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <tr key={i}>
                  <td className="py-2 pr-3">
                    <Skeleton className="h-4 w-40" />
                  </td>
                  <td className="py-2 pr-3">
                    <Skeleton className="h-4 w-24" />
                  </td>
                  <td className="py-2">
                    <Skeleton className="h-4 w-32" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && contractAddress && docs.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No hay documentos registrados todavia.
        </p>
      )}

      {!loading && docs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left border-b border-border">
              <tr>
                <th className="py-2 pr-3 font-semibold">Hash</th>
                <th className="py-2 pr-3 font-semibold">Signer</th>
                <th className="py-2 font-semibold">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {docs.map((d) => (
                <tr key={d.hash}>
                  <td
                    className="py-2 pr-3 font-mono break-all max-w-xs truncate"
                    title={d.hash}
                  >
                    {d.hash.slice(0, 10)}…{d.hash.slice(-8)}
                  </td>
                  <td
                    className="py-2 pr-3 font-mono break-all max-w-xs"
                    title={d.signer}
                  >
                    {d.signer.slice(0, 6)}…{d.signer.slice(-4)}
                  </td>
                  <td className="py-2">
                    {new Date(Number(d.timestamp) * 1000).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
