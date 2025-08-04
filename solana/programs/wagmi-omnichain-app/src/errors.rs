use anchor_lang::prelude::*;
use std::result::Result;
#[error_code]
pub enum WagmiError {
    #[msg("Only admin")]
    OnlyAdmin,
    #[msg("Encoding error")]
    EncodingError,
    #[msg("Decoding error")]
    DecodingError,
    #[msg("Token on pause")]
    TokenOnPause,
    #[msg("Amount to low to bridge token")]
    AmountToLow,
    #[msg("DST EID")]
    WrongDstEid,
    #[msg("WRONG MESSAGE")]
    WrongMessage
}
pub fn require(condition: bool, error: WagmiError) -> Result<(), WagmiError> {
    if !condition {
        return Err(error) 
    }
    
    Ok(())
}