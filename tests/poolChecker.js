const { ethers } = require('ethers');
const FACTORY_ABI = require('./abis/factory.json');
const QUOTER_ABI = require('./abis/quoter.json');
const SWAP_ROUTER_ABI = require('./abis/swaprouter.json');
const POOL_ABI = require('./abis/pool.json');
const TOKEN_IN_ABI = require('./abis/weth.json');
require('dotenv').config();


// Arbitrum Sepolia Deployment Addresses (Official Uniswap V3)
const POOL_FACTORY_CONTRACT_ADDRESS = '0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e'
const QUOTER_CONTRACT_ADDRESS = '0x2779a0CC1c3e0E44D2542EC3e79e3864Ae93Ef0B' // QuoterV2
const SWAP_ROUTER_CONTRACT_ADDRESS = '0x101F443B4d1b059569D643917553c771E1b9663E' // SwapRouter02

// Provider, Contract & Signer Instances
const provider = new ethers.JsonRpcProvider(process.env.ARB_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc')
const factoryContract = new ethers.Contract(POOL_FACTORY_CONTRACT_ADDRESS, FACTORY_ABI, provider);
const quoterContract = new ethers.Contract(QUOTER_CONTRACT_ADDRESS, QUOTER_ABI, provider)
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider)

// Arbitrum Sepolia Token Configuration - SWAPPED ORDER
const USDC = {
    chainId: 421614, // Arbitrum Sepolia chain ID
    address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', // USDC on Arbitrum Sepolia (INPUT TOKEN)
    decimals: 6,
    symbol: 'USDC',
    name: 'USD Coin',
    isToken: true,
    isNative: false,
    wrapped: false
}

const WETH = {
    chainId: 421614, // Arbitrum Sepolia chain ID
    address: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73', // WETH on Arbitrum Sepolia (OUTPUT TOKEN)
    decimals: 18,
    symbol: 'WETH',
    name: 'Wrapped Ether',
    isToken: true,
    isNative: false,
    wrapped: true
}

async function approveToken(tokenAddress, tokenABI, amount, wallet) {
    try {
        const tokenContract = new ethers.Contract(tokenAddress, tokenABI, wallet);

        const approveTransaction = await tokenContract.approve.populateTransaction(
            SWAP_ROUTER_CONTRACT_ADDRESS,
            amount
        );

        const transactionResponse = await wallet.sendTransaction(approveTransaction);
        console.log(`-------------------------------`)
        console.log(`Sending Approval Transaction for USDC...`)
        console.log(`-------------------------------`)
        console.log(`Transaction Sent: ${transactionResponse.hash}`)
        console.log(`-------------------------------`)
        const receipt = await transactionResponse.wait();
        console.log(`Approval Transaction Confirmed! https://sepolia.arbiscan.io/tx/${receipt.hash}`);
    } catch (error) {
        console.error("An error occurred during token approval:", error);
        throw new Error("Token approval failed");
    }
}

async function getPoolInfo(factoryContract, tokenIn, tokenOut) {
    const poolAddress = await factoryContract.getPool(tokenIn.address, tokenOut.address, 3000);
    if (!poolAddress || poolAddress === ethers.ZeroAddress) {
        throw new Error("Failed to get pool address - pool may not exist");
    }
    const poolContract = new ethers.Contract(poolAddress, POOL_ABI, provider);
    const [token0, token1, fee] = await Promise.all([
        poolContract.token0(),
        poolContract.token1(),
        poolContract.fee(),
    ]);
    return { poolContract, token0, token1, fee };
}

async function quoteAndLogSwap(quoterContract, fee, signer, amountIn) {
    try {
        // Using QuoterV2 format - USDC -> WETH
        const quotedAmountOut = await quoterContract.quoteExactInputSingle.staticCall({
            tokenIn: USDC.address,  // INPUT: USDC
            tokenOut: WETH.address, // OUTPUT: WETH
            fee: fee,
            amountIn: amountIn,
            sqrtPriceLimitX96: 0,
        });
        
        console.log(`-------------------------------`)
        console.log(`Raw quote result:`, quotedAmountOut.toString());
        
        // QuoterV2 returns a struct with amountOut property
        const amountOut = quotedAmountOut.amountOut || quotedAmountOut[0] || quotedAmountOut;
        
        console.log(`Token Swap will result in: ${ethers.formatUnits(amountOut.toString(), WETH.decimals)} ${WETH.symbol} for ${ethers.formatUnits(amountIn, USDC.decimals)} ${USDC.symbol}`);
        
        if (amountOut.toString() === '0') {
            console.log(`⚠️  WARNING: Quote returned 0. This might indicate:`);
            console.log(`   - Very low liquidity in the pool`);
            console.log(`   - Amount too small for meaningful swap`);
            console.log(`   - Price impact too high`);
        }
        
        return amountOut;
    } catch (error) {
        console.error("Quote error:", error.message);
        throw error;
    }
}

async function prepareSwapParams(poolContract, signer, amountIn, amountOut) {
    // Add slippage tolerance (1% in this example)
    const slippageTolerance = 0.05; // Increased to 5% for testnet
    const amountOutMinimum = amountOut * BigInt(Math.floor((1 - slippageTolerance) * 10000)) / BigInt(10000);
    
    console.log(`-------------------------------`);
    console.log(`Swap Parameters:`);
    console.log(`Amount In: ${ethers.formatUnits(amountIn, USDC.decimals)} ${USDC.symbol}`);
    console.log(`Expected Out: ${ethers.formatUnits(amountOut, WETH.decimals)} ${WETH.symbol}`);
    console.log(`Minimum Out (with slippage): ${ethers.formatUnits(amountOutMinimum, WETH.decimals)} ${WETH.symbol}`);
    console.log(`-------------------------------`);
    
    return {
        tokenIn: USDC.address,  // INPUT: USDC
        tokenOut: WETH.address, // OUTPUT: WETH
        fee: await poolContract.fee(),
        recipient: signer.address,
        deadline: Math.floor(new Date().getTime() / 1000 + 60 * 10),
        amountIn: amountIn,
        amountOutMinimum: amountOutMinimum,
        sqrtPriceLimitX96: 0,
    };
}

async function executeSwap(swapRouter, params, signer) {
    const transaction = await swapRouter.exactInputSingle.populateTransaction(params);
    const receipt = await signer.sendTransaction(transaction);
    console.log(`-------------------------------`)
    console.log(`Receipt: https://sepolia.arbiscan.io/tx/${receipt.hash}`);
    console.log(`-------------------------------`)
}

async function main(swapAmount) {
    const inputAmount = swapAmount
    const amountIn = ethers.parseUnits(inputAmount.toString(), USDC.decimals); // Parse as USDC (6 decimals)

    try {
        console.log(`-------------------------------`)
        console.log(`Starting swap on Arbitrum Sepolia`)
        console.log(`Network: Arbitrum Sepolia (Chain ID: 421614)`)
        console.log(`SWAPPING: ${USDC.symbol} → ${WETH.symbol}`)
        console.log(`-------------------------------`)
        
        await approveToken(USDC.address, TOKEN_IN_ABI, amountIn, signer) // Approve USDC
        const { poolContract, token0, token1, fee } = await getPoolInfo(factoryContract, USDC, WETH); // USDC -> WETH
        console.log(`-------------------------------`)
        console.log(`Fetching Quote for: ${USDC.symbol} to ${WETH.symbol}`);
        console.log(`Pool fee tier: ${fee}`)
        console.log(`-------------------------------`)
        console.log(`Swap Amount: ${ethers.formatUnits(amountIn, USDC.decimals)} ${USDC.symbol}`);

        const quotedAmountOut = await quoteAndLogSwap(quoterContract, fee, signer, amountIn);

        const params = await prepareSwapParams(poolContract, signer, amountIn, quotedAmountOut);
        const swapRouter = new ethers.Contract(SWAP_ROUTER_CONTRACT_ADDRESS, SWAP_ROUTER_ABI, signer);
        await executeSwap(swapRouter, params, signer);
    } catch (error) {
        console.error("An error occurred:", error.message);
        console.error("Full error:", error);
    }
}

main(1) // 1 USDC instead of 0.001 ETH