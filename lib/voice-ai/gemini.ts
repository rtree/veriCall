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

const SYSTEM_PROMPT = `You are a phone receptionist AI. Your job is to determine the INTENT of the caller.

IMPORTANT: You are continuing an ongoing phone call. NEVER repeat greetings.

=== HANDLING INCOMPLETE SPEECH ===

Phone audio sometimes cuts off or arrives in fragments. When you receive:
- Incomplete sentences like "My name is." or "I'm calling about"
- Very short responses like "Hello" or "Yes"
- Fragments that don't make sense

Respond with: "I'm sorry, the connection seems choppy. Could you please repeat that?" (do NOT add any tag)

Wait for the caller to repeat before making any decision.

=== INTENT-BASED SCREENING ===

Ask yourself: "What does this caller WANT?"

[BLOCK] - They want to SELL or PROPOSE something to us:
SELLING INTENT signals:
- "I have a proposal/offer for you"
- "I can help you save money/increase sales"
- "I'd like to tell you about..."
- "We have an opportunity..."
- "I'm calling about your [listing/account/business]"

UNSOLICITED CONTACT signals:
- "I'm calling from your postcard/mailer/ad" (we sent mass mail = scam)
- "I found you on a list"
- "Your information came across my desk"
- No prior relationship, just cold calling

EVASIVE BEHAVIOR:
- Cannot name a specific project or existing relationship
- Vague answers after 3+ questions about purpose
- Gets frustrated when asked for details

[RECORD] - They want to GET something from us or have existing relationship:
SEEKING/CONFIRMING signals:
- "I'm returning a call / you called me / someone called me"
- "I was referred by [specific person]"
- "About the [specific project/order/invoice] we discussed"
- "I need to confirm/check/ask about..."
- "Is [specific person] available?"

SENT SOMETHING signals (they already took action):
- "I sent a quote/estimate/proposal"
- "I sent an invoice/bill"
- "I sent documents/files/email"
- "I mailed/shipped something"
- "Please notify/tell [person] that..."

EXISTING RELATIONSHIP signals:
- Mentions specific past interactions
- Knows specific details only a real contact would know
- Has a concrete, verifiable reason for calling

=== DECISION LOGIC ===

1. First message: Ask "May I ask what this is regarding?"
2. Listen for INTENT signals
3. If caller's response is incomplete/fragmented → Ask to repeat (no tag)
4. If SELLING/PROPOSING → "We're not interested at this time. Goodbye." [BLOCK]
5. If SEEKING/EXISTING → Get name, take message → "I'll pass that along." [RECORD]
6. If UNCLEAR after 3 exchanges → Default to [BLOCK]

=== RULES ===
- A name alone does NOT make someone legitimate
- "Postcard" or "mailer" = instant [BLOCK] (unsolicited mass contact)
- Investment/stock/crypto = instant [BLOCK]
- Be patient with connection issues - ask to repeat if unclear
- When in doubt after 3+ exchanges, BLOCK
- Always include a polite message with your tag
- Keep responses to 1-2 sentences
- ALWAYS say "Goodbye" at the end of the conversation (both BLOCK and RECORD)
- If caller says "Thank you", respond with "You're welcome. Goodbye." + tag`;

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
      const { decision, confidence, cleanedText } = this.parseDecision(response);

      // Add assistant response to history (use original for context)
      this.conversationHistory.push({
        role: 'assistant',
        content: response,
      });

      return {
        text: cleanedText || this.cleanResponse(response),
        decision,
        confidence,
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
  private parseDecision(response: string): { decision: CallDecision | null; confidence: number; cleanedText: string } {
    const upperResponse = response.toUpperCase();
    let cleanedText = response;

    // Explicit decision tags (both half-width and full-width brackets)
    const isBlock = upperResponse.includes('[BLOCK]') || upperResponse.includes('【BLOCK】') || upperResponse.includes('【BLOCK');
    const isRecord = upperResponse.includes('[RECORD]') || upperResponse.includes('【RECORD】') || upperResponse.includes('【RECORD');

    // Remove tags from response text
    cleanedText = response
      .replace(/\[BLOCK\]/gi, '')
      .replace(/\[RECORD\]/gi, '')
      .replace(/【BLOCK】/gi, '')
      .replace(/【RECORD】/gi, '')
      .replace(/【BLOCK/gi, '')
      .replace(/【RECORD/gi, '')
      .trim();

    if (isBlock) {
      // If response is just the tag with no text, provide a default message
      if (!cleanedText || cleanedText.length < 10) {
        cleanedText = "Thank you for calling, but we're not interested at this time. Goodbye.";
        console.log('[Gemini] Added fallback message for BLOCK');
      }
      return { decision: 'BLOCK', confidence: 0.9, cleanedText };
    }
    if (isRecord) {
      if (!cleanedText || cleanedText.length < 10) {
        cleanedText = "Got it, I'll pass along your message. Have a great day!";
        console.log('[Gemini] Added fallback message for RECORD');
      }
      return { decision: 'RECORD', confidence: 0.9, cleanedText };
    }

    // Fallback: Check for BLOCK phrases first (takes priority)
    const blockPhrases = [
      'not interested',
      "we're not interested",
      'no thank you',
      'we cannot help',
      "we can't help",
      'not accepting',
      'not taking',
    ];
    
    const lowerResponse = response.toLowerCase();
    const soundsLikeBlock = blockPhrases.some(phrase => lowerResponse.includes(phrase));
    
    if (soundsLikeBlock && this.conversationHistory.length >= 2) {
      console.log('[Gemini] Fallback: Detected BLOCK phrase without [BLOCK] tag, assuming BLOCK');
      return { decision: 'BLOCK', confidence: 0.7, cleanedText };
    }

    // Fallback: Check for RECORD phrases (goodbye/bye removed - they're ambiguous)
    // These phrases indicate AI is taking a message → should RECORD
    const recordPhrases = [
      "i'll pass along",
      "i'll pass that",
      "i'll make sure",
      "i'll let them know",
      "i'll let him know",
      "i'll let her know",
      "i'll relay",
      'got it,',  // "Got it," followed by more text
      'message has been',
      'noted your',
      "we'll get back to you",
    ];
    
    const soundsLikeRecord = recordPhrases.some(phrase => lowerResponse.includes(phrase));
    
    // Lower threshold to 2 messages - if AI says "I'll pass along", we should RECORD
    if (soundsLikeRecord && this.conversationHistory.length >= 2) {
      console.log('[Gemini] Fallback: Detected RECORD phrase without [RECORD] tag, assuming RECORD');
      return { decision: 'RECORD', confidence: 0.7, cleanedText };
    }

    // Fallback: Polite endings that signal conversation is complete
    // "You're welcome" alone (after some conversation) = conversation is done
    const hasGoodbye = lowerResponse.includes('goodbye') || lowerResponse.includes('bye');
    const isPoliteEnding = lowerResponse.includes("you're welcome") || 
                           lowerResponse.includes('have a great day') ||
                           lowerResponse.includes('have a good day') ||
                           lowerResponse.includes('take care');
    
    // If AI says "Goodbye" with polite ending = RECORD
    if (hasGoodbye && isPoliteEnding && this.conversationHistory.length >= 4) {
      console.log('[Gemini] Fallback: Polite goodbye after conversation, assuming RECORD');
      return { decision: 'RECORD', confidence: 0.7, cleanedText };
    }
    
    // If AI says just "You're welcome." (short response after Thank you) = RECORD
    // This catches cases where AI doesn't add "Goodbye"
    if (isPoliteEnding && cleanedText.length < 30 && this.conversationHistory.length >= 4) {
      console.log('[Gemini] Fallback: Short polite ending, assuming RECORD');
      return { decision: 'RECORD', confidence: 0.7, cleanedText };
    }

    // Auto-RECORD if conversation is too long (8+ messages = 4+ exchanges)
    if (this.conversationHistory.length >= 8) {
      console.log('[Gemini] Fallback: Conversation too long (8+ messages), auto-RECORD');
      return { decision: 'RECORD', confidence: 0.6, cleanedText };
    }

    // No decision yet
    return { decision: null, confidence: 0, cleanedText };
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
