/**
 * Test Speech-to-Text with ADC
 * Uses the TTS output as input to verify the pipeline
 */
import { SpeechClient } from '@google-cloud/speech';
import * as fs from 'fs';

async function test() {
  // First check if we have the TTS output
  const audioFile = '/tmp/test-tts.raw';
  if (!fs.existsSync(audioFile)) {
    console.error('❌ Run test-tts.ts first to generate audio');
    process.exit(1);
  }

  const client = new SpeechClient();
  console.log('Testing STT with ADC...');

  // Read the μ-law audio
  const audioContent = fs.readFileSync(audioFile);
  console.log(`   Input audio size: ${audioContent.length} bytes`);

  const [response] = await client.recognize({
    audio: {
      content: audioContent.toString('base64'),
    },
    config: {
      encoding: 'MULAW',
      sampleRateHertz: 8000,
      languageCode: 'en-US',
      model: 'phone_call',
      enableAutomaticPunctuation: true,
    },
  });

  if (response.results && response.results.length > 0) {
    const transcript = response.results
      .map(result => result.alternatives?.[0]?.transcript || '')
      .join(' ');
    console.log('✅ STT Success!');
    console.log(`   Transcript: "${transcript}"`);
  } else {
    console.error('❌ No transcription results');
  }
}

test().catch(console.error);
