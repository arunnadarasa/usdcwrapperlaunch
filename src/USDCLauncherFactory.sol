// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";

import {USDCBackedToken} from "./USDCBackedToken.sol";

/// @title USDCLauncherFactory
/// @author Asura aka Angel of Indian Krump
/// @custom:website https://asura.lovable.app/ & https://siliconkrump.lovable.app/
/// @custom:initiative StreetKode Fam & Silicon Krump Initiative
/// @custom:credits StreetKode Fam: Asura, Hectik and Kronos
contract USDCLauncherFactory {
    using SafeERC20 for IERC20;

    address public immutable usdc;

    error RecipientZero();
    error AmountZero();
    error InvalidSuffix();

    event Launched(
        address indexed token,
        address indexed creator,
        string suffix,
        uint256 initialUsdcAmount,
        address indexed recipient
    );

    constructor(address usdc_) {
        require(usdc_ != address(0), "USDC_ZERO");
        usdc = usdc_;
    }

    /// @notice Deploys a new 1:1 USDC-backed ERC20 wrapper token for a given suffix.
    /// @dev Users must have approved this factory to spend `initialUsdcAmount` USDC.
    function launch(
        string calldata suffix,
        uint256 initialUsdcAmount,
        address recipient
    ) external returns (address token) {
        if (recipient == address(0)) revert RecipientZero();
        if (initialUsdcAmount == 0) revert AmountZero();
        bytes memory s = bytes(suffix);
        if (s.length == 0 || s.length > 16) revert InvalidSuffix();
        for (uint256 i = 0; i < s.length; i++) {
            uint8 c = uint8(s[i]);
            // [A-Z][a-z][0-9]
            bool ok = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
            if (!ok) revert InvalidSuffix();
        }

        string memory name = string.concat("USDC ", suffix);
        string memory symbol = string.concat("USDC.", suffix);

        USDCBackedToken newToken = new USDCBackedToken(name, symbol, usdc, address(this));

        IERC20(usdc).safeTransferFrom(msg.sender, address(newToken), initialUsdcAmount);
        newToken.mintTo(recipient, initialUsdcAmount);

        emit Launched(address(newToken), msg.sender, suffix, initialUsdcAmount, recipient);
        return address(newToken);
    }
}

