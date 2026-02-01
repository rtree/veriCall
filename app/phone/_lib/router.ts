import { forwardingConfig } from '@/lib/config';
import { CallRecord, Decision } from './types';

/**
 * Call Router
 * 着信を誰に転送するか判断するロジック
 */

/** 着信を評価して判断を返す */
export function decide(call: CallRecord): Decision {
  const { from } = call;
  const { whitelist, defaultDestination } = forwardingConfig;

  // ホワイトリストが空 → 全員転送
  if (whitelist.length === 0) {
    return {
      action: 'forward',
      reason: 'No whitelist configured - forwarding all calls',
      forwardTo: defaultDestination,
      confidence: 1.0,
    };
  }

  // ホワイトリストチェック
  const isWhitelisted = whitelist.some(pattern => {
    if (pattern.endsWith('*')) {
      return from.startsWith(pattern.slice(0, -1));
    }
    return from === pattern;
  });

  if (isWhitelisted) {
    return {
      action: 'forward',
      reason: `Caller ${maskPhone(from)} is in whitelist`,
      forwardTo: defaultDestination,
      confidence: 1.0,
    };
  }

  // 未登録番号 → 一旦転送（将来はAI判断）
  return {
    action: 'forward',
    reason: `Unknown caller ${maskPhone(from)} - forwarding for screening`,
    forwardTo: defaultDestination,
    confidence: 0.5,
  };
}

/** 電話番号をマスク */
function maskPhone(phone: string): string {
  if (phone.length < 8) return '***';
  return phone.slice(0, 4) + '****' + phone.slice(-2);
}
