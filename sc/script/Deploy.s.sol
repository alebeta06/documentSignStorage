// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {DocumentRegistry} from "../src/DocumentRegistry.sol";

/**
 * @title Deploy
 * @notice Despliega DocumentRegistry en la red configurada por --rpc-url.
 *
 * Uso (desde sc/):
 *   forge script script/Deploy.s.sol \
 *     --rpc-url http://localhost:8545 \
 *     --broadcast \
 *     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
 *
 * La private key es la cuenta [0] de Anvil (pública y conocida — no es un secreto).
 *
 * El log "DocumentRegistry deployed at: 0x..." que imprime esta función
 * es la dirección que hay que pegar en dapp/.env.local como NEXT_PUBLIC_CONTRACT_ADDRESS.
 */
contract Deploy is Script {
    function run() external returns (DocumentRegistry registry) {
        // startBroadcast firma con la private key pasada por flag (--private-key)
        // y emite las txs subsiguientes en la red real.
        vm.startBroadcast();

        registry = new DocumentRegistry();

        vm.stopBroadcast();

        console.log("DocumentRegistry deployed at:", address(registry));
    }
}
