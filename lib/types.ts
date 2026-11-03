import type { PlaceCategory } from '@/lib/nyc-types';

/** Legacy preview types; interests follow the shared NYC tag list. */
export type Interest = PlaceCategory;

export type Place = {
  id: string;
  name: string;
  neighborhood: string;
  latitude: number;
  longitude: number;
  interests: Interest[];
  planningAllowanceUsd: number;
  suggestedMinutes: number;
  sourceName: string;
  sourceUrl: string;
  reviewedOn: string;
  accessNote: string;
  priceNote: string;
  published: boolean;
};

export type PlanRequest = {
  city: 'nyc';
  date: string;
  durationHours: number;
  partySize: number;
  totalBudgetUsd: number;
  interests: Interest[];
};

export type PlannedStop = Place & {
  groupAllowanceUsd: number;
};

export type Itinerary = {
  title: string;
  stops: PlannedStop[];
  totalAllowanceUsd: number;
  remainingBudgetUsd: number;
  notes: string[];
  sources: Array<Pick<Place, 'name' | 'sourceName' | 'sourceUrl'>>;
};
