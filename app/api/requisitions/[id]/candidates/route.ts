import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Candidate creation is now exclusively owned by durable resume operations.
// Keeping this explicit response avoids a second synchronous evaluation path.
export async function POST() {
  return NextResponse.json({
    error: 'Use the durable resume operation upload workflow.'
  }, { status: 410 });
}
