/**
 * Google Text-to-Speech client
 * Optimized for phone calls (8kHz μ-law output)
 */

import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import type { google } from '@google-cloud/text-to-speech/build/protos/protos';

export interface TTSConfig {
  languageCode?: string;
  voiceName?: string;
  speakingRate?: number;
}

export class TextToSpeech {
  private client: TextToSpeechClient;
  private config: TTSConfig;

  constructor(config: TTSConfig = {}) {
    this.client = new TextToSpeechClient();
    this.config = {
      languageCode: config.languageCode || 'en-US',
      voiceName: config.voiceName || 'en-US-Wavenet-F', // Female voice
      speakingRate: config.speakingRate || 1.0,
    };
  }

  /**
   * Synthesize text to speech
   * Returns audio in μ-law format ready for Twilio
   * @param text - Text to synthesize
   * @returns Base64 encoded μ-law audio
   */
  async synthesize(text: string): Promise<string> {
    const request: google.cloud.texttospeech.v1.ISynthesizeSpeechRequest = {
      input: { text },
      voice: {
        languageCode: this.config.languageCode,
        name: this.config.voiceName,
      },
      audioConfig: {
        audioEncoding: 'MULAW' as const,
        sampleRateHertz: 8000, // Twilio expects 8kHz
        speakingRate: this.config.speakingRate,
      },
    };

    const [response] = await this.client.synthesizeSpeech(request);

    if (!response.audioContent) {
      throw new Error('No audio content in TTS response');
    }

    // Return as base64 for Twilio
    const audioBuffer = response.audioContent as Uint8Array;
    return Buffer.from(audioBuffer).toString('base64');
  }
}
