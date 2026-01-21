/**
 * Root Layout
 */

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Inventory Dashboard",
  description: "Real-time Shopify inventory tracking and analytics",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased min-h-screen grid-pattern">
        {children}
      </body>
    </html>
  );
}
