const { ethers } = require('ethers');
const config = require('../../src/config');

class GasService {
  constructor() {
    this.provider = null;
    this.initialize();
  }

  async initialize() {
    try {
      const rpcUrl = process.env.ARB_RPC_URL || config.thirdweb.rpcUrl;
      this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      console.log('✅ Gas Service: ARB provider initialized');
    } catch (error) {
      console.error('❌ Gas Service: Failed to initialize provider:', error);
      throw error;
    }
  }

  async getCurrentGasFees() {
    try {
      if (!this.provider) {
        await this.initialize();
      }

      // Get current gas price and fee data
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice;
      
      // Standard ETH transfer uses 21,000 gas
      const standardGasLimit = ethers.BigNumber.from('21000');
      const estimatedCostWei = gasPrice.mul(standardGasLimit);
      const estimatedCostETH = ethers.utils.formatEther(estimatedCostWei);
      
      // Convert to USD (rough estimate - in production you'd use a price API)
      const ethToUsdRate = 1600; // Placeholder - should be dynamic
      const estimatedCostUSD = (parseFloat(estimatedCostETH) * ethToUsdRate).toFixed(2);

      return {
        gasPrice: gasPrice.toString(),
        gasPriceGwei: ethers.utils.formatUnits(gasPrice, 'gwei'),
        standardGasLimit: standardGasLimit.toString(),
        estimatedCostETH: estimatedCostETH,
        estimatedCostUSD: `$${estimatedCostUSD}`,
        network: 'Arbitrum Sepolia',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Gas Service: Failed to get gas fees:', error);
      return {
        gasPrice: '0',
        gasPriceGwei: '0.1',
        standardGasLimit: '21000',
        estimatedCostETH: '0.001',
        estimatedCostUSD: '$1.60',
        network: 'Arbitrum Sepolia',
        timestamp: new Date().toISOString(),
        error: 'Failed to fetch current gas fees'
      };
    }
  }

  async estimateTransactionGas(to, value, data = '0x') {
    try {
      if (!this.provider) {
        await this.initialize();
      }

      const transaction = {
        to: to,
        value: ethers.utils.parseEther(value.toString()),
        data: data
      };

      const gasEstimate = await this.provider.estimateGas(transaction);
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice;
      
      const totalCostWei = gasPrice.mul(gasEstimate);
      const totalCostETH = ethers.utils.formatEther(totalCostWei);
      
      // Convert to USD (placeholder rate)
      const ethToUsdRate = 1600;
      const totalCostUSD = (parseFloat(totalCostETH) * ethToUsdRate).toFixed(2);

      return {
        gasLimit: gasEstimate.toString(),
        gasPrice: gasPrice.toString(),
        gasPriceGwei: ethers.utils.formatUnits(gasPrice, 'gwei'),
        totalCostETH: totalCostETH,
        totalCostUSD: `$${totalCostUSD}`,
        network: 'Arbitrum Sepolia'
      };
    } catch (error) {
      console.error('❌ Gas Service: Failed to estimate gas:', error);
      throw error;
    }
  }

  // Helper method to format gas info for user-friendly display
  formatGasForUser(gasData) {
    return `Gas fee: ~${gasData.estimatedCostUSD} (${parseFloat(gasData.estimatedCostETH).toFixed(6)} ETH)`;
  }

  // Check if gas fees are unusually high
  isHighGasFee(gasData) {
    const gasPriceGwei = parseFloat(gasData.gasPriceGwei);
    return gasPriceGwei > 20; // Arbitrum is usually very low, so 20 Gwei is high
  }

  // Get gas fee status message
  getGasStatusMessage(gasData) {
    if (this.isHighGasFee(gasData)) {
      return `⚠️ Gas fees are higher than usual (${gasData.gasPriceGwei} Gwei). You might want to wait a bit for fees to come down.`;
    } else {
      return `✅ Gas fees look good (${gasData.gasPriceGwei} Gwei). Perfect time to make a transaction!`;
    }
  }
}

module.exports = GasService;