import { ASSET_CLASSES, indiaDate, toEpochDay } from '@kosh/core';
import { z } from 'zod';

// ---------- primitives ----------

/** Largest amount, price or quantity accepted (₹1 lakh crore); guards against typos and overflow. */
export const MAX_DECIMAL = 1e12;
/** Most decimal places accepted (crypto needs 8; FX rates and NAVs fewer). */
export const MAX_DECIMAL_PLACES = 10;

/** Non-negative decimal as a string, e.g. "2410.50". Strings avoid float rounding on the wire. */
export const DecimalString = z
  .string()
  .trim()
  .max(30)
  .superRefine((v, ctx) => {
    // BUG-006: there was no upper bound or decimal-place limit.
    const m = /^(\d+)(?:\.(\d+))?$/.exec(v);
    if (!m) {
      ctx.addIssue({ code: 'custom', message: 'Enter a number like 2410.50' });
      return;
    }
    if ((m[2]?.length ?? 0) > MAX_DECIMAL_PLACES) {
      ctx.addIssue({ code: 'custom', message: `Use at most ${MAX_DECIMAL_PLACES} decimal places` });
      return;
    }
    if (Number(v) > MAX_DECIMAL)
      ctx.addIssue({ code: 'custom', message: 'That number is too large' });
  });

export const PositiveDecimalString = DecimalString.refine(
  (v) => Number(v) > 0,
  'Must be more than 0',
);

/** Calendar date YYYY-MM-DD, valid, and not after today in India (Kosh's reference time zone). */
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
    // BUG-002: this compared with UTC today + 1 day, which let tomorrow (IST) through.
    if (day > toEpochDay(indiaDate())) {
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

export const ExchangeSchema = z.enum(['NSE', 'BSE']);

export const InstrumentInput = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    assetClass: AssetClassSchema,
    /**
     * NSE/BSE or US ticker, AMFI code / ISIN, or coin symbol. Optional for unlisted companies.
     * Restricted characters: it becomes part of a document id and of provider URLs.
     */
    symbol: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z
        .string()
        .trim()
        .toUpperCase()
        .max(20)
        .regex(/^[A-Z0-9][A-Z0-9.\-&]*$/, 'Letters, digits and . - & only')
        .optional(),
    ),
    /** Where an Indian stock is listed. Default NSE. Drives which price source is used. */
    exchange: ExchangeSchema.optional(),
  })
  .refine((v) => !v.exchange || v.assetClass === 'IN_EQUITY', {
    path: ['exchange'],
    message: 'Exchange applies to Indian stocks only',
  });
export type InstrumentInput = z.infer<typeof InstrumentInput>;

const note = z.string().trim().max(200).optional();

export const ManualHoldingInput = z.object({
  instrument: InstrumentInput,
  qty: PositiveDecimalString,
  price: DecimalString,
  fees: DecimalString.optional(),
  tradeDate: IsoDate,
  /** USD→INR on the trade date, for US holdings. Blank = ECB reference rate for that date. */
  fxRate: PositiveDecimalString.optional(),
  /** Current price per unit, in the holding's currency (needed for unlisted shares). */
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
    fxRate: PositiveDecimalString.optional(),
    note,
  }),
  z.object({
    type: z.enum(['DIVIDEND', 'FEE']),
    instrumentId: z.string().min(1).max(80),
    tradeDate: IsoDate,
    amount: PositiveDecimalString,
    fxRate: PositiveDecimalString.optional(),
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
