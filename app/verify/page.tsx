'use client';

/**
 * /verify — Trust-Minimized Verification Page
 *
 * This page runs verification checks ENTIRELY in the browser.
 * It connects directly to the Base Sepolia public RPC.
 * No VeriCall backend APIs are used for verification.
 *
 * Inspect source: browser DevTools → Sources → verify/page.tsx
 */

import { useState } from 'react';
import { useVerify, CONFIG, type Check, type RecordData } from './useVerify';

/** Format hash as 0x656a...ba82 */
function fmtHash(h: string) {
  return h.length >= 10 ? `${h.slice(0, 6)}...${h.slice(-4)}` : h;
}
/** BaseScan link for an address */
function addrLink(addr: string) {
  return `${CONFIG.basescan}/address/${addr}`;
}
/** BaseScan link for a TX */
function txLink(tx: string) {
  return `${CONFIG.basescan}/tx/${tx}`;
}

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// Page
// ═══════════════════════════════════════════════════════════════

export default function VerifyPage() {
  const { state, run } = useVerify();
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const allPassed = state.phase === 'done' && state.totalChecks === state.passedChecks;

  return (
    <div style={styles.page}>
      {/* ─── Header ─────────────────────────────────────── */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.logo}>⛓️ VeriCall</span>
          <span style={styles.badge}>VERIFICATION</span>
        </div>
        <div style={styles.headerRight}>
          <a
            href={`${CONFIG.basescan}/address/${CONFIG.registry}`}
            target="_blank"
            rel="noopener"
            style={styles.headerLink}
          >
            <span style={styles.dot} /> {CONFIG.network}
          </a>
          <a
            href={`${CONFIG.basescan}/address/${CONFIG.registry}#code`}
            target="_blank"
            rel="noopener"
            style={styles.headerLink}
          >
            {CONFIG.registry.slice(0, 6)}...{CONFIG.registry.slice(-4)}
          </a>
        </div>
      </header>

      {/* ─── Hero ───────────────────────────────────────── */}
      <section style={styles.hero}>
        <h1 style={styles.title}>Independent Verification Report</h1>
        <p style={styles.subtitle}>
          Replace <em style={{ color: '#ef4444', textDecoration: 'line-through' }}>trust the AI</em>{' '}
          with <em style={{ color: '#22c55e' }}>verify the AI</em>.
          {' '}ZK-proof verification of AI-generated call decisions.
        </p>
        <p style={styles.trustNote}>
          🔒 This page reads <strong>only</strong> from the public blockchain. No API keys, wallets, or trust in VeriCall required.
        </p>

        {state.phase === 'idle' && (
          <button onClick={run} style={styles.startButton}>
            ▶ Run Verification
          </button>
        )}
      </section>

      {/* ─── Result Banner — per-record summary ──────── */}
      {state.phase === 'done' && (() => {
        const contractOk = state.contract?.checks.every(c => c.status === 'pass') ?? true;
        const contractActive = state.contract?.checks.filter(c => c.status !== 'skip').length ?? 0;
        const contractPassed = state.contract?.checks.filter(c => c.status === 'pass').length ?? 0;
        const recordSummaries = state.records.map(r => {
          const active = r.checks.filter(c => c.status !== 'skip');
          return { index: r.index, decision: r.decision, ok: active.every(c => c.status === 'pass'), passed: active.filter(c => c.status === 'pass').length, total: active.length };
        });
        const failedRecords = recordSummaries.filter(r => !r.ok);
        return (
          <div style={{
            ...styles.resultBanner,
            borderColor: allPassed ? '#22c55e' : failedRecords.length > 0 ? '#ef4444' : '#22c55e',
            background: allPassed ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.04)',
          }}>
            {/* Overall headline */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', width: '100%' }}>
              <div style={{ fontSize: '2rem' }}>{allPassed ? '✅' : '⚠️'}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: allPassed ? '#22c55e' : '#eab308' }}>
                  {allPassed ? 'ALL RECORDS VERIFIED' : `${failedRecords.length} of ${recordSummaries.length} record${recordSummaries.length > 1 ? 's' : ''} with issues`}
                </div>
                <div style={{ color: '#888', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                  {state.passedChecks}/{state.totalChecks} checks on {CONFIG.network}
                </div>
              </div>
            </div>
            {/* Per-item summary pills */}
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '0.4rem', width: '100%', marginTop: '0.5rem' }}>
              <span style={{
                padding: '0.25rem 0.65rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600,
                background: contractOk ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                color: contractOk ? '#22c55e' : '#ef4444',
                border: `1px solid ${contractOk ? '#22c55e30' : '#ef444430'}`,
              }}>
                {contractOk ? '✓' : '✗'} Contract {contractPassed}/{contractActive}
              </span>
              {recordSummaries.map(r => (
                <span key={r.index} style={{
                  padding: '0.25rem 0.65rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600,
                  background: r.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                  color: r.ok ? '#22c55e' : '#ef4444',
                  border: `1px solid ${r.ok ? '#22c55e30' : '#ef444430'}`,
                }}>
                  {r.ok ? '✓' : '✗'} #{r.index} {r.passed}/{r.total}
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ─── Loading State ──────────────────────────────── */}
      {(state.phase === 'contract' || state.phase === 'records') && (
        <div style={styles.loadingBanner}>
          <div style={styles.spinner} />
          <span style={{ color: '#ccc' }}>
            {state.phase === 'contract' ? 'Verifying contract...' : 'Verifying records...'}
          </span>
        </div>
      )}

      {/* ─── Error ──────────────────────────────────────── */}
      {state.phase === 'error' && (
        <div style={styles.errorBanner}>
          ❌ {state.error}
        </div>
      )}

      {/* ─── Phase 1: Contract ──────────────────────────── */}
      {state.contract && (
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <h2 style={styles.sectionTitle}>Phase 1: Contract</h2>
            <a
              href={`${CONFIG.basescan}/address/${CONFIG.registry}#readContract`}
              target="_blank"
              rel="noopener"
              style={styles.viewOnBasescan}
            >
              {fmtHash(CONFIG.registry)} ↗
            </a>
          </div>

          <div style={styles.contractCompact}>
            <div style={styles.contractMeta}>
              <span><span style={{ color: '#888' }}>Records</span> <strong>{state.contract.stats.total}</strong></span>
              <span style={{ color: '#1a1a1a' }}>|</span>
              <span style={{ color: '#ccc' }}>{state.contract.stats.accepted} accepted</span>
              <span style={{ color: '#ccc' }}>{state.contract.stats.blocked} blocked</span>
              <span style={{ color: '#ccc' }}>{state.contract.stats.recorded} recorded</span>
            </div>
            <div style={styles.contractChecksInline}>
              {state.contract.checks.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', fontSize: '0.8rem' }}>
                  <span style={{
                    color: c.status === 'pass' ? '#22c55e' : c.status === 'fail' ? '#ef4444' : '#eab308',
                  }}>
                    {c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '◌'}
                  </span>
                  <span style={{ color: '#ccc' }}>{c.label}</span>
                  {c.detail && (
                    c.detailLink
                      ? <a href={c.detailLink} target="_blank" rel="noopener" style={{ color: '#aaa', fontSize: '0.75rem', textDecoration: 'none' }}>— {c.detail} ↗</a>
                      : <span style={{ color: '#999', fontSize: '0.75rem' }}>— {c.detail}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ─── Phase 2: Records ───────────────────────────── */}
      {state.records.length > 0 && (() => {
        const sorted = [...state.records].sort((a, b) => b.index - a.index);
        const selected = selectedIdx !== null ? state.records.find(r => r.index === selectedIdx) : null;
        return (
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Phase 2: Record Verification</h2>

            {/* Record List */}
            <div style={styles.recordList}>
              {sorted.map(rec => {
                const isSelected = selectedIdx === rec.index;
                const allOk = rec.checks.every(c => c.status === 'pass' || c.status === 'skip');
                return (
                  <div
                    key={rec.index}
                    onClick={() => setSelectedIdx(isSelected ? null : rec.index)}
                    style={{
                      ...styles.recordListItem,
                      borderColor: isSelected ? '#22c55e40' : '#1a1a1a',
                      background: isSelected ? '#0a1a0a' : '#111',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{ color: allOk ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                          {allOk ? '✓' : '✗'}
                        </span>
                        <span style={{ color: allOk ? '#22c55e' : '#ef4444', fontSize: '0.8rem', fontWeight: 600 }}>
                          {allOk ? 'Verified' : 'Failed'}
                        </span>
                        <span style={{ fontWeight: 500 }}>#{rec.index}</span>
                        <span style={{ color: '#ccc', fontSize: '0.85rem' }}>
                          {rec.decisionLabel}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {rec.txHash && (
                          <a
                            href={txLink(rec.txHash)}
                            target="_blank"
                            rel="noopener"
                            onClick={e => e.stopPropagation()}
                            style={{ color: '#888', fontSize: '0.75rem', textDecoration: 'none' }}
                          >
                            {fmtHash(rec.txHash)}
                          </a>
                        )}
                        <span style={{ color: '#888', fontSize: '0.75rem' }}>
                          {new Date(rec.timestamp).toLocaleString()}
                        </span>
                        <span style={{ color: '#888' }}>{isSelected ? '▾' : '▸'}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Selected Record Detail */}
            {selected && <RecordDetail record={selected} />}
          </section>
        );
      })()}

      {/* ─── Trust Model + Reproduce ────────────────────── */}
      {state.phase === 'done' && (
        <>
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>🔒 Trust Model</h2>
            <div style={styles.trustModelBox}>
              <p style={{ marginBottom: '0.75rem' }}>
                This verification runs <strong>entirely in your browser</strong>.
                It connects directly to the public Base Sepolia RPC ({CONFIG.rpcUrl}).
              </p>
              <p style={{ marginBottom: '0.75rem' }}>
                No VeriCall server-side APIs are called for any verification check.
                You can confirm this by inspecting network requests in DevTools.
              </p>
              <div style={{ marginTop: '1rem' }}>
                <strong>What each check proves:</strong>
                <div style={styles.checkExplain}>
                  <div><code>V1</code> ZK proof was verified by the on-chain verifier at registration time</div>
                  <div><code>V2</code> Journal data has not been modified (keccak256 commitment)</div>
                  <div><code>V3</code> Contract confirms journal integrity (on-chain verifyJournal)</div>
                  <div><code>V4</code> Independent re-verification — calling verifier.verify() directly</div>
                  <div><code>V5</code> TLSNotary HTTP metadata is well-formed and non-trivial</div>
                  <div><code>V6</code> Registration transaction is findable on-chain</div>
                  <div><code>V7</code> ProofVerified event confirms ZK verification happened</div>
                  <div><code>V8</code> <strong>GitHub Code Attestation</strong> — git commit SHA proven on-chain, linking to auditable source code</div>
                </div>
              </div>
            </div>
          </section>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>🔁 Verify It Yourself</h2>
            <div style={styles.reproduceGrid}>
              <div style={styles.reproduceCard}>
                <div style={styles.reproduceLabel}>CLI (full report)</div>
                <pre style={styles.codeBlock}>
{`git clone ${CONFIG.repo}
cd veriCall && pnpm install
npx tsx scripts/verify.ts`}
                </pre>
              </div>
              <div style={styles.reproduceCard}>
                <div style={styles.reproduceLabel}>Foundry (no VeriCall code needed)</div>
                <pre style={styles.codeBlock}>
{`cast call ${CONFIG.registry} \\
  "getStats()(uint256,uint256,uint256,uint256)" \\
  --rpc-url ${CONFIG.rpcUrl}`}
                </pre>
              </div>
            </div>
          </section>

          {/* ─── Pipeline Diagram ───────────────────────── */}
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>🔗 Pipeline</h2>
            <div style={styles.pipeline}>
              {[
                { icon: '📞', label: 'Phone Call' },
                { icon: '🤖', label: 'AI Screening' },
                { icon: '📡', label: 'Decision API' },
                { icon: '🔐', label: 'vlayer Web Proof' },
                { icon: '⚡', label: 'ZK Proof' },
                { icon: '⛓️', label: 'Base Sepolia' },
              ].map((step, i, arr) => (
                <div key={i} style={styles.pipelineStep}>
                  <div style={styles.pipelineIcon}>{step.icon}</div>
                  <div style={styles.pipelineLabel}>{step.label}</div>
                  {i < arr.length - 1 && <div style={styles.pipelineArrow}>→</div>}
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {/* ─── Footer ─────────────────────────────────────── */}
      <footer style={styles.footer}>
        <span>VeriCall — Trust-Minimized AI Call Verification</span>
        <a href={CONFIG.repo} target="_blank" rel="noopener" style={{ color: '#888' }}>
          GitHub ↗
        </a>
        <a href={`${CONFIG.basescan}/address/${CONFIG.registry}`} target="_blank" rel="noopener" style={{ color: '#888' }}>
          BaseScan ↗
        </a>
      </footer>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Sub-Components
// ═══════════════════════════════════════════════════════════════

function RecordDetail({ record }: { record: RecordData }) {
  const allOk = record.checks.every(c => c.status === 'pass' || c.status === 'skip');

  return (
    <div style={styles.recordCard}>
      {/* Header */}
      <div style={styles.recordHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.1rem', fontWeight: 600 }}>Record #{record.index}</span>
          <span style={{
            color: '#ccc', fontWeight: 600, fontSize: '0.9rem',
            padding: '0.2rem 0.6rem', borderRadius: '999px',
            background: '#ffffff08', border: '1px solid #333',
          }}>
            {record.decisionLabel}
          </span>
          <span style={{
            color: allOk ? '#22c55e' : '#ef4444', fontWeight: 700, fontSize: '0.8rem',
          }}>
            {allOk ? '✓ Verified' : '✗ Failed'}
          </span>
        </div>
      </div>

      {/* Reason */}
      <div style={styles.recordReason}>
        &ldquo;{record.reason}&rdquo;
      </div>

      {/* Metadata */}
      <div style={styles.recordMeta}>
        <div>
          <span style={{ color: '#aaa' }}>Call ID </span>
          <code style={{ color: '#e0e0e0' }}>{fmtHash(record.callId)}</code>
        </div>
        <div>
          <span style={{ color: '#aaa' }}>Time </span>
          {record.timestamp}
        </div>
        <div>
          <span style={{ color: '#aaa' }}>Submitter </span>
          <a href={addrLink(record.submitter)} target="_blank" rel="noopener" style={{ color: '#ccc', textDecoration: 'none' }}>
            <code>{fmtHash(record.submitter)}</code> ↗
          </a>
        </div>
        {record.txHash && (
          <div>
            <span style={{ color: '#aaa' }}>TX </span>
            <a href={txLink(record.txHash)} target="_blank" rel="noopener" style={{ color: '#22c55e', textDecoration: 'none' }}>
              <code>{fmtHash(record.txHash)}</code> ↗
            </a>
          </div>
        )}
        {record.provenData.extractedData && (
          <div>
            <span style={{ color: '#aaa' }}>Proven Data </span>
            <code style={{ color: '#22c55e' }}>{record.provenData.extractedData}</code>
          </div>
        )}
      </div>

      {/* ZK Checks — single column */}
      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '0.4rem' }}>
        {record.checks.map(c => (
          <div key={c.id} style={styles.zkCheckCell}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '0.15rem' }}>
                <span>
                  <code style={{ color: '#888', fontSize: '0.75rem', marginRight: '0.4rem' }}>[{c.id}]</code>
                  <span style={{ fontSize: '0.85rem', color: '#e0e0e0' }}>{c.label}</span>
                </span>
                {c.detail && (
                  c.detailLink
                    ? <a href={c.detailLink} target="_blank" rel="noopener" style={{ color: '#aaa', fontSize: '0.75rem', paddingLeft: '1rem', textDecoration: 'none' }}>
                        {c.detail} ↗
                      </a>
                    : <span style={{ color: '#aaa', fontSize: '0.75rem', paddingLeft: '1rem' }}>
                        {c.detail}
                      </span>
                )}
                {c.subDetails && c.subDetails.map((sub, si) => (
                  <span key={si} style={{ color: '#888', fontSize: '0.7rem', paddingLeft: '1rem', fontFamily: 'monospace' }}>
                    {sub.link
                      ? <a href={sub.link} target="_blank" rel="noopener" style={{ color: '#888', textDecoration: 'none' }}>{sub.text} ↗</a>
                      : sub.text
                    }
                  </span>
                ))}
              </div>
              <span style={{
                color: c.status === 'pass' ? '#22c55e' : c.status === 'skip' ? '#888' : '#ef4444',
                fontWeight: 600, flexShrink: 0,
              }}>
                {c.status === 'pass' ? '✓' : c.status === 'skip' ? '—' : '✗'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Styles — dark theme, green accent
// ═══════════════════════════════════════════════════════════════

const styles: Record<string, React.CSSProperties> = {
  page: {
    background: '#050505', color: '#ededed', minHeight: '100vh',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace",
    maxWidth: '900px', margin: '0 auto', padding: '0 1.5rem 3rem',
  },

  // Header
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '1rem 0', borderBottom: '1px solid #1a1a1a',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '0.75rem' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '1rem' },
  logo: { fontSize: '1.1rem', fontWeight: 700 },
  badge: {
    fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em',
    background: '#1a1a1a', color: '#888', padding: '0.2rem 0.5rem',
    borderRadius: '4px',
  },
  headerLink: {
    color: '#888', textDecoration: 'none', fontSize: '0.85rem',
    display: 'flex', alignItems: 'center', gap: '0.4rem',
  },
  dot: {
    width: '8px', height: '8px', borderRadius: '50%',
    background: '#22c55e', display: 'inline-block',
  },

  // Hero
  hero: { padding: '2rem 0 1rem' },
  title: { fontSize: '1.8rem', fontWeight: 700, marginBottom: '0.5rem' },
  subtitle: { color: '#ccc', fontSize: '1rem', lineHeight: 1.5 },
  trustNote: {
    marginTop: '0.75rem', padding: '0.6rem 1rem',
    background: '#111', border: '1px solid #222', borderRadius: '8px',
    fontSize: '0.85rem', color: '#aaa',
  },
  startButton: {
    marginTop: '1.25rem', padding: '0.75rem 2rem',
    background: '#22c55e', color: '#000', border: 'none',
    borderRadius: '8px', fontSize: '1rem', fontWeight: 700,
    cursor: 'pointer', letterSpacing: '0.02em',
  },

  // Result Banner
  resultBanner: {
    display: 'flex', alignItems: 'center', gap: '1.25rem',
    padding: '1.5rem', borderRadius: '12px',
    border: '1px solid', marginTop: '1.5rem',
    flexWrap: 'wrap' as const,
  },
  progressBarOuter: {
    width: '100%', height: '6px', background: '#1a1a1a',
    borderRadius: '3px', marginTop: '0.5rem',
  },
  progressBarInner: {
    height: '6px', borderRadius: '3px', transition: 'width 0.5s ease',
  },

  // Loading
  loadingBanner: {
    display: 'flex', alignItems: 'center', gap: '0.75rem',
    padding: '1.25rem', background: '#111',
    border: '1px solid #222', borderRadius: '12px',
    marginTop: '1.5rem',
  },
  spinner: {
    width: '20px', height: '20px',
    border: '2px solid #333', borderTop: '2px solid #22c55e',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },

  // Error
  errorBanner: {
    padding: '1rem', background: 'rgba(239,68,68,0.1)',
    border: '1px solid #ef4444', borderRadius: '8px',
    marginTop: '1.5rem', color: '#ef4444',
  },

  // Section
  section: {
    marginTop: '2rem',
  },
  sectionHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: '1rem',
  },
  sectionTitle: { fontSize: '1.2rem', fontWeight: 600 },
  viewOnBasescan: {
    color: '#888', textDecoration: 'none', fontSize: '0.8rem',
  },

  // Contract Compact
  contractCompact: {
    background: '#111', border: '1px solid #1a1a1a', borderRadius: '10px',
    padding: '1rem',
  },
  contractMeta: {
    display: 'flex', gap: '0.75rem', flexWrap: 'wrap' as const,
    fontSize: '0.85rem', marginBottom: '0.6rem',
  },
  contractChecksInline: {
    display: 'flex', flexDirection: 'column' as const, gap: '0.2rem',
  },

  // Record List
  recordList: {
    display: 'flex', flexDirection: 'column' as const, gap: '0.35rem',
    marginBottom: '1rem',
  },
  recordListItem: {
    padding: '0.6rem 0.9rem', borderRadius: '8px',
    border: '1px solid #1a1a1a', transition: 'background 0.15s',
  },

  // Record Card
  recordCard: {
    background: '#111', border: '1px solid #1a1a1a', borderRadius: '12px',
    padding: '1.25rem', marginBottom: '1rem',
  },
  recordHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    flexWrap: 'wrap' as const, gap: '0.5rem', marginBottom: '0.75rem',
  },
  recordReason: {
    color: '#e0e0e0', fontStyle: 'italic' as const,
    padding: '0.5rem 0', borderBottom: '1px solid #1a1a1a',
    marginBottom: '0.75rem', fontSize: '0.9rem',
  },
  recordMeta: {
    display: 'flex', flexDirection: 'column' as const, gap: '0.25rem',
    fontSize: '0.8rem', marginBottom: '1rem',
  },

  // ZK Checks
  zkCheckCell: {
    padding: '0.5rem 0.75rem', background: '#050505',
    borderRadius: '8px', border: '1px solid #1a1a1a',
  },

  // Trust Model
  trustModelBox: {
    background: '#111', border: '1px solid #1a1a1a', borderRadius: '12px',
    padding: '1.25rem', fontSize: '0.9rem', color: '#ccc', lineHeight: 1.6,
  },
  checkExplain: {
    marginTop: '0.5rem', display: 'flex', flexDirection: 'column' as const,
    gap: '0.3rem', fontSize: '0.8rem',
  },

  // Reproduce
  reproduceGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem',
  },
  reproduceCard: {
    background: '#111', border: '1px solid #1a1a1a', borderRadius: '10px',
    padding: '1rem',
  },
  reproduceLabel: {
    fontSize: '0.8rem', fontWeight: 600, color: '#22c55e', marginBottom: '0.5rem',
  },
  codeBlock: {
    background: '#050505', padding: '0.75rem',
    borderRadius: '6px', fontSize: '0.72rem',
    overflow: 'auto' as const, lineHeight: 1.4, color: '#ccc',
    border: '1px solid #1a1a1a',
  },

  // Pipeline
  pipeline: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: '0', padding: '1.5rem 0', flexWrap: 'wrap' as const,
  },
  pipelineStep: {
    display: 'flex', alignItems: 'center', gap: '0.3rem',
  },
  pipelineIcon: {
    fontSize: '1.5rem', textAlign: 'center' as const,
  },
  pipelineLabel: {
    fontSize: '0.75rem', color: '#ccc',
  },
  pipelineArrow: {
    color: '#333', margin: '0 0.6rem', fontSize: '1.2rem',
  },

  // Footer
  footer: {
    display: 'flex', justifyContent: 'center', gap: '2rem',
    padding: '2rem 0', borderTop: '1px solid #1a1a1a',
    color: '#888', fontSize: '0.8rem', marginTop: '2rem',
  },
};
