# Walkthrough — Document Sign Storage

Recorrido del código pieza por pieza, pensado para repasar y estudiar después de haber construido el proyecto.

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
- [3. Deploy script](#3-deploy-script)
- [4. Frontend — `MetaMaskContext`](#4-frontend--metamaskcontext)
  - [4.1. Por qué `'use client'`](#41-por-qué-use-client)
  - [4.2. Derivación BIP-44 desde mnemonic](#42-derivación-bip-44-desde-mnemonic)
  - [4.3. `useMemo`, `useCallback` y por qué no recrear el provider](#43-usememo-usecallback-y-por-qué-no-recrear-el-provider)
  - [4.4. La diferencia entre wallet y signer](#44-la-diferencia-entre-wallet-y-signer)
- [5. Hook `useContract`](#5-hook-usecontract)
  - [5.1. Contract para lecturas vs Contract para escrituras](#51-contract-para-lecturas-vs-contract-para-escrituras)
  - [5.2. Tipos de ethers v6 que cambiaron desde v5](#52-tipos-de-ethers-v6-que-cambiaron-desde-v5)
- [6. Componentes](#6-componentes)
  - [6.1. `FileUploader` — keccak256 client-side](#61-fileuploader--keccak256-client-side)
  - [6.2. `DocumentSigner` — máquina de estados + bytes vs string](#62-documentsigner--máquina-de-estados--bytes-vs-string)
  - [6.3. `DocumentVerifier`](#63-documentverifier)
  - [6.4. `DocumentHistory` — `Promise.all` + `queueMicrotask`](#64-documenthistory--promiseall--queuemicrotask)
  - [6.5. `WalletSelector`](#65-walletselector)
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
3. **`emit` del event**: los logs van a un storage especial barato. El frontend puede suscribirse con `contract.on(...)` o consultarlos históricamente con `queryFilter`. Los campos `indexed` (hasta 3) permiten filtrar eficientemente: "todos los documentos firmados por `0xabc...`".

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

1. Cuando el frontend hace `signer.signMessage(hash)`, ethers internamente:
   - Le antepone el prefijo `"\x19Ethereum Signed Message:\n32"` al hash.
   - Vuelve a hashear ese conjunto con `keccak256` → resulta el "digest".
   - Firma el digest con ECDSA → produce `(r, s, v)` (65 bytes total).
2. Aquí en el contrato **reconstruimos exactamente ese mismo digest** (línea con `abi.encodePacked`).
3. Llamamos a `ecrecover` (función built-in del EVM) que toma `(digest, v, r, s)` y **recupera la dirección que firmó**.
4. Si esa dirección coincide con `_signer`, la firma es válida.

**Por qué el prefijo `"\x19Ethereum Signed Message"`**: es el standard EIP-191. Evita que un atacante te haga firmar un mensaje que parezca arbitrario pero en realidad sea una transacción válida. El prefijo asegura que un mensaje firmado por una wallet **nunca puede ser confundido** con una transacción.

**Inline assembly** (`mload`, `add`, `byte`): es la forma idiomática de splitear los 65 bytes de la firma en sus componentes `r`, `s`, `v`. La memoria en EVM tiene un offset de 32 bytes para el length-prefix de un `bytes`, por eso empezamos en `+32`.

| Bytes 0..31 | Bytes 32..63 | Byte 64 |
|-------------|--------------|---------|
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
const count = await contract.getDocumentCount();
for (let i = 0; i < count; i++) {
    const hash = await contract.getDocumentHashByIndex(i);
    const info = await contract.getDocumentInfo(hash);
}
```

**Optimización futura**: en lugar de iterar el array on-chain, indexar los events `DocumentStored` con `queryFilter`. Es más eficiente porque los logs son almacenamiento más barato y la consulta puede hacerse en un solo round-trip.

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

## 3. Deploy script

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

**Concepto clave**: `forge script` corre el contrato Solidity como un programa local. Por default solo simula. El cheatcode `vm.startBroadcast()` activa el "modo broadcast": las txs entre `start` y `stop` se firman con la `--private-key` pasada por flag y se **mandan realmente al nodo** indicado por `--rpc-url`.

> El log de `console.log` se ve en la simulación previa al broadcast. La address que aparece allí puede no coincidir con la del broadcast real (la simulación usa otro sender por default). Para obtener la address real, leer `sc/broadcast/Deploy.s.sol/31337/run-latest.json`.

---

## 4. Frontend — `MetaMaskContext`

### 4.1. Por qué `'use client'`

```tsx
"use client";
```

**Sin esa directiva**, Next.js trata el archivo como Server Component, y eso rompe inmediatamente porque:

- `createContext`, `useState`, `useEffect`, `useMemo` solo funcionan en cliente.
- `HDNodeWallet` necesita crypto del browser para firmar.
- React Context **no se soporta** en Server Components.

La directiva marca el archivo (y todo lo que importe) como Client Component. **Una vez puesta, no hace falta repetirla en cada componente hijo**.

### 4.2. Derivación BIP-44 desde mnemonic

```tsx
const wallets = useMemo(() => {
    const phrase = Mnemonic.fromPhrase(MNEMONIC);
    return Array.from({ length: WALLET_COUNT }, (_, i) =>
        HDNodeWallet.fromMnemonic(phrase, `m/44'/60'/0'/0/${i}`)
    );
}, []);
```

**BIP-39** define el formato del mnemonic (12 palabras de wordlist). **BIP-44** define el path de derivación: `m / purpose' / coin_type' / account' / change / address_index`.

- `purpose' = 44'` → BIP-44
- `coin_type' = 60'` → Ethereum (cada coin tiene su número en SLIP-44)
- `account' = 0'` → primera cuenta
- `change = 0` → external chain (la otra es 1, "internal" para change addresses, no se usa en ETH)
- `address_index = i` → 0..9 para las 10 wallets

Anvil usa exactamente este path por default. Por eso la wallet derivada en `i=0` con el mnemonic `"test test...junk"` da `0xf39Fd6e51aad88F6F4ce6aB8827279cfFFb92266` — la account `[0]` de Anvil, con 10000 ETH.

### 4.3. `useMemo`, `useCallback` y por qué no recrear el provider

```tsx
const provider = useMemo(() => new JsonRpcProvider(RPC_URL), []);
```

`useMemo(fn, deps)` ejecuta `fn` **una sola vez** (mientras `deps` no cambien) y memoiza el resultado. Sin esto, `new JsonRpcProvider(...)` se ejecutaría en cada render, abriendo conexiones nuevas y descartando las anteriores → memory leak + side effects raros.

`useCallback(fn, deps)` es lo mismo pero para funciones. La diferencia con definir la función inline es la **referencia estable**: si pasás la función a un componente hijo o como dep de un `useEffect`, no querés que cambie la referencia en cada render (porque dispararía el effect).

### 4.4. La diferencia entre wallet y signer

```tsx
const getSigner = useCallback((): HDNodeWallet | null => {
    if (walletIndex === null) return null;
    return wallets[walletIndex].connect(provider);
}, [walletIndex, wallets, provider]);
```

`HDNodeWallet` ya **es** un signer (extiende `Signer`). Pero por defecto **no está conectado a un provider**, por lo tanto:
- Puede firmar mensajes (`signMessage`, `signTypedData`).
- **NO puede mandar transacciones** (necesita el provider para consultar nonce, gasPrice, simular, etc.).

`.connect(provider)` devuelve una **nueva instancia** de wallet atada a ese provider. Es un patrón inmutable: `wallet.connect(p)` no muta `wallet`.

---

## 5. Hook `useContract`

### 5.1. Contract para lecturas vs Contract para escrituras

```tsx
// Lectura — solo necesita provider
const readContract = useMemo(
    () => new Contract(CONTRACT_ADDRESS, ABI, provider),
    [provider]
);

// Escritura — necesita el signer activo
const writeContract = new Contract(CONTRACT_ADDRESS, ABI, wallet);
const tx = await writeContract.storeDocumentHash(...);
const receipt = await tx.wait();
```

En ethers v6, **el último argumento del `Contract` constructor decide el modo**:
- Si es un `Provider` → solo funciones `view`/`pure`.
- Si es un `Signer` → puede mandar transacciones (también puede leer).

**Por qué armamos un `writeContract` nuevo en cada call**: porque el `signer` activo puede haber cambiado entre llamadas (el usuario cambió wallet en el dropdown). En v6, `contract.connect(newSigner)` devuelve un nuevo `Contract`.

**`tx.wait()`**: la primera promesa se resuelve cuando la tx se acepta en el mempool. `.wait()` resuelve cuando la tx **está incluida en un bloque** (en Anvil eso es instantáneo, en mainnet ~12 segundos por confirmación).

### 5.2. Tipos de ethers v6 que cambiaron desde v5

| Tipo Solidity | ethers v5 | ethers v6 |
|---------------|-----------|-----------|
| `uint256`     | `BigNumber` | `bigint` (nativo de JS) |
| `bytes32`, `bytes` | `string` hex | `string` hex (sin cambio) |
| `address`     | `string` | `string` (sin cambio) |
| `tuple` con names | array | objeto con índices Y nombres (`Result`) |

Ejemplo: `getDocumentInfo` devuelve un struct con 4 campos. En código:

```ts
const r = await readContract.getDocumentInfo(hash);
console.log(r.hash);       // funciona ✓
console.log(r.timestamp);  // funciona ✓ (es bigint, no BigNumber)
console.log(r[0]);         // también funciona ✓
console.log(r[1]);         // también funciona ✓
```

Lo "aplanamos" a un objeto plano nuestro (`DocumentInfo`) para que el resto del código no dependa del shape interno de ethers.

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
2. `new Uint8Array(buf)` → vista tipada de bytes. ethers acepta esto directamente.
3. `keccak256(bytes)` → string hex de 66 chars (`"0x" + 64 hex`).

**Punto importante**: el archivo NUNCA se sube a la blockchain. **Solo el hash**. Eso significa:
- Privacidad: el contenido no se revela.
- Costo: subir 32 bytes vs subir 5 MB es la diferencia entre $0.001 y $50.000.
- Si cambiás un solo bit del archivo, el hash cambia completamente (avalanche effect del hash).

### 6.2. `DocumentSigner` — máquina de estados + bytes vs string

```tsx
type Status =
    | { kind: "idle" }
    | { kind: "signing" }
    | { kind: "submitting" }
    | { kind: "done"; txHash: string }
    | { kind: "error"; message: string };
```

**Discriminated unions** en TypeScript: cada variante tiene un campo `kind` que determina qué otros campos existen. El compilador te obliga a chequear `kind` antes de acceder a `txHash` o `message`. Es la forma type-safe de modelar máquinas de estado.

**El bug clásico (bytes vs string)**:

```tsx
// MAL
const signature = await signMessage(hash);             // hash es string "0x..."
// → ethers firma "0xabc...123" tratándolo como TEXTO UTF-8 → 66 caracteres firmados

// BIEN
const signature = await signMessage(getBytes(hash));   // getBytes convierte hex → Uint8Array
// → ethers firma 32 bytes
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

### 6.4. `DocumentHistory` — `Promise.all` + `queueMicrotask`

```tsx
const promises = Array.from({ length: total }, async (_, i) => {
    const hash = await getDocumentHashByIndex(i);
    return getDocumentInfo(hash);
});
const results = await Promise.all(promises);
```

**Lectura paralela**: en lugar de `for (i = 0; i < total; i++) await ...` (secuencial, total × latencia), disparamos las N consultas en paralelo y esperamos a todas con `Promise.all`. En Anvil local (RTT < 1ms) la diferencia es invisible; en mainnet (~50ms RTT) baja un loop de 30 documentos de 1.5s a 50ms.

```tsx
useEffect(() => {
    queueMicrotask(load);
}, [load]);
```

**Por qué `queueMicrotask`**: React 19 introdujo la regla `react-hooks/set-state-in-effect` que prohíbe llamar `setState` sincrónicamente en el cuerpo de un `useEffect`. El motivo: causa cascading re-renders (re-render → re-effect → setState → re-render → ...). `queueMicrotask` defiere `load` un tick — sigue ejecutándose pronto, pero no en el body del effect.

### 6.5. `WalletSelector`

Es un `<select>` que lista las 10 wallets disponibles del context. Cuando cambia, llama a `connect(idx)` o `switchWallet(idx)` según haya o no conexión activa. La diferencia entre los dos es semántica (mismo efecto), pero la API expone los dos para que la UI lea claro.

---

## 7. Layout y página principal

### `app/layout.tsx`

Es **Server Component** (por default — sin `'use client'`). Inyecta el provider:

```tsx
export default function RootLayout({ children }) {
    return (
        <html>
            <body>
                <MetaMaskProvider>{children}</MetaMaskProvider>
            </body>
        </html>
    );
}
```

**Patrón recomendado en Next 16**: el layout queda como Server Component (más liviano, no envía JS extra al cliente), pero envuelve `{children}` con un Client Component que provee el context.

### `app/page.tsx`

Es **Client Component** (`'use client'` arriba). Mantiene state local: la tab activa y el archivo a firmar (compartido entre `FileUploader` y `DocumentSigner`).

**Por qué `fileToSign` vive en el padre**: porque dos hijos (`FileUploader` y `DocumentSigner`) necesitan referirse al mismo archivo. Si cada uno lo tuviera en su state, `DocumentSigner` no podría saber qué archivo subió `FileUploader`. Es el patrón clásico **lifting state up**.

---

## 8. Glosario rápido

| Término | Definición |
|---------|------------|
| **EVM** | Ethereum Virtual Machine. La máquina virtual donde corren los smart contracts. |
| **gas** | Unidad de costo computacional. Cada operación EVM cuesta gas. Las txs pagan en ETH (gas usado × gas price). |
| **mempool** | Pool de txs pendientes que aún no entraron en un bloque. |
| **nonce** | Contador por wallet que evita replay attacks. Cada tx debe incrementarlo en 1. |
| **keccak256** | Función de hash usada en Ethereum. Variante de SHA-3 (no es exactamente SHA-3 estándar). 32 bytes de output. |
| **ECDSA** | Elliptic Curve Digital Signature Algorithm. Lo que firma transacciones y mensajes en Ethereum (curva secp256k1). |
| **`ecrecover`** | Built-in del EVM. Recibe un digest y una firma `(v,r,s)` y devuelve la address que firmó. |
| **EIP-191** | Estándar del prefijo `"\x19Ethereum Signed Message:\n<len>"` para firmar mensajes arbitrarios sin riesgo de replay como tx. |
| **BIP-39** | Estándar del mnemonic de 12 (o 24) palabras. |
| **BIP-44** | Estándar del path de derivación HD (`m/44'/60'/0'/0/i`). |
| **chainId** | Identificador único de cada red. Mainnet=1, Sepolia=11155111, Anvil=31337. Previene replay cross-chain. |
| **RPC** | Remote Procedure Call. El protocolo HTTP-JSON con el que el frontend habla con un nodo Ethereum (`eth_call`, `eth_sendTransaction`, etc.). |
| **`view` / `pure`** | Funciones que no modifican estado. Son gratis si las llamás off-chain. `pure` además no lee storage. |
| **revert** | Cuando una tx falla, todos los cambios se deshacen. El gas usado hasta el fallo NO se devuelve. |
| **event / log** | Registros emitidos por contratos. Storage barato, no legible desde otro contrato pero sí off-chain. |
| **`indexed`** | Marca un campo de event para que sea filtrable en queries (hasta 3 por event). |
| **HD Wallet** | Hierarchical Deterministic Wallet. Una semilla genera infinitas wallets siguiendo un path. |
| **Server Component** (Next) | Renderiza en el servidor, NO envía JS al cliente. Default en App Router. |
| **Client Component** (Next) | Renderiza en el browser. Marcado con `'use client'`. Necesario para hooks, state, eventos. |
