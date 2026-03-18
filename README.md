## USDC-backed Token Launcher (Base Sepolia)

This project deploys a factory that lets users launch new 1:1 USDC-backed ERC20 wrapper tokens on **Base Sepolia**.

On-chain behavior:
- `USDCLauncherFactory.launch(suffix, initialUsdcAmount, recipient)` deploys a new wrapper token whose:
  - `name` is `USDC <suffix>` (e.g. `USDC Krump`)
  - `symbol` is `USDC.<suffix>` (e.g. `USDC.Krump`)
- The caller must approve the factory to spend `initialUsdcAmount` of Base Sepolia USDC.
- The factory funds the wrapper with the deposited USDC and mints `initialUsdcAmount` wrapper tokens to `recipient`.
- Users can later `deposit()` (mint more) and `redeem()` (burn wrapper tokens to withdraw USDC).

Base Sepolia USDC:
- `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

Credits/NatSpec:
- The `USDCBackedToken` and factory contracts embed the `@author` and `@custom:*` metadata so it appears after successful BaseScan/Etherscan verification.

## Build & Tests

```shell
forge test
```

## Deployment / Launch

1. Set env vars (see `.env.example`).
2. Deploy the factory (only once):

```shell
export $(grep -v '^#' .env.example | xargs)   # optional convenience
forge script script/DeployFactory.s.sol:DeployFactoryScript --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --broadcast
```

Copy the printed `FACTORY_ADDRESS`.

3. Launch a new token + verify its wrapper contract:

```shell
export $(grep -v '^#' .env.example | xargs)   # optional convenience
export SUFFIX="Krump"
export INITIAL_USDC_AMOUNT="1000000"  # 1.0 USDC (6 decimals)
export RECIPIENT="0xYourAddress"
export FACTORY_ADDRESS="0xYourFactoryAddress"

./scripts/launch-and-verify.sh
```

BaseScan verification uses the BaseScan v2 API endpoint under the hood and sets constructor args using the known constructor signature:
`constructor(string name_, string symbol_, address usdc_, address factory_)`

## Token Usage

- `deposit(uint256 amount)`:
  - Caller approves the wrapper token contract to spend USDC, then calls `deposit(amount)`.
  - Wrapper mints `amount` tokens to the caller.

- `deposit(uint256 amount, address to)` (deposit on behalf):
  - Caller approves the wrapper token contract to spend USDC, then calls `deposit(amount, to)`.
  - Wrapper mints `amount` tokens to `to`.

- `redeem(uint256 amount)`:
  - Caller burns `amount` wrapper tokens and receives `amount` USDC.

## Frontend (custom suffix launch)

This repo includes:
- `frontend/`: a React/Vite UI using MetaMask SDK best-practice (`ConnectKit + Wagmi`) to let a connected wallet choose `suffix` + initial USDC amount and call `USDCLauncherFactory.launch(...)`.
- `backend/`: an optional Express endpoint that verifies the newly deployed wrapper token on BaseScan v2 by calling the Etherscan-compatible v2 verification API directly (so the `@custom:*` NatSpec metadata appears after verification).

### 1) Deploy the factory

Follow the existing steps in the README to deploy `USDCLauncherFactory` once, and set `FACTORY_ADDRESS`.

### 2) Start verification backend (optional, but required for “credits” to appear after launch)

Note: the backend needs the local build artifacts for standard-json verification:
- `out/build-info/*.json` (must include `input.sources[*].content`)
- `out/USDCBackedToken.sol/USDCBackedToken.json` (for the exact solc commit string)

```shell
cd backend
npm install
cp .env.example .env
edit .env (set `RPC_URL` and `ETHERSCAN_API_KEY`)
npm start
```

Backend default URL: `http://localhost:3001/api/verify`

### 3) Launch from the frontend UI

Start the frontend locally:

```shell
cd frontend
cp .env.example .env
npm install
npm run dev
```

Then open the printed `http://localhost:<port>/`.

In the UI:
1. Paste/confirm the `Factory Address` (defaults to your deployed factory)
2. Paste a `Recipient` (or leave blank; connect wallet sets default)
3. Enter `Suffix` (alnum, 1..16)
4. Enter `Initial USDC Amount` in human units (USDC has 6 decimals on Base)
5. (Optional) Set `Backend Verify URL` if you started the backend
6. Click `Approve USDC & Launch`


