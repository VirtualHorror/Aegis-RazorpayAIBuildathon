import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteFooter } from "@/components/site-footer";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Aegis — The Agentic Merchant OS for Razorpay",
  description: "Event-driven AI control plane on top of a Razorpay account: idempotent reconciliation, guard-railed agents, human approvals.",
};

/**
 * Root layout: theme provider, top bar with the theme toggle, page content, and the mandatory footer.
 * `suppressHydrationWarning` is required because next-themes sets the class on <html> before React hydrates.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-bg text-fg">
        <ThemeProvider>
          <header className="flex items-center justify-between border-b border-border px-6 py-3">
            <div className="flex items-baseline gap-3">
              <span className="text-lg font-semibold tracking-tight">Aegis</span>
              <span className="hidden text-xs text-fg-muted sm:inline">The Agentic Merchant OS for Razorpay</span>
            </div>
            <ThemeToggle />
          </header>
          <main className="flex flex-1 flex-col">{children}</main>
          <SiteFooter />
        </ThemeProvider>
      </body>
    </html>
  );
}
