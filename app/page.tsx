export default function Home() {
  return (
    <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📞 VeriCall</h1>
      <p style={{ fontSize: '1.2rem', color: '#888', marginBottom: '2rem' }}>
        AI Phone Receptionist with On-chain Verification
      </p>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>🔗 API Endpoints</h2>
        <ul style={{ listStyle: 'none', lineHeight: '2' }}>
          <li>
            <code style={{ background: '#1a1a1a', padding: '0.25rem 0.5rem', borderRadius: '4px' }}>
              POST /api/webhook/incoming
            </code>
            {' '}- Twilio incoming call webhook
          </li>
          <li>
            <code style={{ background: '#1a1a1a', padding: '0.25rem 0.5rem', borderRadius: '4px' }}>
              POST /api/webhook/status
            </code>
            {' '}- Call status updates
          </li>
          <li>
            <code style={{ background: '#1a1a1a', padding: '0.25rem 0.5rem', borderRadius: '4px' }}>
              GET /api/calls
            </code>
            {' '}- List all call logs
          </li>
          <li>
            <code style={{ background: '#1a1a1a', padding: '0.25rem 0.5rem', borderRadius: '4px' }}>
              GET /api/verify/[callId]
            </code>
            {' '}- Verify on-chain decision
          </li>
          <li>
            <code style={{ background: '#1a1a1a', padding: '0.25rem 0.5rem', borderRadius: '4px' }}>
              GET /api/health
            </code>
            {' '}- Health check
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>⚙️ Configuration</h2>
        <p style={{ color: '#888' }}>
          Set the following environment variables to configure VeriCall:
        </p>
        <pre style={{ 
          background: '#1a1a1a', 
          padding: '1rem', 
          borderRadius: '8px', 
          marginTop: '1rem',
          overflow: 'auto'
        }}>
{`TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890
DESTINATION_PHONE_NUMBER=+1987654321
VLAYER_API_KEY=your_vlayer_key`}
        </pre>
      </section>

      <section>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>🛡️ Powered by</h2>
        <ul style={{ listStyle: 'none', lineHeight: '2', color: '#888' }}>
          <li>• <strong>Twilio</strong> - Programmable Voice</li>
          <li>• <strong>Vlayer</strong> - On-chain Verification with ZK Proofs</li>
          <li>• <strong>Next.js 15.5.7</strong> - React Framework (React2Shell patched)</li>
          <li>• <strong>Cloud Run</strong> - Serverless Container Platform</li>
        </ul>
      </section>
    </main>
  );
}
