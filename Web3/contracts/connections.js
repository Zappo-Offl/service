const { ethers } = require('ethers');
require('dotenv').config();

// Setup
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ZAPPO_CONTRACT_ADDRESS = '0x3ec1F818E761ccF530881F5139d48315339e3FA7';
const RPC_URL = process.env.ARB_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc';

// Create provider and wallet
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// Contract ABIs
const ZAPPO_ABI = [
    "function deposit(uint256 amount) external returns (bytes32)",
    "function withdraw(uint256 tokenAmount) external returns (bytes32)",
    "function balanceOf(address account) external view returns (uint256)"
];

const USDC_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)",
    "function allowance(address owner, address spender) external view returns (uint256)"
];

// Contract instances
const usdcAddress = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
const usdc = new ethers.Contract(usdcAddress, USDC_ABI, wallet);
const zappo = new ethers.Contract(ZAPPO_CONTRACT_ADDRESS, ZAPPO_ABI, wallet);

// Deposit function
async function deposit(amount) {
    try {
        console.log(`Depositing ${amount} USDC...`);
        
        // Convert amount (USDC has 6 decimals)
        const amountWei = ethers.parseUnits(amount.toString(), 6);
        
        // Check balance
        const balance = await usdc.balanceOf(wallet.address);
        if (balance < amountWei) {
            throw new Error(`Not enough USDC. You have: ${ethers.formatUnits(balance, 6)}`);
        }
        
        // Approve
        const allowance = await usdc.allowance(wallet.address, ZAPPO_CONTRACT_ADDRESS);
        if (allowance < amountWei) {
            console.log("Approving USDC...");
            const approveTx = await usdc.approve(ZAPPO_CONTRACT_ADDRESS, amountWei);
            await approveTx.wait();
        }
        
        // Deposit
        const tx = await zappo.deposit(amountWei);
        console.log("Transaction sent:", tx.hash);
        
        await tx.wait();
        console.log("Deposit successful!");
        
    } catch (error) {
        console.log("Deposit failed:", error.message);
    }
}

// Withdraw function - withdraw ALL ZAPPO tokens
async function withdraw() {
    try {
        console.log(`Withdrawing ALL ZAPPO tokens...`);
        
        // Check ZAPPO balance
        const balance = await zappo.balanceOf(wallet.address);
        const balanceFormatted = ethers.formatUnits(balance, 18);
        
        console.log(`ZAPPO Balance: ${balanceFormatted}`);
        
        if (balance === 0n) {
            throw new Error(`No ZAPPO tokens to withdraw`);
        }
        
        // Withdraw ALL ZAPPO tokens
        const tx = await zappo.withdraw(balance);
        console.log("Transaction sent:", tx.hash);
        
        await tx.wait();
        console.log("Withdrawal successful!");
        
    } catch (error) {
        console.log("Withdrawal failed:", error.message);
    }
}

// Check balances
async function checkBalances() {
    try {
        const usdcBalance = await usdc.balanceOf(wallet.address);
        const zappoBalance = await zappo.balanceOf(wallet.address);
        
        console.log("USDC Balance:", ethers.formatUnits(usdcBalance, 6));
        console.log("ZAPPO Balance:", ethers.formatUnits(zappoBalance, 18));
        
    } catch (error) {
        console.log("Balance check failed:", error.message);
    }
}

async function testDepositAndWithdraw() {
    console.log("🧪 Starting Deposit & Withdraw Test");
    console.log("====================================");
    console.log("Wallet:", wallet.address);
    
    // Check initial balances
    console.log("\n📊 Initial Balances:");
    await checkBalances();
    
    // Test deposit
    console.log("\n💰 Testing Deposit:");
    const depositAmount = 0.1; // 0.1 USDC
    await deposit(depositAmount);
    
    // Check balances after deposit
    console.log("\n📊 Balances After Deposit:");
    await checkBalances();
    
    // Wait a moment
    console.log("\n⏳ Waiting 5 seconds...");
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Test withdraw - withdraw ALL ZAPPO tokens
    console.log("\n💸 Testing Withdraw:");
    await withdraw(); // Withdraw whatever ZAPPO tokens you have
    
    // Check final balances
    console.log("\n📊 Final Balances:");
    await checkBalances();
    
    console.log("\n✅ Test Completed!");
}

// Export functions
module.exports = { deposit, withdraw, checkBalances, testDepositAndWithdraw };

// Run if called directly
if (require.main === module) {
    testDepositAndWithdraw().catch(console.error);
}