import { GoogleGenAI } from '@google/genai';

async function test() {
  const ai = new GoogleGenAI({
    vertexai: true,
    project: 'ethglobal-479011',
    location: 'us-central1',
  });

  console.log('Testing Gemini with ADC...');
  
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: 'Say "Hello from VeriCall!" in one sentence.',
  });

  console.log('Response:', response.text);
}

test().catch(console.error);
