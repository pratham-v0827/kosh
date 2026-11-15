// Privacy mode and display currency are remembered per device; bad stored values never break the app.
import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW, parseViewPrefs } from '@/lib/view-prefs';

describe('parseViewPrefs', () => {
  it('reads what was stored', () => {
    expect(parseViewPrefs('{"hidden":true,"currency":"USD"}')).toEqual({
      hidden: true,
      currency: 'USD',
    });
  });

  it('falls back to the defaults for missing, corrupt or unexpected values', () => {
    expect(parseViewPrefs(null)).toEqual(DEFAULT_VIEW);
    expect(parseViewPrefs('not json')).toEqual(DEFAULT_VIEW);
    expect(parseViewPrefs('{"hidden":"yes","currency":"EUR"}')).toEqual(DEFAULT_VIEW);
    expect(parseViewPrefs('null')).toEqual(DEFAULT_VIEW);
  });
});
