"use client";

import { useCallback, useEffect, useState } from "react";
import { useChainId } from "wagmi";
import { useContract, type DocumentInfo } from "@/hooks/useContract";

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
      const total = Number(count); // count es bigint; lo convertimos a number para iterar

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
        <button
          onClick={load}
          disabled={loading || !contractAddress}
          className="px-3 py-1 text-xs rounded-md bg-gray-200 dark:bg-gray-700
                     hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
        >
          {loading ? "Cargando..." : "Recargar"}
        </button>
      </div>

      {!contractAddress && (
        <p className="text-sm text-amber-600">
          Cambia a Sepolia para ver el historial (chainId {chainId} no tiene
          contrato deployado).
        </p>
      )}

      {error && (
        <div className="text-sm bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 p-3 rounded-md text-red-800 dark:text-red-300">
          ✗ {error}
        </div>
      )}

      {!loading && !error && contractAddress && docs.length === 0 && (
        <p className="text-sm text-gray-500">
          No hay documentos registrados todavia.
        </p>
      )}

      {docs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="py-2 pr-3 font-semibold">Hash</th>
                <th className="py-2 pr-3 font-semibold">Signer</th>
                <th className="py-2 font-semibold">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
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
