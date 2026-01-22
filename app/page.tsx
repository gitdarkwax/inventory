/**
 * Dashboard Page - Main Inventory View
 */

import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Dashboard from '@/components/Dashboard';

export default async function HomePage() {
  const session = await auth();

  if (!session) {
    redirect('/auth/signin');
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <Dashboard session={session} />
    </main>
  );
}
