"use client";
// Esta directiva debe ir SIEMPRE primera. Marca el archivo (y todo lo que importa)
// como Client Component — corre en el browser. Necesario porque:
//   - Usamos useState/useEffect (hooks de React).
//   - Usamos createContext (no soportado en Server Components).
//   - ethers.HDNodeWallet usa crypto del browser para firmar.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { HDNodeWallet, JsonRpcProvider, Mnemonic } from "ethers";

// ─────────────────────────────────────────────────────────────
// CONFIGURACIÓN — se lee de .env.local en build time
// ─────────────────────────────────────────────────────────────

const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "http://localhost:8545";

const MNEMONIC =
  process.env.NEXT_PUBLIC_MNEMONIC ??
  "test test test test test test test test test test test junk";

// Cuántas wallets derivamos del mnemonic (Anvil arranca con 10).
const WALLET_COUNT = 10;

// Path BIP-44 para Ethereum: m / 44' / 60' / 0' / 0 / index
// (purpose'=44, coin_type'=60 (ETH), account'=0, change=0, address_index=i)
const DERIVATION_PATH = (i: number) => `m/44'/60'/0'/0/${i}`;

// ─────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────

export interface AvailableWallet {
  index: number;
  address: string;
}

interface MetaMaskContextValue {
  /** Índice de la wallet activa, o null si no hay ninguna conectada. */
  walletIndex: number | null;
  /** Dirección de la wallet activa (`0x...`), o null. */
  address: string | null;
  /** Atajo: hay una wallet activa? */
  isConnected: boolean;
  /** Las 10 wallets derivadas (para mostrar en el dropdown). */
  availableWallets: AvailableWallet[];
  /** Provider compartido — read-only, lo usa cualquier consulta on-chain. */
  provider: JsonRpcProvider;

  /** Conecta la wallet con índice `i` (0..WALLET_COUNT-1). */
  connect: (index: number) => void;
  /** Desconecta — vuelve a estado "sin wallet". */
  disconnect: () => void;
  /** Cambia a otra wallet. Equivalente a connect(index) cuando ya hay una conectada. */
  switchWallet: (index: number) => void;
  /** Devuelve el signer activo (HDNodeWallet ya conectado al provider) o null. */
  getSigner: () => HDNodeWallet | null;
  /** Firma un mensaje (texto o bytes) con la wallet activa. Lanza si no hay wallet. */
  signMessage: (message: string | Uint8Array) => Promise<string>;
}

// createContext con valor por defecto `null` — el provider obligatorio se chequea en useMetaMask.
const MetaMaskContext = createContext<MetaMaskContextValue | null>(null);

// ─────────────────────────────────────────────────────────────
// PROVIDER
// ─────────────────────────────────────────────────────────────

export function MetaMaskProvider({ children }: { children: ReactNode }) {
  // El JsonRpcProvider es estable durante toda la sesión —
  // useMemo evita recrearlo en cada render (cada instancia abre conexiones nuevas).
  const provider = useMemo(() => new JsonRpcProvider(RPC_URL), []);

  // Wallets derivadas: las calculamos una sola vez al montar el provider.
  // No las guardamos en state porque no cambian — son función pura del mnemonic.
  const wallets = useMemo(() => {
    const phrase = Mnemonic.fromPhrase(MNEMONIC);
    return Array.from({ length: WALLET_COUNT }, (_, i) =>
      // fromMnemonic recorre el path desde el mnemonic y devuelve el HDNodeWallet en esa hoja.
      HDNodeWallet.fromMnemonic(phrase, DERIVATION_PATH(i))
    );
  }, []);

  // Lista de pares {index, address} para mostrar en la UI (no expone private keys).
  const availableWallets: AvailableWallet[] = useMemo(
    () => wallets.map((w, i) => ({ index: i, address: w.address })),
    [wallets]
  );

  // Estado: cuál wallet está activa. null = ninguna.
  const [walletIndex, setWalletIndex] = useState<number | null>(null);

  // ── Acciones ────────────────────────────────────────────────
  // Las envolvemos en useCallback para que su referencia sea estable
  // entre renders (importante cuando se pasan a children que pueden depender de ellas).

  const connect = useCallback(
    (index: number) => {
      if (index < 0 || index >= WALLET_COUNT) {
        throw new Error(
          `Wallet index out of range: ${index} (valid 0..${WALLET_COUNT - 1})`
        );
      }
      setWalletIndex(index);
    },
    []
  );

  const disconnect = useCallback(() => setWalletIndex(null), []);

  // switchWallet es semánticamente igual a connect — los exponemos como dos nombres
  // porque la UI lee mejor: "connect" en el primer login, "switchWallet" en el dropdown.
  const switchWallet = useCallback(
    (index: number) => connect(index),
    [connect]
  );

  const getSigner = useCallback((): HDNodeWallet | null => {
    if (walletIndex === null) return null;
    // .connect(provider) devuelve un wallet ATADO al provider — listo para mandar txs.
    // OJO: HDNodeWallet.connect() devuelve una nueva instancia, no muta la original.
    return wallets[walletIndex].connect(provider);
  }, [walletIndex, wallets, provider]);

  const signMessage = useCallback(
    async (message: string | Uint8Array): Promise<string> => {
      const signer = getSigner();
      if (!signer) throw new Error("No wallet connected");
      // ethers.signMessage añade el prefijo "\x19Ethereum Signed Message:\n<len>"
      // ANTES de firmar — exactamente lo mismo que reconstruimos en el contrato.
      return signer.signMessage(message);
    },
    [getSigner]
  );

  // Al cambiar wallet podríamos querer limpiar caches o recargar saldos.
  // Por ahora solo logueamos en consola del browser para debugging.
  useEffect(() => {
    if (walletIndex !== null) {
      console.log(
        `[MetaMaskContext] connected to wallet[${walletIndex}] = ${wallets[walletIndex].address}`
      );
    }
  }, [walletIndex, wallets]);

  // El value que reciben los consumidores. useMemo lo memoiza para que
  // los componentes consumidores solo se re-rendericen cuando algo realmente cambie.
  const value: MetaMaskContextValue = useMemo(
    () => ({
      walletIndex,
      address: walletIndex !== null ? wallets[walletIndex].address : null,
      isConnected: walletIndex !== null,
      availableWallets,
      provider,
      connect,
      disconnect,
      switchWallet,
      getSigner,
      signMessage,
    }),
    [
      walletIndex,
      wallets,
      availableWallets,
      provider,
      connect,
      disconnect,
      switchWallet,
      getSigner,
      signMessage,
    ]
  );

  return (
    <MetaMaskContext.Provider value={value}>
      {children}
    </MetaMaskContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────
// HOOK CONSUMIDOR
// ─────────────────────────────────────────────────────────────

/**
 * Hook para consumir el context. Lanza si se usa fuera del provider —
 * eso ataja el bug clásico de "value is null" en runtime profundo.
 */
export function useMetaMask(): MetaMaskContextValue {
  const ctx = useContext(MetaMaskContext);
  if (!ctx) {
    throw new Error("useMetaMask must be used inside <MetaMaskProvider>");
  }
  return ctx;
}
