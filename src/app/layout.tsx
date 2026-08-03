import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Deepam CRM",
  description: "Lead-to-sale attribution across Instagram, WhatsApp, Google Ads and other sources.",
};

export default function RootLayout({
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
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
