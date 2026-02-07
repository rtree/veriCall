/**
 * 04 - Deploy VeriCallRegistry to Base Sepolia
 * 
 * Base Sepolia にコントラクトをデプロイ
 * 
 * 前提:
 *   - .env.local に DEPLOYER_PRIVATE_KEY を設定済み
 *   - Base Sepolia ETH を保有 (faucet: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet)
 * 
 * 実行: npx tsx playground/vlayer/04-deploy-registry.ts
 */

import 'dotenv/config';
import { createWalletClient, createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { getDeployerAccount } from './wallet';

// ─── Config ─────────────────────────────────────────────────

const RPC_URL = process.env.ETHEREUM_RPC_URL || 'https://sepolia.base.org';
const GUEST_ID = '0x6e251f4d993427d02a4199e1201f3b54462365d7c672a51be57f776d509b47eb'; // from vlayer

// ─── Load Compiled Contract ──────────────────────────────────

function loadContract() {
  const artifactPath = resolve(__dirname, '../../contracts/out/VeriCallRegistry.sol/VeriCallRegistry.json');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as `0x${string}`,
  };
}

// ─── Deploy ──────────────────────────────────────────────────

async function main() {
  console.log('🚀 Deploy VeriCallRegistry to Base Sepolia\n');
  console.log('='.repeat(50));

  // Setup account (mnemonic or private key)
  const account = getDeployerAccount();
  console.log('\n📋 Deploy Config:');
  console.log('   Network: Base Sepolia (chainId: 84532)');
  console.log('   RPC:', RPC_URL);
  console.log('   Deployer:', account.address);
  console.log('   Guest ID:', GUEST_ID.slice(0, 18) + '...');

  // Setup clients
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  const ethBalance = Number(balance) / 1e18;
  console.log('   Balance:', ethBalance.toFixed(6), 'ETH');
  
  if (balance === 0n) {
    console.log('\n❌ No ETH balance. Get testnet ETH from:');
    console.log('   https://www.coinbase.com/faucets/base-ethereum-goerli-faucet');
    console.log('   https://www.alchemy.com/faucets/base-sepolia');
    return;
  }

  // Load contract
  console.log('\n📦 Loading compiled contract...');
  const { abi, bytecode } = loadContract();
  console.log('   ABI entries:', abi.length);
  console.log('   Bytecode size:', Math.round(bytecode.length / 2), 'bytes');

  // Deploy
  console.log('\n🔨 Deploying...');
  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [GUEST_ID as `0x${string}`],
  });

  console.log('   TX hash:', hash);
  console.log('   Waiting for confirmation...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  if (!receipt.contractAddress) {
    console.log('❌ Deploy failed! No contract address in receipt.');
    return;
  }

  console.log('\n✅ Deployed!');
  console.log('   Contract:', receipt.contractAddress);
  console.log('   Block:', receipt.blockNumber);
  console.log('   Gas used:', receipt.gasUsed.toString());
  console.log('   Explorer: https://sepolia.basescan.org/address/' + receipt.contractAddress);

  // Save deployment info
  const deployment = {
    network: 'base-sepolia',
    chainId: 84532,
    contractAddress: receipt.contractAddress,
    deployer: account.address,
    txHash: hash,
    blockNumber: Number(receipt.blockNumber),
    guestId: GUEST_ID,
    deployedAt: new Date().toISOString(),
  };

  const deploymentPath = resolve(__dirname, '../../contracts/deployment.json');
  writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log('\n💾 Saved deployment info to contracts/deployment.json');
  
  console.log('\n' + '='.repeat(50));
  console.log('🎉 VeriCallRegistry is live on Base Sepolia!');
  console.log('\nNext: Run 05-end-to-end.ts to submit a proof on-chain');
}

main().catch(console.error);
