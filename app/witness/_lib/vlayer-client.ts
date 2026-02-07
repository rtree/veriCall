/**
 * Vlayer Client — Re-export from shared pipeline
 *
 * All core logic lives in lib/witness/pipeline.ts so it can be
 * imported from both the custom server (server.ts) and Next.js routes.
 * This file re-exports for backward compatibility with API routes.
 */

export {
  createWitness,
  hashPhoneNumber,
  getRecord,
  getByCallSid,
  getAllRecords,
} from '@/lib/witness/pipeline';

export type {
  WitnessRecord,
  DecisionData,
  ProofStatus,
} from '@/lib/witness/pipeline';
