/**
 * Email notification service using SendGrid
 */

import sgMail from '@sendgrid/mail';

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@vericall.app';

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

export interface CallNotification {
  callId: string;
  from: string;
  to: string;
  action: 'forward' | 'reject' | 'voicemail';
  reason: string;
  timestamp: Date;
}

export async function sendCallNotification(notification: CallNotification): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    console.log('⚠️ SENDGRID_API_KEY not set, skipping email notification');
    return false;
  }

  if (!NOTIFICATION_EMAIL) {
    console.log('⚠️ NOTIFICATION_EMAIL not set, skipping email notification');
    return false;
  }

  const actionEmoji = {
    forward: '📞',
    reject: '🚫',
    voicemail: '📝',
  }[notification.action];

  const actionText = {
    forward: '転送しました',
    reject: '拒否しました',
    voicemail: 'ボイスメールに転送しました',
  }[notification.action];

  const subject = `${actionEmoji} VeriCall: ${notification.from} からの着信を${actionText}`;

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">${actionEmoji} 着信通知</h2>
      
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">発信元</td>
          <td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold;">${notification.from}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">着信先</td>
          <td style="padding: 10px; border-bottom: 1px solid #eee;">${notification.to}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">判断</td>
          <td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold;">${actionText}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">理由</td>
          <td style="padding: 10px; border-bottom: 1px solid #eee;">${notification.reason}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">時刻</td>
          <td style="padding: 10px; border-bottom: 1px solid #eee;">${notification.timestamp.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</td>
        </tr>
        <tr>
          <td style="padding: 10px; color: #666;">Call ID</td>
          <td style="padding: 10px; font-family: monospace; font-size: 12px;">${notification.callId}</td>
        </tr>
      </table>
      
      <p style="color: #999; font-size: 12px;">
        Powered by VeriCall
      </p>
    </div>
  `;

  const text = `
VeriCall 着信通知

発信元: ${notification.from}
着信先: ${notification.to}
判断: ${actionText}
理由: ${notification.reason}
時刻: ${notification.timestamp.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
Call ID: ${notification.callId}
  `.trim();

  try {
    await sgMail.send({
      to: NOTIFICATION_EMAIL,
      from: FROM_EMAIL,
      subject,
      text,
      html,
    });
    console.log(`📧 Email sent to ${NOTIFICATION_EMAIL}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send email:', error);
    return false;
  }
}
