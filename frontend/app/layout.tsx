import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Harsh Vardhan Singhania — AI Persona",
  description:
    "Chat with Harsh's AI representative. Ask about projects, skills, background, or book an interview.",
  openGraph: {
    title: "Harsh Vardhan Singhania — AI Persona",
    description: "RAG-powered AI representative for Harsh Vardhan Singhania",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full bg-slate-950 text-slate-100`}>
        {children}
      </body>
    </html>
  );
}
