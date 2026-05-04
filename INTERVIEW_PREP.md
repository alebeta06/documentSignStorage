# INTERVIEW_PREP — `documentSignStorage`

> Guía de preparación para entrevistas técnicas usando este repositorio como caso de estudio. El proyecto es una dApp para almacenar y verificar la autenticidad de documentos sobre Ethereum (`hash keccak256` + firma `ECDSA` + `timestamp` + `signer` on-chain).
>
> **Dos ramas, dos stacks distintos** — preguntas frecuentes sobre por qué existen las dos:
> - **`anvil-local`** — stack original: Solidity/Foundry + Next.js + `ethers.js v6` + Anvil local + wallets derivadas del mnemonic. Sin MetaMask.
> - **`testnet`** — stack actual (rama de producción en Vercel): Solidity/Foundry + Next.js + `wagmi v2` + `viem` + `RainbowKit` + wallets reales (MetaMask, Rabby, WalletConnect) sobre Sepolia y Base Sepolia.
>
> Formato de cada Q&A: **Pregunta → Respuesta corta (elevator pitch) → Profundización (detalle técnico con file paths) → Trampas comunes (errores típicos al responder).**

---

## Tabla de contenido

1. [Web3 fundamentals](#1-web3-fundamentals)
2. [Smart contract `DocumentRegistry`](#2-smart-contract-documentregistry)
3. [Foundry toolchain](#3-foundry-toolchain)
4. [`ethers.js v6` (rama `anvil-local`)](#4-ethersjs-v6-rama-anvil-local)
5. [`wagmi v2` + `viem` + `RainbowKit` (rama `testnet`)](#5-wagmi-v2--viem--rainbowkit-rama-testnet)
6. [Next.js / React](#6-nextjs--react)
7. [Deploy y DevOps](#7-deploy-y-devops)
8. [Seguridad](#8-seguridad)
9. [Decisiones de arquitectura y trade-offs](#9-decisiones-de-arquitectura-y-trade-offs)
10. [Behavioral / del proyecto](#10-behavioral--del-proyecto)

---

## 1. Web3 fundamentals

### 1.1 ¿Qué hace tu dApp en una frase, y qué problema resuelve?

**Respuesta corta:** Almaceno on-chain el `keccak256` de un archivo junto con la firma `ECDSA` de quien lo registró. Eso permite a cualquiera verificar después que el archivo no fue alterado y quién lo firmó, sin confiar en un servidor central.

**Profundización:** El usuario sube un archivo, el frontend calcula `keccak256(bytes_del_archivo)`, le pide a la wallet firmar ese hash con `personal_sign` (EIP-191), y manda al contrato `storeDocumentHash(hash, timestamp, signature, signer)`. La verificación posterior recalcula el hash, lee el documento del contrato y llama a `verifyDocument(hash, signer, signature)` que usa `ecrecover` para validar la firma. El archivo nunca toca la blockchain — solo su huella digital.

**Trampas:**
- Decir "guardo el documento on-chain" — no, guardo el **hash** (32 bytes) por costo y privacidad.
- Confundir `keccak256` con `SHA-256` — Ethereum usa `keccak256` (la versión "original" antes del estándar NIST SHA-3, no son iguales).

---

### 1.2 ¿Qué es `keccak256` y por qué Ethereum no usa `SHA-256`?

**Respuesta corta:** `keccak256` es la función de hash nativa de la EVM. Ethereum la adoptó antes que NIST estandarizara `SHA-3`, y NIST hizo cambios al padding — por compatibilidad histórica Ethereum mantuvo la versión original (`keccak`), no el `SHA-3` final.

**Profundización:**
- `keccak256` produce 32 bytes (256 bits) → encaja perfecto en un slot de storage de la EVM.
- Es el opcode `KECCAK256` (antes `SHA3`) — barato relativamente: ~30 gas + 6 gas por palabra.
- `SHA-256` también está disponible en Ethereum, pero como precompilado en `address(0x02)` y es más caro.
- En Solidity: `keccak256(abi.encodePacked(...))`. En el frontend con viem: `keccak256(toBytes(file))`.

**Trampas:** Usar `abi.encode` vs `abi.encodePacked` — el primero pone padding, el segundo no. Para hashear datos heterogéneos (`string + uint`) `abi.encodePacked` puede generar colisiones; con tipos fijos (un `bytes32` solo) es seguro.

---

### 1.3 ¿Qué es una firma ECDSA y cómo se usa en Ethereum?

**Respuesta corta:** Es una firma de curva elíptica (`secp256k1`). El firmante usa su private key sobre un digest de 32 bytes y produce 65 bytes (`r`, `s`, `v`). En Ethereum, `ecrecover(digest, v, r, s)` devuelve la `address` que produjo la firma — porque la `address` es básicamente `keccak256(publicKey)[12:]`.

**Profundización:**
- **`r`, `s`** — 32 bytes cada uno, los componentes matemáticos de la firma.
- **`v`** — 1 byte de "recovery id" (27 o 28 en Ethereum legacy; con EIP-155 se mezcla el `chainId` para evitar replay cross-chain).
- En este proyecto la firma se hace con `personal_sign` (`signMessage` en ethers/viem), que **no firma el hash crudo**: prepende `"\x19Ethereum Signed Message:\n32"` y vuelve a hashear. Esto evita que firmes accidentalmente una transacción.
- Por eso en el contrato (`sc/src/DocumentRegistry.sol:142-144`) reconstruimos ese prefijo antes de llamar `ecrecover`.

**Trampas:** Olvidar el prefijo `\x19Ethereum Signed Message:\n32` y comparar contra `ecrecover(rawHash, ...)`. Falla siempre. Es el bug más frecuente del flujo de verificación.

---

### 1.4 ¿Qué es el gas y por qué importa en este contrato?

**Respuesta corta:** Es la unidad de trabajo computacional en la EVM; cada opcode tiene un costo en gas. Pagás `gasUsed * gasPrice` por cada tx. En este contrato gasté tiempo optimizando el storage para no quemar gas innecesario por documento registrado.

**Profundización:**
- **Storage es lo más caro**: `SSTORE` cuesta 20.000 gas para escribir un slot de cero a no-cero, 5.000 si ya estaba poblado.
- En `DocumentRegistry`, el struct `Document` ocupa 4 slots: `bytes32 hash`, `uint256 timestamp`, `address signer`, `bytes signature` (este último es dinámico, ocupa varios slots según longitud).
- **Decisión clave**: NO agregamos un campo `bool exists`. Eso ahorraría 1 slot por documento (~20.000 gas) — usamos `signer != address(0)` como prueba de existencia.
- En testnet pagás con ETH de faucet, en mainnet con ETH real → la optimización vale plata.

**Trampas:** Decir "el gas es la fee" — la fee es el `gas * gasPrice`. El gas en sí es la "cantidad de trabajo".

---

### 1.5 ¿Qué diferencia hay entre una EOA y un Contract Account?

**Respuesta corta:** Una EOA (Externally Owned Account) está controlada por una private key (las wallets de usuario, MetaMask, Rabby). Un Contract Account está controlada por código — no tiene private key, solo se "activa" cuando otra cuenta le manda una transacción.

**Profundización:**
- **EOA**: puede iniciar transacciones, firmar mensajes, pagar gas. Address derivada de la public key.
- **Contract Account**: tiene `bytecode` y `storage`, no puede iniciar transacciones por sí solo. En este proyecto, `DocumentRegistry` es un Contract Account.
- Con **EIP-4337 (Account Abstraction)** y **EIP-7702** (firmado en Pectra) un EOA puede temporalmente comportarse como contract account — pero para esta dApp no aplica.

**Trampas:** Decir que las EOAs "tienen menos seguridad" — depende del contexto. Una EOA bien custodiada es perfectamente segura; los contract wallets agregan flexibilidad (multisig, social recovery), no necesariamente más seguridad.

---

### 1.6 ¿Qué es el `chainId` y por qué tu dApp lo usa?

**Respuesta corta:** Es un identificador único de cada red EVM. Anvil = `31337`, Sepolia = `11155111`, Base Sepolia = `84532`, Ethereum mainnet = `1`. Sirve para evitar que firmes una tx en una red y se ejecute en otra (replay protection EIP-155).

**Profundización:** En la rama `testnet`, `dapp/lib/contracts.ts` mapea cada `chainId` a la address del contrato deployado en esa red. Si el usuario está conectado a Sepolia pero el contrato vive en Base Sepolia, el frontend tira un error claro (`useContract.ts:42-46`).

**Trampas:** Hardcodear una sola address y asumir que todas las redes la tienen — los addresses cambian por red porque cada deploy es independiente.

---

## 2. Smart contract `DocumentRegistry`

### 2.1 Caminame el storage del contrato. ¿Por qué un mapping y un array?

**Respuesta corta:** El `mapping(bytes32 => Document) documents` es la fuente de verdad para lookup `O(1)` por hash. El `bytes32[] documentHashes` es un array paralelo que existe **solo** para poder iterar el historial — los mappings no son iterables en Solidity.

**Profundización (`sc/src/DocumentRegistry.sol:35-39`):**
```solidity
mapping(bytes32 => Document) private documents;
bytes32[] private documentHashes;
```
- `documents[hash]` → datos del documento, lookup directo.
- `documentHashes[i]` → me da el hash en posición `i`, y de ahí voy al mapping.
- El frontend usa `getDocumentCount()` + un `for` con `getDocumentHashByIndex(i)` + `getDocumentInfo(hash)` para armar el historial completo (`dapp/components/DocumentHistory.tsx`).

**Trampas:**
- "¿Y si dos hashes son iguales?" — keccak256 garantiza unicidad práctica (resistencia a colisiones de 2^128).
- "Iterar on-chain con un loop podría quedar sin gas" — sí, por eso la iteración la hace **el frontend** lanzando N reads, no el contrato.

---

### 2.2 ¿Por qué no agregaste un campo `bool exists` al struct?

**Respuesta corta:** Porque `signer != address(0)` es una prueba de existencia gratuita: la dirección cero es imposible como firmante real (`ecrecover` nunca devuelve `address(0)` para una firma válida, y validamos en el require que el signer no sea cero al guardar). Agregar `bool exists` ocuparía un slot extra y ~20.000 gas adicionales por documento.

**Profundización (`sc/src/DocumentRegistry.sol:59-75`):**
```solidity
modifier documentNotExists(bytes32 _hash) {
    require(documents[_hash].signer == address(0), "Document already exists");
    _;
}
```
Es el patrón **"sentinel value"** — usar un valor imposible del dominio (`address(0)`) como marca de "vacío". Está documentado en el `CLAUDE.md` raíz como decisión explícita del proyecto.

**Trampas:** Si alguien sugiere "es más legible con `bool exists`" — sí, marginalmente, pero el ahorro de gas es real y el patrón es idiomático en Solidity. La legibilidad la compensás con un comentario.

---

### 2.3 Explicame la verificación de firma on-chain paso a paso

**Respuesta corta:** Reconstruyo el digest que la wallet firmó (con el prefijo `\x19Ethereum Signed Message:\n32`), splittea la firma en `r`/`s`/`v` con `assembly`, y llama `ecrecover` para obtener la address que firmó. Si coincide con el `_signer` que pasaron, devuelvo `true`.

**Profundización (`sc/src/DocumentRegistry.sol:133-163`):**
```solidity
function verifyDocument(bytes32 _hash, address _signer, bytes memory _signature)
    external view returns (bool)
{
    if (documents[_hash].signer == address(0)) return false;
    bytes32 ethSignedHash = keccak256(
        abi.encodePacked("\x19Ethereum Signed Message:\n32", _hash)
    );
    if (_signature.length != 65) return false;
    bytes32 r; bytes32 s; uint8 v;
    assembly {
        r := mload(add(_signature, 32))
        s := mload(add(_signature, 64))
        v := byte(0, mload(add(_signature, 96)))
    }
    return ecrecover(ethSignedHash, v, r, s) == _signer;
}
```

El `assembly` lee bytes en memoria: `_signature` es un puntero, los primeros 32 bytes son el `length`, después vienen los 65 bytes reales. Por eso `add(_signature, 32)` salta el length-prefix.

**Trampas:**
- Olvidar el prefijo EIP-191 → la verificación falla siempre.
- No validar `_signature.length == 65` → puede revertir o devolver `address(0)` (lo cual sería interpretado mal sin el `if (signer == address(0)) return false` previo).

---

### 2.4 ¿Qué pasa si alguien manda una firma de otra persona en `storeDocumentHash`?

**Respuesta corta:** El contrato lo aceptaría — la verificación ocurre en `verifyDocument`, no al guardar. Es una decisión de diseño consciente: "el contrato persiste, el verificador valida". Esto ahorra gas en el write path.

**Profundización:** En `storeDocumentHash` (`DocumentRegistry.sol:98-117`) solo validamos que `_signer != address(0)` y que la firma tenga 65 bytes. Cualquiera puede pushear basura. Pero al verificar (`verifyDocument`), si la firma no corresponde al signer declarado, devuelve `false` — y nadie podrá "probar" que el documento es auténtico.

**Trade-off explícito:** Si forzáramos verificación en el write, el storage nunca tendría firmas inválidas — pero pagás `~3000 gas` extra por write. Para esta dApp educativa no compensa; en un contrato productivo de mucho volumen sí podría tener sentido.

**Trampas:** Decir que es "un bug de seguridad" — no, es un trade-off documentado. El sistema sigue siendo seguro porque la verificación final filtra los fakes.

---

### 2.5 ¿Por qué el `timestamp` lo manda el cliente y no `block.timestamp`?

**Respuesta corta:** Porque queríamos preservar el instante de firma (lado cliente) — si lo capturás con `block.timestamp`, registrás el momento del **mining**, que puede ser mucho después de la firma. El timestamp del cliente es informativo, no es de seguridad.

**Profundización:** No es una elección sin riesgo: el cliente puede mentir y mandar un timestamp falso. Pero como el contrato no toma decisiones basadas en ese timestamp (no es un TTL ni un nonce), no compromete el sistema. Si necesitáramos un timestamp confiable, usaríamos `block.timestamp` y aceptaríamos el delay de minado.

**Trampas:** Confiar en `block.timestamp` para nonces o cualquier cosa de seguridad — los miners/validators pueden manipularlo dentro de un margen (~15 segundos). Para algo crítico, usá oracles (Chainlink) o lógica de bloque (`block.number`).

---

### 2.6 ¿Por qué emitís un `event` si ya estás guardando todo en storage?

**Respuesta corta:** Los eventos son **log entries baratos** (~375 gas + 8 gas/byte) y permiten al frontend escuchar cambios en tiempo real sin polling, e indexar desde explorers como Etherscan. El storage es para lectura on-chain; los events son para off-chain.

**Profundización (`sc/src/DocumentRegistry.sol:47-51`):**
```solidity
event DocumentStored(bytes32 indexed hash, address indexed signer, uint256 timestamp);
```
- `indexed` permite filtrar por `hash` o `signer` desde el frontend con `getLogs` / `useWatchContractEvent` de wagmi.
- En este proyecto el frontend no escucha eventos (usa polling vía `getDocumentCount`), pero el evento queda emitido para indexers (`The Graph`, `Goldsky`) o para que un futuro dashboard los consuma sin pegarle al RPC con N reads.

**Trampas:** Pensar que los events "guardan datos" como el storage — no son leíbles desde otro contrato. Solo viven en los receipts de transacciones.

---

## 3. Foundry toolchain

### 3.1 ¿Qué es Foundry y por qué lo elegiste sobre Hardhat?

**Respuesta corta:** Foundry es un toolchain en Rust para desarrollo Solidity (`forge` para tests/build, `cast` para CLI a contratos, `anvil` para nodo local). Lo elegí porque los tests se escriben en Solidity (no JS), corren ~10-100x más rápido que Hardhat, y trae fuzzing y cheatcodes built-in.

**Profundización:**
- `forge build` — compila contratos.
- `forge test -vv` — corre tests con logs (`-vvv` muestra traces, `-vvvv` con stacks completos).
- `forge coverage` — cobertura de líneas/funciones.
- `forge script` + `--broadcast` — deploys vía script de Solidity (no JS).
- `anvil` — nodo EVM local con preset de 10 cuentas conocidas + mnemonic público.
- `cast` — CLI para queries (`cast call`, `cast send`, `cast logs`).

**Trampas:**
- Decir "Hardhat es viejo" — no, sigue siendo válido (tiene mejor integración con ecosistema JS, plugins maduros). Foundry es preferible para velocidad y para devs que vienen de Solidity puro.

---

### 3.2 ¿Qué cheatcodes de Foundry usaste y qué hacen?

**Respuesta corta:** Los cheatcodes son funciones especiales de `vm` que solo existen en tests. Manipulan estado de la EVM para reproducir escenarios. Los más usados acá serían `vm.prank()` (cambiar `msg.sender`), `vm.expectRevert()` (esperar fallo), `vm.warp()` (mover `block.timestamp`).

**Profundización:**
- `vm.prank(alice)` — la próxima call viene como si Alice fuera el `msg.sender`.
- `vm.startPrank(alice)` / `vm.stopPrank()` — todas las calls intermedias son de Alice.
- `vm.expectRevert("Document already exists")` — la próxima call debe revertir con ese mensaje exacto.
- `vm.warp(timestamp)` — setea `block.timestamp`.
- `vm.roll(blockNumber)` — setea `block.number`.
- `vm.sign(privateKey, digest)` — firma off-chain dentro del test → útil para testear `verifyDocument`.

**Trampas:** Olvidar `vm.startPrank` antes de una secuencia de calls — solo el primer `vm.prank` aplica al next call.

---

### 3.3 ¿Qué es fuzzing y cómo lo usarías en este contrato?

**Respuesta corta:** Fuzzing es ejecutar el mismo test con cientos de inputs aleatorios para encontrar edge cases. Foundry lo activa automáticamente cuando una función de test recibe parámetros: `function testFuzz_Store(bytes32 hash, address signer) public`.

**Profundización:** Foundry corre por defecto 256 runs por test fuzzing (configurable en `foundry.toml`). Casos donde sirve para `DocumentRegistry`:
- Hashes aleatorios → asegurarme de que `storeDocumentHash` nunca acepta `address(0)` como signer aunque el hash varíe.
- Firmas de longitud variable → confirmar que `verifyDocument` rechaza todo lo que no sea exactamente 65 bytes.
- Timestamps grandes → `uint256` aguanta hasta 2^256, no debería overflowear nunca, pero un fuzz lo verifica.

**Variantes:**
- **Property-based testing** — testeás invariantes ("after N stores, count == N").
- **Invariant testing** — Foundry corre acciones random y chequea que un invariante global se mantenga (`forge test --invariant`).

**Trampas:** Confundir fuzzing (input aleatorio, test estructurado) con "testing aleatorio" sin propósito. Los buenos fuzz tests verifican propiedades, no resultados específicos.

---

### 3.4 Explicame `forge script` y por qué lo usás para deployar

**Respuesta corta:** `forge script` corre un script de Solidity que puede leer env vars, deployar contratos, e interactuar con ellos. Con `--broadcast` además manda las transacciones a un RPC real.

**Profundización (`sc/script/Deploy.s.sol`):**
```bash
forge script script/Deploy.s.sol \
  --rpc-url http://localhost:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```
- El script extiende `Script` y usa `vm.startBroadcast()` / `vm.stopBroadcast()` para marcar qué transacciones se mandan.
- La private key del ejemplo es la cuenta `[0]` de Anvil — pública, conocida, no es un secreto.
- Para testnet: cambiás `--rpc-url` y usás una `--private-key` real (o mejor, `--account` con keystore o hardware wallet).

**Trampas:**
- Commitear una private key real — usar `--account <name>` con `cast wallet import` para guardarla cifrada en `~/.foundry/keystores/`.
- Olvidar `--broadcast` → el script corre en simulación, no manda txs.

---

## 4. `ethers.js v6` (rama `anvil-local`)

### 4.1 ¿Cómo se conecta el frontend al nodo si NO usa MetaMask?

**Respuesta corta:** Uso `ethers.JsonRpcProvider('http://localhost:8545')` que pega directo al RPC de Anvil. Las wallets las derivo del mnemonic público de Anvil con `HDNodeWallet.fromPhrase` siguiendo el path BIP-44 de Ethereum (`m/44'/60'/0'/0/i`).

**Profundización (`dapp/contexts/MetaMaskContext.tsx` en `anvil-local`):**
```tsx
const provider = new JsonRpcProvider("http://localhost:8545");
const phrase = Mnemonic.fromPhrase("test test test test test test test test test test test junk");
const wallets = Array.from({ length: 10 }, (_, i) =>
  HDNodeWallet.fromMnemonic(phrase, `m/44'/60'/0'/0/${i}`)
);
```
- El mnemonic es el **default de Anvil** — público, las primeras 10 cuentas tienen 10.000 ETH cada una (de mentira).
- El nombre `MetaMaskContext` es histórico/heredado del scaffolding del curso. NO usa MetaMask. Documentado en `CLAUDE.md` raíz.
- `HDNodeWallet` tiene `signMessage()` y se puede usar como signer en cualquier `contract.connect(wallet)`.

**Trampas:**
- Decir que es "inseguro" sin matizar — sí lo es para mainnet, pero es **idiomático** para desarrollo local con Anvil porque el mnemonic ya es público.
- Confundir `JsonRpcProvider` con `BrowserProvider` — el segundo lee el provider inyectado por la wallet (`window.ethereum`), el primero pega directo al RPC.

---

### 4.2 ¿Qué es BIP-44 y por qué tu derivation path es `m/44'/60'/0'/0/i`?

**Respuesta corta:** BIP-44 es un estándar para derivar múltiples direcciones de un mismo seed. El path `m/44'/60'/0'/0/i` significa: purpose 44 (BIP-44), coin type 60 (Ethereum), account 0, change 0 (external chain), address index `i`. Cambiar el `i` me da una wallet distinta sin cambiar el seed.

**Profundización:**
- Cada `'` denota "hardened derivation" → no permite reverse engineering desde una sub-key a la parent.
- Coin type 60 = Ethereum (definido en SLIP-44).
- Bitcoin usa `m/44'/0'/...`, Solana usa `m/44'/501'/...`.
- Es el mismo path que MetaMask y Anvil → por eso las direcciones derivadas en mi dapp coinciden con las que muestra Anvil en consola.

**Trampas:** Cambiar el path "porque sí" — perderías compatibilidad con cualquier otra herramienta que derive del mismo mnemonic.

---

### 4.3 ¿Cómo firmás un mensaje con ethers v6?

**Respuesta corta:** `await wallet.signMessage(message)` — internamente prepende `\x19Ethereum Signed Message:\n` + length + el mensaje, hashea con keccak256 y firma. Devuelve un hex string de 132 caracteres (`0x` + 65 bytes en hex).

**Profundización:**
```ts
const signature = await wallet.signMessage(ethers.getBytes(hash));
// signature = "0x" + r(64) + s(64) + v(2) → 132 chars
```
Pasarle `getBytes(hash)` es importante: si pasás el string `"0xabc..."`, ethers firma el **string literal**, no los bytes. Confunde a muchos.

**Trampas:**
- Firmar con `signTypedData` (EIP-712) cuando solo necesitás `personal_sign` — es más complejo y este proyecto no lo necesita.
- No usar `getBytes()` y firmar el hex string como texto.

---

### 4.4 ¿Qué riesgos tiene tener private keys derivadas en el frontend?

**Respuesta corta:** En producción es **inaceptable** — las keys están en el bundle JavaScript expuesto al cliente, cualquiera puede leerlas. Acá funciona porque el target es Anvil con un mnemonic público y la dApp no toca dinero real.

**Profundización:** El compromiso es:
- ✅ Modelo simple para enseñar el flujo end-to-end sin la fricción de instalar/configurar MetaMask.
- ❌ No portable a testnet/mainnet sin reescribir el flujo de wallet.
- Por eso existe la rama `testnet`: migra a `wagmi/RainbowKit` y conecta wallets reales.

**Trampas:** "Pero `NEXT_PUBLIC_*` solo están en build time" — sí, pero el resultado **vive en el bundle servido al browser**, accesible desde DevTools. No son secretos.

---

## 5. `wagmi v2` + `viem` + `RainbowKit` (rama `testnet`)

### 5.1 ¿Por qué migraste de `ethers.js` a `wagmi/viem`?

**Respuesta corta:** Para soportar wallets reales (MetaMask, Rabby, WalletConnect) y deployar a testnet/Vercel. `wagmi` da hooks de React idiomáticos (`useReadContract`, `useWriteContract`) con caching automático vía TanStack Query, y `RainbowKit` resuelve el modal de conexión multichain en una línea.

**Profundización:**
- `viem` reemplaza a `ethers` como cliente low-level (mejor TypeScript, tree-shaking, rendimiento).
- `wagmi` es la capa de React sobre `viem` (hooks + state management de wallet).
- `RainbowKit` es el UI kit oficial para el modal de conexión (selector de wallet, network switcher, ENS avatar).
- Multichain: configuro Sepolia y Base Sepolia en `dapp/lib/wagmi.ts`, y `useContract.ts` resuelve la address del contrato según `chainId`.

**Trampas:**
- Decir "ethers está muerto" — no, sigue siendo el estándar fuera del ecosistema React. v6 trajo mejoras importantes.
- `wagmi v1` y `wagmi v2` tienen APIs distintas (v2 quitó `useContract`, ahora se usa `useReadContract`).

---

### 5.2 ¿Cuál es la diferencia entre `useReadContract` y `useWriteContract`?

**Respuesta corta:** `useReadContract` lee estado del contrato (vista, no muta blockchain, gratis). `useWriteContract` envía una transacción (firma con la wallet, muta estado, paga gas).

**Profundización:**
- `useReadContract` → query con TanStack Query, cacheable, refetch automático en focus/network change.
- `useWriteContract` → mutación, devuelve `txHash` en la mempool. Para confirmación uso `useWaitForTransactionReceipt({ hash: txHash })`.
- En este proyecto uso las **acciones imperativas** de `@wagmi/core` (`readContract`, `writeContract`, `waitForTransactionReceipt`) en lugar de los hooks reactivos, dentro de `dapp/hooks/useContract.ts`. ¿Por qué? Para mantener la API tipo `async function` que ya tenían los componentes en la versión Anvil — minimizar el diff de la migración.

**Trampas:**
- Llamar `useReadContract` dentro de un `useEffect` o un handler de evento → no funciona, los hooks tienen que estar en el top-level del componente. Por eso a veces conviene `readContract` (acción) en handlers.

---

### 5.3 Explicame el flujo completo de una firma + tx con wagmi

**Respuesta corta:** El usuario aprieta "Sign", el frontend llama `signMessage` (wagmi abre popup de la wallet), recibe la firma, y después llama `writeContract` (segundo popup para aprobar la tx). Espero el receipt con `waitForTransactionReceipt` para confirmar que se minó.

**Profundización (`dapp/hooks/useContract.ts:118-141`):**
```ts
const txHash = await writeContract(config, {
  address: ensureAddress(),
  abi: DocumentRegistryABI,
  functionName: "storeDocumentHash",
  args: [params.hash, params.timestamp, params.signature, params.signer],
});
const receipt = await waitForTransactionReceipt(config, { hash: txHash });
return receipt.transactionHash;
```
Antes del write, `DocumentSigner.tsx` hace un pre-check con `isDocumentStored(hash)` para fallar rápido si ya está registrado. Eso evita que el usuario gaste gas en una tx que va a revertir.

**Trampas:**
- No esperar el receipt y mostrar "registrado" inmediatamente — la tx puede aún revertir o quedar dropeada.
- Mostrar un solo toast genérico — la UX mejora con tres estados: "esperando firma" → "tx enviada (mempool)" → "confirmada".

---

### 5.4 ¿Qué es `fallback()` en viem y por qué lo usás?

**Respuesta corta:** `fallback([transport1, transport2, ...])` arma un transport que prueba en orden: si el primero falla (timeout, 429, 5xx), pasa al siguiente. Lo uso porque los RPCs públicos rate-limitean agresivo cuando el flujo de firma dispara 10+ requests seguidos.

**Profundización (`dapp/lib/wagmi.ts:24-36`):**
```ts
const sepoliaTransports = [
  ...(userSepoliaRpc ? [http(userSepoliaRpc)] : []),
  http("https://ethereum-sepolia-rpc.publicnode.com"),
  http("https://sepolia.gateway.tenderly.co"),
  http("https://eth-sepolia.public.blastapi.io"),
];
```
**Bug real que motivó esto:** sin `fallback`, viem tiraba un error que parecía un revert del contrato:
> "The contract function storeDocumentHash reverted with the following reason: Request is being rate limited."

No era un revert. Era un `429 Too Many Requests` del RPC, envuelto por viem dentro del wrapper de "contract reverted". Confunde mucho porque te manda a debuggear Solidity cuando el problema es la red.

**Trampas:**
- Buscar el string "Request is being rate limited" en Solidity — no está ahí.
- Pensar que `fallback` resuelve todo — para mainnet o producción real, lo que hace falta es un RPC propio (Alchemy/Infura) como primer transport, los públicos como respaldo.

---

### 5.5 ¿Qué hace `RainbowKit` exactamente? ¿Por qué no `Web3Modal` o `ConnectKit`?

**Respuesta corta:** `RainbowKit` es un kit de UI para el flujo de conexión: modal de selección de wallet, network switcher, avatar con ENS, badge de chain. Lo elegí porque tiene buen UX out-of-the-box, integración nativa con `wagmi`, y `getDefaultConfig` resuelve la lista curada de connectors (MetaMask, Rabby, WalletConnect, Coinbase, Rainbow) sin tener que mantener yo la fauna.

**Profundización (`dapp/lib/wagmi.ts:42-53`):**
```ts
export const config = getDefaultConfig({
  appName: "Document Sign Storage",
  projectId,
  chains: [sepolia, baseSepolia],
  ssr: true,
  transports: { ... },
});
```
- `projectId` viene de Reown (antes WalletConnect Cloud) — necesario para WalletConnect funcione.
- `ssr: true` ajusta cookies/persistencia para no romper la hidratación de Next.js.

**Comparativa:**
- **`ConnectKit`** — alternativa popular, menos opinionado en estilo, mismo target.
- **`Web3Modal` (Reown AppKit)** — más feature-rich (Solana, Bitcoin, smart accounts), más pesado.
- **Custom** — `wagmi` solo, sin UI kit. Más control, más código.

**Trampas:** Cambiar `projectId` por uno random — el modal de WalletConnect no levanta sin un projectId válido registrado en cloud.reown.com.

---

### 5.6 ¿Cómo maneja wagmi el caching de reads on-chain?

**Respuesta corta:** wagmi v2 usa TanStack Query bajo el capó. Cada `useReadContract` arma una query key con `(chainId, address, functionName, args)` y cachea el resultado. Refetch automático on window focus y on network change.

**Profundización:**
- Stale time default: `0` → siempre refetcha.
- Para reads que cambian poco (ej. `getDocumentCount`), podés subirlo: `useReadContract({ ..., query: { staleTime: 30_000 } })`.
- `refetchInterval` en lugar de polling manual con `setInterval`.
- Invalidación post-write: después de `writeContract`, podés llamar `queryClient.invalidateQueries({ queryKey: [...] })` para forzar el refetch del count.

**Trampas:** Pensar que wagmi "automágicamente" sabe cuándo invalidar después de un write — no, hay que invalidar manualmente o esperar al siguiente refetch.

---

## 6. Next.js / React

### 6.1 ¿Qué diferencia hay entre Server Components y Client Components, y cómo afecta a wagmi?

**Respuesta corta:** Server Components corren en el servidor, no envían JS al cliente, no pueden usar hooks ni event handlers. Client Components corren en el browser y soportan toda la API de React. Wagmi necesita Client Components porque usa hooks, contexts, y APIs del browser (`window.ethereum`, `localStorage`).

**Profundización:**
- En Next.js App Router, los componentes son **Server por defecto**.
- `"use client"` al tope del archivo lo marca como Client Component (y todo lo que importe).
- En este proyecto: `dapp/app/providers.tsx` es client (envuelve `WagmiProvider` + `RainbowKitProvider` + `QueryClientProvider`).
- El `layout.tsx` puede ser Server, pero importa `Providers` (client).
- Componentes interactivos (`DocumentSigner`, `FileUploader`, `DocumentVerifier`) son client.

**Trampas:**
- Olvidar `"use client"` y recibir el error "You're importing a component that needs `useState`. It only works in a Client Component...".
- Importar un Client Component desde un Server Component es OK; al revés no funciona automáticamente (Server Components no pueden ser children directos de Client Components, salvo que se pasen como props/`children`).

---

### 6.2 ¿Cómo evitás que se rompa la hidratación cuando wagmi lee el estado de la wallet?

**Respuesta corta:** Con `ssr: true` en la config de wagmi y renderizando el estado dependiente de wallet **solo después de que el componente está montado**, o usando un guard tipo `if (!isMounted) return null`. Si renderizás `address` directo en SSR, el HTML del server no coincide con el del cliente y React tira un mismatch.

**Profundización:**
- `getDefaultConfig({ ssr: true, ... })` le dice a wagmi que use cookies para persistir el estado entre server y client, evitando flicker.
- Patrón típico: un `useEffect(() => setMounted(true), [])` y mostrar `<Skeleton />` hasta `mounted === true`.
- `RainbowKit` ya maneja esto internamente para su modal — pero si usás `useAccount` en tu propio componente, te toca a vos.

**Trampas:**
- Hidration mismatch silencioso → en dev sale un warning rojo, en prod el HTML inicial puede mostrar "no conectado" un instante antes de actualizarse.

---

### 6.3 Explicame el árbol de providers de tu app

**Respuesta corta:** En `dapp/app/providers.tsx` envuelvo todo en `WagmiProvider` (estado de wallet/config) → `QueryClientProvider` (TanStack Query, requerido por wagmi) → `RainbowKitProvider` (UI kit) → `ThemeProvider` (next-themes para dark mode) → `<Toaster />` (sonner) + children. El orden importa: cada provider depende de los de arriba.

**Profundización:** El layout en `dapp/app/layout.tsx` es server, pero importa `<Providers>` que es client. Adentro de Providers, todos los componentes pueden usar `useAccount`, `useReadContract`, etc. El `Toaster` queda al final (no es un provider, es un sink) para que pueda recibir toasts desde cualquier hijo.

**Trampas:**
- Poner `RainbowKitProvider` antes de `QueryClientProvider` → rompe porque RainbowKit usa queries internamente.
- Olvidar `WagmiProvider` cuando agregás un provider nuevo y romper toda la chain.

---

### 6.4 ¿Por qué no usás Server Components para leer del contrato?

**Respuesta corta:** Podría — viem corre en el servidor, no requiere wallet para reads. Pero el flujo de la dApp depende de la wallet conectada (chain, address) que solo existe en el cliente. Para reads "públicos" sin wallet (ej. la tabla de historial) sí podría hacerlo del lado server con un viem `publicClient`.

**Profundización:** Sería una optimización válida: pre-renderizar `DocumentHistory` en el server, pegarle al RPC desde Vercel, hidratar con la lista ya armada. Ahorraría la cascada de N requests del cliente y mejoraría el LCP. No lo hice porque (1) la dApp es educativa y prefería un único patrón consistente, y (2) el user actual quiere ver solo su historial cuando está conectado.

**Trampas:** Asumir que "todo" se puede mover al server — operaciones que dependen de la wallet del usuario (signing, writes) son inherentemente client.

---

## 7. Deploy y DevOps

### 7.1 ¿Cómo está deployada esta dApp?

**Respuesta corta:** Frontend en Vercel (`dapp/` como root directory, branch `testnet` como producción). Smart contracts están deployados en Sepolia y Base Sepolia (testnets de Ethereum/Base) vía `forge script`. La URL en prod es `https://document-sign-storage.vercel.app/`.

**Profundización:**
- **Vercel** detecta cualquier push a `testnet` → build + deploy automático a producción.
- Otras branches → preview deploys con URL única por commit.
- Frameworks: Next.js 16.2.4 con Turbopack.
- Env vars en Vercel: solo `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. Las addresses de contratos están hardcoded en `dapp/lib/contracts.ts` y los RPCs son los públicos vía `http()` en `dapp/lib/wagmi.ts`.

**Trampas:**
- Hacer merge a `testnet` sin querer → push directo a producción. Yo trabajaría con feature branches y mergearía explícitamente.

---

### 7.2 ¿Por qué `NEXT_PUBLIC_*` no son secretos?

**Respuesta corta:** Las env vars que empiezan con `NEXT_PUBLIC_` se inyectan en el bundle JavaScript que se sirve al browser. Cualquier usuario puede abrir DevTools y leerlas. Son configuración pública, no secretos.

**Profundización:**
- Para una API key de Alchemy real en producción, **nunca** la pongas como `NEXT_PUBLIC_*`. Hacé un API route en `app/api/rpc/route.ts` que proxee al RPC con la key del lado server.
- En este proyecto las únicas vars públicas son `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (público por diseño en cloud.reown.com) y URLs de RPCs públicos (literalmente públicos).
- Para mainnet con un RPC propio, el modelo cambia: API route como proxy + rate limiting per-IP del lado server.

**Trampas:**
- "Pero está en `.env.local` que no se commitea" → da igual, el build inyecta el valor en el bundle final. La privacidad del archivo no protege el valor.

---

### 7.3 ¿Cómo deployaste los smart contracts a testnet?

**Respuesta corta:** Con `forge script script/Deploy.s.sol --rpc-url <RPC_TESTNET> --broadcast --account <keystore>`. La address resultante la pegué en `dapp/lib/contracts.ts` mapeada al `chainId` correspondiente.

**Profundización:**
- Para Sepolia: necesité un wallet con ETH de faucet (sepoliafaucet.com, Google Cloud, Alchemy).
- El `--account` referencia un keystore cifrado en `~/.foundry/keystores/` creado con `cast wallet import`. Más seguro que pegar la `--private-key` en CLI history.
- Verificación en explorer (Etherscan, Basescan) con `forge verify-contract <address> <contract> --etherscan-api-key <key>` — opcional, hace que el código fuente sea visible en el explorer.

**Trampas:**
- Olvidar verificar el contrato → el explorer solo muestra bytecode, nadie puede auditar el source.
- Deployar a testnet con la misma key que usás en mainnet — se filtró/hackeó una, perdiste las dos.

---

## 8. Seguridad

### 8.1 ¿Tu contrato es vulnerable a un signature replay attack?

**Respuesta corta:** **Sí, técnicamente.** Una firma sobre un hash es válida para siempre. Si alguien intercepta `(hash, signer, signature)` puede llamar `verifyDocument` con esos mismos datos y va a devolver `true`. Pero **`storeDocumentHash` solo permite registrar el hash una vez** (`documentNotExists` modifier), así que el replay no puede inflar el storage. La firma replay solo afectaría si un sistema tercero confiara en `verifyDocument` como prueba de "lo firmé recién" — el contrato no captura el momento de firma.

**Profundización:** Mitigaciones que aplicaría en una versión productiva:
- Incluir un `nonce` por signer en el digest firmado (`keccak256(hash, nonce, address(this), block.chainid)`).
- Incluir `address(this)` para evitar replay cross-contract.
- Incluir `block.chainid` para evitar replay cross-chain (igual EIP-155 protege txs, pero la firma personal no).
- Migrar a EIP-712 typed data, que estructura mejor el digest y permite mostrar al usuario qué está firmando.

**Trampas:**
- Decir "no es vulnerable porque solo se guarda una vez" → mezclás dos capas. El replay de firma y el replay de storage son riesgos distintos.

---

### 8.2 ¿Y signature malleability?

**Respuesta corta:** ECDSA tiene una propiedad que permite, dada una firma `(r, s, v)`, derivar otra firma válida `(r, n - s, v')` para el mismo digest. Sin chequear que `s` esté en la "mitad baja" de la curva, podrías aceptar dos firmas distintas para el mismo mensaje. OpenZeppelin's `ECDSA.recover` lo previene; mi `ecrecover` directo no.

**Profundización:**
- En este proyecto, como el contrato registra documentos por `hash` (no por firma) y la firma se valida solo en `verifyDocument` que devuelve bool, la malleability no se traduce en un exploit explotable directo.
- Pero si en el futuro indexás "firmas únicas vistas" o usás la firma como nonce, te explota.
- **Fix idiomático:** importar `OpenZeppelin/contracts/utils/cryptography/ECDSA.sol` y usar `ECDSA.recover` que rechaza `s > secp256k1.n / 2`.

**Trampas:**
- Pensar que `ecrecover` "es seguro" — devuelve la dirección recuperada incluso para firmas con `s` en la mitad alta. La validación es responsabilidad del que llama.

---

### 8.3 ¿Front-running? ¿MEV?

**Respuesta corta:** Sí, técnicamente alguien podría ver tu tx de `storeDocumentHash` en el mempool, copiar el `(hash, timestamp, signature, signer)` y mandarla con más gas para registrarla antes que vos. Pero **el front-runner no gana nada** — la firma sigue siendo tuya, solo cambia quién pagó el gas para guardarla. Para esta dApp el MEV es irrelevante.

**Profundización:** MEV (Maximal Extractable Value) sí importa en DEXs, lending, NFT mints — donde el orden de ejecución cambia el outcome económico. En un registro de hashes, el orden no importa.

**Trampas:**
- Asumir que toda dApp es vulnerable a MEV — no, depende del modelo económico. Sin upside extraíble, no hay incentivo a front-runnear.

---

### 8.4 Si esto fuera mainnet, ¿qué cambiarías de seguridad?

**Respuesta corta:** Tres cambios mínimos: (1) auditoría externa del contrato, (2) deshacerme del modelo "private keys en frontend" y migrar a wallets reales (que ya hice en `testnet`), (3) un RPC propio detrás de un API route, no `NEXT_PUBLIC_*`.

**Profundización:**
- Tests de fuzzing extensos antes de deploy.
- Considerar un `Pausable` (OpenZeppelin) por si descubrís un bug post-deploy.
- Considerar `Ownable` + admin functions para emergency response — aunque rompe la "trustlessness", es una decisión de trade-off.
- Verificar el contrato en Etherscan post-deploy.
- Bug bounty (Immunefi) para escala real.

**Trampas:**
- Asumir que "testnet == mainnet con monopoly money". No: en testnet la gente perdona errores, en mainnet pierde dinero real, y ningún test reproduce 100% el comportamiento adversarial de mainnet.

---

### 8.5 ¿Y las private keys del mnemonic de Anvil? ¿Por qué eso "está bien"?

**Respuesta corta:** Porque el mnemonic `"test test ... junk"` es **público y conocido** — viene hardcoded en Anvil/Hardhat para todos los devs del mundo. Las wallets derivadas no tienen ETH real ni en testnet, solo en tu Anvil local que vive en tu máquina. Es deliberadamente inseguro para hacer dev rápido.

**Profundización:** Hay un patrón en el ecosistema: las cuentas `[0..9]` de Anvil tienen la misma key en todos lados, lo que permite que tutoriales, tests, scripts compartan ejemplos sin pedir setup. **Pero**: si alguna vez le mandás ETH real a una de esas direcciones, lo perdés en segundos — bots monitorean y barren cualquier ETH que aterrice ahí.

**Trampas:**
- Reusar la misma key para algo "no tan público" — no, es 100% pública y monitoreada.

---

## 9. Decisiones de arquitectura y trade-offs

### 9.1 ¿Por qué dos ramas y no una?

**Respuesta corta:** La rama `anvil-local` cumple el enunciado del curso (sin MetaMask, ethers v6, Anvil). La rama `testnet` extiende el proyecto a un escenario realista (wallets reales, multichain, deploy en Vercel). Mantengo ambas para mostrar la evolución y porque cada una sirve a un público distinto.

**Profundización:** Las dos ramas comparten el smart contract idéntico (`sc/`), solo cambia el frontend. Eso prueba un punto importante: **el contrato es agnóstico al frontend**. Mismo contrato, dos UIs diferentes, mismo resultado on-chain.

**Trampas:** Decir "la viaja es peor" → no, la `anvil-local` es la más fiel al enunciado del curso. La `testnet` es una extensión.

---

### 9.2 ¿Si tuvieras que escalar esto a 1M de documentos, qué cambiarías?

**Respuesta corta:** El cuello de botella es el array `documentHashes[]` que crece linealmente. La iteración en frontend (N reads on-chain) ya escala mal a partir de unos miles. Movería el "historial completo" a un indexer (`The Graph`, `Goldsky`) que escucha el evento `DocumentStored` off-chain, y dejaría on-chain solo el lookup directo por hash.

**Profundización:**
- Eliminar `documentHashes[]` y `getDocumentHashByIndex` → save de gas en cada write.
- Indexer escucha `DocumentStored` y arma una DB con paginación.
- Frontend pega al GraphQL del indexer para historiales, paginación, filtros por signer.
- Solo usa el contrato para writes y verificaciones puntuales.

**Trampas:**
- Querer hacer paginación on-chain con un loop → el límite de gas por bloque (~30M) te bloquea muy rápido.

---

### 9.3 ¿Qué harías diferente si lo arrancaras hoy?

**Respuesta corta:** Tres cosas: (1) usar EIP-712 typed data en lugar de `personal_sign` para que el usuario vea exactamente qué firma, (2) arrancar directo con `wagmi/RainbowKit` y saltarme el modelo Anvil-with-mnemonic, (3) agregar un indexer desde el día 1 para el historial.

**Profundización:**
- EIP-712 te da firmas estructuradas: el wallet popup muestra "Sign DocumentRegistration { hash: 0x..., timestamp: ... }" en vez de un blob hex.
- Skipear Anvil le quita didáctica al proyecto, pero acelera la rampa al stack moderno.
- Indexer-first evita que escribas la lógica de iteración on-chain que después borrás.

**Trampas:** Decir "lo haría perfecto" → se nota inmediatamente. Mostrar trade-offs reales es mejor.

---

### 9.4 ¿Por qué Foundry y no Hardhat para este proyecto?

**Respuesta corta:** Tres razones: (1) tests en Solidity son más expresivos para verificar invariantes de Solidity, (2) `forge test` es órdenes de magnitud más rápido — feedback loop en el dev cycle, (3) `anvil` viene en el mismo toolchain, sin instalar otra cosa.

**Profundización:**
- Hardhat brilla cuando integrás con un ecosistema JS pesado (TypeChain, deploy scripts complejos, plugins).
- Foundry brilla cuando el proyecto es Solidity-first, con fuzzing/invariant testing, y querés velocidad.
- Para una dApp educativa con un solo contrato, Foundry gana en simplicidad.

**Trampas:** "Hardhat está deprecado" — no, sigue muy vivo. Es preferencia de stack.

---

## 10. Behavioral / del proyecto

### 10.1 Contame el bug más difícil que debugueaste en este proyecto

**Respuesta corta:** Un error que aparecía como un revert del smart contract con el mensaje "The contract function storeDocumentHash reverted: Request is being rate limited". Era engañoso porque NO era un revert: era un `429 Too Many Requests` del RPC público que viem envolvía dentro del wrapper de "contract reverted". Pasé tiempo buscando en Solidity un require que no existía, hasta que mirando el call al RPC vi el 429 real.

**Profundización:** El fix fue cambiar de `http(rpcUrl)` a `fallback([http(rpc1), http(rpc2), http(rpc3)])` en `dapp/lib/wagmi.ts`. El flujo de firma dispara ~10 requests seguidos (`isDocumentStored` + `writeContract` + 8-10 polls de `waitForTransactionReceipt`) → los RPCs públicos bloquean rápido. `fallback` rota automáticamente cuando uno tira 429.

**Lección que me llevo:**
- No confiar en el primer mensaje de error: buscar el frame original.
- Los wrappers de errores de viem/ethers a veces ocultan información clave.
- En cualquier flujo Web3 con varios reads/writes seguidos, asumir que un solo RPC público no alcanza.

---

### 10.2 ¿Qué fue lo más "AHA" que aprendiste haciendo este proyecto?

**Respuesta corta:** Que **no se almacenan documentos on-chain** — se almacenan huellas. Y que la "verificación" no es chequear que el documento exista en el contrato, es **recalcular el hash desde el archivo original y compararlo**. La integridad viene de la función de hash, el contrato solo da timestamp y autoría.

**Profundización:** El primer instinto de cualquiera viniendo de Web2 es "guardo el archivo en una DB y lo busco después". On-chain ese modelo es prohibitivamente caro (1 KB ≈ 640.000 gas) y compromete privacidad (todo es público). El patrón correcto: **archivo off-chain, hash on-chain**. La cadena solo certifica.

---

### 10.3 ¿Cómo extenderías este proyecto si tuvieras un mes más?

**Respuesta corta:** Tres features: (1) compartir documentos firmados con otros wallets para co-firma multi-parte, (2) IPFS/Arweave para opcionalmente subir el archivo y guardar el CID en el contrato, (3) batch register con merkle roots para registrar miles de documentos en una sola tx.

**Profundización:**
- **Multi-firma**: nuevo método `addCosigner(hash, cosigner)` y un mapping `documentCosigners[hash] => address[]`. Verificación devuelve también el set de cosignatarios.
- **IPFS**: subo archivo a IPFS desde el frontend (cliente Pinata/Web3.Storage), guardo el `CID` como `string` en el struct. La integridad sigue siendo el `keccak256` (no el CID, que es `multihash`).
- **Batch + Merkle**: para mass-registration, calculo `merkleRoot(documentos)`, lo guardo en una sola entrada, y los proofs los almaceno off-chain. Gas: O(1) por batch en lugar de O(N).

---

### 10.4 ¿Cuál es el riesgo más subestimado de este tipo de dApp?

**Respuesta corta:** Que el usuario crea que "registrar el hash on-chain" significa "el documento tiene validez legal". No la tiene per se — depende totalmente de la jurisdicción. La firma `ECDSA` no equivale a una firma cualificada (eIDAS en UE, Ley 25.506 en Argentina). El sistema prueba integridad y autoría sobre una identidad criptográfica, no sobre una identidad legal.

**Profundización:** Para validez legal habría que: (1) atar la wallet a una identidad verificada (KYC), (2) usar un Trust Service Provider acreditado, (3) cumplir requisitos de archivo y trazabilidad locales. Una dApp así puede ser una **capa de evidencia** complementaria a un sistema legal, no un reemplazo.

---

## Apéndice: cheat sheet de comandos

### Smart contracts (`sc/`)
```bash
forge build                      # compilar
forge test -vv                   # tests con logs
forge test --match-test <name>   # un test específico
forge coverage                   # cobertura
forge script script/Deploy.s.sol --rpc-url <url> --broadcast --account <name>
```

### Frontend rama `anvil-local` (`dapp/`)
```bash
anvil                            # nodo local en :8545
forge script ... --broadcast     # deploy contrato a Anvil
# pegar address en .env.local
npm run dev                      # http://localhost:3000
```

### Frontend rama `testnet` (`dapp/`)
```bash
# .env.local con NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
npm run dev
# para deploy: push a `testnet` → Vercel auto-deploys
```

### Cast (interacción CLI con contratos)
```bash
cast call <address> "getDocumentCount()(uint256)" --rpc-url <url>
cast send <address> "storeDocumentHash(bytes32,uint256,bytes,address)" \
  <hash> <ts> <sig> <signer> --rpc-url <url> --account <name>
cast logs --address <contract> --from-block <n> "DocumentStored(bytes32,address,uint256)"
```

---

> **Tip final para la entrevista**: si te preguntan algo que no sabés, decí "no sé, pero la lógica que aplicaría sería X". Los entrevistadores buscan razonamiento, no memorización. Y conocer **los trade-offs** de tus decisiones es mucho más valioso que defenderlas como "la mejor opción".
