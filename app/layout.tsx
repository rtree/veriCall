import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'VeriCall - AI Phone Receptionist with On-chain Verification',
  description: 'Powered by Twilio & Vlayer',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
