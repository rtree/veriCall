import twilio from 'twilio';
import { twilioConfig } from './config';

// Initialize Twilio client
const client = twilio(twilioConfig.accountSid, twilioConfig.authToken);

/**
 * Validate Twilio webhook signature
 */
export function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  return twilio.validateRequest(
    twilioConfig.authToken,
    signature,
    url,
    params
  );
}

/**
 * Get Twilio VoiceResponse class for TwiML generation
 */
export function createVoiceResponse() {
  return new twilio.twiml.VoiceResponse();
}

/**
 * Make an outbound call (for testing)
 */
export async function makeOutboundCall(to: string, twimlUrl: string) {
  return client.calls.create({
    to,
    from: twilioConfig.phoneNumber,
    url: twimlUrl,
  });
}

/**
 * Get call details
 */
export async function getCallDetails(callSid: string) {
  return client.calls(callSid).fetch();
}

export { client as twilioClient };
