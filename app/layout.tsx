/**
 * Root Layout
 */

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MagBak Inventory Master Tracker",
  description: "Real-time Shopify inventory tracking and analytics",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
