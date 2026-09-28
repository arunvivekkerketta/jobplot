import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma, verifyPassword } from "@jobpilot/db";

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
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;
        const valid = await verifyPassword(user.passwordHash, password);
        if (!valid) return null;
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
