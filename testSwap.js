// Test swap functionality
const { getSwapQuote, swapUSDCtoWETH } = require('./Web3/swapService');

async function testSwapFlow() {
    try {
        console.log('🧪 Testing swap functionality...\n');
        
        // Test 1: Get quote for 1 USDC
        console.log('📊 Testing swap quote...');
        const quote = await getSwapQuote(1);
        console.log('Quote result:', JSON.stringify(quote, null, 2));
        
        if (quote.success) {
            console.log(`✅ Quote successful: ${quote.amountIn} USDC → ${quote.amountOut} WETH`);
        } else {
            console.log(`❌ Quote failed: ${quote.error}`);
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testSwapFlow();