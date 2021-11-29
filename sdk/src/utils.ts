import { Provider, BN, utils } from '@project-serum/anchor'
import { u64 } from '@solana/spl-token'
import {
  ConfirmOptions,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmRawTransaction,
  Transaction
} from '@solana/web3.js'
import { expect } from 'chai'
import { calculate_price_sqrt, fromInteger, Market, Pair } from '.'
import { Decimal, FeeTier, FEE_TIER, PoolStructure, Tickmap } from './market'
import { calculatePriceAfterSlippage, calculateSwapStep } from './math'
import { getTickFromPrice } from './tick'
import { getNextTick, getPreviousTick, getSearchLimit } from './tickmap'

export const SEED = 'Invariant'
export const DECIMAL = 12
export const FEE_DECIMAL = 5
export const DENOMINATOR = new BN(10).pow(new BN(DECIMAL))
export const FEE_OFFSET = new BN(10).pow(new BN(DECIMAL - FEE_DECIMAL))
export const FEE_DENOMINATOR = 10 ** FEE_DECIMAL

export enum ERRORS {
  SIGNATURE = 'Error: Signature verification failed',
  SIGNER = 'Error: unknown signer',
  PANICKED = 'Program failed to complete',
  SERIALIZATION = '0xa4',
  ALLOWANCE = 'custom program error: 0x1',
  NO_SIGNERS = 'Error: No signers'
}

export interface SimulateSwapPrice {
  xToY: boolean
  byAmountIn: boolean
  swapAmount: number
  currentPrice: Decimal
  slippage: Decimal
  tickmap: Tickmap
  pool: PoolStructure
  market: Market
  pair: Pair
}

export async function assertThrowsAsync(fn: Promise<any>, word?: string) {
  try {
    await fn
  } catch (e: any) {
    let err
    if (e.code) {
      err = '0x' + e.code.toString(16)
    } else {
      err = e.toString()
    }
    if (word) {
      const regex = new RegExp(`${word}$`)
      if (!regex.test(err)) {
        console.log(err)
        throw new Error('Invalid Error message')
      }
    }
    return
  }
  throw new Error('Function did not throw error')
}

export const signAndSend = async (
  tx: Transaction,
  signers: Array<Keypair>,
  connection: Connection,
  opts?: ConfirmOptions
) => {
  tx.setSigners(...signers.map((s) => s.publicKey))
  const blockhash = await connection.getRecentBlockhash(
    opts?.commitment || Provider.defaultOptions().commitment
  )
  tx.recentBlockhash = blockhash.blockhash
  tx.partialSign(...signers)
  const rawTx = tx.serialize()
  return await sendAndConfirmRawTransaction(connection, rawTx, opts || Provider.defaultOptions())
}

export const sleep = async (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const tou64 = (amount) => {
  // eslint-disable-next-line new-cap
  return new u64(amount.toString())
}

export const fromFee = (fee: BN): BN => {
  // e.g fee - BN(1) -> 0.001%
  return fee.mul(FEE_OFFSET)
}

export const feeToTickSpacing = (fee: BN): number => {
  // linear relationship between fee and tickSpacing
  // tickSpacing = fee * 10^4
  const FEE_TO_SPACING_OFFSET = new BN(10).pow(new BN(DECIMAL - 4))
  return fee.muln(2).div(FEE_TO_SPACING_OFFSET).toNumber()
}

export const FEE_TIERS: Array<FeeTier> = [
  { fee: fromFee(new BN(20)) },
  { fee: fromFee(new BN(40)) },
  { fee: fromFee(new BN(100)) },
  { fee: fromFee(new BN(300)) },
  { fee: fromFee(new BN(1000)) }
]

export const generateTicksArray = (start: number, stop: number, step: number) => {
  const validDir = (start > stop && step < 0) || (start < stop && step > 0)
  const validMod = start % step === 0 && stop % step === 0

  if (!validDir || !validMod) {
    throw new Error('Invalid parameters')
  }

  const ticks: Array<number> = []
  for (let i = start; i <= stop; i += step) {
    ticks.push(i)
  }
  return ticks
}

export const getFeeTierAddress = async ({ fee, tickSpacing }: FeeTier, programId: PublicKey) => {
  const ts = tickSpacing ?? feeToTickSpacing(fee)
  const tickSpacingBuffer = Buffer.alloc(2)
  const feeBuffer = Buffer.alloc(8)
  tickSpacingBuffer.writeUInt16LE(ts)
  feeBuffer.writeBigUInt64LE(BigInt(fee.toString()))

  const [address, bump] = await PublicKey.findProgramAddress(
    [
      Buffer.from(utils.bytes.utf8.encode(FEE_TIER)),
      programId.toBuffer(),
      feeBuffer,
      tickSpacingBuffer
    ],
    programId
  )

  return {
    address,
    bump
  }
}

export const toDecimal = (x: number, decimals: number = 0): Decimal => {
  return { v: DENOMINATOR.muln(x).div(new BN(10).pow(new BN(decimals))) }
}

export const simulateSwapPrice = (swapParameters: SimulateSwapPrice): Decimal => {
  const {xToY, byAmountIn, swapAmount, slippage, tickmap, pool, market, pair} = swapParameters
  let {currentTickIndex, tickSpacing, liquidity, fee} = pool
  const priceLimit = calculatePriceAfterSlippage(pool.sqrtPrice, slippage, !xToY)

  if (xToY) {
    if (pool.sqrtPrice.v.gt(priceLimit.v)) {
      throw new Error("Price limit is on the wrong side of price")
    }
  } else {
    if (pool.sqrtPrice.v.lt(priceLimit.v)) {
      throw new Error("Price limit is on the wrong side of price")
    }
  }

  let remainingAmount = fromInteger(swapAmount)
  let amountWeightedPrice: Decimal = {v: new BN(0)}

  while (!remainingAmount.v.eqn(0)) {
    let closestTickIndex: number
    if (xToY) {
      closestTickIndex = getPreviousTick(tickmap, currentTickIndex, tickSpacing)
    } else {
      closestTickIndex = getNextTick(tickmap, currentTickIndex, tickSpacing)
    }

    let price: Decimal
    let closerLimit: [swapLimit: Decimal, limitingTick: [index: number, initialized: boolean]]
    if (closestTickIndex != null) {
      price = calculate_price_sqrt(closestTickIndex)
      
      if (xToY && price.v.gt(priceLimit.v)) {
        closerLimit = [price, [closestTickIndex, true]]
      } else if (!xToY && price.v.lt(priceLimit.v)) {
        closerLimit = [price, [closestTickIndex, true]]
      } else {
        closerLimit = [priceLimit, [null, null]]
      }
    } else {
      const index = getSearchLimit(currentTickIndex, tickSpacing, !xToY)
      price = calculate_price_sqrt(index)

      if (xToY && price.v.gt(priceLimit.v)) {
        closerLimit = [price, [index, false]]
      } else if (!xToY && price.v.lt(priceLimit.v)) {
        closerLimit = [price, [index, false]]
      } else {
        closerLimit = [priceLimit, [null, null]]
      }
    }

    const result = calculateSwapStep(pool.sqrtPrice, closerLimit[0], liquidity, remainingAmount, byAmountIn, fee)

    let amountDiff: Decimal
    if (byAmountIn) {
      amountDiff = {v: remainingAmount.v.sub(result.amountIn.v).sub(result.feeAmount.v)}
    } else {
      amountDiff = {v: remainingAmount.v.sub(result.amountOut.v)}
    }
    amountWeightedPrice = {v: amountWeightedPrice.v.add(pool.sqrtPrice.v.mul(amountDiff.v).div(DENOMINATOR))}
    remainingAmount = {v: remainingAmount.v.sub(amountDiff.v)}

    pool.sqrtPrice = result.nextPrice

    if (pool.sqrtPrice.v.eq(priceLimit.v) && remainingAmount.v.gt(new BN(0))) {
      throw new Error("Price would cross swap limit")
    }

    if (result.nextPrice.v.eq(closerLimit[0].v) && closerLimit[1][0] != null) {
      const tickIndex = closerLimit[1][0]
      const initialized = closerLimit[1][1]

      if (initialized) {
        market.getTick(pair, tickIndex).then((tick) => {
          if ((currentTickIndex >= tick.index) !== tick.sign) {
            liquidity = {v: liquidity.v.add(tick.liquidityChange.v)}
          } else {
            liquidity = {v: liquidity.v.sub(tick.liquidityChange.v)}
          }
        })
      }
      if (xToY && !remainingAmount.v.eq(new BN(0))) {
        currentTickIndex = tickIndex - tickSpacing
      } else {
        currentTickIndex = tickIndex
      }
    } else {
      currentTickIndex = getTickFromPrice(currentTickIndex, tickSpacing, result.nextPrice, xToY)
    }

  }

  return {v: amountWeightedPrice.v.mul(DENOMINATOR).divn(swapAmount)}
}
