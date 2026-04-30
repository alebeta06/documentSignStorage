/**
 * ABI generada por `forge build` y copiada manualmente.
 * Si modificás el contrato, recordá regenerar este archivo.
 *
 * Origen: sc/out/DocumentRegistry.sol/DocumentRegistry.json (campo .abi)
 */
export const DocumentRegistryABI = [
  {
    "type": "function",
    "name": "getDocumentCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getDocumentHashByIndex",
    "inputs": [
      {
        "name": "_index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getDocumentInfo",
    "inputs": [
      {
        "name": "_hash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct DocumentRegistry.Document",
        "components": [
          {
            "name": "hash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "timestamp",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "signer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isDocumentStored",
    "inputs": [
      {
        "name": "_hash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "storeDocumentHash",
    "inputs": [
      {
        "name": "_hash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_timestamp",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_signature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "_signer",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "verifyDocument",
    "inputs": [
      {
        "name": "_hash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_signer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_signature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "DocumentStored",
    "inputs": [
      {
        "name": "hash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "signer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "timestamp",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  }
] as const;
