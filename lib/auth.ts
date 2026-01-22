/**
 * NextAuth Configuration
 * Google OAuth with email allowlist
 */

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const allowedEmails = process.env.ALLOWED_EMAILS?.split(',').map(e => e.trim().toLowerCase()) || [];

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // Check if email is in allowed list (case-insensitive)
      if (!user.email) return false;
      const isAllowed = allowedEmails.includes(user.email.toLowerCase());
      console.log(`Sign-in attempt: ${user.email}, Allowed: ${isAllowed}, AllowedList: ${allowedEmails.join(', ')}`);
      return isAllowed;
    },
    async session({ session }) {
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
});
