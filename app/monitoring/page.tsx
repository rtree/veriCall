export default function MonitoringPage() {
  return (
    <main style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>📊 VeriCall Monitor</h1>
      <p style={{ color: '#888', marginBottom: '2rem' }}>
        コールフローとWitness状況のリアルタイムモニタリング
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        {/* Calls Panel */}
        <section style={{ background: '#111', padding: '1.5rem', borderRadius: '8px' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>📞 Recent Calls</h2>
          <div id="calls-list" style={{ color: '#888' }}>
            <p>Loading...</p>
          </div>
          <a 
            href="/phone/logs" 
            style={{ color: '#4a9eff', display: 'block', marginTop: '1rem' }}
          >
            View API →
          </a>
        </section>

        {/* Witness Panel */}
        <section style={{ background: '#111', padding: '1.5rem', borderRadius: '8px' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>⛓️ Witness Status</h2>
          <div id="witness-list" style={{ color: '#888' }}>
            <p>Loading...</p>
          </div>
          <a 
            href="/witness/list" 
            style={{ color: '#4a9eff', display: 'block', marginTop: '1rem' }}
          >
            View API →
          </a>
        </section>
      </div>

      {/* Flow Diagram */}
      <section style={{ marginTop: '2rem', background: '#111', padding: '1.5rem', borderRadius: '8px' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>🔄 Flow</h2>
        <pre style={{ color: '#4a9eff', fontSize: '0.9rem', overflow: 'auto' }}>
{`📞 Incoming Call (Twilio)
       ↓
   /phone/incoming
       ↓
   [Router: decide()]
       ↓
   onDecisionMade() ──→ [Witness: createWitness()]
       ↓                        ↓
   TwiML Response          Web Proof
       ↓                        ↓
   Call Forwarded          ZK Proof
                                ↓
                           On-chain ✓`}
        </pre>
      </section>

      <footer style={{ marginTop: '2rem', color: '#666', fontSize: '0.9rem' }}>
        <p>Next.js 15.5.7 | Twilio | Vlayer | Base Sepolia</p>
      </footer>
    </main>
  );
}
