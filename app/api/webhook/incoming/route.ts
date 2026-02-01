import { NextRequest, NextResponse } from 'next/server';
import { createVoiceResponse } from '@/lib/twilio';
import { forwardingConfig, twilioConfig, serverConfig } from '@/lib/config';
import { CallRecord, CallDecision } from '@/lib/types';
import { logCallDecision } from '@/lib/decision-logger';

/**
 * POST /api/webhook/incoming
 * 
 * Twilio webhook endpoint for incoming calls
 * This is the main entry point when a call comes in to the Twilio number
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const body = Object.fromEntries(formData.entries()) as Record<string, string>;

  // Extract call information from Twilio request
  const callRecord: CallRecord = {
    callSid: body.CallSid || '',
    from: body.From || '',
    to: body.To || '',
    callerCity: body.CallerCity,
    callerState: body.CallerState,
    callerCountry: body.CallerCountry,
    timestamp: new Date().toISOString(),
  };

  console.log(`📞 Incoming call from ${callRecord.from} to ${callRecord.to}`);

  const twiml = createVoiceResponse();

  try {
    // Make forwarding decision
    const decision = await makeForwardingDecision(callRecord);
    
    // Log the decision (will be on-chain via Vlayer)
    await logCallDecision(callRecord, decision);

    // Execute the decision
    switch (decision.action) {
      case 'forward':
        // Forward the call to the destination number
        twiml.say({
          voice: 'Polly.Amy' as const,
          language: 'en-US',
        }, 'Please hold while we connect your call.');
        
        const dial = twiml.dial({
          callerId: twilioConfig.phoneNumber,
          timeout: forwardingConfig.timeout,
          action: `${serverConfig.baseUrl}/api/webhook/status`,
        });
        dial.number(decision.forwardTo || forwardingConfig.defaultDestination);
        break;

      case 'reject':
        twiml.say({
          voice: 'Polly.Amy' as const,
          language: 'en-US',
        }, 'Sorry, we are unable to take your call at this time. Goodbye.');
        twiml.hangup();
        break;

      case 'voicemail':
        twiml.say({
          voice: 'Polly.Amy' as const,
          language: 'en-US',
        }, 'No one is available to take your call. Please leave a message after the beep.');
        twiml.record({
          maxLength: 120,
          transcribe: true,
          transcribeCallback: `${serverConfig.baseUrl}/api/webhook/transcription`,
          action: `${serverConfig.baseUrl}/api/webhook/recording-complete`,
        });
        break;

      default:
        // Default: forward to main number
        const defaultDial = twiml.dial({
          callerId: twilioConfig.phoneNumber,
          timeout: forwardingConfig.timeout,
        });
        defaultDial.number(forwardingConfig.defaultDestination);
    }

    console.log(`✅ Decision for ${callRecord.callSid}: ${decision.action} - ${decision.reason}`);
  } catch (error) {
    console.error('Error processing call:', error);
    
    // Fallback: forward to default destination
    twiml.say({
      voice: 'Polly.Amy' as const,
      language: 'en-US',
    }, 'Please hold while we connect your call.');
    
    const fallbackDial = twiml.dial({
      callerId: twilioConfig.phoneNumber,
      timeout: forwardingConfig.timeout,
    });
    fallbackDial.number(forwardingConfig.defaultDestination);
  }

  return new NextResponse(twiml.toString(), {
    status: 200,
    headers: {
      'Content-Type': 'text/xml',
    },
  });
}

/**
 * Make a decision on whether to forward the call
 * MVP: Simple whitelist-based decision
 * Future: AI-powered decision with on-chain logging via Vlayer
 */
async function makeForwardingDecision(callRecord: CallRecord): Promise<CallDecision> {
  const { from } = callRecord;
  const whitelist = forwardingConfig.whitelist;

  // MVP Logic: Check whitelist
  // If whitelist is empty, forward all calls
  // If whitelist has entries, only forward matching numbers
  
  if (whitelist.length === 0) {
    // No whitelist configured, forward all calls
    return {
      action: 'forward',
      reason: 'No whitelist configured - forwarding all calls',
      forwardTo: forwardingConfig.defaultDestination,
      confidence: 1.0,
    };
  }

  // Check if caller is in whitelist
  const isWhitelisted = whitelist.some(pattern => {
    // Support exact match or prefix match with *
    if (pattern.endsWith('*')) {
      return from.startsWith(pattern.slice(0, -1));
    }
    return from === pattern;
  });

  if (isWhitelisted) {
    return {
      action: 'forward',
      reason: `Caller ${from} is in whitelist`,
      forwardTo: forwardingConfig.defaultDestination,
      confidence: 1.0,
    };
  }

  // Not in whitelist - for MVP, still forward but log it
  // In production, this could trigger AI verification
  return {
    action: 'forward',
    reason: `Caller ${from} not in whitelist - forwarding for manual screening`,
    forwardTo: forwardingConfig.defaultDestination,
    confidence: 0.5,
  };
}
