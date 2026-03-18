// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {USDCLauncherFactory} from "../src/USDCLauncherFactory.sol";

contract LaunchTokenScript is Script {
    function run() external {
        address factoryAddress = vm.envAddress("FACTORY_ADDRESS");
        string memory suffix = vm.envString("SUFFIX");
        uint256 initialUsdcAmount = vm.envUint("INITIAL_USDC_AMOUNT");
        address recipient = vm.envAddress("RECIPIENT");

        vm.startBroadcast();
        address token = USDCLauncherFactory(factoryAddress).launch(suffix, initialUsdcAmount, recipient);
        vm.stopBroadcast();

        console2.log("TOKEN_ADDRESS", token);
    }
}

