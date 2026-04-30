"use client";

import { useState } from "react";
import { useContract, type DocumentInfo } from "@/hooks/useContract";
import { FileUploader, type FileWithHash } from "./FileUploader";

type Result =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "not-found"; hash: string }
  | { kind: "found"; hash: string; info: DocumentInfo; signatureValid: boolean }
  | { kind: "error"; message: string };

export function DocumentVerifier() {
  const { isDocumentStored, getDocumentInfo, verifyDocument } = useContract();
  const [result, setResult] = useState<Result>({ kind: "idle" });

  async function handleFileHashed(data: FileWithHash | null) {
    if (!data) {
      setResult({ kind: "idle" });
      return;
    }

    setResult({ kind: "checking" });

    try {
      const exists = await isDocumentStored(data.hash);
      if (!exists) {
        setResult({ kind: "not-found", hash: data.hash });
        return;
      }

      const info = await getDocumentInfo(data.hash);
      // El contrato verifica internamente: ecrecover(digest, signature) == signer
      const signatureValid = await verifyDocument(
        data.hash,
        info.signer,
        info.signature
      );

      setResult({ kind: "found", hash: data.hash, info, signatureValid });
    } catch (err) {
      setResult({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="space-y-4">
      <FileUploader onFileHashed={handleFileHashed} />

      {result.kind === "checking" && (
        <p className="text-sm text-gray-500">Consultando blockchain...</p>
      )}

      {result.kind === "not-found" && (
        <div className="text-sm bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 p-3 rounded-md">
          <div className="font-semibold text-amber-800 dark:text-amber-300">
            Documento no registrado
          </div>
          <div className="text-xs text-amber-700 dark:text-amber-400 mt-1">
            Este archivo no existe on-chain. Quizá fue alterado, o nunca se registró.
          </div>
        </div>
      )}

      {result.kind === "found" && (
        <div
          className={`text-sm border p-3 rounded-md space-y-2 ${
            result.signatureValid
              ? "bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800"
              : "bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800"
          }`}
        >
          <div
            className={`font-semibold ${
              result.signatureValid
                ? "text-green-800 dark:text-green-300"
                : "text-red-800 dark:text-red-300"
            }`}
          >
            {result.signatureValid
              ? "✓ Documento auténtico"
              : "✗ Firma inválida"}
          </div>
          <dl className="text-xs space-y-1">
            <div className="flex flex-col">
              <dt className="font-semibold">Firmado por:</dt>
              <dd className="font-mono break-all">{result.info.signer}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="font-semibold">Registrado:</dt>
              <dd>
                {new Date(Number(result.info.timestamp) * 1000).toLocaleString()}
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="font-semibold">Hash:</dt>
              <dd className="font-mono break-all">{result.hash}</dd>
            </div>
          </dl>
        </div>
      )}

      {result.kind === "error" && (
        <div className="text-sm bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 p-3 rounded-md text-red-800 dark:text-red-300">
          ✗ {result.message}
        </div>
      )}
    </div>
  );
}
