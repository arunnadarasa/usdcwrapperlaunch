const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3001;

// Base Sepolia constants (matches your Solidity deployment targets)
const CHAIN_ID = process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : 84532;
const USDC_ADDRESS = process.env.USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const BASESCAN_V2_API_URL =
  process.env.BASESCAN_V2_API_URL ||
  `https://api.etherscan.io/v2/api?chainid=${CHAIN_ID}`;

const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;

function requireEnv(name) {
  if (!process.env[name] || String(process.env[name]).trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
}

requireEnv("ETHERSCAN_API_KEY");

const USDC_TOKEN_CONTRACT = "src/USDCBackedToken.sol:USDCBackedToken";

// We derive verification payload pieces from the locally compiled artifacts:
// - Build-info `input` contains the standard-json `sources[*].content` we need.
// - Contract artifact `rawMetadata` contains the exact `compiler.version` commit string.
const COMPILER_METADATA_ARTIFACT_PATH =
  process.env.COMPILER_METADATA_ARTIFACT_PATH ||
  path.resolve(__dirname, "../out/USDCBackedToken.sol/USDCBackedToken.json");

const BUILD_INFO_PATH =
  process.env.BUILD_INFO_PATH ||
  path.resolve(__dirname, "../out/build-info");

let cachedStandardJson = null;

function loadStandardJsonFromBuildInfo() {
  if (cachedStandardJson) return cachedStandardJson;

  if (!fs.existsSync(COMPILER_METADATA_ARTIFACT_PATH)) {
    throw new Error(
      `Missing compiler-metadata artifact. Expected file at: ${COMPILER_METADATA_ARTIFACT_PATH}\n` +
        `Deploy/compile first, or set COMPILER_METADATA_ARTIFACT_PATH to a valid artifact file.`
    );
  }

  const artifact = JSON.parse(fs.readFileSync(COMPILER_METADATA_ARTIFACT_PATH, "utf8"));
  if (!artifact.rawMetadata) throw new Error("Artifact missing `rawMetadata`; cannot extract compiler version.");
  const rawMeta = JSON.parse(artifact.rawMetadata);
  const compilerVersion = rawMeta.compiler?.version;
  if (!compilerVersion) throw new Error("rawMetadata missing compiler.version");
  const compilerversion = compilerVersion.startsWith("v") ? compilerVersion : `v${compilerVersion}`;

  let buildInfoFile = BUILD_INFO_PATH;
  const stats = fs.statSync(BUILD_INFO_PATH);
  if (stats.isDirectory()) {
    const files = fs.readdirSync(BUILD_INFO_PATH).filter((f) => f.endsWith(".json"));
    if (files.length === 0) {
      throw new Error(`No build-info json files found in directory: ${BUILD_INFO_PATH}`);
    }
    // Best-effort: if there's multiple files, we take the first one.
    buildInfoFile = path.join(BUILD_INFO_PATH, files[0]);
  }

  if (!fs.existsSync(buildInfoFile)) {
    throw new Error(`Missing build-info file: ${buildInfoFile}`);
  }

  const buildInfo = JSON.parse(fs.readFileSync(buildInfoFile, "utf8"));
  const input = buildInfo.input;
  if (!input || !input.language || !input.sources || !input.settings) {
    throw new Error("build-info missing `input` with language/sources/settings.");
  }

  const optimizationUsed = input.settings?.optimizer?.enabled ? 1 : 0;
  const runs = input.settings?.optimizer?.runs ?? 0;
  const evmVersion = input.settings?.evmVersion;

  // BaseScan expects standard-json input in `sourceCode`.
  // We compress to exactly what BaseScan needs: { language, sources, settings }.
  const sourceCode = JSON.stringify({ language: input.language, sources: input.sources, settings: input.settings });

  cachedStandardJson = {
    sourceCode,
    compilerversion,
    optimizationUsed,
    runs,
    evmVersion,
    contractname: USDC_TOKEN_CONTRACT
  };

  return cachedStandardJson;
}

function buildConstructorArgs({ suffix, factoryAddress }) {
  const name = `USDC ${suffix}`;
  const symbol = `USDC.${suffix}`;
  // constructor(string name_, string symbol_, address usdc_, address factory_)
  const abiCoder = ethers.utils.defaultAbiCoder;
  return abiCoder.encode(
    ["string", "string", "address", "address"],
    [name, symbol, USDC_ADDRESS, factoryAddress]
  );
}

function buildCheckUrl({ apiKey, guid }) {
  const url = new URL(BASESCAN_V2_API_URL);
  url.searchParams.set("module", "contract");
  url.searchParams.set("action", "checkverifystatus");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("guid", guid);
  return url.toString();
}

async function submitVerification({ tokenAddress, suffix, factoryAddress }) {
  const { sourceCode, compilerversion, optimizationUsed, runs, evmVersion, contractname } =
    loadStandardJsonFromBuildInfo();

  const constructorArgs = buildConstructorArgs({ suffix, factoryAddress });
  // BaseScan v2 wants hex args without 0x prefix.
  const encodedConstructor = constructorArgs.startsWith("0x") ? constructorArgs.slice(2) : constructorArgs;

  const postParams = new URLSearchParams();
  postParams.set("apikey", ETHERSCAN_API_KEY);
  postParams.set("module", "contract");
  postParams.set("action", "verifysourcecode");
  postParams.set("contractaddress", tokenAddress);
  postParams.set("compilerversion", compilerversion);
  postParams.set("optimizationUsed", String(optimizationUsed));
  postParams.set("runs", String(runs));
  postParams.set("constructorArguements", encodedConstructor);
  postParams.set("codeformat", "solidity-standard-json-input");
  postParams.set("sourceCode", sourceCode);
  postParams.set("contractname", contractname);
  if (evmVersion) postParams.set("evmversion", evmVersion);

  const resp = await fetch(BASESCAN_V2_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: postParams.toString()
  });

  const data = await resp.json();
  if (!data || data.status !== "1" || !data.result) {
    throw new Error(`BaseScan v2 verification submission failed: ${resp.status} ${resp.statusText}\n${JSON.stringify(data)}`);
  }

  return data.result; // GUID
}

async function checkVerificationStatus({ guid }) {
  const maxAttempts = 18; // ~90 seconds with 5s delay
  const delayMs = 5000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const checkUrl = buildCheckUrl({ apiKey: ETHERSCAN_API_KEY, guid });
    const resp = await fetch(checkUrl, { method: "GET" });
    const data = await resp.json();

    if (data && data.status === "1") {
      const msg = data.result || "";
      if (msg.includes("Pass") || msg.includes("Pass -") || msg.includes("Pass:") || msg.includes("Successfully") || msg.includes("already verified")) {
        return { verified: true, message: msg };
      }
      if (msg.includes("Pending") || msg.includes("Pending in queue")) {
        // wait and retry
      } else if (msg.includes("Fail") || msg.includes("Error")) {
        return { verified: false, message: msg };
      } else {
        // unknown status: retry
      }
    } else {
      const msg = data?.message || data?.result || "Unknown status";
      return { verified: false, message: msg };
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return { verified: false, message: "Pending (timed out polling)" };
}

app.post("/api/verify", async (req, res) => {
  try {
    const { tokenAddress, suffix, factoryAddress } = req.body || {};

    if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
      return res.status(400).json({ ok: false, error: "Invalid tokenAddress" });
    }
    if (!factoryAddress || !ethers.isAddress(factoryAddress)) {
      return res.status(400).json({ ok: false, error: "Invalid factoryAddress" });
    }
    if (typeof suffix !== "string" || suffix.length === 0 || suffix.length > 16 || !/^[A-Za-z0-9]+$/.test(suffix)) {
      return res.status(400).json({ ok: false, error: "Invalid suffix (must be alnum, length 1..16)" });
    }

    const verifyStarted = new Date().toISOString();
    const guid = await submitVerification({ tokenAddress, suffix, factoryAddress });
    const status = await checkVerificationStatus({ guid });
    const verifiedLink = `https://sepolia.basescan.org/address/${tokenAddress}#code`;

    return res.json({
      ok: true,
      tokenAddress,
      suffix,
      factoryAddress,
      verifiedLink,
      verifyStarted,
      verifyFinished: new Date().toISOString(),
      guid,
      status
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`USDC verifier backend listening on http://localhost:${PORT}`);
});

