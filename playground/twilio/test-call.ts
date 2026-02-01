/**
 * Twilio Test Call
 * 
 * 発信テスト用スクリプト
 * 
 * 実行: npx ts-node playground/twilio/test-call.ts
 */

import 'dotenv/config';
import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;
const toNumber = process.env.TEST_TO_NUMBER || process.env.DESTINATION_PHONE_NUMBER;

async function main() {
  console.log('🧪 Twilio Test Call\n');

  if (!accountSid || !authToken || !fromNumber) {
    console.log('⚠️ Missing Twilio credentials in .env');
    console.log('   Required: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER');
    return;
  }

  if (!toNumber) {
    console.log('⚠️ Missing destination number');
    console.log('   Set TEST_TO_NUMBER or DESTINATION_PHONE_NUMBER in .env');
    return;
  }

  console.log('From:', fromNumber);
  console.log('To:', toNumber);
  console.log();

  const client = twilio(accountSid, authToken);

  try {
    // TwiML Binを使うか、公開URLが必要
    // テスト用にTwilioのサンプルTwiMLを使用
    const call = await client.calls.create({
      to: toNumber,
      from: fromNumber,
      twiml: '<Response><Say voice="Polly.Amy">Hello! This is a test call from VeriCall.</Say></Response>',
    });

    console.log('✅ Call initiated!');
    console.log('   SID:', call.sid);
    console.log('   Status:', call.status);
  } catch (error) {
    console.log('❌ Failed:', error);
  }
}

main().catch(console.error);
