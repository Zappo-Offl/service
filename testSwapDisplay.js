// Test swap token display with real balances
const { getTokenBalances } = require('./Web3/balanceService');

async function testSwapDisplay() {
    try {
        console.log('🧪 Testing swap display with real balances...\n');
        
        const balanceData = await getTokenBalances();
        console.log('Balance data:', JSON.stringify(balanceData, null, 2));
        
        // Simulate the message that would be sent
        const message = `🔄 *Swap USDC to WETH* 💱

🔹 **Current Balances:**
• USDC: ${balanceData.usdcBalance || '0.00'} USDC
• WETH: ${parseFloat(balanceData.wethBalance || '0').toFixed(6)} WETH

💱 **Exchange Rate:** Market rate via Uniswap V3

🎯 **How much USDC would you like to swap?**

Examples:
• Type "1" for 1 USDC
• Type "0.5" for 0.5 USDC  
• Type "5" for 5 USDC

💡 **Swap Features:**
• Best rates on Arbitrum
• Instant execution
• Low gas fees

🔙 Type "cancel" to go back`;

        console.log('\n📱 Message that would be sent to user:');
        console.log('----------------------------------------');
        console.log(message);
        console.log('----------------------------------------');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testSwapDisplay();