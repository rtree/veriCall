'use client';

/**
 * /demo — Live Demo Page
 *
 * Connects to the SSE endpoint and renders the full pipeline
 * in real-time: phone call → AI screening → decision → proof → on-chain.
 *
 * After the pipeline completes, links to /verify for independent verification.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface DemoEvent {
  type: string;
  timestamp: string;
  callSid?: string;
  data: Record<string, unknown>;
}

type Phase = 'connecting' | 'waiting' | 'call' | 'decision' | 'proof' | 'complete' | 'error';

interface LogEntry {
  id: number;
  timestamp: string;
  icon: string;
  label: string;
  text: string;
  color: string;
  phase: Phase;
}

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const BASE_URL = typeof window !== 'undefined' ? window.location.origin : '';

const BASESCAN = 'https://sepolia.basescan.org';

// ═══════════════════════════════════════════════════════════════
// Hook: useDemo
// ═══════════════════════════════════════════════════════════════

function useDemo() {
  const [phase, setPhase] = useState<Phase>('connecting');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [lastBlockNumber, setLastBlockNumber] = useState<number | null>(null);
  const [turnCount, setTurnCount] = useState(0);
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const addLog = useCallback(
    (icon: string, label: string, text: string, color: string, logPhase: Phase) => {
      const entry: LogEntry = {
        id: idRef.current++,
        timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
        icon,
        label,
        text,
        color,
        phase: logPhase,
      };
      setLogs(prev => [...prev, entry]);
    },
    [],
  );

  const handleEvent = useCallback(
    (event: DemoEvent) => {
      const { type, data, callSid } = event;

      switch (type) {
        case 'call:start':
          setPhase('call');
          setTurnCount(0);
          setLastTxHash(null);
          setLastBlockNumber(null);
          addLog('📞', 'CALL', `Call connected from ${data.from || 'unknown'}`, '#3b82f6', 'call');
          break;

        case 'call:greeting':
          addLog('🤖', 'AI', String(data.text), '#22c55e', 'call');
          break;

        case 'stt:transcript':
          setTurnCount(prev => prev + 1);
          addLog('🗣️', 'Caller', String(data.text), '#eab308', 'call');
          break;

        case 'ai:response':
          addLog('🤖', 'AI', String(data.text), '#22c55e', 'call');
          break;

        case 'ai:decision': {
          setPhase('decision');
          const decision = String(data.decision).toUpperCase();
          const isBlock = decision === 'BLOCK';
          addLog(
            isBlock ? '🚫' : '✅',
            decision,
            String(data.reason || ''),
            isBlock ? '#ef4444' : '#22c55e',
            'decision',
          );
          break;
        }

        case 'email:sent':
          addLog('📧', 'Email', `Notification sent (${data.decision})`, '#3b82f6', 'decision');
          break;

        case 'witness:start':
          setPhase('proof');
          addLog('⛓️', 'Witness', `Pipeline started`, '#06b6d4', 'proof');
          break;

        case 'witness:web-proof':
          addLog('🌐', 'WebProof', `Generated (${data.proofSize} chars, TLSNotary MPC)`, '#06b6d4', 'proof');
          break;

        case 'witness:zk-proof':
          addLog('🧮', 'ZK Proof', `Compressed (RISC Zero → Groth16, seal: ${data.sealHash})`, '#06b6d4', 'proof');
          break;

        case 'witness:on-chain': {
          const txHash = String(data.txHash ?? '');
          const blockNum = Number(data.blockNumber ?? 0);
          setLastTxHash(txHash);
          setLastBlockNumber(blockNum);
          setPhase('complete');
          addLog('⛓️', 'ON-CHAIN', `TX: ${txHash.slice(0, 10)}…${txHash.slice(-8)}  block: ${blockNum}`, '#22c55e', 'complete');
          break;
        }

        case 'witness:failed':
          addLog('❌', 'Failed', String(data.error), '#ef4444', 'error');
          setPhase('waiting');
          break;

        case 'call:end':
          if (!data.decision) {
            addLog('📞', 'Hangup', 'Call ended without decision', '#888', 'waiting');
            setPhase('waiting');
          }
          break;
      }
    },
    [addLog],
  );

  // SSE connection
  useEffect(() => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let reconnectTimer: ReturnType<typeof setTimeout>;

    async function connect() {
      setPhase('connecting');
      setError(null);

      try {
        const res = await fetch(`${BASE_URL}/api/demo/stream`, {
          headers: { Accept: 'text/event-stream' },
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        setConnected(true);
        setPhase('waiting');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          let eventData = '';

          for (const raw of lines) {
            const l = raw.trim();
            if (l.startsWith('data: ')) {
              eventData = l.slice(6);
            } else if (l === '' && eventData) {
              try {
                const event: DemoEvent = JSON.parse(eventData);
                handleEvent(event);
              } catch { /* ignore */ }
              eventData = '';
            }
          }
        }

        setConnected(false);
        setPhase('connecting');
        reconnectTimer = setTimeout(connect, 3000);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setConnected(false);
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
        reconnectTimer = setTimeout(connect, 5000);
      }
    }

    connect();
    return () => {
      ctrl.abort();
      clearTimeout(reconnectTimer);
    };
  }, [handleEvent]);

  return { phase, logs, connected, error, lastTxHash, lastBlockNumber, turnCount };
}

// ═══════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════

export default function DemoPage() {
  const { phase, logs, connected, error, lastTxHash, lastBlockNumber, turnCount } = useDemo();
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  const phaseInfo = {
    connecting: { label: 'Connecting…', color: '#eab308', anim: true },
    waiting: { label: 'Waiting for call', color: '#888', anim: true },
    call: { label: 'Call in progress', color: '#3b82f6', anim: true },
    decision: { label: 'Decision made', color: '#eab308', anim: false },
    proof: { label: 'Generating proof…', color: '#06b6d4', anim: true },
    complete: { label: 'Verified on-chain ✓', color: '#22c55e', anim: false },
    error: { label: 'Error', color: '#ef4444', anim: false },
  };

  const current = phaseInfo[phase];

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <Link href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span style={styles.logo}>⛓️ VeriCall</span>
          </Link>
          <span style={styles.badge}>LIVE DEMO</span>
        </div>
        <div style={styles.headerRight}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
            color: connected ? '#22c55e' : '#ef4444', fontSize: '0.8rem',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: connected ? '#22c55e' : '#ef4444',
              boxShadow: connected ? '0 0 6px #22c55e' : undefined,
              animation: connected ? 'pulse 2s infinite' : undefined,
            }} />
            {connected ? 'Connected' : 'Disconnected'}
          </span>
          <Link href="/verify" style={styles.headerLink}>
            🔍 Verify
          </Link>
        </div>
      </header>

      {/* Pipeline Banner */}
      <section style={styles.pipeline}>
        <div style={styles.pipelineSteps}>
          {[
            { icon: '📞', label: 'Call', active: phase === 'call' },
            { icon: '🤖', label: 'AI Screen', active: phase === 'call' },
            { icon: '⚖️', label: 'Decision', active: phase === 'decision' },
            { icon: '🔐', label: 'WebProof', active: phase === 'proof' },
            { icon: '🧮', label: 'ZK Proof', active: phase === 'proof' },
            { icon: '⛓️', label: 'On-Chain', active: phase === 'complete' },
          ].map((step, i) => {
            const done = (() => {
              const order = ['connecting', 'waiting', 'call', 'decision', 'proof', 'complete'];
              const currentIdx = order.indexOf(phase);
              // Steps map roughly to phases
              const stepPhaseMap = ['call', 'call', 'decision', 'proof', 'proof', 'complete'];
              const stepIdx = order.indexOf(stepPhaseMap[i]);
              return currentIdx > stepIdx;
            })();
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: '0.3rem',
                opacity: step.active ? 1 : done ? 0.6 : 0.25,
                color: step.active ? '#fff' : done ? '#22c55e' : '#888',
                transition: 'all 0.3s',
              }}>
                <span style={{ fontSize: '1.1rem' }}>{done ? '✓' : step.icon}</span>
                <span style={{ fontSize: '0.75rem', fontWeight: step.active ? 600 : 400 }}>{step.label}</span>
                {i < 5 && <span style={{ color: '#333', margin: '0 0.2rem' }}>→</span>}
              </div>
            );
          })}
        </div>
      </section>

      {/* Status Bar */}
      <div style={{
        ...styles.statusBar,
        borderColor: current.color + '40',
        background: current.color + '08',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {current.anim && (
            <span style={{
              display: 'inline-block',
              width: 10, height: 10,
              borderRadius: '50%',
              border: `2px solid ${current.color}`,
              borderTopColor: 'transparent',
              animation: 'spin 1s linear infinite',
            }} />
          )}
          <span style={{ color: current.color, fontWeight: 600 }}>{current.label}</span>
        </div>
        {phase === 'call' && turnCount > 0 && (
          <span style={{ color: '#888', fontSize: '0.8rem' }}>{turnCount} turns</span>
        )}
      </div>

      {/* Event Log */}
      <div style={styles.logContainer}>
        {logs.length === 0 && phase === 'waiting' && (
          <div style={styles.emptyState}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📞</div>
            <div style={{ color: '#888', fontSize: '1.1rem' }}>Waiting for a phone call…</div>
            <div style={{ color: '#555', fontSize: '0.85rem', marginTop: '0.5rem' }}>
              Call the Twilio number to see the live pipeline
            </div>
          </div>
        )}

        {logs.map(entry => (
          <div key={entry.id} style={styles.logEntry}>
            <span style={styles.logTime}>{entry.timestamp}</span>
            <span style={{ fontSize: '1rem', width: '1.5rem', textAlign: 'center' }}>{entry.icon}</span>
            <span style={{
              fontWeight: 600, fontSize: '0.75rem',
              color: entry.color,
              minWidth: '5rem',
              textTransform: 'uppercase',
            }}>
              {entry.label}
            </span>
            <span style={{
              color: entry.phase === 'call' ? '#ddd' : '#aaa',
              fontStyle: (entry.label === 'Caller' || entry.label === 'AI') ? 'italic' : 'normal',
              flex: 1,
            }}>
              {entry.text}
            </span>
          </div>
        ))}

        <div ref={logEndRef} />
      </div>

      {/* Complete Banner */}
      {phase === 'complete' && lastTxHash && (
        <div style={styles.completeBanner}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <span style={{ fontSize: '2rem' }}>✅</span>
            <div>
              <div style={{ color: '#22c55e', fontWeight: 700, fontSize: '1.2rem' }}>
                Verified &amp; Recorded On-Chain
              </div>
              <div style={{ color: '#888', fontSize: '0.85rem', marginTop: '0.15rem' }}>
                AI decision permanently anchored on Base Sepolia with ZK proof
              </div>
            </div>
          </div>

          <div style={styles.txInfo}>
            <div style={styles.txRow}>
              <span style={{ color: '#888' }}>TX Hash</span>
              <a
                href={`${BASESCAN}/tx/${lastTxHash}`}
                target="_blank"
                rel="noopener"
                style={{ color: '#22c55e', textDecoration: 'none', fontFamily: 'monospace', fontSize: '0.85rem' }}
              >
                {lastTxHash.slice(0, 14)}…{lastTxHash.slice(-10)} ↗
              </a>
            </div>
            {lastBlockNumber && (
              <div style={styles.txRow}>
                <span style={{ color: '#888' }}>Block</span>
                <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{lastBlockNumber}</span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
            <Link href="/verify" style={styles.verifyButton}>
              🔍 Verify This Record
            </Link>
            <a
              href={`${BASESCAN}/tx/${lastTxHash}`}
              target="_blank"
              rel="noopener"
              style={styles.basescanButton}
            >
              View on BaseScan ↗
            </a>
          </div>
        </div>
      )}

      {/* Error */}
      {phase === 'error' && error && (
        <div style={styles.errorBanner}>
          ❌ Connection error: {error}. Retrying…
        </div>
      )}

      {/* Footer */}
      <footer style={styles.footer}>
        <span style={{ color: '#555' }}>
          📞 Call → 🤖 AI Screen → ⚖️ Decision → 🔐 WebProof → 🧮 ZK → ⛓️ Base Sepolia
        </span>
        <span style={{ color: '#444' }}>|</span>
        <Link href="/verify" style={{ color: '#22c55e80', textDecoration: 'none', fontSize: '0.8rem' }}>
          Independent Verification →
        </Link>
      </footer>

      {/* CSS Animations */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#0a0a0a',
    color: '#ededed',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.75rem 1.5rem',
    borderBottom: '1px solid #1a1a1a',
    background: '#050505',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  logo: {
    fontSize: '1.1rem',
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  badge: {
    fontSize: '0.65rem',
    fontWeight: 600,
    padding: '0.15rem 0.5rem',
    borderRadius: '4px',
    background: '#06b6d420',
    color: '#06b6d4',
    letterSpacing: '0.08em',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  headerLink: {
    color: '#22c55e',
    textDecoration: 'none',
    fontSize: '0.85rem',
    padding: '0.3rem 0.6rem',
    borderRadius: '4px',
    border: '1px solid #22c55e30',
    background: '#22c55e08',
  },
  pipeline: {
    padding: '0.75rem 1.5rem',
    borderBottom: '1px solid #1a1a1a',
    background: '#080808',
  },
  pipelineSteps: {
    display: 'flex',
    justifyContent: 'center',
    gap: '0.25rem',
    flexWrap: 'wrap' as const,
  },
  statusBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.5rem 1.5rem',
    borderBottom: '1px solid',
    fontSize: '0.9rem',
  },
  logContainer: {
    flex: 1,
    padding: '1rem 1.5rem',
    overflowY: 'auto' as const,
    maxHeight: 'calc(100vh - 320px)',
    minHeight: '200px',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4rem 2rem',
    textAlign: 'center' as const,
  },
  logEntry: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.5rem',
    padding: '0.3rem 0',
    fontSize: '0.9rem',
    lineHeight: '1.5',
    borderBottom: '1px solid #111',
  },
  logTime: {
    color: '#444',
    fontFamily: 'monospace',
    fontSize: '0.75rem',
    minWidth: '5.5rem',
    paddingTop: '0.15rem',
  },
  completeBanner: {
    margin: '0 1.5rem 1rem',
    padding: '1.25rem 1.5rem',
    borderRadius: '8px',
    border: '1px solid #22c55e30',
    background: 'rgba(34,197,94,0.04)',
  },
  txInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.4rem',
    padding: '0.75rem',
    borderRadius: '6px',
    background: '#111',
    border: '1px solid #1a1a1a',
  },
  txRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.85rem',
  },
  verifyButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.6rem 1.2rem',
    borderRadius: '6px',
    background: '#22c55e15',
    border: '1px solid #22c55e40',
    color: '#22c55e',
    fontWeight: 600,
    fontSize: '0.85rem',
    textDecoration: 'none',
    cursor: 'pointer',
  },
  basescanButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.6rem 1.2rem',
    borderRadius: '6px',
    background: '#1a1a1a',
    border: '1px solid #333',
    color: '#888',
    fontSize: '0.85rem',
    textDecoration: 'none',
    cursor: 'pointer',
  },
  errorBanner: {
    margin: '0 1.5rem 1rem',
    padding: '1rem 1.5rem',
    borderRadius: '8px',
    border: '1px solid #ef444440',
    background: 'rgba(239,68,68,0.06)',
    color: '#ef4444',
    fontSize: '0.9rem',
  },
  footer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem',
    borderTop: '1px solid #1a1a1a',
    fontSize: '0.75rem',
    flexWrap: 'wrap' as const,
  },
};
