'use client';

import { collection, limit, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore';
import { FileUp, Loader2, Undo2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { useAuth } from '@/components/providers/auth-provider';
import { useFormat } from '@/components/providers/settings-provider';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, apiUpload } from '@/lib/api';
import { clientDb } from '@/lib/firebase/client';
import { cn } from '@/lib/utils';
import { SourcesCard } from './sources';

/** Imports listed in the history (newest first). */
const HISTORY_LIMIT = 25;
import { type StatementDraft, StatementPreview } from './statement-preview';
import { UnmappedHoldings } from './unmapped-holdings';

// Shapes written by the server (apps/web/src/server/imports.ts). Kept local so the statement
// parsers, which are server-only, never enter the browser bundle.
interface DraftRow {
  line: number;
  fingerprint: string;
  status: 'new' | 'duplicate';
  instrumentId: string;
  instrument: { assetClass: string; name: string; symbol?: string; exchange?: string };
  type: 'BUY' | 'SELL' | 'DIVIDEND' | 'FEE' | 'SPLIT' | 'BONUS';
  tradeDate: string;
  qty?: string;
  price?: string;
  fees?: string;
  amount?: string;
  ratio?: { from: number; to: number };
  currency: 'INR' | 'USD';
}
interface RowIssue {
  line: number;
  field?: string;
  message: string;
}
interface ImportDoc {
  id: string;
  /** 'positions' = a holdings statement (see statement-preview.tsx); absent on older records. */
  kind?: 'transactions' | 'positions';
  /** Holdings statements: the broker's name and the statement's "as on" date. */
  label?: string;
  statementDate?: string;
  status: 'draft' | 'confirmed' | 'undone';
  parser: string;
  source: string;
  createdAt: Timestamp | null;
  counts: {
    total: number;
    new: number;
    duplicate: number;
    needsAttention: number;
    newHoldings: number;
  };
  rows?: DraftRow[];
  issues: RowIssue[];
  issuesTruncated?: boolean;
  added?: number;
  skippedDuplicates?: number;
}
interface FormatsResponse {
  formats: { id: string; version: string; label: string; extensions: string[] }[];
  limits: {
    maxFileBytes: number;
    maxRowsPerFile: number;
    uploadsPerDay: number;
    rowsPerDay: number;
  };
}

const TYPE_LABEL: Record<DraftRow['type'], string> = {
  BUY: 'Buy',
  SELL: 'Sell',
  DIVIDEND: 'Dividend',
  FEE: 'Charge',
  SPLIT: 'Split',
  BONUS: 'Bonus',
};

const when = (t: Timestamp | null) =>
  t
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(t.toDate())
    : 'just now';

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export default function ImportPage() {
  const { user } = useAuth();
  const [imports, setImports] = useState<
    | { status: 'loading' }
    | { status: 'error'; error: string }
    | { status: 'ready'; rows: ImportDoc[] }
  >({ status: 'loading' });
  const [formats, setFormats] = useState<FormatsResponse | null>(null);
  const [busy, setBusy] = useState<'upload' | 'confirm' | 'discard' | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(clientDb(), `users/${user.uid}/imports`),
      orderBy('createdAt', 'desc'),
      limit(HISTORY_LIMIT),
    );
    return onSnapshot(
      q,
      (s) =>
        setImports({
          status: 'ready',
          rows: s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ImportDoc, 'id'>) })),
        }),
      (e) => setImports({ status: 'error', error: e.message }),
    );
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api<FormatsResponse>('/api/v1/imports')
      .then(setFormats)
      .catch(() => setFormats(null)); // the list is a convenience; uploads still work
  }, [user]);

  // The live draft is the preview: it survives a reload and is the same data confirm will use.
  const draft = imports.status === 'ready' ? imports.rows.find((r) => r.status === 'draft') : null;
  const history =
    imports.status === 'ready' ? imports.rows.filter((r) => r.status !== 'draft') : [];

  async function upload(file: File) {
    setUploadError(null);
    setNotice(null);
    setBusy('upload');
    try {
      const r = await apiUpload<{
        alreadyImported?: boolean;
        label?: string;
        statementDate?: string;
      }>('/api/v1/imports', file);
      if (r.alreadyImported) {
        setNotice(
          `This ${r.label} statement (as on ${r.statementDate}) is already imported. There is nothing to do.`,
        );
      }
    } catch (e) {
      setUploadError(message(e, 'Could not read that file'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import</h1>
        <p className="text-sm text-muted-foreground">
          Bring in your history from a file. You see exactly what will be added before anything
          changes, and you can undo an import later.
        </p>
      </div>

      <UploadCard busy={busy === 'upload'} error={uploadError} formats={formats} onFile={upload} />
      {notice && (
        <p role="status" className="rounded-lg border bg-accent p-3 text-sm">
          {notice}
        </p>
      )}

      {imports.status === 'loading' ? (
        <Skeleton className="h-48" />
      ) : imports.status === 'error' ? (
        <ErrorState message={imports.error} />
      ) : (
        <>
          {draft &&
            (draft.kind === 'positions' ? (
              <StatementPreview
                key={draft.id}
                draft={draft as unknown as StatementDraft}
                busy={busy}
                setBusy={setBusy}
              />
            ) : (
              <Preview key={draft.id} draft={draft} busy={busy} setBusy={setBusy} />
            ))}
          <SourcesCard
            imports={imports.rows}
            complete={imports.rows.length < HISTORY_LIMIT}
            limits={formats?.limits ?? null}
          />
          <UnmappedHoldings />
          <HistoryCard rows={history} />
        </>
      )}
    </div>
  );
}

function UploadCard({
  busy,
  error,
  formats,
  onFile,
}: {
  busy: boolean;
  error: string | null;
  formats: FormatsResponse | null;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const accept = formats
    ? [...new Set(formats.formats.flatMap((f) => f.extensions))].join(',')
    : '.csv';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload a file</CardTitle>
        <CardDescription>
          The file is read in memory and discarded straight away. Kosh keeps only the rows you
          confirm, never the file or its name.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const file = e.dataTransfer.files[0];
            if (file && !busy) onFile(file);
          }}
          className={cn(
            'flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-8 text-center transition-colors',
            over && 'border-primary bg-accent',
          )}
        >
          <FileUp aria-hidden className="size-7 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Drop a file here, or</p>
          <input
            ref={input}
            type="file"
            accept={accept}
            className="sr-only"
            aria-label="Choose a file to import"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // allow choosing the same file again
              if (file) onFile(file);
            }}
          />
          <Button disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 aria-hidden className="animate-spin" /> : <Upload aria-hidden />}
            {busy ? 'Reading…' : 'Choose file'}
          </Button>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
          >
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Preview({
  draft,
  busy,
  setBusy,
}: {
  draft: ImportDoc;
  busy: 'upload' | 'confirm' | 'discard' | null;
  setBusy: (b: 'upload' | 'confirm' | 'discard' | null) => void;
}) {
  const f = useFormat();
  const rows = useMemo(() => draft.rows ?? [], [draft.rows]);
  const fresh = useMemo(() => rows.filter((r) => r.status === 'new'), [rows]);
  const duplicates = useMemo(() => rows.filter((r) => r.status === 'duplicate'), [rows]);
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set());
  const [tab, setTab] = useState(
    fresh.length > 0 ? 'new' : draft.issues.length > 0 ? 'issues' : 'duplicate',
  );
  const selected = fresh.length - skipped.size;

  const toggle = (line: number) =>
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });

  async function confirm() {
    setBusy('confirm');
    try {
      const r = await api<{ added: number; skippedDuplicates: number }>(
        `/api/v1/imports/${draft.id}/confirm`,
        { method: 'POST', body: { skipLines: [...skipped] } },
      );
      toast.success(
        `${r.added} ${r.added === 1 ? 'row' : 'rows'} imported` +
          (r.skippedDuplicates ? `, ${r.skippedDuplicates} already there` : ''),
      );
    } catch (e) {
      toast.error(message(e, 'Could not import'));
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    setBusy('discard');
    try {
      await api(`/api/v1/imports/${draft.id}`, { method: 'DELETE' });
    } catch (e) {
      toast.error(message(e, 'Could not discard'));
    } finally {
      setBusy(null);
    }
  }

  const amountOf = (r: DraftRow) =>
    r.type === 'SPLIT' || r.type === 'BONUS'
      ? `${r.ratio?.from}:${r.ratio?.to}`
      : r.amount !== undefined
        ? f.money(r.amount, { currency: r.currency })
        : r.price !== undefined
          ? f.money(r.price, { currency: r.currency })
          : '—';

  const table = (list: DraftRow[], selectable: boolean) => (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {selectable && (
              <TableHead className="w-10">
                <span className="sr-only">Include</span>
              </TableHead>
            )}
            <TableHead>Row</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Holding</TableHead>
            <TableHead className="text-right">Quantity</TableHead>
            <TableHead className="text-right">Price / amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((r) => (
            <TableRow key={r.fingerprint} className={cn(skipped.has(r.line) && 'opacity-50')}>
              {selectable && (
                <TableCell>
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={!skipped.has(r.line)}
                    onChange={() => toggle(r.line)}
                    aria-label={`Include row ${r.line}: ${TYPE_LABEL[r.type]} ${r.instrument.name}`}
                  />
                </TableCell>
              )}
              <TableCell className="num text-muted-foreground">{r.line}</TableCell>
              <TableCell className="num whitespace-nowrap">{r.tradeDate}</TableCell>
              <TableCell>{TYPE_LABEL[r.type]}</TableCell>
              <TableCell>
                <span className="font-medium">{r.instrument.name}</span>
                {r.instrument.symbol && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {r.instrument.symbol}
                    {r.instrument.exchange ? ` · ${r.instrument.exchange}` : ''}
                  </span>
                )}
              </TableCell>
              <TableCell className="num text-right">{r.qty ? f.qty(r.qty) : '—'}</TableCell>
              <TableCell className="num text-right">{amountOf(r)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Check before importing</CardTitle>
        <CardDescription>
          {draft.counts.total} {draft.counts.total === 1 ? 'row' : 'rows'} read as{' '}
          <span className="num">{draft.parser}</span>. Nothing has been added yet.
          {draft.counts.newHoldings > 0 &&
            ` ${draft.counts.newHoldings} new ${draft.counts.newHoldings === 1 ? 'holding' : 'holdings'} will be created.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <div className="-mx-1 overflow-x-auto px-1">
            <TabsList aria-label="Rows in this file" className="w-max justify-start">
              <TabsTrigger value="new">New ({fresh.length})</TabsTrigger>
              <TabsTrigger value="duplicate">Already imported ({duplicates.length})</TabsTrigger>
              <TabsTrigger value="issues">
                Needs attention ({draft.counts.needsAttention})
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="new">
            {fresh.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing new in this file. Every usable row is already in your ledger.
              </p>
            ) : (
              table(fresh, true)
            )}
          </TabsContent>
          <TabsContent value="duplicate">
            {duplicates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rows were imported before.</p>
            ) : (
              <>
                <p className="mb-2 text-sm text-muted-foreground">
                  These rows match ones you imported earlier and will be skipped.
                </p>
                {table(duplicates, false)}
              </>
            )}
          </TabsContent>
          <TabsContent value="issues">
            {draft.issues.length === 0 ? (
              <p className="text-sm text-muted-foreground">Every row could be read.</p>
            ) : (
              <>
                <p className="mb-2 text-sm text-muted-foreground">
                  These rows will not be imported. Fix them in the file and upload it again; rows
                  already imported are skipped automatically.
                </p>
                <ul className="space-y-1 text-sm">
                  {draft.issues.map((i, n) => (
                    <li key={`${i.line}-${i.field ?? ''}-${n}`} className="flex gap-2">
                      <span className="num w-16 shrink-0 text-muted-foreground">Row {i.line}</span>
                      <span>
                        {i.field && <span className="font-medium">{i.field}: </span>}
                        {i.message}
                      </span>
                    </li>
                  ))}
                </ul>
                {draft.issuesTruncated && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Only the first 100 are shown.
                  </p>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          <Button variant="outline" disabled={busy !== null} onClick={discard}>
            Discard
          </Button>
          <Button disabled={busy !== null || selected === 0} onClick={confirm}>
            {busy === 'confirm' && <Loader2 aria-hidden className="animate-spin" />}
            Import {selected} {selected === 1 ? 'row' : 'rows'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function HistoryCard({ rows }: { rows: ImportDoc[] }) {
  const [undoing, setUndoing] = useState<string | null>(null);

  async function undo(id: string) {
    setUndoing(id);
    try {
      const r = await api<{ voided: number }>(`/api/v1/imports/${id}`, { method: 'DELETE' });
      toast.success(`Import undone: ${r.voided} ${r.voided === 1 ? 'row' : 'rows'} removed`);
    } catch (e) {
      toast.error(message(e, 'Could not undo'));
    } finally {
      setUndoing(null);
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState icon={FileUp} title="No imports yet">
        Files you import are listed here, with an undo for each.
      </EmptyState>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Import history</CardTitle>
        <CardDescription>
          Undo removes the rows an import added. They stay in your records as removed.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When (IST)</TableHead>
              <TableHead>Format</TableHead>
              <TableHead className="text-right">Rows added</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap">{when(r.createdAt)}</TableCell>
                <TableCell>
                  {r.kind === 'positions' && (
                    <div className="font-medium">
                      {r.label} holdings{' '}
                      <span className="num font-normal text-muted-foreground">
                        as on {r.statementDate}
                      </span>
                    </div>
                  )}
                  <span className="num text-xs text-muted-foreground">{r.parser}</span>
                </TableCell>
                <TableCell className="num text-right">{r.added ?? 0}</TableCell>
                <TableCell>
                  <Badge variant={r.status === 'confirmed' ? 'secondary' : 'outline'}>
                    {r.status === 'confirmed' ? 'Imported' : 'Undone'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {r.status === 'confirmed' && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" disabled={undoing !== null}>
                          <Undo2 aria-hidden /> Undo
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Undo this import?</AlertDialogTitle>
                          <AlertDialogDescription>
                            The {r.added ?? 0} rows it added are removed from your holdings. You can
                            import the same file again later.
                            {r.kind === 'positions' &&
                              ' Holdings from an earlier statement are not brought back: import that statement again if you want them.'}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-white hover:bg-destructive/90"
                            onClick={() => undo(r.id)}
                          >
                            Undo import
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
