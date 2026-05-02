"use client";
// Wrapper de Client Component que monta WagmiProvider + QueryClient + RainbowKit.
// Se importa desde el RootLayout (Server Component) — ese es el patron oficial
// de Next 16 para usar React Context (ver docs server-and-client-components.md).

import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "@/lib/wagmi";
import { Toaster } from "@/components/ui/sonner";

import "@rainbow-me/rainbowkit/styles.css";

export function Providers({ children }: { children: ReactNode }) {
  // Un QueryClient por mount del componente. useState con initializer evita
  // que se cree de nuevo en cada render. NO crear el client a nivel de modulo
  // porque se compartiria entre requests en SSR — fuente clasica de bugs.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          {children}
          <Toaster position="bottom-right" richColors closeButton />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
