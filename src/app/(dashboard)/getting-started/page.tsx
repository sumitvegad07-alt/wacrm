import { loadGettingStarted, isFounderViewer } from './actions';
import GettingStartedClient from './GettingStartedClient';

export const dynamic = 'force-dynamic';

export default async function GettingStartedPage() {
  const data = await loadGettingStarted();
  const isFounder = await isFounderViewer(); // TEMP-QA: gates the reset button
  if ('locked' in data) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center">
        <h1 className="text-2xl font-semibold">Getting Started</h1>
        <p className="mt-2 text-muted-foreground">
          Your current plan doesn’t include this setup guide yet.
        </p>
      </div>
    );
  }
  return <GettingStartedClient initial={data} isFounder={isFounder} />;
}
