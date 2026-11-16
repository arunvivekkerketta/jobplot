import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { isLoginLocked, LOGIN_FAILURE_WINDOW_MINUTES } from "@jobpilot/core";
import {
  hashPassword,
  prisma,
  recentFailedLogins,
  recordLoginAttempt,
  verifyPassword,
} from "@jobpilot/db";

/**
 * Hashed once at module load and compared against when the address does not
 * exist, so a sign-in for an unknown user costs the same work as a real one (M7).
 */
const dummyHash = hashPassword("dummy-password-that-is-never-valid");

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 hour idle/session window
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const rawEmail = credentials?.email;
        const password = credentials?.password;
        if (typeof rawEmail !== "string" || typeof password !== "string") return null;
        // Addresses are stored lowercase, so a differently cased sign-in must
        // still find the account.
        const email = rawEmail.trim().toLowerCase();

        // Too many recent failures: refuse without touching the password, so the
        // response cannot be used as a fast oracle (M7).
        // The window and the limit live in core, so the policy has one source.
        if (
          isLoginLocked(
            await recentFailedLogins(email, LOGIN_FAILURE_WINDOW_MINUTES),
          )
        ) {
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        const hash = user?.passwordHash ?? (await dummyHash);
        const valid = await verifyPassword(hash, password);

        if (!user || !valid) {
          await recordLoginAttempt(email, false);
          return null;
        }

        await recordLoginAttempt(email, true);
        return { id: user.id, email: user.email, name: user.email };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.uid) session.user.id = String(token.uid);
      return session;
    },
  },
});
