import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'VeriCall - AI Phone Receptionist with On-chain Verification',
  description: 'An AI-powered phone receptionist that filters calls and forwards legitimate ones, with verifiable on-chain decision logs via Vlayer.',
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
