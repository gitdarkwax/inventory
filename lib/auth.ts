/**
 * NextAuth Configuration
 * Google OAuth with email allowlist and role-based access
 * 
 * ALLOWED_EMAILS - Full write access (can submit forms, make changes)
 * ALLOWED_EMAILS_READONLY - Read-only access (can view data only)
 */

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const allowedEmails = process.env.ALLOWED_EMAILS?.split(',').map(e => e.trim().toLowerCase()) || [];
const readOnlyEmails = process.env.ALLOWED_EMAILS_READONLY?.split(',').map(e => e.trim().toLowerCase()) || [];

// Helper to check user role
export function getUserRole(email: string | null | undefined): 'write' | 'readonly' | null {
  if (!email) return null;
  const emailLower = email.toLowerCase();
  if (allowedEmails.includes(emailLower)) return 'write';
  if (readOnlyEmails.includes(emailLower)) return 'readonly';
  return null;
}

// Helper to check if user has write access
export function canWrite(email: string | null | undefined): boolean {
  return getUserRole(email) === 'write';
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true, // Required when using multiple domains (vercel.app + custom)
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // Check if email is in allowed list (write or readonly)
      if (!user.email) return false;
      const role = getUserRole(user.email);
      const isAllowed = role !== null;
      console.log(`Sign-in attempt: ${user.email}, Role: ${role}, Allowed: ${isAllowed}`);
      return isAllowed;
    },
    async jwt({ token, user }) {
      // Add role to token on sign in
      if (user?.email) {
        token.role = getUserRole(user.email);
      }
      return token;
    },
    async session({ session, token }) {
      // Add role to session
      if (session.user) {
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
});
