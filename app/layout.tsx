import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "SQ Keys",
  description: "Self-custody wallet prototype. Student project, testnet only, no real funds.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div
          role="note"
          className="bg-amber-300 px-4 py-2 text-center text-xs font-semibold tracking-wide text-black"
        >
          STUDENT PROTOTYPE · TESTNET · NO REAL FUNDS
        </div>
        {children}
      </body>
    </html>
  );
}
