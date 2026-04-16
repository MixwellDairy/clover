import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clover AI Chat",
  description: "Multi-user AI chat with memory and admin panel"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
