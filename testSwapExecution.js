// Test swap execution
const { swapUSDCtoWETH } = require('./Web3/swapService');

async function testSwapExecution() {
    try {
        console.log('🧪 Testing swap execution...\n');
        
        // Test with small amount first
        console.log('🔄 Testing 0.1 USDC swap...');
        const swapResult = await swapUSDCtoWETH(0.1);
        console.log('Swap result:', JSON.stringify(swapResult, null, 2));
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testSwapExecution();