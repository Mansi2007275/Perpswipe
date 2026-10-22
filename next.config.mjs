/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    // The Markets SDK opens Node sockets only on the server; the browser uses native WebSocket.
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, ws: false, net: false, tls: false, fs: false };
    }
    // `wagmi/connectors` is a barrel: importing walletConnect from it also pulls in the
    // Base Account connector, whose @base-org/account -> @coinbase/cdp-sdk chain imports
    // @x402/* packages that are not published, so webpack cannot resolve them and the
    // build fails. @wagmi/connectors 6.2.0 exports no per-connector subpath to import
    // instead, so the branch is cut here. Base Account only reaches that package through
    // `await import("@base-org/account")` inside its own getProvider, and PerpSwipe never
    // constructs that connector, so the code is unreachable rather than merely unused.
    // @metamask/sdk carries a React Native code path and imports async-storage from it.
    // In a web build that module does not exist and the branch is never taken, so the
    // import is cut rather than left as a "module not found" warning on every build.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@base-org/account": false,
      "@react-native-async-storage/async-storage": false,
    };
    config.externals = [...(config.externals || []), "pino-pretty", "lokijs", "encoding"];
    return config;
  },
};
export default nextConfig;
