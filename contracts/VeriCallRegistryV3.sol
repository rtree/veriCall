// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./interfaces/IRiscZeroVerifier.sol";

/**
 * @title VeriCallRegistryV3
 * @notice On-chain registry for AI phone call decisions with ZK proof verification
 *         and journal-bound decision integrity.
 *
 * @dev    Upgrades from V2:
 *         1. EXPECTED_NOTARY_KEY_FP — immutable Notary fingerprint check (vlayer reference pattern)
 *         2. EXPECTED_QUERIES_HASH  — immutable JMESPath extraction hash check
 *         3. URL prefix validation  — journal URL must start with expectedUrlPrefix
 *         4. Decision–Journal binding — decision/reason reconstructed and compared
 *            against journal's extractedData via keccak256
 *         5. sourceUrl removed from args — derived from journal directly
 *
 *         This eliminates the V2 vulnerability where a submitter could supply
 *         a valid proof but alter the decision label in the external arguments.
 *
 *         Journal format (ABI-encoded, 9 fields from vlayer ZK Prover):
 *           bytes32 notaryKeyFingerprint
 *           string  method              — "GET"
 *           string  url                 — proven Decision API URL
 *           uint256 timestamp           — TLS session timestamp
 *           bytes32 queriesHash         — keccak256 of JMESPath extraction queries
 *           string  provenDecision      — "BLOCK" / "RECORD" / "ACCEPT" (from JMESPath)
 *           string  provenReason        — AI reasoning text (from JMESPath)
 *           string  provenSystemPromptHash — SHA-256 of AI system prompt (from JMESPath)
 *           string  provenTranscriptHash   — SHA-256 of conversation transcript (from JMESPath)
 *
 *         Verifier injection (same as V2):
 *           - Dev/Hackathon: RiscZeroMockVerifier(0xFFFFFFFF)
 *           - Production:    RiscZeroVerifierRouter(0x0b144e07...)
 */
contract VeriCallRegistryV3 {
    // ─── Types ─────────────────────────────────────────────────

    enum Decision { UNKNOWN, ACCEPT, BLOCK, RECORD }

    struct CallRecord {
        Decision decision;         // AI decision (bound to journal extractedData)
        string reason;             // AI reasoning (bound to journal extractedData)
        bytes32 journalHash;       // keccak256(journalDataAbi) — commitment
        bytes zkProofSeal;         // RISC Zero seal
        bytes journalDataAbi;      // ABI-encoded public outputs (9 fields)
        string sourceUrl;          // URL from journal (not external arg)
        uint256 timestamp;         // block.timestamp when registered
        address submitter;         // TX sender address
        bool verified;             // ZK proof verification passed
    }

    // ─── Immutable State ───────────────────────────────────────

    /// @notice RISC Zero verifier (MockVerifier or VerifierRouter)
    IRiscZeroVerifier public immutable verifier;

    /// @notice RISC Zero guest program ID (vlayer's guestId)
    bytes32 public imageId;

    /// @notice Expected TLSNotary public key fingerprint
    /// @dev    Must match the Notary used by vlayer (known constant)
    bytes32 public immutable EXPECTED_NOTARY_KEY_FP;

    /// @notice Expected JMESPath extraction queries hash
    /// @dev    keccak256 of the extraction config used in ZK compression.
    ///         Non-immutable so owner can update after first successful proof
    ///         with expanded JMESPath. Set to bytes32(0) to skip check (dev mode).
    bytes32 public expectedQueriesHash;

    /// @notice Expected URL prefix for the Decision API
    /// @dev    Journal URL must start with this prefix
    string public expectedUrlPrefix;

    /// @notice Contract owner
    address public owner;

    // ─── Storage ───────────────────────────────────────────────

    mapping(bytes32 => CallRecord) public records;
    bytes32[] public callIds;

    // Stats
    uint256 public totalAccepted;
    uint256 public totalBlocked;
    uint256 public totalRecorded;

    // ─── Events ────────────────────────────────────────────────

    event CallDecisionRecorded(
        bytes32 indexed callId,
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

    // ─── Errors ────────────────────────────────────────────────

    error AlreadyRegistered();
    error InvalidDecision();
    error InvalidNotaryKeyFingerprint();
    error InvalidHttpMethod();
    error InvalidQueriesHash();
    error InvalidUrl();
    error DecisionMismatch();
    error ReasonMismatch();
    error ZKProofVerificationFailed();

    // ─── Constructor ───────────────────────────────────────────

    /**
     * @param _verifier           RISC Zero verifier contract address
     * @param _imageId            RISC Zero guest program ID
     * @param _expectedNotaryFP   Expected TLSNotary public key fingerprint
     * @param _expectedQueriesHash Expected keccak256 of JMESPath extraction queries
     * @param _expectedUrlPrefix  Expected URL prefix (e.g. "https://vericall-.../api/witness/decision/")
     */
    constructor(
        IRiscZeroVerifier _verifier,
        bytes32 _imageId,
        bytes32 _expectedNotaryFP,
        bytes32 _expectedQueriesHash,
        string memory _expectedUrlPrefix
    ) {
        verifier = _verifier;
        imageId = _imageId;
        EXPECTED_NOTARY_KEY_FP = _expectedNotaryFP;
        expectedQueriesHash = _expectedQueriesHash;
        expectedUrlPrefix = _expectedUrlPrefix;
        owner = msg.sender;
    }

    // ─── Modifiers ─────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ─── Core: Register with Full Verification ─────────────────

    /**
     * @notice Register a call decision with on-chain ZK proof verification
     *         and journal-bound decision integrity check.
     *
     * @dev    Flow:
     *         1. verifier.verify(seal, imageId, sha256(journal)) — ZK check
     *         2. abi.decode(journal) — extract 9 fields
     *         3. Validate notaryKeyFP, method, queriesHash, URL prefix
     *         4. Validate systemPromptHash and transcriptHash are non-empty
     *         5. Reconstruct extractedData from decision+reason, compare hash
     *         6. Store CallRecord (decision/reason/url derived from journal)
     *
     * @param callId          Unique call identifier (keccak256 of call SID + timestamp)
     * @param decision        AI decision (must match journal extractedData)
     * @param reason          AI reasoning (must match journal extractedData)
     * @param zkProofSeal     RISC Zero seal from vlayer ZK Prover
     * @param journalDataAbi  ABI-encoded public outputs from vlayer (9 fields)
     */
    function registerCallDecision(
        bytes32 callId,
        Decision decision,
        string calldata reason,
        bytes calldata zkProofSeal,
        bytes calldata journalDataAbi
    ) external {
        if (records[callId].timestamp != 0) revert AlreadyRegistered();
        if (decision == Decision.UNKNOWN) revert InvalidDecision();

        // ── Step 1: ZK Proof Verification ──────────────────────
        bytes32 journalDigest = sha256(journalDataAbi);
        try verifier.verify(zkProofSeal, imageId, journalDigest) {
        } catch {
            revert ZKProofVerificationFailed();
        }

        emit ProofVerified(callId, imageId, journalDigest);

        // ── Step 2: Decode Journal (9 fields) ─────────────────
        (
            bytes32 notaryKeyFingerprint,
            string memory method,
            string memory url,
            ,  // timestamp — informational
            bytes32 queriesHash,
            string memory provenDecision,
            string memory provenReason,
            string memory provenSystemPromptHash,
            string memory provenTranscriptHash
        ) = abi.decode(journalDataAbi, (bytes32, string, string, uint256, bytes32, string, string, string, string));

        // ── Step 3: Validate Journal Fields ────────────────────
        if (notaryKeyFingerprint != EXPECTED_NOTARY_KEY_FP)
            revert InvalidNotaryKeyFingerprint();

        if (keccak256(bytes(method)) != keccak256("GET"))
            revert InvalidHttpMethod();

        // bytes32(0) = skip check (dev mode, queriesHash discovered after first proof)
        if (expectedQueriesHash != bytes32(0) && queriesHash != expectedQueriesHash)
            revert InvalidQueriesHash();

        // URL prefix check (byte-by-byte)
        _validateUrlPrefix(url);

        // Validate proven hashes are non-empty
        require(bytes(provenSystemPromptHash).length > 0, "Empty systemPromptHash");
        require(bytes(provenTranscriptHash).length > 0, "Empty transcriptHash");

        // ── Step 4: Decision–Journal Binding ───────────────────
        // vlayer proves decision and reason as separate JMESPath fields.
        // We directly compare the proven strings against the submitted args.
        _validateDecisionBinding(decision, reason, provenDecision, provenReason);

        // ── Step 5: Store Record ───────────────────────────────
        records[callId] = CallRecord({
            decision: decision,
            reason: reason,
            journalHash: keccak256(journalDataAbi),
            zkProofSeal: zkProofSeal,
            journalDataAbi: journalDataAbi,
            sourceUrl: url,        // from journal, not external arg
            timestamp: block.timestamp,
            submitter: msg.sender,
            verified: true
        });

        callIds.push(callId);

        // Update stats
        if (decision == Decision.ACCEPT) totalAccepted++;
        else if (decision == Decision.BLOCK) totalBlocked++;
        else if (decision == Decision.RECORD) totalRecorded++;

        emit CallDecisionRecorded(callId, decision, block.timestamp, msg.sender);
    }

    // ─── Internal: URL Prefix Validation ───────────────────────

    /**
     * @dev Verify that the journal URL starts with expectedUrlPrefix.
     *      Byte-by-byte comparison for URL origin validation.
     */
    function _validateUrlPrefix(string memory url) internal view {
        bytes memory urlBytes = bytes(url);
        bytes memory prefixBytes = bytes(expectedUrlPrefix);

        if (urlBytes.length < prefixBytes.length)
            revert InvalidUrl();

        for (uint256 i = 0; i < prefixBytes.length; i++) {
            if (urlBytes[i] != prefixBytes[i])
                revert InvalidUrl();
        }
    }

    // ─── Internal: Decision–Journal Binding ────────────────────

    /**
     * @dev Verify that the decision and reason args match the proven fields
     *      from the vlayer journal.
     *
     *      vlayer extracts decision and reason as separate JMESPath fields:
     *        provenDecision = "BLOCK" / "RECORD" / "ACCEPT"
     *        provenReason   = "Suspicious sales pitch detected"
     *
     *      We compare the enum-derived string against provenDecision,
     *      and the submitted reason against provenReason.
     *      This ensures the submitter cannot alter decision/reason after proof generation.
     */
    function _validateDecisionBinding(
        Decision decision,
        string calldata reason,
        string memory provenDecision,
        string memory provenReason
    ) internal pure {
        // Convert enum to the string that appears in the API response
        string memory decisionStr;
        if (decision == Decision.BLOCK) {
            decisionStr = "BLOCK";
        } else if (decision == Decision.RECORD) {
            decisionStr = "RECORD";
        } else if (decision == Decision.ACCEPT) {
            decisionStr = "ACCEPT";
        } else {
            revert InvalidDecision();
        }

        // Direct comparison: proven decision string must match enum
        if (keccak256(bytes(provenDecision)) != keccak256(bytes(decisionStr)))
            revert DecisionMismatch();

        // Direct comparison: proven reason must match submitted reason
        if (keccak256(bytes(provenReason)) != keccak256(bytes(reason)))
            revert ReasonMismatch();
    }

    // ─── View: Decoded Proven Data ─────────────────────────────

    /**
     * @notice Read decoded journal data for a call record (9 fields).
     */
    function getProvenData(bytes32 callId) external view returns (
        bytes32 notaryKeyFingerprint,
        string memory method,
        string memory url,
        uint256 proofTimestamp,
        bytes32 queriesHash,
        string memory provenDecision,
        string memory provenReason,
        string memory provenSystemPromptHash,
        string memory provenTranscriptHash
    ) {
        bytes memory journal = records[callId].journalDataAbi;
        require(journal.length > 0, "Record not found");
        return abi.decode(journal, (bytes32, string, string, uint256, bytes32, string, string, string, string));
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

    function verifyJournal(bytes32 callId, bytes calldata journalData) external view returns (bool) {
        return records[callId].journalHash == keccak256(journalData);
    }

    // ─── Admin Functions ───────────────────────────────────────

    function updateImageId(bytes32 _imageId) external onlyOwner {
        emit ImageIdUpdated(imageId, _imageId);
        imageId = _imageId;
    }

    /// @notice Update the expected queries hash after expanding JMESPath.
    /// @dev    Deploy with bytes32(0) to skip check, then update after first successful proof.
    function updateExpectedQueriesHash(bytes32 _hash) external onlyOwner {
        expectedQueriesHash = _hash;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }
}
