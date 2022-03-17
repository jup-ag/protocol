import { Provider, BN, utils } from '@project-serum/anchor'
import { u64 } from '@solana/spl-token'
import {
  ConfirmOptions,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmRawTransaction,
  Transaction,
  TransactionInstruction
} from '@solana/web3.js'
import { calculatePriceSqrt, MAX_TICK, Pair, TICK_LIMIT, Market, MIN_TICK } from '.'
import { Decimal, FeeTier, FEE_TIER, PoolStructure, Tickmap, Tick, PoolData } from './market'
import { calculatePriceAfterSlippage, calculateSwapStep, isEnoughAmountToPushPrice } from './math'
import { alignTickToSpacing, getTickFromPrice } from './tick'
import { getNextTick, getPreviousTick, getSearchLimit } from './tickmap'
import { struct, u32, u8 } from '@solana/buffer-layout'
import { lstat } from 'fs'

export const SEED = 'Invariant'
export const DECIMAL = 12
export const LIQUIDITY_SCALE = 6
export const GROWTH_SCALE = 24
export const PRICE_SCALE = 24
export const FEE_DECIMAL = 5
export const DENOMINATOR = new BN(10).pow(new BN(DECIMAL))
export const LIQUIDITY_DENOMINATOR = new BN(10).pow(new BN(LIQUIDITY_SCALE))
export const PRICE_DENOMINATOR = new BN(10).pow(new BN(PRICE_SCALE))
export const GROWTH_DENOMINATOR = new BN(10).pow(new BN(GROWTH_SCALE))
export const FEE_OFFSET = new BN(10).pow(new BN(DECIMAL - FEE_DECIMAL))
export const FEE_DENOMINATOR = 10 ** FEE_DECIMAL
export const U128MAX = new BN('340282366920938463463374607431768211455')
export const CONCENTRATION_FACTOR = 1.00001526069123

export enum ERRORS {
  SIGNATURE = 'Error: Signature verification failed',
  SIGNER = 'Error: unknown signer',
  PANICKED = 'Program failed to complete',
  SERIALIZATION = '0xbbc',
  ALLOWANCE = 'custom program error: 0x1',
  NO_SIGNERS = 'Error: No signers',
  CONSTRAINT_RAW = '0x7d3',
  CONSTRAINT_SEEDS = '0x7d6'
}

export enum INVARIANT_ERRORS {
  ZERO_AMOUNT = '0x1770',
  ZERO_OUTPUT = '0x1771',
  WRONG_TICK = '0x1772',
  WRONG_LIMIT = '0x1773',
  INVALID_TICK_INDEX = '0x1774',
  INVALID_TICK_INTERVAL = '0x1775',
  NO_MORE_TICKS = '0x1776',
  TICK_NOT_FOUND = '0x1777',
  PRICE_LIMIT_REACHED = '0x1778',
  INVALID_TICK_LIQUIDITY = '0x1779',
  EMPTY_POSITION_POKES = '0x177a',
  INVALID_POSITION_LIQUIDITY = '0x177b',
  INVALID_POOL_LIQUIDITY = '0x177c',
  INVALID_POSITION_INDEX = '0x177d',
  POSITION_WITHOUT_LIQUIDITY = '0x177e',
  INVALID_POOL_TOKEN_ADDRESSES = '0x1780',
  NO_GAIN_SWAP = '0x1785',
  INVALID_TOKEN_ACCOUNT = '0x1786',
  INVALID_ADMIN = '0x1787',
  INVALID_AUTHORITY = '0x1788',
  INVALID_OWNER = '0x1789',
  INVALID_MINT = '0x178a',
  INVALID_TICKMAP = '0x178b',
  INVALID_TICKMAP_OWNER = '0x178c',
  INVALID_LIST_OWNER = '0x178d'
}

export interface SimulateSwapPrice {
  xToY: boolean
  byAmountIn: boolean
  swapAmount: BN
  currentPrice: Decimal
  slippage: Decimal
  tickmap: Tickmap
  pool: PoolStructure
  market: Market
  pair: Pair
}

export interface SimulateSwapInterface {
  xToY: boolean
  byAmountIn: boolean
  swapAmount: BN
  priceLimit: Decimal
  slippage: Decimal
  ticks: Map<number, Tick>
  tickmap: Tickmap
  pool: PoolData
}

export interface SimulationResult {
  amountPerTick: BN[]
  accumulatedAmountIn: BN
  accumulatedAmountOut: BN
  accumulatedFee: BN
  priceAfterSwap: BN
}

export interface FeeGrowthInside {
  tickLower: Tick
  tickUpper: Tick
  tickCurrent: number
  feeGrowthGlobalX: Decimal
  feeGrowthGlobalY: Decimal
}

export interface TokensOwed {
  position: PositionClaimData
  feeGrowthInsideX: BN
  feeGrowthInsideY: BN
}

export interface SimulateClaim {
  position: PositionClaimData
  tickLower: Tick
  tickUpper: Tick
  tickCurrent: number
  feeGrowthGlobalX: Decimal
  feeGrowthGlobalY: Decimal
}
export interface PositionClaimData {
  liquidity: Decimal
  feeGrowthInsideX: Decimal
  feeGrowthInsideY: Decimal
  tokensOwedX: Decimal
  tokensOwedY: Decimal
}

export interface CloserLimit {
  sqrtPriceLimit: Decimal
  xToY: boolean
  currentTick: number
  tickSpacing: number
  tickmap: Tickmap
}

export interface TickState {
  index: number
  initialized: boolean
}
export interface CloserLimitResult {
  swapLimit: Decimal
  limitingTick: TickState | null
}

export const ComputeUnitsInstruction = (units: number, wallet: PublicKey) => {
  const program = new PublicKey('ComputeBudget111111111111111111111111111111')
  const params = { instruction: 0, units: units }
  const layout = struct([u8('instruction') as any, u32('units')])
  const data = Buffer.alloc(layout.span)
  layout.encode(params, data)
  const keys = [{ pubkey: wallet, isSigner: false, isWritable: false }]
  const unitsIx = new TransactionInstruction({
    keys,
    programId: program,
    data
  })
  return unitsIx
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
  signers: Keypair[],
  connection: Connection,
  opts?: ConfirmOptions
) => {
  tx.setSigners(...signers.map(s => s.publicKey))
  const blockhash = await connection.getRecentBlockhash(
    opts?.commitment ?? Provider.defaultOptions().commitment
  )
  tx.recentBlockhash = blockhash.blockhash
  tx.partialSign(...signers)
  const rawTx = tx.serialize()
  return await sendAndConfirmRawTransaction(connection, rawTx, opts ?? Provider.defaultOptions())
}

export const sleep = async (ms: number) => {
  return await new Promise(resolve => setTimeout(resolve, ms))
}

export const tou64 = amount => {
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
  return fee.div(FEE_TO_SPACING_OFFSET).toNumber()
}

export const FEE_TIERS: FeeTier[] = [
  { fee: fromFee(new BN(10)) },
  { fee: fromFee(new BN(50)) },
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

  const ticks: number[] = []
  for (let i = start; i <= stop; i += step) {
    ticks.push(i)
  }
  return ticks
}

export const getFeeTierAddress = async ({ fee, tickSpacing }: FeeTier, programId: PublicKey) => {
  const ts = tickSpacing ?? feeToTickSpacing(fee)

  const [address, bump] = await PublicKey.findProgramAddress(
    [
      Buffer.from(utils.bytes.utf8.encode(FEE_TIER)),
      programId.toBuffer(),
      bigNumberToBuffer(fee, 128),
      bigNumberToBuffer(new BN(ts), 16)
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

export const toDecimalWithDenominator = (x: number, denominator: BN, decimals: number = 0) => {
  return { v: denominator.muln(x).div(new BN(10).pow(new BN(decimals))) }
}

export const calculateConcentration = (
  tickSpacing: number,
  maxConcentration: number,
  n: number
) => {
  const concentration = 1 / (1 - Math.pow(1.0001, (-tickSpacing * (maxConcentration + 2 * n)) / 4))
  return concentration / CONCENTRATION_FACTOR
}

export const calculateTickDelta = (
  tickSpacing: number,
  maxConcentration: number,
  concentration: number
) => {
  const base = Math.pow(1.0001, -(tickSpacing / 4))
  const logArg =
    (1 - 1 / (concentration * CONCENTRATION_FACTOR)) /
    Math.pow(1.0001, (-tickSpacing * maxConcentration) / 4)

  return Math.ceil(Math.log(logArg) / Math.log(base) / 2)
}

export const getConcentrationArray = (
  tickSpacing: number,
  maxConcentration: number,
  currentTick: number
): number[] => {
  let concentrations: number[] = []
  let counter = 0
  let concentration = 0
  let lastConcentration = calculateConcentration(tickSpacing, maxConcentration, counter) + 1
  let concentrationDelta = 1

  while (concentrationDelta >= 1) {
    concentration = calculateConcentration(tickSpacing, maxConcentration, counter)
    concentrations.push(concentration)
    concentrationDelta = lastConcentration - concentration
    lastConcentration = concentration
    counter++
  }
  concentration = Math.ceil(concentrations[concentrations.length - 1])

  while (concentration > 1) {
    concentrations.push(concentration)
    concentration--
  }
  const maxTick = alignTickToSpacing(MAX_TICK, tickSpacing)

  const limitIndex =
    (maxTick - Math.abs(currentTick) - (maxConcentration / 2) * tickSpacing) / tickSpacing

  return concentrations.slice(0, limitIndex)
}

// export const getPositionInitData = (
//   tokenAmount: number,
//   tickSpacing: number,
//   concentration: number,
//   maxConcentration: number,
//   currentTick: number
// ): number => {
//   const maxTick = alignTickToSpacing(MAX_TICK, tickSpacing)
//   const minTick = alignTickToSpacing(MIN_TICK, tickSpacing)

//   const tickDelta = calculateTickDelta(tickSpacing, maxConcentration, concentration)
//   const lowerTick = currentTick - tickDelta * tickSpacing
//   const upperTick = currentTick + tickDelta * tickSpacing

//   let num: number // temp

//   return num
// }

// export const getLiquidity = (
//   lowerTick: number,
//   upperTick: number,
//   tokenXAmount: number,
//   tokenYAmount: number
// ): number => {
//   const maxTick = alignTickToSpacing(MAX_TICK, tickSpacing)
//   const minTick = alignTickToSpacing(MIN_TICK, tickSpacing)

//   let num: number // temp

//   return num
// }

export const toPrice = (x: number, decimals: number = 0): Decimal => {
  return toDecimalWithDenominator(x, PRICE_DENOMINATOR, decimals)
}

export const toPercent = (x: number, decimals: number = 0): Decimal => {
  return toDecimalWithDenominator(x, DENOMINATOR, decimals)
}

export const getCloserLimit = (closerLimit: CloserLimit): CloserLimitResult => {
  const { sqrtPriceLimit, xToY, currentTick, tickSpacing, tickmap } = closerLimit
  let index: number | null

  if (xToY) {
    index = getPreviousTick(tickmap, currentTick, tickSpacing)
  } else {
    index = getNextTick(tickmap, currentTick, tickSpacing)
  }
  let sqrtPrice: Decimal
  let init: boolean

  if (index !== null) {
    sqrtPrice = calculatePriceSqrt(index)
    init = true
  } else {
    index = getSearchLimit(new BN(currentTick), new BN(tickSpacing), !xToY).toNumber()
    sqrtPrice = calculatePriceSqrt(index)
    init = false
  }
  if (xToY && sqrtPrice.v.gt(sqrtPriceLimit.v) && index !== null) {
    return { swapLimit: sqrtPrice, limitingTick: { index, initialized: init } }
  } else if (!xToY && sqrtPrice.v.lt(sqrtPriceLimit.v) && index !== null) {
    return { swapLimit: sqrtPrice, limitingTick: { index, initialized: init } }
  } else {
    return { swapLimit: sqrtPriceLimit, limitingTick: null }
  }
}

export const simulateSwap = (swapParameters: SimulateSwapInterface): SimulationResult => {
  const { xToY, byAmountIn, swapAmount, slippage, ticks, tickmap, priceLimit, pool } =
    swapParameters
  let { currentTickIndex, tickSpacing, liquidity, sqrtPrice, fee } = pool
  let previousTickIndex = MAX_TICK + 1
  const amountPerTick: BN[] = []
  let accumulatedAmount: BN = new BN(0)
  let accumulatedAmountOut: BN = new BN(0)
  let accumulatedAmountIn: BN = new BN(0)
  let accumulatedFee: BN = new BN(0)
  const priceLimitAfterSlippage = calculatePriceAfterSlippage(priceLimit, slippage, !xToY)
  if (xToY) {
    if (sqrtPrice.v.lt(priceLimitAfterSlippage.v)) {
      throw new Error('Price limit is on the wrong side of price')
    }
  } else {
    if (sqrtPrice.v.gt(priceLimitAfterSlippage.v)) {
      throw new Error('Price limit is on the wrong side of price')
    }
  }
  let remainingAmount: BN = swapAmount
  while (!remainingAmount.lte(new BN(0))) {
    // find closest initialized tick
    const closerLimit: CloserLimit = {
      sqrtPriceLimit: priceLimitAfterSlippage,
      xToY: xToY,
      currentTick: currentTickIndex,
      tickSpacing: tickSpacing,
      tickmap: tickmap
    }

    const { swapLimit, limitingTick } = getCloserLimit(closerLimit)
    const result = calculateSwapStep(
      sqrtPrice,
      swapLimit,
      liquidity,
      remainingAmount,
      byAmountIn,
      fee
    )

    accumulatedAmountIn = accumulatedAmountIn.add(result.amountIn)
    accumulatedAmountOut = accumulatedAmountOut.add(result.amountOut)
    accumulatedFee = accumulatedFee.add(result.feeAmount)

    let amountDiff: BN

    if (byAmountIn) {
      amountDiff = result.amountIn.add(result.feeAmount)
    } else {
      amountDiff = result.amountOut
    }

    remainingAmount = remainingAmount.sub(amountDiff)
    sqrtPrice = result.nextPrice

    if (sqrtPrice.v.eq(priceLimitAfterSlippage.v) && remainingAmount.gt(new BN(0))) {
      throw new Error('Price would cross swap limit')
    }

    // crossing tick
    if (result.nextPrice.v.eq(swapLimit.v) && limitingTick != null) {
      const tickIndex: number = limitingTick.index
      const initialized: boolean = limitingTick.initialized

      const isEnoughAmountToCross = isEnoughAmountToPushPrice(
        remainingAmount,
        result.nextPrice,
        pool.liquidity,
        pool.fee,
        byAmountIn,
        xToY
      )

      // cross
      if (initialized) {
        if (!ticks.has(tickIndex)) throw new Error('tick crossed but not passed to simulation')

        const tick = ticks.get(tickIndex) as Tick

        if (!xToY || isEnoughAmountToCross) {
          // trunk-ignore(eslint/no-mixed-operators)
          if (currentTickIndex >= tick.index !== tick.sign) {
            liquidity = { v: liquidity.v.add(tick.liquidityChange.v) }
          } else {
            liquidity = { v: liquidity.v.sub(tick.liquidityChange.v) }
          }
        } else if (!remainingAmount.eqn(0)) {
          if (byAmountIn) {
            accumulatedAmountIn = accumulatedAmountIn.add(remainingAmount)
          }
          remainingAmount = new BN(0)
        }
      }
      if (xToY && isEnoughAmountToCross) {
        currentTickIndex = tickIndex - tickSpacing
      } else {
        currentTickIndex = tickIndex
      }
    } else {
      currentTickIndex = getTickFromPrice(currentTickIndex, tickSpacing, result.nextPrice, xToY)
    }

    // add amount to array if tick was initialized otherwise accumulate amount for next iteration
    accumulatedAmount = accumulatedAmount.add(amountDiff)
    // trunk-ignore(eslint/@typescript-eslint/prefer-optional-chain)
    if ((limitingTick !== null && limitingTick.initialized) || remainingAmount.eqn(0)) {
      amountPerTick.push(accumulatedAmount)
      accumulatedAmount = new BN(0)
    }

    if (currentTickIndex === previousTickIndex && !remainingAmount.eqn(0)) {
      throw new Error('At the end of price range')
    } else {
      previousTickIndex = currentTickIndex
    }
  }

  if (accumulatedAmountOut.isZero()) {
    throw new Error('Amount out is zero')
  }

  return {
    amountPerTick,
    accumulatedAmountIn,
    accumulatedAmountOut,
    accumulatedFee,
    priceAfterSwap: sqrtPrice.v
  }
}

export const parseLiquidityOnTicks = (ticks: Tick[], pool: PoolStructure) => {
  let currentLiquidity = new BN(0)

  return ticks.map(tick => {
    currentLiquidity = currentLiquidity.add(tick.liquidityChange.v.muln(tick.sign ? 1 : -1))
    return {
      liquidity: currentLiquidity,
      index: tick.index
    }
  })
}
export const calculateFeeGrowthInside = ({
  tickLower,
  tickUpper,
  tickCurrent,
  feeGrowthGlobalX,
  feeGrowthGlobalY
}: FeeGrowthInside) => {
  // determine position relative to current tick
  const currentAboveLower = tickCurrent >= tickLower.index
  const currentBelowUpper = tickCurrent < tickUpper.index
  let feeGrowthBelowX: BN
  let feeGrowthBelowY: BN
  let feeGrowthAboveX: BN
  let feeGrowthAboveY: BN

  // calculate fee growth below
  if (currentAboveLower) {
    feeGrowthBelowX = tickLower.feeGrowthOutsideX.v
    feeGrowthBelowY = tickLower.feeGrowthOutsideY.v
  } else {
    feeGrowthBelowX = feeGrowthGlobalX.v.sub(tickLower.feeGrowthOutsideX.v)
    feeGrowthBelowY = feeGrowthGlobalY.v.sub(tickLower.feeGrowthOutsideY.v)
  }

  // calculate fee growth above
  if (currentBelowUpper) {
    feeGrowthAboveX = tickUpper.feeGrowthOutsideX.v
    feeGrowthAboveY = tickUpper.feeGrowthOutsideY.v
  } else {
    feeGrowthAboveX = feeGrowthGlobalX.v.sub(tickUpper.feeGrowthOutsideX.v)
    feeGrowthAboveY = feeGrowthGlobalY.v.sub(tickUpper.feeGrowthOutsideY.v)
  }

  // calculate fee growth inside
  let feeGrowthInsideX = feeGrowthGlobalX.v.sub(feeGrowthBelowX).sub(feeGrowthAboveX)
  let feeGrowthInsideY = feeGrowthGlobalY.v.sub(feeGrowthBelowY).sub(feeGrowthAboveY)

  if (feeGrowthInsideX.lt(new BN(0))) {
    feeGrowthInsideX = U128MAX.sub(feeGrowthInsideX.abs()).addn(1)
  }
  if (feeGrowthInsideY.lt(new BN(0))) {
    feeGrowthInsideY = U128MAX.sub(feeGrowthInsideY.abs()).addn(1)
  }

  return [feeGrowthInsideX, feeGrowthInsideY]
}

export const calculateTokensOwed = ({
  position,
  feeGrowthInsideX,
  feeGrowthInsideY
}: TokensOwed) => {
  let tokensOwedX
  let tokensOwedY
  if (feeGrowthInsideX.lt(position.feeGrowthInsideX.v)) {
    tokensOwedX = position.liquidity.v
      .mul(feeGrowthInsideX.add(U128MAX.sub(position.feeGrowthInsideX.v)))
      .div(new BN(10).pow(new BN(DECIMAL + LIQUIDITY_SCALE)))
  } else {
    tokensOwedX = position.liquidity.v
      .mul(feeGrowthInsideX.sub(position.feeGrowthInsideX.v))
      .div(new BN(10).pow(new BN(DECIMAL + LIQUIDITY_SCALE)))
  }
  if (feeGrowthInsideY.lt(position.feeGrowthInsideY.v)) {
    tokensOwedY = position.liquidity.v
      .mul(feeGrowthInsideY.add(U128MAX.sub(position.feeGrowthInsideY.v)))
      .div(new BN(10).pow(new BN(DECIMAL + LIQUIDITY_SCALE)))
  } else {
    tokensOwedY = position.liquidity.v
      .mul(feeGrowthInsideY.sub(position.feeGrowthInsideY.v))
      .div(new BN(10).pow(new BN(DECIMAL + LIQUIDITY_SCALE)))
  }
  const tokensOwedXTotal = position.tokensOwedX.v.add(tokensOwedX).div(DENOMINATOR)
  const tokensOwedYTotal = position.tokensOwedY.v.add(tokensOwedY).div(DENOMINATOR)
  return [tokensOwedXTotal, tokensOwedYTotal]
}

export const calculateClaimAmount = ({
  position,
  tickLower,
  tickUpper,
  tickCurrent,
  feeGrowthGlobalX,
  feeGrowthGlobalY
}: SimulateClaim) => {
  // determine position relative to current tick
  const feeGrowthParams: FeeGrowthInside = {
    tickLower: tickLower,
    tickUpper: tickUpper,
    tickCurrent: tickCurrent,
    feeGrowthGlobalX: feeGrowthGlobalX,
    feeGrowthGlobalY: feeGrowthGlobalY
  }
  const [feeGrowthInsideX, feeGrowthInsideY] = calculateFeeGrowthInside(feeGrowthParams)

  const tokensOwedParams: TokensOwed = {
    position: position,
    feeGrowthInsideX: feeGrowthInsideX,
    feeGrowthInsideY: feeGrowthInsideY
  }

  const [tokensOwedXTotal, tokensOwedYTotal] = calculateTokensOwed(tokensOwedParams)

  return [tokensOwedXTotal, tokensOwedYTotal]
}

export const bigNumberToBuffer = (n: BN, size: 16 | 32 | 64 | 128 | 256) => {
  const chunk = new BN(2).pow(new BN(16))

  const buffer = Buffer.alloc(size / 8)
  let offset = 0

  while (n.gt(new BN(0))) {
    buffer.writeUInt16LE(n.mod(chunk).toNumber(), offset)
    n = n.div(chunk)
    offset += 2
  }

  return buffer
}

export const getMaxTick = (tickSpacing: number) => {
  const limitedByPrice = MAX_TICK - (MAX_TICK % tickSpacing)
  const limitedByTickmap = TICK_LIMIT * tickSpacing
  return Math.min(limitedByPrice, limitedByTickmap)
}

export const getMinTick = (tickSpacing: number) => {
  const limitedByPrice = -MAX_TICK + (MAX_TICK % tickSpacing)
  const limitedByTickmap = -TICK_LIMIT * tickSpacing
  return Math.max(limitedByPrice, limitedByTickmap)
}
