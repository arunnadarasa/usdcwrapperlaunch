// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// @title USDCBackedToken
/// @author Asura aka Angel of Indian Krump
/// @custom:website https://asura.lovable.app/ & https://siliconkrump.lovable.app/
/// @custom:initiative StreetKode Fam & Silicon Krump Initiative
/// @custom:credits StreetKode Fam: Asura, Hectik and Kronos
contract USDCBackedToken is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable usdc;
    address public immutable factory;

    uint8 private constant _DECIMALS = 6;

    error NotFactory();
    error AmountZero();

    event Deposit(address indexed from, address indexed to, uint256 amount);
    event Redeem(address indexed from, address indexed to, uint256 amount);

    constructor(string memory name_, string memory symbol_, address usdc_, address factory_) ERC20(name_, symbol_) {
        require(usdc_ != address(0), "USDC_ZERO");
        require(factory_ != address(0), "FACTORY_ZERO");
        usdc = usdc_;
        factory = factory_;
    }

    function decimals() public view virtual override returns (uint8) {
        return _DECIMALS;
    }

    /// @notice Mint wrapper tokens only during initial launch (factory creates the token + funds it with USDC).
    function mintTo(address to, uint256 amount) external {
        if (msg.sender != factory) revert NotFactory();
        _mint(to, amount);
    }

    /// @notice Deposit USDC to receive newly minted wrapper tokens.
    function deposit(uint256 amount, address to) public nonReentrant returns (uint256 minted) {
        if (amount == 0) revert AmountZero();

        IERC20(usdc).safeTransferFrom(msg.sender, address(this), amount);
        _mint(to, amount);

        emit Deposit(msg.sender, to, amount);
        return amount;
    }

    function deposit(uint256 amount) external returns (uint256 minted) {
        return deposit(amount, msg.sender);
    }

    /// @notice Burn wrapper tokens to redeem USDC from the token's backing balance.
    function redeem(uint256 amount, address to) public nonReentrant returns (uint256 withdrawn) {
        if (amount == 0) revert AmountZero();

        _burn(msg.sender, amount);
        IERC20(usdc).safeTransfer(to, amount);

        emit Redeem(msg.sender, to, amount);
        return amount;
    }

    function redeem(uint256 amount) external returns (uint256 withdrawn) {
        return redeem(amount, msg.sender);
    }

    /// @notice Returns the amount of USDC held by the token contract.
    function backingUSDC() external view returns (uint256) {
        return IERC20(usdc).balanceOf(address(this));
    }
}

