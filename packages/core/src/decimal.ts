import Decimal from 'decimal.js';

/**
 * BUG-006: decimal.js defaults to 20 significant digits, which silently rounds large
 * qty × price products. 40 digits keeps every realistic (and most unrealistic) amount exact.
 * Imported by every module that does money arithmetic.
 */
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export default Decimal;
