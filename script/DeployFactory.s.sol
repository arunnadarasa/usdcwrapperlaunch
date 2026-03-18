// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {USDCLauncherFactory} from "../src/USDCLauncherFactory.sol";

contract DeployFactoryScript is Script {
    function run() external {
        address usdc = vm.envAddress("USDC_ADDRESS");

        vm.startBroadcast();
        USDCLauncherFactory factory = new USDCLauncherFactory(usdc);
        vm.stopBroadcast();

        console2.log("FACTORY_ADDRESS", address(factory));
    }
}

