// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.21;

/// @notice Standard RISC Zero Verifier interface.
///         All verifiers (Mock, Groth16, STARK) implement this.
///         Reverts on verification failure.
interface IRiscZeroVerifier {
    /// @notice Verify a ZK proof.
    /// @param seal        Proof data (Mock: 36 bytes / Groth16: ~256 bytes)
    /// @param imageId     RISC Zero guest program ID (vlayer's guestId)
    /// @param journalDigest sha256(journalDataAbi) — digest of public outputs
    function verify(
        bytes calldata seal,
        bytes32 imageId,
        bytes32 journalDigest
    ) external view;
}
