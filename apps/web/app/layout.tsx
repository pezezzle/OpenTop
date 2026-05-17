import type { Metadata } from "next";
import "./styles.css";
import { AppShell } from "../components/app-shell/AppShell";

export const metadata: Metadata = {
  title: "OpenTop",
  description: "Open Ticket Orchestrator Platform"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
