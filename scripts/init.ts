import { Market, Network } from '@invariant-labs/sdk/src'
import { CreateFeeTier, Decimal } from '@invariant-labs/sdk/src/market'
import { FEE_TIERS } from '@invariant-labs/sdk/src/utils'
import { Provider } from '@project-serum/anchor'
import { clusterApiUrl, Keypair } from '@solana/web3.js'
import { createFeeTier, createState } from '../tests/testUtils'
import { MINTER } from './minter'
require('dotenv').config()

const provider = Provider.local(clusterApiUrl('devnet'), {
    skipPreflight: true
})
const createStandardFeeTiers = async (market: Market, payer: Keypair) => {
    Promise.all(
        FEE_TIERS.map(async (feeTier) => {
            const createFeeTierVars: CreateFeeTier = {
                feeTier,
                admin: payer.publicKey
            }
            await createFeeTier(market, createFeeTierVars, payer)
        })
    )
}

const connection = provider.connection

const main = async () => {
    const market = await Market.build(Network.DEV, provider.wallet, connection)

    await createState(market, MINTER.publicKey, MINTER)
    await createStandardFeeTiers(market, MINTER)
}
main()
