/**
 * Auth Error Page
 */

import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <div className="bg-slate-800/80 backdrop-blur-sm rounded-2xl border border-red-500/30 p-8 shadow-2xl">
          <div className="text-5xl mb-4">🚫</div>
          <h1 className="text-2xl font-bold text-white mb-2">
            Access Denied
          </h1>
          <p className="text-slate-400 mb-6">
            Your email is not authorized to access this application.
            Please contact an administrator if you believe this is an error.
          </p>
          <Link
            href="/auth/signin"
            className="inline-flex items-center justify-center px-6 py-3 bg-slate-700 text-white rounded-lg font-medium hover:bg-slate-600 transition-colors"
          >
            Try Again
          </Link>
        </div>
      </div>
    </main>
  );
}
