/**
 * Home Page - Inventory Dashboard
 */

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth();

  if (!session) {
    redirect("/auth/signin");
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-8 animate-fade-in">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-cyan-400">
                📦 Inventory Dashboard
              </h1>
              <p className="text-slate-400 mt-1">
                Real-time stock levels and analytics
              </p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-400">
                {session.user?.email}
              </span>
              <a
                href="/api/auth/signout"
                className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
              >
                Sign Out
              </a>
            </div>
          </div>
        </header>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            title="Total SKUs"
            value="--"
            subtitle="Active products"
            icon="📊"
            delay="delay-100"
          />
          <StatCard
            title="Total Units"
            value="--"
            subtitle="In stock"
            icon="📦"
            delay="delay-200"
          />
          <StatCard
            title="Low Stock"
            value="--"
            subtitle="Below threshold"
            icon="⚠️"
            color="warning"
            delay="delay-300"
          />
          <StatCard
            title="Out of Stock"
            value="--"
            subtitle="Zero inventory"
            icon="🚨"
            color="danger"
            delay="delay-400"
          />
        </div>

        {/* Main Content */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6 animate-fade-in delay-500">
          <h2 className="text-xl font-semibold mb-4 text-slate-200">
            Inventory Overview
          </h2>
          <p className="text-slate-400">
            Connect your data sources to see inventory levels here.
            Dashboard features coming soon...
          </p>
        </div>
      </div>
    </main>
  );
}

interface StatCardProps {
  title: string;
  value: string;
  subtitle: string;
  icon: string;
  color?: 'default' | 'warning' | 'danger' | 'success';
  delay?: string;
}

function StatCard({ title, value, subtitle, icon, color = 'default', delay = '' }: StatCardProps) {
  const colorClasses = {
    default: 'border-slate-700 bg-slate-800/50',
    warning: 'border-yellow-500/30 bg-yellow-500/10',
    danger: 'border-red-500/30 bg-red-500/10',
    success: 'border-green-500/30 bg-green-500/10',
  };

  const valueColors = {
    default: 'text-cyan-400',
    warning: 'text-yellow-400',
    danger: 'text-red-400',
    success: 'text-green-400',
  };

  return (
    <div className={`rounded-xl border p-5 ${colorClasses[color]} animate-fade-in opacity-0 ${delay}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-slate-400">{title}</span>
        <span className="text-2xl">{icon}</span>
      </div>
      <div className={`text-3xl font-bold ${valueColors[color]}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-1">{subtitle}</div>
    </div>
  );
}
