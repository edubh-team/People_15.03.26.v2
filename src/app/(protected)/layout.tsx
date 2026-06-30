import { AuthGate } from "@/components/auth/AuthGate";
import { CryptoProvider } from "@/components/auth/CryptoProvider";
import { AppShell } from "@/components/shell/AppShell";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGate>
      <CryptoProvider>
        <AppShell>{children}</AppShell>
      </CryptoProvider>
    </AuthGate>
  );
}
