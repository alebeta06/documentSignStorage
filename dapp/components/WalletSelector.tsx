"use client";

import { useMetaMask } from "@/contexts/MetaMaskContext";

/**
 * Dropdown que lista las 10 wallets derivadas y permite cambiar la activa.
 * Si no hay ninguna conectada, muestra "Conectar wallet".
 */
export function WalletSelector() {
  const {
    walletIndex,
    address,
    isConnected,
    availableWallets,
    connect,
    disconnect,
    switchWallet,
  } = useMetaMask();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    if (value === "") {
      // user re-seleccionó la opción "Seleccioná una wallet"
      disconnect();
      return;
    }
    const idx = Number(value);
    if (isConnected) switchWallet(idx);
    else connect(idx);
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <select
        value={walletIndex ?? ""}
        onChange={handleChange}
        className="text-sm rounded-md border border-gray-300 dark:border-gray-700
                   bg-white dark:bg-gray-900 px-3 py-2 max-w-full"
      >
        <option value="">— Seleccionar wallet —</option>
        {availableWallets.map((w) => (
          <option key={w.index} value={w.index}>
            #{w.index} · {w.address.slice(0, 6)}…{w.address.slice(-4)}
          </option>
        ))}
      </select>

      {isConnected && address && (
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono text-gray-600 dark:text-gray-400 break-all">
            {address}
          </span>
          <button
            onClick={disconnect}
            className="px-2 py-1 rounded-md bg-gray-200 dark:bg-gray-700
                       hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            Desconectar
          </button>
        </div>
      )}
    </div>
  );
}
