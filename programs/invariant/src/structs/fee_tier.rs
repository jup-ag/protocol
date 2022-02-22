use crate::{decimals::FixedPoint, old_decimal::OldDecimal};
use anchor_lang::prelude::*;

#[account(zero_copy)]
#[repr(packed)]
#[derive(PartialEq, Default, Debug)]
pub struct FeeTier {
    pub fee: FixedPoint,
    pub tick_spacing: u16,
    pub bump: u8,
}
