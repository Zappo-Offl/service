const { ethers } = require('ethers');
require('dotenv').config();

// Provider
const provider = new ethers.JsonRpcProvider(process.env.ARB_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc');
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Token addresses
const USDC = {
    address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    decimals: 6,
    symbol: 'USDC'
}

const WETH = {
    address: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
    decimals: 18,
    symbol: 'WETH'
}

// ERC20 ABI for balance checking
const ERC20_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)"
];

async function checkBalances() {
    try {
        const address = await signer.getAddress();
        console.log('📊 Checking balances for address:', address);
        console.log('----------------------------------------');

        // Check ETH balance (for gas)
        const ethBalance = await provider.getBalance(address);
        console.log(`ETH Balance: ${ethers.formatEther(ethBalance)} ETH`);

        // Check USDC balance
        const usdcContract = new ethers.Contract(USDC.address, ERC20_ABI, provider);
        const usdcBalance = await usdcContract.balanceOf(address);
        console.log(`USDC Balance: ${ethers.formatUnits(usdcBalance, USDC.decimals)} ${USDC.symbol}`);

        // Check WETH balance
        const wethContract = new ethers.Contract(WETH.address, ERC20_ABI, provider);
        const wethBalance = await wethContract.balanceOf(address);
        console.log(`WETH Balance: ${ethers.formatUnits(wethBalance, WETH.decimals)} ${WETH.symbol}`);

        console.log('----------------------------------------');

    } catch (error) {
        console.error('Error checking balances:', error.message);
    }
}

// Run the function
checkBalances().catch(console.error);