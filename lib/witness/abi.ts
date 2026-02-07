/**
 * VeriCallRegistry Contract ABIs
 * V1: 0xe454ca755219310b2728d39db8039cbaa7abc3b8 (Base Sepolia) — Phase 1
 * V2: Deployed via scripts/deploy-v2.ts — Phase 2 (MockVerifier + verify + journal decode)
 */

// ─── V2 ABI (Active) ──────────────────────────────────────────

export const VERICALL_REGISTRY_ABI = [
  {
    type: 'constructor',
    inputs: [
      { name: '_verifier', type: 'address' },
      { name: '_imageId', type: 'bytes32' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'registerCallDecision',
    inputs: [
      { name: 'callId', type: 'bytes32' },
      { name: 'callerHash', type: 'bytes32' },
      { name: 'decision', type: 'uint8' },
      { name: 'reason', type: 'string' },
      { name: 'zkProofSeal', type: 'bytes' },
      { name: 'journalDataAbi', type: 'bytes' },
      { name: 'sourceUrl', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getRecord',
    inputs: [{ name: 'callId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'callerHash', type: 'bytes32' },
          { name: 'decision', type: 'uint8' },
          { name: 'reason', type: 'string' },
          { name: 'journalHash', type: 'bytes32' },
          { name: 'zkProofSeal', type: 'bytes' },
          { name: 'journalDataAbi', type: 'bytes' },
          { name: 'sourceUrl', type: 'string' },
          { name: 'timestamp', type: 'uint256' },
          { name: 'submitter', type: 'address' },
          { name: 'verified', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getProvenData',
    inputs: [{ name: 'callId', type: 'bytes32' }],
    outputs: [
      { name: 'notaryKeyFingerprint', type: 'bytes32' },
      { name: 'method', type: 'string' },
      { name: 'url', type: 'string' },
      { name: 'proofTimestamp', type: 'uint256' },
      { name: 'queriesHash', type: 'bytes32' },
      { name: 'extractedData', type: 'string' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getStats',
    inputs: [],
    outputs: [
      { name: 'total', type: 'uint256' },
      { name: 'accepted', type: 'uint256' },
      { name: 'blocked', type: 'uint256' },
      { name: 'recorded', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTotalRecords',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'verifyJournal',
    inputs: [
      { name: 'callId', type: 'bytes32' },
      { name: 'journalData', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'imageId',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'verifier',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'updateImageId',
    inputs: [{ name: '_imageId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'callIds',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'transferOwnership',
    inputs: [{ name: 'newOwner', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'CallDecisionRecorded',
    inputs: [
      { name: 'callId', type: 'bytes32', indexed: true },
      { name: 'callerHash', type: 'bytes32', indexed: true },
      { name: 'decision', type: 'uint8', indexed: false },
      { name: 'timestamp', type: 'uint256', indexed: false },
      { name: 'submitter', type: 'address', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ProofVerified',
    inputs: [
      { name: 'callId', type: 'bytes32', indexed: true },
      { name: 'imageId', type: 'bytes32', indexed: false },
      { name: 'journalDigest', type: 'bytes32', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ImageIdUpdated',
    inputs: [
      { name: 'oldImageId', type: 'bytes32', indexed: false },
      { name: 'newImageId', type: 'bytes32', indexed: false },
    ],
    anonymous: false,
  },
] as const;

// ─── MockVerifier ABI ──────────────────────────────────────────

export const MOCK_VERIFIER_ABI = [
  {
    type: 'function',
    name: 'SELECTOR',
    inputs: [],
    outputs: [{ name: '', type: 'bytes4' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'verify',
    inputs: [
      { name: 'seal', type: 'bytes' },
      { name: 'imageId', type: 'bytes32' },
      { name: 'journalDigest', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'pure',
  },
] as const;
