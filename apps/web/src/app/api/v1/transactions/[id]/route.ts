import { TransactionInput } from '@kosh/contracts';
import { requireUser } from '@/server/auth';
import { HttpError, ok, readJson, route } from '@/server/http';
import { applyLedgerChange, getActiveTxn, MANUAL_ACCOUNT, toLedgerFields } from '@/server/ledger';

type Ctx = RouteContext<'/api/v1/transactions/[id]'>;

/**
 * PATCH /api/v1/transactions/:id: edit = retire the old entry (status "replaced") and append the
 * corrected one, so history is kept (append-only ledger).
 */
export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const { uid } = await requireUser(req);
  const { id } = await ctx.params;
  const input = await readJson(req, TransactionInput);
  const old = await getActiveTxn(uid, id);
  if (old.instrumentId !== input.instrumentId) {
    throw new HttpError(
      422,
      'VALIDATION_FAILED',
      'A transaction cannot be moved to another holding',
    );
  }
  const result = await applyLedgerChange(uid, {
    add: [
      {
        fields: toLedgerFields(input, MANUAL_ACCOUNT),
        ...(input.note ? { note: input.note } : {}),
      },
    ],
    retire: [{ id, status: 'replaced', replacedBy: 0 }],
  });
  return ok({ transactionId: result.addedIds[0], bookVersion: result.bookVersion });
});

/** DELETE /api/v1/transactions/:id: void (kept for history, excluded from the book). */
export const DELETE = route(async (req: Request, ctx: Ctx) => {
  const { uid } = await requireUser(req);
  const { id } = await ctx.params;
  const result = await applyLedgerChange(uid, { retire: [{ id, status: 'void' }] });
  return ok({ bookVersion: result.bookVersion });
});
