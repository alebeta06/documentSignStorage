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
import { DocumentSigner } from "@/components/DocumentSigner";
import { DocumentVerifier } from "@/components/DocumentVerifier";
import { DocumentHistory } from "@/components/DocumentHistory";

type Tab = "sign" | "verify" | "history";

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("sign");

  // El estado del archivo a firmar vive aqui (en el padre) para que
  // FileUploader y DocumentSigner compartan la misma info.
  const [fileToSign, setFileToSign] = useState<FileWithHash | null>(null);

  return (
    <div className="flex flex-col flex-1 bg-background font-sans">
      <main className="w-full max-w-3xl mx-auto py-10 px-6 flex-1">
        {/* Header */}
        <header className="mb-8 space-y-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Document Sign Storage
            </h1>
            <p className="text-sm text-muted-foreground">
              Almacenamiento y verificacion de documentos sobre Ethereum
              (Sepolia + Base Sepolia).
            </p>
          </div>
          <ConnectButton showBalance={false} />
        </header>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)}>
          <TabsList className="mb-6">
            <TabsTrigger value="sign">Upload &amp; Sign</TabsTrigger>
            <TabsTrigger value="verify">Verify</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="sign">
            <Card>
              <CardHeader>
                <CardTitle>Firmar documento</CardTitle>
                <CardDescription>
                  Subi un archivo, firma su hash con tu wallet y registralo
                  on-chain.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FileUploader onFileHashed={setFileToSign} />
                <DocumentSigner fileWithHash={fileToSign} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="verify">
            <Card>
              <CardHeader>
                <CardTitle>Verificar documento</CardTitle>
                <CardDescription>
                  Subi el archivo original y comprobamos contra la blockchain
                  si fue alterado.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DocumentVerifier />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle>Historial</CardTitle>
                <CardDescription>
                  Documentos registrados en la chain activa.
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
