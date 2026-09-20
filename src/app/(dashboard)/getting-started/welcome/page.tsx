import { redirect } from 'next/navigation';
import { loadGettingStarted } from '../actions';
import GettingStartedClient from '../GettingStartedClient';

export const dynamic = 'force-dynamic';

// Fresh-signup entry point: the guided setup in focus mode (no main menu).
// The dashboard shell hides its chrome for this exact path.
export default async function GettingStartedWelcomePage() {
  const data = await loadGettingStarted();
  if ('locked' in data) redirect('/dashboard');
  return <GettingStartedClient initial={data} focus />;
}
