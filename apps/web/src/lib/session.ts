import { redirect } from "next/navigation";
import { auth } from "@/auth";

export interface SessionUser {
  userId: string;
  email: string;
}

export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const userId = session?.user?.id;
  const email = session?.user?.email;
  if (!userId || !email) redirect("/login");
  return { userId, email };
}
