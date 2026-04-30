// SPDX-License-Identifier: MIT
// El SPDX es un estándar de licencias. Foundry lo exige (warning si falta).
// MIT = licencia permisiva, código libre.

pragma solidity ^0.8.20;
// pragma fija la versión del compilador.
// ^0.8.20 = "compatible con 0.8.20 o superior dentro de la 0.8.x".
// La 0.8.x trae checks de overflow/underflow automáticos (antes había que usar SafeMath).

/**
 * @title DocumentRegistry
 * @notice Registro on-chain de hashes de documentos firmados con ECDSA.
 * @dev Almacena (hash, signer, signature, timestamp). Indexa por hash.
 *      No usa flag `exists` — la existencia se infiere de signer != address(0).
 */
contract DocumentRegistry {
    // ─────────────────────────────────────────────────────────
    // TIPOS
    // ─────────────────────────────────────────────────────────

    /// @dev Toda la info que guardamos por documento.
    struct Document {
        bytes32 hash;       // keccak256 del archivo (lo recalculamos para verificación cruzada)
        uint256 timestamp;  // momento del registro (segundos UNIX)
        address signer;     // wallet que firmó. Si es address(0) => slot vacío.
        bytes signature;    // firma ECDSA de 65 bytes (r || s || v)
    }

    // ─────────────────────────────────────────────────────────
    // STORAGE
    // ─────────────────────────────────────────────────────────

    /// @dev Tabla principal: hash del archivo => datos del documento.
    /// El mapping es la fuente de verdad para lookup O(1) por hash.
    mapping(bytes32 => Document) private documents;

    /// @dev Array paralelo solo para poder iterar (mapping no es iterable).
    /// Cada vez que registramos un nuevo documento empujamos su hash aquí.
    bytes32[] private documentHashes;

    // ─────────────────────────────────────────────────────────
    // EVENTS
    // ─────────────────────────────────────────────────────────

    /// @notice Se emite cuando un documento se registra exitosamente.
    /// @dev `indexed` permite filtrar este event por hash o signer desde el frontend.
    event DocumentStored(
        bytes32 indexed hash,
        address indexed signer,
        uint256 timestamp
    );

    // ─────────────────────────────────────────────────────────
    // MODIFIERS
    // ─────────────────────────────────────────────────────────

    /// @dev Revierte si el hash YA está registrado.
    /// Lo usamos en storeDocumentHash para impedir doble-registro.
    modifier documentNotExists(bytes32 _hash) {
        require(
            documents[_hash].signer == address(0),
            "Document already exists"
        );
        _; // marca dónde se ejecuta el cuerpo de la función decorada
    }

    /// @dev Revierte si el hash NO está registrado.
    /// Lo usamos en getters para fallar rápido si piden algo inexistente.
    modifier documentExists(bytes32 _hash) {
        require(
            documents[_hash].signer != address(0),
            "Document does not exist"
        );
        _;
    }

    // ─────────────────────────────────────────────────────────
    // FUNCIONES DE ESCRITURA
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Registra un documento firmado.
     * @param _hash       keccak256 del archivo.
     * @param _timestamp  Segundos UNIX (lo manda el cliente — para auditoría off-chain).
     * @param _signature  Firma ECDSA del hash hecha por _signer.
     * @param _signer     Dirección que firmó.
     *
     * Validaciones:
     *  - El documento NO debe existir aún (modifier).
     *  - El signer no puede ser address(0).
     *  - La firma debe tener 65 bytes (r=32, s=32, v=1).
     *
     * NOTA de diseño: NO verificamos la firma on-chain en esta función para ahorrar gas.
     * La verificación se hace en `verifyDocument`. La premisa es: "el contrato persiste,
     * el verificador valida". Si quisieras forzar firma válida al guardar, podrías
     * añadir la verificación aquí; es un trade-off costo vs. integridad.
     */
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

    // ─────────────────────────────────────────────────────────
    // FUNCIONES DE LECTURA
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Verifica que el documento exista y que la firma corresponda al signer.
     * @return true si el hash está registrado y `ecrecover(digest, signature) == _signer`.
     *
     * Cómo funciona ECDSA en Ethereum:
     *  1. El cliente firma `keccak256("\x19Ethereum Signed Message:\n32" || hash)`.
     *     Ese prefijo lo añade `personal_sign` (lo que hace ethers `signMessage`).
     *  2. Aquí reconstruimos ese digest y llamamos a ecrecover.
     *  3. ecrecover devuelve la dirección que produjo la firma. Si coincide con _signer, ok.
     */
    function verifyDocument(
        bytes32 _hash,
        address _signer,
        bytes memory _signature
    ) external view returns (bool) {
        // 1) Si no existe, no hay nada que verificar.
        if (documents[_hash].signer == address(0)) return false;

        // 2) Reconstruir el digest "Ethereum Signed Message".
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", _hash)
        );

        // 3) Splitear la firma en r, s, v.
        if (_signature.length != 65) return false;
        bytes32 r;
        bytes32 s;
        uint8 v;
        // assembly = leer/escribir memoria/storage a bajo nivel.
        // Aquí lo usamos para parsear la firma en sus 3 componentes
        // (es la forma idiomática en Solidity, no hay otra más segura sin librerías).
        assembly {
            r := mload(add(_signature, 32))   // primeros 32 bytes después del length-prefix
            s := mload(add(_signature, 64))
            v := byte(0, mload(add(_signature, 96)))
        }

        // 4) Recuperar la dirección y comparar.
        address recovered = ecrecover(ethSignedHash, v, r, s);
        return recovered == _signer;
    }

    /// @notice Devuelve el struct completo de un documento.
    function getDocumentInfo(bytes32 _hash)
        external
        view
        documentExists(_hash)
        returns (Document memory)
    {
        return documents[_hash];
    }

    /// @notice Existencia (no revierte, devuelve bool).
    function isDocumentStored(bytes32 _hash) external view returns (bool) {
        return documents[_hash].signer != address(0);
    }

    /// @notice Total de documentos registrados (para iterar desde el frontend).
    function getDocumentCount() external view returns (uint256) {
        return documentHashes.length;
    }

    /// @notice Hash en una posición del array — combinado con getDocumentInfo arma el historial.
    function getDocumentHashByIndex(uint256 _index)
        external
        view
        returns (bytes32)
    {
        require(_index < documentHashes.length, "Index out of bounds");
        return documentHashes[_index];
    }
}
