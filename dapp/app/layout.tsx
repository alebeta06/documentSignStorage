import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { MetaMaskProvider } from "@/contexts/MetaMaskContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Document Sign Storage",
  description: "Almacena y verifica autenticidad de documentos sobre Ethereum",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // RootLayout queda como Server Component (default). Solo el MetaMaskProvider
  // es Client Component — el patrón recomendado en Next 16 (ver docs server-and-client-components).
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <MetaMaskProvider>{children}</MetaMaskProvider>
      </body>
    </html>
  );
}
