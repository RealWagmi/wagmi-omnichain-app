use crate::*;

#[account]
pub struct GatewayVault {
    pub admin: Pubkey, // This is required and should be consistent.
    pub bump: u8, // This is required and should be consistent.
    pub endpoint_program: Pubkey, // This is required and should be consistent.
    pub dst_eid: u32, // Endpoint ID of the destination chain where the SyntheticTokenHub resides.
    pub token_count: u64, // Amount of available tokens
    pub dst_address: [u8; 32]
}

impl GatewayVault {
    pub const SIZE: usize = 8 + std::mem::size_of::<Self>();
}


#[account]
pub struct LzReceiveTypesAccounts {
    pub store: Pubkey, // This is required and should be consistent.
}

impl LzReceiveTypesAccounts {
    pub const SIZE: usize = 8 + std::mem::size_of::<Self>();
}