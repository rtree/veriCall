/**
 * Email notification for Voice AI
 */

import sgMail from '@sendgrid/mail';

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@vericall.app';

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

export interface VoiceAINotification {
  from: string;
  timestamp: string;
  transcript: string;
  summary?: string;  // Brief summary of the call
  decision: 'RECORD' | 'BLOCK';
}

export async function sendVoiceAINotification(notification: VoiceAINotification): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    console.log('⚠️ SENDGRID_API_KEY not set, skipping email notification');
    return false;
  }

  if (!NOTIFICATION_EMAIL) {
    console.log('⚠️ NOTIFICATION_EMAIL not set, skipping email notification');
    return false;
  }

  const isScam = notification.decision === 'BLOCK';
  const emoji = isScam ? '🚨' : '📞';
  const title = isScam ? 'Scam Alert' : 'New Call Message';
  const subject = `${emoji} VeriCall: ${title} from ${notification.from}`;
  
  // Colors based on decision
  const headerColor = isScam ? '#d32f2f' : '#333';
  const summaryBg = isScam ? '#ffebee' : '#e3f2fd';
  const summaryBorder = isScam ? '#f44336' : '#2196F3';
  const summaryLabel = isScam ? '#c62828' : '#1976D2';
  const decisionBg = isScam ? '#f44336' : '#4CAF50';
  const decisionText = isScam ? 'SCAM' : 'OK';

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: ${headerColor};">${emoji} ${title}</h2>
      
      ${notification.summary ? `
      <div style="background: ${summaryBg}; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid ${summaryBorder};">
        <strong style="color: ${summaryLabel};">📋 Summary:</strong><br/>
        <span style="color: #333;">${notification.summary}</span>
      </div>
      ` : ''}
      
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">From</td>
          <td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold;">${notification.from}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">Time</td>
          <td style="padding: 10px; border-bottom: 1px solid #eee;">${new Date(notification.timestamp).toLocaleString()}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">Decision</td>
          <td style="padding: 10px; border-bottom: 1px solid #eee;">
            <span style="background: ${decisionBg}; color: white; padding: 4px 8px; border-radius: 4px;">
              ${decisionText}
            </span>
          </td>
        </tr>
      </table>
      
      <h3 style="color: #333;">📝 Conversation Transcript</h3>
      <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; white-space: pre-wrap; font-family: monospace; font-size: 12px;">
${notification.transcript}
      </div>
      
      <p style="color: #999; font-size: 12px; margin-top: 30px;">
        This notification was sent by VeriCall AI Receptionist.
      </p>
    </div>
  `;

  const text = `
${title}
================
${notification.summary ? `Summary: ${notification.summary}\n` : ''}
From: ${notification.from}
Time: ${new Date(notification.timestamp).toLocaleString()}
Decision: ${decisionText}

Transcript:
${notification.transcript}
  `;

  try {
    await sgMail.send({
      to: NOTIFICATION_EMAIL,
      from: FROM_EMAIL,
      subject,
      text,
      html,
    });
    console.log(`✅ Voice AI notification sent to ${NOTIFICATION_EMAIL}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send Voice AI notification:', error);
    return false;
  }
}
