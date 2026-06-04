import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { Sidebar, MobileSidebar } from "@/components/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "PromptQueue Dashboard",
  description: "Monitor and manage your PromptQueue instance",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="dark relative">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          forcedTheme="dark"
        >
          <MobileSidebar />
          <div className="flex h-screen overflow-hidden">
            <div className="hidden md:flex">
              <Sidebar collapsed={false} />
            </div>
            <main className="flex-1 overflow-y-auto bg-background p-4 pt-14 md:p-8 md:pt-8">
              {children}
            </main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
