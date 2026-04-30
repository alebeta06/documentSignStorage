"use client";
// Esta página es Client Component porque usa useState (tabs) y consume
// el MetaMaskContext. La info se renderiza siempre del lado cliente —
// no tiene sentido pre-renderizar nada porque depende del estado de la wallet.

import { useState } from "react";
import { WalletSelector } from "@/components/WalletSelector";
import { FileUploader, type FileWithHash } from "@/components/FileUploader";
import { DocumentSigner } from "@/components/DocumentSigner";
import { DocumentVerifier } from "@/components/DocumentVerifier";
import { DocumentHistory } from "@/components/DocumentHistory";

type Tab = "sign" | "verify" | "history";

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("sign");

  // El estado del archivo a firmar vive aquí (en el padre) para que
  // FileUploader y DocumentSigner compartan la misma info.
  const [fileToSign, setFileToSign] = useState<FileWithHash | null>(null);

  return (
    <div className="flex flex-col flex-1 bg-zinc-50 dark:bg-zinc-950 font-sans">
      <main className="w-full max-w-3xl mx-auto py-10 px-6 flex-1">
        {/* Header */}
        <header className="mb-8 space-y-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Document Sign Storage
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Almacenamiento y verificación de documentos sobre Ethereum (Anvil local).
            </p>
          </div>
          <WalletSelector />
        </header>

        {/* Tabs */}
        <nav className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800 mb-6">
          <TabButton
            active={activeTab === "sign"}
            onClick={() => setActiveTab("sign")}
          >
            Upload &amp; Sign
          </TabButton>
          <TabButton
            active={activeTab === "verify"}
            onClick={() => setActiveTab("verify")}
          >
            Verify
          </TabButton>
          <TabButton
            active={activeTab === "history"}
            onClick={() => setActiveTab("history")}
          >
            History
          </TabButton>
        </nav>

        {/* Tab content */}
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-6">
          {activeTab === "sign" && (
            <div className="space-y-6">
              <FileUploader onFileHashed={setFileToSign} />
              <DocumentSigner fileWithHash={fileToSign} />
            </div>
          )}

          {activeTab === "verify" && <DocumentVerifier />}

          {activeTab === "history" && <DocumentHistory />}
        </section>
      </main>
    </div>
  );
}

// Helper interno para los botones de tab — no merece su propio archivo.
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-blue-600 text-blue-700 dark:text-blue-400"
          : "border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}
