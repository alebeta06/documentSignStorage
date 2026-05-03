"use client";
// Esta pagina es Client Component porque usa useState (tabs) y consume
// hooks de wagmi/RainbowKit. La info se renderiza siempre del lado cliente —
// no tiene sentido pre-renderizar nada porque depende del estado de la wallet.

import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { FileUploader, type FileWithHash } from "@/components/FileUploader";
import {
  DocumentSigner,
  type SignedInfo,
} from "@/components/DocumentSigner";
import { DocumentVerifier } from "@/components/DocumentVerifier";
import { DocumentHistory } from "@/components/DocumentHistory";
import { ChainBadge } from "@/components/ChainBadge";
import { ThemeToggle } from "@/components/ThemeToggle";

type Tab = "sign" | "verify" | "history";

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("sign");

  // El estado del archivo a firmar vive aqui (en el padre) para que
  // FileUploader y DocumentSigner compartan la misma info.
  const [fileToSign, setFileToSign] = useState<FileWithHash | null>(null);

  // signedInfo tambien vive aqui — asi sobrevive el unmount de DocumentSigner
  // cuando el usuario cambia de tab. Antes vivia local en DocumentSigner y
  // se perdia al cambiar de tab dejando "fileToSign" huerfano.
  const [signedInfo, setSignedInfo] = useState<SignedInfo | null>(null);

  // Key para forzar el remount del <FileUploader>. El <input type="file"> no
  // se puede limpiar programaticamente (security restriction del browser);
  // remontarlo es la unica forma confiable de resetearlo.
  const [uploaderKey, setUploaderKey] = useState(0);

  function handleFileHashed(data: FileWithHash | null) {
    setFileToSign(data);
    // Subir un archivo nuevo invalida la card de "registrado" anterior.
    if (data) setSignedInfo(null);
  }

  function handleSigned(info: SignedInfo) {
    setSignedInfo(info);
    setFileToSign(null);
    setUploaderKey((k) => k + 1);
  }

  return (
    <div className="flex flex-col flex-1 bg-background font-sans">
      <main className="w-full max-w-3xl mx-auto py-10 px-6 flex-1">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Document Sign Storage
            </h1>
            <p className="text-sm text-muted-foreground">
              Almacenamiento y verificación de documentos sobre Ethereum
              (Sepolia + Base Sepolia).
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ChainBadge />
            <ConnectButton showBalance={false} />
            <ThemeToggle />
          </div>
        </header>

        <Tabs defaultValue="sign" value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)} className="w-full flex flex-col items-center">
          <TabsList className="mb-8 flex h-auto w-fit mx-auto gap-2 p-1.5 rounded-xl bg-muted/60">
            <TabsTrigger className="px-6 py-2.5 text-sm sm:text-base rounded-lg" value="sign">Subir y firmar</TabsTrigger>
            <TabsTrigger className="px-6 py-2.5 text-sm sm:text-base rounded-lg" value="verify">Verificar</TabsTrigger>
            <TabsTrigger className="px-6 py-2.5 text-sm sm:text-base rounded-lg" value="history">Historial</TabsTrigger>
          </TabsList>

          <TabsContent value="sign" className="w-full">
            <Card>
              <CardHeader>
                <CardTitle>Firmar documento</CardTitle>
                <CardDescription>
                  Subí un archivo, firmá su hash con tu wallet y registralo
                  on-chain.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FileUploader key={uploaderKey} onFileHashed={handleFileHashed} />
                <DocumentSigner
                  fileWithHash={fileToSign}
                  signedInfo={signedInfo}
                  onSigned={handleSigned}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="verify" className="w-full">
            <Card>
              <CardHeader>
                <CardTitle>Verificar documento</CardTitle>
                <CardDescription>
                  Subí el archivo original y comprobamos contra la blockchain
                  si fue alterado.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DocumentVerifier />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="w-full">
            <Card>
              <CardHeader>
                <CardTitle>Historial</CardTitle>
                <CardDescription>
                  Documentos registrados en la red activa.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DocumentHistory />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
