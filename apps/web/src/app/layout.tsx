import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/shell/AppShell";
import { SiteFooter } from "@/components/shell/SiteFooter";
import { ThemeProvider } from "@/components/shell/ThemeProvider";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Aegis", template: "%s · Aegis" },
  description: "Event-driven AI control plane on top of a Razorpay account: idempotent reconciliation, guard-railed agents, human approvals.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Native controls follow the active theme; next-themes also writes `color-scheme` on <html> (Design.md §7).
  colorScheme: "light dark",
};

/**
 * Root layout: fonts, theme provider, toast region, the app shell (sidebar + top bar) and the mandatory footer.
 * Intent: the footer lives here, not in pages, so no route can forget it (C-F1).
 * `suppressHydrationWarning` is required because next-themes sets the class on <html> before React hydrates.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="bg-bg text-fg">
        <ThemeProvider>
          <ToastProvider>
            <AppShell footer={<SiteFooter />}>{children}</AppShell>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
