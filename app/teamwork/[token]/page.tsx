import { SharedTeamworkWorkspace } from '@/components/SharedTeamworkWorkspace';

export const dynamic = 'force-dynamic';

export default function SharedTeamworkPage({ params }: { params: { token: string } }) {
  return <SharedTeamworkWorkspace token={params.token} />;
}
