import {
  FEE_TIER,
  Market,
  PoolData,
  PoolStructure,
  Tickmap,
  Tick,
  TICK_CROSSES_PER_IX
} from './market'
import {
  SEED,
  DENOMINATOR,
  signAndSend,
  sleep,
  INVARIANT_ERRORS,
  computeUnitsInstruction,
  PRICE_DENOMINATOR,
  LIQUIDITY_DENOMINATOR,
  simulateSwap,
  toDecimal,
  SimulateSwapInterface
} from './utils'
import {
  TICK_LIMIT,
  calculatePriceSqrt,
  fromInteger,
  MAX_TICK,
  MIN_TICK,
  TICK_SEARCH_RANGE,
  findClosestTicks
} from './math'
import { PublicKey, Transaction } from '@solana/web3.js'
import { Pair } from './pair'
import { getMarketAddress, Network, MOCK_TOKENS } from './network'
import { findTickmapChanges } from './tickmap'
import { Invariant, IDL } from './idl/invariant'

export {
  SimulateSwapInterface,
  toDecimal,
  simulateSwap,
  findClosestTicks,
  TICK_CROSSES_PER_IX,
  Tick,
  PoolData,
  PoolStructure,
  Tickmap,
  Market,
  Pair,
  Network,
  getMarketAddress,
  signAndSend,
  sleep,
  calculatePriceSqrt,
  findTickmapChanges,
  fromInteger,
  SEED,
  INVARIANT_ERRORS,
  DENOMINATOR,
  PRICE_DENOMINATOR,
  LIQUIDITY_DENOMINATOR,
  TICK_LIMIT,
  MAX_TICK,
  MIN_TICK,
  MOCK_TOKENS,
  FEE_TIER,
  TICK_SEARCH_RANGE,
  computeUnitsInstruction,
  Invariant,
  IDL
}
export interface IWallet {
  signTransaction: (tx: Transaction) => Promise<Transaction>
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>
  publicKey: PublicKey
}
