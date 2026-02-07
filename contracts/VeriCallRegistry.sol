// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/**
 * @title VeriCallRegistry
 * @notice On-chain registry for AI phone call decisions with vlayer ZK proof attestation
 * @dev Stores call decision records with Groth16 proof data from vlayer
 *      Phase 1: Store proof data on-chain (proof of existence)
 *      Phase 2: Add RISC Zero Groth16 on-chain verification
 *      Phase 3: Add Sui cross-chain verification
 */
contract VeriCallRegistry {
    // ─── Types ─────────────────────────────────────────────────
    
    enum Decision { UNKNOWN, ACCEPT, BLOCK, RECORD }
    
    struct CallRecord {
        bytes32 callerHash;        // keccak256(phoneNumber) — privacy preserved
        Decision decision;         // AI decision
        string reason;             // AI reasoning summary
        bytes32 journalHash;       // keccak256(journalDataAbi) — commitment
        bytes zkProofSeal;         // Groth16 seal from vlayer/RISC Zero
        bytes journalDataAbi;      // ABI-encoded public outputs
        string sourceUrl;          // URL of proven API endpoint
        uint256 timestamp;         // block.timestamp when registered
        address submitter;         // who submitted the proof
    }
    
    // ─── State ─────────────────────────────────────────────────
    
    address public owner;
    bytes32 public guestId;        // RISC Zero guest program ID (for future verification)
    
    mapping(bytes32 => CallRecord) public records;
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
    
    event GuestIdUpdated(bytes32 oldGuestId, bytes32 newGuestId);
    
    // ─── Constructor ───────────────────────────────────────────
    
    constructor(bytes32 _guestId) {
        owner = msg.sender;
        guestId = _guestId;
    }
    
    // ─── Modifiers ─────────────────────────────────────────────
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    // ─── Core Functions ────────────────────────────────────────
    
    /**
     * @notice Register a call decision with vlayer ZK proof data
     * @param callId Unique call identifier (keccak256 of call SID)
     * @param callerHash keccak256 hash of caller phone number
     * @param decision AI decision (1=ACCEPT, 2=BLOCK, 3=RECORD)
     * @param reason Human-readable decision reason
     * @param zkProofSeal Groth16 seal from vlayer ZK Prover
     * @param journalDataAbi ABI-encoded public outputs
     * @param sourceUrl URL that was proven via Web Proof
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
        
        records[callId] = CallRecord({
            callerHash: callerHash,
            decision: decision,
            reason: reason,
            journalHash: keccak256(journalDataAbi),
            zkProofSeal: zkProofSeal,
            journalDataAbi: journalDataAbi,
            sourceUrl: sourceUrl,
            timestamp: block.timestamp,
            submitter: msg.sender
        });
        
        callIds.push(callId);
        
        // Update stats
        if (decision == Decision.ACCEPT) totalAccepted++;
        else if (decision == Decision.BLOCK) totalBlocked++;
        else if (decision == Decision.RECORD) totalRecorded++;
        
        emit CallDecisionRecorded(callId, callerHash, decision, block.timestamp, msg.sender);
    }
    
    // ─── View Functions ────────────────────────────────────────
    
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
     * @notice Verify journal data integrity
     * @param callId The call record to check
     * @param journalData The journal data to verify against stored hash
     * @return True if journal data matches stored commitment
     */
    function verifyJournal(bytes32 callId, bytes calldata journalData) external view returns (bool) {
        return records[callId].journalHash == keccak256(journalData);
    }
    
    // ─── Admin Functions ───────────────────────────────────────
    
    function updateGuestId(bytes32 _guestId) external onlyOwner {
        emit GuestIdUpdated(guestId, _guestId);
        guestId = _guestId;
    }
    
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }
}
