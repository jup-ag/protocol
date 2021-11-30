use crate::decimal::Decimal;
use crate::*;
use anchor_lang::prelude::*;

#[account(zero_copy)]
#[derive(PartialEq, Default, Debug)]
pub struct Pool {
    pub token_x: Pubkey,
    pub token_y: Pubkey,
    pub token_x_reserve: Pubkey,
    pub token_y_reserve: Pubkey,
    pub position_iterator: u64,
    pub tick_spacing: u16,
    pub fee: Decimal,
    pub protocol_fee: Decimal,
    pub liquidity: Decimal,
    pub sqrt_price: Decimal,
    pub current_tick_index: i32, // nearest tick below the current price
    pub tickmap: Pubkey,
    pub fee_growth_global_x: Decimal,
    pub fee_growth_global_y: Decimal,
    pub fee_protocol_token_x: Decimal,
    pub fee_protocol_token_y: Decimal,
    pub bump: u8,
    pub nonce: u8,
    pub authority: Pubkey,
}

impl Pool {
    pub fn add_fee(&mut self, amount: Decimal, x: bool) {
        if amount == Decimal::new(0) || { self.liquidity } == Decimal::new(0) {
            return;
        }
        if x {
            self.fee_growth_global_x = self.fee_growth_global_x + (amount / self.liquidity);
        } else {
            self.fee_growth_global_y = self.fee_growth_global_y + (amount / self.liquidity);
        }
    }

    pub fn update_liquidity_safely(
        self: &mut Self,
        liquidity_delta: Decimal,
        add: bool,
    ) -> Result<()> {
        // validate in decrease liquidity case
        if !add && { self.liquidity } < liquidity_delta {
            return Err(ErrorCode::InvalidPoolLiquidity.into());
        };
        // pool liquidity can cannot be negative
        self.liquidity = match add {
            true => self.liquidity + liquidity_delta,
            false => self.liquidity - liquidity_delta,
        };

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_update_liquidity_safely_pool() {
        // Invalid pool liquidity
        {
            let mut pool = Pool {
                liquidity: Decimal::new(0),
                ..Default::default()
            };
            let liquidity_delta = Decimal::one();
            let add = false;

            let result = pool.update_liquidity_safely(liquidity_delta, add);

            assert!(result.is_err());
        }
        // adding liquidity
        {
            let mut pool = Pool {
                liquidity: Decimal::one(),
                ..Default::default()
            };
            let liquidity_delta: Decimal = Decimal::from_integer(2);
            let add: bool = true;

            pool.update_liquidity_safely(liquidity_delta, add).unwrap();

            assert_eq!({ pool.liquidity }, Decimal::from_integer(3));
        }
        // subtracting liquidity
        {
            let mut pool = Pool {
                liquidity: Decimal::from_integer(3),
                ..Default::default()
            };
            let liquidity_delta: Decimal = Decimal::from_integer(2);
            let add: bool = false;

            pool.update_liquidity_safely(liquidity_delta, add).unwrap();

            assert_eq!({ pool.liquidity }, Decimal::one());
        }
    }
}
