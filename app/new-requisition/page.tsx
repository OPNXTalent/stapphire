import { CreateRequisitionForm } from '@/components/CreateRequisitionForm';

export default function NewRequisitionPage() {
  return <section className="create-workspace"><div className="page-heading"><span className="eyebrow">New requisition</span><h1>Create requisition</h1><p className="muted">Add a Job Description to begin.</p></div><div id="new-requisition" className="create-section"><CreateRequisitionForm/></div></section>;
}
