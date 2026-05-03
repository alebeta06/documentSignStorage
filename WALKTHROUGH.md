# Walkthrough — Document Sign Storage

Recorrido del código pieza por pieza, pensado para repasar y estudiar después de haber construido el proyecto. Asume que ya leíste el [README](./README.md) y entendés el flujo de alto nivel.

---

## Tabla de contenidos

- [1. Smart contract — `DocumentRegistry.sol`](#1-smart-contract--documentregistrysol)
  - [1.1. Storage y tipos](#11-storage-y-tipos)
  - [1.2. Modifiers](#12-modifiers)
  - [1.3. `storeDocumentHash`](#13-storedocumenthash)
  - [1.4. `verifyDocument` y ECDSA](#14-verifydocument-y-ecdsa)
  - [1.5. Getters de iteración](#15-getters-de-iteración)
- [2. Tests — Foundry cheatcodes](#2-tests--foundry-cheatcodes)
  - [2.1. `vm.sign`, `vm.addr`](#21-vmsign-vmaddr)
  - [2.2. `vm.expectRevert`, `vm.expectEmit`](#22-vmexpectrevert-vmexpectemit)
  - [2.3. Helper para firmar como `personal_sign`](#23-helper-para-firmar-como-personal_sign)
- [3. Deploy script y configuración multichain](#3-deploy-script-y-configuración-multichain)
- [4. Frontend — Providers (wagmi + RainbowKit + theming)](#4-frontend--providers-wagmi--rainbowkit--theming)
  - [4.1. La pirámide de providers](#41-la-pirámide-de-providers)
  - [4.2. wagmi config en `lib/wagmi.ts`](#42-wagmi-config-en-libwagmits)
  - [4.3. RainbowKit + dark mode coordinados](#43-rainbowkit--dark-mode-coordinados)
- [5. Hook `useContract` con wagmi/viem](#5-hook-usecontract-con-wagmiviem)
  - [5.1. `readContract` vs `writeContract` vs `waitForTransactionReceipt`](#51-readcontract-vs-writecontract-vs-waitfortransactionreceipt)
  - [5.2. Multichain: `getContractAddress(chainId)`](#52-multichain-getcontractaddresschainid)
  - [5.3. Tipos de viem (vs ethers)](#53-tipos-de-viem-vs-ethers)
- [6. Componentes](#6-componentes)
  - [6.1. `FileUploader` — keccak256 client-side](#61-fileuploader--keccak256-client-side)
  - [6.2. `DocumentSigner` — toasts + parseError + bytes vs string](#62-documentsigner--toasts--parseerror--bytes-vs-string)
  - [6.3. `DocumentVerifier`](#63-documentverifier)
  - [6.4. `DocumentHistory` — `Promise.all` + skeletons](#64-documenthistory--promiseall--skeletons)
  - [6.5. `ChainBadge` y `ThemeToggle`](#65-chainbadge-y-themetoggle)
- [7. Layout y página principal](#7-layout-y-página-principal)
- [8. Glosario rápido](#8-glosario-rápido)

---

## 1. Smart contract — `DocumentRegistry.sol`

### 1.1. Storage y tipos

```solidity
struct Document {
    bytes32 hash;       // keccak256 del archivo
    uint256 timestamp;  // momento UNIX
    address signer;     // wallet que firmó
    bytes signature;    // firma ECDSA de 65 bytes (r || s || v)
}

mapping(bytes32 => Document) private documents;
bytes32[] private documentHashes;
```

**Por qué dos estructuras**:

- `mapping` da lookup `O(1)` por hash. **Pero los mappings no son iterables** — no hay `keys()` en Solidity.
- El `array` `documentHashes` es para iteración: cuando la UI quiere mostrar el historial completo, recorre `getDocumentCount()` y llama `getDocumentHashByIndex(i)`.

**Por qué `bytes32` para el hash**: `keccak256` siempre devuelve 32 bytes. Usar `bytes32` (longitud fija) es **más barato en gas** que `bytes` (longitud dinámica) y le permite al EVM almacenarlo en una sola "slot" de storage.

**Por qué NO existe un campo `bool exists`**: la existencia se infiere de `documents[hash].signer != address(0)`. Razón: `address(0)` (la dirección cero) no es una wallet válida en la práctica, así que sirve como "valor centinela". Esto **ahorra una slot de storage** por documento (~20.000 gas en la primera escritura, ~5.000 en updates posteriores).

### 1.2. Modifiers

```solidity
modifier documentNotExists(bytes32 _hash) {
    require(documents[_hash].signer == address(0), "Document already exists");
    _;
}

modifier documentExists(bytes32 _hash) {
    require(documents[_hash].signer != address(0), "Document does not exist");
    _;
}
```

Los modifiers son funciones reutilizables que **inyectan código** alrededor del cuerpo de la función decorada. El `_;` es donde se "expande" el cuerpo de la función original.

Sintácticamente:

```solidity
function storeDocumentHash(...) external documentNotExists(_hash) { ... }
```

es equivalente a:

```solidity
function storeDocumentHash(...) external {
    require(documents[_hash].signer == address(0), "Document already exists");
    // ...cuerpo original aquí...
}
```

**Ventaja**: si la misma precondición aplica a 5 funciones, escribís el `require` una sola vez.

### 1.3. `storeDocumentHash`

```solidity
function storeDocumentHash(
    bytes32 _hash,
    uint256 _timestamp,
    bytes memory _signature,
    address _signer
) external documentNotExists(_hash) {
    require(_signer != address(0), "Invalid signer");
    require(_signature.length == 65, "Invalid signature length");

    documents[_hash] = Document({
        hash: _hash,
        timestamp: _timestamp,
        signer: _signer,
        signature: _signature
    });

    documentHashes.push(_hash);

    emit DocumentStored(_hash, _signer, _timestamp);
}
```

Cosas a destacar:

1. **Validaciones jerárquicas**: primero el modifier (existencia), después validaciones específicas (`signer` no cero, firma de 65 bytes). Si alguna falla, **se revierte todo** y el gas usado no se devuelve (excepto un pequeño refund).
2. **No verificamos la firma aquí** para ahorrar gas. La verificación se hace en `verifyDocument`. Trade-off: el contrato persiste, el verificador valida.
3. **`emit` del event**: los logs van a un storage especial barato. El frontend puede suscribirse o consultarlos históricamente. Los campos `indexed` (hasta 3) permiten filtrar eficientemente: "todos los documentos firmados por `0xabc...`".

### 1.4. `verifyDocument` y ECDSA

```solidity
function verifyDocument(
    bytes32 _hash,
    address _signer,
    bytes memory _signature
) external view returns (bool) {
    if (documents[_hash].signer == address(0)) return false;

    bytes32 ethSignedHash = keccak256(
        abi.encodePacked("\x19Ethereum Signed Message:\n32", _hash)
    );

    if (_signature.length != 65) return false;
    bytes32 r;
    bytes32 s;
    uint8 v;
    assembly {
        r := mload(add(_signature, 32))
        s := mload(add(_signature, 64))
        v := byte(0, mload(add(_signature, 96)))
    }

    address recovered = ecrecover(ethSignedHash, v, r, s);
    return recovered == _signer;
}
```

**Cómo funciona ECDSA en Ethereum**:

1. Cuando el frontend hace `signMessageAsync({ message: { raw: hash } })`, viem internamente:
   - Le antepone el prefijo `"\x19Ethereum Signed Message:\n32"` al hash.
   - Vuelve a hashear ese conjunto con `keccak256` → resulta el "digest".
   - Pide a la wallet firmar el digest con ECDSA → produce `(r, s, v)` (65 bytes total).
2. Aquí en el contrato **reconstruimos exactamente ese mismo digest** (línea con `abi.encodePacked`).
3. Llamamos a `ecrecover` (función built-in del EVM) que toma `(digest, v, r, s)` y **recupera la dirección que firmó**.
4. Si esa dirección coincide con `_signer`, la firma es válida.

**Por qué el prefijo `"\x19Ethereum Signed Message"`**: es el standard EIP-191. Evita que un atacante te haga firmar un mensaje que parezca arbitrario pero en realidad sea una transacción válida. El prefijo asegura que un mensaje firmado por una wallet **nunca puede ser confundido** con una transacción.

**Inline assembly** (`mload`, `add`, `byte`): es la forma idiomática de splitear los 65 bytes de la firma en sus componentes `r`, `s`, `v`. La memoria en EVM tiene un offset de 32 bytes para el length-prefix de un `bytes`, por eso empezamos en `+32`.

| Bytes 0..31 | Bytes 32..63 | Byte 64 |
|---|---|---|
| `r`         | `s`          | `v`     |

### 1.5. Getters de iteración

```solidity
function getDocumentCount() external view returns (uint256) {
    return documentHashes.length;
}

function getDocumentHashByIndex(uint256 _index) external view returns (bytes32) {
    require(_index < documentHashes.length, "Index out of bounds");
    return documentHashes[_index];
}
```

El frontend itera así:

```ts
const count = await getDocumentCount();
for (let i = 0; i < count; i++) {
  const hash = await getDocumentHashByIndex(i);
  const info = await getDocumentInfo(hash);
}
```

(En realidad usamos `Promise.all` para paralelizar — ver §6.4.)

**Optimización futura**: en lugar de iterar el array on-chain, indexar los events `DocumentStored` con un servicio off-chain (The Graph, Goldsky, Envio). Es más eficiente porque los logs son almacenamiento más barato y la consulta puede hacerse en un solo round-trip.

---

## 2. Tests — Foundry cheatcodes

### 2.1. `vm.sign`, `vm.addr`

```solidity
uint256 internal alicePk = 0xA11CE;
address internal alice;

function setUp() public {
    alice = vm.addr(alicePk);  // deriva la address desde la pk
}
```

Usamos **enteros como private keys de prueba**. Cualquier número en el rango de la curva secp256k1 es una pk válida. `vm.addr(pk)` deriva la address pública correspondiente. `vm.sign(pk, digest)` firma como si fueras esa wallet.

### 2.2. `vm.expectRevert`, `vm.expectEmit`

```solidity
vm.expectRevert(bytes("Document already exists"));
registry.storeDocumentHash(DOC_HASH, block.timestamp, sig, alice);
```

`expectRevert` declara que **la SIGUIENTE llamada DEBE revertir** con ese mensaje. Si la llamada NO revierte, el test falla. Si revierte con un mensaje distinto, también falla.

```solidity
vm.expectEmit(true, true, false, true);
emit DocumentStored(DOC_HASH, alice, block.timestamp);
registry.storeDocumentHash(DOC_HASH, block.timestamp, sig, alice);
```

`expectEmit(checkTopic1, checkTopic2, checkTopic3, checkData)`: declara qué event se espera. Los 4 booleanos indican qué partes del event chequear (los 3 topics indexados + el data). Después emitís un event "fantasma" con los valores esperados, y la siguiente call real debe emitir un event con esos mismos valores.

### 2.3. Helper para firmar como `personal_sign`

```solidity
function _signHash(uint256 _pk, bytes32 _hash)
    internal pure returns (bytes memory signature)
{
    bytes32 ethSignedHash = keccak256(
        abi.encodePacked("\x19Ethereum Signed Message:\n32", _hash)
    );
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(_pk, ethSignedHash);
    signature = abi.encodePacked(r, s, v);
}
```

**Importante**: el orden es `r || s || v`, no `v || r || s`. Es la convención del estándar EIP-191. Si los concatenás en otro orden, `ecrecover` devuelve una address aleatoria y la verificación falla silenciosamente.

---

## 3. Deploy script y configuración multichain

`script/Deploy.s.sol`:

```solidity
contract Deploy is Script {
    function run() external returns (DocumentRegistry registry) {
        vm.startBroadcast();
        registry = new DocumentRegistry();
        vm.stopBroadcast();
        console.log("DocumentRegistry deployed at:", address(registry));
    }
}
```

`forge script` corre el contrato Solidity como un programa local. Por default solo simula. El cheatcode `vm.startBroadcast()` activa el "modo broadcast": las txs entre `start` y `stop` se firman con la `--private-key` pasada por flag (o la del `.env`) y se **mandan realmente al nodo** indicado por `--rpc-url`.

`foundry.toml` define **aliases de redes** para no tener que escribir las URLs largas:

```toml
[rpc_endpoints]
sepolia      = "${SEPOLIA_RPC_URL}"
base_sepolia = "${BASE_SEPOLIA_RPC_URL}"

[etherscan]
sepolia      = { key = "${ETHERSCAN_API_KEY}", chain = 11155111 }
base_sepolia = { key = "${ETHERSCAN_API_KEY}", url = "https://api-sepolia.basescan.org/api", chain = 84532 }
```

Foundry expande las variables `${...}` desde `sc/.env` automáticamente. Eso te permite:

```bash
forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --verify
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
```

El `--verify` usa la sección `[etherscan]` para enviar el código fuente al explorer correspondiente. Si no hay `ETHERSCAN_API_KEY`, Foundry cae a Sourcify.

> La address deployada queda loggeada (`console.log`) y persistida en `sc/broadcast/Deploy.s.sol/<chainId>/run-latest.json` bajo `transactions[].contractAddress`. Esa es la dirección que hay que pegar en `dapp/lib/contracts.ts`.

---

## 4. Frontend — Providers (wagmi + RainbowKit + theming)

### 4.1. La pirámide de providers

`app/providers.tsx` arma el árbol de Context que el resto del frontend consume:

```tsx
<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
  <WagmiProvider config={config}>
    <QueryClientProvider client={queryClient}>
      <RainbowKitThemed>
        {children}
        <Toaster position="bottom-right" richColors closeButton />
      </RainbowKitThemed>
    </QueryClientProvider>
  </WagmiProvider>
</ThemeProvider>
```

**El orden importa**:

| Provider | Por qué va donde va |
|---|---|
| `ThemeProvider` (next-themes) | Outermost para que el wrapper de RainbowKit pueda usar `useTheme()` y elegir el theme correcto. |
| `WagmiProvider` | Provee la wagmi config (chains, transports, connectors) a todos los hooks `use*` de wagmi. |
| `QueryClientProvider` (TanStack Query) | wagmi v2 usa Query internamente para caching de lecturas onchain. **Debe envolver wagmi**. |
| `RainbowKitThemed` | Wrapper local que lee `resolvedTheme` y le pasa el theme correspondiente a `RainbowKitProvider`. |

**Por qué el `QueryClient` se crea con `useState(() => new QueryClient())`**: para tener una instancia por mount del componente. Crear el client a nivel de módulo lo compartiría entre requests en SSR — fuente clásica de bugs (un usuario ve datos cacheados de otro).

### 4.2. wagmi config en `lib/wagmi.ts`

```ts
import { http } from "wagmi";
import { sepolia, baseSepolia } from "wagmi/chains";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";

export const config = getDefaultConfig({
  appName: "Document Sign Storage",
  projectId,
  chains: [sepolia, baseSepolia],
  ssr: true,
  transports: {
    [sepolia.id]: http(),       // RPC público por default
    [baseSepolia.id]: http(),
  },
});
```

`getDefaultConfig` (de RainbowKit) arma una wagmi config con los **connectors estándar** preinstalados: injected/MetaMask, WalletConnect, Coinbase Wallet, Rainbow. Lo preferimos sobre `createConfig` propio porque la lista curada cubre el 95% de los casos sin tener que mantener nosotros la fauna de connectors.

`ssr: true` le dice a wagmi que somos una app de Next con render SSR; ajusta cookies/persistencia para no romper la hidratación.

`http()` sin URL usa el RPC público por default de cada chain. Para producción real se pasa `http("https://eth-sepolia.g.alchemy.com/v2/KEY")` para mejor rate limit.

**EIP-6963**: el connector "injected" de wagmi v2 implementa este standard, que reemplaza al viejo `window.ethereum` único. Si tenés MetaMask + Rainbow + Phantom instaladas a la vez, EIP-6963 las descubre todas y RainbowKit las muestra individualmente — antes solo aparecía la última en sobrescribir `window.ethereum`.

### 4.3. RainbowKit + dark mode coordinados

`next-themes` aplica una clase `.dark` o no en `<html>`. Tailwind reacciona a esa clase para cambiar nuestros colores. Pero RainbowKit es un componente externo que no usa nuestras CSS variables — necesita que le pasemos un theme manualmente.

```tsx
"use client";
import { useTheme } from "next-themes";
import { darkTheme, lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";

const RAINBOW_DARK = darkTheme();    // memoizados a nivel de modulo
const RAINBOW_LIGHT = lightTheme();  // (no recrear en cada render)

function RainbowKitThemed({ children }) {
  const { resolvedTheme } = useTheme();
  return (
    <RainbowKitProvider theme={resolvedTheme === "dark" ? RAINBOW_DARK : RAINBOW_LIGHT}>
      {children}
    </RainbowKitProvider>
  );
}
```

Durante SSR, `resolvedTheme` es `undefined` → cae al theme claro por default. Cuando next-themes hidrata en el cliente, re-renderiza con el theme correcto.

---

## 5. Hook `useContract` con wagmi/viem

### 5.1. `readContract` vs `writeContract` vs `waitForTransactionReceipt`

`hooks/useContract.ts` envuelve el contrato con una API tipo "async function" que devuelve datos planos. Internamente usa **acciones imperativas** de `@wagmi/core` en vez de los hooks reactivos de `wagmi/react`:

```ts
import { readContract, writeContract, waitForTransactionReceipt } from "@wagmi/core";
```

**Por qué imperativo y no `useReadContract` / `useWriteContract`**: los hooks reactivos están pensados para "read this and re-render when it changes". Nosotros queremos un patrón request/response (el usuario hace click → leo o escribo on demand → muestro el resultado). El equivalente imperativo es más natural para esto.

```ts
const isDocumentStored = useCallback(
  async (hash: Hex): Promise<boolean> =>
    readContract(config, {
      address: ensureAddress(),
      abi: DocumentRegistryABI,
      functionName: "isDocumentStored",
      args: [hash],
    }) as Promise<boolean>,
  [config, ensureAddress]
);
```

**`storeDocumentHash` es más rico**: hace el broadcast Y espera 1 confirmación:

```ts
const txHash = await writeContract(config, {
  address: ensureAddress(),
  abi: DocumentRegistryABI,
  functionName: "storeDocumentHash",
  args: [hash, timestamp, signature, signer],
});

const receipt = await waitForTransactionReceipt(config, { hash: txHash });
return receipt.transactionHash;
```

`writeContract` abre el popup de la wallet, el usuario firma, la tx queda en mempool y devuelve el `txHash`. `waitForTransactionReceipt` poolea el RPC hasta que la tx aparece en un bloque (en Sepolia/Base Sepolia tarda ~12-15s).

### 5.2. Multichain: `getContractAddress(chainId)`

```ts
const chainId = useChainId();
const contractAddress = getContractAddress(chainId);

const ensureAddress = useCallback((): Address => {
  if (!contractAddress) {
    throw new Error(`No DocumentRegistry deployado en chainId ${chainId}.`);
  }
  return contractAddress;
}, [contractAddress, chainId]);
```

`useChainId` te da la chain activa de la wallet conectada. `getContractAddress` (de `lib/contracts.ts`) hace el lookup en el mapping `chainId → address`. Si la chain activa no tiene contrato deployado, devuelve `undefined`.

Los componentes consumen `contractAddress` para decidir si pueden operar. `DocumentSigner` muestra un warning amarillo cuando es `undefined`. `DocumentHistory` no intenta cargar el listado.

### 5.3. Tipos de viem (vs ethers)

| Tipo Solidity | viem | ethers v6 (referencia) |
|---|---|---|
| `uint256` | `bigint` (nativo de JS) | `bigint` |
| `bytes32`, `bytes` | `` `0x${string}` `` (template literal type) | `string` hex |
| `address` | `` `0x${string}` `` | `string` |
| Hash de tx | `` `0x${string}` `` | `string` |
| `tuple` con names | objeto plano (TS infiere los nombres del ABI) | `Result` con índices Y nombres |

viem usa **template literal types** (`` `0x${string}` ``) que dan type-safety en compile time: no podés pasar un `string` arbitrario donde se espera un `Address`. Si te equivocás, TS te grita antes de runtime.

Para el ABI usamos el `DocumentRegistryABI` exportado en `lib/DocumentRegistryABI.ts` con `as const` — eso permite a viem inferir los tipos exactos de cada función (args, return values).

---

## 6. Componentes

### 6.1. `FileUploader` — keccak256 client-side

```tsx
const buf = await file.arrayBuffer();
const bytes = new Uint8Array(buf);
const computedHash = keccak256(bytes);
```

**Pipeline**:

1. `File.arrayBuffer()` → API web. Devuelve un `ArrayBuffer` (datos crudos del archivo).
2. `new Uint8Array(buf)` → vista tipada de bytes. viem acepta esto directamente.
3. `keccak256(bytes)` → string hex de 66 chars (`"0x" + 64 hex`), tipo `` `0x${string}` ``.

**Punto importante**: el archivo NUNCA se sube a la blockchain. **Solo el hash**. Eso significa:

- Privacidad: el contenido no se revela.
- Costo: subir 32 bytes vs subir 5 MB es la diferencia entre $0.001 y $50.000 (en mainnet).
- Si cambiás un solo bit del archivo, el hash cambia completamente (avalanche effect del hash).

### 6.2. `DocumentSigner` — Dialog de pre-firma + toasts + parseError + bytes vs string

**Confirmación previa (Dialog modal)**: antes de disparar el popup de la wallet, mostramos un Dialog con el resumen de lo que está por firmarse — nombre del archivo, tamaño, hash completo, red activa y address del signer. El usuario puede cancelar o confirmar.

```tsx
<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Confirmar firma</DialogTitle>
      <DialogDescription>
        Vas a registrar este documento on-chain. La operación no se puede deshacer.
      </DialogDescription>
    </DialogHeader>
    <dl>{/* archivo, hash, red, signer */}</dl>
    <DialogFooter>
      <DialogClose render={<Button variant="outline">Cancelar</Button>} />
      <Button onClick={handleConfirm}>Sí, firmar</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

Por qué importa: el popup de la wallet es chico y técnico (`Sign message: 0x4f2a…`). Un usuario que firma un documento legal o un diploma necesita pausar y revisar el contexto antes de comprometerse. Es el patrón estándar en dApps de DeFi (Uniswap, Aave): siempre hay un "Confirm" en la dApp **antes** del popup de la wallet.

Detalle de implementación: el Dialog es **controlado** con `open` + `onOpenChange`. El Button de "Firmar y registrar" abre el modal (`setDialogOpen(true)`); no llama a `handleSign` directo. La acción real se dispara desde el Button "Sí, firmar" del DialogFooter.

**Feedback de transacción con toasts de Sonner**. Un solo `toastId` que muta sus mensajes en cascada:

```tsx
const toastId = toast.loading("Firmá con tu wallet...");
try {
  const signature = await signMessageAsync({ message: { raw: fileWithHash.hash } });

  toast.loading("Enviando transacción (tarda ~15 s)...", { id: toastId });
  const txHash = await storeDocumentHash({ hash, timestamp, signature, signer });

  const explorer = getTxExplorer(chainId, txHash);
  toast.success("Documento registrado on-chain", {
    id: toastId,
    description: `tx: ${txHash.slice(0, 10)}…${txHash.slice(-8)}`,
    action: explorer ? { label: `Ver en ${explorer.name}`, onClick: () => window.open(explorer.url, "_blank") } : undefined,
  });
} catch (err) {
  toast.error(parseError(err), { id: toastId });
}
```

**Parser de errores con viem**: las excepciones de viem son objetos `BaseError` con jerarquía. `walk` recorre la cadena de causas:

```ts
function parseError(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((err) => err instanceof UserRejectedRequestError)) {
      return "Firma rechazada en la wallet";
    }
    return e.shortMessage || e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
```

Sin esto, el toast mostraría algo como `RpcRequestError: An error occurred when invoking the RPC method… Caused by: ContractFunctionExecutionError: ... Caused by: UserRejectedRequestError: User rejected the request.` (un párrafo). Con el parser: `"Firma rechazada en la wallet"`.

**El bug clásico (bytes vs string)**:

```tsx
// MAL
const signature = await signMessageAsync({ message: hash });
// → viem firma "0xabc...123" tratándolo como TEXTO UTF-8 → 66 caracteres firmados

// BIEN
const signature = await signMessageAsync({ message: { raw: hash } });
// → viem firma 32 bytes
```

El contrato hashea `bytes32`, no la cadena hexadecimal. Si firmás como texto, `ecrecover` devuelve una address aleatoria y `verifyDocument` retorna `false`. **Bug silencioso** que solo aparece cuando intentás verificar.

### 6.3. `DocumentVerifier`

Es un compose de `FileUploader` + lógica de lectura. Cuando el usuario sube un archivo:

1. `FileUploader` recalcula el `keccak256`.
2. Llamamos `isDocumentStored(hash)` → existe?
3. Si existe, llamamos `getDocumentInfo(hash)` → traemos el struct.
4. Llamamos `verifyDocument(hash, info.signer, info.signature)` → el contrato chequea con `ecrecover`.

Mostramos 3 estados:

- ✓ Documento auténtico.
- ✗ Firma inválida (existe pero la firma no corresponde — improbable pero posible si alguien guardó datos manipulados).
- "Documento no registrado" (el archivo fue alterado o nunca se firmó).

### 6.4. `DocumentHistory` — `Promise.all` + skeletons

```tsx
const promises = Array.from({ length: total }, async (_, i) => {
  const hash = await getDocumentHashByIndex(i);
  return getDocumentInfo(hash);
});
const results = await Promise.all(promises);
```

**Lectura paralela**: en lugar de `for (i = 0; i < total; i++) await ...` (secuencial, total × latencia), disparamos las N consultas en paralelo y esperamos a todas con `Promise.all`. En testnet (~100ms RTT al RPC público) eso baja un loop de 30 documentos de 6s a ~200ms.

**Skeleton rows mientras carga**:

```tsx
{loading && (
  <table>
    <tbody>
      {Array.from({ length: 3 }).map((_, i) => (
        <tr key={i}>
          <td><Skeleton className="h-4 w-40" /></td>
          <td><Skeleton className="h-4 w-24" /></td>
          <td><Skeleton className="h-4 w-32" /></td>
        </tr>
      ))}
    </tbody>
  </table>
)}
```

`<Skeleton>` (de shadcn) es solo un `<div>` con `animate-pulse rounded-md bg-muted`. Da la sensación de "algo está viniendo" sin layout shift cuando llegan los datos reales.

```tsx
useEffect(() => {
  queueMicrotask(load);
}, [load, contractAddress]);
```

**Por qué `queueMicrotask`**: React 19 introdujo la regla `react-hooks/set-state-in-effect` que prohíbe llamar `setState` sincrónicamente en el cuerpo de un `useEffect`. El motivo: causa cascading re-renders. `queueMicrotask` defiere `load` un tick — sigue ejecutándose pronto, pero no en el body del effect.

### 6.5. `ChainBadge` y `ThemeToggle`

**`ChainBadge`** lee `useChainId` + `useChains` (lista de chains configuradas en wagmi config) y muestra el nombre de la red. Si la chain activa no está soportada, muestra "Red no soportada" en variant destructive. Si no hay wallet conectada, no se renderiza.

```tsx
if (!isConnected) return null;
if (!isSupportedChain(chainId)) return <Badge variant="destructive">Red no soportada</Badge>;
const chain = chains.find((c) => c.id === chainId);
return <Badge variant="outline">{chain?.name}</Badge>;
```

**`ThemeToggle`** usa `useTheme` de next-themes. El detalle no obvio es el patrón **mounted state** para evitar hydration mismatch:

```tsx
const [mounted, setMounted] = useState(false);
useEffect(() => setMounted(true), []);
if (!mounted) return <Button variant="ghost" size="icon" disabled aria-hidden />;
```

Razón: durante SSR no sabemos si el usuario prefiere dark o light, así que `resolvedTheme` es `undefined`. Si renderizamos un ícono basado en eso, el server emite uno y el cliente otro → React tira warning de hydration mismatch. Renderizar un placeholder vacío hasta que el cliente hidrata evita el problema.

---

## 7. Layout y página principal

### `app/layout.tsx`

Es **Server Component** (default — sin `'use client'`). Inyecta el provider:

```tsx
export default function RootLayout({ children }) {
  return (
    <html lang="es" suppressHydrationWarning ...>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

**`suppressHydrationWarning`** en `<html>` es requisito de next-themes — la librería modifica `<html>` para agregar la clase `.dark` antes de que React hidrate, y sin esto React tiraría warning.

**Patrón recomendado en Next 16**: el layout queda como Server Component (más liviano, no envía JS extra al cliente), pero envuelve `{children}` con un Client Component que provee los contexts.

### `app/page.tsx`

Es **Client Component** (`'use client'` arriba). Mantiene state local: la tab activa y el archivo a firmar (compartido entre `FileUploader` y `DocumentSigner`).

```tsx
const [activeTab, setActiveTab] = useState<Tab>("sign");
const [fileToSign, setFileToSign] = useState<FileWithHash | null>(null);
```

**Por qué `fileToSign` vive en el padre**: porque dos hijos (`FileUploader` y `DocumentSigner`) necesitan referirse al mismo archivo. Si cada uno lo tuviera en su state, `DocumentSigner` no podría saber qué archivo subió `FileUploader`. Es el patrón clásico **lifting state up**.

El layout principal usa **shadcn primitives**:

- `<Tabs>` / `<TabsList>` / `<TabsTrigger>` / `<TabsContent>` para la navegación entre Subir / Verificar / Historial.
- `<Card>` por cada tab content, con su `<CardHeader>` / `<CardTitle>` / `<CardDescription>` / `<CardContent>`.
- `<ConnectButton>` de RainbowKit en el header, junto al `<ChainBadge />` y `<ThemeToggle />`.

---

## 8. Glosario rápido

### Conceptos de blockchain

| Término | Definición |
|---|---|
| **EVM** | Ethereum Virtual Machine. La máquina virtual donde corren los smart contracts. |
| **gas** | Unidad de costo computacional. Cada operación EVM cuesta gas. Las txs pagan en ETH (gas usado × gas price). |
| **mempool** | Pool de txs pendientes que aún no entraron en un bloque. |
| **nonce** | Contador por wallet que evita replay attacks. Cada tx debe incrementarlo en 1. |
| **keccak256** | Función de hash usada en Ethereum. Variante de SHA-3 (no es exactamente SHA-3 estándar). 32 bytes de output. |
| **ECDSA** | Elliptic Curve Digital Signature Algorithm. Lo que firma transacciones y mensajes en Ethereum (curva secp256k1). |
| **`ecrecover`** | Built-in del EVM. Recibe un digest y una firma `(v,r,s)` y devuelve la address que firmó. |
| **EIP-191** | Estándar del prefijo `"\x19Ethereum Signed Message:\n<len>"` para firmar mensajes arbitrarios sin riesgo de replay como tx. |
| **EIP-6963** | Standard de discovery de wallets en el navegador. Reemplaza al viejo `window.ethereum` único — permite que múltiples wallets coexistan. |
| **chainId** | Identificador único de cada red. Mainnet=1, Sepolia=11155111, Base Sepolia=84532. Previene replay cross-chain. |
| **L2** | Layer 2. Red que hereda seguridad de Ethereum L1 pero con tarifas más bajas (Arbitrum, Optimism, Base, zkSync). Base Sepolia es la testnet de Base. |
| **RPC** | Remote Procedure Call. El protocolo HTTP-JSON con el que el frontend habla con un nodo Ethereum (`eth_call`, `eth_sendTransaction`, etc.). |
| **`view` / `pure`** | Funciones que no modifican estado. Son gratis si las llamás off-chain. `pure` además no lee storage. |
| **revert** | Cuando una tx falla, todos los cambios se deshacen. El gas usado hasta el fallo NO se devuelve. |
| **event / log** | Registros emitidos por contratos. Storage barato, no legible desde otro contrato pero sí off-chain. |
| **`indexed`** | Marca un campo de event para que sea filtrable en queries (hasta 3 por event). |
| **block explorer** | UI web para inspeccionar txs, contratos, addresses (Etherscan, Basescan, Blockscout). |
| **faucet** | Servicio que regala ETH de testnet. Sin esto no podés mandar txs en Sepolia / Base Sepolia. |

### Stack del frontend

| Término | Definición |
|---|---|
| **wagmi v2** | Set de hooks de React + acciones imperativas para hablar con Ethereum. Reemplaza a ethers/web3.js como capa de abstracción. |
| **viem** | Cliente de bajo nivel debajo de wagmi. Hace la encoding/decoding de calls, manejo de RPCs, parsing de errores. Sucesor moderno de ethers. |
| **RainbowKit** | Componente listo para "Connect Wallet". Modal con MetaMask, Rainbow, Coinbase, WalletConnect, etc. Usa wagmi por debajo. |
| **WalletConnect / Reown** | Protocolo para conectar wallets móviles a dApps web vía QR. Requiere un projectId gratis en cloud.reown.com. |
| **TanStack Query** | Library de data fetching con caching, deduplicación, retries, stale-while-revalidate. wagmi v2 la usa internamente para cachear lecturas onchain. |
| **shadcn/ui** | "Anti-library" de componentes: copiás el código a tu repo (`components/ui/`) en vez de instalar una dep. Vos sos dueño del código. Built on Radix UI + Tailwind. |
| **Radix UI / Base UI** | Primitives accesibles (sin estilo) — manejan focus, teclado, ARIA. shadcn los estiliza con Tailwind. |
| **Tailwind 4** | Framework de utility-first CSS. La v4 mueve la config a CSS (`@theme inline`) y elimina el `tailwind.config.js`. |
| **Sonner** | Library de toasts moderna, con API minimalista. shadcn la usa como su sistema de notificaciones por default. |
| **next-themes** | Manejador de dark/light mode persistente en localStorage. Aplica una clase `.dark` en `<html>`. |
| **Server Component** (Next) | Renderiza en el servidor, NO envía JS al cliente. Default en App Router. |
| **Client Component** (Next) | Renderiza en el browser. Marcado con `'use client'`. Necesario para hooks, state, eventos. |
| **App Router** | El nuevo router de Next basado en filesystem dentro de `app/`. Reemplaza al viejo `pages/`. |

### Foundry

| Término | Definición |
|---|---|
| **forge** | Compilador + test runner + scripting de Foundry. |
| **cast** | CLI para hacer calls al RPC manualmente (read/write contratos, decodificar calldata, etc.). |
| **anvil** | Nodo local de desarrollo. Sucesor de Ganache, más rápido y minimal. |
| **cheatcodes** | Funciones especiales en tests (`vm.sign`, `vm.warp`, `vm.expectRevert`) que solo existen en Foundry. |
| **Sourcify** | Servicio de verificación de contratos descentralizado. Foundry lo usa como fallback cuando no hay `ETHERSCAN_API_KEY`. |
