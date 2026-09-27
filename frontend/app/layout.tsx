import "./globals.css";
import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/AppShell";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "PM Automation System",
  description: "Preventive Maintenance Automation & Monitoring",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#1a1d21",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        <ServiceWorkerRegister />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
