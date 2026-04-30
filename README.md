# Document Sign Storage

dApp educativa (curso **CODECRYPTO**) para almacenar y verificar la autenticidad de documentos sobre Ethereum.

El usuario sube un archivo, el frontend calcula su `keccak256`, lo firma con una wallet (ECDSA) y persiste `hash + signature + timestamp + signer` on-chain. Cualquier persona puede luego volver a subir el mismo archivo y comparar el hash on-chain para verificar que no fue alterado y quién lo firmó.

Corre 100% en local con [Anvil](https://book.getfoundry.sh/anvil/) — no requiere testnet ni MetaMask.

## Estructura

```
sc/      Smart contracts (Solidity + Foundry)
dapp/    Frontend (Next.js 16 + TypeScript + ethers v6 + Tailwind 4)
```

## Stack

| Capa | Tecnología |
|------|------------|
| Smart contract | Solidity ^0.8.20, Foundry (forge + anvil + cast) |
| Frontend | Next.js 16 (App Router) + React 19 + TypeScript |
| Wallet / blockchain | ethers v6 (`HDNodeWallet`, `JsonRpcProvider`) |
| Estilos | Tailwind CSS 4 |
| Red | Anvil local en `http://localhost:8545`, chainId `31337` |

## Setup

Una sola vez al clonar el repo:

```bash
# Smart contracts
cd sc
forge install     # baja forge-std

# Frontend
cd ../dapp
npm install
cp .env.local.example .env.local   # si existiera plantilla; si no, ver sección "Variables de entorno"
```

## Correr la dApp (3 terminales)

El orden importa: cada paso depende del anterior.

### Terminal 1 — nodo Ethereum local

```bash
anvil
```

Queda corriendo en `http://localhost:8545` con 10 wallets pre-cargadas (10000 ETH cada una).

### Terminal 2 — deployar el contrato

```bash
cd sc
forge script script/Deploy.s.sol \
  --rpc-url http://localhost:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

> La private key es la cuenta `[0]` por defecto de Anvil — es **pública y conocida**, no es un secreto.

La address del contrato deployado queda en `sc/broadcast/Deploy.s.sol/31337/run-latest.json` bajo el campo `contractAddress`. Como Anvil es determinístico, siempre será:

```
0x5FbDB2315678afecb367f032d93F642f64180aa3
```

Esa misma address está pre-cargada en `dapp/.env.local` como `NEXT_PUBLIC_CONTRACT_ADDRESS`. Solo hay que cambiarla si modificás el orden de las transacciones de despliegue.

### Terminal 3 — frontend

```bash
cd dapp
npm run dev
```

Abre `http://localhost:3000`.

## Variables de entorno (`dapp/.env.local`)

```
NEXT_PUBLIC_CONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
NEXT_PUBLIC_RPC_URL=http://localhost:8545
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_MNEMONIC="test test test test test test test test test test test junk"
```

Todas son `NEXT_PUBLIC_*` porque las consume el cliente. El mnemonic es el default público de Anvil.

## Flujo de prueba en el browser

1. Seleccioná una wallet del dropdown (cualquiera de las 10).
2. Tab **Upload & Sign** → subí cualquier archivo (PDF, imagen, lo que sea).
3. Esperá un instante a que calcule `keccak256`.
4. Click en **Firmar y registrar on-chain**. La firma es instantánea (no abre popups).
5. Tab **History** → tu documento aparece en la tabla.
6. Tab **Verify** → subí el **mismo archivo** otra vez → "Documento auténtico", muestra quién lo firmó.
7. **Probá modificar el archivo** (renombrá un byte) y subílo en Verify → "Documento no registrado".

## Detener la ejecución

### Forma manual (recomendada en cada terminal)

`Ctrl+C` en cada una de las 3 terminales.

### Forma rápida desde otra terminal

```bash
# Mata Anvil + dev server de Next con un solo comando
kill $(pgrep -f anvil) $(pgrep -f "next dev") 2>/dev/null

# O más violento:
pkill -f anvil
pkill -f "next dev"
```

### Reiniciar todo desde cero

Anvil arranca con estado vacío, así que cada vez que lo bajás y volvés a levantar:

1. `anvil` (Terminal 1)
2. Redeployar el contrato (Terminal 2)
3. `npm run dev` no necesita reiniciar — sigue funcionando con el dev server abierto.

Solo si la address del contrato cambió (caso raro porque Anvil es determinístico), hay que actualizar `dapp/.env.local` y reiniciar `npm run dev`.

## Comandos útiles

### Smart contracts (`sc/`)

```bash
forge build                      # Compilar
forge test -vv                   # Tests con logs (objetivo: 11/11)
forge test --match-test <name>   # Correr un test individual
forge coverage                   # Cobertura (objetivo: >80%)
forge clean                      # Limpiar cache/ y out/
```

### Verificación on-chain con `cast`

```bash
# ¿Cuántos documentos registrados?
cast call 0x5FbDB2315678afecb367f032d93F642f64180aa3 \
  "getDocumentCount()(uint256)" \
  --rpc-url http://localhost:8545

# ¿Existe este hash?
cast call 0x5FbDB2315678afecb367f032d93F642f64180aa3 \
  "isDocumentStored(bytes32)(bool)" 0x<hash> \
  --rpc-url http://localhost:8545
```

### Frontend (`dapp/`)

```bash
npm run dev      # development server (http://localhost:3000)
npm run build    # production build
npm run lint     # ESLint
npx tsc --noEmit # type check sin emitir archivos
```

## Estudiar el código

Para repasar el proyecto pieza por pieza, ver [`WALKTHROUGH.md`](./WALKTHROUGH.md).

## Decisiones de diseño no obvias

Documentadas en [`CLAUDE.md`](./CLAUDE.md). En resumen:

1. El struct `Document` **no tiene flag `exists`**. Se infiere por `signer != address(0)` (ahorra ~39% de gas en storage).
2. El frontend **deriva wallets del mnemonic**, no integra MetaMask. El nombre `MetaMaskContext` es histórico.
3. El provider es `JsonRpcProvider`, no `BrowserProvider` — la dApp funciona sin extensión, pero las private keys viven en el contexto del frontend (aceptable solo porque el target es Anvil local).
4. El mnemonic por defecto (`"test test test test test test test test test test test junk"`) es el público de Anvil. No es un secreto.

## Licencia

MIT — proyecto educativo del curso CODECRYPTO.
