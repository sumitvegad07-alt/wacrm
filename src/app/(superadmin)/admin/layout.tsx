import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SuperAdminShell from "./admin-shell";

// Server-side gate. The previous version was a client component whose only
// protection was a useEffect redirect, which meant every signed-in user could
// load /admin and receive the whole superadmin bundle before being bounced.
// Deciding here keeps non-superadmins from ever reaching the shell.
export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_superadmin")
    .eq("user_id", user.id)
    .single();

  // 404 rather than a redirect: a non-superadmin should not learn the route exists.
  if (!profile?.is_superadmin) notFound();

  return <SuperAdminShell>{children}</SuperAdminShell>;
}
