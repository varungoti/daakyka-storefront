import { AdminShell } from "@/components/admin/admin-shell";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export default async function AdminPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    redirect("/admin/login");
  }

  return <AdminShell user={session}>{children}</AdminShell>;
}
