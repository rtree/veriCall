import { NextResponse } from 'next/server';
import { getAllRecords } from '@/lib/witness/pipeline';

/**
 * GET /witness/list
 * 全証明記録を取得
 */
export async function GET() {
  const records = getAllRecords();
  
  return NextResponse.json({
    total: records.length,
    records,
  });
}
