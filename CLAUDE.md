# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Visión general

dApp para **almacenar y verificar la autenticidad de documentos** sobre Ethereum. El usuario sube un archivo, el frontend calcula el hash `keccak256`, lo firma con una wallet (ECDSA) y persiste `hash + signature + timestamp + signer` en un smart contract. Cualquier persona puede luego volver a subir el mismo archivo y comparar el hash on-chain para verificar que no fue alterado y quién lo firmó.

Es un proyecto educativo del curso **CODECRYPTO** (desarrollo de dApps con Ethereum). El stack está pensado para correr 100% en local con Anvil — no requiere testnet ni MetaMask.

## Estructura del repositorio

```
sc/      Smart contracts en Solidity, gestionados con Foundry
dapp/    Frontend Next.js + TypeScript + ethers.js v6
```

Cada carpeta es un sub-proyecto independiente con sus propias dependencias.

## Comandos clave

### Smart contracts (`sc/`)

```bash
forge build                      # Compilar contratos
forge test -vv                   # Tests con logs (objetivo: 11/11 pasando)
forge test --match-test <name>   # Correr un test individual
forge coverage                   # Cobertura de código (objetivo: >80%)
forge clean                      # Limpiar cache/ y out/
```

### Frontend (`dapp/`)

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

### Nodo local

```bash
anvil                  # Nodo Ethereum local en http://localhost:8545, chainId 31337
anvil --accounts 20    # Más cuentas si se necesitan
```

## Flujo de desarrollo local (3 terminales)

El orden importa: cada paso depende del anterior.

1. **Terminal 1** — `anvil` (queda corriendo).
2. **Terminal 2** — desde `sc/`, deployar el contrato:
   ```bash
   forge script script/Deploy.s.sol \
     --rpc-url http://localhost:8545 \
     --broadcast \
     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
   ```
   Copiar la dirección que se loggea.
3. Pegar esa dirección en `dapp/.env.local` como `NEXT_PUBLIC_CONTRACT_ADDRESS`.
4. **Terminal 3** — desde `dapp/`, `npm run dev`.

> La private key del paso 2 es la cuenta `[0]` por defecto de Anvil — es pública y conocida, no es un secreto.

## Arquitectura del smart contract

`sc/src/DocumentRegistry.sol` — único contrato del sistema.

**Storage**:
- `mapping(bytes32 => Document) documents` — indexado por hash del archivo.
- `bytes32[] documentHashes` — array para iterar el historial por índice.

**Struct `Document`**: `bytes32 hash`, `uint256 timestamp`, `address signer`, `bytes signature`.

**API pública**:
- `storeDocumentHash(hash, timestamp, signature, signer)` — registra un documento nuevo.
- `verifyDocument(hash, signer, signature) → bool` — valida firma y existencia.
- `getDocumentInfo(hash) → Document` — devuelve el struct completo.
- `isDocumentStored(hash) → bool` — existencia.
- `getDocumentCount() → uint256` — total para iterar.
- `getDocumentHashByIndex(index) → bytes32` — itera el historial.

**Modifiers**: `documentNotExists` y `documentExists`, ambos chequean `documents[_hash].signer == address(0)` (o `!=`).

## Arquitectura del frontend

### Conexión a la blockchain — sin MetaMask

`dapp/contexts/MetaMaskContext.tsx` (el nombre es histórico, **no usa MetaMask**) provee el wallet state global vía Context API:

- Deriva 10 wallets desde el mnemonic de Anvil con `ethers.HDNodeWallet.fromPhrase` y el path `m/44'/60'/0'/0/${i}`.
- Usa `ethers.JsonRpcProvider('http://localhost:8545')` — **no** `BrowserProvider`.
- Expone `connect(walletIndex)`, `disconnect()`, `signMessage()`, `getSigner()`, `switchWallet()`.

El usuario elige qué wallet usar desde un dropdown en la UI; cambiar de wallet es instantáneo (no hay popup ni firma externa).

### Hook `useContract`

`dapp/hooks/useContract.ts` envuelve el contrato con su ABI y expone funciones tipadas (`storeDocumentHash`, `getDocumentInfo`, etc.). Internamente hace `contract.connect(signer)` para las funciones que mutan estado.

### Componentes y página principal

- `FileUploader` — calcula `keccak256` del archivo y emite el hash al padre.
- `DocumentSigner` — firma el hash, muestra alerts de confirmación, y envía la tx de `storeDocumentHash`.
- `DocumentVerifier` — recalcula hash, llama `isDocumentStored` + `getDocumentInfo`, compara signer.
- `DocumentHistory` — itera con `getDocumentCount` + `getDocumentHashByIndex` y arma una tabla.
- `dapp/app/page.tsx` — tabs `Upload & Sign | Verify | History` + selector de wallet + estado de conexión.

## Decisiones de diseño NO obvias

Estas son trampas frecuentes — respetarlas al modificar el código:

1. **El struct `Document` NO tiene campo `bool exists`** y **NO existe un mapping `hashExists` paralelo**. La existencia se chequea con `documents[hash].signer != address(0)`. Esto ahorra ~39% de gas en storage. Si alguien sugiere "agregar un flag exists para mayor claridad", no hacerlo.
2. **El frontend deriva wallets del mnemonic, no integra MetaMask**. El nombre `MetaMaskContext` es histórico; reemplazarlo o conectar a una wallet real cambia el modelo de uso del proyecto.
3. **Provider es `JsonRpcProvider`, no `BrowserProvider`**. Eso permite que la dApp funcione sin extensión de navegador, pero implica que las private keys viven en el contexto del frontend (aceptable solo porque el target es Anvil local).
4. **El mnemonic por defecto es público**: `"test test test test test test test test test test test junk"` — es el de Anvil, no es un secreto. Aun así, `dapp/.env.local` no se commitea.

## Variables de entorno

`dapp/.env.local` (no se versiona):

```
NEXT_PUBLIC_CONTRACT_ADDRESS=0x...     # Sale del forge script tras deploy
NEXT_PUBLIC_RPC_URL=http://localhost:8545
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_MNEMONIC="test test test test test test test test test test test junk"
```

Todas son `NEXT_PUBLIC_*` porque se consumen del cliente. Cada vez que se redeploya el contrato hay que actualizar `NEXT_PUBLIC_CONTRACT_ADDRESS` y reiniciar `npm run dev`.

## Git hygiene

`.gitignore` debe excluir `sc/lib/`, `sc/cache/`, `sc/out/`, `sc/broadcast/`, `dapp/node_modules/`, `dapp/.next/`, `dapp/.env.local`. El repo versionado debería pesar ~50 KB — si crece mucho más, casi seguro entró algo de esas carpetas.
