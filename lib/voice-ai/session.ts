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
  private isSpeaking = false;  // True while AI is speaking
  private pendingTranscripts: string[] = [];  // Queue for transcripts while processing

  // Twilio timestamp tracking (for proper barge-in handling)
  private latestMediaTimestamp = 0;  // Latest media.timestamp from Twilio
  private responseStartTimestamp: number | null = null;  // When AI response started
  private markQueue: string[] = [];  // Track pending marks (max 10)
  private readonly MAX_MARK_QUEUE = 10;

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
    // Note: STT stream will start automatically when first audio arrives
    console.log(`[Session ${this.config.callSid}] Session initialized, STT will start on first audio`);
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
          // Audio playback marker - AI finished speaking
          const markName = message.mark?.name || 'unknown';
          console.log(`[Session ${this.config.callSid}] [MARK] Received: ${markName}, queue=${this.markQueue.length}`);
          
          // Remove from queue
          if (this.markQueue.length > 0) {
            this.markQueue.shift();
          }
          
          // If no more marks pending, AI finished speaking
          if (this.markQueue.length === 0) {
            this.isSpeaking = false;
            this.responseStartTimestamp = null;
            console.log(`[Session ${this.config.callSid}] [MARK] AI finished speaking`);
          }
          
          // Process any pending transcripts
          await this.processPendingTranscripts();
          break;
      }
    } catch (error) {
      console.error(`[Session ${this.config.callSid}] Error handling message:`, error);
    }
  }

  // Filler words that shouldn't interrupt AI speech
  private static readonly FILLERS = new Set([
    'yeah', 'yes', 'yep', 'okay', 'ok', 'uh', 'um', 'uh-huh', 
    'right', 'sure', 'mhm', 'hmm', 'ah', 'oh', 'i see'
  ]);

  /**
   * Check if transcript is just a filler/acknowledgment
   */
  private isFiller(transcript: string): boolean {
    const normalized = transcript.toLowerCase().trim().replace(/[.,!?]/g, '');
    return VoiceAISession.FILLERS.has(normalized);
  }

  /**
   * Send initial greeting
   */
  private async sendGreeting(): Promise<void> {
    if (this.hasGreeted) return;
    this.hasGreeted = true;

    const greeting = "Hello, this is an automated assistant. May I ask who's calling and the purpose of your call?";
    console.log(`[Session ${this.config.callSid}] 🎤 Greeting: "${greeting}"`);
    
    // Add to Gemini history so it doesn't repeat
    this.gemini.addInitialGreeting(greeting);
    
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

    // Track Twilio's timestamp for barge-in handling
    this.latestMediaTimestamp = parseInt(media.timestamp || '0', 10);

    // Debug: log first few audio chunks
    if (this.audioChunkCount < 5) {
      console.log(`[Session ${this.config.callSid}] Audio chunk ${this.audioChunkCount + 1}: ${mulawBuffer.length} bytes, ts=${this.latestMediaTimestamp}`);
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
        
        // Check if it's just a filler word
        if (this.isFiller(transcript)) {
          console.log(`[Session ${this.config.callSid}] Ignoring filler: "${transcript}"`);
          return;
        }
        
        // If AI is speaking, this is a barge-in (interrupt)
        if (this.isSpeaking) {
          const elapsedTime = this.responseStartTimestamp 
            ? this.latestMediaTimestamp - this.responseStartTimestamp 
            : 0;
          console.log(`[Session ${this.config.callSid}] [BARGE-IN] Detected: "${transcript}", elapsed=${elapsedTime}ms, marks=${this.markQueue.length}`);
          
          // Clear Twilio's audio buffer to stop current playback
          if (this.markQueue.length > 0) {
            this.sendClear();
          }
          
          // Reset state
          this.pendingTranscripts = [];
          this.markQueue = [];
          this.responseStartTimestamp = null;
          this.isSpeaking = false;
        }
        
        // If already processing, queue it
        if (this.isProcessing) {
          console.log(`[Session ${this.config.callSid}] Queuing transcript (processing in progress)`);
          this.pendingTranscripts.push(transcript);
        } else {
          await this.processCallerInput(transcript);
        }
      }
    });
  }

  /**
   * Process any pending transcripts after AI finishes speaking
   */
  private async processPendingTranscripts(): Promise<void> {
    if (this.pendingTranscripts.length === 0) return;
    if (this.isProcessing) return;
    
    // Combine all pending transcripts into one
    const combined = this.pendingTranscripts.join(' ').trim();
    this.pendingTranscripts = [];
    
    if (combined) {
      console.log(`[Session ${this.config.callSid}] Processing queued transcripts: "${combined}"`);
      await this.processCallerInput(combined);
    }
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
    this.isSpeaking = true;  // Set speaking flag

    try {
      // Convert text to speech (returns base64 μ-law)
      const audioBase64 = await this.tts.synthesize(text);

      // Record when we start sending this response
      if (this.responseStartTimestamp === null) {
        this.responseStartTimestamp = this.latestMediaTimestamp;
        console.log(`[Session ${this.config.callSid}] [TIMESTAMP] Response start: ${this.responseStartTimestamp}`);
      }

      // Send audio to Twilio (with readyState check)
      const message = {
        event: 'media',
        streamSid: this.streamSid,
        media: {
          payload: audioBase64,
        },
      };

      if (!this.safeSend(message)) {
        console.warn(`[Session ${this.config.callSid}] Failed to send audio - WebSocket not open`);
        return;
      }

      // Send mark to know when audio finishes
      const markName = `speech_${Date.now()}`;
      const markMessage = {
        event: 'mark',
        streamSid: this.streamSid,
        mark: {
          name: markName,
        },
      };
      
      if (this.safeSend(markMessage)) {
        // Track the mark (limit queue size)
        if (this.markQueue.length < this.MAX_MARK_QUEUE) {
          this.markQueue.push(markName);
        }
        console.log(`[Session ${this.config.callSid}] [MARK] Sent: ${markName}, queue=${this.markQueue.length}`);
      }
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
   * Safely send a message to WebSocket (with readyState check)
   * @returns true if sent successfully, false otherwise
   */
  private safeSend(message: object): boolean {
    if (this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[Session ${this.config.callSid}] WebSocket not open (state=${this.ws.readyState}), cannot send`);
      return false;
    }
    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error(`[Session ${this.config.callSid}] Failed to send message:`, error);
      return false;
    }
  }

  /**
   * Send clear message to stop audio playback (for barge-in)
   */
  private sendClear(): void {
    if (!this.streamSid) return;
    
    const clearMessage = {
      event: 'clear',
      streamSid: this.streamSid,
    };
    
    if (this.safeSend(clearMessage)) {
      console.log(`[Session ${this.config.callSid}] [CLEAR] Sent - stopping audio playback`);
    }
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
    this.sendClear();
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
  console.log(`[SessionStore] Creating session: ${config.callSid}, active count: ${activeSessions.size}`);
  const session = new VoiceAISession(ws, config);
  activeSessions.set(config.callSid, session);
  console.log(`[SessionStore] Session created: ${config.callSid}, active count: ${activeSessions.size}`);
  return session;
}

export function getSession(callSid: string): VoiceAISession | undefined {
  const session = activeSessions.get(callSid);
  if (!session) {
    console.log(`[SessionStore] Session not found: ${callSid}, active: [${Array.from(activeSessions.keys()).join(', ')}]`);
  }
  return session;
}

export function removeSession(callSid: string): void {
  console.log(`[SessionStore] Removing session: ${callSid}`);
  activeSessions.delete(callSid);
  console.log(`[SessionStore] Session removed, active count: ${activeSessions.size}`);
}
