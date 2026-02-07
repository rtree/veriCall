/**
 * Wallet Helper
 * 
 * シードフレーズ or 秘密鍵からアカウントを導出
 * 
 * .env.local に以下のいずれかを設定:
 *   DEPLOYER_MNEMONIC="word1 word2 ... word12"   ← シードフレーズ（優先）
 *   DEPLOYER_PRIVATE_KEY=0x...                     ← 秘密鍵（フォールバック）
 */

import { mnemonicToAccount, privateKeyToAccount, HDAccount } from 'viem/accounts';
import type { Account } from 'viem';

export function getDeployerAccount(): Account {
  const mnemonic = process.env.DEPLOYER_MNEMONIC;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

  if (mnemonic) {
    // シードフレーズ → HD Wallet → m/44'/60'/0'/0/0 (デフォルト)
    const account = mnemonicToAccount(mnemonic);
    console.log('🔑 Wallet: from mnemonic (HD path: m/44\'/60\'/0\'/0/0)');
    console.log('   Address:', account.address);
    return account;
  }

  if (privateKey) {
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    console.log('🔑 Wallet: from private key');
    console.log('   Address:', account.address);
    return account;
  }

  throw new Error(
    '❌ No wallet configured!\n' +
    '   Set DEPLOYER_MNEMONIC or DEPLOYER_PRIVATE_KEY in .env.local\n' +
    '   Example: DEPLOYER_MNEMONIC="word1 word2 ... word12"'
  );
}
