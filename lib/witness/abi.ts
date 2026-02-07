/**
 * VeriCallRegistry Contract ABI
 * Auto-generated from contracts/out/VeriCallRegistry.sol/VeriCallRegistry.json
 * Deployed: 0xe454ca755219310b2728d39db8039cbaa7abc3b8 (Base Sepolia)
 */

export const VERICALL_REGISTRY_ABI = [
  {
    type: 'constructor',
    inputs: [{ name: '_guestId', type: 'bytes32' }],
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
        ],
      },
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
    name: 'guestId',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
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
    name: 'updateGuestId',
    inputs: [{ name: '_guestId', type: 'bytes32' }],
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
    name: 'GuestIdUpdated',
    inputs: [
      { name: 'oldGuestId', type: 'bytes32', indexed: false },
      { name: 'newGuestId', type: 'bytes32', indexed: false },
    ],
    anonymous: false,
  },
] as const;
