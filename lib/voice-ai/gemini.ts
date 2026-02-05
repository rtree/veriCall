/**
 * Gemini AI for call screening
 * Determines if a call is sales/spam or legitimate
 * Uses the new unified @google/genai SDK with ADC
 */

import { GoogleGenAI } from '@google/genai';

export type CallDecision = 'BLOCK' | 'RECORD';

export interface GeminiResponse {
  text: string;
  decision: CallDecision | null;
  confidence: number;
}

const SYSTEM_PROMPT = `You are a friendly phone receptionist AI taking messages for legitimate callers.

IMPORTANT: You are continuing an ongoing phone call. The conversation history shows what has already been said. NEVER repeat greetings or phrases that appear in the history.

【BLOCK - Only obvious spam/cold sales】
- Cold calls offering services (SEO, marketing, insurance, cost reduction)
- Refuses to give name or company after being asked
- Generic "decision maker" requests with no specific purpose
- Pushy telemarketers

【RECORD - Take message (DEFAULT)】
- Anyone with a name and reason to call
- Business partners, vendors, clients
- Returning a call or following up
- Professional-sounding callers

【How to respond】
- Check the conversation history for what info you already have
- Ask for missing info (name, company, purpose) ONCE only
- If caller says "I already said" or seems frustrated, apologize and proceed with what you have
- After 2-3 exchanges, wrap up: "Got it, I'll pass along your message. Have a great day!" [RECORD]

CRITICAL RULES:
- NEVER ask for the same information twice - this is very annoying
- If info is missing after 2 attempts, proceed anyway with [RECORD]
- Always end with [RECORD] or [BLOCK]
- Keep responses to 1-2 sentences
- Be warm, natural, and efficient`;

export class GeminiChat {
  private conversationHistory: Array<{ role: string; content: string }> = [];
  private projectId: string;
  private location: string;

  constructor() {
    this.projectId = process.env.GCP_PROJECT_ID || 'ethglobal-479011';
    this.location = process.env.GCP_REGION || 'us-central1';
  }

  /**
   * Add initial greeting to conversation history
   * This prevents Gemini from repeating the greeting
   */
  addInitialGreeting(greeting: string): void {
    this.conversationHistory.push({
      role: 'assistant',
      content: greeting,
    });
  }

  /**
   * Get the system prompt (for hashing/verification)
   */
  static getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  /**
   * Send a message and get AI response
   * @param userMessage - What the caller said (transcribed)
   * @returns AI response with decision if final
   */
  async chat(userMessage: string): Promise<GeminiResponse> {
    // Add user message to history
    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    // Build the prompt
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...this.conversationHistory,
    ];

    // Debug: Log conversation history
    console.log(`[Gemini] Conversation history (${this.conversationHistory.length} messages):`);
    this.conversationHistory.forEach((msg, i) => {
      const preview = msg.content.substring(0, 50).replace(/\n/g, ' ');
      console.log(`[Gemini]   ${i + 1}. ${msg.role}: "${preview}..."`);
    });

    try {
      // Use Vertex AI Gemini
      const response = await this.callGemini(messages);

      // Parse decision from response
      const decision = this.parseDecision(response);

      // Add assistant response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: response,
      });

      return {
        text: this.cleanResponse(response),
        decision: decision.decision,
        confidence: decision.confidence,
      };
    } catch (error) {
      console.error('[Gemini] Error:', error);
      // Fallback response
      return {
        text: "I'm sorry, I'm having trouble understanding. Could you please repeat that?",
        decision: null,
        confidence: 0,
      };
    }
  }

  /**
   * Call Gemini API via new unified SDK with ADC
   */
  private async callGemini(
    messages: Array<{ role: string; content: string }>
  ): Promise<string> {
    // Use new @google/genai SDK with Vertex AI (ADC)
    const ai = new GoogleGenAI({
      vertexai: true,
      project: this.projectId,
      location: this.location,
    });

    // Convert messages to chat format
    const systemInstruction = messages.find(m => m.role === 'system')?.content || '';
    const chatMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      }));

    // Build contents with full history
    const contents = chatMessages.map(m => ({
      role: m.role as 'user' | 'model',
      parts: m.parts,
    }));

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction,
        maxOutputTokens: 512,  // Enough for complete responses
        temperature: 0.7,     // Slightly creative but consistent
      },
    });

    return response.text || '';
  }

  /**
   * Parse decision from AI response
   */
  private parseDecision(response: string): { decision: CallDecision | null; confidence: number } {
    const upperResponse = response.toUpperCase();

    // Explicit decision tags
    if (upperResponse.includes('[BLOCK]')) {
      return { decision: 'BLOCK', confidence: 0.9 };
    }
    if (upperResponse.includes('[RECORD]')) {
      return { decision: 'RECORD', confidence: 0.9 };
    }

    // Fallback: If response sounds like a positive ending, assume RECORD
    const positiveEndings = [
      'have a great day',
      'have a good day', 
      'have a nice day',
      'goodbye',
      'bye',
      'take care',
      "i'll pass along",
      "i'll make sure",
      "we'll get back to you",
    ];
    
    const lowerResponse = response.toLowerCase();
    const soundsLikeEnding = positiveEndings.some(phrase => lowerResponse.includes(phrase));
    
    if (soundsLikeEnding && this.conversationHistory.length >= 4) {
      console.log('[Gemini] Fallback: Detected positive ending without [RECORD], assuming RECORD');
      return { decision: 'RECORD', confidence: 0.7 };
    }

    // Auto-RECORD if conversation is too long (8+ messages = 4+ exchanges)
    if (this.conversationHistory.length >= 8) {
      console.log('[Gemini] Fallback: Conversation too long (8+ messages), auto-RECORD');
      return { decision: 'RECORD', confidence: 0.6 };
    }

    // No decision yet
    return { decision: null, confidence: 0 };
  }

  /**
   * Remove decision tags from response for TTS
   */
  private cleanResponse(response: string): string {
    return response
      .replace(/\[BLOCK\]/gi, '')
      .replace(/\[RECORD\]/gi, '')
      .trim();
  }

  /**
   * Get full conversation transcript
   */
  getTranscript(): string {
    return this.conversationHistory
      .map(m => `${m.role === 'user' ? 'Caller' : 'AI'}: ${m.content}`)
      .join('\n');
  }

  /**
   * Get a brief summary of the call (extracted from conversation)
   */
  getSummary(): string {
    // Extract key info from conversation
    const callerMessages = this.conversationHistory
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join(' ');
    
    // Try to find name, company, and purpose from the conversation
    let summary = '';
    
    // Look for the last AI message that contains the confirmation
    const lastAiMessages = this.conversationHistory
      .filter(m => m.role === 'assistant')
      .slice(-2);
    
    for (const msg of lastAiMessages) {
      if (msg.content.toLowerCase().includes('got it') || 
          msg.content.toLowerCase().includes("i'll pass along")) {
        // This is likely the summary message
        summary = msg.content.replace(/\[RECORD\]/gi, '').replace(/\[BLOCK\]/gi, '').trim();
        break;
      }
    }
    
    if (!summary) {
      // Fallback: create a simple summary
      const words = callerMessages.split(/\s+/).slice(0, 30).join(' ');
      summary = `Call regarding: ${words}...`;
    }
    
    return summary;
  }

  /**
   * Reset conversation
   */
  reset(): void {
    this.conversationHistory = [];
  }
}
