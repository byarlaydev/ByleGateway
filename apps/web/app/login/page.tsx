import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticated, sessionCookie } from "../../lib/auth";
import Login from "../../components/login";
export const dynamic = "force-dynamic";
export default async function LoginPage() {
  let active = false;
  try {
    active = await authenticated((await cookies()).get(sessionCookie)?.value);
  } catch {}
  if (active) redirect("/");
  return <Login />;
}
