use crate::*;


pub const MAX_INPUTS: usize = 4;
pub const MAX_INPUTS_LEN: usize = 32;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SwapParams {
    pub from: Pubkey,                    
    pub to: [u8; 32],
    pub synthetic_token_out: [u8; 32],
    pub gas_limit: u128,                
    pub dst_eid: u32,                   
    pub value: u128,                    
    pub assets: Asset,            
    pub commands: Vec<u8>,              
    pub inputs: Vec<Vec<u8>>,           
    pub minimum_amount_out: u128,       
}


#[account]


pub struct SwapStorage {
    pub from: Pubkey,                    
    pub to: [u8; 32],
    pub synthetic_token_out: [u8; 32],
    pub gas_limit: u128,                
    pub dst_eid: u32,                   
    pub value: u128,                    
    pub assets: Asset,            
    pub commands: Vec<u8>,              
    pub inputs: Vec<Vec<u8>>,           
    pub minimum_amount_out: u128,       
}
impl SwapStorage  {
    pub const SIZE: usize = 228 + MAX_INPUTS * (4 + MAX_INPUTS_LEN);
}