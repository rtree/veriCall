import { NextRequest, NextResponse } from 'next/server';
import { createVoiceResponse } from '@/lib/twilio';

/**
 * POST /api/webhook/status
 * 
 * Twilio webhook endpoint for call status updates
 * Called when a forwarded call completes or fails
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const body = Object.fromEntries(formData.entries()) as Record<string, string>;

  const status = {
    callSid: body.CallSid,
    callStatus: body.CallStatus,
    dialCallStatus: body.DialCallStatus,
    duration: body.CallDuration,
    timestamp: new Date().toISOString(),
  };

  console.log(`📊 Call ${status.callSid} status: ${status.callStatus}, dial status: ${status.dialCallStatus}`);

  const twiml = createVoiceResponse();

  // Handle failed forwarding attempts
  if (status.dialCallStatus === 'no-answer' || 
      status.dialCallStatus === 'busy' || 
      status.dialCallStatus === 'failed') {
    twiml.say({
      voice: 'Polly.Amy' as const,
      language: 'en-US',
    }, 'The person you are trying to reach is unavailable. Please leave a message after the beep.');
    twiml.record({
      maxLength: 120,
      transcribe: true,
    });
  }

  return new NextResponse(twiml.toString(), {
    status: 200,
    headers: {
      'Content-Type': 'text/xml',
    },
  });
}
