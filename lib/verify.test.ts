// Receipt verification is the only thing standing between the leaderboard and anyone
// who can POST JSON, so each rule gets its own test, including the near-misses that a
// case-sensitive or a "truthy" check would wave through.
import { describe, expect, it, vi } from "vitest";
import { isAddress, isTxHash, verifyTxReceipt, type MinimalReceipt, type ReceiptReader } from "./verify";

const WALLET = "0x1234567890abcdef1234567890abcdef12345678";
const POOL = "0xf71b619450bafe953f47b9b556416a3a67b443b5";
const OTHER = "0xfa9b9e50cc1745113d57893991af200a74c86b6f";
const TX = `0x${"ab".repeat(32)}`;

const receipt = (over: Partial<MinimalReceipt> = {}): MinimalReceipt => ({
  status: "success",
  from: WALLET,
  to: POOL,
  transactionHash: TX,
  blockNumber: 1n,
  ...over,
});

const reader = (r: MinimalReceipt | null): ReceiptReader => vi.fn(async () => r);
const good = { txHash: TX, wallet: WALLET, allowedTo: [POOL] };

describe("isTxHash", () => {
  it("accepts a 32-byte hash", () => {
    expect(isTxHash(TX)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isTxHash(`0x${"ab".repeat(31)}`)).toBe(false); // too short
    expect(isTxHash(`0x${"ab".repeat(33)}`)).toBe(false); // too long
    expect(isTxHash("ab".repeat(32))).toBe(false); // no 0x
    expect(isTxHash(`0x${"zz".repeat(32)}`)).toBe(false); // not hex
    expect(isTxHash(undefined)).toBe(false);
    expect(isTxHash(null)).toBe(false);
    expect(isTxHash(123)).toBe(false);
    expect(isTxHash("")).toBe(false);
  });
});

describe("isAddress", () => {
  it("accepts a 20-byte address in any case", () => {
    expect(isAddress(WALLET)).toBe(true);
    expect(isAddress(WALLET.toUpperCase().replace("0X", "0x"))).toBe(true);
  });

  it("rejects a hash, a short string and a non-string", () => {
    expect(isAddress(TX)).toBe(false);
    expect(isAddress("0x1234")).toBe(false);
    expect(isAddress(null)).toBe(false);
  });
});

describe("verifyTxReceipt", () => {
  it("accepts a successful transaction from the wallet to the pool", async () => {
    const result = await verifyTxReceipt(good, reader(receipt()));
    expect(result.ok).toBe(true);
  });

  it("matches the wallet and the pool regardless of case", async () => {
    const result = await verifyTxReceipt(
      { txHash: TX, wallet: WALLET.toUpperCase().replace("0X", "0x"), allowedTo: [POOL.toUpperCase().replace("0X", "0x")] },
      reader(receipt()),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a reverted transaction", async () => {
    const result = await verifyTxReceipt(good, reader(receipt({ status: "reverted" })));
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toMatch(/failed on-chain/);
  });

  it("rejects a transaction someone else sent", async () => {
    const result = await verifyTxReceipt(good, reader(receipt({ from: OTHER })));
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toMatch(/not sent by this wallet/);
  });

  it("rejects a transaction sent to another contract", async () => {
    const result = await verifyTxReceipt(good, reader(receipt({ to: OTHER })));
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toMatch(/dreamDEX pool/);
  });

  it("rejects a contract-creation receipt, whose `to` is null", async () => {
    const result = await verifyTxReceipt(good, reader(receipt({ to: null })));
    expect(result.ok).toBe(false);
  });

  it("rejects a transaction that is not on chain yet", async () => {
    const result = await verifyTxReceipt(good, reader(null));
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toMatch(/not on Hideki yet/);
  });

  it("treats a throwing reader as a missing receipt, not a crash", async () => {
    const result = await verifyTxReceipt(good, async () => {
      throw new Error("TransactionReceiptNotFoundError");
    });
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toMatch(/not on Hideki yet/);
  });

  it("accepts a transaction to any of several allowed pools", async () => {
    const result = await verifyTxReceipt({ ...good, allowedTo: [OTHER, POOL] }, reader(receipt()));
    expect(result.ok).toBe(true);
  });

  it("refuses to verify with no pool to check against, rather than passing everything", async () => {
    const spy = vi.fn();
    const result = await verifyTxReceipt({ ...good, allowedTo: [] }, spy);
    expect(result).toMatchObject({ ok: false });
    expect(spy).not.toHaveBeenCalled(); // and it does not spend an RPC call finding out
  });

  it("refuses when an allowed address is malformed, so a typo cannot widen the check", async () => {
    const result = await verifyTxReceipt({ ...good, allowedTo: ["0xnope"] }, reader(receipt()));
    expect(result.ok).toBe(false);
  });

  it("checks the inputs before reading the chain", async () => {
    const spy = vi.fn(async () => receipt());
    expect((await verifyTxReceipt({ ...good, txHash: "nonsense" }, spy)).ok).toBe(false);
    expect((await verifyTxReceipt({ ...good, wallet: "nonsense" }, spy)).ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("asks the chain for exactly the hash it was given", async () => {
    const spy = vi.fn(async () => receipt());
    await verifyTxReceipt(good, spy);
    expect(spy).toHaveBeenCalledWith(TX);
  });
});
