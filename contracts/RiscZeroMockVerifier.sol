// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.21;

import "./interfaces/IRiscZeroVerifier.sol";

/// @title RiscZeroMockVerifier
/// @notice Mock verifier for development/hackathon use.
///         Accepts any seal that starts with the SELECTOR_FAKE prefix (0xFFFFFFFF).
///         This matches the seal format returned by vlayer's ZK Prover in development mode.
/// @dev    For production, replace with RiscZeroVerifierRouter at
///         0x0b144e07a0826182b6b59788c34b32bfa86fb711 (Base Sepolia)
contract RiscZeroMockVerifier is IRiscZeroVerifier {
    /// @notice The 4-byte selector prefix that mock seals must start with.
    bytes4 public constant SELECTOR = 0xFFFFFFFF;

    /// @notice Verify a mock seal. Reverts if seal doesn't start with SELECTOR_FAKE.
    /// @param seal The proof data (must be >= 4 bytes, starting with 0xFFFFFFFF)
    /// @param imageId Ignored in mock mode (not validated)
    /// @param journalDigest Ignored in mock mode (not validated)
    function verify(
        bytes calldata seal,
        bytes32 imageId,
        bytes32 journalDigest
    ) external pure override {
        require(seal.length >= 4, "RiscZeroMockVerifier: seal too short");
        require(
            bytes4(seal[:4]) == SELECTOR,
            "RiscZeroMockVerifier: invalid mock selector"
        );
    }
}
