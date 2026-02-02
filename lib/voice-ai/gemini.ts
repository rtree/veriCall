/**
 * Gemini AI for call screening
 * Determines if a call is sales/spam or legitimate
 */

import { VertexAI } from '@google-cloud/aiplatform';

export type CallDecision = 'BLOCK' | 'RECORD';

export interface GeminiResponse {
  text: string;
  decision: CallDecision | null;
  confidence: number;
}

const SYSTEM_PROMPT = `You are a phone receptionist AI. Your job is to screen calls and determine if they are sales/spam calls.

【Sales Call Indicators - BLOCK】
- Service proposals, offers, deals
- No specific purpose for calling
- Asking for "the person in charge" or "decision maker"
- Real estate, insurance, telecom, cost reduction
- Marketing, advertising, SEO services
- Unsolicited business proposals

【Legitimate Call Indicators - RECORD】
- Has a specific purpose
- Knows who they want to reach by name
- Business partner, customer, personal contact
- Inquiry, appointment, returning a call
- Delivery, service appointment

【Response Patterns】
1. First response: "Hello, this is an automated assistant. May I ask who's calling and the purpose of your call?"
2. If sales call detected: "I'm sorry, we don't accept sales calls. Thank you for your understanding. Goodbye." [BLOCK]
3. If legitimate: "Thank you. Could you please tell me your message? I'll make sure it gets delivered." (then record) → "Thank you. We will get back to you shortly. Goodbye." [RECORD]
4. If unclear: Ask ONE clarifying question, then decide.

IMPORTANT:
- Keep responses to 1-2 sentences
- Be polite but efficient
- When you make a final decision, end your response with [BLOCK] or [RECORD]
- Only use [BLOCK] or [RECORD] when ending the conversation`;

export class GeminiChat {
  private conversationHistory: Array<{ role: string; content: string }> = [];
  private projectId: string;
  private location: string;

  constructor() {
    this.projectId = process.env.GCP_PROJECT_ID || 'ethglobal-479011';
    this.location = process.env.GCP_REGION || 'us-central1';
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
   * Call Gemini API via Vertex AI
   */
  private async callGemini(
    messages: Array<{ role: string; content: string }>
  ): Promise<string> {
    // Use Google's Generative AI client directly for simplicity
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_AI_API_KEY is not set');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    // Convert messages to Gemini format
    const systemInstruction = messages.find(m => m.role === 'system')?.content || '';
    const chatMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      }));

    const chat = model.startChat({
      history: chatMessages.slice(0, -1) as any,
      systemInstruction,
    });

    const lastMessage = chatMessages[chatMessages.length - 1];
    const result = await chat.sendMessage(lastMessage.parts[0].text);
    return result.response.text();
  }

  /**
   * Parse decision from AI response
   */
  private parseDecision(response: string): { decision: CallDecision | null; confidence: number } {
    const upperResponse = response.toUpperCase();

    if (upperResponse.includes('[BLOCK]')) {
      return { decision: 'BLOCK', confidence: 0.9 };
    }
    if (upperResponse.includes('[RECORD]')) {
      return { decision: 'RECORD', confidence: 0.9 };
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
   * Reset conversation
   */
  reset(): void {
    this.conversationHistory = [];
  }
}
