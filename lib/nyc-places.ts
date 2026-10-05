import catalog from '@/data/nyc-poi-v1.json';
import type { Place } from '@/lib/types';

export const NYC_CATALOG_VERSION = 'nyc-poi-v1';
export const nycPlaces = catalog as Place[];

export function publishedPlaces() {
  return nycPlaces.filter((place) => place.published);
}
