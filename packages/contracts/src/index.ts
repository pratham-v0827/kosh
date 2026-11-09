import { ASSET_CLASSES, toEpochDay } from '@kosh/core';
import { z } from 'zod';

// ---------- primitives ----------

/** Non-negative decimal as a string, e.g. "2410.50". Strings avoid float rounding on the wire. */
export const DecimalString = z
  .string()
  .trim()
  .max(30)
  .regex(/^\d+(\.\d+)?$/, 'Enter a number like 2410.50');

export const PositiveDecimalString = DecimalString.refine(
  (v) => Number(v) > 0,
  'Must be more than 0',
);

/** Calendar date YYYY-MM-DD, valid, not in the future (one day of slack for time zones). */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .superRefine((v, ctx) => {
    let day: number;
    try {
      day = toEpochDay(v);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Not a real date' });
      return;
    }
    if (day > toEpochDay(new Date()) + 1) {
      ctx.addIssue({ code: 'custom', message: 'Date cannot be in the future' });
    }
  });

export const AssetClassSchema = z.enum(ASSET_CLASSES);

export const ASSET_CLASS_LABELS: Record<(typeof ASSET_CLASSES)[number], string> = {
  IN_EQUITY: 'Indian stocks',
  US_EQUITY: 'US stocks',
  MUTUAL_FUND: 'Mutual funds',
  UNLISTED: 'Unlisted shares',
  CRYPTO: 'Crypto',
};

// ---------- settings (mirrors firebase/firestore.rules validSettings) ----------

export const SettingsSchema = z.object({
  baseCurrency: z.literal('INR'),
  numberFormat: z.enum(['indian', 'international']),
  theme: z.enum(['system', 'light', 'dark']),
  email: z.object({
    enabled: z.boolean(),
    frequency: z.enum(['weekly', 'monthly']),
    weekday: z.number().int().min(0).max(6).optional(),
  }),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  baseCurrency: 'INR',
  numberFormat: 'indian',
  theme: 'system',
  email: { enabled: false, frequency: 'weekly', weekday: 1 },
};

// ---------- manual holdings & ledger ----------

export const InstrumentInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  assetClass: AssetClassSchema,
  /** ISIN, NSE/US ticker, AMFI code or coin symbol. Optional for unlisted companies. */
  symbol: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z
      .string()
      .trim()
      .toUpperCase()
      .max(32)
      .regex(/^[A-Z0-9.\-&_:]+$/, 'Letters, digits and . - & _ : only')
      .optional(),
  ),
});
export type InstrumentInput = z.infer<typeof InstrumentInput>;

const note = z.string().trim().max(200).optional();

export const ManualHoldingInput = z.object({
  instrument: InstrumentInput,
  qty: PositiveDecimalString,
  price: DecimalString,
  fees: DecimalString.optional(),
  tradeDate: IsoDate,
  /** Current price per unit you want to value it at (required for unlisted shares in M1). */
  currentPrice: DecimalString.optional(),
  note,
});
export type ManualHoldingInput = z.infer<typeof ManualHoldingInput>;

const ratio = z.object({
  from: z.number().int().positive().max(1000),
  to: z.number().int().positive().max(1000),
});

export const TransactionInput = z.discriminatedUnion('type', [
  z.object({
    type: z.enum(['BUY', 'SELL']),
    instrumentId: z.string().min(1).max(80),
    tradeDate: IsoDate,
    qty: PositiveDecimalString,
    price: DecimalString,
    fees: DecimalString.optional(),
    note,
  }),
  z.object({
    type: z.enum(['DIVIDEND', 'FEE']),
    instrumentId: z.string().min(1).max(80),
    tradeDate: IsoDate,
    amount: PositiveDecimalString,
    note,
  }),
  z.object({
    type: z.enum(['SPLIT', 'BONUS']),
    instrumentId: z.string().min(1).max(80),
    tradeDate: IsoDate,
    ratio,
    note,
  }),
]);
export type TransactionInput = z.infer<typeof TransactionInput>;

export const ManualPriceInput = z.object({
  price: DecimalString,
  asOf: IsoDate,
});
export type ManualPriceInput = z.infer<typeof ManualPriceInput>;

// ---------- errors ----------

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

/** Flatten Zod issues into { "path.to.field": "message" } for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const k = issue.path.join('.') || '_';
    out[k] ??= issue.message;
  }
  return out;
}
