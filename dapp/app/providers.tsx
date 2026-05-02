"use client";
// Wrapper de Client Component que monta WagmiProvider + QueryClient + RainbowKit.
// Se importa desde el RootLayout (Server Component) — ese es el patron oficial
// de Next 16 para usar React Context (ver docs server-and-client-components.md).

import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import {
  RainbowKitProvider,
  darkTheme,
  lightTheme,
} from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import { config } from "@/lib/wagmi";
import { Toaster } from "@/components/ui/sonner";

import "@rainbow-me/rainbowkit/styles.css";

// Memoizamos los themes de RainbowKit a nivel de modulo para no instanciarlos
// en cada render del wrapper (son objetos pesados con muchos colores).
const RAINBOW_DARK = darkTheme();
const RAINBOW_LIGHT = lightTheme();

function RainbowKitThemed({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  return (
    <RainbowKitProvider
      theme={resolvedTheme === "dark" ? RAINBOW_DARK : RAINBOW_LIGHT}
    >
      {children}
    </RainbowKitProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  // Un QueryClient por mount del componente. useState con initializer evita
  // que se cree de nuevo en cada render. NO crear el client a nivel de modulo
  // porque se compartiria entre requests en SSR — fuente clasica de bugs.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitThemed>
            {children}
            <Toaster position="bottom-right" richColors closeButton />
          </RainbowKitThemed>
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  );
}
