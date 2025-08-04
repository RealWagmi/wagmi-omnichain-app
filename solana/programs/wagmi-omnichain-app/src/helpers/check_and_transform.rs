use crate::{state::token::AvailableToken, *};
use std::result::Result;

pub fn check_and_transform<'info>(token_data_account: &Account<'info, AvailableToken>, token_info: &Asset) -> Result<Asset, WagmiError> {
    if token_data_account.on_pause {
        return Err(WagmiError::TokenOnPause)
    };
    if token_info.token_amount < token_data_account.min_bridge_amt {
        return Err(WagmiError::AmountToLow)
    };
    let new_amount = remove_dust(token_info.token_amount, token_data_account.decimals_delta);
    if new_amount <= 0 {
        return Err(WagmiError::AmountToLow)
    };
    return Ok(Asset { token_address: token_info.token_address, token_amount: new_amount })
}