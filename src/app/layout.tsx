import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { headers } from "next/headers";
import { PARTNER_SITE_HEADER } from "@/lib/partners/site";
import { SiteHeader } from "@/components/site-header";
import { SiteHeaderSlot } from "@/components/site-header-slot";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Pages read the database per request; without Clerk's auth() call nothing else forces them dynamic, so a build would try to prerender them.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Deepam CRM",
  description: "Lead-to-sale attribution across Meta, WhatsApp, Google Ads and other sources.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Script id="theme-preference" strategy="beforeInteractive">
          {`try {
              const theme = localStorage.getItem('deepam-theme');
              if (theme === 'light' || theme === 'dark') {
                document.documentElement.dataset.theme = theme;
              }
            } catch {}`}
        </Script>
        {/* The public partner site never carries the internal header (lib/partners/site.ts). */}
        {(await headers()).get(PARTNER_SITE_HEADER) !== "1" && (
          <SiteHeaderSlot>
            <SiteHeader />
          </SiteHeaderSlot>
        )}
        {children}
      </body>
    </html>
  );
}
