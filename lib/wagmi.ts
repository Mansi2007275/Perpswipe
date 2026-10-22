import { createConfig, http, injected } from "wagmi";
import { walletConnect } from "wagmi/connectors";
import { publicEnv } from "./env";
import { HIDEKI, SHANNON } from "./chains";

// The chains themselves live in lib/chains.ts, which has no wagmi dependency, so the
// server routes and the Node scripts can read them without this file.
export { HIDEKI, SHANNON, HIDEKI_HAS_EXPLORER, addHidekiToWallet } from "./chains";

const connectors = [
  injected({ shimDisconnect: true }),
  // WalletConnect only exists when a project id is configured; without one its modal
  // cannot open at all, so offering the button would be a dead end.
  ...(publicEnv.walletConnectProjectId
    ? [
        walletConnect({
          projectId: publicEnv.walletConnectProjectId,
          showQrModal: true,
          metadata: {
            name: "PerpSwipe",
            description: "Perps for beginners on dreamDEX. See the most you can lose before you swipe.",
            url: "https://perpswipe.vercel.app",
            icons: [],
          },
        }),
      ]
    : []),
];

export const wagmiConfig = createConfig({
  chains: [HIDEKI, SHANNON],
  connectors,
  transports: {
    [HIDEKI.id]: http(publicEnv.hidekiRpcUrl),
    [SHANNON.id]: http(publicEnv.shannonRpcUrl),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
