"use client";

import { useState } from "react";
import { keccak256, type Hex } from "viem";
import { Input } from "@/components/ui/input";

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
      <div className="space-y-2">
        <label htmlFor="file-input" className="block text-sm font-medium cursor-pointer">
          Archivo
        </label>
        <Input
          id="file-input"
          type="file"
          onChange={handleChange}
          disabled={busy}
          className="h-auto py-2 file:mr-3 cursor-pointer file:cursor-pointer"
        />
      </div>

      {busy && (
        <p className="text-sm text-muted-foreground">Calculando hash...</p>
      )}

      {fileName && hash && !busy && (
        <div className="text-xs space-y-1 bg-muted p-3 rounded-md">
          <div>
            <span className="font-semibold">Archivo:</span> {fileName}
          </div>
          <div className="break-all">
            <span className="font-semibold">keccak256:</span>{" "}
            <code className="font-mono text-foreground">{hash}</code>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
