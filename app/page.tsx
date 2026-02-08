import Link from 'next/link';

export default function Home() {
  return (
    <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>☎️VeriCall</h1>
      <p style={{ color: '#888', marginBottom: '2rem' }}>
        AI Phone Receptionist with On-chain Verification
      </p>

      <nav style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
        <Link href="/monitoring" style={{ 
          background: '#1a1a1a', 
          padding: '0.75rem 1.5rem', 
          borderRadius: '8px' 
        }}>
          📊 Monitoring
        </Link>
        <Link href="/demo" style={{ 
          background: '#06b6d410', 
          padding: '0.75rem 1.5rem', 
          borderRadius: '8px',
          border: '1px solid #06b6d430',
          color: '#06b6d4',
        }}>
          📞 Live Demo
        </Link>
        <Link href="/verify" style={{ 
          background: '#0a2a0a', 
          padding: '0.75rem 1.5rem', 
          borderRadius: '8px',
          border: '1px solid #22c55e40',
          color: '#22c55e',
        }}>
          ⛓️ Verify On-Chain
        </Link>
      </nav>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>📡 Endpoints</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #333' }}>
              <th style={{ padding: '0.5rem' }}>Endpoint</th>
              <th style={{ padding: '0.5rem' }}>Description</th>
            </tr>
          </thead>
          <tbody style={{ color: '#ccc' }}>
            <tr>
              <td style={{ padding: '0.5rem' }}><code>POST /phone/incoming</code></td>
              <td style={{ padding: '0.5rem' }}>Twilio 着信 Webhook</td>
            </tr>
            <tr>
              <td style={{ padding: '0.5rem' }}><code>POST /phone/status</code></td>
              <td style={{ padding: '0.5rem' }}>通話ステータス更新</td>
            </tr>
            <tr>
              <td style={{ padding: '0.5rem' }}><code>GET /phone/logs</code></td>
              <td style={{ padding: '0.5rem' }}>通話ログ一覧</td>
            </tr>
            <tr>
              <td style={{ padding: '0.5rem' }}><code>GET /witness/list</code></td>
              <td style={{ padding: '0.5rem' }}>証明記録一覧</td>
            </tr>
            <tr>
              <td style={{ padding: '0.5rem' }}><code>GET /witness/verify/[id]</code></td>
              <td style={{ padding: '0.5rem' }}>証明検証</td>
            </tr>
            <tr>
              <td style={{ padding: '0.5rem' }}><code>GET /api/health</code></td>
              <td style={{ padding: '0.5rem' }}>ヘルスチェック</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>🛠️ Tech</h2>
        <ul style={{ listStyle: 'none', color: '#888', lineHeight: '2' }}>
          <li>• Next.js 15.5.7 (React2Shell patched)</li>
          <li>• Twilio Programmable Voice</li>
          <li>• Vlayer (Web Proofs + ZK Proofs)</li>
          <li>• GCP Cloud Run</li>
        </ul>
      </section>
    </main>
  );
}
