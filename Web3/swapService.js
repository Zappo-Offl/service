const { ethers } = require('ethers');
const FACTORY_ABI = require('./abis/factory.json');
const QUOTER_ABI = require('./abis/quoter.json');
const SWAP_ROUTER_ABI = require('./abis/swaprouter.json');
const POOL_ABI = require('./abis/pool.json');
const TOKEN_IN_ABI = require('./abis/weth.json');
require('dotenv').config();

const POOL_FACTORY_CONTRACT_ADDRESS = '0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e'
const QUOTER_CONTRACT_ADDRESS = '0x2779a0CC1c3e0E44D2542EC3e79e3864Ae93Ef0B'
const SWAP_ROUTER_CONTRACT_ADDRESS = '0x101F443B4d1b059569D643917553c771E1b9663E'

// Provider & Signer
const provider = new ethers.providers.JsonRpcProvider(process.env.ARB_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc')
const factoryContract = new ethers.Contract(POOL_FACTORY_CONTRACT_ADDRESS, FACTORY_ABI, provider);
const quoterContract = new ethers.Contract(QUOTER_CONTRACT_ADDRESS, QUOTER_ABI, provider)
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider)

// Token Configuration - USDC to WETH
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

// Simple ERC20 ABI
const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)"
];

async function swapUSDCtoWETH(usdcAmount) {
    try {
        console.log(`🚀 Starting USDC → WETH swap`)
        console.log(`💰 Amount: ${usdcAmount} USDC`)
        console.log(`🌐 Network: Arbitrum Sepolia`)
        console.log(`----------------------------------------`)

        const amountIn = ethers.utils.parseUnits(usdcAmount.toString(), USDC.decimals);
        
        // 1. Check balance
        const usdcContract = new ethers.Contract(USDC.address, ERC20_ABI, provider);
        const balance = await usdcContract.balanceOf(signer.address);
        console.log(`💳 Your USDC balance: ${ethers.utils.formatUnits(balance, USDC.decimals)} USDC`);
        
        if (balance < amountIn) {
            throw new Error(`Insufficient USDC balance! Need ${usdcAmount}, have ${ethers.utils.formatUnits(balance, USDC.decimals)}`);
        }

        // 2. Approve USDC
        console.log(`📝 Approving ${usdcAmount} USDC...`);
        const usdcContractWithSigner = new ethers.Contract(USDC.address, ERC20_ABI, signer);
        const approveTx = await usdcContractWithSigner.approve(SWAP_ROUTER_CONTRACT_ADDRESS, amountIn);
        await approveTx.wait();
        console.log(`✅ Approval confirmed: ${approveTx.hash}`);

        // 3. Get pool and quote
        const poolAddress = await factoryContract.getPool(USDC.address, WETH.address, 3000);
        console.log(`🏊 Pool found: ${poolAddress}`);

        const quote = await quoterContract.callStatic.quoteExactInputSingle({
            tokenIn: USDC.address,
            tokenOut: WETH.address,
            fee: 3000,
            amountIn: amountIn,
            sqrtPriceLimitX96: 0
        });

        const amountOut = quote.amountOut || quote[0] || quote;
        console.log(`📊 Quote: ${ethers.utils.formatUnits(amountOut, WETH.decimals)} WETH`);

        if (amountOut.toString() === '0') {
            throw new Error('Quote returned 0 - try a larger amount or different pool');
        }

        // 4. Execute swap
        const deadline = Math.floor(Date.now() / 1000) + 60 * 10; // 10 minutes
        const amountOutMinimum = amountOut.mul(95).div(100); // 5% slippage

        const swapParams = {
            tokenIn: USDC.address,
            tokenOut: WETH.address,
            fee: 3000,
            recipient: signer.address,
            deadline: deadline,
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum,
            sqrtPriceLimitX96: 0
        };

        console.log(`🔄 Executing swap...`);
        const swapRouter = new ethers.Contract(SWAP_ROUTER_CONTRACT_ADDRESS, SWAP_ROUTER_ABI, signer);
        const swapTx = await swapRouter.exactInputSingle(swapParams);
        
        console.log(`⏳ Swap transaction sent: ${swapTx.hash}`);
        const receipt = await swapTx.wait();
        
        console.log(`✅ SWAP SUCCESSFUL!`);
        console.log(`🔗 Transaction: https://sepolia.arbiscan.io/tx/${swapTx.hash}`);
        console.log(`----------------------------------------`);

        // 5. Check new balances
        const newUSDCBalance = await usdcContract.balanceOf(signer.address);
        const wethContract = new ethers.Contract(WETH.address, ERC20_ABI, provider);
        const newWETHBalance = await wethContract.balanceOf(signer.address);

        console.log(`📊 NEW BALANCES:`);
        console.log(`💰 USDC: ${ethers.utils.formatUnits(newUSDCBalance, USDC.decimals)}`);
        console.log(`💰 WETH: ${ethers.utils.formatUnits(newWETHBalance, WETH.decimals)}`);

        return {
            success: true,
            transactionHash: swapTx.hash,
            amountIn: usdcAmount,
            amountOut: ethers.utils.formatUnits(amountOut, WETH.decimals),
            newUSDCBalance: ethers.utils.formatUnits(newUSDCBalance, USDC.decimals),
            newWETHBalance: ethers.utils.formatUnits(newWETHBalance, WETH.decimals)
        };

    } catch (error) {
        console.error(`❌ Swap Error:`, error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

async function getSwapQuote(usdcAmount) {
    try {
        const amountIn = ethers.utils.parseUnits(usdcAmount.toString(), USDC.decimals);
        
        // Check balance first
        const usdcContract = new ethers.Contract(USDC.address, ERC20_ABI, provider);
        const balance = await usdcContract.balanceOf(signer.address);
        
        if (balance < amountIn) {
            throw new Error(`Insufficient USDC balance`);
        }

        // Get quote
        const quote = await quoterContract.callStatic.quoteExactInputSingle({
            tokenIn: USDC.address,
            tokenOut: WETH.address,
            fee: 3000,
            amountIn: amountIn,
            sqrtPriceLimitX96: 0
        });

        const amountOut = quote.amountOut || quote[0] || quote;
        
        return {
            success: true,
            amountIn: usdcAmount,
            amountOut: ethers.utils.formatUnits(amountOut, WETH.decimals),
            currentUSDCBalance: ethers.utils.formatUnits(balance, USDC.decimals)
        };

    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    swapUSDCtoWETH,
    getSwapQuote,
    USDC,
    WETH
};