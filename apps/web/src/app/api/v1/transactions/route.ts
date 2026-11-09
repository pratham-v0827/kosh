import { TransactionInput } from '@kosh/contracts';
import { requireUser } from '@/server/auth';
import { ok, readJson, route } from '@/server/http';
import {
  applyLedgerChange,
  MANUAL_ACCOUNT,
  resolveCurrency,
  toLedgerFields,
} from '@/server/ledger';

/** POST /api/v1/transactions: add a buy, sell, dividend, fee, split or bonus to a manual holding. */
export const POST = route(async (req: Request) => {
  const { uid } = await requireUser(req);
  const input = await readJson(req, TransactionInput);
  const money = await resolveCurrency(
    uid,
    input.instrumentId,
    input.tradeDate,
    'fxRate' in input ? input.fxRate : undefined,
  );
  const result = await applyLedgerChange(uid, {
    add: [
      {
        fields: toLedgerFields(input, MANUAL_ACCOUNT, money),
        ...(input.note ? { note: input.note } : {}),
      },
    ],
  });
  return ok({ transactionId: result.addedIds[0], bookVersion: result.bookVersion }, 201);
});
