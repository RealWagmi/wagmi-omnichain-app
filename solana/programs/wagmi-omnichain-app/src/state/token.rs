use crate::*;

#[account]
pub struct AvailableToken {
    pub on_pause: bool,
    pub token_address: Pubkey,
    pub synthetic_token_address: [u8; 32],
    pub decimals_delta: i8,
    pub min_bridge_amt: u128,
}


impl AvailableToken {
    pub const ADDRESS_LENGTH: usize = 32; // 32 bytes for the address
    pub const SIZE: usize = 8 + std::mem::size_of::<Self>() + 
        Self::ADDRESS_LENGTH * 2; // Two addresses (token_address and synthetic_token_address)
}

#[account]
pub struct TokenIndex {
  pub index: u64
}
impl  TokenIndex {
    pub const SIZE: usize = 8 + std::mem::size_of::<Self>();
    
}
