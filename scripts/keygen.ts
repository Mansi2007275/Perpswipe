// Creates a fresh TESTNET-ONLY wallet and saves it to .env
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

if (existsSync(".env") && /PRIVATE_KEY=0x/.test(readFileSync(".env", "utf8"))) {
  const key = readFileSync(".env", "utf8").match(/PRIVATE_KEY=(0x[0-9a-fA-F]{64})/)![1] as `0x${string}`;
  console.log("Key already exists in .env. Bot address:", privateKeyToAccount(key).address);
  process.exit(0);
}
const key = generatePrivateKey();
writeFileSync(".env", `PRIVATE_KEY=${key}\n`);
console.log("New bot wallet saved to .env (never commit this file)");
console.log("Bot address:", privateKeyToAccount(key).address);
