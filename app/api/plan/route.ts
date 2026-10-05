import { NextResponse } from 'next/server';
import { planRequestSchema } from '@/lib/plan-contract';
import { buildItinerary } from '@/lib/planner';

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = planRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          'Enter a date, 2–12 hours, 1–12 travelers, a USD budget, and at least one interest.',
      },
      { status: 400 },
    );
  }

  const itinerary = buildItinerary(parsed.data);
  if (!itinerary) {
    return NextResponse.json(
      {
        error:
          'No published NYC stop fits this party size and planning budget. Increase the budget or reduce the party size.',
      },
      { status: 422 },
    );
  }

  return NextResponse.json({
    itinerary,
    catalogVersion: 'nyc-poi-v1',
  });
}
