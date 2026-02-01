import twilio from 'twilio';
import { twilioConfig } from '@/lib/config';

/**
 * Twilio Client
 * Twilio操作を集約
 */

const client = twilio(twilioConfig.accountSid, twilioConfig.authToken);

/** TwiML VoiceResponse を生成 */
export function createVoiceResponse() {
  return new twilio.twiml.VoiceResponse();
}

/** Twilio署名を検証 */
export function validateSignature(
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

/** 発信テスト用 */
export async function makeCall(to: string, twimlUrl: string) {
  return client.calls.create({
    to,
    from: twilioConfig.phoneNumber,
    url: twimlUrl,
  });
}

/** 通話詳細取得 */
export async function getCall(callSid: string) {
  return client.calls(callSid).fetch();
}

export { client };
