import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "API Testing Kit",
  description: "Latency and response-quality testing for a locally-hosted LLM API",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
