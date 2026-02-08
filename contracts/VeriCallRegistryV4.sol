// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./interfaces/IRiscZeroVerifier.sol";

/**
 * @title VeriCallRegistryV4
 * @notice On-chain registry for AI phone call decisions with ZK proof verification,
 *         journal-bound decision integrity, and source code attestation.
 *
 * @dev    Upgrades from V3:
 *         1. 10-field journal — adds provenSourceCodeCommit (git commit SHA)
 *         2. Source code attestation — the Decision API includes the git commit SHA,
 *            which is proven via TLSNotary alongside decision data. Anyone can
 *            compare the on-chain commit hash with the public GitHub repository
 *            to verify which code was running when the decision was made.
 *
 *         Journal format (ABI-encoded, 10 fields from vlayer ZK Prover):
 *           bytes32 notaryKeyFingerprint
 *           string  method                  — "GET"
 *           string  url                     — proven Decision API URL
 *           uint256 timestamp               — TLS session timestamp
 *           bytes32 queriesHash             — keccak256 of JMESPath extraction queries
 *           string  provenDecision          — "BLOCK" / "RECORD" / "ACCEPT"
 *           string  provenReason            — AI reasoning text
 *           string  provenSystemPromptHash  — SHA-256 of AI system prompt
 *           string  provenTranscriptHash    — SHA-256 of conversation transcript
 *           string  provenSourceCodeCommit  — git commit SHA of running code (NEW)
 *
 *         Verifier injection (same as V3):
 *           - Dev/Hackathon: RiscZeroMockVerifier(0xFFFFFFFF)
 *           - Production:    RiscZeroVerifierRouter(0x0b144e07...)
 */
contract VeriCallRegistryV4 {
    // ─── Types ─────────────────────────────────────────────────

    enum Decision { UNKNOWN, ACCEPT, BLOCK, RECORD }

    struct CallRecord {
        Decision decision;         // AI decision (bound to journal extractedData)
        string reason;             // AI reasoning (bound to journal extractedData)
        bytes32 journalHash;       // keccak256(journalDataAbi) — commitment
        bytes zkProofSeal;         // RISC Zero seal
        bytes journalDataAbi;      // ABI-encoded public outputs (10 fields)
        string sourceUrl;          // URL from journal (not external arg)
        uint256 timestamp;         // block.timestamp when registered
        address submitter;         // TX sender address
        bool verified;             // ZK proof verification passed
    }

    // ─── Immutable State ───────────────────────────────────────

    IRiscZeroVerifier public immutable verifier;
    bytes32 public imageId;
    bytes32 public immutable EXPECTED_NOTARY_KEY_FP;
    bytes32 public expectedQueriesHash;
    string public expectedUrlPrefix;
    address public owner;

    // ─── Storage ───────────────────────────────────────────────

    mapping(bytes32 => CallRecord) public records;
    bytes32[] public callIds;

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
     *         2. abi.decode(journal) — extract 10 fields
     *         3. Validate notaryKeyFP, method, queriesHash, URL prefix
     *         4. Validate systemPromptHash, transcriptHash, sourceCodeCommit are non-empty
     *         5. Reconstruct extractedData from decision+reason, compare hash
     *         6. Store CallRecord (decision/reason/url derived from journal)
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

        // ── Step 2: Decode Journal (10 fields) ────────────────
        (
            bytes32 notaryKeyFingerprint,
            string memory method,
            string memory url,
            ,  // timestamp — informational
            bytes32 queriesHash,
            string memory provenDecision,
            string memory provenReason,
            string memory provenSystemPromptHash,
            string memory provenTranscriptHash,
            string memory provenSourceCodeCommit
        ) = abi.decode(journalDataAbi, (bytes32, string, string, uint256, bytes32, string, string, string, string, string));

        // ── Step 3: Validate Journal Fields ────────────────────
        if (notaryKeyFingerprint != EXPECTED_NOTARY_KEY_FP)
            revert InvalidNotaryKeyFingerprint();

        if (keccak256(bytes(method)) != keccak256("GET"))
            revert InvalidHttpMethod();

        if (expectedQueriesHash != bytes32(0) && queriesHash != expectedQueriesHash)
            revert InvalidQueriesHash();

        _validateUrlPrefix(url);

        // Validate proven hashes and source code commit are non-empty
        require(bytes(provenSystemPromptHash).length > 0, "Empty systemPromptHash");
        require(bytes(provenTranscriptHash).length > 0, "Empty transcriptHash");
        require(bytes(provenSourceCodeCommit).length > 0, "Empty sourceCodeCommit");

        // ── Step 4: Decision–Journal Binding ───────────────────
        _validateDecisionBinding(decision, reason, provenDecision, provenReason);

        // ── Step 5: Store Record ───────────────────────────────
        records[callId] = CallRecord({
            decision: decision,
            reason: reason,
            journalHash: keccak256(journalDataAbi),
            zkProofSeal: zkProofSeal,
            journalDataAbi: journalDataAbi,
            sourceUrl: url,
            timestamp: block.timestamp,
            submitter: msg.sender,
            verified: true
        });

        callIds.push(callId);

        if (decision == Decision.ACCEPT) totalAccepted++;
        else if (decision == Decision.BLOCK) totalBlocked++;
        else if (decision == Decision.RECORD) totalRecorded++;

        emit CallDecisionRecorded(callId, decision, block.timestamp, msg.sender);
    }

    // ─── Internal: URL Prefix Validation ───────────────────────

    function _validateUrlPrefix(string memory url) internal view {
        bytes memory urlBytes = bytes(url);
        bytes memory prefixBytes = bytes(expectedUrlPrefix);
        if (urlBytes.length < prefixBytes.length) revert InvalidUrl();
        for (uint256 i = 0; i < prefixBytes.length; i++) {
            if (urlBytes[i] != prefixBytes[i]) revert InvalidUrl();
        }
    }

    // ─── Internal: Decision–Journal Binding ────────────────────

    function _validateDecisionBinding(
        Decision decision,
        string calldata reason,
        string memory provenDecision,
        string memory provenReason
    ) internal pure {
        string memory decisionStr;
        if (decision == Decision.BLOCK) decisionStr = "BLOCK";
        else if (decision == Decision.RECORD) decisionStr = "RECORD";
        else if (decision == Decision.ACCEPT) decisionStr = "ACCEPT";
        else revert InvalidDecision();

        if (keccak256(bytes(provenDecision)) != keccak256(bytes(decisionStr)))
            revert DecisionMismatch();
        if (keccak256(bytes(provenReason)) != keccak256(bytes(reason)))
            revert ReasonMismatch();
    }

    // ─── View: Decoded Proven Data (10 fields) ─────────────────

    function getProvenData(bytes32 callId) external view returns (
        bytes32 notaryKeyFingerprint,
        string memory method,
        string memory url,
        uint256 proofTimestamp,
        bytes32 queriesHash,
        string memory provenDecision,
        string memory provenReason,
        string memory provenSystemPromptHash,
        string memory provenTranscriptHash,
        string memory provenSourceCodeCommit
    ) {
        bytes memory journal = records[callId].journalDataAbi;
        require(journal.length > 0, "Record not found");
        return abi.decode(journal, (bytes32, string, string, uint256, bytes32, string, string, string, string, string));
    }

    // ─── View: Standard Accessors ──────────────────────────────

    function getRecord(bytes32 callId) external view returns (CallRecord memory) {
        return records[callId];
    }

    function getTotalRecords() external view returns (uint256) {
        return callIds.length;
    }

    function getStats() external view returns (
        uint256 total, uint256 accepted, uint256 blocked, uint256 recorded
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

    function updateExpectedQueriesHash(bytes32 _hash) external onlyOwner {
        expectedQueriesHash = _hash;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }
}
