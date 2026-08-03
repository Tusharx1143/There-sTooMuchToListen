import type { GenreId } from './types'

/** West → east, grouped by region. Column order in the atlas. */
export const COUNTRIES: readonly string[] = [
  // Americas
  'us', 'ca', 'mx', 'co', 'pe', 'cl', 'ar', 'br',
  // Western Europe
  'pt', 'es', 'ie', 'gb', 'fr', 'nl', 'de', 'it',
  // Nordics
  'dk', 'no', 'se', 'fi',
  // Eastern Europe
  'pl', 'tr', 'ru',
  // Middle East & Africa
  'sa', 'ae', 'eg', 'ng', 'ke', 'za',
  // Asia
  'in', 'th', 'vn', 'id', 'ph', 'cn', 'tw', 'kr', 'jp',
  // Oceania
  'au', 'nz',
]

/** Grouped by family. Row order in the atlas. Ids are Apple's numeric genre ids. */
export const GENRES: readonly { id: GenreId; label: string }[] = [
  // Popular
  { id: 14, label: 'Pop' },
  { id: 20, label: 'Alternative' },
  { id: 21, label: 'Rock' },
  { id: 10, label: 'Singer/Songwriter' },
  { id: 1289, label: 'Folk' },
  // Urban
  { id: 18, label: 'Hip-Hop/Rap' },
  { id: 15, label: 'R&B/Soul' },
  { id: 24, label: 'Reggae' },
  // Electronic
  { id: 7, label: 'Electronic' },
  { id: 17, label: 'Dance' },
  // Roots
  { id: 6, label: 'Country' },
  { id: 2, label: 'Blues' },
  { id: 11, label: 'Jazz' },
  // Classical & instrumental
  { id: 5, label: 'Classical' },
  { id: 16, label: 'Soundtrack' },
  { id: 53, label: 'Instrumental' },
  { id: 13, label: 'New Age' },
  { id: 25, label: 'Easy Listening' },
  { id: 23, label: 'Vocal' },
  // Faith
  { id: 22, label: 'Christian' },
  // Regional
  { id: 12, label: 'Latin' },
  { id: 1122, label: 'Brazilian' },
  { id: 1203, label: 'African' },
  { id: 1197, label: 'Arabic' },
  { id: 1300, label: 'Turkish' },
  { id: 1262, label: 'Indian' },
  { id: 1232, label: 'Chinese' },
  { id: 1243, label: 'Korean' },
  { id: 27, label: 'J-Pop' },
  { id: 19, label: 'Worldwide' },
]
