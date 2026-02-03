/**
 * Test Text-to-Speech with ADC
 */
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import * as fs from 'fs';

async function test() {
  const client = new TextToSpeechClient();

  console.log('Testing TTS with ADC...');

  const [response] = await client.synthesizeSpeech({
    input: { text: "Hello, this is an automated assistant. May I ask who's calling and the purpose of your call?" },
    voice: {
      languageCode: 'en-US',
      name: 'en-US-Wavenet-F', // Female voice
    },
    audioConfig: {
      audioEncoding: 'MULAW',
      sampleRateHertz: 8000, // Twilio expects 8kHz
    },
  });

  if (response.audioContent) {
    // Save as raw μ-law file
    fs.writeFileSync('/tmp/test-tts.raw', response.audioContent);
    console.log('✅ TTS Success! Audio saved to /tmp/test-tts.raw');
    console.log(`   Audio size: ${(response.audioContent as Buffer).length} bytes`);
    
    // Also save as base64 for reference
    const base64 = Buffer.from(response.audioContent as Uint8Array).toString('base64');
    console.log(`   Base64 length: ${base64.length} chars`);
  } else {
    console.error('❌ No audio content returned');
  }
}

test().catch(console.error);
