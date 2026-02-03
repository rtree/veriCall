import { twilioConfig, forwardingConfig, serverConfig } from '@/lib/config';
import { createVoiceResponse } from './twilio';
import { Decision } from './types';

/**
 * TwiML Builder
 * Twilio用のXMLレスポンスを構築
 */

type VoiceResponse = ReturnType<typeof createVoiceResponse>;

/** 判断に応じたTwiMLを生成 */
export function buildResponse(decision: Decision, callInfo?: { from?: string; callSid?: string }): string {
  const twiml = createVoiceResponse();

  switch (decision.action) {
    case 'forward':
      sayAndDial(twiml, decision.forwardTo!);
      break;
    case 'reject':
      sayAndHangup(twiml);
      break;
    case 'voicemail':
      sayAndRecord(twiml);
      break;
    case 'ai_screen':
      connectToAIStream(twiml, callInfo);
      break;
  }

  return twiml.toString();
}

/** AI音声ストリームに接続 */
function connectToAIStream(twiml: VoiceResponse, callInfo?: { from?: string; callSid?: string }) {
  // Connect to WebSocket for AI screening
  const streamUrl = `wss://${new URL(serverConfig.baseUrl).host}/stream`;
  
  const connect = twiml.connect();
  const stream = connect.stream({
    url: streamUrl,
  });
  
  // Pass caller info as parameters
  if (callInfo?.from) {
    stream.parameter({ name: 'From', value: callInfo.from });
  }
  if (callInfo?.callSid) {
    stream.parameter({ name: 'CallSid', value: callInfo.callSid });
  }
}

/** 転送 */
function sayAndDial(twiml: VoiceResponse, destination: string) {
  twiml.say(
    { voice: 'Polly.Amy', language: 'en-US' },
    'Please hold while we connect your call.'
  );

  const dial = twiml.dial({
    callerId: twilioConfig.phoneNumber,
    timeout: forwardingConfig.timeout,
    action: `${serverConfig.baseUrl}/phone/status`,
  });
  dial.number(destination);
}

/** 拒否 */
function sayAndHangup(twiml: VoiceResponse) {
  twiml.say(
    { voice: 'Polly.Amy', language: 'en-US' },
    'Sorry, we are unable to take your call at this time. Goodbye.'
  );
  twiml.hangup();
}

/** 留守電 */
function sayAndRecord(twiml: VoiceResponse) {
  twiml.say(
    { voice: 'Polly.Amy', language: 'en-US' },
    'No one is available. Please leave a message after the beep.'
  );
  twiml.record({
    maxLength: 120,
    transcribe: true,
  });
}

/** 転送失敗時のフォールバック */
export function buildVoicemailFallback(): string {
  const twiml = createVoiceResponse();
  twiml.say(
    { voice: 'Polly.Amy', language: 'en-US' },
    'The person you are trying to reach is unavailable. Please leave a message.'
  );
  twiml.record({ maxLength: 120, transcribe: true });
  return twiml.toString();
}
