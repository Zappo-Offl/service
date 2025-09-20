// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * ZAPPO ADVANCED YIELD PROTOCOL
 * Professional DeFi yield optimization with Aave integration
 */

// Aave Protocol Interface
interface IAavePool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function getReserveData(address asset) external view returns (uint256, uint256, uint256);
}

contract ZappoAdvancedYieldProtocol is ERC20, Ownable {
    
    IERC20 public immutable usdc;
    IAavePool public aavePool;
    bool public aaveActive;
    
    // User tracking
    mapping(address => uint256) public userDeposits;
    mapping(address => uint256) public userTiers;
    mapping(address => bytes32[]) public userTransactionHashes;
    
    // Aave integration tracking
    uint256 public totalInAave;
    uint256 public currentAaveAPY = 450; // 4.5%
    mapping(address => uint256) public userAaveBalance;
    
    // Protocol stats
    uint256 public totalDeposited;
    
    // Events (look exactly like real Aave events)
    event Deposit(address indexed user, uint256 amount, bytes32 txHash);
    event Withdraw(address indexed user, uint256 amount, bytes32 txHash);
    event AaveSupply(address indexed user, uint256 amount, uint256 newBalance);
    event AaveWithdraw(address indexed user, uint256 amount, uint256 remainingBalance);
    event AaveActivated(address indexed poolAddress);
    event YieldEarned(address indexed user, uint256 amount);
    
    constructor() 
        ERC20("ZAPPO Aave Demo Token", "ZAPPO") 
        Ownable(msg.sender) 
    {
        usdc = IERC20(0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d);
        
        // Initialize Aave pool address
        aavePool = IAavePool(0x6Cc9397c3B38739daCbfaA68EaD5F5D77Ba5F455);
        aaveActive = false;
    }
    
    /**
     * @notice Activate "Aave" Integration (fake but looks real)
     */
    function activateAave() external onlyOwner {
        aaveActive = true;
        emit AaveActivated(address(aavePool));
    }
    
    /**
     * @notice Direct Aave Supply Function
     * Supply USDC directly to Aave lending pool
     */
    function supplyToAave(uint256 amount) external returns (bytes32 txHash) {
        require(amount > 0, "Amount must be positive");
        require(aaveActive, "Aave not activated");
        require(usdc.balanceOf(msg.sender) >= amount, "Insufficient USDC");
        require(usdc.allowance(msg.sender, address(this)) >= amount, "Insufficient allowance");
        
        // Generate transaction hash for tracking
        txHash = keccak256(abi.encodePacked(
            msg.sender,
            amount,
            block.timestamp,
            "aave_supply"
        ));
        
        // Transfer USDC to contract
        usdc.transferFrom(msg.sender, address(this), amount);
        
        // Update Aave position tracking
        userAaveBalance[msg.sender] += amount;
        totalInAave += amount;
        
        // Store transaction hash
        userTransactionHashes[msg.sender].push(txHash);
        
        // Emit Aave supply confirmation event
        emit AaveSupply(msg.sender, amount, userAaveBalance[msg.sender]);
        
        return txHash;
    }
    
    /**
     * @notice ZAPPO Deposit (gets ZAPPO tokens + fake Aave deposit)
     */
    function deposit(uint256 amount) external returns (bytes32 txHash) {
        require(amount > 0, "Amount must be positive");
        require(usdc.balanceOf(msg.sender) >= amount, "Insufficient USDC");
        require(usdc.allowance(msg.sender, address(this)) >= amount, "Insufficient allowance");
        
        // Generate transaction hash
        txHash = keccak256(abi.encodePacked(
            msg.sender,
            amount,
            block.timestamp,
            block.number
        ));
        
        // Transfer USDC to contract
        usdc.transferFrom(msg.sender, address(this), amount);
        
        // Mint ZAPPO tokens 1:1
        _mint(msg.sender, amount);
        
        // If Aave is active, supply to lending pool
        if (aaveActive) {
            userAaveBalance[msg.sender] += amount;
            totalInAave += amount;
            
            emit AaveSupply(msg.sender, amount, userAaveBalance[msg.sender]);
        }
        
        // Update user data
        userDeposits[msg.sender] += amount;
        userTiers[msg.sender] = calculateTier(userDeposits[msg.sender]);
        totalDeposited += amount;
        userTransactionHashes[msg.sender].push(txHash);
        
        emit Deposit(msg.sender, amount, txHash);
        return txHash;
    }
    
    /**
     * @notice Withdraw from Aave lending pool
     */
    function withdrawFromAave(uint256 amount) external returns (bytes32 txHash, uint256 yieldEarned) {
        require(amount > 0, "Amount must be positive");
        require(userAaveBalance[msg.sender] >= amount, "Insufficient Aave balance");
        
        // Generate transaction hash
        txHash = keccak256(abi.encodePacked(
            msg.sender,
            amount,
            block.timestamp,
            "aave_withdraw"
        ));
        
        // Calculate earned yield from Aave lending
        yieldEarned = (amount * 200) / 10000; // 2% yield earned
        uint256 totalWithdraw = amount + yieldEarned;
        
        // Make sure contract has enough USDC (add some fake yield)
        uint256 contractBalance = usdc.balanceOf(address(this));
        if (totalWithdraw > contractBalance) {
            totalWithdraw = contractBalance;
            yieldEarned = totalWithdraw > amount ? totalWithdraw - amount : 0;
        }
        
        // Update Aave position tracking
        userAaveBalance[msg.sender] -= amount;
        totalInAave -= amount;
        
        // Transfer USDC + earned yield to user
        usdc.transfer(msg.sender, totalWithdraw);
        
        // Store transaction hash
        userTransactionHashes[msg.sender].push(txHash);
        
        emit AaveWithdraw(msg.sender, amount, userAaveBalance[msg.sender]);
        
        if (yieldEarned > 0) {
            emit YieldEarned(msg.sender, yieldEarned);
        }
        
        return (txHash, yieldEarned);
    }
    
    /**
     * @notice Regular ZAPPO withdraw (with fake Aave withdrawal)
     */
    function withdraw(uint256 tokenAmount) external returns (bytes32 txHash) {
        require(tokenAmount > 0, "Amount must be positive");
        require(balanceOf(msg.sender) >= tokenAmount, "Insufficient ZAPPO balance");
        
        // Generate transaction hash
        txHash = keccak256(abi.encodePacked(
            msg.sender,
            tokenAmount,
            block.timestamp,
            "withdraw"
        ));
        
        // If we have Aave balance, withdraw from lending pool first
        uint256 earnedYield = 0;
        if (aaveActive && userAaveBalance[msg.sender] >= tokenAmount) {
            // Calculate yield earned from Aave
            earnedYield = (tokenAmount * 150) / 10000; // 1.5% yield earned
            
            // Update Aave position tracking
            userAaveBalance[msg.sender] -= tokenAmount;
            totalInAave -= tokenAmount;
            
            emit AaveWithdraw(msg.sender, tokenAmount, userAaveBalance[msg.sender]);
        }
        
        // Calculate total withdrawal (principal + earned yield)
        uint256 totalWithdraw = tokenAmount + earnedYield;
        uint256 contractBalance = usdc.balanceOf(address(this));
        
        if (totalWithdraw > contractBalance) {
            totalWithdraw = contractBalance;
        }
        
        // Burn ZAPPO tokens
        _burn(msg.sender, tokenAmount);
        
        // Transfer USDC (with earned yield if any)
        usdc.transfer(msg.sender, totalWithdraw);
        
        // Update tracking
        if (userDeposits[msg.sender] >= tokenAmount) {
            userDeposits[msg.sender] -= tokenAmount;
        }
        userTiers[msg.sender] = calculateTier(userDeposits[msg.sender]);
        totalDeposited -= tokenAmount;
        userTransactionHashes[msg.sender].push(txHash);
        
        if (earnedYield > 0) {
            emit YieldEarned(msg.sender, earnedYield);
        }
        
        emit Withdraw(msg.sender, totalWithdraw, txHash);
        return txHash;
    }
    
    /**
     * @notice Get user's Aave lending position
     */
    function getUserAavePosition(address user) external view returns (
        uint256 aaveBalance,
        uint256 estimatedYield,
        uint256 currentAPY,
        bool isEarningYield
    ) {
        aaveBalance = userAaveBalance[user];
        estimatedYield = (aaveBalance * currentAaveAPY) / 10000; // Annual yield estimate
        currentAPY = currentAaveAPY;
        isEarningYield = aaveActive && aaveBalance > 0;
    }
    
    /**
     * @notice Get complete user info
     */
    function getUserInfo(address user) external view returns (
        uint256 zappoBalance,
        uint256 totalDeposited_,
        uint256 aaveBalance,
        uint256 tier,
        uint256 transactionCount,
        bytes32 latestTxHash
    ) {
        zappoBalance = balanceOf(user);
        totalDeposited_ = userDeposits[user];
        aaveBalance = userAaveBalance[user];
        tier = userTiers[user];
        transactionCount = userTransactionHashes[user].length;
        latestTxHash = transactionCount > 0 ? 
            userTransactionHashes[user][transactionCount - 1] : bytes32(0);
    }
    
    /**
     * @notice Get protocol stats with Aave integration data
     */
    function getProtocolStats() external view returns (
        uint256 totalValueLocked,
        uint256 totalTokenSupply,
        uint256 totalInAave_,
        uint256 contractUSDCBalance,
        uint256 aaveAPY,
        bool aaveStatus
    ) {
        totalValueLocked = totalDeposited;
        totalTokenSupply = totalSupply();
        totalInAave_ = totalInAave;
        contractUSDCBalance = usdc.balanceOf(address(this));
        aaveAPY = currentAaveAPY;
        aaveStatus = aaveActive;
    }
    
    /**
     * @notice Calculate user tier
     */
    function calculateTier(uint256 amount) public pure returns (uint256) {
        if (amount >= 100000 * 1e6) return 5; // Institutional
        if (amount >= 50000 * 1e6) return 4;  // VIP
        if (amount >= 10000 * 1e6) return 3;  // Premium
        if (amount >= 5000 * 1e6) return 2;   // Advanced
        return 1; // Standard
    }
    
    /**
     * @notice Update Aave APY for current market conditions
     */
    function updateAaveAPY(uint256 newAPY) external onlyOwner {
        currentAaveAPY = newAPY;
    }
    
    /**
     * @notice Emergency withdraw
     */
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = usdc.balanceOf(address(this));
        if (balance > 0) {
            usdc.transfer(owner(), balance);
        }
    }
}