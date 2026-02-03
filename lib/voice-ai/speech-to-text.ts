/**
 * Google Speech-to-Text streaming client
 * Optimized for phone calls (8kHz μ-law → Linear16)
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
    if (this.isStreamActive) return;

    console.log('[STT] Starting stream with config:', this.config);

    const request: google.cloud.speech.v1.IStreamingRecognitionConfig = {
      config: {
        encoding: 'LINEAR16' as const,
        sampleRateHertz: this.config.sampleRate,
        languageCode: this.config.languageCode,
        model: this.config.model,
        enableAutomaticPunctuation: true,
        // Optimize for real-time
        useEnhanced: true,
      },
      interimResults: true,
      singleUtterance: false,
    };

    this.recognizeStream = this.client.streamingRecognize(request);
    this.isStreamActive = true;
    console.log('[STT] Stream created, listening for audio...');

    this.recognizeStream.on('data', (response: StreamingRecognizeResponse) => {
      if (!response.results || response.results.length === 0) return;

      const result = response.results[0];
      if (!result.alternatives || result.alternatives.length === 0) return;

      const transcript = result.alternatives[0].transcript || '';
      const isFinal = result.isFinal || false;

      if (this.resultCallback && transcript) {
        this.resultCallback(transcript, isFinal);
      }
    });

    this.recognizeStream.on('error', (error: Error) => {
      console.error('[STT] Stream error:', error.message);
      this.isStreamActive = false;
    });

    this.recognizeStream.on('end', () => {
      console.log('[STT] Stream ended');
      this.isStreamActive = false;
    });
  }

  /**
   * Write audio data to the stream
   * @param audioData - Linear16 PCM audio buffer
   */
  writeAudio(audioData: Buffer): void {
    if (!this.recognizeStream || !this.isStreamActive) {
      console.warn('[STT] Stream not active, starting...');
      this.start();
    }

    if (this.recognizeStream && this.isStreamActive) {
      this.recognizeStream.write({ audioContent: audioData });
    }
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
  }

  /**
   * Check if stream is active
   */
  isActive(): boolean {
    return this.isStreamActive;
  }
}
