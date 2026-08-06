'use client';

import { useRouter } from 'next/navigation';
import { TopBar } from '@/components/TopBar';
import { NewRequisitionForm } from '@/components/NewRequisitionForm';

// Kept as a direct-linkable route for convenience, but the primary
// creation flow now lives inline in the dashboard (see app/page.tsx),
// triggered by "Add Requisition" — no page navigation needed there.
export default function NewRequisitionPage() {
  const router = useRouter();

  return (
    <>
      <TopBar />
      <NewRequisitionForm onCreated={(id) => router.push(`/?requisition=${id}`)} />
    </>
  );
}
