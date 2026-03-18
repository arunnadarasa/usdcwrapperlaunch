// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Test} from "forge-std/Test.sol";

import {MockUSDC} from "./mocks/MockUSDC.sol";
import {USDCLauncherFactory} from "../src/USDCLauncherFactory.sol";
import {USDCBackedToken} from "../src/USDCBackedToken.sol";

contract USDCBackedTokenTest is Test {
    MockUSDC internal usdc;
    USDCLauncherFactory internal factory;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xC0B0);

    function setUp() public {
        usdc = new MockUSDC();
        factory = new USDCLauncherFactory(address(usdc));
    }

    function test_launchMintsAndBacks() public {
        uint256 initial = 1_000e6;

        usdc.mint(alice, initial);
        vm.startPrank(alice);
        usdc.approve(address(factory), initial);
        address tokenAddr = factory.launch("Krump", initial, bob);
        vm.stopPrank();

        USDCBackedToken token = USDCBackedToken(tokenAddr);

        assertEq(token.name(), "USDC Krump");
        assertEq(token.symbol(), "USDC.Krump");
        assertEq(token.decimals(), 6);

        assertEq(token.balanceOf(bob), initial);
        assertEq(token.backingUSDC(), initial);
    }

    function test_depositAndRedeem() public {
        uint256 initial = 500e6;
        uint256 depositAmount = 250e6;
        uint256 redeemAmount = 200e6;

        // Initial launch into `bob`
        usdc.mint(alice, initial);
        vm.startPrank(alice);
        usdc.approve(address(factory), initial);
        address tokenAddr = factory.launch("IKF", initial, bob);
        vm.stopPrank();

        USDCBackedToken token = USDCBackedToken(tokenAddr);
        assertEq(token.balanceOf(bob), initial);

        // Deposit: bob deposits USDC and receives wrapper tokens to bob
        usdc.mint(bob, depositAmount);
        vm.startPrank(bob);
        usdc.approve(address(token), depositAmount);
        token.deposit(depositAmount);
        vm.stopPrank();

        assertEq(token.balanceOf(bob), initial + depositAmount);
        assertEq(token.backingUSDC(), initial + depositAmount);

        // Redeem: bob burns wrapper tokens and receives USDC back
        uint256 usdcBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        token.redeem(redeemAmount);

        assertEq(token.balanceOf(bob), initial + depositAmount - redeemAmount);
        assertEq(usdc.balanceOf(bob), usdcBefore + redeemAmount);
        assertEq(token.backingUSDC(), initial + depositAmount - redeemAmount);
    }

    function test_mintToRevertsForNonFactory() public {
        uint256 initial = 100e6;

        usdc.mint(alice, initial);
        vm.startPrank(alice);
        usdc.approve(address(factory), initial);
        address tokenAddr = factory.launch("Krump", initial, bob);
        vm.stopPrank();

        USDCBackedToken token = USDCBackedToken(tokenAddr);

        vm.startPrank(carol);
        vm.expectRevert(abi.encodeWithSelector(USDCBackedToken.NotFactory.selector));
        token.mintTo(carol, 1e6);
        vm.stopPrank();
    }

    function test_depositZeroReverts() public {
        uint256 initial = 100e6;

        usdc.mint(alice, initial);
        vm.startPrank(alice);
        usdc.approve(address(factory), initial);
        address tokenAddr = factory.launch("Krump", initial, bob);
        vm.stopPrank();

        USDCBackedToken token = USDCBackedToken(tokenAddr);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(USDCBackedToken.AmountZero.selector));
        token.deposit(0);
    }

    function test_launchRejectsInvalidSuffix() public {
        uint256 initial = 100e6;
        usdc.mint(alice, initial);

        vm.startPrank(alice);
        usdc.approve(address(factory), initial);
        vm.expectRevert(abi.encodeWithSelector(USDCLauncherFactory.InvalidSuffix.selector));
        factory.launch("K-rump", initial, bob);
        vm.stopPrank();
    }

    function test_launchRejectsTooLongSuffix() public {
        uint256 initial = 100e6;
        usdc.mint(alice, initial);

        vm.startPrank(alice);
        usdc.approve(address(factory), initial);
        vm.expectRevert(abi.encodeWithSelector(USDCLauncherFactory.InvalidSuffix.selector));
        factory.launch("ABCDEFGHIJKLMNOPQ", initial, bob); // 17 chars
        vm.stopPrank();
    }
}

