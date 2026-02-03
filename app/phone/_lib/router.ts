import { CallRecord, Decision } from './types';

/**
 * Call Router
 * 着信を誰に転送するか判断するロジック
 * MVP: ホワイトリスト以外は全てAIスクリーニング
 */

/** 
 * ホワイトリストを毎回読み直す（Cloud Runでシークレット更新を即反映するため）
 */
function getWhitelist(): string[] {
  return (process.env.WHITELIST_NUMBERS || '').split(',').filter(Boolean);
}

function getDefaultDestination(): string {
  return process.env.DESTINATION_PHONE_NUMBER || '';
}

/** 着信を評価して判断を返す */
export function decide(call: CallRecord): Decision {
  const { from } = call;
  const whitelist = getWhitelist();
  const defaultDestination = getDefaultDestination();

  // ホワイトリストチェック
  const isWhitelisted = whitelist.length > 0 && whitelist.some(pattern => {
    if (pattern.endsWith('*')) {
      return from.startsWith(pattern.slice(0, -1));
    }
    return from === pattern;
  });

  if (isWhitelisted) {
    // ホワイトリスト登録済み → 即転送
    return {
      action: 'forward',
      reason: `Caller ${maskPhone(from)} is in whitelist`,
      forwardTo: defaultDestination,
      confidence: 1.0,
    };
  }

  // 未登録番号 → AIスクリーニング
  return {
    action: 'ai_screen',
    reason: `Unknown caller ${maskPhone(from)} - routing to AI screening`,
    confidence: 1.0,
  };
}

/** 電話番号をマスク */
function maskPhone(phone: string): string {
  if (phone.length < 8) return '***';
  return phone.slice(0, 4) + '****' + phone.slice(-2);
}
