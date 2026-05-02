"use client";

import { useState } from "react";
import { keccak256, type Hex } from "viem";

export interface FileWithHash {
  file: File;
  hash: Hex; // "0x..." (66 chars)
}

interface Props {
  /** Callback que recibe el archivo + su hash cuando el usuario selecciona uno. */
  onFileHashed: (data: FileWithHash | null) => void;
}

/**
 * Input de archivo + calculo de keccak256 del lado cliente.
 *
 * El archivo NUNCA se sube — solo su hash. Eso es lo que persistimos on-chain.
 * Si cambias un solo byte del archivo, el hash cambia y la verificacion falla.
 */
export function FileUploader({ onFileHashed }: Props) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [hash, setHash] = useState<Hex | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setError(null);

    if (!file) {
      setFileName(null);
      setHash(null);
      onFileHashed(null);
      return;
    }

    setBusy(true);
    setFileName(file.name);

    try {
      // 1) leer el archivo como ArrayBuffer (binary)
      const buf = await file.arrayBuffer();
      // 2) convertirlo a Uint8Array (formato que viem acepta para hashear)
      const bytes = new Uint8Array(buf);
      // 3) keccak256 → Hex "0x..." de 66 chars
      const computedHash = keccak256(bytes);

      setHash(computedHash);
      onFileHashed({ file, hash: computedHash });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al leer el archivo");
      setFileName(null);
      setHash(null);
      onFileHashed(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="block text-sm font-medium mb-2">Archivo</span>
        <input
          type="file"
          onChange={handleChange}
          disabled={busy}
          className="block w-full text-sm
                     file:mr-4 file:py-2 file:px-4
                     file:rounded-md file:border-0
                     file:bg-blue-600 file:text-white
                     file:cursor-pointer hover:file:bg-blue-700
                     disabled:opacity-50"
        />
      </label>

      {busy && (
        <p className="text-sm text-gray-500">Calculando hash...</p>
      )}

      {fileName && hash && !busy && (
        <div className="text-xs space-y-1 bg-gray-50 dark:bg-gray-800 p-3 rounded-md">
          <div>
            <span className="font-semibold">Archivo:</span> {fileName}
          </div>
          <div className="break-all">
            <span className="font-semibold">keccak256:</span>{" "}
            <code className="text-blue-700 dark:text-blue-400">{hash}</code>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
