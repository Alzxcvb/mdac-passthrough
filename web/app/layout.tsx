import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/react";
import TelemetryProvider from "@/components/TelemetryProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "MDAC Filer — Hands-off Malaysia Arrival Card",
  description:
    "We file your Malaysia Digital Arrival Card for you. Enter your data once, get the official QR by email. Works on any phone.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#003893",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">
        <TelemetryProvider />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
