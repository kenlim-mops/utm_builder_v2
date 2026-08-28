import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Nav } from "./components";

export const metadata: Metadata = {
  title: "Runpod UTM Builder & Registry",
  description:
    "Governed campaign links: one builder, one registry, one source of truth.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
