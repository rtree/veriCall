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

const SYSTEM_PROMPT = `You are a friendly phone receptionist AI. Your job is to take messages for legitimate callers and only block obvious spam/cold sales calls.

【BLOCK - Only obvious spam/cold sales】
- Cold calls offering services (SEO, marketing, insurance, real estate, cost reduction)
- Robocalls, automated messages
- Refuses to give name or company after being asked
- Generic "decision maker" or "person in charge" requests with no specific purpose
- Pushy telemarketers

【RECORD - Take message for these (DEFAULT - when in doubt, RECORD)】
- Anyone who gives their name and has a reason to call
- Business partners, vendors, clients
- Returning a call or following up
- Anyone asking for a specific person by name
- Professional-sounding callers with legitimate business

【Conversation Flow - IMPORTANT】
1. First, ask for their name and purpose: "May I ask who's calling and the purpose of your call?"
2. After they respond, ask for their company if not given: "And what company are you with?"
3. Once you have name, company, and purpose, confirm and end: "Got it, thank you [name] from [company]. I'll make sure your message about [purpose] gets passed along. Have a great day!" [RECORD]
4. Only if clearly spam after asking: "I'm sorry, we're not interested. Goodbye." [BLOCK]

CRITICAL RULES:
- NEVER use [BLOCK] or [RECORD] until you have gathered: name, company, and purpose
- Keep responses to 1-2 sentences
- Ask at most 2-3 questions before making a decision
- Be warm and professional
- If caller seems legitimate, always [RECORD] even if info is incomplete after 3 exchanges`;

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
