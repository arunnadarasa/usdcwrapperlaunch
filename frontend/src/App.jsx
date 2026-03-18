import { useEffect, useMemo, useState } from "react";
import { ConnectKitButton } from "connectkit";
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { decodeEventLog, formatUnits, isAddress, parseUnits } from "viem";

import "./App.css";

const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DEFAULT_FACTORY_ADDRESS = "0x0B7a34a6860261e5b0Fc559468CcF792E171a2A2";

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  }
];

const FACTORY_ABI = [
  {
    type: "function",
    name: "launch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "suffix", type: "string" },
      { name: "initialUsdcAmount", type: "uint256" },
      { name: "recipient", type: "address" }
    ],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "event",
    name: "Launched",
    anonymous: false,
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "suffix", type: "string", indexed: false },
      { name: "initialUsdcAmount", type: "uint256", indexed: false },
      { name: "recipient", type: "address", indexed: true }
    ]
  }
];

const WRAPPER_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" }
    ],
    outputs: [{ name: "minted", type: "uint256" }]
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" }
    ],
    outputs: [{ name: "withdrawn", type: "uint256" }]
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }]
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }]
  },
  {
    type: "function",
    name: "backingUSDC",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  }
];

function isLikelyAlnumSuffix(s) {
  if (typeof s !== "string") return false;
  if (s.length < 1 || s.length > 16) return false;
  return /^[A-Za-z0-9]+$/.test(s);
}

export default function App() {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();

  const [factoryAddress, setFactoryAddress] = useState(DEFAULT_FACTORY_ADDRESS);
  const [recipient, setRecipient] = useState("");
  const [suffix, setSuffix] = useState("Krump");
  const [initialUsdcAmountHuman, setInitialUsdcAmountHuman] = useState("1.00");
  const [backendVerifyUrl, setBackendVerifyUrl] = useState("");
  const [status, setStatus] = useState("");

  const LS_TOKENS_KEY = "usdc_backed_tokens_v1";
  const [tokens, setTokens] = useState([]);
  const [selectedToken, setSelectedToken] = useState("");

  const [mode, setMode] = useState("deposit"); // deposit | redeem | send

  const [depositAmountHuman, setDepositAmountHuman] = useState("1.00");
  const [depositRecipient, setDepositRecipient] = useState("");

  const [redeemAmountHuman, setRedeemAmountHuman] = useState("1.00");
  const [redeemRecipient, setRedeemRecipient] = useState("");

  const [sendAmountHuman, setSendAmountHuman] = useState("1.00");
  const [sendRecipient, setSendRecipient] = useState("");

  const [manualTokenAddress, setManualTokenAddress] = useState("");

  useEffect(() => {
    if (address && !recipient) setRecipient(address);
  }, [address, recipient]);

  // Load persisted token addresses for this browser (so the dashboard survives refresh).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_TOKENS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      setTokens(
        parsed
          .filter((t) => t && typeof t.address === "string")
          .map((t) => ({
            address: t.address,
            symbol: t.symbol || "",
            name: t.name || "",
            backingUSDC: typeof t.backingUSDC === "string" ? t.backingUSDC : t.backingUSDC ?? null
          }))
      );
    } catch {
      // If localStorage is corrupted, just ignore.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tokens.length === 0) return;
    if (!selectedToken) {
      setSelectedToken(tokens[0]?.address || "");
    }
  }, [tokens, selectedToken]);

  useEffect(() => {
    try {
      const serializable = tokens.map((t) => ({
        ...t,
        backingUSDC: typeof t.backingUSDC === "bigint" ? t.backingUSDC.toString() : t.backingUSDC
      }));
      localStorage.setItem(LS_TOKENS_KEY, JSON.stringify(serializable));
    } catch {
      // Ignore persistence errors (e.g. privacy mode).
    }
  }, [LS_TOKENS_KEY, tokens]);

  useEffect(() => {
    if (!address) return;
    if (!depositRecipient) setDepositRecipient(address);
    if (!redeemRecipient) setRedeemRecipient(address);
    if (!sendRecipient) setSendRecipient(address);
  }, [address, depositRecipient, redeemRecipient, sendRecipient]);

  const canLaunch = Boolean(address && walletClient && factoryAddress && recipient);

  const initialAmountStr = useMemo(() => initialUsdcAmountHuman, [initialUsdcAmountHuman]);

  async function fetchTokenMeta(tokenAddress) {
    const sym = await publicClient.readContract({
      address: tokenAddress,
      abi: WRAPPER_ABI,
      functionName: "symbol",
      args: []
    });
    const name = await publicClient.readContract({
      address: tokenAddress,
      abi: WRAPPER_ABI,
      functionName: "name",
      args: []
    });
    const backingUSDC = await publicClient.readContract({
      address: tokenAddress,
      abi: WRAPPER_ABI,
      functionName: "backingUSDC",
      args: []
    });

    return {
      address: tokenAddress,
      symbol: typeof sym === "string" ? sym : "",
      name: typeof name === "string" ? name : "",
      backingUSDC
    };
  }

  async function assertIsWrappedTokenContract(tokenAddress) {
    if (!isAddress(tokenAddress)) throw new Error("Token address is invalid.");
    const code = await publicClient.getCode({ address: tokenAddress });
    if (!code || code === "0x") {
      throw new Error("Selected token address is not a contract (did you paste your wallet address?).");
    }
    // Extra compatibility check: ensure the contract exposes `symbol()` and `backingUSDC()`.
    // (EOAs/non-compatible contracts will throw here.)
    await fetchTokenMeta(tokenAddress);
  }

  async function upsertToken(tokenAddress, { select = false } = {}) {
    const addrLower = tokenAddress.toLowerCase();
    const meta = await fetchTokenMeta(tokenAddress).catch(() => ({
      address: tokenAddress,
      symbol: "",
      name: "",
      backingUSDC: null
    }));

    setTokens((prev) => {
      const existsIdx = prev.findIndex((t) => t.address.toLowerCase() === addrLower);
      if (existsIdx >= 0) {
        const next = [...prev];
        next[existsIdx] = { ...next[existsIdx], ...meta };
        return next;
      }
      return [meta, ...prev];
    });

    if (select) setSelectedToken(tokenAddress);
  }

  async function handleAddManualToken() {
    setStatus("");
    try {
      if (!manualTokenAddress.trim()) throw new Error("Enter a token address.");
      const addr = manualTokenAddress.trim();
      if (!isAddress(addr)) throw new Error("Token address is invalid.");

      if (Number(chainId) !== Number(baseSepolia.id)) {
        await switchChainAsync({ chainId: baseSepolia.id });
      }

      await assertIsWrappedTokenContract(addr);

      await upsertToken(addr, { select: true });
      setStatus(`Added wrapped token to dashboard: ${addr}`);
    } catch (e) {
      setStatus(e?.message || String(e));
    }
  }

  function getAmountFromHuman(humanStr) {
    const s = String(humanStr ?? "").trim();
    if (!s) throw new Error("Enter an amount.");
    return parseUnits(s, 6);
  }

  async function handleDeposit() {
    setStatus("");
    try {
      if (!address || !walletClient) throw new Error("Connect wallet first.");
      if (!selectedToken) throw new Error("Select a token from the dashboard.");
      if (!isAddress(selectedToken)) throw new Error("Selected token address is invalid.");
      if (!isAddress(depositRecipient)) throw new Error("Recipient address is invalid.");

      await assertIsWrappedTokenContract(selectedToken);

      const amount = getAmountFromHuman(depositAmountHuman);
      if (amount === 0n) throw new Error("Amount must be greater than 0.");

      if (Number(chainId) !== Number(baseSepolia.id)) {
        await switchChainAsync({ chainId: baseSepolia.id });
      }

      const usdcBalance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address]
      });
      if (usdcBalance < amount) {
        const have = formatUnits(usdcBalance, 6);
        throw new Error(`Insufficient USDC balance. You have ${have} USDC.`);
      }

      const allowance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, selectedToken]
      });

      if (allowance < amount) {
        setStatus("Approving USDC for the wrapped token...");
        const approveHash = await walletClient.writeContract({
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [selectedToken, amount],
          gas: 1_500_000n
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
        // Re-check allowance after mining to avoid race conditions / wrong chain issues.
        const allowanceAfter = await publicClient.readContract({
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, selectedToken]
        });
        if (allowanceAfter < amount) {
          const have = formatUnits(allowanceAfter, 6);
          const want = formatUnits(amount, 6);
          throw new Error(`USDC allowance not updated. Have ${have}, need ${want}.`);
        }
      }

      setStatus("Depositing USDC into wrapped token...");
      const depositHash = await walletClient.writeContract({
        address: selectedToken,
        abi: WRAPPER_ABI,
        functionName: "deposit",
        args: [amount, depositRecipient],
        gas: 5_000_000n
      });
      await publicClient.waitForTransactionReceipt({ hash: depositHash });

      setStatus(
        `Deposited ${depositAmountHuman} USDC -> wrapped token for ${depositRecipient}.\nDeposit tx: ${depositHash}`
      );
      await upsertToken(selectedToken);
    } catch (e) {
      const msg =
        e?.shortMessage ||
        e?.cause?.shortMessage ||
        e?.reason ||
        e?.message ||
        String(e);
      setStatus(msg);
    }
  }

  async function handleRedeem() {
    setStatus("");
    try {
      if (!address || !walletClient) throw new Error("Connect wallet first.");
      if (!selectedToken) throw new Error("Select a token from the dashboard.");
      if (!isAddress(selectedToken)) throw new Error("Selected token address is invalid.");
      if (!isAddress(redeemRecipient)) throw new Error("Recipient address is invalid.");

      await assertIsWrappedTokenContract(selectedToken);

      const amount = getAmountFromHuman(redeemAmountHuman);
      if (amount === 0n) throw new Error("Amount must be greater than 0.");

      if (Number(chainId) !== Number(baseSepolia.id)) {
        await switchChainAsync({ chainId: baseSepolia.id });
      }

      const wrappedBalance = await publicClient.readContract({
        address: selectedToken,
        abi: WRAPPER_ABI,
        functionName: "balanceOf",
        args: [address]
      });
      if (wrappedBalance < amount) {
        const have = formatUnits(wrappedBalance, 6);
        throw new Error(`Insufficient wrapped token balance. You have ${have}.`);
      }

      setStatus("Redeeming wrapped token back to USDC...");
      const redeemHash = await walletClient.writeContract({
        address: selectedToken,
        abi: WRAPPER_ABI,
        functionName: "redeem",
        args: [amount, redeemRecipient],
        gas: 5_000_000n
      });
      await publicClient.waitForTransactionReceipt({ hash: redeemHash });

      setStatus(
        `Redeemed ${redeemAmountHuman} wrapped token -> USDC for ${redeemRecipient}.\nRedeem tx: ${redeemHash}`
      );
      await upsertToken(selectedToken);
    } catch (e) {
      const msg =
        e?.shortMessage ||
        e?.cause?.shortMessage ||
        e?.reason ||
        e?.message ||
        String(e);
      setStatus(msg);
    }
  }

  async function handleSendWrapped() {
    setStatus("");
    try {
      if (!address || !walletClient) throw new Error("Connect wallet first.");
      if (!selectedToken) throw new Error("Select a token from the dashboard.");
      if (!isAddress(selectedToken)) throw new Error("Selected token address is invalid.");
      if (!isAddress(sendRecipient)) throw new Error("Recipient address is invalid.");

      await assertIsWrappedTokenContract(selectedToken);

      const amount = getAmountFromHuman(sendAmountHuman);
      if (amount === 0n) throw new Error("Amount must be greater than 0.");

      if (Number(chainId) !== Number(baseSepolia.id)) {
        await switchChainAsync({ chainId: baseSepolia.id });
      }

      const wrappedBalance = await publicClient.readContract({
        address: selectedToken,
        abi: WRAPPER_ABI,
        functionName: "balanceOf",
        args: [address]
      });
      if (wrappedBalance < amount) {
        const have = formatUnits(wrappedBalance, 6);
        throw new Error(`Insufficient wrapped token balance. You have ${have}.`);
      }

      setStatus("Sending wrapped tokens...");
      const sendHash = await walletClient.writeContract({
        address: selectedToken,
        abi: WRAPPER_ABI,
        functionName: "transfer",
        args: [sendRecipient, amount],
        gas: 1_500_000n
      });
      await publicClient.waitForTransactionReceipt({ hash: sendHash });

      setStatus(`Sent ${sendAmountHuman} wrapped token to ${sendRecipient}.\nTx: ${sendHash}`);
      await upsertToken(selectedToken);
    } catch (e) {
      const msg =
        e?.shortMessage ||
        e?.cause?.shortMessage ||
        e?.reason ||
        e?.message ||
        String(e);
      setStatus(msg);
    }
  }

  async function handleLaunch() {
    setStatus("");
    try {
      if (!address || !walletClient) throw new Error("Connect wallet first.");

      const f = factoryAddress.trim();
      const r = recipient.trim();
      const s = suffix.trim();

      if (!isAddress(f)) throw new Error("Factory address is invalid.");
      if (!isAddress(r)) throw new Error("Recipient address is invalid.");
      if (!isLikelyAlnumSuffix(s)) {
        throw new Error("Suffix must be 1..16 chars and alphanumeric only.");
      }
      if (!initialAmountStr.trim()) throw new Error("Enter an initial USDC amount.");

      const initialUsdcAmount = parseUnits(initialAmountStr, 6);

      if (Number(chainId) !== Number(baseSepolia.id)) {
        await switchChainAsync({ chainId: baseSepolia.id });
      }

      // Preflight: avoid sending a tx that will revert due to insufficient USDC.
      const usdcBalance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address]
      });
      if (usdcBalance < initialUsdcAmount) {
        const have = formatUnits(usdcBalance, 6);
        const want = initialAmountStr;
        throw new Error(`Insufficient USDC balance. You have ${have} USDC, but attempted ${want}.`);
      }

      setStatus("Approving USDC to factory...");
      const approveHash = await walletClient.writeContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [f, initialUsdcAmount],
        // Explicit gas limit avoids bad gas estimation from some RPCs.
        // Approval is cheap, so keep this modest.
        gas: 1_500_000n
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      setStatus("Launching wrapper token...");
      const launchHash = await walletClient.writeContract({
        address: f,
        abi: FACTORY_ABI,
        functionName: "launch",
        args: [s, initialUsdcAmount, r],
        // Must be below the chain's per-tx maximum gas limit.
        // If this is too high, the node rejects with "exceeds max transaction gas limit".
        gas: 15_000_000n
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: launchHash });

      // Robustly decode `Launched` from any log in the receipt.
      // Some receipt implementations may not include `log.address`, so matching by address
      // can fail even when the event exists.
      let tokenAddress = "";
      for (const log of receipt.logs) {
        if (!log || !log.data || !log.topics) continue;
        try {
          const decoded = decodeEventLog({
            abi: FACTORY_ABI,
            eventName: "Launched",
            data: log.data,
            topics: log.topics
          });
          tokenAddress = decoded?.args?.token || "";
          if (tokenAddress) break;
        } catch {
          // Ignore non-matching logs
        }
      }

      if (!tokenAddress) throw new Error("Launched event log not found in receipt.");

      setStatus(`Launched token: ${tokenAddress}\nUSDC->token mint amount: ${initialAmountStr}.\n`);
      await upsertToken(tokenAddress, { select: true });

      if (backendVerifyUrl.trim()) {
        setStatus(`Requesting verification at backend...\nToken: ${tokenAddress}`);

        const verifyResp = await fetch(backendVerifyUrl.trim(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tokenAddress, suffix: s, factoryAddress: f })
        });

        const data = await verifyResp.json().catch(() => ({}));
        if (!verifyResp.ok) {
          throw new Error(
            `Verification request failed: ${verifyResp.status} ${verifyResp.statusText}`
          );
        }

        setStatus(
          `Launched token: ${tokenAddress}\nVerification response:\n${JSON.stringify(
            data,
            null,
            2
          )}`
        );
      }
    } catch (e) {
      setStatus(e?.message || String(e));
    }
  }

  return (
    <div className="page">
      <h1>USDC-backed Token Launcher (Base Sepolia)</h1>

      <div className="card">
        <h2>Wallet</h2>
        <ConnectKitButton />
        <div className="muted">
          {address ? `Connected: ${address}` : "Not connected"}
          {chainId ? ` | ChainId: ${chainId}` : ""}
        </div>
      </div>

      <div className="card">
        <h2>Launch new wrapper token</h2>

        <label className="field">
          <span>Factory Address</span>
          <input
            className="input"
            value={factoryAddress}
            onChange={(e) => setFactoryAddress(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Recipient (mint initial tokens to)</span>
          <input
            className="input"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x..."
          />
        </label>

        <label className="field">
          <span>Suffix (e.g., Krump, IKF) - alnum, length 1..16</span>
          <input className="input" value={suffix} onChange={(e) => setSuffix(e.target.value)} />
        </label>

        <label className="field">
          <span>Initial USDC Amount (human, e.g., 1.25)</span>
          <input
            className="input"
            value={initialUsdcAmountHuman}
            onChange={(e) => setInitialUsdcAmountHuman(e.target.value)}
          />
        </label>

        <button className="btn primary" disabled={!canLaunch} onClick={handleLaunch}>
          Approve USDC &amp; Launch
        </button>

        <pre className="status">{status}</pre>
      </div>

      <div className="card">
        <h2>Deployed Tokens (Dashboard)</h2>
        <p className="muted">Tokens launched from this browser are saved locally.</p>

        {tokens.length === 0 ? (
          <div className="muted">No tokens yet. Launch one above to see it here.</div>
        ) : (
          <>
            <label className="field">
              <span>Selected token</span>
              <select
                className="input"
                value={selectedToken}
                onChange={(e) => setSelectedToken(e.target.value)}
              >
                {tokens.map((t) => (
                  <option key={t.address} value={t.address}>
                    {t.symbol ? t.symbol : t.address.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>

            <div className="tokenGrid">
              {tokens.map((t) => {
                const isSelected = t.address.toLowerCase() === selectedToken.toLowerCase();
                let backing = "";
                try {
                  if (t.backingUSDC !== null && t.backingUSDC !== undefined && String(t.backingUSDC).trim() !== "") {
                    backing = formatUnits(BigInt(String(t.backingUSDC)), 6);
                  }
                } catch {
                  // ignore formatting errors
                }
                return (
                  <div
                    key={t.address}
                    className={`tokenCard ${isSelected ? "tokenCardSelected" : ""}`}
                  >
                    <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>
                          {t.symbol || t.name || "Wrapped Token"}
                        </div>
                        <div className="muted" style={{ wordBreak: "break-word" }}>
                          {t.address}
                        </div>
                      </div>
                      <div className="muted" style={{ textAlign: "right" }}>
                        {backing ? `Backed: ${backing} USDC` : ""}
                      </div>
                    </div>
                    <div className="muted" style={{ marginTop: 6 }}>
                      Choose this token to exchange/send below.
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="sectionSpacer" />
        <h3 className="sectionTitle">
          Add token by address
        </h3>
        <label className="field">
          <span>Wrapped token address (0x...)</span>
          <input
            className="input"
            value={manualTokenAddress}
            onChange={(e) => setManualTokenAddress(e.target.value)}
            placeholder="0x25D923fB298D6c0cbE6F1F3724654D6E7fD63B63"
          />
        </label>
        <button className="btn" onClick={handleAddManualToken} disabled={!manualTokenAddress.trim()}>
          Add to dashboard
        </button>
      </div>

      <div className="card">
        <h2>Exchange / Send</h2>
        <p className="muted">Convert between USDC and the wrapped token, or send wrapped tokens to another wallet.</p>

        <div className="modeTabs">
          <button
            className={`btn modeBtn ${mode === "deposit" ? "primary" : ""}`}
            onClick={() => setMode("deposit")}
            disabled={!selectedToken}
          >
            USDC -&gt; Wrapped
          </button>
          <button
            className={`btn modeBtn ${mode === "redeem" ? "primary" : ""}`}
            onClick={() => setMode("redeem")}
            disabled={!selectedToken}
          >
            Wrapped -&gt; USDC
          </button>
          <button
            className={`btn modeBtn ${mode === "send" ? "primary" : ""}`}
            onClick={() => setMode("send")}
            disabled={!selectedToken}
          >
            Send Wrapped
          </button>
        </div>

        {!selectedToken ? (
          <div className="muted">Select a token in the dashboard first.</div>
        ) : (
          <>
            {mode === "deposit" && (
              <div style={{ display: "grid", gap: 12 }}>
                <label className="field">
                  <span>USDC amount (human)</span>
                  <input
                    className="input"
                    value={depositAmountHuman}
                    onChange={(e) => setDepositAmountHuman(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Recipient (mint wrapped tokens to)</span>
                  <input
                    className="input"
                    value={depositRecipient}
                    onChange={(e) => setDepositRecipient(e.target.value)}
                    placeholder="0x..."
                  />
                </label>
                <button className="btn primary" onClick={handleDeposit}>
                  Deposit &amp; Mint
                </button>
              </div>
            )}

            {mode === "redeem" && (
              <div style={{ display: "grid", gap: 12 }}>
                <label className="field">
                  <span>Wrapped amount (human)</span>
                  <input
                    className="input"
                    value={redeemAmountHuman}
                    onChange={(e) => setRedeemAmountHuman(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>USDC recipient</span>
                  <input
                    className="input"
                    value={redeemRecipient}
                    onChange={(e) => setRedeemRecipient(e.target.value)}
                    placeholder="0x..."
                  />
                </label>
                <button className="btn primary" onClick={handleRedeem}>
                  Redeem &amp; Withdraw USDC
                </button>
              </div>
            )}

            {mode === "send" && (
              <div style={{ display: "grid", gap: 12 }}>
                <label className="field">
                  <span>Wrapped amount (human)</span>
                  <input
                    className="input"
                    value={sendAmountHuman}
                    onChange={(e) => setSendAmountHuman(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Recipient wallet</span>
                  <input
                    className="input"
                    value={sendRecipient}
                    onChange={(e) => setSendRecipient(e.target.value)}
                    placeholder="0x..."
                  />
                </label>
                <button className="btn primary" onClick={handleSendWrapped}>
                  Send Wrapped Tokens
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>Optional: automatic verification</h2>
        <p className="muted">Calls your backend endpoint to run BaseScan/Etherscan verification.</p>
        <label className="field">
          <span>Backend Verify URL</span>
          <input
            className="input"
            value={backendVerifyUrl}
            onChange={(e) => setBackendVerifyUrl(e.target.value)}
            placeholder="http://localhost:3001/api/verify"
          />
        </label>
      </div>
    </div>
  );
}
