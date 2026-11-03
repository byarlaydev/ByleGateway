import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticated, sessionCookie } from "../lib/auth";
import Dashboard from "../components/dashboard";
export const dynamic = "force-dynamic";
export default async function Page() {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!(await authenticated(token))) redirect("/login");
  return <Dashboard now={Date.now()} />;
}
