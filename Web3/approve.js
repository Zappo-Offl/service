// USDC Approval Script for ZAPPO Contract
require('dotenv').config();
const { ethers } = require('ethers');

async function approveUSDC() {
    // Configuration
    const USDC_ADDRESS = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
    const ZAPPO_CONTRACT_ADDRESS = "0x3ec1F818E761ccF530881F5139d48315339e3FA7"; // Replace with your contract address
    const RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc"; // Arbitrum Sepolia RPC
    const PRIVATE_KEY =  process.env.PRIVATE_KEY; 

    // Amount to approve (10000000 USDC = 10000000 * 10^6)
    const APPROVAL_AMOUNT = ethers.utils.parseUnits("10000000", 6);

    // For unlimited approval, use this instead:
    // const APPROVAL_AMOUNT = ethers.constants.MaxUint256;
    
    try {
        // Setup provider and wallet
        const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
        const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
        
        console.log("Connected wallet:", wallet.address);
        
        // USDC Contract ABI (just the approve function)
        const usdcABI = [
            "function approve(address spender, uint256 amount) public returns (bool)",
            "function balanceOf(address owner) public view returns (uint256)",
            "function allowance(address owner, address spender) public view returns (uint256)"
        ];
        
        // Create contract instance
        const usdcContract = new ethers.Contract(USDC_ADDRESS, usdcABI, wallet);
        
        // Check current balance
        const balance = await usdcContract.balanceOf(wallet.address);
        console.log("USDC Balance:", ethers.utils.formatUnits(balance, 6));
        
        // Check current allowance
        const currentAllowance = await usdcContract.allowance(wallet.address, ZAPPO_CONTRACT_ADDRESS);
        console.log("Current Allowance:", ethers.utils.formatUnits(currentAllowance, 6));
        
        // If already approved enough, skip
        if (currentAllowance >= APPROVAL_AMOUNT) {
            console.log("✅ Already approved enough USDC!");
            return;
        }
        
        // Send approval transaction
        console.log("🔄 Sending approval transaction...");
        const tx = await usdcContract.approve(ZAPPO_CONTRACT_ADDRESS, APPROVAL_AMOUNT);
        
        console.log("Transaction Hash:", tx.hash);
        console.log("⏳ Waiting for confirmation...");
        
        // Wait for transaction confirmation
        const receipt = await tx.wait();
        
        console.log("✅ Approval successful!");
        console.log("Block Number:", receipt.blockNumber);
        console.log("Gas Used:", receipt.gasUsed.toString());
        
        // Verify new allowance
        const newAllowance = await usdcContract.allowance(wallet.address, ZAPPO_CONTRACT_ADDRESS);
        console.log("New Allowance:", ethers.utils.formatUnits(newAllowance, 6), "USDC");
        
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

// Run the approval
approveUSDC();