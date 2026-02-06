/**
 * Google Speech-to-Text streaming client
 * Optimized for phone calls (8kHz μ-law → Linear16)
 * 
 * Uses the official Node.js SDK pattern:
 * - Pass config as argument to streamingRecognize()
 * - Write raw audio buffers directly to stream
 */

import { SpeechClient } from '@google-cloud/speech';
import type { google } from '@google-cloud/speech/build/protos/protos';

type StreamingRecognizeResponse = google.cloud.speech.v1.IStreamingRecognizeResponse;

export interface STTConfig {
  sampleRate?: number;
  languageCode?: string;
  model?: string;
}

export type STTResultCallback = (transcript: string, isFinal: boolean) => void;

export class SpeechToText {
  private client: SpeechClient;
  private recognizeStream: ReturnType<SpeechClient['streamingRecognize']> | null = null;
  private resultCallback: STTResultCallback | null = null;
  private config: STTConfig;
  private isStreamActive = false;
  private hasError = false;
  private isStarting = false;
  private pendingAudio: Buffer[] = [];

  constructor(config: STTConfig = {}) {
    this.client = new SpeechClient();
    this.config = {
      sampleRate: config.sampleRate || 8000,
      languageCode: config.languageCode || 'en-US',
      model: config.model || 'phone_call',
    };
  }

  /**
   * Start streaming recognition
   */
  start(): void {
    if (this.isStreamActive || this.isStarting) return;
    if (this.hasError) {
      console.warn('[STT] Previous error detected, not restarting');
      return;
    }

    this.isStarting = true;
    console.log('[STT] Starting stream with config:', this.config);

    // Build request object for streamingRecognize
    // Following official Node.js SDK pattern from Google documentation
    const request = {
      config: {
        encoding: 'LINEAR16' as const,
        sampleRateHertz: this.config.sampleRate,
        languageCode: this.config.languageCode,
        model: this.config.model,
        enableAutomaticPunctuation: true,
        useEnhanced: true,
        // Speech contexts to help recognize common phone patterns
        speechContexts: [{
          phrases: [
            // Name introduction patterns
            'my name is',
            'this is',
            'I am',
            'speaking',
            'calling from',
            // Common follow-up phrases
            'regarding',
            'about',
            'following up',
            'returning your call',
          ],
          boost: 15,
        }],
      },
      interimResults: true,
      singleUtterance: false,
      // Voice Activity Detection: wait longer before considering speech "done"
      // This prevents cutting off mid-sentence for hesitant speakers
      voiceActivityTimeout: {
        speechStartTimeout: { seconds: 10 },    // Wait up to 10s for speech to begin
        speechEndTimeout: { seconds: 1, nanos: 500000000 },  // Wait 1.5s of silence before ending utterance
      },
    };

    // Create stream WITH config as argument (official pattern)
    this.recognizeStream = this.client.streamingRecognize(request);

    this.recognizeStream.on('data', (response: StreamingRecognizeResponse) => {
      if (!response.results || response.results.length === 0) return;

      const result = response.results[0];
      if (!result.alternatives || result.alternatives.length === 0) return;

      const transcript = result.alternatives[0].transcript || '';
      const isFinal = result.isFinal || false;

      console.log(`[STT] Received: "${transcript}" (final: ${isFinal})`);

      if (this.resultCallback && transcript) {
        this.resultCallback(transcript, isFinal);
      }
    });

    this.recognizeStream.on('error', (error: Error) => {
      console.error('[STT] Stream error:', error.message);
      this.isStreamActive = false;
      this.isStarting = false;
      this.hasError = true;
    });

    this.recognizeStream.on('end', () => {
      console.log('[STT] Stream ended');
      this.isStreamActive = false;
      this.isStarting = false;
    });

    this.isStreamActive = true;
    this.isStarting = false;
    console.log('[STT] Stream ready');

    // Flush any pending audio
    if (this.pendingAudio.length > 0) {
      console.log(`[STT] Flushing ${this.pendingAudio.length} pending audio chunks`);
      for (const audio of this.pendingAudio) {
        // Write raw buffer directly (no wrapping in { audioContent })
        this.recognizeStream.write(audio);
      }
      this.pendingAudio = [];
    }
  }

  /**
   * Write audio data to the stream
   * @param audioData - Linear16 PCM audio buffer
   */
  writeAudio(audioData: Buffer): void {
    if (this.hasError) {
      return;
    }

    // If stream is starting, buffer the audio
    if (this.isStarting) {
      this.pendingAudio.push(audioData);
      return;
    }

    // If stream is not active, start it and buffer this audio
    if (!this.recognizeStream || !this.isStreamActive) {
      this.pendingAudio.push(audioData);
      this.start();
      return;
    }

    // Write raw buffer directly to stream (official SDK pattern)
    this.recognizeStream.write(audioData);
  }

  /**
   * Register callback for transcription results
   */
  onResult(callback: STTResultCallback): void {
    this.resultCallback = callback;
  }

  /**
   * Stop streaming and clean up
   */
  stop(): void {
    if (this.recognizeStream) {
      this.recognizeStream.end();
      this.recognizeStream = null;
    }
    this.isStreamActive = false;
    this.pendingAudio = [];
  }

  /**
   * Check if stream is active
   */
  isActive(): boolean {
    return this.isStreamActive;
  }
}
