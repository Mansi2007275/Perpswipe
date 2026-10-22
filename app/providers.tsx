"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { WagmiProvider, useWalletClient } from "wagmi";
import { wagmiConfig, HIDEKI } from "@/lib/wagmi";

// Binds the connected wallet to the dreamDEX SDK, only while it is on Hideki.
function SignerBinding() {
  const { data: walletClient } = useWalletClient({ chainId: HIDEKI.id });
  useEffect(() => {
    import("@/lib/dex").then(({ bindWallet }) => bindWallet(walletClient ?? undefined));
  }, [walletClient]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SignerBinding />
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
