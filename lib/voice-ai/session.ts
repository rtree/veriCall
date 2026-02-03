/**
 * Voice AI Session Manager
 * Manages a single phone call's AI conversation
 */

import { WebSocket } from 'ws';
import { SpeechToText } from './speech-to-text';
import { TextToSpeech } from './text-to-speech';
import { GeminiChat, CallDecision } from './gemini';
import { mulawToLinear16 } from './audio-utils';
import { sendVoiceAINotification } from './email-notify';

export interface SessionConfig {
  callSid: string;
  from: string;
  streamSid?: string;
}

export interface TwilioMediaMessage {
  event: 'connected' | 'start' | 'media' | 'stop' | 'mark';
  sequenceNumber?: string;
  streamSid?: string;
  start?: {
    streamSid: string;
    callSid: string;
    customParameters?: Record<string, string>;
  };
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string; // Base64 encoded μ-law audio
  };
  mark?: {
    name: string;
  };
}

export class VoiceAISession {
  private ws: WebSocket;
  private config: SessionConfig;
  private stt: SpeechToText;
  private tts: TextToSpeech;
  private gemini: GeminiChat;
  private streamSid: string | null = null;
  private isProcessing = false;
  private pendingAudio: Buffer[] = [];
  private silenceTimeout: NodeJS.Timeout | null = null;
  private decision: CallDecision | null = null;
  private hasGreeted = false;
  private audioChunkCount = 0;

  // Silence detection
  private lastAudioTime = Date.now();
  private readonly SILENCE_THRESHOLD_MS = 1500; // 1.5 seconds of silence

  constructor(ws: WebSocket, config: SessionConfig) {
    this.ws = ws;
    this.config = config;
    this.stt = new SpeechToText({ languageCode: 'en-US' });
    this.tts = new TextToSpeech({ languageCode: 'en-US' });
    this.gemini = new GeminiChat();

    this.setupSTTCallback();
  }

  /**
   * Handle incoming WebSocket message from Twilio
   */
  async handleMessage(data: string): Promise<void> {
    try {
      const message: TwilioMediaMessage = JSON.parse(data);

      switch (message.event) {
        case 'connected':
          console.log(`[Session ${this.config.callSid}] Connected`);
          break;

        case 'start':
          this.streamSid = message.start?.streamSid || null;
          console.log(`[Session ${this.config.callSid}] Stream started: ${this.streamSid}`);
          // Send initial greeting
          await this.sendGreeting();
          break;

        case 'media':
          if (message.media) {
            await this.handleMedia(message.media);
          }
          break;

        case 'stop':
          console.log(`[Session ${this.config.callSid}] Stream stopped`);
          await this.cleanup();
          break;

        case 'mark':
          // Audio playback marker - can be used for timing
          console.log(`[Session ${this.config.callSid}] Mark: ${message.mark?.name}`);
          break;
      }
    } catch (error) {
      console.error(`[Session ${this.config.callSid}] Error handling message:`, error);
    }
  }

  /**
   * Send initial greeting
   */
  private async sendGreeting(): Promise<void> {
    if (this.hasGreeted) return;
    this.hasGreeted = true;

    const greeting = "Hello, this is an automated assistant. May I ask who's calling and the purpose of your call?";
    console.log(`[Session ${this.config.callSid}] 🎤 Greeting: "${greeting}"`);
    await this.speak(greeting);
  }

  /**
   * Handle incoming audio from caller
   */
  private async handleMedia(media: TwilioMediaMessage['media']): Promise<void> {
    if (!media?.payload) return;

    // Decode base64 μ-law audio
    const mulawBuffer = Buffer.from(media.payload, 'base64');
    // Convert to Linear16 for STT
    const linear16Buffer = mulawToLinear16(mulawBuffer);

    // Debug: log first few audio chunks
    if (this.audioChunkCount < 5) {
      console.log(`[Session ${this.config.callSid}] Audio chunk ${this.audioChunkCount + 1}: ${mulawBuffer.length} bytes`);
    }
    this.audioChunkCount++;

    // Update last audio time for silence detection
    this.lastAudioTime = Date.now();

    // Send to STT
    this.stt.writeAudio(linear16Buffer);

    // Reset silence timer
    this.resetSilenceTimer();
  }

  /**
   * Setup STT result callback
   */
  private setupSTTCallback(): void {
    this.stt.onResult(async (transcript, isFinal) => {
      // Log interim results too for debugging
      console.log(`[Session ${this.config.callSid}] STT: "${transcript}" (final: ${isFinal})`);
      
      if (isFinal && transcript.trim()) {
        console.log(`[Session ${this.config.callSid}] Caller said: "${transcript}"`);
        await this.processCallerInput(transcript);
      }
    });
  }

  /**
   * Process what the caller said
   */
  private async processCallerInput(transcript: string): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // Get AI response
      const response = await this.gemini.chat(transcript);
      console.log(`[Session ${this.config.callSid}] AI response: "${response.text}" (decision: ${response.decision})`);

      // Speak the response
      await this.speak(response.text);

      // Check for final decision
      if (response.decision) {
        this.decision = response.decision;
        await this.handleDecision();
      }
    } catch (error) {
      console.error(`[Session ${this.config.callSid}] Error processing input:`, error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Speak text to the caller
   */
  private async speak(text: string): Promise<void> {
    if (!this.streamSid) {
      console.warn(`[Session ${this.config.callSid}] No stream SID, cannot speak`);
      return;
    }

    console.log(`[Session ${this.config.callSid}] 🔊 Speaking: "${text}"`);

    try {
      // Convert text to speech (returns base64 μ-law)
      const audioBase64 = await this.tts.synthesize(text);

      // Send audio to Twilio
      const message = {
        event: 'media',
        streamSid: this.streamSid,
        media: {
          payload: audioBase64,
        },
      };

      this.ws.send(JSON.stringify(message));

      // Send mark to know when audio finishes
      const markMessage = {
        event: 'mark',
        streamSid: this.streamSid,
        mark: {
          name: `speech_${Date.now()}`,
        },
      };
      this.ws.send(JSON.stringify(markMessage));
    } catch (error) {
      console.error(`[Session ${this.config.callSid}] TTS error:`, error);
    }
  }

  /**
   * Handle final decision
   */
  private async handleDecision(): Promise<void> {
    const transcript = this.gemini.getTranscript();

    if (this.decision === 'RECORD') {
      // Send email notification with transcript
      try {
        await sendVoiceAINotification({
          from: this.config.from,
          timestamp: new Date().toISOString(),
          transcript,
          decision: 'RECORD',
        });
        console.log(`[Session ${this.config.callSid}] Email notification sent`);
      } catch (error) {
        console.error(`[Session ${this.config.callSid}] Failed to send email:`, error);
      }
    } else {
      // BLOCK - just log
      console.log(`[Session ${this.config.callSid}] Blocked sales call from ${this.config.from}`);
    }

    // End the call after a short delay
    setTimeout(() => {
      this.endCall();
    }, 2000);
  }

  /**
   * Reset silence detection timer
   */
  private resetSilenceTimer(): void {
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
    }

    this.silenceTimeout = setTimeout(async () => {
      // If we haven't heard anything in a while, prompt
      if (!this.isProcessing && !this.decision) {
        await this.speak("I'm sorry, I didn't catch that. Could you please repeat?");
      }
    }, this.SILENCE_THRESHOLD_MS * 2);
  }

  /**
   * End the call
   */
  private endCall(): void {
    if (this.streamSid) {
      // Send clear message to stop any pending audio
      const clearMessage = {
        event: 'clear',
        streamSid: this.streamSid,
      };
      this.ws.send(JSON.stringify(clearMessage));
    }

    // Close WebSocket
    this.ws.close();
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
    }
    this.stt.stop();
    console.log(`[Session ${this.config.callSid}] Cleaned up`);
  }

  /**
   * Get session info
   */
  getInfo(): { callSid: string; from: string; decision: CallDecision | null } {
    return {
      callSid: this.config.callSid,
      from: this.config.from,
      decision: this.decision,
    };
  }
}

// Session store
const activeSessions = new Map<string, VoiceAISession>();

export function createSession(ws: WebSocket, config: SessionConfig): VoiceAISession {
  const session = new VoiceAISession(ws, config);
  activeSessions.set(config.callSid, session);
  return session;
}

export function getSession(callSid: string): VoiceAISession | undefined {
  return activeSessions.get(callSid);
}

export function removeSession(callSid: string): void {
  activeSessions.delete(callSid);
}
