'use client';

import { PasswordForm } from './password-form';
import { SessionsCard } from './sessions-card';
import { SettingsPanelHead } from './settings-panel-head';

/**
 * "Login & security" section — groups the former Profile-tab password
 * and active-sessions cards into their own dedicated home.
 */
export function SecurityPanel() {
  return (
    <section className="w-full animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Login & security"
        description="Change your password and sign out of your devices. These keep your account safe."
      />
      <div className="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <PasswordForm />
        <SessionsCard />
      </div>
    </section>
  );
}
