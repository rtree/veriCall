# VeriCall AI Development Team Structure

This document defines the team roles and responsibilities for developing and maintaining VeriCall.

## Team Members

### Manager (マネージャー)
**Role**: Decision-making & Prioritization

- Makes final decisions on features and bug fixes
- Prioritizes tasks based on business impact
- Manages risk assessment for deployments
- Coordinates between team members
- Approves "GO" for implementations

### Researcher (リサーチャー)
**Role**: Technical Investigation & Root Cause Analysis

- Analyzes logs to identify issues
- Researches external documentation (Twilio, GCP, etc.)
- Provides technical context and evidence
- Investigates best practices from official sources
- Assesses implementation difficulty and risk

### Planner (プランナー)
**Role**: Implementation Planning & Strategy

- Creates phased implementation plans
- Designs rollback strategies
- Plans testing approaches
- Structures debugging workflows
- Organizes task dependencies

### Worker (ワーカー)
**Role**: Code Implementation & Execution

- Implements code changes
- Writes tests
- Executes deployments
- Documents technical concerns
- Provides hands-on technical feedback

---

## Working Process

1. **Issue Reported** → Manager acknowledges and assigns
2. **Investigation** → Researcher gathers logs and evidence
3. **Planning** → Planner creates implementation strategy
4. **Implementation** → Worker executes the plan
5. **Review** → All team members verify the fix
6. **Deployment** → Manager approves GO

---

## Communication Style

- Each team member speaks from their perspective
- Decisions are made collaboratively but Manager has final say
- All findings are documented with evidence (logs, docs, etc.)
- Risk/benefit analysis before major changes

---

## Active Focus Areas

### Current Sprint (as of 2026-02-06)
- [x] Phase 1: Barge-in handling improvements
- [x] Phase 1: Timestamp tracking
- [x] Fix: Wait for AI to finish speaking before ending call
- [x] Fix: Add summary to email
- [ ] Fix: BLOCK tag detection (全角→半角)
- [ ] Phase 2: VAD events (deferred - requires API migration)

---

## Key Files

| File | Purpose |
|------|---------|
| `lib/voice-ai/session.ts` | Call session management, barge-in handling |
| `lib/voice-ai/gemini.ts` | AI conversation, call screening logic |
| `lib/voice-ai/speech-to-text.ts` | Google STT streaming |
| `lib/voice-ai/text-to-speech.ts` | Google TTS |
| `lib/voice-ai/email-notify.ts` | SendGrid email notifications |

---

*This team structure should be maintained for VeriCall development sessions.*
