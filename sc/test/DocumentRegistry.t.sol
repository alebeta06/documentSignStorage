// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DocumentRegistry} from "../src/DocumentRegistry.sol";

/**
 * @title DocumentRegistryTest
 * @notice Suite de 11 tests cubriendo todas las funciones del contrato y sus casos de error.
 *
 * Convención de naming: test_<Funcion>_<Escenario>
 *  - happy path: test_StoreDocumentHash
 *  - revert:     test_StoreDocumentHash_RevertsIfAlreadyExists
 */
contract DocumentRegistryTest is Test {
    DocumentRegistry internal registry;

    // Wallets de prueba: pares (privateKey, address) que vamos a reusar.
    // En Foundry usamos enteros como "claves privadas" — son válidas siempre que
    // estén en el rango de la curva secp256k1.
    uint256 internal alicePk = 0xA11CE;
    uint256 internal bobPk = 0xB0B;
    address internal alice;
    address internal bob;

    // Hash de un "archivo" cualquiera. En realidad es solo un bytes32 fijo
    // — para los tests no nos importa de dónde sale el hash, solo que sea único.
    bytes32 internal constant DOC_HASH = keccak256("hello world");

    /// @dev setUp se ejecuta ANTES de cada test (estado limpio).
    function setUp() public {
        registry = new DocumentRegistry();
        alice = vm.addr(alicePk); // deriva la address a partir de la pk
        bob = vm.addr(bobPk);
    }

    // ─────────────────────────────────────────────────────────
    // Helper: firma un hash imitando lo que hace ethers.signMessage
    // (prefijo "\x19Ethereum Signed Message:\n32" + hash, luego firma ECDSA).
    // ─────────────────────────────────────────────────────────
    function _signHash(uint256 _pk, bytes32 _hash)
        internal
        pure
        returns (bytes memory signature)
    {
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", _hash)
        );
        // vm.sign devuelve los componentes (v, r, s) de la firma.
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_pk, ethSignedHash);
        // Concatenamos r || s || v en un único bytes de 65.
        signature = abi.encodePacked(r, s, v);
    }

    // ─────────────────────────────────────────────────────────
    // 1) HAPPY PATH: guardar
    // ─────────────────────────────────────────────────────────
    function test_StoreDocumentHash() public {
        bytes memory sig = _signHash(alicePk, DOC_HASH);
        registry.storeDocumentHash(DOC_HASH, block.timestamp, sig, alice);

        // Verificamos que ahora existe.
        assertTrue(registry.isDocumentStored(DOC_HASH));
        assertEq(registry.getDocumentCount(), 1);
    }

    // ─────────────────────────────────────────────────────────
    // 2) REVERT: hash duplicado
    // ─────────────────────────────────────────────────────────
    function test_StoreDocumentHash_RevertsIfAlreadyExists() public {
        bytes memory sig = _signHash(alicePk, DOC_HASH);
        registry.storeDocumentHash(DOC_HASH, block.timestamp, sig, alice);

        // Segundo intento con el mismo hash debería revertir.
        vm.expectRevert(bytes("Document already exists"));
        registry.storeDocumentHash(DOC_HASH, block.timestamp, sig, alice);
    }

    // ─────────────────────────────────────────────────────────
    // 3) REVERT: signer == address(0)
    // ─────────────────────────────────────────────────────────
    function test_StoreDocumentHash_RevertsIfSignerIsZero() public {
        bytes memory sig = _signHash(alicePk, DOC_HASH);
        vm.expectRevert(bytes("Invalid signer"));
        registry.storeDocumentHash(DOC_HASH, block.timestamp, sig, address(0));
    }

    // ─────────────────────────────────────────────────────────
    // 4) REVERT: signature.length != 65
    // ─────────────────────────────────────────────────────────
    function test_StoreDocumentHash_RevertsIfSignatureLengthInvalid() public {
        bytes memory badSig = hex"deadbeef"; // 4 bytes en lugar de 65
        vm.expectRevert(bytes("Invalid signature length"));
        registry.storeDocumentHash(DOC_HASH, block.timestamp, badSig, alice);
    }

    // ─────────────────────────────────────────────────────────
    // 5) Event DocumentStored se emite
    // ─────────────────────────────────────────────────────────
    event DocumentStored(bytes32 indexed hash, address indexed signer, uint256 timestamp);

    function test_StoreDocumentHash_EmitsEvent() public {
        bytes memory sig = _signHash(alicePk, DOC_HASH);

        // expectEmit(checkTopic1, checkTopic2, checkTopic3, checkData)
        // Comprobamos los 2 topics indexed (hash y signer) + el data (timestamp).
        vm.expectEmit(true, true, false, true);
        emit DocumentStored(DOC_HASH, alice, block.timestamp);

        registry.storeDocumentHash(DOC_HASH, block.timestamp, sig, alice);
    }

    // ─────────────────────────────────────────────────────────
    // 6) verifyDocument: firma válida → true
    // ─────────────────────────────────────────────────────────
    function test_VerifyDocument_ValidSignature() public {
        bytes memory sig = _signHash(alicePk, DOC_HASH);
        registry.storeDocumentHash(DOC_HASH, block.timestamp, sig, alice);

        bool ok = registry.verifyDocument(DOC_HASH, alice, sig);
        assertTrue(ok);
    }

    // ─────────────────────────────────────────────────────────
    // 7) verifyDocument: signer pasado != quien firmó → false
    // ─────────────────────────────────────────────────────────
    function test_VerifyDocument_WrongSigner() public {
        bytes memory sig = _signHash(alicePk, DOC_HASH); // firma alice
        registry.storeDocumentHash(DOC_HASH, block.timestamp, sig, alice);

        // Pasamos a Bob como supuesto signer — ecrecover devolverá alice, comparación false.
        bool ok = registry.verifyDocument(DOC_HASH, bob, sig);
        assertFalse(ok);
    }

    // ─────────────────────────────────────────────────────────
    // 8) verifyDocument: hash no registrado → false (sin revert)
    // ─────────────────────────────────────────────────────────
    function test_VerifyDocument_NonExistentHash() public view {
        bytes32 unknownHash = keccak256("nope");
        bytes memory dummySig = new bytes(65); // 65 ceros, no importa
        bool ok = registry.verifyDocument(unknownHash, alice, dummySig);
        assertFalse(ok);
    }

    // ─────────────────────────────────────────────────────────
    // 9) getDocumentInfo devuelve el struct correcto
    // ─────────────────────────────────────────────────────────
    function test_GetDocumentInfo() public {
        bytes memory sig = _signHash(alicePk, DOC_HASH);
        registry.storeDocumentHash(DOC_HASH, 1234567890, sig, alice);

        DocumentRegistry.Document memory doc = registry.getDocumentInfo(DOC_HASH);
        assertEq(doc.hash, DOC_HASH);
        assertEq(doc.timestamp, 1234567890);
        assertEq(doc.signer, alice);
        assertEq(doc.signature, sig);
    }

    // ─────────────────────────────────────────────────────────
    // 10) getDocumentInfo revierte si no existe
    // ─────────────────────────────────────────────────────────
    function test_GetDocumentInfo_RevertsIfNotExists() public {
        vm.expectRevert(bytes("Document does not exist"));
        registry.getDocumentInfo(keccak256("ghost"));
    }

    // ─────────────────────────────────────────────────────────
    // 11) getDocumentCount + getDocumentHashByIndex permiten iterar el historial
    // ─────────────────────────────────────────────────────────
    function test_GetDocumentCount_AndIterate() public {
        bytes32 h1 = keccak256("doc-1");
        bytes32 h2 = keccak256("doc-2");

        registry.storeDocumentHash(h1, block.timestamp, _signHash(alicePk, h1), alice);
        registry.storeDocumentHash(h2, block.timestamp, _signHash(bobPk, h2), bob);

        assertEq(registry.getDocumentCount(), 2);
        assertEq(registry.getDocumentHashByIndex(0), h1);
        assertEq(registry.getDocumentHashByIndex(1), h2);

        // index fuera de rango debería revertir
        vm.expectRevert(bytes("Index out of bounds"));
        registry.getDocumentHashByIndex(2);
    }
}
