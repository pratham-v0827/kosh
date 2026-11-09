import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { HoldingDetail } from './holding-detail';

// The detail view is client-rendered from the user's own Firestore data; the URL param is read
// inside a Suspense boundary so the route can be prerendered as a shell (Cache Components).
export default function HoldingPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <HoldingDetail />
    </Suspense>
  );
}
