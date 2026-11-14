/**
 * The message an admin sends a distributor once their login is made.
 *
 * Written here rather than inline in the component for one reason: what it must
 * NOT contain is a rule, and a rule needs a test. It never carries the
 * password. The admin has just typed one into the form beside it, and putting
 * it in a message destined for WhatsApp would park a working credential in a
 * chat history, on two phones, forever — and the CRM does not keep the password
 * anyway, so it could only come from the form field, which is worse.
 *
 * Plain sentences, no markdown: this is pasted into WhatsApp, where asterisks
 * are formatting and backticks are literal.
 */
export function shareMessage(options: {
  url: string;
  loginEmail: string;
  companyName?: string | null;
}): string {
  const { url, loginEmail, companyName } = options;
  const from = companyName?.trim() ? ` from ${companyName.trim()}` : '';
  return [
    `You can now see your orders, your customers and your account${from} online.`,
    '',
    `Website: ${url}`,
    `Your login: ${loginEmail}`,
    '',
    'Your password is being sent to you separately.',
  ].join('\n');
}
