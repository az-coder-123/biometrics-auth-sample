import { AuthProvider } from "@/contexts/auth-context";
import type { Metadata } from "next";
import "./globals.css";

/**
 * Root layout component.
 *
 * Wraps the entire application with global styles, metadata,
 * and the AuthProvider for authentication state management.
 */

export const metadata: Metadata = {
  title: "Biometrics Auth Sample",
  description: "Biometric authentication sample application with WebAuthn",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}