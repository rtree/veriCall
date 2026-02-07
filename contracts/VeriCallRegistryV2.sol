// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./interfaces/IRiscZeroVerifier.sol";

/**
 * @title VeriCallRegistryV2
 * @notice On-chain registry for AI phone call decisions with ZK proof verification.
 * @dev    Upgrades from V1:
 *         1. IRiscZeroVerifier.verify() — on-chain ZK proof verification
 *         2. abi.decode(journalDataAbi) — journal field extraction in Solidity
 *         3. Field validation — TLSNotary/HTTP metadata integrity checks
 *         4. getProvenData() — decoded journal data reader
 *         5. verified flag — explicit verification status
 *
 *         Architecture follows vlayer Web Proof + ZK Proof pattern
 *         (TLSNotary attestation → RISC Zero Groth16 → on-chain verification).
 *
 *         Verifier injection:
 *           - Dev/Hackathon: RiscZeroMockVerifier(0xFFFFFFFF)
 *           - Production:    RiscZeroVerifierRouter(0x0b144e07...)
 */
contract VeriCallRegistryV2 {
    // ─── Types ─────────────────────────────────────────────────

    enum Decision { UNKNOWN, ACCEPT, BLOCK, RECORD }

    struct CallRecord {
        bytes32 callerHash;        // keccak256(phoneNumber) — privacy preserved
        Decision decision;         // AI decision (1=ACCEPT, 2=BLOCK, 3=RECORD)
        string reason;             // AI reasoning summary (≤200 chars)
        bytes32 journalHash;       // keccak256(journalDataAbi) — commitment
        bytes zkProofSeal;         // RISC Zero seal (Mock: 36B / Prod: ~256B)
        bytes journalDataAbi;      // ABI-encoded public outputs (6 fields)
        string sourceUrl;          // URL proven via Web Proof
        uint256 timestamp;         // block.timestamp when registered
        address submitter;         // TX sender address
        bool verified;             // ZK proof verification passed
    }

    // ─── State ─────────────────────────────────────────────────

    /// @notice RISC Zero verifier (MockVerifier or VerifierRouter)
    IRiscZeroVerifier public immutable verifier;

    /// @notice RISC Zero guest program ID (vlayer's guestId)
    bytes32 public imageId;

    /// @notice Contract owner
    address public owner;

    /// @notice Call records indexed by callId
    mapping(bytes32 => CallRecord) public records;

    /// @notice Array of all callIds for enumeration
    bytes32[] public callIds;

    // Stats
    uint256 public totalAccepted;
    uint256 public totalBlocked;
    uint256 public totalRecorded;

    // ─── Events ────────────────────────────────────────────────

    event CallDecisionRecorded(
        bytes32 indexed callId,
        bytes32 indexed callerHash,
        Decision decision,
        uint256 timestamp,
        address submitter
    );

    event ProofVerified(
        bytes32 indexed callId,
        bytes32 imageId,
        bytes32 journalDigest
    );

    event ImageIdUpdated(bytes32 oldImageId, bytes32 newImageId);

    // ─── Constructor ───────────────────────────────────────────

    /**
     * @param _verifier RISC Zero verifier contract address
     * @param _imageId  RISC Zero guest program ID (from vlayer /guest-id API)
     */
    constructor(IRiscZeroVerifier _verifier, bytes32 _imageId) {
        verifier = _verifier;
        imageId = _imageId;
        owner = msg.sender;
    }

    // ─── Modifiers ─────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ─── Core: Register with ZK Verification ───────────────────

    /**
     * @notice Register a call decision with on-chain ZK proof verification.
     * @dev    Flow:
     *         1. verifier.verify(seal, imageId, sha256(journal)) — ZK check
     *         2. abi.decode(journal) — extract 6 fields
     *         3. Validate decoded fields (notaryKeyFP, method, url, data)
     *         4. Store CallRecord + emit events
     *
     * @param callId          Unique call identifier (keccak256 of call SID + timestamp)
     * @param callerHash      keccak256 hash of caller phone number (privacy)
     * @param decision        AI decision (1=ACCEPT, 2=BLOCK, 3=RECORD)
     * @param reason          Human-readable decision reason (≤200 chars)
     * @param zkProofSeal     RISC Zero seal from vlayer ZK Prover
     * @param journalDataAbi  ABI-encoded public outputs from vlayer
     * @param sourceUrl       URL that was proven via Web Proof
     */
    function registerCallDecision(
        bytes32 callId,
        bytes32 callerHash,
        Decision decision,
        string calldata reason,
        bytes calldata zkProofSeal,
        bytes calldata journalDataAbi,
        string calldata sourceUrl
    ) external {
        require(records[callId].timestamp == 0, "Already registered");
        require(decision != Decision.UNKNOWN, "Invalid decision");

        // ── Step 1: ZK Proof Verification ──────────────────────
        // Compute SHA-256 digest of journal (RISC Zero uses SHA-256, not keccak256)
        bytes32 journalDigest = sha256(journalDataAbi);
        verifier.verify(zkProofSeal, imageId, journalDigest);

        emit ProofVerified(callId, imageId, journalDigest);

        // ── Step 2 & 3: Journal Decode + Validation ────────────
        _validateJournal(journalDataAbi);

        // ── Step 4: Store Record ───────────────────────────────
        records[callId] = CallRecord({
            callerHash: callerHash,
            decision: decision,
            reason: reason,
            journalHash: keccak256(journalDataAbi),
            zkProofSeal: zkProofSeal,
            journalDataAbi: journalDataAbi,
            sourceUrl: sourceUrl,
            timestamp: block.timestamp,
            submitter: msg.sender,
            verified: true
        });

        callIds.push(callId);

        // Update stats
        if (decision == Decision.ACCEPT) totalAccepted++;
        else if (decision == Decision.BLOCK) totalBlocked++;
        else if (decision == Decision.RECORD) totalRecorded++;

        emit CallDecisionRecorded(callId, callerHash, decision, block.timestamp, msg.sender);
    }

    // ─── Internal: Journal Validation ──────────────────────────

    /**
     * @dev Decode and validate the vlayer journal data.
     *      Journal format (ABI-encoded):
     *        bytes32 notaryKeyFingerprint  — TLSNotary public key fingerprint
     *        string  method                — HTTP method ("GET")
     *        string  url                   — Proven URL
     *        uint256 timestamp             — Proof generation timestamp
     *        bytes32 queriesHash           — keccak256 of URL query parameters
     *        string  extractedData         — JMESPath-extracted JSON data
     */
    function _validateJournal(bytes calldata journalDataAbi) internal pure {
        (
            bytes32 notaryKeyFingerprint,
            string memory method,
            string memory url,
            ,  // timestamp — not validated (informational)
            ,  // queriesHash — not validated (can be zero for no-query URLs)
            string memory extractedData
        ) = abi.decode(journalDataAbi, (bytes32, string, string, uint256, bytes32, string));

        require(
            notaryKeyFingerprint != bytes32(0),
            "Invalid notary key fingerprint"
        );
        require(
            keccak256(bytes(method)) == keccak256("GET"),
            "Invalid HTTP method"
        );
        require(bytes(url).length > 0, "Empty URL");
        require(bytes(extractedData).length > 0, "No extracted data");
    }

    // ─── View: Decoded Proven Data ─────────────────────────────

    /**
     * @notice Read decoded journal data for a call record.
     * @param callId The call record to read
     * @return notaryKeyFingerprint TLSNotary public key fingerprint
     * @return method HTTP method used ("GET")
     * @return url The URL that was proven
     * @return proofTimestamp When the proof was generated
     * @return queriesHash Hash of URL query parameters
     * @return extractedData JMESPath-extracted data (JSON string)
     */
    function getProvenData(bytes32 callId) external view returns (
        bytes32 notaryKeyFingerprint,
        string memory method,
        string memory url,
        uint256 proofTimestamp,
        bytes32 queriesHash,
        string memory extractedData
    ) {
        bytes memory journal = records[callId].journalDataAbi;
        require(journal.length > 0, "Record not found");
        return abi.decode(journal, (bytes32, string, string, uint256, bytes32, string));
    }

    // ─── View: Standard Accessors ──────────────────────────────

    function getRecord(bytes32 callId) external view returns (CallRecord memory) {
        return records[callId];
    }

    function getTotalRecords() external view returns (uint256) {
        return callIds.length;
    }

    function getStats() external view returns (
        uint256 total,
        uint256 accepted,
        uint256 blocked,
        uint256 recorded
    ) {
        return (callIds.length, totalAccepted, totalBlocked, totalRecorded);
    }

    /**
     * @notice Verify journal data integrity against stored commitment.
     * @param callId The call record to check
     * @param journalData The journal data to verify
     * @return True if keccak256(journalData) matches stored journalHash
     */
    function verifyJournal(bytes32 callId, bytes calldata journalData) external view returns (bool) {
        return records[callId].journalHash == keccak256(journalData);
    }

    // ─── Admin Functions ───────────────────────────────────────

    function updateImageId(bytes32 _imageId) external onlyOwner {
        emit ImageIdUpdated(imageId, _imageId);
        imageId = _imageId;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }
}
