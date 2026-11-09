import { ManualHoldingInput } from '@kosh/contracts';
import { defaultCurrency } from '@kosh/core';
import { requireUser } from '@/server/auth';
import { ok, readJson, route } from '@/server/http';
import {
  applyLedgerChange,
  instrumentIdFor,
  istToday,
  MANUAL_ACCOUNT,
  resolveCurrency,
} from '@/server/ledger';

/**
 * POST /api/v1/holdings/manual: add a manual or unlisted holding (instrument + first BUY,
 * optionally a current price). Adding the same instrument again adds another purchase lot.
 * US holdings are in USD; the trade-date USD→INR rate is looked up if not given.
 */
export const POST = route(async (req: Request) => {
  const { uid } = await requireUser(req);
  const input = await readJson(req, ManualHoldingInput);
  const instrumentId = instrumentIdFor(input.instrument);
  const money = await resolveCurrency(
    uid,
    instrumentId,
    input.tradeDate,
    input.fxRate,
    input.instrument.assetClass,
  );

  const result = await applyLedgerChange(uid, {
    instruments: [
      {
        id: instrumentId,
        name: input.instrument.name,
        assetClass: input.instrument.assetClass,
        symbol: input.instrument.symbol ?? null,
        currency: defaultCurrency(input.instrument.assetClass),
        ...(input.instrument.exchange ? { exchange: input.instrument.exchange } : {}),
      },
    ],
    add: [
      {
        fields: {
          accountId: MANUAL_ACCOUNT,
          instrumentId,
          type: 'BUY',
          tradeDate: input.tradeDate,
          qty: input.qty,
          price: input.price,
          ...(input.fees ? { fees: input.fees } : {}),
          currency: money.currency,
          ...(money.fxRate ? { fxRate: money.fxRate } : {}),
        },
        ...(input.note ? { note: input.note } : {}),
      },
    ],
    ...(input.currentPrice
      ? { manualPrices: { [instrumentId]: { price: input.currentPrice, asOf: istToday() } } }
      : {}),
  });

  return ok(
    { instrumentId, transactionId: result.addedIds[0], bookVersion: result.bookVersion },
    201,
  );
});
