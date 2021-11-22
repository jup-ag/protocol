use crate::decimal::Decimal;
use crate::math::calculate_price_sqrt;
use crate::state::fee_tier::FeeTier;
use crate::state::pool::Pool;
use crate::state::tickmap::Tickmap;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(bump: u8, nonce: u8, init_tick: i32, fee: u64, tick_spacing: u16)]
pub struct CreatePool<'info> {
    #[account(init,
        seeds = [b"poolv1", fee_tier.to_account_info().key.as_ref(), token_x.key.as_ref(), token_y.key.as_ref()],
        bump = bump, payer = payer
    )]
    pub pool: Loader<'info, Pool>,
    #[account(
        seeds = [b"feetierv1", program_id.as_ref(), &fee.to_le_bytes(), &tick_spacing.to_le_bytes()],
        bump = fee_tier.load()?.bump
    )]
    pub fee_tier: Loader<'info, FeeTier>,
    #[account(zero)]
    pub tickmap: Loader<'info, Tickmap>,
    pub token_x: AccountInfo<'info>,
    pub token_y: AccountInfo<'info>,
    pub token_x_reserve: AccountInfo<'info>,
    pub token_y_reserve: AccountInfo<'info>,
    pub program_authority: AccountInfo<'info>,
    #[account(mut, signer)]
    pub payer: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: AccountInfo<'info>,
}

pub fn handler(
    ctx: Context<CreatePool>,
    bump: u8,
    nonce: u8,
    init_tick: i32,
    _fee: u64,
    _tick_spacing: u16,
) -> ProgramResult {
    msg!("INVARIANT: CREATE POOL");

    let pool = &mut ctx.accounts.pool.load_init()?;
    let fee_tier = ctx.accounts.fee_tier.load()?;

    **pool = Pool {
        token_x: *ctx.accounts.token_x.key,
        token_y: *ctx.accounts.token_y.key,
        token_x_reserve: *ctx.accounts.token_x_reserve.key,
        token_y_reserve: *ctx.accounts.token_y_reserve.key,
        tick_spacing: fee_tier.tick_spacing,
        fee: fee_tier.fee,
        protocol_fee: Decimal::from_decimal(1, 1), // 10%
        liquidity: Decimal::new(0),
        sqrt_price: calculate_price_sqrt(init_tick),
        current_tick_index: init_tick,
        tickmap: *ctx.accounts.tickmap.to_account_info().key,
        fee_growth_global_x: Decimal::new(0),
        fee_growth_global_y: Decimal::new(0),
        fee_protocol_token_x: Decimal::new(0),
        fee_protocol_token_y: Decimal::new(0),
        position_iterator: 0,
        bump,
        nonce,
        authority: *ctx.accounts.program_authority.key,
    };

    Ok(())
}
