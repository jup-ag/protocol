use crate::structs::*;
use crate::util;
use crate::util::get_current_timestamp;
use crate::ErrorCode::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, TokenAccount, Transfer};
use util::STAKER_SEED;

#[derive(Accounts)]
#[instruction(nonce: u8)]
pub struct ReturnFounds<'info> {
    #[account(mut,
        close = founder,
        constraint = &incentive.load()?.founder == founder.to_account_info().key @ InvalidFounder
    )]
    pub incentive: AccountLoader<'info, Incentive>,
    #[account(mut,
        constraint = &incentive_token_account.owner == staker_authority.to_account_info().key @ InvalidTokenAccount,
        constraint = &incentive.load()?.token_account == incentive_token_account.to_account_info().key @ InvalidTokenAccount,
        constraint = incentive_token_account.mint == incentive_token.key() @ InvalidMint
    )]
    pub incentive_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub founder_token_account: Account<'info, TokenAccount>,
    pub incentive_token: Account<'info, Mint>,
    #[account(seeds = [b"staker".as_ref()], bump = nonce)]
    pub staker_authority: AccountInfo<'info>,
    pub founder: Signer<'info>,
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
}

impl<'info> ReturnFounds<'info> {
    fn return_to_founder(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            Transfer {
                from: self.incentive_token_account.to_account_info(),
                to: self.founder_token_account.to_account_info(),
                authority: self.staker_authority.to_account_info().clone(),
            },
        )
    }
}

pub fn handler(ctx: Context<ReturnFounds>, bump_authority: u8) -> ProgramResult {
    {
        let incentive = ctx.accounts.incentive.load()?;
        let current_time = get_current_timestamp();
        require!(current_time > incentive.end_claim_time, TooEarly);
        require!(incentive.num_of_stakes == 0, StakeExist);

        let seeds = &[STAKER_SEED.as_bytes(), &[bump_authority]];
        let signer = &[&seeds[..]];
        let cpi_ctx = ctx.accounts.return_to_founder().with_signer(signer);

        token::transfer(cpi_ctx, incentive.total_reward_unclaimed.to_u64())?;
    }

    Ok(())
}
