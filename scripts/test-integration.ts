/**
 * Integration test for Voice AI pipeline
 * TTS → STT → Gemini → TTS (simulated conversation)
 */
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { SpeechClient } from '@google-cloud/speech';
import { GoogleGenAI } from '@google/genai';

const PROJECT_ID = 'ethglobal-479011';
const LOCATION = 'us-central1';

const SYSTEM_PROMPT = `You are a phone receptionist AI. Your job is to screen calls and determine if they are sales/spam calls.

【Sales Call Indicators - BLOCK】
- Service proposals, offers, deals
- No specific purpose for calling
- Asking for "the person in charge" or "decision maker"
- Real estate, insurance, telecom, cost reduction

【Legitimate Call Indicators - RECORD】
- Has a specific purpose
- Knows who they want to reach by name
- Business partner, customer, personal contact
- Inquiry, appointment, returning a call

【Response Patterns】
1. First response: "Hello, this is an automated assistant. May I ask who's calling and the purpose of your call?"
2. If sales call detected: "I'm sorry, we don't accept sales calls. Thank you for your understanding. Goodbye." [BLOCK]
3. If legitimate: "Thank you. Could you please tell me your message? I'll make sure it gets delivered." → "Thank you. We will get back to you shortly. Goodbye." [RECORD]
4. If unclear: Ask ONE clarifying question, then decide.

Keep responses to 1-2 sentences. Be polite but efficient.
When you make a final decision, end your response with [BLOCK] or [RECORD].`;

async function textToSpeech(text: string): Promise<Buffer> {
  const client = new TextToSpeechClient();
  const [response] = await client.synthesizeSpeech({
    input: { text },
    voice: { languageCode: 'en-US', name: 'en-US-Wavenet-F' },
    audioConfig: { audioEncoding: 'MULAW', sampleRateHertz: 8000 },
  });
  return Buffer.from(response.audioContent as Uint8Array);
}

async function speechToText(audioContent: Buffer): Promise<string> {
  const client = new SpeechClient();
  const [response] = await client.recognize({
    audio: { content: audioContent.toString('base64') },
    config: {
      encoding: 'MULAW',
      sampleRateHertz: 8000,
      languageCode: 'en-US',
      model: 'phone_call',
      enableAutomaticPunctuation: true,
    },
  });
  return response.results?.map(r => r.alternatives?.[0]?.transcript || '').join(' ') || '';
}

async function geminiChat(history: Array<{ role: string; content: string }>): Promise<string> {
  const ai = new GoogleGenAI({
    vertexai: true,
    project: PROJECT_ID,
    location: LOCATION,
  });

  const contents = history
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'user' ? 'user' as const : 'model' as const,
      parts: [{ text: m.content }],
    }));

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents,
    config: { systemInstruction: SYSTEM_PROMPT },
  });

  return response.text || '';
}

async function simulateConversation(callerResponses: string[]) {
  console.log('='.repeat(60));
  console.log('🎤 Voice AI Integration Test');
  console.log('='.repeat(60));

  const history: Array<{ role: string; content: string }> = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  // AI greeting
  const greeting = "Hello, this is an automated assistant. May I ask who's calling and the purpose of your call?";
  console.log(`\n🤖 AI: "${greeting}"`);
  history.push({ role: 'assistant', content: greeting });

  for (const callerText of callerResponses) {
    // Simulate caller speaking (TTS → STT round trip)
    console.log(`\n👤 Caller (original): "${callerText}"`);
    
    // TTS the caller's text (simulating them speaking)
    const callerAudio = await textToSpeech(callerText);
    console.log(`   📢 TTS: ${callerAudio.length} bytes`);
    
    // STT to get what was heard
    const heardText = await speechToText(callerAudio);
    console.log(`   👂 STT heard: "${heardText}"`);
    
    // Add to history
    history.push({ role: 'user', content: heardText });
    
    // Get AI response
    const aiResponse = await geminiChat(history);
    console.log(`\n🤖 AI: "${aiResponse}"`);
    history.push({ role: 'assistant', content: aiResponse });
    
    // Check for decision
    if (aiResponse.includes('[BLOCK]')) {
      console.log('\n🚫 DECISION: BLOCK (Sales call detected)');
      break;
    }
    if (aiResponse.includes('[RECORD]')) {
      console.log('\n✅ DECISION: RECORD (Legitimate call - email notification)');
      break;
    }
  }

  console.log('\n' + '='.repeat(60));
}

async function main() {
  // Test 1: Sales call
  console.log('\n\n📞 TEST 1: Sales Call Scenario');
  await simulateConversation([
    "Hi, I'm calling from ABC Solutions. I'd like to speak with the person in charge about reducing your company's IT costs.",
  ]);

  // Test 2: Legitimate call
  console.log('\n\n📞 TEST 2: Legitimate Call Scenario');
  await simulateConversation([
    "Hi, this is John from Acme Corp. I'm returning a call from Sarah about the project proposal.",
  ]);

  // Test 3: Unclear → clarification
  console.log('\n\n📞 TEST 3: Unclear Call Scenario');
  await simulateConversation([
    "Hello, I need to talk to someone.",
    "I'm a delivery driver. I have a package for your office but the address is unclear.",
  ]);
}

main().catch(console.error);
