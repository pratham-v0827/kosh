import { ManualHoldingInput } from '@kosh/contracts';
import { requireUser } from '@/server/auth';
import { ok, readJson, route } from '@/server/http';
import { applyLedgerChange, instrumentIdFor, istToday, MANUAL_ACCOUNT } from '@/server/ledger';

/**
 * POST /api/v1/holdings/manual: add a manual or unlisted holding (instrument + first BUY,
 * optionally a current price). Adding the same instrument again adds another purchase lot.
 */
export const POST = route(async (req: Request) => {
  const { uid } = await requireUser(req);
  const input = await readJson(req, ManualHoldingInput);
  const instrumentId = instrumentIdFor(input.instrument);

  const result = await applyLedgerChange(uid, {
    instruments: [
      {
        id: instrumentId,
        name: input.instrument.name,
        assetClass: input.instrument.assetClass,
        symbol: input.instrument.symbol ?? null,
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
        },
        ...(input.note ? { note: input.note } : {}),
      },
    ],
    ...(input.currentPrice
      ? {
          prices: {
            [instrumentId]: {
              price: input.currentPrice,
              asOf: istToday(),
              source: 'manual' as const,
            },
          },
        }
      : {}),
  });

  return ok(
    { instrumentId, transactionId: result.addedIds[0], bookVersion: result.bookVersion },
    201,
  );
});
